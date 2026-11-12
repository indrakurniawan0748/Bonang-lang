# RELEASE NOTES — BONANG 0.1.0

**Tanggal rilis**: 2026-11-11
**Status**: stable untuk evaluation

---

## Ringkasan

Bonang 0.1.0 adalah rilis pertama bahasa pemrograman full-stack
Browser Optimized Network And Native Graphics: satu bahasa untuk backend,
frontend, dan lapisan offline-first, dengan toolchain yang bisa dijalankan
dengan satu perintah.

Rilis ini **fokus pada kelengkapan dan kebenaran**, bukan pada
performa mentah. Yang dibuktikan lewat pengukuran: Bonang berada pada
**paritas** dengan JavaScript (rasio 1,05x - 1,22x, selalu di atas 1,00),
berada pada urutan magnitude di atas PHP pada komputasi murni, dan
membuktikan event loop-nya tidak diblokir oleh I/O.

---

## Yang Baru

### Bahasa

- Lekser, parser Pratt, AST, dan codegen lengkap dengan pelacakan scope.
- Arrow function, class dengan inheritance/`interface`/`enum`/`static`/
  getter/setter, template literal, optional chaining, nullish coalescing,
  destructuring, spread, `for...of`/`for...in`, `try`/`catch`/`finally`,
  `switch`, enum.
- Modul `server`, `client`, `shared` dengan `import`/`export` (termasuk
  named export list).
- Dynamic `import()` dengan path literal; modul yang diimpor dinamis ikut
  ter-bundle.
- Siklus modul antar-file didukung (live binding), bukan stack overflow.
- Komentar dalam Bahasa Indonesia, 4 spasi indent.

### Runtime

- HTTP server dengan routing parametrik, middleware, body limit, header
  keamanan, graceful shutdown, dan pemetaan error ke status HTTP.
- Pool SQLite dengan transaksi, placeholder positional `?`, dan query
  builder ber-allowlist.
- Lapisan keamanan: scrypt, timing-safe compare, HMAC, CSRF, escaping,
  sanitasi path, validasi upload, rate limiter, session store.
- Worker pool (`node:worker_threads`) untuk pekerjaan CPU-bound.
- Soft delete: `SoftDeleteRepository` (kolom `deleted_at`, `remove`/
  `restore`/`purge`, `countActive`/`countDeleted`) dan
  `addSoftDeleteColumn()`.
- Keyset pagination dua kolom (`paginateByCursor()`) supaya halaman tidak
  melompati baris dengan nilai pengurutan yang sama.
- Signed cookie (HMAC timing-safe) dan invalidasi cache service worker
  per-file (`precache-manifest.json`).
- Runtime browser: DOM helper, IndexedDB, sync queue, resolusi konflik,
  sinkronisasi background, sinkronisasi antar-tab, `apiFetch` yang tidak
  pernah melempar exception.

### Toolchain

```
npm install -g .        # atau: node cli/cli.js <perintah>
```

| Perintah | Fungsi |
| --- | --- |
| `bonang init <dir>` | Membuat proyek baru |
| `bonang run <entry>` | Kompilasi lalu jalankan |
| `bonang build` | Bundel server + client ke `dist/` + `precache-manifest.json` |
| `bonang dev` | Dev server dengan hot reload (SSE) |
| `bonang test` | Menjalankan test `.test.bng` |
| `bonang lint` | 9 aturan analisis statis |
| `bonang audit` | 8 pemeriksaan keamanan (4 berbasis AST) |
| `bonang audit --structure` | Audit struktur: siklus dependensi, dead code, duplikasi |
| `bonang bench` | 5 skenario benchmark |
| `bonang migrate` | Menjalankan migrasi database |
| `bonang version` | Versi bahasa |

### Aplikasi demo

`apps/bonang-crud-demo` — aplikasi CRUD penuh dalam Bonang: model
`Product`, repository, service, controller, SQLite `bonang_demo`, migrasi,
frontend, service worker, IndexedDB + sync queue, dan resolusi konflik
LWW dengan optimistic concurrency (`baseVersion`, 409 `CONFLICT`).
Penghapusan memakai soft delete: `DELETE /api/products/:id` menandai
baris, `POST /api/products/:id/restore` memulihkannya.

---

## Angka Terukur

| Metrik | Nilai |
| --- | --- |
| Test | 356 lulus, 0 gagal, 0 dilewati |
| Kompilasi | 6 081 batch/detik |
| Eksekusi | 1 934 236 operasi/detik |
| Baseline Node | 2 403 846 operasi/detik |
| Baseline Bonang | 2 941 176 operasi/detik |
| Baseline PHP | 293 083 operasi/detik |
| Rasio Bonang vs Node | 1,22x (paritas; rentang 1,05x - 1,22x) |
| HTTP p99 @ 1000 request | 471,86 ms (bawah NFR-03 1000 ms) |
| HTTP non-blocking check | 2,156 ms (lulus) |
| Temuan audit pada kode referensi | 0 |
| Temuan audit struktur (siklus, dead code, duplikasi) | 0 |

Snapshot satu eksekusi `bonang bench`; rentang antar-jalankan ada di
`benchmarks/RESULTS.md` §8.3. Yang stabil di semua eksekusi: rasio selalu
di atas 1,00 (paritas dengan Node) dan uji non-blocking selalu lulus.

Rincian dan metodologi: `benchmarks/RESULTS.md`.

---

## Yang Diperbaiki

48 bug tercatat di `docs/BUG_TRACKER.md`, seluruhnya sudah Fixed.
Lima di antaranya menyangkut keakuratan alat audit itu sendiri
(BNG-031 s.d. BNG-035) — sebelum diperbaiki, `bonang audit` melaporkan 19
temuan palsu pada kode referensi proyek sendiri, sehingga tidak dapat
dipakai sebagai gerbang kualitas. Sekarang: 0 temuan, dengan 16 test
regresi yang mengunci perilakunya.

Rilis 0.1.0 ditutup dengan Fase 15: siklus modul dan dynamic `import()`
(BNG-048) ikut diperbaiki, soft delete ditambahkan, dan audit diperluas
dari sekadar keamanan ke empat dimensi PHASE 10 (code quality,
performance, security, architecture).

---

## Persyaratan

- **Node.js >= 22** (diuji pada v24.21.0). `node:sqlite` dipakai langsung.
- **Tanpa dependensi eksternal.** `dependencies: {}` dan
  `devDependencies: {}`. Yang dibutuhkan hanya runtime Node dan, opsional,
  PHP untuk baseline benchmark.

---

## Batasan yang Diketahui

Bonang **belum** memiliki type checker statis, ORM dengan schema diff,
maupun enkripsi at-rest. Daftar lengkap dengan dampak dan workaround:
`docs/KNOWN_LIMITATIONS.md` (24 entri terverifikasi).

Fitur yang dulu tercatat sebagai batasan dan sekarang sudah ada:
siklus modul & dynamic `import()` (L-05), soft delete (L-14), keyset
pagination (L-15), sinkronisasi background (L-23), sinkronisasi antar-tab
(L-24), signed cookie (L-10), dan invalidasi cache service worker
per-file (L-20).

---

## Membaca differentially

- Ingin memakai bahasa? → `docs/LANGUAGE_SPECIFICATION.md`
- Ingin memahami arsitektur? → `docs/ARCHITECTURE.md`
- Ingin menulis compiler? → `docs/COMPILER_DESIGN.md`, `docs/GRAMMAR.md`
- Ingin membangun server? → `docs/RUNTIME_DESIGN.md`, `docs/SECURITY_DESIGN.md`
- Ingin memakai database? → `docs/DATABASE_DESIGN.md`
- Ingin offline-first? → `docs/OFFLINE_FIRST_DESIGN.md`
- Ingin tahu apa yang rusak dan diperbaiki? → `docs/BUG_TRACKER.md`
- Ingin tahu batasnya? → `docs/KNOWN_LIMITATIONS.md`
