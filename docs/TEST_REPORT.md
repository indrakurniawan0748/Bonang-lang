# TEST REPORT — BONANG

Laporan hasil pengujian. Semua angka berasal dari eksekusi nyata pada
2026-11-11.

**Mesin**: Windows 11 Home 10.0.26300, x64, 12 core logis, 17,0 GB RAM
**Runtime**: Node.js v24.21.0
**Runner**: `node --test` (built-in Node)

---

## 1. Ringkasan

```
$ npm test

ℹ tests 356
ℹ suites 0
ℹ pass 356
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 3647.308
```

**356 test, 356 lulus, 0 gagal, 0 dilewati, 0 dinonaktifkan.**

---

## 2. Rincian per Suite

| Suite | Tests | Pass | Fail | Cakupan |
| --- | --- | --- | --- | --- |
| `tests/unit/` | 96 | 96 | 0 | Lexer, parser, codegen |
| `tests/integration/` | 47 | 47 | 0 | Runtime, aplikasi CRUD |
| `tests/regression/` | 16 | 16 | 0 | Bug BNG-010..BNG-030 terkunci |
| `tests/offline/` | 28 | 28 | 0 | IndexedDB, sync queue, konflik, batas antrean |
| `tests/concurrency/` | 8 | 8 | 0 | 10/100/500/1000 request, p50/p95/p99 |
| `tests/database/` | 47 | 47 | 0 | Pool, transaksi, query builder, JOIN, injection, raw SQL, soft delete |
| `tests/security/` | 55 | 55 | 0 | Hash, CSRF, XSS, path, rate limit, session, header keamanan |
| `tests/tools/` | 59 | 59 | 0 | Akurasi auditor, scaffold CLI, bundel browser, cache SW, graf modul, audit struktur |
| **Total** | **356** | **356** | **0** | |

Perintah verifikasi per suite:

```
$ for d in unit integration regression offline concurrency database security tools; do
    node --test "tests/$d/*.test.js"
  done
```

---

## 3. Pengujian Konkurensi (p50 / p95 / p99)

Skenario: `GET /api/health` pada server demo, koneksi memakai `http.Agent`
dengan `keepAlive: true`.

```
$ node --test "tests/concurrency/*.test.js"

    konkurensi 10: p50=48.63ms p95=53.76ms p99=53.76ms max=53.76ms mean=49.22ms
    konkurensi 100: p50=119.80ms p95=143.42ms p99=143.82ms max=143.92ms mean=126.62ms
    konkurensi 500: p50=248.72ms p95=364.68ms p99=366.07ms max=366.46ms mean=253.84ms
    konkurensi 1000: p50=301.04ms p95=461.28ms p99=471.86ms max=472.29ms mean=306.77ms
```

| Konkurensi | p50 | p95 | p99 | Throughput |
| --- | --- | --- | --- | --- |
| 10 | 48,63 ms | 53,76 ms | 53,76 ms | ~203 req/s |
| 100 | 119,80 ms | 143,42 ms | 143,82 ms | ~790 req/s |
| 500 | 248,72 ms | 364,68 ms | 366,07 ms | ~1 970 req/s |
| 1000 | 301,04 ms | 461,28 ms | 471,86 ms | ~3 260 req/s |

Nilai p99 pada konkurensi 1000 (471,86 ms) tetap di bawah ambang NFR-03
(1000 ms).

Throughput dihitung dari mean: `1000 / mean(detik)`.

### 3.1 Test integritas data di bawah konkurensi

| Test | Hasil | Yang dibuktikan |
| --- | --- | --- |
| Server sehat setelah 1000 request paralel | Pass | Tidak ada kebocoran handle, server tetap melayani |
| 50 create paralel | Pass | 50 produk tersimpan, 50 id unik, 50 nama unik — tidak ada lost update |
| 100 reader paralel saat writer aktif | Pass | Tidak pernah melihat data setengah tertulis |
| 2 update paralel dengan `baseVersion` sama | Pass | Minimal satu berhasil; yang lain ditolak sebagai konflik |

---

## 4. Pengujian Database

`tests/database/database.test.js` — 32 test.

Ditambah `tests/database/soft-delete.test.js` — 15 test (lihat §4.2).

| Area | Test | Hasil |
| --- | --- | --- |
| Pool | Skema dibuat, data tersimpan | Pass |
| Pool | `query` banyak baris & `queryOne` satu baris | Pass |
| Pool | Batas koneksi → pemanggil ketiga menunggu | Pass |
| Pool | Penolakan setelah `close()` | Pass |
| Pool | Statistik akuisisi/pelepasan | Pass |
| Transaksi | Commit | Pass |
| Transaksi | Rollback | Pass |
| Transaksi | `bulkInsert` 25 baris | Pass |
| Transaksi | Rollback mengembalikan koneksi (waiting = 0) | Pass |
| Placeholder | Payload injeksi diperlakukan sebagai data | Pass |
| Placeholder | Wildcard LIKE ke wildcard pengguna | Pass |
| QueryBuilder | select + where + orderBy | Pass |
| QueryBuilder | `count` & `paginate` metadata | Pass |
| QueryBuilder | Identifier berbahaya ditolak | Pass |
| QueryBuilder | Operator di luar allowlist ditolak | Pass |
| QueryBuilder | `where` dua argumen sebagai shorthand | Pass |
| QueryBuilder | `join` menghasilkan SQL berparameter yang benar | Pass |
| QueryBuilder | Jenis JOIN & kondisi JOIN berbahaya ditolak | Pass |
| Integritas | Kolom NOT NULL menolak nilai kosong | Pass |
| Raw SQL | `whereRaw` menolak statement tambahan (pemisah `;`) | Pass |
| Raw SQL | `whereRaw` menolak jumlah placeholder ≠ jumlah parameter | Pass |
| Raw SQL | `having` menolak jumlah placeholder ≠ jumlah parameter | Pass |
| Raw SQL | `whereRaw` dengan placeholder yang cocok diterima | Pass |
| Raw SQL | Titik koma di dalam literal string bukan pemisah statement | Pass |
| Raw SQL | SQL mentah kosong ditolak | Pass |
| Keyset | Halaman pertama tanpa cursor | Pass |
| Keyset | Semua baris terkirim tepat satu kali (dicek dengan `Set`) | Pass |
| Keyset | Baris dengan nilai kolom pengurutan yang sama tidak terlewat | Pass |
| Keyset | Halaman terakhir tidak punya cursor berikutnya | Pass |
| Keyset | Arah `DESC` | Pass |
| Keyset | Nama kolom berbahaya ditolak | Pass |
| Keyset | Cursor berisi payload injeksi diperlakukan sebagai data | Pass |

### 4.1 Bukti injeksi SQL

```
payload = "'; DROP TABLE items; --"
SELECT * FROM items WHERE name = ?   →  0 baris
SELECT * FROM items                 →  1 baris (tabel utuh)
```

### 4.2 Pengujian Soft Delete

`tests/database/soft-delete.test.js` — 15 test. Semua test memakai file
SQLite sungguhan di folder sementara (`node:sqlite`), bukan mock.

| Area | Test | Hasil |
| --- | --- | --- |
| Kolom | `ensureSoftDeleteColumn()` menambahkan `deleted_at` bila belum ada | Pass |
| Kolom | Kolom yang sudah ada tidak diubah (idempoten) | Pass |
| Kolom | Nama kolom kustom (`archived_at`) dihormati | Pass |
| Hapus | `remove()` menandai baris, tidak menghapus | Pass |
| Hapus | `remove()` pada baris yang sudah terhapus tidak mengubah apa pun | Pass |
| Baca | `findAll()` menyembunyikan baris terhapus | Pass |
| Baca | `findById()` baris terhapus → `null` | Pass |
| Baca | `findAll({ includeDeleted: true })` menampilkan baris terhapus | Pass |
| Hitung | Baris aktif dan terhapus dihitung terpisah | Pass |
| Pulihkan | `restore()` mengembalikan baris ke daftar aktif | Pass |
| Pulihkan | `purge()` menghapus baris secara permanen | Pass |
| Pulihkan | `purgeAll()` menghapus semua baris terhapus | Pass |
| Validasi | Nama tabel berbahaya ditolak | Pass |
| Validasi | Nama kolom penanda berbahaya ditolak | Pass |
| Validasi | Pool yang tidak valid ditolak | Pass |

Bukti langsung terhadap database (bukan lewat repository):

```
$ node --test "tests/database/soft-delete.test.js"
ℹ tests 15
ℹ pass 15
ℹ fail 0
```

---

## 5. Pengujian Keamanan

`tests/security/security.test.js` — 55 test.

| Area | Cakupan |
| --- | --- |
| Password | Hash tidak menyimpan password; salt berbeda → hash berbeda; verifikasi benar/salah; hash rusak ditolak |
| Timing-safe | String dan Buffer dibandingkan dengan benar; panjang berbeda ditolak |
| Token | `randomToken` 32 byte → 64 hex dan berbeda tiap pemanggilan; `uuid` format v4 |
| Signature | HMAC valid; ditolak bila secret atau payload berbeda |
| CSRF | Token valid untuk sesi+secret yang cocok; ditolak untuk sesi/secret lain dan token ngawur |
| Escape | `<script>` payload dinetralkan; non-string dipertahankan |
| Sanitasi | Karakter kontrol (NUL/BEL/ESC) dibuang; newline & tab dipertahankan; panjang dibatasi |
| Email | Email valid/invalid dipisahkan |
| Path | `safeFilename` membuang komponen path; `safeJoin` menolak traversal dan prefix confusion (`/data-evil`) |
| Upload | File diizinkan diterima; nama berkarakter path, oversize, dan tipe terlarang ditolak |
| Rate limiter | Batas per jendela; kuota terpisah per kunci; kuota terisi ulang setelah jendela |
| Session | create/get/update/destroy; sesi tak dikenal → null; sesi kedaluwarsa dibuang; id sesi tidak memuat data sensitif |
| Header keamanan | Respons JSON membawa header bawaan (`nosniff`, `X-Frame-Options`, CSP, Referrer-Policy, Permissions-Policy) | Pass |
| Header keamanan | CSP melarang skrip & objek luar origin (`script-src 'self'`, `object-src 'none'`, tanpa `unsafe-inline`/`unsafe-eval`) | Pass |
| Header keamanan | Respons 404 juga membawa header | Pass |
| Header keamanan | Aset statis juga membawa header | Pass |
| Header keamanan | Aplikasi dapat menimpa sebagian header lewat `createServer({ securityHeaders })` | Pass |
| Header keamanan | Aplikasi dapat menonaktifkan satu header (nilai `false` → header dihapus) | Pass |
| Header keamanan | `securityHeaders: false` menonaktifkan seluruh header | Pass |
| Header keamanan | Handler dapat menimpa header per-route | Pass |
| Header keamanan | `resolveSecurityHeaders` menolak tipe opsi yang salah | Pass |
| Signed cookie | `signValue` menghasilkan `<nilai>.<signature>` | Pass |
| Signed cookie | Verifikasi berhasil saat signature cocok | Pass |
| Signed cookie | Secret yang salah ditolak | Pass |
| Signed cookie | Nilai yang dimanipulasi ditolak | Pass |
| Signed cookie | Input rusak ditolak (bukan string, kosong, tanpa pemisah) | Pass |
| Signed cookie | Nilai yang mengandung titik tidak salah dipecah | Pass |
| Signed cookie | `response.signedCookie()` mengirim cookie bertanda tangan | Pass |
| Signed cookie | `request.signedCookie()` membaca cookie valid | Pass |
| Signed cookie | `request.signedCookie()` menolak cookie yang dipalsukan | Pass |
| Signed cookie | `request.signedCookie()` mengembalikan null untuk cookie yang tidak ada | Pass |
| Signed cookie | Signed cookie tanpa secret ditolak | Pass |

---

## 6. Pengujian Offline

`tests/offline/offline.test.js` — 28 test, memakai `FakeIndexedDB` yang
meniru API IndexedDB asli.

| Area | Hasil |
| --- | --- |
| `IndexedDBStore` — open, put, get, getAll, delete, clear, putMany | Pass |
| `SyncQueue` — enqueue, list, remove, clear | Pass |
| `SyncQueue.flush` — entri sukses dihapus | Pass |
| `SyncQueue.flush` — entri gagal permanen dihapus, sementara dipertahankan | Pass |
| `resolveConflict` — remote lebih baru, local lebih baru, timestamp sama, policy kustom | Pass |
| `reconcile` — entitas baru, entri identik, konflik tercatat | Pass |
| `ConnectionStatus` — subscribe/unsubscribe, setOnline | Pass |
| `apiFetch` — jalur offline mengembalikan `{ ok:false, offline:true }` tanpa melempar | Pass |
| Batas antrean — entri baru ditolak saat antrean penuh (`QueueOverflowError`) | Pass |
| Batas antrean — entri dengan id sama menimpa tanpa menambah jumlah antrean | Pass |
| Batas antrean — batas berlaku pada entri yang sebelumnya tersimpan | Pass |
| Batas antrean — nilai batas bawaan ada dan wajar (500) | Pass |
| Batas antrean — antrean menerima entri baru lagi setelah entri dihapus | Pass |
| Background sync — tag terdaftar di service worker | Pass |
| Background sync — browser tanpa dukungan dilaporkan `supported: false` tanpa melempar | Pass |
| Background sync — kegagalan pendaftaran dilaporkan lewat `error` | Pass |
| Antar-tab — pesan sampai ke tab lain | Pass |
| Antar-tab — tab tidak menerima broadcastnya sendiri | Pass |
| Antar-tab — kelas tetap bisa dibuat tanpa dukungan `BroadcastChannel` | Pass |
| Antar-tab — `enqueue` dan `remove` menyiarkan perubahan antrean | Pass |
| Antar-tab — `onRemoteChange` terpanggil untuk tab lain | Pass |
| Antar-tab — sambungan bisa dilepas dan method antrean dikembalikan | Pass |

---

## 7. Pengujian Integrasi & CRUD

`tests/integration/crud-demo.test.js` — 12 test; aplikasi Bonang CRUD Demo
dijalankan sungguhan di atas HTTP.

| Skenario | Hasil |
| --- | --- |
| Server start & `/api/health` | 200, `status: ok` |
| `/api/info` | 200, metadata aplikasi |
| POST produk valid | 201, produk tersimpan |
| POST produk invalid | 400, `status: error` + `msg` |
| GET daftar + paginasi | 200, metadata `total` benar |
| GET produk by id | 200, data lengkap (bukan Promise) |
| GET produk tak ada | 404 |
| GET produk tak ada (format id bukan angka) | 404/400, bukan 500 |
| PUT produk | 200, field berubah |
| PUT parsial | 200, hanya field yang dikirim berubah |
| PUT dengan `baseVersion` basi | 409, `details.server` berisi data server |
| DELETE produk | 200/204 |
| DELETE produk tak ada | 404 |
| DELETE produk (soft delete) | 200, baris tetap ada di tabel dengan `deleted_at` terisi |
| GET produk setelah soft delete | 404 |
| POST `/api/products/:id/restore` | 200, `deletedAt` kembali `null` |
| POST restore pada produk aktif | 409 |
| `/api/products/summary` | 200, agregasi benar |
| POST `/api/sync` | 200, applied + failed dihitung |
| Aset statis (`/`, `style.css`, `client.js`, `sw.js`) | 200, content-type benar |
| SQL injection via query param | 200, 0 baris, tabel utuh |

---

## 8. Pengujian Regresi

`tests/regression/bugs.test.js` — 16 test mengunci perilaku yang pernah
salah. Rincian per bug ada di `docs/BUG_TRACKER.md`.

Cakup: BNG-010 (exporttak saling menimpa), BNG-011 (getter & method),
BNG-012 (`typeof`, `function`), BNG-013 (`undefined`), BNG-014 (named
export list), BNG-015 (reserved word sebagai properti), BNG-016 (import
`bonang`), BNG-017 (arrow dengan object literal), serta-details pada
`ConflictError`/`NotFoundError`.

---

## 9. Pengujian Tooling (Auditor)

`tests/tools/auditor.test.js` — 16 test mengunci akurasi `bonang audit`.
`tests/tools/cli.test.js` — 6 test mengunci perilaku CLI pada proyek hasil
`bonang init`.

| Kasus | Yang dibuktikan |
| --- | --- |
| Tabel dari konstanta kelas | `${this.table}` bukan SQL injection |
| Tabel dari parameter constructor | Tetap dilaporkan — nilainya tak terbukti aman |
| Interpolasi data user | `${name}` dari `ctx.body` dilaporkan sebagai critical |
| `store.put`/`store.delete` | Bukan route HTTP — tidak ada temuan |
| Route tanpa validasi | Tepat 1 temuan `missing-input-validation` |
| Route yang validasi lewat delegasi | `this.store(ctx)` -> `readBody` tidak dilaporkan |
| Route GET | Tidak wajib validasi — tidak ada temuan |
| SQL dengan operator `+` | Aturan lama masih bekerja |
| `innerHTML` tanpa escaping | Aturan lama masih bekerja |
| Path traversal | Aturan lama masih bekerja |
| Secret hardcoded | Aturan lama masih bekerja |
| `whereRaw` dengan data user | Dilaporkan `sql-injection-raw` (critical) |
| `having` dengan data user | Dilaporkan `sql-injection-raw` (critical) |
| `whereRaw` dengan placeholder & konstanta | Tidak dilaporkan |
| `whereRaw` dengan operator `+` dan data user | Dilaporkan `sql-injection-raw` |
| `whereRaw` tanpa data user | Tidak dilaporkan |

Suite ini dibuat karena bug BNG-031..BNG-035: auditor melaporkan 19 temuan
palsu pada kode referensi proyek sendiri sebelum diperbaiki. Lima test
terakhir ditambahkan untuk BNG-041 (L-18): sebelumnya `whereRaw`/`having`
tidak pernah dianalisis sama sekali.

---

## 9.1 Pengujian Bundel Browser

`tests/tools/bundler.test.js` — 7 test mengunci output frontend.

| Kasus | Yang dibuktikan |
| --- | --- |
| Bundel client tanpa `require(` | Frontend tidak memanggil API Node yang tidak ada di browser |
| Bundel client tanpa `process.exitCode` | Tidak ada global Node di jalur error |
| Runtime client ter-inline | `IndexedDBStore`, `SyncQueue` ada di dalam satu file |
| Modul Node bawaan ditolak | `node:fs` gagal **saat build**, bukan di console browser |
| Runtime server ditolak | `bonang` (server) tidak bisa diimpor di frontend |
| Paket eksternal ditolak | `lodash` ditolak dengan pesan jelas |
| Bundel server tetap memakai `require` | Perbaikan target client tidak merusak target server |

Suite ini dibuat karena bug BNG-039. Frontend sebelumnya gagal total
di browser dengan `Uncaught ReferenceError: require is not defined`,
tetapi seluruh test tetap hijau karena semua suite berjalan di Node,
tempat `require` selalu tersedia.

Verifikasi langsung di browser (Chrome, DevTools Protocol):

```
$ node dist/server.js
$ chrome --remote-debugging-port=9222 http://127.0.0.1:3000/

STATE: {"status":"Online","msg":"","products":4,
        "html":"<div class=\"product-row\">...Madu Hutan Lombok..."}
```

Empat produk tampil, indikator status "Online", tanpa exception di
console.

---

## 9.2 Pengujian Invalidasi Cache Service Worker

`tests/tools/sw-cache.test.js` — 8 test. Suite ini memakai tiruan
`CacheStorage`, `crypto.subtle`, `Headers`, dan `Response` yang dipasang
di `globalThis`, sehingga jalur kode yang diuji sama persis dengan yang
berjalan di browser (bukan implementasi tiruan terpisah).

| Kasus | Yang dibuktikan |
| --- | --- |
| Hash teks | Deterministik; isi berbeda → hash berbeda; dipotong 16 hex |
| `cacheKey` | URL absolut & relatif → `pathname` |
| `prune` | Hanya file yang hash-nya berubah yang dihapus; file lain tetap tersimpan |
| `matchFresh` | Entri basi → `null` dan dihapus; entri segar dilayani |
| `store` | Header `X-Bonang-Cache-Hash` dipasang dari manifest; body utuh |
| `loadManifest(true)` | Manifest diambil ulang dari jaringan saat dipaksa |
| Manifest gagal dimuat | Manifest lama dipertahankan, tidak ditimpa |
| File di luar manifest | Tidak ikut terhapus |

Suite ini dibuat untuk BNG-043 (L-20). Sebelumnya service worker memakai
satu nama cache ber-versi: tiap deploy memaksa **seluruh** aset diunduh
ulang, dan aset yang tidak berubah ikut terbuang.

Verifikasi langsung di browser sungguhan (Chrome 157, DevTools Protocol) —
bukan simulasi:

```
$ node dist/server.js
$ chrome --remote-debugging-port=9222 http://127.0.0.1:3000/

BEFORE hash style.css: 22604cbc22b908ea
BEFORE hash client.js: 633967ecff36c8cc
AFTER  hash style.css: 363d59d6b55dd405   <- berubah, entri di-refresh
AFTER  hash client.js: 633967ecff36c8cc   <- tetap, cache dipertahankan
```

Hanya `style.css` yang berubah pada deploy; `client.js` tetap dilayani
dari cache tanpa unduhan ulang. File CSS asli dikembalikan setelah
pengujian.

---

## 9.3 Pengujian Graf Modul (Siklus & Dynamic Import)

`tests/tools/module-graph.test.js` — 10 test. Setiap test membuat proyek
Bonang sungguhan di folder sementara, lalu **menjalankan** hasilnya lewat
Node — bukan hanya memeriksa bentuk string.

| Kasus | Yang dibuktikan |
| --- | --- |
| Siklus dua file (A ⇄ B), bundle | Build selesai (3 modul), hasil `a->BA` — tanpa stack overflow |
| Siklus dua file (A ⇄ B), dari sumber | Program berjalan langsung dari `.bng` tanpa error |
| Siklus tiga modul (A → B → C → A) | Build selesai (4 modul), hasil `BCA` |
| Live binding pada siklus | Nilai modul siklik dibaca saat call time — `bump()` thrice menghasilkan `3`, bukan `undefined` |
| Re-export dari modul lain | `export { greet }` di mana `greet` berasal dari import mengekspor nilai yang benar (`hai`) |
| `import()` diparse | Menghasilkan `ImportExpression` + helper `_$$dynamicImport` |
| `import()` memuat modul saat runtime | Modul dimuat dan fungsinya bisa dipanggil |
| `import()` ter-bundle | Modul ikut masuk bundel (2 modul), hasil `halo-bundel` |
| `import()` path non-literal | Ditolak saat kompilasi — path harus deterministik |
| `import("node:fs")` di bundel client | Ditolak **saat build**, bukan diam-diam gagal di browser |

Suite ini dibuat untuk BNG-048 (L-05). Sebelumnya dua modul yang saling
mengimpor membuat `bonang build` gagal dengan
`RangeError: Maximum call stack size exceeded`, dan `import("./x.bng")`
gagal diparse sama sekali.

Verifikasi manual di luar test — siklus modul yang dibundle:

```
$ node -e "bundle({entry: 'main.bng', output: 'dist.js', target: 'server'})"
modules 3
$ node dist.js
a->BA
```

---

Sebagian perintah CLI diuji manual dengan output nyata:

```
$ node cli/cli.js init demo
Proyek Bonang 'demo' berhasil dibuat di C:\...\Temp\clitest\demo

$ cd demo && node ../cli/cli.js test
  ✓ tests\app.test.bng › penjumlahan
  ✓ tests\app.test.bng › validasi produk
2 lulus, 0 gagal

$ node ../cli/cli.js build
  ✓ src/server/main.bng → server.js (2 modul, 2.0 KB)
  ✓ src/client/main.bng → client.js (1 modul, 1.3 KB)
  ✓ public/ → dist/public

$ node ../cli/cli.js lint
5 file diperiksa, 2 masalah ditemukan.      (2 info, 0 error)

$ node ../cli/cli.js audit
File diperiksa: 5
Masalah ditemukan: 0

$ node ../cli/cli.js version
Bonang v0.1.0
Node v24.21.0 | win32 x64
```

Sisanya diuji otomatis oleh `tests/tools/cli.test.js` (6 test), yang
membuat proyek lewat `bonang init` lalu memverifikasi: file proyek lengkap,
audit bersih, lint tanpa error, `bonang test` lulus, `bonang build`
menghasilkan `dist/server.js` + `dist/client.js`, dan route `POST /api/echo`
mengembalikan **400** untuk body yang tidak valid:

```
valid body   -> 200 {"received":{"message":"halo"}}
missing field-> 400 {"status":"error","msg":"Field 'message' wajib diisi",
                     "error":"VALIDATION_ERROR", ...}
```

---

## 9.4 Pengujian Audit Struktur

`tests/tools/structure-audit.test.js` — 12 test. Memeriksa struktur basis
kode: siklus dependensi, dead code, duplikasi, dan ukuran berkas.

| Kasus | Yang dibuktikan |
| --- | --- |
| Siklus dependensi | Basis kode Bonang sendiri: 0 siklus |
| Dead code | 0 kandidat tak dikenal |
| Duplikat | 0 berkas identik (hash SHA-1) |
| Cakupan pindai | ≥ 25 berkas JS terpindai |
| Berkas besar | Semua yang terdaftar > 400 baris, urut menurun |
| Modul dinamis | `runtime/client/client.js` & `sw-cache.js` bukan dead code |
| Pool | Pengguna pool tercatat |
| Cetak laporan | `printStructureReport()` tidak melempar |
| Sumber kebenaran identifier | Query builder & soft delete memakai `assertIdentifier` yang sama |
| Identifier berbahaya | `products; DROP TABLE x`, `products--`, `1products`, `""`, `a b` ditolak |
| Path traversal sebagai identifier | `../etc/passwd`, `a/b`, `a\b`, `a.b` ditolak |
| Lokasi berkas | `cli/structure-audit.js` ada di path yang benar |

Audit struktur ini dibuat sebagai bagian PHASE 10 — kode yang tidak bisa
dilihat auditor keamanan: bentuk modul, bukan isinya.

```
$ node cli/cli.js audit --structure
Berkas JS dipindai: 29
Siklus dependensi: 0
Kandidat dead code: 0
Duplikat identik: 0
```

---

## 11. Metodologi dan Batasan

1. **Tidak ada test yang dinonaktifkan.** Semua 356 test aktif dan dijalankan.
2. **Tidak ada mock untuk jalur produksi.** Test integrasi menjalankan server
   HTTP sungguhan dengan database SQLite sungguhan.
3. **Test offline memakai `FakeIndexedDB`**, bukan IndexedDB browser —
   batasan ini dicatat di `docs/KNOWN_LIMITATIONS.md`.
4. **Tidak ada coverage report.** Node built-in tidak menyediakan coverage
   tanpa dependensi eksternal; cakupan diukur lewat enumerasi test.
5. **Benchmark memakai satu mesin.** Angka tidak mewakili produksi;
   lihat `benchmarks/RESULTS.md` untuk catatan metodologi.
6. **Uji beban dibatasi oleh backlog OS Windows.** 1000 koneksi TCP
   simultan ditolak OS; harness memakai agent keep-alive (lihat BNG-028).
7. **Uji header keamanan memakai respons HTTP sungguhan**, bukan pemeriksaan
   teks pada kode — header dibaca dari respons yang benar-benar diterima.
8. **Uji invalidasi cache punya dua lapis**: unit test dengan tiruan
   Cache API, dan verifikasi di Chrome sungguhan lewat DevTools Protocol.
   Hasil Chrome yang dipublikasikan di atas adalah hasil run nyata.
9. **Uji graf modul menjalankan hasil build sungguhan.** Proyek Bonang
   dibuat di folder sementara, dibundle, lalu dijalankan lewat Node —
   bukan hanya memeriksa bentuk string hasil kompilasi.
10. **Uji soft delete memakai file SQLite sungguhan.** Tabel dibuat di
    folder sementara, kolom `deleted_at` benar-benar ditambahkan lewat
    `ALTER TABLE`, dan isi tabel diperiksa langsung lewat query SQL —
    bukan lewat repository saja.
11. **Uji audit struktur memindai kode sumber sungguhan.** Graf
    dependensi dibangun dari `require()` yang benar-benar ada di berkas,
    bukan dari daftar tebakan.

---

## 12. Kesimpulan

Semua suite hijau. Tidak ada kegagalan, tidak ada test yang dilewati, tidak
ada test yang dinonaktifkan. Cakupan memenuhi requirement Phase 6 dari
`prompt.md`: unit, integrasi, concurrency (10/100/500/1000 dengan
p50/p95/p99), database, offline, security, dan tooling.
