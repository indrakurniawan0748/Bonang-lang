# KNOWN LIMITATIONS — BONANG

Batasan yang **diketahui** dan **diverifikasi**. Setiap entri mencantumkan
bagian yang terdampak, cara memverifikasinya, dan workaround yang tersedia.

Tidak ada entri di dokumen ini yang berupa "seharusnya nanti saja" tanpa
bukti — semuanya berasal dari hasil pengujian atau dari pembacaan kode.

---

## 1. Bahasa dan Compiler

| # | Batasan | Dampak | Workaround |
| --- | --- | --- | --- |
| L-01 | **Tidak ada type checker.** Anotasi tipe hanya diparse, tidak diperiksa. | Kesalahan tipe lolos ke runtime dan muncul sebagai `undefined`/error tak terduga. | Validasi runtime di boundary; pakai `assertIdentifier`/schema check. |
| L-02 | `interface` adalah no-op di runtime — hanya dokumentasi. | Kode yang mengimplementasikan interface tetap kompilasi dan bisa gagal diam-diam. | Tulis implementasi konkret; jangan mengandalkan interface untuk jaminan tipe. |
| L-03 | `namespace` mengasumsikan blok-bodied; dotted namespace belum didukung. | `namespace a.b` gagal parse. | Gunakan modul terpisah. |
| L-04 | TypeScript-like `as` assertion dan enums non-const belum komprehensif. | Kode tertentu perlu ditulis ulang tanpa fitur tersebut. | Tipe tidak di-cast; pakai konvensi. |
| L-34 | Dynamic `import()` hanya menerima string literal. | Path yang dihitung saat runtime (`import(namaVariabel)`) ditolak saat kompilasi. | Bentuk path lebih dulu sebagai literal, atau pakai import statis. |

---

## 2. Runtime

| # | Batasan | Dampak | Workaround |
| --- | --- | --- | --- |
| L-06 | `node:sqlite` bersifat sinkron — query panjang memblokir event loop. | Latensi request lain naik saat query berat. | Batasi ukuran query; pindahkan kerja berat ke worker thread. |
| L-07 | Pool koneksi hanya berlaku dalam satu proses Node.js. | Beberapa instance tidak berbagi pool. | Single-instance, atau pool eksternal. |
| L-08 | Session store dan rate limiter in-memory. | Hilang saat restart; tidak shared antar-instance. | Simpan session di store persisten; pasang rate limiting di reverse proxy. |
| L-09 | Tanpa proteksi CSRF otomatis di router. | Token harus dipasang manual per aplikasi. | Pakai `createCsrfToken`/`verifyCsrfToken`. |

---

## 3. Database

| # | Batasan | Dampak | Workaround |
| --- | --- | --- | --- |
| L-12 | SQLite — satu file, satu writer. | Tidak cocok untuk multi-host. | Batas deployment ke satu mesin. |
| L-13 | Belum ada ORM atau migrasi otomatis (schema diff). | Perubahan skema ditulis manual. | Tulis migrasi eksplisit; `bonang migrate` menjalankannya. |
| L-16 | Belum ada enkripsi at-rest. | Isi database dapat dibaca siapa pun yang punya akses berkas. | Enkripsi volume di level sistem operasi. |
| L-17 | JOIN terbatas: tanpa RIGHT/FULL, tanpa subquery di FROM. | Query kompleks perlu SQL mentah. | Gunakan `whereRaw` dengan placeholder. |

---

## 4. Client dan Offline-First

| # | Batasan | Dampak | Workaround |
| --- | --- | --- | --- |
| L-19 | Resolusi konflik client memakai LWW, bukan CRDT. | Edit di dua perangkat offline bisa saling menimpa. | Kirim `baseVersion` agar server menolak update basi (409). |
| L-21 | IndexedDB store tidak dienkripsi. | Data lokal bisa dibaca oleh script lain di origin yang sama. | Jangan simpan data sensitif; atau tambahkan enkripsi aplikasi. |
| L-25 | Test offline memakai `FakeIndexedDB`, bukan IndexedDB browser asli. | Perilaku di browser bisa berbeda. | Uji manual di browser sebelum rilis. |
| L-32 | Background Sync hanya didukung Chromium (Chrome, Edge, Opera). Firefox dan Safari belum menerapkannya. | Sinkronisasi otomatis di browser non-Chromium tetap bergantung pada flush manual. | `registerBackgroundSync()` melaporkan `supported: false` — pakai flush manual sebagai fallback. |
| L-33 | `BroadcastChannel` hanya bekerja pada origin yang sama. | Sinkronisasi antar-tab tidak bisa lintas origin. | Sinkronisasi antar-aplikasi butuh server. |

---

## 5. Tooling

| # | Batasan | Dampak | Workaround |
| --- | --- | --- | --- |
| L-26 | `bonang test` hanya menjalankan file `.test.bng`. | Test JavaScript harus lewat `node --test`. | `npm test` menjalankan semuanya. |
| L-27 | Package manager belum mendukung registry privat atau workspace. | Hanya registry npm publik. | Pakai registry publik. |
| L-28 | Auditor mengenali route dari nama receiver (`router`, `app`, `server`, `api`). | Router dengan nama lain tidak diperiksa. | Ikuti konvensi penamaan, atau tambahkan nama ke `isRouterLike`. |
| L-29 | Nama fungsi validasi dikenali dari pola (`validate*`, `readBody`, `readJson`, `assertBody`, `parseId`). | Validasi dengan nama lain bisa terlewat. | Ikuti konvensi penamaan fungsi validasi. |
| L-30 | Tidak ada laporan coverage. | Cakupan diukur lewat enumerasi test manual. | Tambah `c8` bila diperlukan. |
| L-31 | Benchmark memakai satu mesin, tanpa insulation termal. | Angka antar-jalankan bervariasi. | Bandingkan p50, bukan max. |

---

## 6. Verifikasi

| Batasan | Cara verifikasi |
| --- | --- |
| 55 test keamanan | `node --test "tests/security/*.test.js"` |
| 47 test database | `node --test "tests/database/*.test.js"` |
| 28 test offline | `node --test "tests/offline/*.test.js"` |
| 8 test konkurensi | `node --test "tests/concurrency/*.test.js"` |
| 16 test auditor | `node --test "tests/tools/auditor.test.js"` |
| 10 test graf modul (siklus & dynamic import) | `node --test "tests/tools/module-graph.test.js"` |
| 7 test bundler | `node --test "tests/tools/bundler.test.js"` |
| 8 test cache service worker | `node --test "tests/tools/sw-cache.test.js"` |
| 6 test CLI | `node --test "tests/tools/cli.test.js"` |
| 16 test regresi | `node --test "tests/regression/*.test.js"` |
| 47 test integrasi (CRUD demo) | `node --test "tests/integration/*.test.js"` |
| 356 test total | `npm test` |
| 0 temuan audit pada kode referensi | `node cli/cli.js audit` |
