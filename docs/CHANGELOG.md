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
  header keamanan, graceful shutdown, pemetaan error ke status HTTP,
  `address()`.
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
- `auditor.js` — 7 pemeriksaan keamanan, empat di antaranya berbasis AST.
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

**Test**
- 257 test: 96 unit, 46 integrasi, 16 regresi, 13 offline, 8 konkurensi,
  19 database, 35 keamanan, 24 tooling.
- 0 test dilewati, 0 dinonaktifkan.

### Diperbaiki

Semua perbaikan tercatat penuh di `docs/BUG_TRACKER.md` (BNG-001 s.d.
BNG-039).

Ringkasan per komponen:

| Komponen | Bug | Ringkasan |
| --- | --- | --- |
| Parser | BNG-001..009, 021 | Backtracking arrow, error lokasi, `void`, deklarasi ganda |
| Codegen | BNG-010..015, 022 | `export` menimpa ekspor lain, `fn` keyword, `undefined`, reserved word, `typeof` |
| Bundler | BNG-023, 039 | Entry point tidak dipanggil saat build; bundel client gagal di browser karena memakai `require` |
| Runtime HTTP | BNG-024, 025, 028 | Aset statis 404, kontrak error, beban 1000 request |
| Runtime core | BNG-026 | `NotFoundError`/`ConflictError` membuang `details` |
| Security | BNG-027 | `timingSafeEqual` hanya menerima Buffer |
| Client | BNG-029 | Entri antrean gagal permanen diulang selamanya |
| Demo app | BNG-018..020, 030 | Pool dikembalikan sebagai repository, Promise belum di-await, update parsial ditolak, route `/` |
| Auditor | BNG-031..035 | Konstanta terbaca sebagai data user, `store.put` terbaca sebagai route, validasi selalu gagal, `export class` tak dikenali, `checkConfigFiles` hilang |
| Query builder | BNG-036 | Jenis dan kondisi JOIN disisipkan tanpa validasi |
| CLI scaffold | BNG-037 | Route POST hasil `bonang init` tanpa validasi input |
| Test tooling | BNG-038 | Test CLI menggantung dan gagal cleanup (proses anak belum mati) |

### Diketahui

Tidak ada dependensi eksternal (`dependencies: {}`, `devDependencies: {}`).
Seluruh basis kode berjalan pada Node.js built-in saja.

Batasan lengkap ada di `docs/KNOWN_LIMITATIONS.md`.

---

## [0.0.1] — 2026-11-11

Prototipe awal: lekser, parser, dan codegen minimal.
