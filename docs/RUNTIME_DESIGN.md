# RUNTIME DESIGN — BONANG

Dokumen desain runtime: model concurrency, HTTP, async, filesystem, network,
dan util.

Runtime Bonang ditulis dalam JavaScript CommonJS dan diekspos sebagai modul
`bonang` untuk kode Bonang. Lihat `runtime/index.js` sebagai titik masuk publik.

---

## 1. Prinsip

1. **I/O non-blocking.** Semua operasi yang bisa menunggu (database, HTTP
   keluar, file) bersifat async.
2. **Tidak ada thread-per-request.** Beban I/O ditangani oleh event loop
   Node; beban CPU-bound ditangani `WorkerPool`.
3. **Error terstruktur.** Semua error yang berasal dari
   `BonangError` atau turunannya, sehingga bisa dipetakan ke status HTTP.
4. **Aman secara default.** Akses file melewati `safeJoin`; SQL memakai
   prepared statement.

---

## 2. Model Concurrency

### 2.1 Concurrency (default)

Banyak operasi I/O tumpang tindih pada satu event loop:

```
request A ── await query() ──┐
request B ── await fetch() ──┼── event loop (single thread, non-blocking)
request C ── await file()  ──┘
```

Handler tidak pernah menjalankan operasi blocking tanpa `await`. Ini yang
membuat server Bonang melayani ribuan request paralel pada satu inti.

Bukti: `tests/concurrency` mengukur p50/p95/p99 pada 10/100/500/1000
request, dan benchmark HTTP memverifikasi bahwa request cepat tidak
terblokir request lambat (20 ms) — request cepat selesai dalam ~2 ms.

### 2.2 Parallelism (opsional)

`WorkerPool` berbasis `node:worker_threads` untuk pekerjaan CPU-bound:

```js
const pool = new WorkerPool({ size: 4 });
const result = await pool.run({ task: 'hash', payload: '...' });
```

Sifat:
- Worker dibuat lazy, dipakai ulang.
- Job diantre; worker idle mengambil job berikutnya.
- Kegagalan job dikembalikan sebagai rejection, bukan membuat worker mati.

### 2.3 Scheduler

`Scheduler` membatasi jumlah operasi async yang berjalan bersamaan
(default 64):

```js
const scheduler = new Scheduler({ concurrency: 32 });
const results = await scheduler.all(tasks);
```

Berguna saat menerima ribuan promise dari sumber tak terbatas.

---

## 3. HTTP Server

### 3.1 Komponen

| Kelas | Peran |
| --- | --- |
| `Server` | Lifecycle server, body parsing, error mapping, static serving, graceful shutdown |
| `Request` | path, query, cookies, body, `validate()`, `json()`, `field()` |
| `Response` | status, header, cookie, `json()`, `send()`, `redirect()` |
| `Router` | route, parameter, wildcard, middleware, 405 |

### 3.2 Pipeline request

```
raw req
  → new Request(raw)
  → readBody()            limit 5 MB; JSON / form / multipart marker
  → router.handle()
      → middleware global
      → middleware route
      → handler
  → result objek → JSON 200
    result null   → 204
```

Bila router melempar `NOT_FOUND` dan method GET/HEAD → `serveStatic()`
mencoba menyajikan berkas statis (TD-008).

### 3.3 Routing

```js
app.router.get('/api/products/:id', handler);
app.router.post('/api/products', handler);
app.router.get('/api/files/*', handler);   // wildcard
```

- Parameter `:name` diekstrak ke `request.params`.
- Wildcard `*` menyisakan sisanya ke `request.params.wildcard`.
- Method tidak cocok → error 405 dengan header `Allow`.
- Middleware global dijalankan sebelum route; middleware route hanya untuk
  route tersebut.

### 3.4 Validasi input

```js
const data = request.validate({
    name: { type: 'string', required: true, maxLength: 200 },
    price: { type: 'number', min: 0 },
    stock: { type: 'int', default: 0 }
});
```

Melempar `ValidationError` (400) bila melanggar.

### 3.5 Error mapping

```js
response.status(statusCode).json({
    status: 'error',
    msg: message,
    error: code,
    message,
    ...(err.details ? { details: err.details } : {}),
    ...(includeStack ? { stack: err.stack } : {})
});
```

`includeStack` hanya true bila `BONANG_ENV === 'development'` dan status
≥ 500. Detail internal selalu ditulis ke log lebih dulu.

### 3.6 Graceful shutdown

`server.close()`:
1. Set flag `isShuttingDown` → request baru dapat 503.
2. `httpServer.close()` → berhenti menerima koneksi.
3. Tunggu request berjalan sampai `shutdownTimeout` (default 10 detik).
4. Paksa hancurkan socket yang masih tertahan.

### 3.7 Static serving

```js
new Server({ staticDir: ['public', 'dist', 'dist/public'] })
```

Array dibaca berurutan. Path dinormalkan lewat `safeJoin` sehingga `..`
tidak bisa keluar folder. `/` dilayani oleh `index.html`.

---

## 4. Database

Detail di `docs/DATABASE_DESIGN.md`. Ringkas:

- `SQLitePool` dengan connection pool, WAL, `busy_timeout`.
- Prepared statement dengan placeholder positional `?` saja.
- `transaction(fn)` dengan commit/rollback dan pengembalian koneksi ke
  pool saat rollback.
- `QueryBuilder` dengan allowlist identifier dan operator.

---

## 5. Filesystem

Semua operasi melewati `safeJoin(root, ...segments)`:

```js
safeJoin(root, 'a', 'b.txt')  // path normal
safeJoin(root, '..', 'x')     // null
```

`safeFilename` menormalkan nama file dan menolak nama yang memuat
separator, `..`, atau karakter di luar `[A-Za-z0-9._-]`.

---

## 6. Network

`createHttpClient(options)`:

```js
const client = createHttpClient({ timeout: 5000, retries: 3 });
const res = await client.get('https://example.com/api');
```

Fitur:
- Timeout per request (`AbortController`).
- Retry dengan exponential backoff.
- Body JSON otomatis di-parse.

---

## 7. Security

Detail di `docs/SECURITY_DESIGN.md`. Ringkas: scrypt password hashing,
HMAC signature, token CSRF stateless, `escapeHtml`, rate limiter, session
store in-memory.

---

## 8. Core Utilities

| Fungsi | Kegunaan |
| --- | --- |
| `sleep(ms)` | Menunggu ms. |
| `delay(seconds)` | Menunggu detik. |
| `withTimeout(promise, ms)` | Membungkus promise dengan batas waktu. |
| `get(obj, 'a.b.c', fallback)` | Akses path aman. |
| `set(obj, 'a.b.c', value)` | Set path aman (menciptakan objek antara). |
| `merge(...objs)` | Merge dalam. |
| `clone(obj)` | Deep clone JSON-safe. |
| `unique(arr)` | Array unik. |
| `groupBy(arr, fn)` | Kelompokkan. |
| `clamp(v, min, max)` | Batas nilai. |

---

## 9. Logger

```js
const logger = getLogger();
logger.info('...'); logger.warn('...'); logger.error('...'); logger.debug('...');
```

Format: `2026-11-11T01:03:27.645Z [bonang] INFO pesan`. Level dapat diatur
lewat `BONANG_LOG_LEVEL`. Request lambat (> 1 detik) otomatis di-warn.

---

## 10. Client Runtime (browser)

Terpisah dari runtime Node, tapi memakai pola API serupa:

| Komponen | Peran |
| --- | --- |
| `IndexedDBStore` | CRUD data domain: `open`, `put`, `putMany`, `get`, `getAll`, `delete`, `clear` |
| `SyncQueue` | `enqueue`, `list`, `remove`, `clear`, `flush(sender)` |
| `ConnectionStatus` | Status online/offline + `subscribe` |
| `resolveConflict(local, remote, options)` | Last-write-wins dengan policy hook |
| `reconcile(localList, remoteList, options)` | Sinkronisasi daftar |
| `apiFetch(url, options)` | Fetch dengan fallback offline (tidak melempar; mengembalikan `{ ok: false, offline: true }`) |

Client runtime ditulis sebagai UMD sehingga bisa dipakai di browser tanpa
build step maupun di Node untuk testing.

---

## 11. Batasan yang Diketahui

1. `node:sqlite` sinkron — query panjang memblokir event loop.
2. Session store in-memory — hilang saat restart, tidak shared antar-instance.
3. Rate limiter in-memory — tidak terdistribusi.
4. Belum ada clustering.
5. Client runtime belum punya binding reaktif (hanya subscribe/poll).
6. Belum ada streaming response.
