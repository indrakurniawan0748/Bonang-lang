'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

/**
 * Uji helper cache service worker Bonang.
 *
 * Fokus: invalidasi cache PER-FILE. Aset yang berubah di server harus
 * dibuang dari cache, sementara aset yang tidak berubah tetap dilayani
 * dari cache tanpa unduhan ulang.
 *
 * Helper `sw-cache.js` memakai API browser (Cache API, `crypto.subtle`,
 * `Headers`, `Response`). Untuk pengujian, API tiruan dipasang di
 * `globalThis` supaya jalur kode yang diuji sama dengan yang berjalan
 * di browser.
 */

// ===== TIRUAN API BROWSER =====

/**
 * Cache tiruan: Map dari URL → { body, headers }.
 */
class FakeCache {
    constructor() {
        this.entries = new Map();
    }

    _key(request) {
        if (typeof request === 'string') return new URL(request, 'http://localhost').pathname;
        return new URL(request.url).pathname;
    }

    async put(request, response) {
        this.entries.set(this._key(request), response);
    }

    async match(request) {
        return this.entries.get(this._key(request)) || undefined;
    }

    async delete(request) {
        return this.entries.delete(this._key(request));
    }

    async keys() {
        return [...this.entries.keys()].map((pathname) => ({
            url: 'http://localhost' + pathname
        }));
    }
}

/**
 * Cache Storage tiruan.
 */
class FakeCacheStorage {
    constructor() {
        this.caches = new Map();
    }

    async open(name) {
        if (!this.caches.has(name)) this.caches.set(name, new FakeCache());
        return this.caches.get(name);
    }

    async keys() {
        return [...this.caches.keys()];
    }
}

/**
 * Pasang API browser tiruan dan kembalikan fungsi pembersih.
 *
 * `globalThis.crypto` di Node adalah properti accessor yang tidak bisa
 * di-assign langsung, jadi ditulis lewat `Object.defineProperty`.
 */
function installBrowserApi() {
    const previous = {
        caches: globalThis.caches,
        crypto: globalThis.crypto,
        fetch: globalThis.fetch,
        self: globalThis.self
    };

    globalThis.caches = new FakeCacheStorage();

    // `crypto.subtle` tidak ada di Node secara default pada versi lama;
    // Node modern menyediakannya lewat `node:crypto` webcrypto.
    if (!globalThis.crypto || !globalThis.crypto.subtle) {
        const { webcrypto } = require('node:crypto');
        Object.defineProperty(globalThis, 'crypto', {
            value: webcrypto,
            configurable: true,
            writable: true
        });
    }

    globalThis.self = globalThis;

    return () => {
        globalThis.caches = previous.caches;
        Object.defineProperty(globalThis, 'crypto', {
            value: previous.crypto,
            configurable: true,
            writable: true
        });
        globalThis.fetch = previous.fetch;
        globalThis.self = previous.self;
    };
}

/**
 * Muat helper sw-cache.
 */
function loadSwCache() {
    const file = path.resolve(__dirname, '../../runtime/client/sw-cache.js');
    delete require.cache[require.resolve(file)];
    return require(file);
}

/**
 * Buat respons tiruan yang bisa dibaca ulang (body disalin sebagai buffer).
 */
async function makeResponse(body, headers = {}) {
    return new Response(body, { status: 200, headers });
}

// ===== UJI =====

test('sw-cache: hash teks stabil dan berbeda untuk isi berbeda', async () => {
    const cleanup = installBrowserApi();
    try {
        const { hashText } = loadSwCache();

        const a = await hashText('isi sama');
        const b = await hashText('isi sama');
        const c = await hashText('isi lain');

        assert.strictEqual(a, b, 'hash harus deterministik');
        assert.notStrictEqual(a, c, 'isi berbeda harus menghasilkan hash berbeda');
        assert.strictEqual(a.length, 16, 'hash dipotong 16 hex');
    } finally {
        cleanup();
    }
});

test('sw-cache: cacheKey mengubah URL menjadi pathname', () => {
    const cleanup = installBrowserApi();
    try {
        const { cacheKey } = loadSwCache();
        assert.strictEqual(cacheKey('http://localhost/client.js'), '/client.js');
        assert.strictEqual(cacheKey('http://localhost/a/b.css'), '/a/b.css');
    } finally {
        cleanup();
    }
});

test('sw-cache: prune menghapus hanya file yang hash-nya berubah', async () => {
    const cleanup = installBrowserApi();
    try {
        const { CacheInvalidator } = loadSwCache();
        const invalidator = new CacheInvalidator({ cacheName: 'uji' });

        const cache = await caches.open('uji');
        await cache.put('/client.js', await makeResponse('klien lama', {
            'x-bonang-cache-hash': 'aaaabbbbccccdddd'
        }));
        await cache.put('/style.css', await makeResponse('gaya lama', {
            'x-bonang-cache-hash': '1111222233334444'
        }));

        // Manifest baru: client.js berubah, style.css tetap.
        const manifest = {
            version: 'v2',
            files: {
                '/client.js': '9999888877776666',
                '/style.css': '1111222233334444'
            }
        };

        const result = await invalidator.prune(manifest);

        assert.deepStrictEqual(result.removed, ['/client.js'], 'hanya client.js yang berubah');
        assert.strictEqual(result.checked, 2);

        assert.strictEqual(await cache.match('/client.js'), undefined, 'client.js harus dihapus');
        assert.ok(await cache.match('/style.css'), 'style.css harus tetap di-cache');
    } finally {
        cleanup();
    }
});

test('sw-cache: matchFresh mengembalikan null untuk entri basi', async () => {
    const cleanup = installBrowserApi();
    try {
        const { CacheInvalidator } = loadSwCache();
        const invalidator = new CacheInvalidator({ cacheName: 'uji' });

        const cache = await caches.open('uji');
        await cache.put('/client.js', await makeResponse('lama', {
            'x-bonang-cache-hash': 'aaaabbbbccccdddd'
        }));
        await cache.put('/style.css', await makeResponse('gaya', {
            'x-bonang-cache-hash': '1111222233334444'
        }));

        const basi = await invalidator.matchFresh('/client.js', {
            files: { '/client.js': '9999888877776666' }
        });
        assert.strictEqual(basi, null, 'entri basi tidak boleh dilayani');
        assert.strictEqual(await cache.match('/client.js'), undefined, 'entri basi harus dihapus');

        const segar = await invalidator.matchFresh('/style.css', {
            files: { '/style.css': '1111222233334444' }
        });
        assert.ok(segar, 'entri yang hash-nya cocok harus dilayani');
    } finally {
        cleanup();
    }
});

test('sw-cache: store memasang header hash dari manifest', async () => {
    const cleanup = installBrowserApi();
    try {
        const { CacheInvalidator } = loadSwCache();
        const invalidator = new CacheInvalidator({ cacheName: 'uji' });
        const cache = await caches.open('uji');

        const response = await makeResponse('isi');
        await invalidator.store(cache, '/client.js', response, {
            files: { '/client.js': 'abcd1234abcd1234' }
        });

        const cached = await cache.match('/client.js');
        assert.strictEqual(cached.headers.get('x-bonang-cache-hash'), 'abcd1234abcd1234');
        assert.strictEqual(await cached.text(), 'isi', 'body harus utuh');
    } finally {
        cleanup();
    }
});

test('sw-cache: loadManifest mengambil ulang saat dipaksa', async () => {
    const cleanup = installBrowserApi();
    try {
        const { CacheInvalidator } = loadSwCache();
        const invalidator = new CacheInvalidator({
            cacheName: 'uji',
            manifestUrl: '/precache-manifest.json'
        });

        let served = { version: 'v1', files: { '/client.js': 'aaaa' } };
        globalThis.fetch = async () => makeResponse(JSON.stringify(served));

        const first = await invalidator.loadManifest();
        assert.strictEqual(first.version, 'v1');

        served = { version: 'v2', files: { '/client.js': 'bbbb' } };

        // Tanpa force, manifest di-cache di memori.
        const cached = await invalidator.loadManifest();
        assert.strictEqual(cached.version, 'v1', 'manifest di-cache di memori');

        // Dengan force, manifest diambil ulang dari jaringan.
        const fresh = await invalidator.loadManifest(true);
        assert.strictEqual(fresh.version, 'v2');
    } finally {
        cleanup();
    }
});

test('sw-cache: manifest yang gagal dimuat tidak menimpa manifest lama', async () => {
    const cleanup = installBrowserApi();
    try {
        const { CacheInvalidator } = loadSwCache();
        const invalidator = new CacheInvalidator({
            cacheName: 'uji',
            manifestUrl: '/precache-manifest.json'
        });

        globalThis.fetch = async () => makeResponse(JSON.stringify({ version: 'v1', files: {} }));
        await invalidator.loadManifest();

        globalThis.fetch = async () => { throw new Error('jaringan mati'); };
        const result = await invalidator.loadManifest(true);

        assert.strictEqual(result.version, 'v1', 'manifest lama harus dipertahankan');
    } finally {
        cleanup();
    }
});

test('sw-cache: file yang tidak ada di manifest tidak dihapus', async () => {
    const cleanup = installBrowserApi();
    try {
        const { CacheInvalidator } = loadSwCache();
        const invalidator = new CacheInvalidator({ cacheName: 'uji' });

        const cache = await caches.open('uji');
        await cache.put('/lain.txt', await makeResponse('lain'));

        const result = await invalidator.prune({ files: { '/client.js': 'aaaa' } });

        assert.deepStrictEqual(result.removed, [], 'tidak ada yang boleh dihapus');
        assert.ok(await cache.match('/lain.txt'), 'entri tak dikenal harus tetap ada');
    } finally {
        cleanup();
    }
});
