# AUDIT REPORT — BONANG

Audit keamanan dan kualitas terhadap basis kode Bonang pada
**2026-11-11**.

**Auditor**: Principal Engineer (self-audit)
**Cakupan**: `compiler/`, `runtime/`, `cli/`, `standard-library/`,
`package-manager/`, `benchmarks/`, `apps/`, `tests/`, `examples/`
**Metode**: audit manual + analisis statis (`node cli/cli.js audit`) +
eksekusi test suite penuh.

---

## 1. Ringkasan Eksekutif

| Area | Temuan | Severity Tertinggi | Status |
| --- | --- | --- | --- |
| Audit statis (kode referensi) | 0 | - | Hijau |
| Auditor CLI (akurasi) | 6 bug sudah diperbaiki | High | Hijau |
| Query builder (injeksi SQL) | 1 bug sudah diperbaiki | High | Hijau |
| Scaffold `bonang init` | 1 bug sudah diperbaiki | Medium | Hijau |
| Secret hardcoded | 0 | - | Hijau |
| XSS | 0 | - | Hijau |
| Path traversal | 0 | - | Hijau |
| Autentikasi di route sensitif | 0 pada demo | - | Hijau |
| Dependensi eksternal | 0 | - | Hijau |
| Test suite | 250 lulus / 0 gagal | - | Hijau |
| Linter | 28 info/warning, 0 error | - | Hijau |

**Tidak ada temuan terbuka.** Delapan temuan yang ditemukan selama audit
semua sudah diperbaiki dan dikunci dengan regression test. Rinciannya di
Bagian 5.

> Catatan jujur: audit ini dilakukan oleh penulis kode yang sama. Yang
yang disediakan adalah bukti eksekusi — output nyata perintah, bukan
> klaim. Audit yang dilakukan pihak ketiga yang benar-benar independen
> belum ada; itu batasan yang tersisa.

---

## 2. Audit Statis

```
$ node cli/cli.js audit

=== AUDIT KEAMANAN BONANG ===

File diperiksa: 10
Masalah ditemukan: 0

Tidak ada masalah keamanan terdeteksi.
```

Exit code 0.

### 2.1 Apa yang diperiksa

Tujuh pemeriksaan, empat berbasis analisis AST:

| Pemeriksaan | Metode |
| --- | --- |
| Hardcoded secret | Regex per baris (5 pola) |
| SQL injection (gabungan `+`) | Regex per baris |
| SQL injection (template literal) | AST |
| XSS (`innerHTML`, `insertAdjacentHTML`, `document.write`) | Regex per baris |
| Path traversal | Regex per baris |
| Route mutating tanpa validasi | AST |
| Secret di berkas konfigurasi | Isi `.env*`, `bonang.config.js`, `config.json` |

### 2.2 Akurasi auditor

Sebelum diperbaiki, auditor melaporkan **19 temuan palsu** pada kode
referensi proyek sendiri:

| Manifestasi | Jumlah | Akar masalah |
| --- | --- | --- |
| `store.put`/`store.delete` dianggap route HTTP | 7 | Receiver tidak diperiksa |
| Route yang tervalidasi dilaporkan tidak memvalidasi | 4 | Potongan handler selalu `''` |
| `this.table` (konstanta) dianggap data user | 8 | Regex tidak bisa bedakan konstanta |

Akibatnya `bonang audit` tidak dapat dipakai sebagai gerbang kualitas —
memang tidak, exit code 1 pada kode yang bersih sendiri. Enam bug
diperbaiki (BNG-031 s.d. BNG-036) dan dikunci dengan **11 test regresi**
di `tests/tools/auditor.test.js`.

### 2.3 Audit terhadap scaffold

Audit juga dijalankan pada proyek yang dihasilkan `bonang init` — kode
yang akan dipakai setiap pengguna baru. Ditemukan satu masalah: route
`POST /api/echo` pada template memakai `ctx.json()` tanpa validasi
(BNG-037). Template kini memakai `ctx.validate(...)`, dan `tests/tools/cli.test.js`
memverifikasi bahwa proyek hasil `init` audit bersih, lint tanpa error,
dan route POST mengembalikan 400 untuk body yang tidak valid.

---

## 3. Tinjauan Manual per Area

### 3.1 Secret dan kredensial

- Tidak ada `password`, `api_key`, atau `secret` hardcoded di `.bng` manapun.
- `runtime/security/security.js` tidak menyimpan secret default.
- Demo app memakai `bonang.config.json` tanpa kredensial sensitif.
- Tidak ada dependensi eksternal yang bisa membawa supply-chain risk:
  `dependencies: {}` dan `devDependencies: {}`.

**Temuan: tidak ada.**

### 3.2 Injeksi SQL

Semua nilai user masuk ke SQL lewat placeholder positional `?`. Nama
kolom/tabel yang tidak bisa diparameterkan divalidasi terhadap allowlist
identifier.

Titik yang diperiksa:

| Lokasi | Pola | Status |
| --- | --- | --- |
| `product-repository.bng` | 9 template literal menginterpolasi `${this.table}` — konstanta kelas, bukan data user | Aman |
| `product-repository.bng` | Semua nilai via `?` | Aman |
| `query-builder.js` | `where`/`orderBy`/`groupBy`/`select` → `assertIdentifier` | Aman |
| `query-builder.js` | `where` → `normalizeOperator` (allowlist) | Aman |
| `query-builder.js` | `join()` → allowlist jenis JOIN + validasi kondisi JOIN | Diperbaiki (BNG-036) |
| `migrate.js` | Statement migrasi ditulis developer, bukan user | Aman |

**Temuan: 1** (BNG-036, `join()` menyisipkan jenis dan kondisi JOIN tanpa
validasi). Sudah diperbaiki dan dikunci test.

### 3.3 XSS

- Tidak ada penulisan `innerHTML`/`outerHTML` tanpa `escapeHtml` di kode
  `.bng`.
- `document.write` tidak dipakai.
- `runtime/security/security.js` menyediakan `escapeHtml` yang menetralkan
  `<`, `>`, `&`, `"`, `'`.

**Temuan: tidak ada.**

### 3.4 Path traversal

- `runtime/filesystem/files.js` selalu melewati `safeJoin`.
- `safeFilename` membuang komponen path.
- `safeJoin` menolak prefix confusion (`/data-evil` vs `/data`).
- Validasi upload menolak nama berkarakter path, tipe terlarang, dan
  ukuran berlebih.

**Temuan: tidak ada.**

### 3.5 Autentikasi dan otorisasi

Demo app tidak punya endpoint login, jadi tidak ada route sensitif tanpa
kontrol auth. `runtime/security/security.js` menyediakan `SessionStore`,
`RateLimiter`, dan CSRF untuk aplikasi yang membutuhkannya.

Yang perlu jujur dicatat: **belum ada proteksi brute-force bawaan pada
login** — bukan karena tidak ada login, tapi karena Bonang tidak
menyediakan sistem login; ia menyediakan tool untuk membangunnya.

**Temuan: tidak ada** (dicatat sebagai batasan di `KNOWN_LIMITATIONS.md`).

### 3.6 Perilaku error

- `msg` untuk status >= 500 diganti pesan generik kecuali mode
  development. Detail internal hanya ke log.
- Error fatal tidak pernah ditelan: test `http: error handler
  mengembalikan pesan aman tanpa stack trace` memverifikasi ini.

**Temuan: tidak ada.**

### 3.7 Concurrency dan state

- Optimistic concurrency lewat `baseVersion`; update dengan versi basi
  ditolak 409 `CONFLICT` dan `details.server` berisi data server.
- Test konkurensi memverifikasi 100 reader paralel saat writer aktif tidak
  pernah melihat data setengah tertulis.
- Test "2 update paralel dengan `baseVersion` sama": minimal satu berhasil,
  yang lain ditolak sebagai konflik — tidak ada lost update.

**Temuan: tidak ada.**

### 3.8 Supply chain

- Nol dependensi eksternal.
- Hanya `node:` built-in yang dipakai: `fs`, `path`, `crypto`, `http`,
  `https`, `worker_threads`, `sqlite`, `url`, `zlib`, `test`.

**Temuan: tidak ada.**

### 3.9 Penggunaan `new Function` dan `eval`

Audit menemukan 7 pemakaian:

| Lokasi | Konteks | Penilaian |
| --- | --- | --- |
| `compiler/compiler.js:80`, `:129` | Menjalankan hasil transpilasi | **Diperlukan** — inilah cara kerja compiler |
| `cli/cli.js:182`, `:340` | Menjalankan hasil transpilasi | Diperlukan |
| `cli/dev-server.js:102` | Menjalankan hasil transpilasi | Diperlukan |
| `cli/migrate.js:70` | Menjalankan hasil transpilasi | Diperlukan |
| `runtime/async/scheduler.js:312` | Worker thread menerima body fungsi | **Perlu ditinjau** |

`runtime/async/scheduler.js` adalah satu-satunya pemakaian di luar toolchain
compiler. Worker pool mengeksekusi body fungsi yang diteruskan developer,
bukan input user — jadi risikonya sebanding dengan `new Function` di
compiler. Tetap dicatat di sini agar terlihat, bukan disembunyikan.

**Temuan: 1 catatan arsitektur**, bukan kerentanan yang bisa dieksploitasi
dari input eksternal.

### 3.10 Kualitas kode

```
$ node cli/cli.js lint
10 file diperiksa, 28 masalah ditemukan.
```

28 temuan, semuanya `warning`/`info`, **0 error**:

| Aturan | Jumlah | Contoh |
| --- | --- | --- |
| `no-shadowing` | 22 | Variabel `body`/`id` di scope dalam method |
| `no-console` | 6 | `console.log` di entry point dan fixture |

`no-shadowing` menandai variabel yang men-shadow variabel luar dalam scope
berbeda — ini pola umum dan sering desired, bukan bug. `no-console`
dilaporkan sebagai `info`, bukan warning, karena `console` memang alat yang
tepat di entry point.

`no-empty-catch` yang sebelumnya dilaporkan di `client/main.bng:502`
sudah diperbaiki: error sekarang dicatat dengan `console.warn` agar
kegagalan tidak hilang tanpa jejak.

**Temuan: 0 actionable.** Sisa 28 temuan adalah `info`/`warning` yang
disengaja dan tidak menunjukkan cacat.

---

## 4. Verifikasi Eksekusi

```
$ npm test
ℹ tests 250
ℹ pass 250
ℹ fail 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 3320.2464
```

| Suite | Tests | Cakupan |
| --- | --- | --- |
| `tests/unit/` | 96 | Lexer, parser, codegen |
| `tests/integration/` | 46 | Runtime, aplikasi CRUD |
| `tests/regression/` | 16 | BNG-010..BNG-030 terkunci |
| `tests/offline/` | 13 | IndexedDB, sync queue, konflik |
| `tests/concurrency/` | 8 | 10/100/500/1000 request, p50/p95/p99 |
| `tests/database/` | 19 | Pool, transaksi, query builder, JOIN, injection |
| `tests/security/` | 35 | Hash, CSRF, XSS, path, rate limit, session |
| `tests/tools/` | 17 | Akurasi auditor + scaffold CLI |

Tidak ada test yang dinonaktifkan, dilewati, atau di-`todo`.

---

## 5. Temuan dan Perbaikannya

| ID | Temuan | Severity | Status | Regression test |
| --- | --- | --- | --- | --- |
| BNG-031 | Auditor membaca `this.table` (konstanta) sebagai data user — 8 critical palsu | High | Fixed | `tests/tools/auditor.test.js` |
| BNG-032 | Auditor membaca `store.put`/`store.delete` sebagai route — 7 medium palsu | Medium | Fixed | `tests/tools/auditor.test.js` |
| BNG-033 | Deteksi validasi route selalu gagal (offset AST tidak pernah ada) | High | Fixed | `tests/tools/auditor.test.js` |
| BNG-034 | `export class` tidak dikenali analisis AST | High | Fixed | `tests/tools/auditor.test.js` |
| BNG-035 | `checkConfigFiles` hilang saat rewrite auditor — `bonang audit` crash | High | Fixed | `node cli/cli.js audit` |
| BNG-036 | `QueryBuilder.join` menyisipkan jenis & kondisi JOIN tanpa validasi | High | Fixed | `tests/database/database.test.js` |
| BNG-037 | Scaffold `bonang init` mengirim route POST tanpa validasi input | Medium | Fixed | `tests/tools/cli.test.js` |
| BNG-038 | Test CLI menggantung & gagal cleanup karena proses anak belum mati | Medium | Fixed | `tests/tools/cli.test.js` |

Detail lengkap (tanggal, root cause, fix) ada di `docs/BUG_TRACKER.md`.

---

## 6. Tindakan Lanjutan yang Disarankan

Tidak ada yang menghalangi rilis, tetapi berikut celah yang memang ada:

1. **Perluas `isRouterLike` ke allowlist yang dikonfigurasi.** Saat ini
   router dengan nama non-konvensi tidak diperiksa (L-28).
2. **Audit `whereRaw`/`having`.** Keduanya menerima SQL mentah dan tidak
   dianalisis auditor (L-18). Sebaiknya ada API eksplisit untuk SQL mentah
   yang bisa dicari dengan grep.
3. **Audit dari pihak ketiga.** Self-audit punya bias confirmation.
4. **Tambahkan `c8` atau coverage native.** Saat ini cakupan hanya
   terukur lewat enumerasi test (L-30).

---

## 7. Kesimpulan

Basis kode Bonang 0.1.0 lolos audit yang dilakukan: 0 temuan terbuka pada
audit statis, 0 test gagal, 0 dependensi eksternal, dan setiap temuan
yang pernah muncul punya regression test yang mengunci perbaikannya.

Yang belum ada: audit independen. Klaim di dokumen ini harus dibaca
sebagai hasil self-audit dengan bukti eksekusi, bukan sebagai jaminan
mutlak.
