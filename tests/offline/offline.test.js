'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

/**
 * Uji offline-first Bonang.
 *
 * Fokus: IndexedDB store, sync queue, resolusi konflik last-write-wins,
 * dan alur server-first dengan fallback ke antrean lokal.
 *
 * Runtime client diuji memakai implementasi IndexedDB tiruan berbasis
 * Map. Tiramuan ini-API-nya sengaja dibuat sama dengan IndexedDB asli
 * (open / transaction / objectStore / put / get / delete / clear) agar
 * kode yang diuji benar-benar jalur yang dipakai di browser.
 */

// ===== INDEXEDDB TIRUAN =====

/**
 * Object store tiruan yang menyimpan record sebagai Map dengan key `id`.
 */
class FakeObjectStore {
    constructor(name) {
        this.name = name;
        this.records = new Map();
        this.indexes = new Map();
    }

    createIndex(name, keyPath) {
        this.indexes.set(name, keyPath);
    }

    put(value) {
        const key = value[this.keyPath || 'id'];
        this.records.set(key, JSON.parse(JSON.stringify(value)));
        return { result: key };
    }

    get(key) {
        const record = this.records.get(key);
        return { result: record ? JSON.parse(JSON.stringify(record)) : undefined };
    }

    getAll() {
        return { result: [...this.records.values()].map((r) => JSON.parse(JSON.stringify(r))) };
    }

    delete(key) {
        this.records.delete(key);
        return { result: undefined };
    }

    clear() {
        this.records.clear();
        return { result: undefined };
    }
}

/**
 * Database tiruan dengan object store dan transaksi sederhana.
 */
class FakeDatabase {
    constructor() {
        this.objectStoreNames = { contains: (name) => this.stores.has(name) };
        this.stores = new Map();
        this.transactions = [];
    }

    createObjectStore(name, options = {}) {
        const store = new FakeObjectStore(name);
        store.keyPath = options.keyPath || 'id';
        this.stores.set(name, store);
        return store;
    }

    transaction(storeName, mode) {
        const tx = {
            mode,
            objectStore: (name) => this.stores.get(name),
            oncomplete: null,
            onerror: null,
            onabort: null
        };
        this.transactions.push(tx);
        // Transaksi tiruan selesai pada tick berikutnya, seperti IndexedDB asli.
        setImmediate(() => {
            if (tx.oncomplete) tx.oncomplete();
        });
        return tx;
    }
}

/**
 * Pasang IndexedDB tiruan ke globalThis dan kembalikan fungsi pembersih.
 */
function installFakeIndexedDB() {
    const previous = globalThis.indexedDB;
    const databases = new Map();

    globalThis.indexedDB = {
        open(name, version) {
            const request = { onupgradeneeded: null, onsuccess: null, onerror: null, result: null };
            setImmediate(() => {
                if (!databases.has(name)) {
                    databases.set(name, new FakeDatabase());
                }
                request.result = databases.get(name);
                if (request.onupgradeneeded) request.onupgradeneeded();
                if (request.onsuccess) request.onsuccess();
            });
            return request;
        }
    };

    return () => {
        globalThis.indexedDB = previous;
    };
}

/**
 * Muat runtime client Bonang.
 *
 * Runtime client ditulis sebagai JavaScript murni (bukan Bonang) karena
 * harus jalan di browser tanpa toolchain. Jadi dimuat langsung, bukan
 * dikompilasi.
 */
function loadClientRuntime() {
    const file = path.resolve(__dirname, '../../runtime/client/client.js');
    delete require.cache[require.resolve(file)];
    return require(file);
}

// ===== UJI =====

test('offline: IndexedDBStore menyimpan, membaca, dan menghapus entitas', async (t) => {
    const cleanup = installFakeIndexedDB();
    t.after(cleanup);

    const { IndexedDBStore } = loadClientRuntime();
    const store = new IndexedDBStore({
        name: 'test_db',
        version: 1,
        stores: ['products', 'syncQueue']
    });
    await store.open();

    await store.put('products', { id: 1, name: 'Kopi', updated_at: '2026-01-01T00:00:00.000Z' });
    await store.put('products', { id: 2, name: 'Teh', updated_at: '2026-01-02T00:00:00.000Z' });

    const all = await store.getAll('products');
    assert.strictEqual(all.length, 2);

    const one = await store.get('products', 1);
    assert.strictEqual(one.name, 'Kopi');

    await store.delete('products', 1);
    const after = await store.getAll('products');
    assert.strictEqual(after.length, 1);
    assert.strictEqual(after[0].name, 'Teh');

    await store.clear('products');
    assert.strictEqual((await store.getAll('products')).length, 0);
});

test('offline: putMany menyimpan banyak entitas dalam satu operasi', async (t) => {
    const cleanup = installFakeIndexedDB();
    t.after(cleanup);

    const { IndexedDBStore } = loadClientRuntime();
    const store = new IndexedDBStore({ name: 'bulk_db', stores: ['products'] });
    await store.open();

    const result = await store.putMany('products', [
        { id: 1, name: 'A' },
        { id: 2, name: 'B' },
        { id: 3, name: 'C' }
    ]);
    assert.strictEqual(result.changes, 3);
    assert.strictEqual((await store.getAll('products')).length, 3);
});

test('offline: SyncQueue_enqueue dan list mempertahankan antrean', async (t) => {
    const cleanup = installFakeIndexedDB();
    t.after(cleanup);

    const { IndexedDBStore, SyncQueue } = loadClientRuntime();
    const store = new IndexedDBStore({ name: 'queue_db', stores: ['syncQueue'] });
    await store.open();
    const queue = new SyncQueue({ store, storeName: 'syncQueue' });

    await queue.enqueue({
        id: 'op-1',
        entity: 'product',
        op: 'create',
        payload: { name: 'Kopi' }
    });
    await queue.enqueue({
        id: 'op-2',
        entity: 'product',
        op: 'update',
        entityId: 5,
        payload: { name: 'Teh' },
        baseVersion: '2026-01-01T00:00:00.000Z'
    });

    const entries = await queue.list();
    assert.strictEqual(entries.length, 2);
    assert.strictEqual(entries[0].id, 'op-1');
    assert.strictEqual(entries[1].baseVersion, '2026-01-01T00:00:00.000Z');
    assert.ok(entries[0].timestamp, 'antrean harus mencatat timestamp');
});

test('offline: flush menghapus entri applied dan failed, mempertahankan conflict', async (t) => {
    const cleanup = installFakeIndexedDB();
    t.after(cleanup);

    const { IndexedDBStore, SyncQueue } = loadClientRuntime();
    const store = new IndexedDBStore({ name: 'flush_db', stores: ['syncQueue'] });
    await store.open();
    const queue = new SyncQueue({ store, storeName: 'syncQueue' });

    await queue.enqueue({ id: 'a', entity: 'product', op: 'create' });
    await queue.enqueue({ id: 'b', entity: 'product', op: 'update' });
    await queue.enqueue({ id: 'c', entity: 'product', op: 'delete' });

    const summary = await queue.flush(async (entries) => {
        return entries.map((entry) => {
            if (entry.id === 'a') return { id: 'a', status: 'applied' };
            if (entry.id === 'b') return { id: 'b', status: 'conflict' };
            return { id: 'c', status: 'failed' };
        });
    });

    assert.strictEqual(summary.sent, 3);
    assert.strictEqual(summary.applied, 1);
    assert.strictEqual(summary.conflicted, 1);
    assert.strictEqual(summary.failed, 1);

    const remaining = await queue.list();
    assert.strictEqual(remaining.length, 1);
    assert.strictEqual(remaining[0].id, 'b', 'entri konflik harus tetap di antrean');
});

test('offline: flush dengan antrean kosong tidak memanggil sender', async (t) => {
    const cleanup = installFakeIndexedDB();
    t.after(cleanup);

    const { IndexedDBStore, SyncQueue } = loadClientRuntime();
    const store = new IndexedDBStore({ name: 'empty_db', stores: ['syncQueue'] });
    await store.open();
    const queue = new SyncQueue({ store, storeName: 'syncQueue' });

    let called = false;
    const summary = await queue.flush(async () => {
        called = true;
        return [];
    });

    assert.strictEqual(called, false);
    assert.strictEqual(summary.sent, 0);
});

test('offline: resolusi konflik memakai last-write-wins', () => {
    const { resolveConflict } = loadClientRuntime();

    const local = { id: 1, name: 'Lokal', updated_at: '2026-01-02T00:00:00.000Z' };
    const remote = { id: 1, name: 'Server', updated_at: '2026-01-01T00:00:00.000Z' };

    const result = resolveConflict(local, remote);
    assert.strictEqual(result.winner, 'local', 'versi lokal yang lebih baru harus menang');
    assert.strictEqual(result.merged.name, 'Lokal');
    assert.strictEqual(result.conflict, true);

    // Basis perbandingan tetap "argumen pertama vs argumen kedua": bila
    // argumen pertama lebih tua, argumen kedua menang.
    const result2 = resolveConflict(remote, local);
    assert.strictEqual(result2.winner, 'remote');
    assert.strictEqual(result2.merged.name, 'Lokal', 'versi yang lebih baru tetap dipertahankan');
});

test('offline: entri tanpa updated_at tidak menimpa data server', () => {
    const { resolveConflict } = loadClientRuntime();

    const local = { id: 1, name: 'Lokal tanpa timestamp' };
    const remote = { id: 1, name: 'Server', updated_at: '2026-01-01T00:00:00.000Z' };

    const result = resolveConflict(local, remote);
    assert.strictEqual(result.winner, 'remote');
    assert.strictEqual(result.merged.name, 'Server');
});

test('offline: reconcile menggabungkan daftar lokal dan server', () => {
    const { reconcile } = loadClientRuntime();

    const local = [
        { id: 1, name: 'Lokal 1', updated_at: '2026-01-02T00:00:00.000Z' },
        { id: 2, name: 'Lokal 2', updated_at: '2026-01-01T00:00:00.000Z' }
    ];
    const remote = [
        { id: 2, name: 'Server 2', updated_at: '2026-01-03T00:00:00.000Z' },
        { id: 3, name: 'Server 3', updated_at: '2026-01-01T00:00:00.000Z' }
    ];

    const { items, conflicts } = reconcile(local, remote);
    const ids = items.map((item) => item.id).sort();

    assert.deepStrictEqual(ids, [1, 2, 3]);
    const item2 = items.find((item) => item.id === 2);
    assert.strictEqual(item2.name, 'Server 2', 'versi server yang lebih baru harus menang');
    assert.strictEqual(conflicts.length, 1, 'perbedaan versi harus dilaporkan sebagai konflik');
    assert.strictEqual(conflicts[0].id, 2);
});

test('offline: status koneksi berubah karena event online/offline', async (t) => {
    const cleanup = installFakeIndexedDB();
    t.after(cleanup);

    const { IndexedDBStore, SyncQueue } = loadClientRuntime();
    const store = new IndexedDBStore({ name: 'conn_db', stores: ['syncQueue'] });
    await store.open();
    const queue = new SyncQueue({ store, storeName: 'syncQueue' });

    const seen = [];
    queue.subscribe((online) => seen.push(online));

    queue.setOnline(false);
    queue.setOnline(true);

    assert.deepStrictEqual(seen, [false, true]);
});

test('offline: apiFetch menandai kegagalan jaringan tanpa melempar error', async () => {
    const { apiFetch } = loadClientRuntime();

    // Kontrak offline-first: kegagalan jaringan bukan exception, tapi
    // penanda `offline: true` supaya pemanggil bisa memakai data lokal.
    const result = await apiFetch('http://127.0.0.1:1/api/tidak-ada');

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.offline, true);
    assert.strictEqual(result.status, 0);
    assert.strictEqual(result.data, null);
    assert.ok(result.error, 'pesan error harus ada');
});

test('offline: apiFetch memakai fallback bila disediakan', async () => {
    const { apiFetch } = loadClientRuntime();

    const result = await apiFetch('http://127.0.0.1:1/api/tidak-ada', {
        fallback: { status: 'success', data: [] }
    });

    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.offline, true);
    assert.deepStrictEqual(result.data, { status: 'success', data: [] });
});

test('offline: apiFetch mengirim body JSON dan mengembalikan data terparse', async () => {
    const { apiFetch } = loadClientRuntime();

    let captured = null;
    const fakeFetch = async (url, options) => {
        captured = { url, options };
        return {
            ok: true,
            status: 201,
            headers: { get: () => 'application/json' },
            json: async () => ({ status: 'success', data: { id: 1 } })
        };
    };

    const result = await apiFetch('/api/products', {
        init: {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: 'Kopi' })
        },
        fetch: fakeFetch
    });

    assert.ok(captured, 'fetch harus dipanggil');
    assert.strictEqual(captured.options.method, 'POST');
    assert.strictEqual(captured.options.body, JSON.stringify({ name: 'Kopi' }));
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.offline, false);
    assert.strictEqual(result.status, 201);
    assert.strictEqual(result.data.data.id, 1);
});

test('offline: error offline-first — antrean tetap utuh saat server gagal', async (t) => {
    const cleanup = installFakeIndexedDB();
    t.after(cleanup);

    const { IndexedDBStore, SyncQueue } = loadClientRuntime();
    const store = new IndexedDBStore({ name: 'fail_db', stores: ['syncQueue'] });
    await store.open();
    const queue = new SyncQueue({ store, storeName: 'syncQueue' });

    await queue.enqueue({ id: 'x', entity: 'product', op: 'create', payload: { name: 'X' } });

    // Sender melempar error — entri tidak boleh hilang.
    await assert.rejects(() => queue.flush(async () => {
        throw new Error('jaringan mati');
    }));

    const remaining = await queue.list();
    assert.strictEqual(remaining.length, 1, 'antrean harus utuh saat sinkronisasi gagal');
});
