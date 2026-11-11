# CHANGELOG — BONANG

Format berbasis Keep a Changelog. Versi mengikuti SemVer.

---

## [0.1.0] — 2026-11-11

Rilis pertama Bonang: transpiler, runtime, standard library, package
manager, CLI, dan aplikasi CRUD demo dengan offline-first.

### Ditambahkan

**Bahasa dan compiler**
- Lekser: token, literal (angka heksa/underscore, string, template literal),
  posisi baris/kolom, error sintaks yang reportado dengan lokasi.
- Parser Pratt: ekspresi, statement, arrow function (dengan
  backtracking untuk membedakan parens dari parameter arrow), class
  (inheritance, `interface`, `enum`, `static`, getter/setter), `import`/
  `export` (termasuk named export list), modul server/client/shared.
- Codegen: lexical scope tracking, name mangling untuk keyword
  JavaScript, kompilasi ke JavaScript.
- Bundler: graf modul -> satu berkas JS mandiri dengan `__bngRequire`
  internal; modul bawaan Node dan runtime Bonang tetap sebagai `require`
  asli.

**Runtime**
- `core/runtime.js` — `BonangError` bertingkat (Validation, Auth, Forbidden,
  NotFound, Conflict) dengan `details`, `Logger`, `sleep`/`delay`/
  `withTimeout`, utilitas `get`/`set`/`merge`/`clone`/`unique`/`groupBy`/
  `clamp`.
- `async/scheduler.js` — `Scheduler` dengan batas konkurensi (default 64),
  `withConcurrencyLimit`, dan `WorkerPool` berbasis `node:worker_threads`.
- `http/server.js` — `Server`, `Request`, `Response`; body limit 5 MB,
  graceful shutdown, pemetaan error ke status HTTP, `address()`.
- `http/router.js` — route parametrik `:name`, wildcard `*`, middleware
  global/per-route, deteksi 405.
- `database/pool.js` — `SQLitePool` dengan WAL, `foreign_keys`,
  `busy_timeout`, placeholder positional `?`, transaksi, `bulkInsert`,
  statistik akuisisi/pelepasan.
- `database/query-builder.js` — `select`/`distinct`/`where`/`whereNull`/
  `whereNotNull`/`whereIn`/`whereLike`/`whereBetween`/`whereRaw`/`join`/
  `groupBy`/`having`/`orderBy`/`limit`/`offset`/`count`/`paginate`, dengan
  allowlist identifier dan operator.
- `security/security.js` — scrypt hashing, `timingSafeEqual`, token acak,
  HMAC `sign`/`verifySignature`, CSRF, `escapeHtml`, `stripControlChars`,
  `sanitizeText`, `isEmail`, `safeFilename`/`safeJoin`, `validateUpload`,
  `RateLimiter`, `SessionStore`.
- `filesystem/files.js` — operasi file melewati `safeJoin`.
- `network/http-client.js` — klien fetch dengan timeout, retry, backoff.
- `client/client.js` — DOM helper, `IndexedDBStore`, `SyncQueue`,
  `resolveConflict`/`reconcile`, `ConnectionStatus`, `apiFetch`.
- `client/sw-cache.js` — helper invalidasi cache service worker
  **per-file** (bandingkan hash SHA-256 aset dengan `precache-manifest.json`).

**Library**
- `standard-library/index.js` — utilitas string, validasi, format,
  koleksi, ID.
- `package-manager/index.js` — manifest, lockfile, install dari registry
  npm, ekstraksi tarball manual. Tanpa dependensi eksternal.

**CLI** (`node cli/cli.js`)
- `init`, `run`, `build`, `dev`, `test`, `lint`, `audit`, `bench`,
  `migrate`, `version` — semuanya berfungsi, bukan placeholder.
- `dev-server.js` — dev server dengan hot reload via SSE.
- `linter.js` — 10 aturan analisis statis.
- `auditor.js` — 8 pemeriksaan keamanan, lima di antaranya berbasis AST.
- `migrate.js` — runner migrasi dengan tabel `bonang_migrations`, rollback.

**Aplikasi demo**
- `apps/bonang-crud-demo` — aplikasi CRUD penuh: `Product` (shared model),
  `ProductRepository`, `ProductService`, `ProductController`, SQLite
  `bonang_demo`, migrasi, frontend Bonang, service worker, IndexedDB +
  sync queue + resolusi konflik.

**Benchmark**
- `benchmarks/benchmark.js` — 5 skenario: compile, execution, database,
  http, baseline PHP/Node.

**Dokumentasi**
- `docs/ENVIRONMENT_AUDIT.md`, `TECHNICAL_DECISIONS.md`, `RISK_REGISTER.md`,
  `PRD.md`, `LANGUAGE_SPECIFICATION.md`, `ARCHITECTURE.md`, `GRAMMAR.md`,
  `COMPILER_DESIGN.md`, `RUNTIME_DESIGN.md`, `SECURITY_DESIGN.md`,
  `DATABASE_DESIGN.md`, `OFFLINE_FIRST_DESIGN.md`, `BUG_TRACKER.md`,
  `AUDIT_REPORT.md`, `PROJECT_PROGRESS.md`, `TEST_REPORT.md`,
  `KNOWN_LIMITATIONS.md`, `RELEASE_NOTES.md`, `CHANGELOG.md`.
- `benchmarks/RESULTS.md` — hasil pengukuran nyata.

**Perbaikan batasan (Fase 15)**
- Header keamanan bawaan pada HTTP server: `Content-Security-Policy`,
  `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`,
  `Permissions-Policy`. Dapat ditimpa per-route maupun per-aplikasi
  (`createServer({ securityHeaders })`), atau dinonaktifkan sepenuhnya
  dengan `securityHeaders: false`. Berlaku juga pada aset statis.
- `precache-manifest.json` dihasilkan `bonang build` — hash SHA-256 per
  aset — untuk mendukung invalidasi cache service worker per-file.
- Validasi SQL mentah pada query builder (`assertRawSql`) dan aturan
  auditor baru `sql-injection-raw` untuk `whereRaw`/`having`.
- Batas ukuran antrean sinkronisasi (default 500) dengan `QueueOverflowError`.
- Signed cookie bawaan: `signValue`/`verifySignedValue`,
  `response.signedCookie()`, `request.signedCookie()`.
- Keyset pagination: `QueryBuilder.paginateByCursor()` dengan cursor
  dua kolom (kolom utama + kolom penyeimbang) supaya halaman tidak
  melompati baris dengan nilai pengurutan yang sama.
- Sinkronisasi background: `registerBackgroundSync()` mendaftarkan tag ke
  `navigator.serviceWorker.sync`.
- Sinkronisasi antar-tab: `BroadcastSync` + `linkQueueToBroadcast()`.
- Bundler menangani siklus modul: modul didaftarkan sebelum dependensinya
  dibaca, cache modul dipakai bersama, dan codegen memakai **live binding**
  (`const _$$modN = require(...)` dibaca dari `module.exports` saat dipakai)
  supaya nilai modul siklik tidak terkunci `undefined`.
- Dynamic `import()`: node AST `ImportExpression`, helper `_$$dynamicImport`
  (mengembalikan Promise berisi namespace modul), dan modul yang diimpor
  secara dinamis ikut ter-bundle. Path harus string literal — path yang
  dihitung saat runtime ditolak saat kompilasi.
- Soft delete: `runtime/database/soft-delete.js` menyediakan
  `SoftDeleteRepository` (kolom `deleted_at`, `remove`/`restore`/`purge`,
  `countActive`/`countDeleted`, opsi `includeDeleted`) plus
  `addSoftDeleteColumn()` untuk tabel yang sudah ada. Demo app memakai
  pola yang sama: `DELETE /api/products/:id` menandai baris dan
  `POST /api/products/:id/restore` memulihkannya.
- Audit struktur: `bonang audit --structure` memeriksa siklus dependensi,
  dead code, duplikasi berkas, dan berkas oversized pada kode sumber.
  Laporan lengkap ada di `docs/AUDIT_REPORT.md`.

**Test**
- 356 test: 96 unit, 47 integrasi, 16 regresi, 28 offline, 8 konkurensi,
  47 database, 55 keamanan, 59 tooling.
- 0 test dilewati, 0 dinonaktifkan.

### Diperbaiki

Semua perbaikan tercatat penuh di `docs/BUG_TRACKER.md` (BNG-001 s.d.
BNG-048).

Selain bug, audit struktur menemukan satu duplikasi yang diperbaiki:
`assertIdentifier()` dan `IDENTIFIER_PATTERN` yang tersalin antara
`runtime/database/query-builder.js` dan `runtime/database/soft-delete.js`
sekarang sama-sama mengimpor dari `runtime/database/identifiers.js`.

Ringkasan per komponen:

| Komponen | Bug | Ringkasan |
| --- | --- | --- |
| Parser | BNG-001..009, 021, 048 | Backtracking arrow, error lokasi, `void`, deklarasi ganda, `import()` dinamis |
| Codegen | BNG-010..015, 022, 048 | `export` menimpa ekspor lain, `fn` keyword, `undefined`, reserved word, `typeof`, live binding untuk import |
| Bundler | BNG-023, 039, 048 | Entry point tidak dipanggil saat build; bundel client gagal di browser karena memakai `require`; siklus modul menyebabkan stack overflow dan `import()` dinamis tidak tersedia |
| Runtime HTTP | BNG-024, 025, 028, 040, 044 | Aset statis 404, kontrak error, beban 1000 request, tidak ada header keamanan, tidak ada signed cookie |
| Runtime core | BNG-026 | `NotFoundError`/`ConflictError` membuang `details` |
| Security | BNG-027, 044 | `timingSafeEqual` hanya menerima Buffer; cookie tanpa tanda tangan |
| Client | BNG-029, 042, 046, 047 | Entri antrean gagal permanen diulang selamanya; antrean tumbuh tanpa batas; tanpa background sync; tanpa sinkronisasi antar-tab |
| Demo app | BNG-018..020, 030 | Pool dikembalikan sebagai repository, Promise belum di-await, update parsial ditolak, route `/` |
| Auditor | BNG-031..035, 041 | Konstanta terbaca sebagai data user, `store.put` terbaca sebagai route, validasi selalu gagal, `export class` tak dikenali, `checkConfigFiles` hilang, `whereRaw`/`having` tak dianalisis |
| Query builder | BNG-036, 041, 045 | Jenis dan kondisi JOIN disisipkan tanpa validasi; SQL mentah tanpa validasi placeholder; pagination hanya offset |
| CLI scaffold | BNG-037 | Route POST hasil `bonang init` tanpa validasi input |
| Test tooling | BNG-038 | Test CLI menggantung dan gagal cleanup (proses anak belum mati) |
| Service worker | BNG-043 | Tidak ada invalidasi cache per-file |

### Diketahui

Tidak ada dependensi eksternal (`dependencies: {}`, `devDependencies: {}`).
Seluruh basis kode berjalan pada Node.js built-in saja.

Batasan lengkap ada di `docs/KNOWN_LIMITATIONS.md`.

---

## [0.0.1] — 2026-11-11

Prototipe awal: lekser, parser, dan codegen minimal.
