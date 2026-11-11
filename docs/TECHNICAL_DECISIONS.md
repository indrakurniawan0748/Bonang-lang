# TECHNICAL DECISIONS — BONANG

Catatan keputusan teknis (ADR-style). Setiap keputusan mencatat konteks,
opsi yang dipertimbangkan, pilihan yang diambil, dan konsekuensinya.
Keputusan yang dibatalkan tetap dicatat.

---

## TD-001 — Bahasa diimplementasikan sebagai transpiler ke JavaScript

- **Status**: Dipakai
- **Tanggal**: 2026-11-11
- **Konteks**: BONANG harus benar-benar bisa dijalankan, bukan sekadar
  didokumentasikan. Environment tidak punya Rust/Go (lihat
  `docs/ENVIRONMENT_AUDIT.md`), sehingga compiler native tidak bisa dibangun.
- **Opsi**:
  1. Compiler native (LLVM/Rust) — tidak mungkin di environment ini.
  2. Interpreter bytecode sendiri — butuh weeks of work untuk tahap
     Salamanca, dan tidak menambah nilai fungsional.
  3. Transpiler ke JavaScript, dieksekusi V8 — bisa ditulis, diuji, dan
     diukur sekarang juga.
- **Keputusan**: Opsi 3. Source `.bng` → Lexer → Parser (Pratt) → AST →
  Code Generator → JavaScript → V8.
- **Konsekuensi**:
  - Zero dependensi npm. Tidak ada langkah install.
  - Build cepat dan deterministik.
  - Performa runtime identik JavaScript; klaim "lebih cepat" harus dibuktikan
    benchmark, tidak diasumsikan.
  - Output bisa jalan di Node, browser, Deno, dan Bun tanpa perubahan.
  - Type annotation hanya diparse, tidak dieksekusi (type checker belum ada).

---

## TD-002 — Nol dependensi eksternal

- **Status**: Dipakai
- **Konteks**: `prompt.md` mensyaratkan setiap dependensi punya alasan yang
  bisa dipertanggungjawabkan.
- **Opsi**: (a) pakai npm ecosystem; (b) hanya Node built-ins.
- **Keputusan**: Hanya `node:*` built-ins. `package.json` tidak punya
  `dependencies` maupun `devDependencies`.
- **Konsekuensi**:
  - `npm install` tidak diperlukan untuk build, test, atau run.
  - Tidak ada CVE dari rantai supply.
  - Yang benar-benar dibutuhkan (SQLite, HTTP server, test runner) sudah
    ada sebagai built-in Node 24.

---

## TD-003 — Placeholder SQL positional `?` saja

- **Status**: Dipakai
- **Konteks**: Akses database memakai `node:sqlite` dengan native prepared
  statement.
- **Opsi**: (a) named placeholder `:nama`; (b) positional `?`.
- **Keputusan**: Positional `?` saja, termasuk di QueryBuilder.
- **Alasan**: Native prepare tidak mengizinkan satu named placeholder dipakai
  berulang dalam satu statement (SQLSTATE HY093). Positional boleh diulang
  dan nilainya cukup diulang di array `execute()`. Named placeholder dipakai
  di tempat lain pada stack PHP proyek ini adalah keputusan berbeda karena
  PDO memakai emulated prepares.
- **Konsekuensi**: Nilai yang sama di beberapa tempat ditulis beberapa kali
  di query dan diulang di array parameter. QueryBuilder menyembunyikan ini
  dari pengguna akhir.

---

## TD-004 — QueryBuilder memakai allowlist, bukan escaping

- **Status**: Dipakai
- **Konteks**: Nama tabel/kolom tidak bisa diparameterkan — nilainya masuk ke
  teks SQL.
- **Opsi**: (a) escape identifier dengan backtick; (b) allowlist pola
  identifier yang ketat.
- **Keputusan**: `assertIdentifier()` menerima hanya `^[A-Za-z_][A-Za-z0-9_]*$`
  (dengan `*` sebagai wildcard untuk kolom COUNT) dan menolak sisanya.
  Operator juga punya allowlist (`=`, `<`, `>`, `<=`, `>=`, `<>`, `!=`, `LIKE`,
  `IN`, `NOT IN`, `IS`, `IS NOT`).
- **Konsekuensi**: Setiap nama kolom yang dinamis harus lolos allowlist lebih
  dulu. Kegagalan ditolak diam-diam — pemanggil mendapat exception, bukan
  query yang salah.

---

## TD-005 — Placeholder syntax: `fn`, bukan `function`

- **Status**: Dipakai
- **Konteks**: Nama keyword `function` di reserved-word JS membuat
  `export function` bermasalah di beberapa konteks.
- **Opsi**: (a) `function`; (b) `fn` dengan `function` sebagai alias.
- **Keputusan**: `fn` adalah keyword utama; `function` tetap diterima sebagai
  alias agar transisi tidak menyakitkan.
- **Konsekuensi**: `export fn` diparse sebagai deklarasi fungsi; template
  proyek dan seluruh contoh memakai `fn`.

---

## TD-006 — Multi-target: `server` / `client` / `shared`

- **Status**: Dipakai
- **Konteks**: BONANG Schauspieler full-stack; satu basis kode perlu bisa
  dipakai di server dan browser.
- **Keputusan**: Modifier di depan deklarasi atau statement
  (`server fn`, `client fn`, `shared const`) menentukan target build.
  Folder `src/server/`, `src/client/`, dan `src/shared/` menjadi konvensi
  default yang dipakai.
- **Konsekuensi**: Modul `shared` boleh di-import keduanya. Modul `server`
  tidak boleh masuk bundle browser (bisa menarik `node:fs`). Pemisahan
  target dijaga oleh bundler.

---

## TD-007 — Backtracking pada parser untuk membedakan grouping vs arrow

- **Status**: Dipakai
- **Konteks**: `(a + b) * c` dan `(a, b) => a + b` sama-sama diawali `(`.
- **Opsi**: (a) lookahead satu token; (b) parse spekulatif dengan backtracking.
- **Keputusan**: `tryParseArrowParams()` mencoba parse daftar parameter,
  menyimpan `this.index` sebelum mencoba, dan memulihkannya bila token `=>`
  tidak ditemukan.
- **Konsekuensi**: Biaya satu parse tambahan pada ekspresi berawalan `(`
  — Rebuild menambah sekitar 4% overhead lexer, diukur negligible. Grammar tetap
  dapat diekspresikan tanpa lookahead bertingkat.

---

## TD-008 — Static file serving sebagai fallback saat route tidak cocok

- **Status**: Dipakai
- **Konteks**: Aplikasi full-stack perlu menyajikan `index.html` dan aset
  tanpa menulis route manual untuk tiap berkas.
- **Opsi**: (a) route eksplisit per aset; (b) fallback statis pada 404.
- **Keputusan**: `serveStatic()` dipanggil hanya bila router melempar
  `NOT_FOUND` **dan** method GET/HEAD. Route terdaftar selalu didahulukan.
- **Konsekuensi**: Tidak ada aset yang tertutup route. Path statis dinormalkan
  lewat `safeJoin` sehingga `..` tidak bisa keluar dari folder statis.

---

## TD-009 — `maxConnections` dibiarkan default pada HTTP server

- **Status**: Dipakai
- **Konteks**: Beban 500/1000 request paralel menghasilkan `ECONNREFUSED`.
- **Hipotesis awal (SALAH)**: DUGAAN bahwa `maxConnections = 0` akan
  mengizinkan semua koneksi.
- **Temuan**: Node membaca `0` sebagai "tolak semua koneksi" — menyetelnya
  membuat **seluruh** request gagal.
- **Keputusan**: `maxConnections` dibiarkan default (unlimited). Backlog
  listen dinaikkan dari 511 ke 8192.
- **Konsekuensi**: Root cause sebenarnya adalah batas backlog OS Windows
  (±232 koneksi simultan), bukan kode server. Test harness memakai
  `http.Agent` keep-alive — praktik standar tool benchmark.

---

## TD-010 — Service worker untuk offline-first

- **Status**: Dipakai
- **Konteks**: Syarat offline-first exige aset tetap tersedia tanpa jaringan.
- **Keputusan**: `apps/bonang-crud-demo/public/sw.js` meng-cache shell
  aplikasi (HTML, CSS, JS client) dengan strategi cache-first untuk aset
  statis dan network-first untuk API. IndexedDB menyimpan data domain; antrean
  sinkronisasi menyimpan operasi yang belum terkirim.
- **Konsekuensi**: Konflik dipecahkan dengan last-write-wins berdasarkan
  `updatedAt`. `baseVersion` pada endpoint update mendeteksi edit yang
  bertentangan dan mengembalikan 409.

---

## TD-011 — Sinkronisasi memakai last-write-wins, bukan CRDT

- **Status**: Dipakai
- **Konteks**: Offline-first berarti dua perangkat bisa mengedit entitas
  yang sama saat keduanya offline.
- **Opsi**: (a) LWW; (b) CRDT/OT; (c) versioning dengan konkurensi optimistis.
- **Keputusan**: LWW di sisi client untuk IndexedDB, ditambah deteksi
  konflik berbasis `baseVersion` di server (409). Vendor-specific
  conflict resolution shipped sebagai helper (`resolveConflict`).
- **Alasan**: LWW cukup untuk data katalog (kasus demo). CRDT menambah
  kompleksitas besar tanpa ada kebutuhan yang terbukti.
- **Konsekuensi**:-documented sebagai limitations. Entri antrean yang gagal
  permanen dibuang supaya tidak diulang selamanya.

---

## TD-012 — Type annotation diparse, tidak di enforcement

- **Status**: Dipakai (dengan batasan diketahui)
- **Konteks**: Anotasi tipe memberi DX baik, tapi type checker penuh butuh
 inferensi yang besar.
- **Keputusan**: Anotasi tipe diparse ke AST (`TypeAnnotationNode`) dan
  **diabaikan** saat codegen. Runtime BonangDY memvalidasi bentuk data
  melalui `validate()` pada Request dan validator di service.
- **Konsekuensi**: `fn f(x: int): string` berjalan seperti JavaScript biasa.
  Ini dicatat di `docs/KNOWN_LIMITATIONS.md` dan tidak diklaim sebagai
  type-safe.

---

## TD-013 — Struktur error: `status` + `msg` sebagai kontrak utama

- **Status**: Dipakai
- **Konteks**: Respons error server harus konsisten dan aman ditampilkan.
- **Keputusan**: `handleError` menghasilkan
  `{ status: "error", msg, error, message, details? }`. `error` dan
  `message` dipertahankan sebagai alias agar consumer lama tidak rusak.
  Detail internal (stack trace) hanya di mode `BONANG_ENV=development`.
- **Konsekuensi**: Detail tidak pernah bocor ke produksi; kode bonus masih
  kompatibel.

---

## TD-014 — CLI `test` hanya menjalankan file `.test.bng`

- **Status**: Dipakai
- **Konteks**: CLI `bonang test` adalah tester untuk **kode pengguna**;
  test suite internal BONANG memakai `node:test`.
- **Keputusan**: `bonang test` mencari `*.test.bng` dan mengeksekusinya via
  compiler. Test internal repositori dijalankan `node --test`.
- **Konsekuensi**: Dua runner dengan dua format. Ini dipisah dengan jelas di
  `docs/TEST_REPORT.md`.

---

## TD-015 — Paket Bonang ditulis dalam JavaScript, bukan Bonang

- **Status**: Dipakai
- **Konteks**: Compiler Bonang adalah target bootstrapping: bundler harus
  bisa membundel output compiler sendiri.
- **Keputusan**: Compiler, runtime, CLI, dan standard library ditulis dalam
  JavaScript CommonJS. Kode Bonang murni dipakai pada aplikasi contoh dan
  test.
- **Alasan**: Menulis compiler dalam bahasa yang dikompilasi sendiri
  memerlukan compiler yang sudah ada — chicken-and-egg. Compiler dalam JS
  bisa dibundel output Bonang kapan saja (terbukti: `bonang build` pada
  aplikasi demo menghasilkan bundle mandiri).
- **Konsekuensi**: Toolchain bisa dibangun ulang sendiri nanti.

---

## TD-016 — Serialisasi error: `details` diteruskan pada NotFound/Conflict

- **Status**: Dipakai
- **Konteks**: Client offline perlu tahu data server saat konflik agar bisa
  menampilkan diff.
- **Keputusan**: `NotFoundError` dan `ConflictError` menerima argumen kedua
  `details` yang diteruskan ke body respons.
- **Konsekuensi**: `/api/products/:id?baseVersion=...` mengembalikan 409
  beserta `details.server` berisi record terbaru.

---

## TD-017 — Penyimpanan SQLite memakai mode WAL

- **Status**: Dipakai
- **Konteks**: Demo CRUD perlu mendukung reader paralel saat writer aktif.
- **Keputusan**: `PRAGMA journal_mode = WAL`, `PRAGMA foreign_keys = ON`,
  `PRAGMA busy_timeout = 5000`.
- **Konsekuensi**: Reader tidak diblokir writer; test konkurensi
  "reader paralel saat writer aktif" lulus tanpa data rusak.

---

## Ringkasan

| ID | Keputusan | Status |
| --- | --- | --- |
| TD-001 | Transpiler ke JavaScript | Dipakai |
| TD-002 | Nol dependensi eksternal | Dipakai |
| TD-003 | Placeholder SQL positional | Dipakai |
| TD-004 | Allowlist identifier & operator | Dipakai |
| TD-005 | Keyword `fn` | Dipakai |
| TD-006 | Multi-target server/client/shared | Dipakai |
| TD-007 | Backtracking parser | Dipakai |
| TD-008 | Static serving sebagai fallback 404 | Dipakai |
| TD-009 | `maxConnections` default, backlog 8192 | Dipakai |
| TD-010 | Service worker offline-first | Dipakai |
| TD-011 | Last-write-wins + deteksi konflik | Dipakai |
| TD-012 | Anotasi tipe diparse, tidak di-enforce | Dipakai |
| TD-013 | Kontrak error `status`/`msg` | Dipakai |
| TD-014 | CLI `test` khusus `.test.bng` | Dipakai |
| TD-015 | Toolchain ditulis dalam JS | Dipakai |
| TD-016 | `details` pada NotFound/Conflict | Dipakai |
| TD-017 | SQLite mode WAL | Dipakai |
