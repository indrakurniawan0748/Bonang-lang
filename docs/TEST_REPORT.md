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

ℹ tests 250
ℹ suites 0
ℹ pass 250
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 3354.1362
```

**250 test, 250 lulus, 0 gagal, 0 dilewati, 0 dinonaktifkan.**

---

## 2. Rincian per Suite

| Suite | Tests | Pass | Fail | Cakupan |
| --- | --- | --- | --- | --- |
| `tests/unit/` | 96 | 96 | 0 | Lexer, parser, codegen |
| `tests/integration/` | 46 | 46 | 0 | Runtime, aplikasi CRUD |
| `tests/regression/` | 16 | 16 | 0 | Bug BNG-010..BNG-030 terkunci |
| `tests/offline/` | 13 | 13 | 0 | IndexedDB, sync queue, konflik |
| `tests/concurrency/` | 8 | 8 | 0 | 10/100/500/1000 request, p50/p95/p99 |
| `tests/database/` | 19 | 19 | 0 | Pool, transaksi, query builder, JOIN, injection |
| `tests/security/` | 35 | 35 | 0 | Hash, CSRF, XSS, path, rate limit, session |
| `tests/tools/` | 17 | 17 | 0 | Akurasi auditor + scaffold CLI |
| **Total** | **250** | **250** | **0** | |

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

`tests/database/database.test.js` — 19 test.

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

### 4.1 Bukti injeksi SQL

```
payload = "'; DROP TABLE items; --"
SELECT * FROM items WHERE name = ?   →  0 baris
SELECT * FROM items                 →  1 baris (tabel utuh)
```

---

## 5. Pengujian Keamanan

`tests/security/security.test.js` — 35 test.

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

---

## 6. Pengujian Offline

`tests/offline/offline.test.js` — 13 test, memakai `FakeIndexedDB` yang
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

---

## 7. Pengujian Integrasi & CRUD

`tests/integration/crud-demo.test.js` — aplikasi Bonang CRUD Demo
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

`tests/tools/auditor.test.js` — 11 test mengunci akurasi `bonang audit`.
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

Suite ini dibuat karena bug BNG-031..BNG-035: auditor melaporkan 19 temuan
palsu pada kode referensi proyek sendiri sebelum diperbaiki.

---

## 10. Uji CLI

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

## 11. Metodologi dan Batasan

1. **Tidak ada test yang dinonaktifkan.** Semua 250 test aktif dan dijalankan.
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

---

## 12. Kesimpulan

Semua suite hijau. Tidak ada kegagalan, tidak ada test yang dilewati, tidak
ada test yang dinonaktifkan. Cakupan memenuhi requirement Phase 6 dari
`prompt.md`: unit, integrasi, concurrency (10/100/500/1000 dengan
p50/p95/p99), database, offline, security, dan tooling.
