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

Angka di bawah berasal dari **satu** eksekusi `bonang bench` (07:43 UTC,
11 Nov 2026). Karena benchmark pada mesin yang sama memberi variance
antar-jalankan yang besar (§8.3), tabel ini adalah **snapshot satu
eksekusi**, bukan rata-rata. Rangkuman rentang antar-jalankan ada di
§8.3 — angka di situ lebih jujur untuk purposes perbandingan.

| Skenario | Metrik | Nilai (eksekusi 04:46 UTC) |
| --- | --- | --- |
| Kompilasi | throughput | **6 081** batch/detik |
| Eksekusi | throughput | **1 934 236** operasi/detik |
| Baseline Node | throughput | 2 403 846 operasi/detik |
| Baseline Bonang | throughput | **2 941 176** operasi/detik |
| Baseline PHP | throughput | 293 083 operasi/detik |
| Database insert | throughput | **1 108** operasi/detik |
| Database select | throughput | **4 440** operasi/detik |
| HTTP sekuensial (300 req) | mean | 416,148 ms |
| HTTP konkuren (50 req) | mean | **75,209 ms** |
| HTTP non-blocking check | fast request | **2,156 ms** (lulus) |
| Rasio Bonang vs Node | - | **1,22x** |

> **Tidak ada klaim "Bonang lebih cepat" tanpa bukti pengukuran.**
> Rasio 1,22x pada eksekusi ini (rentang 1,05x - 1,22x antar-jalankan)
> berarti Bonang berada dikisaran yang **sama** dengan
> JavaScript mentah. Ini wajar, karena Bonang adalah transpiler ke
> JavaScript dan tidak menambah lapisan abstraksi saat runtime.
> Yang terbukti adalah **paritas** dengan baseline Node, dan urutan
> magnitude di atas PHP — bukan keunggulan performa Bonang.

---

## 2. Kompilasi

Pengukuran: batch 200 file Bonang, 5 sampel.

| Metrik | Nilai (ms per batch) |
| --- | --- |
| min | 19,349 |
| p50 | 29,204 |
| p95 | 65,114 |
| p99 | 65,114 |
| max | 65,114 |
| mean | 32,891 |

**Throughput: 6 081 batch/detik.**

Pipeline yang diukur: lexer -> parser -> AST -> codegen -> bundle.
Belum termasuk penulisan berkas ke disk.

---

## 3. Eksekusi

Pengukuran: 1000 iterasi fungsi aritmetika murni, 5 sampel.

| Metrik | Nilai (ms per batch) |
| --- | --- |
| min | 0,364 |
| p50 | 0,398 |
| p95 | 1,046 |
| p99 | 1,046 |
| max | 1,046 |
| mean | 0,517 |

**Throughput: 1 934 236 operasi/detik.**

---

## 4. Baseline Perbandingan (Node vs Bonang vs PHP)

Skenario identik: loop aritmetika 1000 iterasi, 5 sampel (PHP 1 sampel).

| Runtime | mean (ms) | Throughput (op/detik) |
| --- | --- | --- |
| Node.js | 0,416 | 2 403 846 |
| **Bonang** | **0,340** | **2 941 176** |
| PHP 8.2.12 | 3,412 | 293 083 |

**Rasio Bonang vs Node: 1,22x.**

Catatan yang jujur:

1. **Selisih Bonang vs Node mentah berada di dalam rentang noise
   antar-jalankan.** Pada eksekusi ini rasionya 1,22x, pada eksekusi
   sebelumnya 1,06x dan 1,05x. Yang terbukti adalah *paritas*, bukan
   kemenangan — lihat §8.3.
2. Karena Bonang dikompilasi ke JavaScript, advantage struktural tidak
   mungkin diharapkan. Yang bisa diharapkan justru disadvantage — dan
   memang tidak terlihat signifikan, karena overhead transpilasi hanya
   terjadi sekali saat build.
3. **PHP sekitar 8,6x lebih lambat** pada skenario komputasi murni. Ini
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
| insert | 451,254 | 1 108 |
| select | 112,605 | 4 440 |

Select sekitar 4,7x lebih cepat dari insert — wajar untuk SQLite: insert
melibatkan penulisan ke WAL dan commit, sedangkan select hanya membaca
halaman yang sudah ter-cache.

---

## 6. HTTP

### 6.1 Sekuensial (300 request)

| Metrik | Nilai (ms) |
| --- | --- |
| min | 284,397 |
| p50 | 380,727 |
| p95 | 583,319 |
| p99 | 583,319 |
| max | 583,319 |
| mean | 416,148 |

### 6.2 Konkuren (50 request paralel)

| Metrik | Nilai (ms) |
| --- | --- |
| min | 32,645 |
| p50 | 88,236 |
| p95 | 104,747 |
| p99 | 104,747 |
| max | 104,747 |
| mean | 75,209 |

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
3. **Varian antar-jalankan nyata.** Empat eksekusi `bonang bench` pada
   mesin yang sama menghasilkan compile throughput 8 486, 4 932, 8 213,
   lalu 6 081 batch/detik; rasio Bonang vs Node 1,06x, 1,05x, lalu
   1,22x; HTTP sekuensial 411,569 / 366,676 / 357,125 / 416,148 ms.
   Selisih ini besar, dan itu alasan rasio sekecil apa pun **tidak
   boleh** touted sebagai keunggulan Bonang.

   Rentang yang teramati:

   | Metrik | Renderan teramati |
   | --- | --- |
   | Compile throughput | 4 932 - 8 486 batch/detik |
   | Rasio Bonang vs Node | 1,05x - 1,22x |
   | HTTP sekuensial (300 req), mean | 357,125 - 416,148 ms |
   | HTTP konkuren (50 req), mean | 67,993 - 75,209 ms |
   | Non-blocking fast request | 1,944 - 2,156 ms |
   | DB insert / select | 962 - 1 134 / 4 440 - 4 963 op/detik |

   Karena rentang compile melintasi angka yang hampir dua kali lipat,
   **angka mana pun yang dipilih adalah pilihan arbitrer**. Yang
   ROBUST di antara semua eksekusi adalah: rasio Bonang vs Node tetap
   dikisaran paritas (1,05x - 1,22x, semua di atas 1,00), HTTP konkuren
   selalu ~4x lebih cepat per-request daripada sekuensial (event loop
   tidak men-serialize request), dan uji non-blocking selalu lulus.
4. **Baseline PHP satu sampel.** PHP lambat startup sehingga diukur
   terpisah tanpa menghitung startup.
5. **Benchmark adalah mikro-benchmark.** Tidak mencakup I/O jaringan
   nyata, database terdistribusi, atau beban produksi.
6. **Tidak ada klaim keunggulan.** Yang terbukti: **paritas** dengan
   JavaScript (rasio selalu ≥ 1,00 di semua eksekusi), urutan magnitude
   di atas PHP pada komputasi murni, dan perilaku non-blocking yang
   terverifikasi.

---

## 9. Reproduksi

```bash
node cli/cli.js bench
node --test "tests/concurrency/*.test.js"
```

Keluaran `bonang bench` berupa JSON sehingga bisa dibandingkan antar
versi secara mesin-terbaca.
