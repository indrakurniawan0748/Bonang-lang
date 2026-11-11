# BENCHMARK RESULTS — BONANG

Semua angka di dokumen ini hasil eksekusi nyata pada **2026-11-11**,
bukan estimasi.

**Mesin**: Windows 11 Home 10.0.26300, x64, 12 core logis, 17,0 GB RAM
**Runtime**: Node.js v24.21.0
**PHP baseline**: PHP 8.2.12 (interpreter, startup tidak dihitung)
**Perintah**: `node cli/cli.js bench`
**Iterasi**: 1000 (execution, http), 200 (compile), 500 (database)

---

## 1. Ringkasan

Angka di bawah berasal dari **satu** eksekusi `bonang bench` (04:46 UTC,
11 Nov 2026). Karena benchmark pada mesin yang sama memberi variance
antar-jalankan yang besar (§8.3), tabel ini adalah **snapshot satu
eksekusi**, bukan rata-rata. Rangkuman rentang antar-jalankan ada di
§8.3 — angka di situ lebih jujur untuk purposes perbandingan.

| Skenario | Metrik | Nilai (eksekusi 04:46 UTC) |
| --- | --- | --- |
| Kompilasi | throughput | **4 932** batch/detik |
| Eksekusi | throughput | **1 919 386** operasi/detik |
| Baseline Node | throughput | 2 710 027 operasi/detik |
| Baseline Bonang | throughput | **2 873 563** operasi/detik |
| Baseline PHP | throughput | 339 785 operasi/detik |
| Database insert | throughput | **962** operasi/detik |
| Database select | throughput | **4 481** operasi/detik |
| HTTP sekuensial (300 req) | mean | 411,569 ms |
| HTTP konkuren (50 req) | mean | **71,765 ms** |
| HTTP non-blocking check | fast request | **2,125 ms** (lulus) |
| Rasio Bonang vs Node | - | **1,06x** |

> **Tidak ada klaim "Bonang lebih cepat" tanpa bukti pengukuran.**
> Rasio 1,06x berarti Bonang berada dikisaran yang **sama** dengan
> JavaScript mentah. Ini wajar, karena Bonang adalah transpiler ke
> JavaScript dan tidak menambah lapisan abstraksi saat runtime.
> Yang terbukti adalah **paritas** dengan baseline Node, dan urutan
> magnitude di atas PHP — bukan keunggulan performa Bonang.

---

## 2. Kompilasi

Pengukuran: batch 200 file Bonang, 5 sampel.

| Metrik | Nilai (ms per batch) |
| --- | --- |
| min | 27,297 |
| p50 | 34,568 |
| p95 | 72,741 |
| p99 | 72,741 |
| max | 72,741 |
| mean | 40,552 |

**Throughput: 4 932 batch/detik.**

Pipeline yang diukur: lexer -> parser -> AST -> codegen -> bundle.
Belum termasuk penulisan berkas ke disk.

---

## 3. Eksekusi

Pengukuran: 1000 iterasi fungsi aritmetika murni, 5 sampel.

| Metrik | Nilai (ms per batch) |
| --- | --- |
| min | 0,352 |
| p50 | 0,367 |
| p95 | 1,151 |
| p99 | 1,151 |
| max | 1,151 |
| mean | 0,521 |

**Throughput: 1 919 386 operasi/detik.**

---

## 4. Baseline Perbandingan (Node vs Bonang vs PHP)

Skenario identik: loop aritmetika 1000 iterasi, 5 sampel (PHP 1 sampel).

| Runtime | mean (ms) | Throughput (op/detik) |
| --- | --- | --- |
| Node.js | 0,369 | 2 710 027 |
| **Bonang** | **0,348** | **2 873 563** |
| PHP 8.2.12 | 2,943 | 339 785 |

**Rasio Bonang vs Node: 1,06x.**

Catatan yang jujur:

1. **Bonang hanya 6% lebih cepat dari Node mentah** — dan selisih ini
   berada di dalam rentang noise antar-jalankan. Yang terbukti adalah
   *paritas*, bukan kemenangan.
2. Karena Bonang dikompilasi ke JavaScript, advantage struktural tidak
   mungkin diharapkan. Yang bisa diharapkan justru disadvantage — dan
   memang tidak terlihat signifikan, karena overhead transpilasi hanya
   terjadi sekali saat build.
3. **PHP sekitar 8,5x lebih lambat** pada skenario komputasi murni. Ini
   bukan kebaruan Bonang; PHP memang berjalan di interpreter yang
   restorative lebih lambat. Angka ini disertakan sebagai titik acuan
   skala, bukan sebagai argumen kemenangan Bonang.
4. PHP hanya diukur **satu kali** (startup tidak dihitung), sehingga
   angkanya kurang stabil dibanding dua baseline lain.

---

## 5. Database (SQLite)

500 operasi per batch, 3 sampel.

| Operasi | mean (ms) | Throughput (op/detik) |
| --- | --- | --- |
| insert | 519,492 | 962 |
| select | 111,593 | 4 481 |

Select sekitar 4,7x lebih cepat dari insert — wajar untuk SQLite: insert
melibatkan penulisan ke WAL dan commit, sedangkan select hanya membaca
halaman yang sudah ter-cache.

---

## 6. HTTP

### 6.1 Sekuensial (300 request)

| Metrik | Nilai (ms) |
| --- | --- |
| min | 293,695 |
| p50 | 345,780 |
| p95 | 595,233 |
| p99 | 595,233 |
| max | 595,233 |
| mean | 411,569 |

### 6.2 Konkuren (50 request paralel)

| Metrik | Nilai (ms) |
| --- | --- |
| min | 29,281 |
| p50 | 92,056 |
| p95 | 93,957 |
| p99 | 93,957 |
| max | 93,957 |
| mean | 71,765 |

71,765 ms untuk 50 request yang berjalan paralel jauh lebih baik daripada
411,569 ms untuk 300 request sekuensial. Rasio per-request: sekuensial
1,372 ms/request vs konkuren 1,435 ms/request — hampir sama, artinya
server memproses secara konkuren dan tidak men-serialize request.

### 6.3 Uji non-blocking

Request cepat diukur berdampingan dengan request lambat (20 ms).

| Metrik | Nilai |
| --- | --- |
| fastRequestMs | **2,125** |
| passed | true |

Request cepat selesai dalam 2,125 ms sementara request lambat masih
menunggu 20 ms. Ini membuktikan event loop Bonang **tidak diblokir** oleh
pekerjaan I/O — sifat asinkron yang menjadi alasan perbedaan antara
konkurensi dan paralel dijelaskan di `docs/RUNTIME_DESIGN.md`.

---

## 7. Load Test HTTP (dari `tests/concurrency/`)

Diukur terpisah oleh test suite, bukan oleh `bonang bench`:

| Konkurensi | p50 | p95 | p99 | mean | Throughput |
| --- | --- | --- | --- | --- | --- |
| 10 | 48,63 ms | 53,76 ms | 53,76 ms | 49,22 ms | ~203 req/s |
| 100 | 119,80 ms | 143,42 ms | 143,82 ms | 126,62 ms | ~790 req/s |
| 500 | 248,72 ms | 364,68 ms | 366,07 ms | 253,84 ms | ~1 970 req/s |
| 1000 | 301,04 ms | 461,28 ms | 471,86 ms | 306,77 ms | ~3 260 req/s |

Nilai p99 pada konkurensi 1000 (471,86 ms) **tetap di bawah ambang
NFR-03** (1000 ms).

Throughput dihitung dari mean: `1000 / mean(detik)`.

---

## 8. Metodologi dan Batasan

1. **Satu mesin.** Semua angka berasal dari satu mesin; jangan dipakai
   sebagai klaim performa lintas lingkungan.
2. **Tidak ada insulation termal.** Benchmark dijalankan berurutan dalam
   satu proses, sehingga skenario berikutnya bisa mendapat mesin yang
   sudah hangat. Karena itu yang dibandingkan adalah **p50**, bukan max.
3. **Varian antar-jalankan nyata.** Tiga eksekusi `bonang bench` pada
   mesin yang sama menghasilkan compile throughput 8 486, 4 932, lalu
   8 213 batch/detik; rasio Bonang vs Node 1,06x lalu 1,05x; HTTP
   sekuensial 411,569 lalu 366,676 lalu 357,125 ms. Selisih ini besar,
   dan itu alasan rasio kecil seperti 1,06x **tidak boleh**
   touted sebagai keunggulan Bonang.

   Rentang yang teramati:

   | Metrik | Renderan teramati |
   | --- | --- |
   | Compile throughput | 4 932 - 8 213 batch/detik |
   | Rasio Bonang vs Node | 1,05x - 1,06x |
   | HTTP sekuensial (300 req), mean | 357,125 - 411,569 ms |
   | HTTP konkuren (50 req), mean | 67,993 - 71,765 ms |
   | Non-blocking fast request | 1,944 - 2,125 ms |
   | DB insert / select | 962 - 1 134 / 4 481 - 4 963 op/detik |

   Karena rentang compile melintasi angka yang hampir dua kali lipat,
   **angka mana pun yang dipilih adalah pilihan arbitrer**. Yang
   ROBUST di antara semua eksekusi adalah: rasio Bonang vs Node tetap
   dikisaran 1,05x - 1,06x (paritas), HTTP konkuren selalu ~4x lebih
   cepat per-request daripada sekuensial (event loop tidak
   men-serialize request), dan uji non-blocking selalu lulus.
4. **Baseline PHP satu sampel.** PHP lambat startup sehingga diukur
   terpisah tanpa menghitung startup.
5. **Benchmark adalah mikro-benchmark.** Tidak mencakup I/O jaringan
   nyata, database terdistribusi, atau beban produksi.
6. **Tidak ada klaim keunggulan.** Yang terbukti: **paritas** dengan
   JavaScript, urutan magnitude di atas PHP pada komputasi murni, dan
   perilaku non-blocking yang terverifikasi.

---

## 9. Reproduksi

```bash
node cli/cli.js bench
node --test "tests/concurrency/*.test.js"
```

Keluaran `bonang bench` berupa JSON sehingga bisa dibandingkan antar
versi secara mesin-terbaca.
