'use strict';

/**
 * Runtime client Bonang.
 *
 * Berjalan di browser. Menyediakan:
 *  - helper DOM (query, render, event)
 *  - store IndexedDB untuk data offline
 *  - antrean sinkronisasi (sync queue) dengan resolusi konflik
 *  - pembungkus fetch yang tetap bekerja saat offline
 *  - pendaftaran service worker
 *
 * Modul ini ditulis sebagai CommonJS agar bisa dipakai oleh compiler saat
 * pengujian di Node, dan dibundel menjadi script browser oleh `bonang build`.
 */

(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.Bonang = factory();
    }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    // ===== DOM =====

    /**
     * Ambil elemen berdasarkan selector.
     */
    function $(selector, root) {
        const scope = root || document;
        return scope.querySelector(selector);
    }

    /**
     * Ambil semua elemen berdasarkan selector sebagai array.
     */
    function $$(selector, root) {
        const scope = root || document;
        return Array.prototype.slice.call(scope.querySelectorAll(selector));
    }

    /**
     * Buat elemen dengan atribut dan anak.
     */
    function el(tag, attrs, children) {
        const node = document.createElement(tag);
        if (attrs) {
            for (const key of Object.keys(attrs)) {
                if (key === 'class') node.className = attrs[key];
                else if (key === 'text') node.textContent = attrs[key];
                else if (key.startsWith('on') && typeof attrs[key] === 'function') {
                    node.addEventListener(key.slice(2).toLowerCase(), attrs[key]);
                } else if (attrs[key] !== null && attrs[key] !== undefined) {
                    node.setAttribute(key, attrs[key]);
                }
            }
        }
        if (children) {
            const list = Array.isArray(children) ? children : [children];
            for (const child of list) {
                if (child === null || child === undefined) continue;
                node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
            }
        }
        return node;
    }

    /**
     * Escaping HTML — wajib dipakai sebelum menyisipkan data dinamis.
     */
    function escapeHtml(value) {
        if (value === null || value === undefined) return '';
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    /**
     * Pasang listener dan kembalikan fungsi untuk melepaskannya.
     */
    function on(target, event, handler) {
        target.addEventListener(event, handler);
        return () => target.removeEventListener(event, handler);
    }

    // ===== INDEXEDDB =====

    /**
     * Pembungkus IndexedDB berbasis promise.
     *
     * Dipakai untuk menyimpan salinan lokal data server sehingga aplikasi
     * tetap bisa dibaca saat perangkat offline.
     */
    class IndexedDBStore {
        constructor(options = {}) {
            this.name = options.name || 'bonang';
            this.version = options.version || 1;
            this.stores = options.stores || ['entities'];
            this.db = null;
        }

        /** Buka database dan buat object store bila belum ada. */
        async open() {
            if (this.db) return this.db;
            const request = indexedDB.open(this.name, this.version);
            this.db = await new Promise((resolve, reject) => {
                request.onupgradeneeded = () => {
                    const db = request.result;
                    for (const store of this.stores) {
                        if (!db.objectStoreNames.contains(store)) {
                            const os = db.createObjectStore(store, { keyPath: 'id' });
                            os.createIndex('updated_at', 'updated_at', { unique: false });
                        }
                    }
                };
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
            });
            return this.db;
        }

        /**
         * Jalankan operasi pada object store.
         */
        async tx(storeName, mode, operation) {
            const db = await this.open();
            return new Promise((resolve, reject) => {
                const tx = db.transaction(storeName, mode);
                const store = tx.objectStore(storeName);
                let result;
                try {
                    result = operation(store);
                } catch (err) {
                    reject(err);
                    return;
                }
                tx.oncomplete = () => resolve(result && result.result !== undefined ? result.result : result);
                tx.onerror = () => reject(tx.error);
                tx.onabort = () => reject(tx.error || new Error('Transaksi dibatalkan'));
            });
        }

        /** Simpan satu entitas. */
        async put(storeName, value) {
            return this.tx(storeName, 'readwrite', (store) => store.put(value));
        }

        /** Simpan banyak entitas dalam satu transaksi. */
        async putMany(storeName, values) {
            return this.tx(storeName, 'readwrite', (store) => {
                for (const value of values) store.put(value);
                return { changes: values.length };
            });
        }

        /** Ambil entitas berdasarkan id. */
        async get(storeName, id) {
            return this.tx(storeName, 'readonly', (store) => store.get(id));
        }

        /** Ambil seluruh entitas. */
        async getAll(storeName) {
            const result = await this.tx(storeName, 'readonly', (store) => store.getAll());
            return result || [];
        }

        /** Hapus entitas. */
        async delete(storeName, id) {
            return this.tx(storeName, 'readwrite', (store) => store.delete(id));
        }

        /** Kosongkan object store. */
        async clear(storeName) {
            return this.tx(storeName, 'readwrite', (store) => store.clear());
        }
    }

    // ===== SYNC QUEUE =====

    /**
     * Batas default jumlah entri dalam antrean sinkronisasi.
     *
     * Nilai 500 cukup untuk pemakaian normal (perubahan offline berhari-hari
     * pada satu perangkat) sekaligus membatasijejak penyimpanan lokal bila
     * server tidak pernah bisa dihubungi.
     */
    const DEFAULT_QUEUE_MAX_SIZE = 500;

    /**
     * Dilempar saat antrean sinkronisasi sudah penuh.
     */
    class QueueOverflowError extends Error {
        constructor(message, details = {}) {
            super(message);
            this.name = 'QueueOverflowError';
            this.code = 'QUEUE_OVERFLOW';
            this.details = details;
        }
    }

    /**
     * Antrean perubahan lokal yang menunggu dikirim ke server.
     *
     * Setiap entri antrean: { id, entity, op, payload, baseVersion, timestamp }
     * `op` berisi 'create', 'update', 'delete'.
     *
     * Antrean punya batas ukuran (`maxSize`, default 500) agar tidak tumbuh
     * tak terbatas ketika server terus gagal menerima perubahan. Saat batas
     * tercapai, `enqueue` melempar `QueueOverflowError` alih-alih menerima
     * perubahan baru — membiarkan antrean membengkak akan memenuhi
     * penyimpanan lokal dan membuat sinkronisasi tidak pernah selesai.
     * Aplikasi boleh menangkap galat ini dan memberi tahu pengguna.
     */
    class SyncQueue {
        constructor(options = {}) {
            this.store = options.store;
            this.storeName = options.storeName || 'syncQueue';
            this.maxSize = Number.isFinite(options.maxSize) && options.maxSize > 0
                ? Math.floor(options.maxSize)
                : DEFAULT_QUEUE_MAX_SIZE;
            this.hydrated = false;
            this.pending = new Map();
            this.online = typeof navigator !== 'undefined' ? navigator.onLine !== false : true;
            this.listeners = [];
            if (typeof window !== 'undefined') {
                window.addEventListener('online', () => this.setOnline(true));
                window.addEventListener('offline', () => this.setOnline(false));
            }
        }

        /** Daftarkan callback yang dipanggil saat status berubah. */
        subscribe(fn) {
            this.listeners.push(fn);
            return () => {
                this.listeners = this.listeners.filter((l) => l !== fn);
            };
        }

        setOnline(value) {
            this.online = value;
            for (const fn of this.listeners) fn(value);
        }

        /**
         * Masukkan operasi ke antrean. Identitas id dipakai sebagai kunci
         * sehingga perubahan berulang pada entitas yang sama saling menimpa.
         *
         * Melempar `QueueOverflowError` bila antrean sudah penuh dan entri
         * baru bukan penggantian entri yang sudah ada.
         */
        async enqueue(operation) {
            const id = operation.id || `${operation.entity}:${operation.op}:${Date.now()}`;

            // Hidrasi sekali dari penyimpanan. Tanpa ini, batas ukuran bisa
            // dilewati karena `this.pending` masih kosong padahal IndexedDB
            // sudah berisi banyak entri dari sesi sebelumnya. Hidrasi
            // dilakukan sekali saja supaya biaya enqueue tetap konstan.
            if (this.store && !this.hydrated) {
                const rows = await this.store.getAll(this.storeName);
                this.pending.clear();
                for (const row of rows) this.pending.set(row.id, row);
                this.hydrated = true;
            }

            const entry = {
                id,
                entity: operation.entity,
                op: operation.op,
                payload: operation.payload || null,
                baseVersion: operation.baseVersion || null,
                timestamp: operation.timestamp || new Date().toISOString()
            };

            // Entri dengan id yang sama menimpa yang lama — tidak menambah
            // panjang antrean, jadi tidak bisa melewati batas.
            const isReplacement = this.pending.has(id);

            if (!isReplacement && this.pending.size >= this.maxSize) {
                throw new QueueOverflowError(
                    `Antrean sinkronisasi penuh (${this.maxSize} entri). ` +
                    'Selesaikan sinkronisasi sebelum menambah perubahan baru.',
                    { maxSize: this.maxSize, id }
                );
            }

            this.pending.set(id, entry);
            if (this.store) {
                await this.store.put(this.storeName, entry);
            }
            return entry;
        }

        /** Ambil seluruh entri antrean (dari memori, atau IndexedDB). */
        async list() {
            if (this.store) {
                const rows = await this.store.getAll(this.storeName);
                this.pending.clear();
                for (const row of rows) this.pending.set(row.id, row);
            }
            return [...this.pending.values()].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
        }

        /** Hapus entri yang sudah berhasil disinkronkan. */
        async remove(id) {
            this.pending.delete(id);
            if (this.store) await this.store.delete(this.storeName, id);
        }

        /** Kosongkan antrean. */
        async clear() {
            this.pending.clear();
            if (this.store) await this.store.clear(this.storeName);
        }

        /**
         * Kirim antrean ke server.
         *
         * `sender` menerima array entri dan mengembalikan array hasil
         * per entri: { id, status: 'applied' | 'conflict' | 'failed', ... }.
         */
        async flush(sender) {
            const entries = await this.list();
            if (entries.length === 0) return { sent: 0, applied: 0, conflicted: 0, failed: 0 };

            const results = await sender(entries);
            const summary = { sent: entries.length, applied: 0, conflicted: 0, failed: 0 };

            for (const result of results || []) {
                if (result.status === 'applied') {
                    summary.applied += 1;
                    await this.remove(result.id);
                } else if (result.status === 'conflict') {
                    summary.conflicted += 1;
                    // Konflik tidak dihapus: pengguna harus memutuskan.
                } else {
                    summary.failed += 1;
                    // Entri yang gagal permanen (validasi, entitas hilang)
                    // dibuang agar tidak diulang selamanya. Entri dengan
                    // status lain yang mungkin bersifat sementara tetap
                    // dibiarkan supaya opportunity berikutnya mencoba lagi.
                    if (result.permanent !== false) {
                        await this.remove(result.id);
                    }
                }
            }
            return summary;
        }
    }

    // ===== KONFLIK =====

    /**
     * Resolusi konflik last-write-wins berbasis `updated_at`.
     *
     * `local` menang bila timestamp-nya lebih baru, selain itu `remote` menang.
     */
    function resolveConflict(local, remote, options = {}) {
        const field = options.field || 'updated_at';
        const localTime = local && local[field] ? Date.parse(local[field]) : 0;
        const remoteTime = remote && remote[field] ? Date.parse(remote[field]) : 0;

        if (localTime > remoteTime) {
            return { winner: 'local', merged: { ...remote, ...local }, conflict: true };
        }
        return { winner: 'remote', merged: remote, conflict: localTime !== remoteTime };
    }

    /**
     * Gabungkan daftar entitas lokal dan remote dengan resolusi konflik.
     */
    function reconcile(localList, remoteList, options = {}) {
        const map = new Map();
        for (const item of remoteList || []) map.set(item.id, item);

        const conflicts = [];
        for (const item of localList || []) {
            const remote = map.get(item.id);
            if (!remote) {
                map.set(item.id, item);
                continue;
            }
            const resolved = resolveConflict(item, remote, options);
            if (resolved.conflict) conflicts.push({ id: item.id, local: item, remote });
            map.set(item.id, resolved.merged);
        }

        return { items: [...map.values()], conflicts };
    }

    // ===== SINKRONISASI LATAR BELAKANG =====

    /**
     * API Background Sync browser.
     *
     * Dijaga agar modul ini tetap bisa dimuat di Node (test) dan di
     * browser tanpa error ketika API-nya tidak ada.
     */
    function getBackgroundSyncManager() {
        if (typeof navigator === 'undefined') return null;
        const scope = navigator.serviceWorker;
        if (!scope || !('sync' in scope)) return null;
        return scope.sync;
    }

    /**
     * Daftarkan sinkronisasi latar belakang untuk service worker.
     *
     * Background Sync membiarkan service worker menjalankan sinkronisasi
     * nanti — misalnya saat koneksi kembali tersedia — tanpa perlu tab
     * aplikasi tetap terbuka.
     *
     * Mengembalikan `{ supported, registered, error }`. Tidak pernah
     * melempar: kemampuan ini bersifat opsional dan browser yang tidak
     * mendukungnya harus tetap bisa memakai sinkronisasi manual.
     */
    async function registerBackgroundSync(tag = 'bonang-sync', options = {}) {
        const manager = getBackgroundSyncManager();
        if (!manager) {
            return { supported: false, registered: false, reason: 'Background Sync tidak didukung' };
        }
        try {
            await manager.register(tag, options);
            return { supported: true, registered: true, tag };
        } catch (err) {
            return { supported: true, registered: false, tag, error: err.message };
        }
    }

    /**
     * Klien BroadcastChannel untuk sinkronisasi antar-tab.
     *
     * Tanpa ini, dua tab yang terbuka bisa saling menimpa perubahan
     * lokal karena keduanya bekerja dari salinan antrean yang berbeda.
     * Dengan BroadcastChannel, satu tab memberi tahu tab lain ketika
     * entri antrean berubah, sehingga tab lain bisa memuat ulang
     * state-nya (atau memicu flush).
     *
     * Bila `BroadcastChannel` tidak tersedia (browser lama, atau Node
     * tanpa flag), kelas tetap bisa dibuat — hanya tidak ada kanal yang
     * terpakai, dan `post()` menjadi no-op.
     */
    class BroadcastSync {
        constructor(options = {}) {
            this.channelName = options.channelName || 'bonang-sync';
            this.listeners = [];
            this.channel = null;
            this.supported = false;

            if (typeof BroadcastChannel !== 'undefined') {
                this.channel = new BroadcastChannel(this.channelName);
                this.supported = true;
                this.channel.onmessage = (event) => {
                    const data = event && event.data;
                    if (!data || typeof data.type !== 'string') return;
                    for (const fn of this.listeners) {
                        try {
                            fn(data);
                        } catch {
                            // Satu listener yang gagal tidak boleh
                            // menghentikan listener lain.
                        }
                    }
                };
            }
        }

        /**
         * Daftarkan callback yang dipanggil saat pesan antar-tab diterima.
         */
        subscribe(fn) {
            this.listeners.push(fn);
            return () => {
                this.listeners = this.listeners.filter((l) => l !== fn);
            };
        }

        /**
         * Kirim pesan ke tab lain.
         */
        post(type, payload = {}) {
            if (!this.channel) return false;
            this.channel.postMessage({ type, payload, timestamp: new Date().toISOString() });
            return true;
        }

        /** Tutup kanal. */
        close() {
            if (this.channel) {
                this.channel.close();
                this.channel = null;
                this.supported = false;
            }
        }
    }

    /**
     * Hubungkan antrean sinkronisasi dengan sinkronisasi antar-tab.
     *
     * Setiap perubahan antrean disiarkan ke tab lain. Tab lain yang
     * menerima broadcast tahu ada perubahan dan bisa memuat ulang
     * antrean (atau langsung flush).
     *
     * @param {SyncQueue} queue
     * @param {BroadcastSync} bus
     * @param {object} options { onRemoteChange } callback saat tab lain berubah.
     */
    function linkQueueToBroadcast(queue, bus, options = {}) {
        if (!queue || !bus) return () => {};

        const originalEnqueue = queue.enqueue.bind(queue);
        const originalRemove = queue.remove.bind(queue);

        queue.enqueue = async (operation) => {
            const entry = await originalEnqueue(operation);
            bus.post('queue:changed', { action: 'enqueue', id: entry.id, entity: entry.entity });
            return entry;
        };

        queue.remove = async (id) => {
            await originalRemove(id);
            bus.post('queue:changed', { action: 'remove', id });
        };

        const unsubscribe = bus.subscribe((message) => {
            if (message.type !== 'queue:changed') return;
            if (options.onRemoteChange) options.onRemoteChange(message.payload || {});
        });

        return () => {
            queue.enqueue = originalEnqueue;
            queue.remove = originalRemove;
            unsubscribe();
        };
    }

    // ===== NETWORK =====

    /**
     * Pembungkus fetch yang mengembalikan status offline alih-alih melempar
     * error jaringan. `fallback` dipakai bila request gagal.
     */
    async function apiFetch(url, options = {}) {
        const fetchImpl = options.fetch || (typeof fetch !== 'undefined' ? fetch.bind(globalThis) : null);
        if (!fetchImpl) {
            return { ok: false, offline: true, status: 0, data: null, error: 'fetch tidak tersedia' };
        }
        try {
            const response = await fetchImpl(url, options.init || {});
            let data = null;
            const contentType = response.headers.get('content-type') || '';
            if (contentType.includes('application/json')) {
                data = await response.json();
            } else {
                data = await response.text();
            }
            return { ok: response.ok, offline: false, status: response.status, data };
        } catch (err) {
            if (typeof options.fallback !== 'undefined') {
                return { ok: true, offline: true, status: 0, data: options.fallback, error: err.message };
            }
            return { ok: false, offline: true, status: 0, data: null, error: err.message };
        }
    }

    /**
     * Daftarkan service worker untuk mendukung offline.
     */
    async function registerServiceWorker(url, options = {}) {
        if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
            return { registered: false, reason: 'service worker tidak didukung' };
        }
        try {
            const registration = await navigator.serviceWorker.register(url, options.scope ? { scope: options.scope } : undefined);
            return { registered: true, registration };
        } catch (err) {
            return { registered: false, error: err.message };
        }
    }

    // ===== STATUS =====

    /**
     * Lacak status koneksi untuk ditampilkan di UI.
     */
    class ConnectionStatus {
        constructor() {
            this.listeners = [];
            this.online = typeof navigator !== 'undefined' ? navigator.onLine !== false : true;
            if (typeof window !== 'undefined') {
                window.addEventListener('online', () => this.update(true));
                window.addEventListener('offline', () => this.update(false));
            }
        }
        subscribe(fn) {
            this.listeners.push(fn);
            fn(this.online);
            return () => {
                this.listeners = this.listeners.filter((l) => l !== fn);
            };
        }
        update(value) {
            this.online = value;
            for (const fn of this.listeners) fn(value);
        }
    }

    return {
        $,
        $$,
        el,
        escapeHtml,
        on,
        IndexedDBStore,
        SyncQueue,
        QueueOverflowError,
        DEFAULT_QUEUE_MAX_SIZE,
        resolveConflict,
        reconcile,
        apiFetch,
        registerServiceWorker,
        ConnectionStatus,
        registerBackgroundSync,
        BroadcastSync,
        linkQueueToBroadcast
    };
});
