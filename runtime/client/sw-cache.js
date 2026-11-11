'use strict';

/**
 * Helper cache service worker Bonang.
 *
 * Berkas ini bukan modul — dimuat lewat `importScripts("/sw-cache.js")`
 * di dalam service worker. Tujuannya satu: membuat invalidasi cache
 * terjadi **per-file**, bukan per-versi-cache.
 *
 * Masalah yang diselesaikan
 * -------------------------
 * Pola umum service worker memakai satu nama cache ber-versi
 * (`app-v1`, `app-v2`). Setiap deploy memaksa seluruh aset diunduh ulang
 *meskipun yang benar-benar berubah cuma satu file. Sebaliknya, bila nama
 * cache tidak dinaikkan sama sekali, aset lama bertahan selamanya.
 *
 * Solusi di sini: build menghasilkan `precache-manifest.json` yang memuat
 * hash SHA-256 per file. Service worker membandingkan hash yang tersimpan
 * di cache dengan hash di manifest. File yang berubah → entri cache itu
 * saja yang dihapus; file lain tetap dipakai.
 *
 * Kontrak
 * -------
 * Manifest:
 * ```json
 * { "version": "<hash build>", "files": { "/client.js": "<sha256 hex>" } }
 * ```
 *
 * Entri cache menyimpan salinan respons dengan header tambahan
 * `X-Bonang-Cache-Hash` berisi hash file saat disimpan. Header inilah
 * yang dibandingkan terhadap manifest.
 */

(function (global) {
    // Nama header yang menyimpan hash file pada entri cache.
    const HASH_HEADER = 'X-Bonang-Cache-Hash';

    // Header respons yang menyimpan hash file pada entri cache.
    const HASH_HEADER_LOWER = HASH_HEADER.toLowerCase();

    /**
     * Hitung hash SHA-256 dari data, disingkat ke 16 karakter hex.
     *
     * Panjang 16 hex (64 bit) sudah cukup untuk mendeteksi perubahan
     * file, dan membuat manifest tetap kecil.
     */
    async function hashBytes(bytes) {
        const digest = await crypto.subtle.digest('SHA-256', bytes);
        const view = new Uint8Array(digest);
        let hex = '';
        for (let i = 0; i < view.length; i += 1) {
            hex += view[i].toString(16).padStart(2, '0');
        }
        return hex.slice(0, 16);
    }

    /**
     * Hitung hash dari teks (UTF-8).
     */
    async function hashText(text) {
        return hashBytes(new TextEncoder().encode(text));
    }

    /**
     * Normalisasi URL menjadi kunci cache.
     *
     * Menerima string URL, path relatif, atau objek `Request` (yang punya
     * properti `.url`). Origin dasar diambil dari `self.location` bila
     * tersedia. Di luar service worker (mis. pengujian di Node) origin
     * tidak ada, jadi path relatif dipakai apa adanya.
     */
    function cacheKey(target) {
        const origin = (typeof self !== 'undefined' && self.location && self.location.origin)
            ? self.location.origin
            : 'http://localhost';
        const url = (target && typeof target === 'object' && typeof target.url === 'string')
            ? target.url
            : target;
        return new URL(url, origin).pathname;
    }

    /**
     * Penginvalidasi cache per-file.
     */
    class CacheInvalidator {
        /**
         * @param {object} options
         * @param {string} options.cacheName Nama cache yang dipakai.
         * @param {string} options.manifestUrl URL manifest build.
         */
        constructor(options = {}) {
            this.cacheName = options.cacheName || 'bonang-cache';
            this.manifestUrl = options.manifestUrl || '/precache-manifest.json';
            this.manifest = null;
        }

        /**
         * Muat manifest build.
         *
         * Manifest di-cache di memori, tapi **selalu** diambil ulang dari
         * jaringan bila `force` true. Service worker mengaktifkan kembali
         * diri setelah deploy baru, sehingga manifest yang basi harus
         * dibuang — kalau tidak, aset yang berubah tidak akan pernah
         * terdeteksi.
         *
         * Manifest tidak ada (mis. pada mode dev) bukan kondisi fatal —
         * service worker lalu berjalan tanpa invalidasi per-file.
         */
        async loadManifest(force = false) {
            if (this.manifest && !force) return this.manifest;
            try {
                const response = await fetch(this.manifestUrl, { cache: 'no-cache' });
                if (!response.ok) throw new Error('HTTP ' + response.status);
                this.manifest = await response.json();
                return this.manifest;
            } catch (err) {
                // Jangan menimpa manifest yang sudah ada saat request
                // gagal — manifest lama masih berguna.
                if (!this.manifest) {
                    this.manifest = { version: null, files: {} };
                }
                return this.manifest;
            }
        }

        /**
         * Hash yang diharapkan untuk sebuah URL, atau null bila file tidak
         * ada di manifest (berarti tidak ada perubahan yang perlu dilacak).
         */
        expectedHash(manifest, url) {
            if (!manifest || !manifest.files) return null;
            const key = cacheKey(url);
            return manifest.files[key] || manifest.files[key.replace(/\/$/, '/index.html')] || null;
        }

        /**
         * Hapus entri cache yang hash-nya sudah tidak cocok dengan manifest.
         *
         * Hanya file yang berubah yang terhapus — aset lain tetap(cache),
         * sehingga deploy tidak memaksa unduhan ulang.
         *
         * @returns {Promise<{checked: number, removed: string[]}>}
         */
        async prune(manifest) {
            const removed = [];
            let checked = 0;

            const cache = await caches.open(this.cacheName);
            const requests = await cache.keys();

            for (const request of requests) {
                const key = cacheKey(request.url);
                const expected = this.expectedHash(manifest, key);
                if (!expected) continue;

                checked += 1;
                const cached = await cache.match(request);
                if (!cached) continue;

                const actual = cached.headers.get(HASH_HEADER_LOWER);
                if (actual === expected) continue;

                // Hash berbeda → file berubah di server. Buang supaya
                // request berikutnya mengambil versi baru.
                await cache.delete(request);
                removed.push(key);
            }

            return { checked, removed };
        }

        /**
         * Pasang header hash pada respons sebelum disimpan ke cache.
         *
         * `request` boleh berupa string URL, path relatif, atau objek
         * `Request` — semuanya diterjemahkan lewat `cacheKey`.
         */
        async store(cache, request, response, manifest) {
            const expected = this.expectedHash(manifest, cacheKey(request));
            const headers = new Headers(response.headers);
            if (expected) headers.set(HASH_HEADER, expected);

            const copy = new Response(await response.clone().arrayBuffer(), {
                status: response.status,
                statusText: response.statusText,
                headers
            });
            await cache.put(request, copy);
        }

        /**
         * Ambil respons dari cache HANYA bila hash-nya masih cocok.
         *
         * Entrri basi dikembalikan sebagai null supaya pemanggil
         * mem-fetch versi baru dari jaringan.
         */
        async matchFresh(request, manifest) {
            const cache = await caches.open(this.cacheName);
            const cached = await cache.match(request);
            if (!cached) return null;

            const expected = this.expectedHash(manifest, cacheKey(request));
            if (!expected) return cached;

            const actual = cached.headers.get(HASH_HEADER_LOWER);
            if (actual === expected) return cached;

            // Basi — hapus supaya tidak dipakai lagi.
            await cache.delete(request);
            return null;
        }
    }

    const api = {
        HASH_HEADER,
        HASH_HEADER_LOWER,
        CacheInvalidator,
        hashBytes,
        hashText,
        cacheKey
    };

    if (typeof module === 'object' && module.exports) {
        module.exports = api;
    } else {
        global.BonangCache = api;
    }
})(typeof self !== 'undefined' ? self : globalThis);
