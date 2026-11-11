# BUG TRACKER — BONANG

Format mengikuti PHASE 9 pada `prompt.md`. Setiap bug yang ditemukan dicatat
di sini dengan analisis akar masalah dan bukti pengujian ulang.

Status: `Fixed` (perbaikan diterapkan dan ada regression test), `Open`
(tercatat, belum diperbaiki), `Won't fix` (disengaja, dengan alasan).

---

## BNG-001 — Import memakai `expectKeyword('as')` sehingga `as` wajib muncul

- **Tanggal**: 2026-11-11
- **Komponen**: `compiler/parser/parser.js`
- **Severity**: Medium
- **Deskripsi**: Parsing `import { helper } from "./helpers.bng"` gagal dengan
  pesan `Diharapkan keyword 'as'`.
- **Root cause**: `expectKeyword()` melempar error bila token tidak cocok,
  sedangkan pada percakapan `as` bersifat opsional — helper yang salah
  dipakai (`expect` vs `match`).
- **Perbaikan**: Ganti `expectKeyword('as')` menjadi `matchKeyword('as')`
  di `parseImportDeclaration` (dua lokasi).
- **Fix applied**: Ya.
- **Regression test**: `tests/unit/parser.test.js` — kasus "import dengan alias".
- **Status**: Fixed

---

## BNG-002 — `abstract class` tidak bisa diparse

- **Tanggal**: 2026-11-11
- **Komponen**: `compiler/parser/parser.js`
- **Severity**: Medium
- **Deskripsi**: Statement `abstract class Base { ... }` menghasilkan error
  `Ekspresi tidak terduga: 'abstract'`.
- **Root cause**: Statement-level dispatch tidak menangani modifier `abstract`
  sebelum keyword `class`.
- **Perbaikan**: Tambah case `abstract` pada `parseStatement` yang memanggil
  `parseClassDeclaration` lalu menandai modifier.
- **Fix applied**: Ya.
- **Regression test**: `tests/unit/parser.test.js` — kasus "class abstrak".
- **Status**: Fixed

---

## BNG-003 — Method class tanpa keyword `fn` gagal diparse

- **Tanggal**: 2026-11-11
- **Komponen**: `compiler/parser/parser.js`
- **Severity**: Medium
- **Deskripsi**: `describe(): string { ... }` gagal dengan
  `Dumplah identifier, ditemukan '('`.
- **Root cause**: `parseClassMember` hanya mengenali method yang diawali
  keyword `fn`. Notasi `nama()` lazim dipakai dan grammar harus mendukungnya.
- **Perbaikan**: Deteksi method bila token berikutnya adalah `(`.
- **Fix applied**: Ya.
- **Regression test**: `tests/unit/parser.test.js` — kasus "method class".
- **Status**: Fixed

---

## BNG-004 — Arrow function dengan parameter bertipe diabaikan

- **Tanggal**: 2026-11-11
- **Komponen**: `compiler/parser/parser.js`
- **Severity**: Low
- **Deskripsi**: `(a: int, b: int): int => a + b` gagal diparse.
- **Root cause**: Tipe return pada arrow function tidak dikonsumsi sebelum
  operator `=>`.
- **Perbaikan**: Panggil `parseOptionalTypeAnnotation()` sebelum
  `expect('operator', '=>')`.
- **Fix applied**: Ya.
- **Regression test**: `tests/unit/parser.test.js` — kasus "arrow function bertipe".
- **Status**: Fixed

---

## BNG-005 — Parenthesized expression tertukar dengan arrow function

- **Tanggal**: 2026-11-11
- **Komponen**: `compiler/parser/parser.js`
- **Severity**: High
- **Deskripsi**: `(a + b) * c` dan `(a, b) => ...` sama-sama diawali `(`,
  sehingga parser tidak tahu harus menafsirkan sebagai grouping atau arrow.
- **Root cause**: Grammar belum punya mekanisme backtracking.
- **Perbaikan**: Tambah `tryParseArrowParams()` yang melakukan parse
  spekulatif daftar parameter dan mengembalikan `null` bila token `=>`
  tidak ditemukan. Pemanggil menyimpan `this.index` sebelum mencoba dan
  memulihkannya bila gagal.
- **Fix applied**: Ya.
- **Regression test**: `tests/unit/parser.test.js` — kasus "grouping vs arrow".
- **Status**: Fixed

---

## BNG-006 — `async fn` tidak mengonsumsi token `async`

- **Tanggal**: 2026-11-11
- **Komponen**: `compiler/parser/parser.js`
- **Severity**: Medium
- **Deskripsi**: `async fn fetchAll(): Promise<int[]> { ... }` gagal dengan
  `Diharapkan 'fn' tetapi ditemukan 'async'`.
- **Root cause**: `parseFunctionDeclaration(isAsync)` melakukan `next()`
  tambahan hanya bila dipanggil dengan flag `true`, tetapi statement dispatch
  memanggilnya tanpa flag.
- **Perbaikan**: Statement dispatch memanggil `parseFunctionDeclaration(true)`.
- **Fix applied**: Ya.
- **Regression test**: `tests/unit/parser.test.js` — kasus "fungsi async".
- **Status**: Fixed

---

## BNG-007 — `for (let i = 0; ...)` salah dikira for-in

- **Tanggal**: 2026-11-11
- **Komponen**: `compiler/parser/parser.js`
- **Severity**: High
- **Deskripsi**: Loop C-style `for (let i = 0; i < 10; i = i + 1)` gagal
  dengan `Diharapkan keyword 'in'`.
- **Root cause**: Deteksi for-in hanya memeriksa bahwa token setelah nama
  variabel adalah identifier, sehingga `let i = 0` ikut terpenuhi.
- **Perbaikan**: Tambahkan syarat token ke-3 adalah keyword `of`/`in`.
- **Fix applied**: Ya.
- **Regression test**: `tests/unit/parser.test.js` — kasus "for C-style" dan
  "for-of".
- **Status**: Fixed

---

## BNG-008 — Template literal berubah menjadi string biasa

- **Tanggal**: 2026-11-11
- **Komponen**: `compiler/lexer/lexer.js`, `compiler/parser/parser.js`
- **Severity**: High
- **Deskripsi**: `` `Halo ${nama} dunia` `` tidak menyisipkan nilai variabel;
  lexer memperlakukannya sebagai string biasa.
- **Root cause**: Lexer hanya mengenali `"` dan `'` sebagai penanda string,
  sehingga backtick jatuh ke jalur operator dan isinya tidak di-escape.
- **Perbaikan**: Lexer punya `readTemplate()` yang memisahkan bagian teks
  (`quasi`) dan source ekspresi. Parser memakai `parseTemplateLiteral()`
  untuk mem-parse source ekspresi secara rekursif.
- **Fix applied**: Ya.
- **Regression test**: `tests/unit/lexer.test.js` dan `tests/unit/parser.test.js`.
- **Status**: Fixed

---

## BNG-009 — `constructor` dan `extends` bukan keyword

- **Tanggal**: 2026-11-11
- **Komponen**: `compiler/lexer/tokenizer.js`, `compiler/parser/parser.js`
- **Severity**: Medium
- **Deskripsi**: `constructor(id: int)` gagal diparse; `class X extends Y`
  gagal karena `extends` dibaca sebagai identifier biasa.
- **Root cause**: Keyword list tidak memuat `extends`, `implements`,
  `instanceof`. `constructor` ditangani sebagai identifier tetapi parser
  hanya mengecek tipe token `keyword`.
- **Perbaikan**: Tambahkan `extends`/`implements`/`instanceof` ke keyword list;
  `constructor` dideteksi sebagai identifier bernilai `constructor`.
- **Fix applied**: Ya.
- **Regression test**: `tests/unit/parser.test.js`.
- **Status**: Fixed

---

## BNG-010 — Beberapa `export const` pada satu modul saling menimpa

- **Tanggal**: 2026-11-11
- **Komponen**: `compiler/codegen/generator.js`
- **Severity**: Critical
- **Deskripsi**: Hanya export terakhir yang tersedia; `export const a = 1;`
  lalu `export const b = 2;` menghasilkan modul yang hanya mengekspor `b`.
- **Root cause**: Codegen menulis `module.exports = { ... }` tiap kali
  menemukan deklarasi export, sehingga menimpa export sebelumnya.
- **Perbaikan**: Gunakan `Object.assign(module.exports, { ... })` agar
  setiap export menambah, bukan mengganti.
- **Fix applied**: Ya.
- **Regression test**: `tests/regression/bugs.test.js` — "BNG-010: beberapa
  export named dapat hidup berdampingan".
- **Status**: Fixed

---

## BNG-011 — Getter dan method dengan nama sama saling menimpa

- **Tanggal**: 2026-11-11
- **Komponen**: `compiler/codegen/generator.js`
- **Severity**: High
- **Deskripsi**: Kelas dengan `get name()` dan `method name()` menghasilkan
  properti yang saling menimpa; salah satu tidak bisa dipanggil.
- **Root cause**: Codegen menaruh getter dan method pada nama properti yang
  sama di objek class.
- **Perbaikan**: Getter/setter dipasang sebagai accessor (`get`/`set` di
  `Object.defineProperty`), method tetap pada prototype — keduanya bisa
  hidup berdampingan.
- **Fix applied**: Ya.
- **Regression test**: `tests/regression/bugs.test.js` — "BNG-011: getter dan
  method pada kelas tidak saling menimpa".
- **Status**: Fixed

---

## BNG-012 — Keyword `typeof` dan `function` tidak berfungsi

- **Tanggal**: 2026-11-11
- **Komponen**: `compiler/lexer/tokenizer.js`, `compiler/parser/parser.js`
- **Severity**: Medium
- **Deskripsi**: `typeof 42` gagal diparse; `export function double(x)` gagal
  karena `function` diperlakukan sebagai identifier biasa.
- **Root cause**: `typeof` dan `function` tidak ada di keyword list parser.
- **Perbaikan**: Tambahkan `typeof` ke daftar operator unary di tokenizer;
  `function` menjadi alias resmi `fn` dan dikenali di deklarasi fungsi.
- **Fix applied**: Ya.
- **Regression test**: `tests/regression/bugs.test.js` — tiga kasus "BNG-012".
- **Status**: Fixed

---

## BNG-013 — Literal `undefined` dikompilasi menjadi `null`

- **Tanggal**: 2026-11-11
- **Komponen**: `compiler/codegen/generator.js`
- **Severity**: Medium
- **Deskripsi**: `return undefined;` menghasilkan `null`, sehingga
  pemeriksaan `x === undefined` gagal.
- **Root cause**: Generator memperlakukan `undefined` sebagai literal null
  generik saat membuat Literal node.
- **Perbaikan**: Codegen memetakan literal `undefined` ke `undefined` JavaScript.
- **Fix applied**: Ya.
- **Regression test**: `tests/regression/bugs.test.js` — "BNG-013: literal
  undefined tidak dikompilasi menjadi null".
- **Status**: Fixed

---

## BNG-014 — `export { a, b as c }` tidak menandai kedua nama sebagai export

- **Tanggal**: 2026-11-11
- **Komponen**: `compiler/parser/parser.js`, `compiler/codegen/generator.js`
- **Severity**: Medium
- **Deskripsi**: Named export list diabaikan; hanya `a` yang diekspor, dan
  alias `b as c` hilang.
- **Root cause**: `parseExportDeclaration` hanya menangani deklarasi tunggal;
  specifier list tidak di-parse.
- **Perbaikan**: Parser membuat `ExportDeclaration` dengan daftar
  specifier; codegen memetakan setiap nama (dan alias) ke ekspor.
- **Fix applied**: Ya.
- **Regression test**: `tests/regression/bugs.test.js` — "BNG-014: export
  { a, b as c } menandai kedua nama sebagai export".
- **Status**: Fixed

---

## BNG-015 — Nama properti yang sama dengan keyword JavaScript merusak sintaks

- **Tanggal**: 2026-11-11
- **Komponen**: `compiler/codegen/generator.js`
- **Severity**: Medium
- **Deskripsi**: `o.default`, `o.class`, `o.function` menghasilkan sintaks
  JavaScript tidak valid. Sebaliknya `rule.type` ditolak parser.
- **Root cause**: Codegen menulis akses member selalu dengan notasi titik,
  padahal sebagian nama adalah reserved word JavaScript. Parser juga
  menolak keyword Bonang sebagai nama properti objek.
- **Perbaikan**: Codegen memakai bracket notation untuk nama yang termasuk
  reserved word JavaScript (`default`, `class`, `function`, dan sejenisnya).
  Parser menerima keyword Bonang sebagai nama properti objek.
- **Fix applied**: Ya.
- **Regression test**: `tests/regression/bugs.test.js` — tiga kasus "BNG-015".
- **Status**: Fixed

---

## BNG-016 — `require` bawaan Bonang rekursif tak terbatas

- **Tanggal**: 2026-11-11
- **Komponen**: `compiler/compiler.js`
- **Severity**: Critical
- **Deskripsi**: `import { uuid } from "bonang"` gagal dengan
  `Error: Modul tidak ditemukan: ../runtime/index.js`.
- **Root cause**: Fungsi `require` yang dikembalikan `createRequire()`
  bernama `require`, sehingga menutupi `require` di scope modul. Saat
  runtime memanggil `nodeRequire(...)`, yang terpanggil adalah dirinya
  sendiri → rekursi.
- **Perbaikan**: Simpan referensi asli sebagai `const nodeRequire = require;`
  sebelum mendefinisikan fungsi shadowing, lalu gunakan `nodeRequire`
  di dalamnya.
- **Fix applied**: Ya.
- **Regression test**: `tests/regression/bugs.test.js` — tiga kasus "BNG-016".
- **Status**: Fixed

---

## BNG-017 — Arrow function dengan object literal sebagai body menghasilkan sintaks tidak valid

- **Tanggal**: 2026-11-11
- **Komponen**: `compiler/codegen/generator.js`
- **Severity**: High
- **Deskripsi**: `() => ({ name: "x" })` dikompilasi menjadi
  `() => { name: "x" }` — sebuah blok statement, bukan object literal.
  Hasilnya `SyntaxError: Unexpected token ':'`.
- **Root cause**: `generateArrow` tidak membedakan body block dari body
  expression yang berbentuk object literal.
- **Perbaikan**: Bila body adalah `ObjectExpression`, bungkus dengan
  kurung: `(${body})`.
- **Fix applied**: Ya.
- **Regression test**: `tests/regression/bugs.test.js` — dua kasus "BNG-017".
- **Status**: Fixed

---

## BNG-018 — `ProductRepository.createDefault()` mengembalikan pool, bukan repository

- **Tanggal**: 2026-11-11
- **Komponen**: `apps/bonang-crud-demo/src/server/product-repository.bng`
- **Severity**: High
- **Deskripsi**: `repository.ensureSchema is not a function`.
- **Root cause**: Factory mengembalikan objek pool langsung sehingga
  method repository tidak tersedia pada objek yang dikembalikan.
- **Perbaikan**: `return new ProductRepository(createPool({ ... }))`.
- **Fix applied**: Ya.
- **Regression test**: `tests/integration/crud-demo.test.js` — seluruh suite
  CRUD memakai factory ini; kegagalan factory menggagalkan semua test.
- **Status**: Fixed

---

## BNG-019 — Service `get`/`update`/`remove` mengembalikan Promise yang belum di-await

- **Tanggal**: 2026-11-11
- **Komponen**: `apps/bonang-crud-demo/src/server/product-service.bng`
- **Severity**: High
- **Deskripsi**: `service.get(id)` mengembalikan Promise di dalam objek
  respons, sehingga JSON berisi `{}` untuk field produk.
- **Root cause**: `repository.findById()` async, tetapi pemanggil tidak
  menunggu; Promise ikut masuk ke objek hasil.
- **Perbaikan**: `await this.repository.findById(id)` di ketiga method.
- **Fix applied**: Ya.
- **Regression test**: `tests/integration/crud-demo.test.js` — kasus "GET
  produkbyid mengembalikan data lengkap".
- **Status**: Fixed

---

## BNG-020 — Update parsial ditolak validasi karena field lain dianggap kosong

- **Tanggal**: 2026-11-11
- **Komponen**: `apps/bonang-crud-demo/src/server/product-service.bng`
- **Severity**: Medium
- **Deskripsi**: `PUT /api/products/1` dengan hanya `{ "price": 2000 }`
  mengembalikan 400 "Data produk tidak valid" untuk field `name`.
- **Root cause**: Validasi dijalankan atas payload parsial, bukan atas
  hasil penggabungan dengan data saat ini.
- **Perbaikan**: Gabungkan input dengan record yang ada (`input.x !==
  undefined ? input.x : current.x`), lalu validasi hasil penggabungan.
- **Fix applied**: Ya.
- **Regression test**: `tests/integration/crud-demo.test.js` — kasus "PUT
  parsial hanya mengubah field yang dikirim".
- **Status**: Fixed

---

## BNG-021 — Kata kunci `void` tidak diparse sebagai operator unary

- **Tanggal**: 2026-11-11
- **Komponen**: `compiler/parser/parser.js`
- **Severity**: Medium
- **Deskripsi**: `void flushQueue();` gagal dengan
  `SyntaxError: Unexpected token ';'` — `void` dibaca sebagai identifier
  sehingga panggilan fungsi terputus jadi dua statement.
- **Root cause**: `void` ada di keyword list tapi tidak ditangani di
  `parseUnary`.
- **Perbaikan**: Tambahkan cabang `void` di `parseUnary` yang mengonsumsi
  token dan meng-parse argumen unary.
- **Fix applied**: Ya.
- **Regression test**: `tests/unit/parser.test.js` — kasus "unary dan update
  expression".
- **Status**: Fixed

---

## BNG-022 — `typeof` tanpa spasi menyatu dengan literal berikutnya

- **Tanggal**: 2026-11-11
- **Komponen**: `compiler/codegen/generator.js`
- **Severity**: High
- **Deskripsi**: `typeof 42` dikompilasi menjadi `typeof42` →
  `ReferenceError: typeof42 is not defined`.
- **Root cause**: `generateUnary` menyisipkan `typeof` tanpa spasi setelah
  operator kata kunci.
- **Perbaikan**: Selalu sisipkan spasi setelah operator kata kunci unary
  (`typeof`, `void`, `delete`).
- **Fix applied**: Ya.
- **Regression test**: `tests/regression/bugs.test.js` — "BNG-012: keyword
  typeof dapat dipakai sebagai operator" mengeksekusi hasilnya.
- **Status**: Fixed

---

## BNG-023 — Bundler tidak memanggil entry point saat build

- **Tanggal**: 2026-11-11
- **Komponen**: `compiler/bundler.js`
- **Severity**: Critical
- **Deskripsi**: `node dist/server.js` tidak menghasilkan output apa pun —
  proses keluar diam-diam tanpa menjalankan server.
- **Root cause**: Bundler hanya mendaftarkan modul dalam `__bngRequire`
  tanpa pernah memanggil ekspor `main` dari entry.
- **Perbaikan**: Tambahkan di akhir bundle: ambil modul entry, panggil
  `main()` bila ada, dan pasang `.catch()` pada promise yang dikembalikan
  agar error tidak hilang.
- **Fix applied**: Ya.
- **Regression test**: `tests/integration/crud-demo.test.js` memverifikasi
  aplikasi yang dibangun dapat dijalankan dan melayani request.
- **Status**: Fixed

---

## BNG-024 — Aset statis tidak pernah disajikan (404)

- **Tanggal**: 2026-11-11
- **Komponen**: `runtime/http/server.js`
- **Severity**: High
- **Deskripsi**: `index.html`, `style.css`, `client.js`, dan `sw.js`
  semuanya 404 meski `staticDir` sudah dikonfigurasi.
- **Root cause**: Opsi `staticDir` disimpan di constructor tetapi tidak
  pernah dipakai; tidak ada implementasi penyajian berkas statis.
- **Perbaikan**: Implementasikan `serveStatic(request, response)` dengan
  `safeJoin` untuk normalisasi path, dan panggil sebagai fallback saat
  router melempar `NOT_FOUND` pada method GET/HEAD.
- **Fix applied**: Ya.
- **Regression test**: `tests/integration/crud-demo.test.js` — kasus
  "aset statis disajikan dari folder public".
- **Status**: Fixed

---

## BNG-025 — Respons error server tidak mengikuti kontrak `{ status, msg }`

- **Tanggal**: 2026-11-11
- **Komponen**: `runtime/http/server.js`
- **Severity**: Medium
- **Deskripsi**: Error API mengembalikan `{ error, message }`, sedangkan
  aplikasi dan consumer lain mengharapkan `{ status, msg }`.
- **Root cause**: `handleError` menyusun body respons dari bentuk default
  JavaScript, bukan dari kontrak Bonang.
- **Perbaikan**: `handleError` kini menghasilkan
  `{ status: 'error', msg, error, message, details? }` — alias `error` dan
  `message` dipertahankan agar consumer lama tidak rusak.
- **Fix applied**: Ya.
- **Regression test**: `tests/integration/crud-demo.test.js` — kasus 400
  dan 404 memeriksa bentuk `status`/`msg`.
- **Status**: Fixed

---

## BNG-026 — `NotFoundError` dan `ConflictError` membuang `details`

- **Tanggal**: 2026-11-11
- **Komponen**: `runtime/core/runtime.js`
- **Severity**: Medium
- **Deskripsi**: `new ConflictError("bentrok", { server: {...} })` kehilangan
  objek details, sehingga client offline tidak bisa menampilkan data server.
- **Root cause**: Kedua kelas menerima satu argumen saja dan tidak
  meneruskan `details` ke `BonangError`.
- **Perbaikan**: Tambahkan parameter kedua `details = null` dan teruskan
  ke `super(...)`.
- **Fix applied**: Ya.
- **Regression test**: `tests/regression/bugs.test.js` — "BUG-014:
  ConflictError dan NotFoundError membawa details".
- **Status**: Fixed

---

## BNG-027 — `timingSafeEqual` hanya menerima Buffer

- **Tanggal**: 2026-11-11
- **Komponen**: `runtime/security/security.js`
- **Severity**: Medium
- **Deskripsi**: `timingSafeEqual('abc', 'abc')` melempar
  `TypeError: The "otherBuffer" argument must be an instance of Buffer`.
- **Root cause**: Fungsi langsung memanggil `crypto.timingSafeEqual` yang
  hanya menerima Buffer; tidak ada normalisasi input.
- **Perbaikan**: Normalisasi string ke `Buffer.from(String(x))` sebelum
  perbandingan.
- **Fix applied**: Ya.
- **Regression test**: `tests/security/security.test.js` — "timingSafeEqual
  membandingkan string dengan benar" dan "... Buffer dengan benar".
- **Status**: Fixed

---

## BNG-028 — Beban 500/1000 request ditolak dengan ECONNREFUSED

- **Tanggal**: 2026-11-11
- **Komponen**: `runtime/http/server.js`, `tests/concurrency/concurrency.test.js`
- **Severity**: High
- **Deskripsi**: Pada konkurensi 500 dan 1000, sebagian besar request gagal
  dengan `ECONNREFUSED`.
- **Root cause**: Backlog `listen()` bawaan Node (511) di-combined dengan
  batas backlog OS Windows (±232 koneksi simultan) menolak koneksi excess
  saat tiap request membuka koneksi baru.
- **Perbaikan**: (a) naikkan backlog ke 8192; (b) harness benchmark memakai
  `http.Agent` dengan `keepAlive: true` dan jumlah socket dibatasi — cara
  kerja tool benchmark sungguhan.
- **Catatan**: `httpServer.maxConnections = 0` sempat dicoba dan **menyebabkan
  seluruh request gagal** — Node membaca 0 sebagai "tolak semua koneksi".
  Pengaturan itu sudah dihapus. Lihat `docs/TECHNICAL_DECISIONS.md` TD-009.
- **Fix applied**: Ya.
- **Regression test**: `tests/concurrency/concurrency.test.js` — empat
  tingkat konkurensi 10/100/500/1000, semua request sukses.
- **Status**: Fixed

---

## BNG-029 — Entri antrean sinkronisasi gagal permanen diulang selamanya

- **Tanggal**: 2026-11-11
- **Komponen**: `runtime/client/client.js`
- **Severity**: Medium
- **Deskripsi**: Entri yang ditolak server (mis. entitas sudah dihapus)
  tetap berada di antrean dan dikirim ulang pada setiap flush — antrean tumbuh
  tanpa batas.
- **Root cause**: `SyncQueue.flush` tidak menghapus entri yang gagal.
- **Perbaikan**: Entri yang gagal dengan `permanent !== false` dibuang dari
  antrean; entri dengan status lain dibiarkan agar opportunity berikutnya
  mencoba lagi.
- **Fix applied**: Ya.
- **Regression test**: `tests/offline/offline.test.js` — kasus flush dengan
  kegagalan permanen dan kegagalan sementara.
- **Status**: Fixed

---

## BNG-030 — Route `/` mengembalikan JSON info, bukan HTML aplikasi

- **Tanggal**: 2026-11-11
- **Komponen**: `apps/bonang-crud-demo/src/server/app.bng`
- **Severity**: Low
- **Deskripsi**: Membuka `/` menampilkan JSON, bukan halaman aplikasi —
  route info menutupi fallback berkas statis.
- **Root cause**: Route info didaftarkan pada `/`, dan route terdaftar
  selalu didahulukan dibanding berkas statis.
- **Perbaikan**: Pindahkan route info ke `/api/info`; `/` kini dilayani
  `index.html`.
- **Fix applied**: Ya.
- **Regression test**: `tests/integration/crud-demo.test.js` — kasus aset
  statis dan kasus `/api/info`.
- **Status**: Fixed

---

## BNG-031 — Auditor salah membaca `this.table` sebagai data user

- **Tanggal**: 2026-11-11
- **Komponen**: `cli/auditor.js`
- **Severity**: High
- **Deskripsi**: `node cli/cli.js audit` melaporkan 8 temuan CRITICAL
  `sql-injection-template` pada `product-repository.bng`, padahal nilai yang
  diinterpolasi adalah konstanta program (`this.table = "products"`).
  Auditor membuat laporan palsu pada kode referensi proyek sendiri, sehingga
  tidak dapat dipakai sebagai gerbang kualitas.
- **Root cause**: Aturan template literal dicocokkan dengan regex atas teks
  mentah, sehingga tidak bisa membedakan konstanta program dari data yang
  berasal dari user.
- **Perbaikan**: Pemeriksaan template literal dipindah ke analisis AST.
  Interpolasi dianggap aman bila nilainya konstanta yang bisa dibuktikan:
  - `this.x` di-assign literal string di constructor atau sebagai properti
    kelas,
  - konstanta modul (`const TABLE = "products"`),
  - hasil `assertIdentifier(...)`,
  - atau literal biasa.
  Nilai `this.x` yang berasal dari parameter constructor **tetap**
  dilaporkan, karena tidak bisa dibuktikan aman.
- **Fix applied**: Ya.
- **Regression test**: `tests/tools/auditor.test.js` — 4 kasus: konstanta
  kelas aman, parameter constructor dilaporkan, interpolasi data user
  dilaporkan, dan aturannya lain masih bekerja.
- **Status**: Fixed

---

## BNG-032 — Auditor salah membaca `store.put`/`store.delete` sebagai route HTTP

- **Tanggal**: 2026-11-11
- **Komponen**: `cli/auditor.js`
- **Severity**: Medium
- **Deskripsi**: 7 temuan MEDIUM `missing-input-validation` dilaporkan pada
  `main.bng`, sebenarnya adalah pemanggilan IndexedDB
  (`store.put(ENTITY_STORE, id)`), bukan pendaftaran route.
- **Root cause**: Deteksi route hanya memeriksa nama metode
  (`get`/`post`/`put`/`patch`/`delete`) tanpa memeriksa receiver-nya, dan
  `put`/`delete` adalah nama metode yang sah pada IndexedDB store.
- **Perbaikan**: Receiver pemanggilan harus terlihat seperti router
  (`router`, `*router`, `app`, `server`, `api`). Receiver lain diabaikan.
- **Fix applied**: Ya.
- **Regression test**: `tests/tools/auditor.test.js` — kasus
  `store.put`/`store.delete` tidak menghasilkan temuan route.
- **Status**: Fixed

---

## BNG-033 — Deteksi validasi route selalu gagal (potongan handler kosong)

- **Tanggal**: 2026-11-11
- **Komponen**: `cli/auditor.js`
- **Severity**: High
- **Deskripsi**: 4 route yang memang memvalidasi input (POST/PUT/DELETE
  produk dan POST sync) tetap dilaporkan sebagai "tidak memvalidasi input".
- **Root cause**: Auditor memotong sumber dengan
  `source.slice(handler.start?.offset, handler.end?.offset)`, tetapi node AST
  Bonang hanya menyimpan `type`, `line`, dan `column` — tidak ada offset.
  Kedua optional-chain jatuh ke `0`, sehingga potongannya selalu `''` dan
  tidak pernah ada jejak validasi yang ditemukan.
- **Perbaikan**: Pemeriksaan diganti ke analisis AST, dengan resolutions
  delegasi:
  - handler berupa arrow function → periksa body,
  - delegasi `this.method(ctx)` → rekursi ke body method kelas tersebut,
  - handler berupa `this.method` → body method kelas,
  - handler berupa identifier → fungsi tingkat modul.
  Kontrol autentikasi juga dianggap sebagai rangkaian yang aman.
- **Fix applied**: Ya.
- **Regression test**: `tests/tools/auditor.test.js` — kasus route yang
  memvalidasi lewat delegasi (tidak dilaporkan), route yang tidak memvalidasi
  (tepat 1 temuan), dan route GET (tidak wajib validasi).
- **Status**: Fixed

---

## BNG-034 — `export class` tidak dikenali oleh analisis AST auditor

- **Tanggal**: 2026-11-11
- **Komponen**: `cli/auditor.js`
- **Severity**: High
- **Deskripsi**: Setelah rewrite, `analyzeProgram` tidak menemukan kelas
  mana pun pada berkas yang memakai `export class`, sehingga konstanta
  kelas (`this.table`) tidak pernah terdaftar dan semua interpolasi SQL
  dilaporkan sebagai berbahaya.
- **Root cause**: `export class X {}` dibungkus `ExportDeclaration` dengan
  deklarasi di dalam `declaration`; pemindaian hanya melihat
  `ast.body` tingkat atas.
- **Perbaikan**: `analyzeProgram` membuka `ExportDeclaration` dan
  memproses deklarasi yang dibungkusnya.
- **Fix applied**: Ya.
- **Regression test**: `tests/tools/auditor.test.js` — seluruh fixture
  memakai `export class`.
- **Status**: Fixed

---

## BNG-035 — `checkConfigFiles` hilang saat rewrite auditor

- **Tanggal**: 2026-11-11
- **Komponen**: `cli/auditor.js`
- **Severity**: High
- **Deskripsi**: `node cli/cli.js audit` gagal dengan
  `TypeError: this.checkConfigFiles is not a function`, sehingga perintah
  audit tidak bisa dijalankan sama sekali.
- **Root cause**: Metode `checkConfigFiles` ada pada versi auditor lama
  tetapi tidak ikut ditulis ulang.
- **Perbaikan**: Metode dikembalikan: memeriksa `.env`, `.env.local`,
  `.env.production`, `bonang.config.js`, dan `config.json` untuk secret
  hardcoded.
- **Fix applied**: Ya.
- **Regression test**: `node cli/cli.js audit` — berjalan dan melaporkan
  0 temuan pada aplikasi referensi.
- **Status**: Fixed

---

## BNG-036 — `QueryBuilder.join` menyisipkan jenis dan kondisi JOIN tanpa validasi

- **Tanggal**: 2026-11-11
- **Komponen**: `runtime/database/query-builder.js`
- **Severity**: High
- **Deskripsi**: `join(table, onCondition, type)` menyisipkan `type` dan
  `onCondition` mentah ke SQL. Kouisi `onCondition` adalah SQL bebas,
  bukan placeholder, sehingga bisa membawa injeksi SQL — bertentangan dengan
  kontrak builder yang memvalidasi nama tabel dan kolom.
- **Root cause**: Hanya `table` yang divalidasi; dua argumen lain
  disisipkan apa adanya.
- **Perbaikan**:
  - Jenis JOIN dibatasi pada allowlist `INNER`, `LEFT`, `LEFT OUTER`, `CROSS`.
  - Kondisi JOIN harus berbentuk perbandingan dua nama kolom dengan `=`
    (opsional berawalan tabel), divalidasi oleh `assertJoinCondition`.
  - Nama tabel join tetap divalidasi sebagai identifier.
- **Fix applied**: Ya.
- **Regression test**: `tests/database/database.test.js` — kasus JOIN yang
  benar, jenis JOIN berbahaya, kondisi JOIN berupa SQL bebas, dan nama
  tabel JOIN berbahaya.
- **Status**: Fixed

---

## BNG-037 — Scaffold `bonang init` mengirim route POST tanpa validasi input

- **Tanggal**: 2026-11-11
- **Komponen**: `cli/cli.js` (template `ROUTES_TEMPLATE`)
- **Severity**: Medium
- **Deskripsi**: Proyek yang dibuat `bonang init` memuat route
  `POST /api/echo` yang langsung memakai `ctx.json()` tanpa memvalidasi
  body. `bonang audit` pada proyek hasil `init` melaporkan 1 temuan
  MEDIUM, dan setiap proyek baru dimulai dengan pola yang salah.
- **Root cause**: Template scaffold ditulis tanpa memanggil `ctx.validate`,
  padahal validasi body adalah API bawaan runtime
  (`runtime/http/server.js`, `Request.validate`).
- **Perbaikan**: Route `/api/echo` memakai
  `ctx.validate({ message: { type: "string", required: true } })`.
  Body tidak valid sekarang ditolak dengan 400 `VALIDATION_ERROR`.
- **Fix applied**: Ya.
- **Regression test**: `tests/tools/cli.test.js` — scaffold hasil `init`
  harus audit bersih, lint tanpa error, dan route POST mengembalikan 400
  untuk body yang tidak valid.
- **Status**: Fixed

---

## BNG-038 — Test CLI menggantung dan gagal cleanup karena proses anak belum mati

- **Tanggal**: 2026-11-11
- **Komponen**: `tests/tools/cli.test.js`
- **Severity**: Medium
- **Deskripsi**: Suite test CLI menggantung ~90 detik dan gagal dengan
  `EPERM: Permission denied` saat menghapus folder proyek — server yang
  dijalankan sebagai proses anak masih memegang folder tersebut.
- **Root cause**: `child.kill()` dipanggil tanpa menunggu proses benar-benar
  keluar, dan hook cleanup menghapus folder sebelum server berhenti.
- **Perbaikan**: `stop()` menunggu event `exit` child sebelum cleanup,
  dan kedua langkah digabung dalam satu hook `after`.
- **Fix applied**: Ya.
- **Regression test**: Durasi suite turun dari 89.969 ms menjadi
  2.400 ms pada `tests/tools/cli.test.js`.
- **Status**: Fixed

---

## Ringkasan

| ID | Komponen | Severity | Status |
| --- | --- | --- | --- |
| BNG-001 | Parser | Medium | Fixed |
| BNG-002 | Parser | Medium | Fixed |
| BNG-003 | Parser | Medium | Fixed |
| BNG-004 | Parser | Low | Fixed |
| BNG-005 | Parser | High | Fixed |
| BNG-006 | Parser | Medium | Fixed |
| BNG-007 | Parser | High | Fixed |
| BNG-008 | Lexer + Parser | High | Fixed |
| BNG-009 | Lexer + Parser | Medium | Fixed |
| BNG-010 | Codegen | Critical | Fixed |
| BNG-011 | Codegen | High | Fixed |
| BNG-012 | Lexer + Parser | Medium | Fixed |
| BNG-013 | Codegen | Medium | Fixed |
| BNG-014 | Parser + Codegen | Medium | Fixed |
| BNG-015 | Codegen | Medium | Fixed |
| BNG-016 | Compiler | Critical | Fixed |
| BNG-017 | Codegen | High | Fixed |
| BNG-018 | Demo app | High | Fixed |
| BNG-019 | Demo app | High | Fixed |
| BNG-020 | Demo app | Medium | Fixed |
| BNG-021 | Parser | Medium | Fixed |
| BNG-022 | Codegen | High | Fixed |
| BNG-023 | Bundler | Critical | Fixed |
| BNG-024 | HTTP server | High | Fixed |
| BNG-025 | HTTP server | Medium | Fixed |
| BNG-026 | Runtime core | Medium | Fixed |
| BNG-027 | Security | Medium | Fixed |
| BNG-028 | HTTP server | High | Fixed |
| BNG-029 | Client runtime | Medium | Fixed |
| BNG-030 | Demo app | Low | Fixed |
| BNG-031 | Auditor CLI | High | Fixed |
| BNG-032 | Auditor CLI | Medium | Fixed |
| BNG-033 | Auditor CLI | High | Fixed |
| BNG-034 | Auditor CLI | High | Fixed |
| BNG-035 | Auditor CLI | High | Fixed |
| BNG-036 | Query builder | High | Fixed |
| BNG-037 | CLI scaffold | Medium | Fixed |
| BNG-038 | Test tooling | Medium | Fixed |

**Total: 38 bug tercatat, 38 Fixed, 0 Open.**

Siklus yang dipakai setiap kali bug ditemukan:

1. **Reproduksi** — test yang gagal atau error nyata dari CLI.
2. **Root cause** — ditelusuri ke baris kode yang benar-benar salah.
3. **Perbaikan minimal** — hanya bagian yang salah, tanpa refactor
   menyeluruh.
4. **Regression test** — test yang mengunci perilaku yang benar.
5. **Verifikasi** — suite penuh dijalankan; tidak ada test yang dinonaktifkan.
