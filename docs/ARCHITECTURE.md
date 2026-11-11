# ARCHITECTURE — BONANG

Dokumen arsitektur tingkat sistem. Menjawab: apa saja komponennya, bagaimana
alur data mengalir, dan mengapa batas-batas modul dipilih seperti itu.

---

## 1. Gambaran Besar

```
                    ┌─────────────────────────────────────────┐
                    │            Kode pengguna (.bng)        │
                    └───────────────────┬─────────────────────┘
                                        │
                    ┌───────────────────▼─────────────────────┐
                    │              COMPILER                    │
                    │  Lexer → Parser(Pratt) → AST → Codegen  │
                    └───────────────────┬─────────────────────┘
                                        │  JavaScript
                    ┌───────────────────▼─────────────────────┐
                    │              BUNDLER                    │
                    │  Graf modul → satu file mandiri        │
                    └───────────────────┬─────────────────────┘
                        ┌───────────────┴───────────────┐
                        │                               │
             ┌──────────▼─────────┐         ┌───────────▼──────────┐
             │  Bundle server     │         │  Bundle client      │
             │  (Node.js)         │         │  (browser)          │
             └──────────┬─────────┘         └───────────┬──────────┘
                        │                               │
             ┌──────────▼─────────┐         ┌───────────▼──────────┐
             │  RUNTIME (Node)    │         │  RUNTIME (browser)   │
             │  HTTP, DB, Async,  │         │  IndexedDB, SyncQ,  │
             │  Filesystem, Sec   │         │  DOM, ServiceWorker │
             └──────────┬─────────┘         └───────────┬──────────┘
                        │                               │
             ┌──────────▼─────────┐         ┌───────────▼──────────┐
             │  SQLite / File     │         │  IndexedDB           │
             └────────────────────┘         └──────────────────────┘
```

---

## 2. Peta Komponen

```
compiler/
  compiler.js           Driver: compile(source) → { code, ast, diagnostics }
  lexer/tokenizer.js    Keyword, operator, punctuator
  lexer/lexer.js        Token stream, template literal, escape
  parser/parser.js      Pratt parser + backtracking
  ast/nodes.js          37 node class
  codegen/generator.js  AST → JavaScript, scope tracking
  bundler.js            Module graph → self-contained JS

runtime/
  core/runtime.js       Error hierarchy, Logger, util, sleep/withTimeout
  async/scheduler.js    Scheduler (concurrency cap), WorkerPool (parallelism)
  http/server.js        Server, Request, Response, static serving
  http/router.js        Params, wildcard, middleware, 405
  database/pool.js      SQLitePool: WAL, busy_timeout, pooling, transactions
  database/query-builder.js  Safe identifier/operator allowlist
  filesystem/files.js   safeJoin-bypassed file operations
  network/http-client.js  fetch + timeout + retry + backoff
  security/security.js  scrypt, HMAC, CSRF, escapeHtml, RateLimiter, Session
  client/client.js      Browser runtime (UMD): IndexedDB, SyncQueue, SW

standard-library/index.js  strings, validation, format, collections, ids
package-manager/index.js   Manifest, lockfile, install from npm registry
cli/
  cli.js                init, run, build, dev, test, lint, audit, bench,
                        migrate, version
  dev-server.js         Hot reload via SSE
  linter.js             9 static rules
  auditor.js            6 security checks
  migrate.js            Migration runner + rollback
benchmarks/benchmark.js 5 scenarios + PHP/Node baselines
```

---

## 3. Alur Kompilasi

```
source (.bng)
   │
   ├─► Lexer ──────────► token[]
   │                       (template literal dipecah jadi quasi + source)
   │
   ├─► Parser (Pratt) ──► AST
   │     • precedence climbing untuk binary/ternary
   │     • tryParseArrowParams() untuk disambiguasi '('
   │
   ├─► Codegen ─────────► JavaScript source
   │     • Scope chain: declare / lookup / pickName
   │     • rename variabel bila bentrok dengan nama JS global
   │
   └─► { code, ast, diagnostics }
```

### 3.1 Scope tracking

Codegen menyimpan `Scope` dengan rantai parent. Setiap variabel yang
dideklarasikan diberi nama unik bila berbenturan dengan nama bawaan JS
(`name`, `length`, `top`, `event`, `location`, `default`, `class`,
`function`). `lookup()` menelusuri rantai; `pickName()` memilih nama
aman.

Ini yang membuat `let name = "x"` berfungsi di browser tanpa merusak
`window.name`.

### 3.2 Bridge modul built-in

`require("bonang")` di dalam kode Bonang diarahkan ke runtime JavaScript:

| Specifier | Target |
| --- | --- |
| `bonang` | `runtime/index.js` |
| `bonang/runtime` | `runtime/index.js` |
| `bonang/client` | `runtime/client/client.js` |
| `bonang/std` | `standard-library/index.js` |

Ini yang membuat Bridge ini adalah keputusan arsitektur sementara sampai
runtime Bonang murni siap. Ini tercatat di Known Limitations.

---

## 4. Alur Build

```
bonang build
   │
   ├─► Baca bonang.config.json
   │     { entry, out, static, targets }
   │
   ├─► Target "server"
   │     ├─► Graz modul dari entry (import statis)
   │     ├─► Kompilasi tiap modul → JS
   │     ├─► Tulis bundle: __bngRequire + register modul
   │     ├─► Salin runtime ke dist/runtime
   │     └─► Panggil entry.main() bila ada
   │
   ├─► Target "client"
   │     ├─► Modul di src/client + src/shared
   │     ├─► Bundle browser
   │     └─► Salin aset statis ke dist/public
   │
   └─► Laporan: jumlah modul, ukuran output
```

### 4.1 Bundler

Bundler membangun graf modul dari import statis. Modul Bonang di-register ke `__bngRequire`; modul Node built-in dan runtime Bonang tetap
dipanggil lewat `require` asli.

Entry bundle memanggil `main()` bila ekspor tersebut ada, dan menangkap
promise yang dikembalikan agar rejections tidak hilang.

---

## 5. Arsitektur Runtime

### 5.1 Error hierarchy

```
Error
 └── BonangError (code, statusCode, details)
      ├── ValidationError   400
      ├── AuthError         401
      ├── ForbiddenError    403
      ├── NotFoundError     404
      └── ConflictError     409
```

`handleError` memetakan ke respons `{ status, msg, error, message, details? }`
dan menulis detail lengkap ke log. Stack hanya di
`BONANG_ENV=development`.

### 5.2 HTTP server

Pipeline satu request:

```
raw req
  → Request (path, query, cookies, body)
  → readBody (limit 5 MB, parse JSON / form / multipart marker)
  → router.handle(request)
      → middleware global
      → middleware per-route
      → handler
  → hasil: objek biasa → JSON, atau null → 204
```

Bila router melempar `NOT_FOUND` dan method GET/HEAD, `serveStatic()`
mencoba menyajikan berkas dari `staticDir` (bisa array beberapa folder).

### 5.3 Database

```
SQLitePool
  ├── acquire()  → antrean bila koneksi habis
  ├── execute(sql, params)   prepared, positional ?
  ├── query / queryOne
  ├── transaction(fn)  → BEGIN/COMMIT/ROLLBACK
  ├── bulkInsert(table, columns, rows)
  └── getStats()
```

PRAGMA yang diaktifkan: `journal_mode=WAL`, `foreign_keys=ON`,
`busy_timeout=5000`.

### 5.4 Concurrency

- `Scheduler` — batas konkurensi default 64, untuk I/O paralel.
- `WorkerPool` — `node:worker_threads`, untuk CPU-bound.

Keduanya sudah dipakai: scheduler untuk operasi I/O, worker pool tersedia
untuk beban CPU-bound.

---

## 6. Arsitektur Client / Offline-First

```
Browser
 ├── Client runtime (UMD)
 │    ├── IndexedDBStore  — cache data domain
 │    ├── SyncQueue       — operasi yang belum terkirim
 │    ├── ConnectionStatus — status online/offline
 │    ├── resolveConflict — last-write-wins + policies
 │    ├── reconcile       — sinkronisasi daftar lokal vs server
 │    └── apiFetch        — fetch dengan fallback offline
 └── Service Worker
      ├── cache shell (HTML, CSS, JS)
      └── network-first untuk API
```

Alur write saat offline:

```
User action
  → IndexedDBStore.put()   (data langsung tampil)
  → SyncQueue.enqueue()    (operasi dicatat)
  → saat online: SyncQueue.flush(sender)
      → sukses: remove dari antrean
      → gagal permanen: remove (jangan diulang selamanya)
      → gagal sementara: biarkan untuk dicoba lagi
```

Konflik: server menerima `baseVersion`; bila `updated_at` server lebih
baru, server mengembalikan 409 `CONFLICT` dengan `details.server`.

---

## 7. Strategi Multi-Target

| Aspek | Server | Client |
| --- | --- | --- |
| Entry default | `src/server/main.bng` | `src/client/main.bng` |
| Output | `dist/server.js` | `dist/client.js` |
| Runtime | `runtime/` Node | `runtime/client/client.js` |
| API yang boleh dipakai | `node:*`, filesystem, DB | DOM, IndexedDB, fetch |

Folder `src/shared/` masuk ke kedua bundle.

---

## 8. Tooling

| Tool | Tanggung jawab |
| --- | --- |
| `cli/cli.js` | Orkestrasi perintah |
| `cli/linter.js` | 9 aturan statis |
| `cli/auditor.js` | 6 pemeriksaan keamanan |
| `cli/migrate.js` | Runner migrasi + rollback |
| `cli/dev-server.js` | Dev server + hot reload (SSE) |
| `benchmarks/benchmark.js` | 5 skenario + baseline PHP/Node |
| `package-manager/index.js` | Manifest, lockfile, install |

---

## 9. Aturan yang Ditegakkan Sistem-wide

1. Tidak ada input user yang masuk ke string SQL.
2. Semua akses file melewati `safeJoin`.
3. Semua respons error berbentuk `{ status, msg, ... }`.
4. Semua write path punya handler error; tidak ada exception yang ditelan diam-diam.
5. Semua klaim performa harus berasal dari pengukuran, bukan estimasi.
6. Nol dependensi npm.

---

## 10. Batas Arsitektur yang Diketahui

- Runtime Bonang masih berupa JavaScript yang diekspos lewat bridge (lihat
  §3.2).
- Tidak ada clustering; satu proses per server.
- Bundler hanya menangani import statis.
- Type checker belum ada.
