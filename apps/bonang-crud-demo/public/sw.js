// Service worker Bonang CRUD Demo.
//
// Menyediakan:
//  - cache aset statis (HTML, CSS, JS) agar aplikasi bisa dibuka offline
//  - fallback ke cache untuk request navigasi
//  - API GET tidak di-cache (data produk disimpan di IndexedDB, bukan Cache API)
//  - invalidasi cache PER-FILE: aset yang berubah di server langsung
//    dibuang dari cache, aset yang tidak berubah tetap dipakai.
//
// Invalidasi per-file memakai `precache-manifest.json` yang dihasilkan
// `bonang build`. Manifest memuat hash per file; service worker
// membandingkannya dengan hash yang tersimpan pada entri cache.
//
// Kapan manifest diperiksa ulang?
// --------------------------------
// Service worker hanya diaktifkan ulang ketika berkas `sw.js` berubah —
// padahal isi aset bisa berubah tanpa `sw.js` ikut berubah. Karena itu
// manifest diperiksa ulang pada setiap **navigasi** (satu kali per
// halaman dimuat), lalu entri cache yang basi dibuang. Aset individual
// tetap memakai hash dari manifest terbaru itu.

importScripts("/bonang/sw-cache.js");

const CACHE_NAME = "bonang-crud-demo";
const MANIFEST_URL = "/precache-manifest.json";

// Navigasi yang harus tetap tersedia saat offline.
const OFFLINE_FALLBACK = "/index.html";

const invalidator = new BonangCache.CacheInvalidator({
    cacheName: CACHE_NAME,
    manifestUrl: MANIFEST_URL
});

self.addEventListener("install", (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => cache.addAll(["/", OFFLINE_FALLBACK]))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener("activate", (event) => {
    event.waitUntil(
        caches.keys()
            .then((keys) => Promise.all(
                keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
            ))
            .then(() => self.clients.claim())
    );
});

self.addEventListener("fetch", (event) => {
    const request = event.request;

    if (request.method !== "GET") return;

    const url = new URL(request.url);
    if (url.origin !== self.location.origin) return;

    // Request API selalu ke jaringan — status sinkronisasi harus akurat.
    if (url.pathname.startsWith("/api/")) return;

    // Manifest sendiri tidak boleh di-cache — isinya harus selalu
    // mencerminkan build terbaru.
    if (url.pathname === MANIFEST_URL) return;

    // Navigasi: segarkan manifest, buang entri basi, lalu coba jaringan
    // dan jatuh ke cache saat offline.
    if (request.mode === "navigate") {
        event.respondWith(
            (async () => {
                const manifest = await invalidator.loadManifest(true);
                await invalidator.prune(manifest);

                try {
                    const response = await fetch(request);
                    const copy = response.clone();
                    const cache = await caches.open(CACHE_NAME);
                    await cache.put(request, copy);
                    return response;
                } catch {
                    const cached = await caches.match(OFFLINE_FALLBACK);
                    if (cached) return cached;
                    throw new Error('Halaman tidak tersedia dan tidak ada salinan offline');
                }
            })()
        );
        return;
    }

    // Aset statis: sajikan dari cache bila hash-nya masih cocok,
    // perbarui di belakang layar bila basi.
    event.respondWith(
        (async () => {
            const manifest = await invalidator.loadManifest();
            const fresh = await invalidator.matchFresh(request, manifest);

            const network = fetch(request)
                .then(async (response) => {
                    if (response.ok) {
                        const cache = await caches.open(CACHE_NAME);
                        await invalidator.store(cache, request, response, manifest);
                    }
                    return response;
                })
                .catch(() => fresh);

            return fresh || network;
        })()
    );
});
