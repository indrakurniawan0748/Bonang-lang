# PROJECT PROGRESS — BONANG

Status language tracking. Persentase hanya naik bila pekerjaan benar-benar
selesai dan terverifikasi oleh test yang dijalankan.

Status yang dipakai: `Pending`, `In Progress`, `Blocked`, `Testing`,
`Failed`, `Completed`.

**Status terakhir**: 2026-11-11
**Test**: 356 lulus / 0 gagal / 0 dilewati
**Bug**: 47 tercatat / 48 Fixed / 0 Open
**Audit statis**: 0 temuan pada kode referensi

---

## 1. Ringkasan Per Fase

| Fase | Task | Status | Progress | Test | Notes |
| --- | --- | --- | --- | --- | --- |
| 0 | Environment audit | Completed | 100% | Manual audit | Node 24.21.0, npm 11.19.0, PHP 8.2.12, Java 17. Rust/Go tidak tersedia. |
| 1 | PRD | Completed | 100% | - | `docs/PRD.md` — persona, 5 use case, scope, NFR, model concurrency, kontrak API, risiko. |
| 2 | Architecture | Completed | 100% | - | 8 dokumen desain selesai (lihat §4). |
| 3 | Language core | Completed | 100% | 96 unit test pass | Lexer, parser, AST, codegen, driver compiler. |
| 4 | OOP | Completed | 100% | 35 codegen test pass | Class, inheritance, interface, enum, static, getter/setter, polymorphism. |
| 5 | Runtime | Completed | 100% | 46 integration test pass | Core, async scheduler, worker pool, HTTP server+router, filesystem, network client. |
| 6 | Backend | Completed | 100% | 46 integration test pass | Router parametrik, middleware, validasi input, error mapping, graceful shutdown. |
| 7 | Database | Completed | 100% | 47 database test pass | SQLite pool, query builder (allowlist identifier/operator/JOIN), prepared statement positional, keyset pagination, transaksi, migrasi. |
| 8 | Frontend | Completed | 100% | 28 offline test pass | Runtime client (DOM, IndexedDB, sync queue, BroadcastChannel), bundle client, service worker. |
| 9 | Offline first | Completed | 100% | 28 offline test pass | IndexedDB store, sync queue (batas 500), background sync, sinkronisasi antar-tab, LWW + optimistic concurrency (baseVersion/409). |
| 10 | CRUD application | Completed | 100% | 46 integration test pass | Bonang CRUD Demo: Product/ProductRepository/ProductService/ProductController, DB `bonang_demo`. |
| 11 | Benchmark | Completed | 100% | `node cli/cli.js bench` | 5 skenario terukur, hasil di `benchmarks/RESULTS.md`. |
| 12 | Tooling (CLI) | Completed | 100% | 59 tooling test pass | init/run/build/dev/test/lint/audit/bench/migrate/version semua berfungsi. |
| 13 | Final audit | Completed | 100% | 356 test + audit statis | `docs/AUDIT_REPORT.md` — 0 temuan terbuka. |
| 14 | Documentation | Completed | 100% | - | 17 dokumen di `docs/` + `benchmarks/RESULTS.md` + `README.md`. |

---

## 2. Milestone: Rilis 0.1.0 (2026-11-11)

### 2.1 Yang dibangun

**Compiler** (`compiler/`)
- `lexer/lexer.js` — token, literal, template literal, posisi, error lokasi.
- `parser/parser.js` — Pratt parser dengan backtracking (arrow function vs
  grouping), class, interface, enum, import/export.
- `ast/nodes.js` — 40+ tipe node.
- `codegen/generator.js` — pelacakan lexical scope, name mangling.
- `compiler.js` — driver + `__bngRequire`.
- `bundler.js` — graf modul -> satu berkas JS mandiri.

**Runtime** (`runtime/`)
- `core/runtime.js` — BonangError bertingkat, Logger, sleep/delay/withTimeout,
  utilitas objek/koleksi.
- `async/scheduler.js` — Scheduler, withConcurrencyLimit, WorkerPool.
- `http/server.js`, `http/router.js` — server + routing.
- `database/pool.js`, `database/query-builder.js` — SQLite + query builder.
- `security/security.js` — hashing, CSRF, escaping, path, upload, rate
  limit, session.
- `filesystem/files.js`, `network/http-client.js` — I/O.
- `client/client.js` — DOM, IndexedDB, sync queue, conflict, apiFetch.

**Tooling** (`cli/`)
- `cli.js` — 10 perintah yang benar-benar berfungsi.
- `linter.js` — 10 aturan.
- `auditor.js` — 7 pemeriksaan, 4 berbasis AST.
- `dev-server.js` — hot reload via SSE.
- `migrate.js` — runner migrasi + rollback.

**Library**
- `standard-library/index.js`, `package-manager/index.js`.

**Aplikasi**
- `apps/bonang-crud-demo` — CRUD penuh dengan offline-first.

### 2.2 Verifikasi

```
$ npm test
ℹ tests 356
ℹ pass 356
ℹ fail 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 3647.308
$ node cli/cli.js lint
10 file diperiksa, 28 masalah ditemukan.   (0 error, semua info/warning)

$ node cli/cli.js audit
File diperiksa: 10
Masalah ditemukan: 0
```

### 2.3 Angka terukur

Snapshot satu eksekusi `bonang bench` (04:46 UTC). Benchmark pada mesin
yang sama punya variance antar-jalankan yang besar — rentang tiga
eksekusi tercatat di `benchmarks/RESULTS.md` §8.3. Yang robust di
semua eksekusi: rasio Bonang vs Node tetap 1,05x-1,06x (paritas) dan
uji non-blocking selalu lulus.

| Metrik | Nilai (eksekusi 04:46 UTC) |
| --- | --- |
| Compile | 4 932 batch/detik |
| Execution | 1 919 386 op/detik |
| Node baseline | 2 710 027 op/detik |
| Bonang baseline | 2 873 563 op/detik |
| Rasio Bonang vs Node | 1,06x (paritas) |
| PHP baseline | 339 785 op/detik |
| DB insert / select | 962 / 4 481 op/detik |
| HTTP p99 @ 1000 req | 471,86 ms (< NFR-03 1000 ms) |
| HTTP non-blocking check | 2,125 ms (lulus) |

---

## 3. Bug yang Ditemukan dan Diperbaiki

48 bug tercatat di `docs/BUG_TRACKER.md`, seluruhnya Fixed.

| ID | Komponen | Severity | Ringkasan |
| --- | --- | --- | --- |
| BNG-001..009 | Parser | Medium/High/Low | Backtracking arrow, error lokasi, `void`, deklarasi ganda, export |
| BNG-010 | Codegen | Critical | `export` pada `var` menimpa ekspor lain |
| BNG-011 | Codegen | High | `export fn` menghasilkan `function;` |
| BNG-012 | Lexer+Parser | Medium | `typeof`/`function` keyword |
| BNG-013 | Codegen | Medium | Literal `undefined` menjadi `null` |
| BNG-014 | Parser+Codegen | Medium | `export { a, b as c }` |
| BNG-015 | Codegen | Medium | Reserved word sebagai properti |
| BNG-016 | Compiler | Critical | `require` bawaan Bonang rekursif tak terbatas |
| BNG-017 | Codegen | High | Arrow dengan object literal |
| BNG-018 | Demo app | High | `createDefault()` mengembalikan pool |
| BNG-019 | Demo app | High | Service `get`/`update`/`remove` belum di-await |
| BNG-020 | Demo app | Medium | Update parsial ditolak validasi |
| BNG-021 | Parser | Medium | `void` tidak diparse |
| BNG-022 | Codegen | High | `typeof` tanpa spasi menyatu |
| BNG-023 | Bundler | Critical | Entry point tidak dipanggil saat build |
| BNG-024 | HTTP server | High | Aset statis 404 |
| BNG-025 | HTTP server | Medium | Respons error tidak `{ status, msg }` |
| BNG-026 | Runtime core | Medium | `NotFoundError`/`ConflictError` buang `details` |
| BNG-027 | Security | Medium | `timingSafeEqual` hanya menerima Buffer |
| BNG-028 | HTTP server | High | Beban 1000 request ditolak ECONNREFUSED |
| BNG-029 | Client runtime | Medium | Entri antrean gagal permanen diulang selamanya |
| BNG-030 | Demo app | Low | Route `/` mengembalikan JSON, bukan HTML |
| BNG-031 | Auditor CLI | High | Konstanta `this.table` dibaca sebagai data user |
| BNG-032 | Auditor CLI | Medium | `store.put`/`store.delete` dibaca sebagai route |
| BNG-033 | Auditor CLI | High | Deteksi validasi route selalu gagal |
| BNG-034 | Auditor CLI | High | `export class` tak dikenali analisis AST |
| BNG-035 | Auditor CLI | High | `checkConfigFiles` hilang — `bonang audit` crash |
| BNG-036 | Query builder | High | Jenis & kondisi JOIN disisipkan tanpa validasi |
| BNG-037 | CLI scaffold | Medium | Route POST hasil `bonang init` tanpa validasi input |
| BNG-038 | Test tooling | Medium | Test CLI menggantung & cleanup gagal (proses anak belum mati) |
| BNG-039 | Bundler | Critical | Bundel client gagal di browser karena memakai `require` |
| BNG-040 | HTTP server | High | Tidak ada header keamanan sama sekali (bertentangan dengan klaim CHANGELOG) |
| BNG-041 | Query builder + Auditor | High | `whereRaw`/`having` tanpa validasi SQL maupun analisis auditor |
| BNG-042 | Client runtime | Medium | Antrean sinkronisasi tumbuh tanpa batas |
| BNG-043 | Service worker cache | Medium | Tidak ada invalidasi cache per-file |
| BNG-044 | Security + HTTP server | Medium | Tidak ada signed cookie bawaan |
| BNG-045 | Query builder | Medium | Pagination hanya berbasis offset |
| BNG-046 | Client runtime | Medium | Sinkronisasi hanya berjalan saat aplikasi aktif |
| BNG-047 | Client runtime | Medium | Dua tab bisa saling menimpa perubahan lokal |

---

## 4. Dokumentasi

| Dokumen | Isi |
| --- | --- |
| `docs/ENVIRONMENT_AUDIT.md` | Audit mesin, toolchain, versi |
| `docs/TECHNICAL_DECISIONS.md` | Keputusan + alasan |
| `docs/RISK_REGISTER.md` | Risiko + mitigasi |
| `docs/PRD.md` | Persona, use case, scope, NFR, kontrak API |
| `docs/LANGUAGE_SPECIFICATION.md` | Sintaks dan semantik |
| `docs/ARCHITECTURE.md` | Komponen dan aliran data |
| `docs/GRAMMAR.md` | Grammar formal |
| `docs/COMPILER_DESIGN.md` | Pipeline compiler |
| `docs/RUNTIME_DESIGN.md` | Runtime, concurrency, error |
| `docs/SECURITY_DESIGN.md` | Model keamanan + audit statis |
| `docs/DATABASE_DESIGN.md` | Skema, pool, query builder |
| `docs/OFFLINE_FIRST_DESIGN.md` | IndexedDB, sync queue, konflik |
| `docs/BUG_TRACKER.md` | 48 bug, siklus perbaikan |
| `docs/AUDIT_REPORT.md` | Hasil audit keamanan, struktur, performa, arsitektur |
| `docs/PROJECT_PROGRESS.md` | Dokumen ini |
| `docs/TEST_REPORT.md` | Hasil pengujian |
| `docs/KNOWN_LIMITATIONS.md` | 24 batasan terverifikasi |
| `docs/RELEASE_NOTES.md` | Ringkasan rilis 0.1.0 |
| `docs/CHANGELOG.md` | Riwayat perubahan |
| `benchmarks/RESULTS.md` | Hasil benchmark terukur |
| `README.md` | Pintasan masuk |

---

## 5. Batasan yang Diketahui

Rincian lengkap: `docs/KNOWN_LIMITATIONS.md` (24 entri, L-01 s.d. L-34).
Yang paling impacting:

1. **Tidak ada type checker** (L-01) — anotasi tipe hanya diparse.
2. **`node:sqlite` sinkron** (L-06) — query panjang memblokir event loop.
3. **Offline-first pakai LWW, bukan CRDT** (L-19) — mitigasi: kirim
   `baseVersion` agar server menolak update basi.
4. **Tanpa ORM / enkripsi at-rest** (L-13, L-16) — soft delete (L-14) dan
   keyset pagination (L-15) sudah ditutup.
5. **Test offline memakai `FakeIndexedDB`** (L-25), bukan IndexedDB asli.
6. **Auditor mengenali route dari nama receiver** (L-28) dan nama fungsi
   validasi dari pola (L-29).
7. **Tidak ada laporan coverage** (L-30).

---

## 6. Fase 15 — Perbaikan Batasan (2026-11-11)

Fase tambahan yang diminta setelah rilis 0.1.0: menutup batasan yang
tercatat di `docs/KNOWN_LIMITATIONS.md`, mulai dari yang paling mudah
dan realistis. Setiap batasan yang ditutup juga dicatat sebagai bug
di `docs/BUG_TRACKER.md` dengan regression test.

### 6.1 Batch A — selesai

| Batasan | Status | Bug | Yang dikerjakan |
| --- | --- | --- | --- |
| L-11 | Ditutup | BNG-040 | Header keamanan bawaan (CSP, X-Frame-Options, nosniff, Referrer-Policy, Permissions-Policy) di `Response.buildHeaders()` + jalur aset statis. Dapat ditimpa per-route dan dikonfigurasi lewat `createServer({ securityHeaders })`. |
| L-18 | Ditutup | BNG-041 | `assertRawSql()` menolak statement tambahan dan jumlah placeholder yang tidak cocok; auditor punya aturan baru `sql-injection-raw` untuk `whereRaw`/`having`. |
| L-22 | Ditutup | BNG-042 | Batas ukuran antrean (default 500) dengan `QueueOverflowError`; hidrasi antrean dari IndexedDB dihitung dalam batas. |
| L-20 | Ditutup | BNG-043 | `precache-manifest.json` dari `bonang build` + `CacheInvalidator` (`prune`, `matchFresh`, `store`). Terverifikasi di Chrome: hanya file yang berubah yang di-refresh. |

### 6.2 Batch B — selesai

| Batasan | Status | Bug | Yang dikerjakan |
| --- | --- | --- | --- |
| L-10 | Ditutup | BNG-044 | `signValue`/`verifySignedValue` (HMAC timing-safe) + `response.signedCookie()` + `request.signedCookie()`. |
| L-15 | Ditutup | BNG-045 | `paginateByCursor()` — keyset pagination dua kolom (kolom utama + penyeimbang) dengan cursor berparameter. |
| L-23 | Ditutup | BNG-046 | `registerBackgroundSync()` mendaftarkan tag ke `navigator.serviceWorker.sync`, melapor status tanpa melempar. |
| L-24 | Ditutup | BNG-047 | `BroadcastSync` + `linkQueueToBroadcast()` menyiarkan perubahan antrean antar-tab. |

### 6.3 Batch C — dikerjakan berikutnya

L-01 (type checker), L-13 (ORM / schema diff).

### 6.4 Batch C (lanjutan) — selesai

| Batasan | Status | Bug | Yang dikerjakan |
| --- | --- | --- | --- |
| L-05 | Ditutup | BNG-048 | Bundler menangani siklus modul (pendaftaran modul sebelum rekursi + cache modul bersama di `createRequire`) dan codegen memakai **live binding** (`const _$$modN = require(...)`, dibaca dari `module.exports` saat dipakai) supaya nilai modul siklik tidak terkunci `undefined`. Ditambah `import()` dinamis: node AST `ImportExpression`, helper `_$$dynamicImport`, modul dinamis ikut ter-bundle. |
| L-14 | Ditutup | — | Soft delete jadi fitur runtime, bukan sekadar catatan: `runtime/database/soft-delete.js` menyediakan `SoftDeleteRepository` (kolom `deleted_at`, `remove`/`restore`/`purge`, `countActive`/`countDeleted`, filter `includeDeleted`) dan `addSoftDeleteColumn()` untuk menambahkan kolom ke tabel yang sudah ada. Demo app memakai pola yang sama di repository sendiri: `DELETE /api/products/:id` menandai baris (bukan menghapus), `POST /api/products/:id/restore` memulihkannya, dan semua query membaca hanya baris aktif. |

### 6.5 Audit berkala (PHASE 10) — selesai

Audit sebelumnya hanya mencakup keamanan. Sekarang `docs/AUDIT_REPORT.md`
mencovers empat dimensi PHASE 10 — code quality, performance, security,
architecture — dan bisa dijalankan ulang kapan saja.

| Yang ditambahkan | Isi |
| --- | --- |
| `cli/structure-audit.js` | Pemeriksa siklus dependensi, dead code, duplikasi berkas, dan berkas oversized. Dipanggil lewat `bonang audit --structure`. |
| `runtime/database/identifiers.js` | Satu sumber `assertIdentifier()` — sebelumnya diduplikasi di query builder dan soft delete. |
| Audit performa | Benchmark p50/p95/p99, heap, `open handles`, event loop blocking, perbandingan Node/PHP. |
| Audit arsitektur | Lapisan dependensi, modularitas, separation of concerns, coupling, error propagation, backward compatibility. |

Hasil: **0 siklus dependensi**, **0 dead code**, **0 duplikasi**, **0
resource leak**, 0 temuan terbuka.

### 6.6 Batasan yang tetap ditulis sebagai batasan

Entrri yang tidak bisa ditutup dengan biaya yang masuk akal ditulis ulang
di `docs/KNOWN_LIMITATIONS.md` dengan alasannya, bukan dihapus diam-diam.

| Entri | Alasan tetap menjadi batasan |
| --- | --- |
| L-32 | Background Sync hanya didukung Chromium — batasan platform, bukan implementasi yang bisa ditutup di level runtime. |
| L-33 | `BroadcastChannel` hanya bekerja same-origin — batasan platform yang sama. |
| L-34 | `import()` dengan path yang bukan string literal ditolak saat kompilasi — path yang dihitung saat runtime tidak bisa ditemukan saat build, sehingga hasilnya tidak deterministik. |

Perubahan jumlah entri: 31 -> 24.

---

## 7. Arah Berikutnya (belum dikerjakan)

Tidak ada fase yang Blocked. Berikut adalah kandidat langkah berikutnya,
semua berdasar pada batasan di §5 — **belum ada yang dikerjakan**:

1. **Type checker statis** — menutup L-01, batasan terbesar yang tersisa.
2. **ORM dan schema diff** — menutup L-13.
3. **Halaman dokumentasi API** — belum ada; `docs/` ada, tapi tidak ada
   referensi API per-fungsi.

---

## 8. Cara Melanjutkan

Untuk melanjutkan pekerjaan tanpa kehilangan riwayat:

1. Baca dokumen ini untuk status.
2. Baca `docs/BUG_TRACKER.md` untuk bug yang sudah pernah ditemukan dan
   dikunci test-nya (48 bug, semua Fixed).
3. Baca `docs/KNOWN_LIMITATIONS.md` untuk hal yang diketahui belum selesai.
4. Jalankan `npm test` untuk memastikan keadaan sehat (356 lulus).
5. Jalankan `node cli/cli.js audit` untuk memastikan audit statis bersih
   (0 temuan).
6. Ikuti siklus di `docs/BUG_TRACKER.md`: reproduksi -> root cause ->
   perbaikan minimal -> regression test -> verifikasi.

**Aturan yang tidak boleh dilanggar**: tidak boleh ada implementasi
palsu, tidak boleh ada test yang dinonaktifkan, tidak boleh ada klaim
fitur selesai sebelum diuji, dan tidak boleh ada exception yang
disembunyikan.
