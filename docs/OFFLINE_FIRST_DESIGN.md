# OFFLINE FIRST DESIGN — BONANG

Dokumen desain mode offline-first: penyimpanan lokal, antrean sinkronisasi,
resolusi konflik, service worker, dan perilaku UI saat jaringan hilang.

---

## 1. Prinsip

1. **Data tampil seketika.** Tulisan user disimpan di IndexedDB lebih dulu,
   UI langsung memperbarui — tanpa menunggu jaringan.
2. **Operasi tidak hilang.** Setiap perubahan offline masuk antrean
   sinkronisasi yang persisten.
3. **Offline adalah kondisi normal, bukan error.** API yang gagal karena
   offline mengembalikan hasil terstruktur, bukan exception.
4. **Konflik harus terlihat.** Bila server punya versi lebih baru, server
   menolak update dan mengembalikan 409 dengan data server — bukan diam-diam
   menimpa.

---

## 2. Komponen

```
┌─────────────────────────────────────────────────────┐
│                  Browser                            │
│                                                     │
│  ┌──────────────┐        ┌──────────────────────┐  │
│  │ IndexedDBStore│        │      SyncQueue       │  │
│  │  data domain  │◄──────►│  operasi pending     │  │
│  └──────────────┘        └──────────┬───────────┘  │
│                                      │ flush(sender) │
│  ┌──────────────┐                   │              │
│  │ConnectionStatus│── online/offline│              │
│  └──────────────┘                   ▼              │
│                              ┌──────────────┐       │
│                              │  apiFetch    │       │
│                              └──────────────┘       │
│                                                     │
│  ┌──────────────────────────────────────────────┐   │
│  │            Service Worker (cache shell)      │   │
│  └──────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────┘
```

| Komponen | File | Peran |
| --- | --- | --- |
| `IndexedDBStore` | `runtime/client/client.js` | Penyimpanan data domain |
| `SyncQueue` | `runtime/client/client.js` | Antrean operasi pending |
| `ConnectionStatus` | `runtime/client/client.js` | Status online/offline |
| `resolveConflict` | `runtime/client/client.js` | Last-write-wins + policy hook |
| `reconcile` | `runtime/client/client.js` | Sinkronisasi daftar lokal vs server |
| `apiFetch` | `runtime/client/client.js` | Fetch dengan fallback offline |
| Service worker | `apps/bonang-crud-demo/public/sw.js` | Cache aset untuk offline |

---

## 3. IndexedDBStore

```js
const store = new IndexedDBStore({ dbName: 'bonang_demo', version: 1 });
await store.open();
await store.put('products', product);
await store.get('products', id);
await store.getAll('products');
await store.delete('products', id);
await store.clear('products');
await store.putMany('products', list);
```

Sifat:
- `open()` membuat object store bila belum ada.
- Semua operasi mengembalikan Promise.
- Error (mis. `QuotaExceededError`) dilempar sebagai rejection — bukan
  ditelan.

Implementasi di `runtime/client/client.js` ditulis sebagai UMD sehingga bisa
dimuat di browser maupun di Node untuk testing. Test suite membuat
`FakeIndexedDB` yang meniru API IndexedDB asli
(`tests/offline/offline.test.js`).

---

## 4. SyncQueue

```js
await queue.enqueue({ type: 'create', entity: 'products', payload: {...} });
await queue.list();
await queue.remove(id);
await queue.clear();
const summary = await queue.flush(async (operation) => {
    // kirim ke server; return { ok: true } atau { ok: false, permanent: true }
});
```

### 4.1 Entri antrean

```js
{
    id: 'op-uuid',
    type: 'create' | 'update' | 'delete',
    entity: 'products',
    payload: { ... },
    createdAt: '2026-11-11T01:00:00.000Z',
    attempts: 0
}
```

### 4.2 Perilaku flush

`flush(sender)` memproses entri satu per satu:

| Hasil sender | Tindakan |
| --- | --- |
| `{ ok: true }` | Hapus entri dari antrean, `summary.applied++` |
| `{ ok: false, permanent: true }` | Hapus entri, `summary.failed++` — jangan diulang selamanya |
| `{ ok: false, permanent: false }` | Biarkan, `summary.failed++` — dicoba lagi di opportunity berikutnya |

Aturan "hapus yang gagal permanen" mencegah antrean tumbuh tanpa batas
akibat entitas yang memang sudah dihapus di server (BNG-018).

---

## 5. Resolusi Konflik

### 5.1 Last-write-wins

```js
const result = resolveConflict(local, remote, { field: 'updatedAt' });
// { winner: 'remote' | 'local', merged: {...}, conflict: true | false }
```

Aturan:
- Bandingkan timestamp `field` (default `updatedAt`).
- Yang lebih baru menang.
- Bila timestamp sama → `remote` menang (server adalah sumber kebenaran).

### 5.2 Policy kustom

```js
resolveConflict(local, remote, {
    field: 'updatedAt',
    policy: (local, remote) => ({ ...remote, price: local.price })
});
```

### 5.3 Deteksi konflik di server

Server lebih strict: ia tidak menimpa perubahan yang belum dilihat client.

```
PUT /api/products/5?baseVersion=2026-11-11T01:00:00.000Z
```

- Bila `updated_at` server == `baseVersion` → update berhasil (200).
- Bila `updated_at` server lebih baru → 409 `CONFLICT`, body:

```json
{
    "status": "error",
    "msg": "Produk 5 sudah diubah di server sejak versi 2026-11-11T01:00:00.000Z",
    "error": "CONFLICT",
    "details": {
        "server": { "id": 5, "price": 99000, "updatedAt": "..." },
        "baseVersion": "2026-11-11T01:00:00.000Z"
    }
}
```

Client memakai `details.server` untuk menampilkan diff dan meminta pilihan
user — LWW di server hanya berlaku bila client tidak mengirim
`baseVersion`.

---

## 6. reconcile

```js
const result = reconcile(localList, remoteList, { field: 'updatedAt' });
// { items: [...], conflicts: [...] }
```

- Untuk setiap entitas remote: cari pasangan lokal.
- Pasangan mengikuti aturan `resolveConflict`.
- Entitas remote tanpa pasangan lokal → masuk `items` sebagai tambahan.
- Entitas dengan versi berbeda → masuk `conflicts`.

Dipakai untuk sinkronisasi penuh saat aplikasi dibuka kembali.

---

## 7. Status Koneksi

```js
const status = new ConnectionStatus();
status.subscribe((online) => { /* ... */ });
status.setOnline(true);
status.update(navigator.onLine);
```

API `subscribe` mengembalikan fungsi unsubscribe.

---

## 8. apiFetch

```js
const result = await apiFetch('/api/products');
if (result.offline) {
    // fallback ke IndexedDB
}
```

Kontrak:

| Situasi | Hasil |
| --- | --- |
| Sukses | `{ ok: true, status, data }` |
| HTTP error | `{ ok: false, status, error }` |
| Jaringan gagal | `{ ok: false, offline: true }` |

**`apiFetch` tidak pernah melempar exception.** Ini disengaja: pemanggil
selalu punya jalur yang jelas untuk kondisi offline maupun error server.

---

## 9. Service Worker

`apps/bonang-crud-demo/public/sw.js`:

- **Aset statis** (HTML, CSS, JS client): cache-first — instantiation
  offline terjamin.
- **API**: network-first — data selalu segar bila online.
- Versi cache di-key pada build sehingga aset basi bisa di-invalidate.

Service worker terdaftar dari client bootstrap:

```js
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js');
}
```

---

## 10. Alur End-to-End

### 10.1 Create saat online

```
User → POST /api/products → 201 → IndexedDBStore.put() → selesai
```

### 10.2 Create saat offline

```
User → apiFetch gagal → { ok:false, offline:true }
     → IndexedDBStore.put()        (data langsung tampil)
     → SyncQueue.enqueue()        (operasi tercatat)
     → UI menandai "menunggu sinkron"
```

### 10.3 Flush saat kembali online

```
ConnectionStatus → online
  → SyncQueue.flush(sender)
      → untuk tiap entri:
          sender(operation) → server
            201/200 → remove dari antrean
            409    → conflict: simpan details.server, tandai entri
            400    → permanent: remove dari antrean (tidak akan berhasil)
            5xx/network → biarkan, coba lagi nanti
```

---

## 11. Pengujian

`tests/offline/offline.test.js` — 28 test:

- `IndexedDBStore`: open, put, get, getAll, delete, clear, putMany.
- `SyncQueue`: enqueue, list, remove, clear, flush sukses, flush dengan
  kegagalan, flush pada antrean kosong tidak memanggil sender.
- `resolveConflict`: remote lebih baru menang, local lebih baru menang,
  entri tanpa `updated_at` tidak menimpa data server.
- `reconcile`: entitas baru, entri sama, konflik tercatat.
- `ConnectionStatus`: subscribe/unsubscribe, setOnline.
- `apiFetch`: jalur offline mengembalikan `{ ok:false, offline:true }`
  tanpa melempar, memakai fallback bila disediakan, mengirim body JSON dan
  mengembalikan data terparse.
- Batas antrean: entri ditolak saat penuh, entri dengan `id` sama menimpa
  tanpa melewati batas, batas default bernilai wajar, antrean bisa
  ditambah lagi setelah entri dihapus.
- Background sync: `registerBackgroundSync` mendaftarkan tag ke service
  worker, melaporkan tidak didukung tanpa melempar, dan melaporkan galat
  pendaftaran.
- Sinkronisasi antar-tab: `BroadcastSync` mengirim pesan ke tab lain, tidak
  mengirim ke dirinya sendiri, tetap bisa dibuat tanpa dukungan
  `BroadcastChannel`; `linkQueueToBroadcast` menyiarkan perubahan antrean,
  memberi tahu tab lain saat entri dihapus, memanggil `onRemoteChange`, dan
  bisa dilepas mengembalikan antrean apa adanya.

---

## 12. Batasan yang Diketahui

1. Resolusi konflik di client LWW, bukan CRDT — edit satu perangkat bisa
   hilang bila dua perangkat offline mengedit entitas yang sama.
2. IndexedDB store tidak dienkripsi.
3. Background Sync hanya didukung Chromium (L-32) — Firefox dan Safari
   belum menerapkannya, jadi di browser non-Chromium sinkronisasi tetap
   bergantung pada flush manual.
4. `BroadcastChannel` hanya bekerja same-origin (L-33) — sinkronisasi
   antar-tab lintas origin tidak bisa.

Yang **sudah** ditangani:

- **Invalidasi cache service worker per-file.** `bonang build` menghasilkan
  `precache-manifest.json` (hash SHA-256 per aset) dan `CacheInvalidator`
  menyediakan `prune`, `matchFresh`, dan `store` (L-20, BNG-043).
- **Batas ukuran antrean sinkronisasi.** Default 500 operasi; operasi
  melebihi batas ditolak dengan `QueueOverflowError`, dan hidrasi antrean
  dari IndexedDB dihitung dalam batas itu (L-22, BNG-042).
- **Sinkronisasi background.** `registerBackgroundSync()` mendaftarkan tag
  ke `navigator.serviceWorker.sync` dan melaporkan status tanpa melempar
  (L-23, BNG-046).
- **Sinkronisasi antar-tab.** `BroadcastSync` + `linkQueueToBroadcast()`
  menyiarkan perubahan antrean ke tab lain di origin yang sama
  (L-24, BNG-047).
