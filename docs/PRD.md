# PRD — BONANG (Browser Optimized Network And Native Graphics)

**Versi dokumen**: 1.0
**Tanggal**: 2026-11-11
**Status**: Disetujui untuk implementasi

---

## 1. Ringkasan Eksekutif

BONANG adalah bahasa pemrograman full-stack yang dirancang untuk satu
basis kode yang berjalan di server (Node.js) maupun di browser, dengan
pendekatan *offline-first* sebagai sifat bawaan, bukan fitur tambahan.

BONANG bukan bahasa eksperimental tanpa implementasi. Repository ini berisi
compiler (lexer → parser → codegen), runtime, standard library, CLI, dan
satu aplikasi CRUD lengkap yang ditulis **dalam bahasa Bonang** sebagai
bukti penerimaan.

### Masalah yang diselesaikan

| Pain point mediation | Solusi BONANG |
| --- | --- |
| Frontend dan backend butuh dua bahasa, dua toolchain, dua debugger | Satu bahasa, satu toolchain, satu format modul |
| Aplikasi CRUD mengulang 80% boilerplate yang sama | Standard library + template `bonang init` |
| Aplikasi mobile/field butuh berjalan tanpa jaringan | Offline-first: IndexedDB + antrean sinkronisasi bawaan |
| S Hal ini — "offline" biasanya berarti menulis IndexedDB manual | `IndexedDBStore` dan `SyncQueue` sudah tersedia di runtime |
| Bahasa baru berarti toolchain dari nol |  Compiler sendiri ditulis dalam JS dan dapat membangun ulang outputnya sendiri |

### Bentuk bahasa (satu kalimat)

> JavaScript-like syntax dengan keyword `fn`, anotasi tipe opsional,
> orientasi OOP lengkap, multi-target `server`/`client`/`shared`, dan
> runtime full-stack bawaan — dikompilasi ke JavaScript murni, tanpa
> dependensi eksternal.

---

## 2. Persona

| Persona | Kebutuhan | Yang diberikan BONANG |
| --- | --- | --- |
| **Web developer** yang pindah dari Node ke full-stack | Satu bahasa untuk API + UI | Multi-target build, modul `shared` |
| **Developer** yang membangun aplikasi untuk jaringan buruk | Berjalan offline, sinkronisasi nanti | IndexedDB store, sync queue, resolusi konflik |
| **Tim yang ingin produktivitas** | Boilerplate minimal | `bonang init`, standard library, CRUD template |
| **Pemula** yang belajar bahasa baru | Sintaks familier, error jelas | Grammar mirip JS, pesan error berfile:baris:kolom |
| **QA/auditor** | menjamin keamanan | Linter, auditor keamanan, prepared statement wajib |

---

## 3. Use Case

### UC-1 — CRUD API + UI dalam satu bahasa

**Sebagai** developer web, **saya ingin** menulis endpoint dan UI dalam satu
bahasa, **agar** tidak perlu mengelola dua basis kode yang bisa berbeda
versi.

**Kriteria penerimaan**: aplikasi `bonang-crud-demo` memiliki
`src/server/*.bng` dan `src/client/*.bng`, dibangun ke satu bundle per
target, dan endpoint REST bekerja nyata.

### UC-2 — Aplikasi yang tetap berfungsi saat offline

**Sebagai** pengguna field, **saya ingin** menambah produk di lokasi tanpa
sinyal, **agar** data tidak hilang dan tersinkron otomatis saat online.

**Kriteria penerimaan**: entri tersimpan di IndexedDB, antrean operasi
meningkat, saat online antrean.flush() mengirim ke server, konflik
dideteksi lewat `baseVersion` dan menghasilkan 409.

### UC-3 — Proyek baru dalam satu perintah

**Sebagai** developer, **saya ingin** `bonang init` membuat proyek yang
langsung jalan, **agar** tidak perlu menyusun struktur sendiri.

**Kriteria penerimaan**: `bonang init` membuat `bonang.config.json`,
`src/`, `tests/`, `migrations/`, dan `public/`; `bonang build` dan
`bonang dev` langsung berfungsi.

### UC-4 — Migrasi database yang bisa dijalankan ulang

**Sebagai** developer, **saya ingin** migrasi idempoten, **agar** bisa
dijalankan di setiap deploy tanpa duplikasi.

**Kriteria penerimaan**: tabel `bonang_migrations` mencatat migrasi yang
sudah diterapkan; `migrate up` melewati yang sudah ada; `migrate down`
melakukan rollback.

### UC-5 — Audit keamanan sebelum deploy

**Sebagai** lead, **saya ingin** `bonang audit` menandai pola berbahaya,
**agar** masalah ketahuan lebih awal.

**Kriteria penerimaan**: auditor memeriksa hardcoded secret, SQL injection,
XSS, path traversal, route tanpa validasi, dan secret di config.

---

## 4. Lingkup

### 4.1 Termasuk (v0.1)

**Bahasa**
- Tipe lexical: `int`, `float`, `string`, `bool`, `any`, `void`, `never`,
  `object`.
- Kontrol alur: `if/else`, `while`, `for` (C-style dan `for..in`/`for..of`),
  `switch`, `try/catch/finally`, `throw`, `break`, `continue`, `return`.
- Fungsi: deklarasi `fn`, arrow function, parameter bertipe opsional,
  async/await.
- OOP: `class`, `extends`, `implements`, `interface`, `enum`, `constructor`,
  `static`, `get`/`set`, `abstract`, `override`, `public`/`private`/
  `protected`/`readonly`.
- Modul: `import`/`export`, alias, `namespace`, `type` alias.
- Literal: number, string, template literal, boolean, `null`, `undefined`,
  array, object, spread.
- Operator: aritmetika, perbandingan, logika, penugasan, update, unary
  (`typeof`, `void`, `delete`), optional chaining, nullish coalescing,
  ternary.
- Multi-target: `server`, `client`, `shared`.

**Toolchain**
- Compiler CLI (`bonang run`, `bonang build`).
- Bundler menghasilkan file JS mandiri.
- CLI: `init`, `run`, `build`, `dev`, `test`, `lint`, `audit`, `bench`,
  `migrate`, `version`.
- Linter (9 aturan), auditor keamanan (6 pemeriksaan), benchmark (5
  skenario), runner migrasi.

**Runtime**
- HTTP server + router (parameter, wildcard, middleware, 405).
- Connection pool SQLite + query builder aman.
- Utilitas: async scheduler, worker pool, filesystem aman, HTTP client dengan
  retry, session store, rate limiter, primitif kriptografi.
- Client runtime: IndexedDB store, sync queue, resolusi konflik, service
  worker.

### 4.2 Tidak Termasuk (v0.1)

- Type checker statis dengan inferensi.
- Generic dan tipe parameterik.
- Macro/compile-time evaluation.
- Async multi-thread native (hanya `node:worker_threads` via `WorkerPool`).
- Clustering / multi-process.
- Registry paket privat, workspace.
- Native graphics (nama "Native Graphics" adalah visi; v0.1 berfokus pada
  web graphics via Canvas/DOM).

---

## 5. Kebutuhan Non-Fungsional

| ID | Kebutuhan | Ukuran / Ambang | Cara verifikasi |
| --- | --- | --- | --- |
| NFR-01 | Build tanpa dependensi eksternal | 0 dependency | `package.json` kosong; `npm install` tidak perlu |
| NFR-02 | Test suite hijau | 100% pass | `node --test` pada 7 direktori test |
| NFR-03 | Latensi p95 pada 1000 request konkuren | < 1000 ms | `tests/concurrency` |
| NFR-04 | Tidak ada SQL injection | 0 jalur | `tests/database`, `tests/security` |
| NFR-05 | Error runtime tidak membocorkan stack ke produksi | 0 insiden | `handleError` + `BONANG_ENV` gate |
| NFR-06 | CLI benar-benar berfungsi | 10/10 perintah eksekutabel | Uji manual tiap perintah |
| NFR-07 | Aplikasi demo nyata | CRUD penuh + offline | `tests/integration/crud-demo.test.js` |
| NFR-08 | Build deterministik | Hash stabil untuk input sama | Bundler tanpa timestamp/waktu |
| NFR-09 | Waktu build | < 5 detik untuk proyek demo | `bonang build` |

---

## 6. Model concurrency

Dua mekanisme, dipisahkan jelas:

1. **Concurrency** — banyak operasi I/O tumpang tindih pada satu event
   loop. Ini model default BONANG. Handler HTTP, query database, dan
   panggilan HTTP keluar bersifat async dan non-blocking.
2. **Parallelism** — banyak thread menjalankan perhitungan CPU-bound.
   Disediakan `WorkerPool` berbasis `node:worker_threads`.

Yang **tidak** ada: thread-per-request, yang akan membuat I/O database
bermasalah.

---

## 7. Kontrak API

### Bentuk respons sukses

```json
{
  "status": "success",
  "data": { ... }
}
```

### Bentuk respons error

```json
{
  "status": "error",
  "msg": "Data produk tidak valid",
  "error": "VALIDATION_ERROR",
  "message": "Data produk tidak valid",
  "details": { "price": "Harga harus lebih besar dari 0" }
}
```

`error` dan `message` adalah alias yang dipertahankan untuk kompatibilitas.
`details` hanya diisi bila error punya konteks terstruktur. Stack trace
hanya disertakan saat `BONANG_ENV=development`.

### Pemetaan error ke status HTTP

| Kelas error | Status | Kode |
| --- | --- | --- |
| `ValidationError` | 400 | `VALIDATION_ERROR` |
| `AuthError` | 401 | `AUTH_ERROR` |
| `ForbiddenError` | 403 | `FORBIDDEN` |
| `NotFoundError` | 404 | `NOT_FOUND` |
| `ConflictError` | 409 | `CONFLICT` |
| `BonangError` (umum) | sesuai `statusCode` | sesuai `code` |
| Error tak dikenal | 500 | `INTERNAL_ERROR` |

---

## 8. Persyaratan Keamanan

1. **Tidak ada input user yang masuk ke string SQL.** Semua query memakai
   prepared statement dengan placeholder positional `?`.
2. **Identifier dinamis divalidasi allowlist.** `assertIdentifier` menolak
   apa pun di luar `^[A-Za-z_][A-Za-z0-9_]*$` (plus `*` untuk COUNT).
3. **Akses file selalu melewati `safeJoin`.** Path traversal ditolak di
   level path, bukan di level handler.
4. **Perbandingan rahasia timing-safe.** HMAC, token sesi, dan password
   di bandingkan dengan `crypto.timingSafeEqual`.
5. **Password di-hash dengan scrypt** + salt acak per hash.
6. **Body request dibatasi 5 MB.**
7. **Rate limiting** tersedia per kunci (IP, user, dll).
8. **Token CSRF stateless** berbasis HMAC session id.
9. **Error produksi tidak membocorkan detail internal.**
10. **Audit statis** tersedia lewat `bonang audit`.

---

## 9. Strategi Pengujian

| Lapis | Lokasi | Cakupan |
| --- | --- | --- |
| Unit | `tests/unit/` | Lexer, parser, codegen |
| Integrasi | `tests/integration/` | Runtime, aplikasi CRUD |
| Regresi | `tests/regression/` | Bug BNG-010..BNG-017 terkunci |
| Offline | `tests/offline/` | IndexedDB, sync queue, resolusi konflik |
| Konkurensi | `tests/concurrency/` | 10/100/500/1000 request, p50/p95/p99 |
| Database | `tests/database/` | Pool, transaksi, query builder, injection |
| Keamanan | `tests/security/` | Hash, CSRF, XSS, path, rate limit, session |

Runner: `node --test` (Node built-in). CLI `bonang test` terpisah untuk
file `.test.bng` milik pengguna.

---

## 10. Metrik Keberhasilan

| Metrik | Target | Status saat ini |
| --- | --- | --- |
| Perintah CLI yang berfungsi | 10/10 | 10/10 |
| Test yang lulus | 231/231 | 231/231 |
| Skenario benchmark terukur | 5 | 5 |
| Bug tercatat & ditutup | ≥ 17 | 17 |
| Dokumen desain | 12 | 12 |
| Aplikasi demo | 1 | 1 (`bonang-crud-demo`) |
| Dependency eksternal | 0 | 0 |

---

## 11. Risiko

Rincian lengkap di `docs/RISK_REGISTER.md`. Risiko tertinggi: ketergantungan
pada Node (R-01), skalabilitas SQLite (R-05), tidak adanya clustering
(R-09), dan type safety yang belum ditegakkan (R-02).

---

## 12. Kamus Istilah

| Istilah | Arti |
| --- | --- |
| **Transpiler** | Compiler yang mengubah satu bahasa sumber ke bahasa lain (di sini: JavaScript) |
| **Target** | Lingkungan hasil build: `server` (Node) atau `client` (browser) |
| **Bundler** | Alat menggabungkan modul menjadi satu file mandiri |
| **Prepared statement** | Query SQL dengan placeholder; nilainya dikirim terpisah dari teks query |
| **Placeholder positional** | Placeholder `?` yang diisi berurutan |
| **Allowlist** | Daftar nilai yang diizinkan; semua nilai lain ditolak |
| **Sync queue** | Antrean operasi yang menunggu koneksi untuk dikirim ke server |
| **Last-write-wins** | Strategi resolusi konflik: tulisan terakhir menang |
| **Offline-first** | Aplikasi berfungsi penuh tanpa jaringan, lalu disinkronkan saat tersedia |
| **Service worker** | Script browser yang mencegat request untuk cache dan offline |
