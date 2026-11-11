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
**paritas** dengan JavaScript (rasio 1,06x, masih dalam rentang noise),
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
- Komentar dalam Bahasa Indonesia, 4 spasi indent.

### Runtime

- HTTP server dengan routing parametrik, middleware, body limit, header
  keamanan, graceful shutdown, dan pemetaan error ke status HTTP.
- Pool SQLite dengan transaksi, placeholder positional `?`, dan query
  builder ber-allowlist.
- Lapisan keamanan: scrypt, timing-safe compare, HMAC, CSRF, escaping,
  sanitasi path, validasi upload, rate limiter, session store.
- Worker pool (`node:worker_threads`) untuk pekerjaan CPU-bound.
- Runtime browser: DOM helper, IndexedDB, sync queue, resolusi konflik,
  `apiFetch` yang tidak pernah melempar exception.

### Toolchain

```
npm install -g .        # atau: node cli/cli.js <perintah>
```

| Perintah | Fungsi |
| --- | --- |
| `bonang init <dir>` | Membuat proyek baru |
| `bonang run <entry>` | Kompilasi lalu jalankan |
| `bonang build` | Bundel server + client ke `dist/` |
| `bonang dev` | Dev server dengan hot reload (SSE) |
| `bonang test` | Menjalankan test `.test.bng` |
| `bonang lint` | 10 aturan analisis statis |
| `bonang audit` | 7 pemeriksaan keamanan (AST-based) |
| `bonang bench` | 5 skenario benchmark |
| `bonang migrate` | Menjalankan migrasi database |
| `bonang version` | Versi bahasa |

### Aplikasi demo

`apps/bonang-crud-demo` — aplikasi CRUD penuh dalam Bonang: model
`Product`, repository, service, controller, SQLite `bonang_demo`, migrasi,
frontend, service worker, IndexedDB + sync queue, dan resolusi konflik
LWW dengan optimistic concurrency (`baseVersion`, 409 `CONFLICT`).

---

## Angka Terukur

| Metrik | Nilai |
| --- | --- |
| Test | 250 lulus, 0 gagal, 0 dilewati |
| Kompilasi | 4 932 batch/detik |
| Eksekusi | 1 919 386 operasi/detik |
| Baseline Node | 2 710 027 operasi/detik |
| Baseline Bonang | 2 873 563 operasi/detik |
| Rasio Bonang vs Node | 1,06x (paritas) |

Snapshot satu eksekusi `bonang bench`; rentang antar-jalankan ada di
`benchmarks/RESULTS.md` §8.3. Yang stabil di semua eksekusi: rasio
1,05x-1,06x dan uji non-blocking selalu lulus.
| Baseline PHP | 339 785 operasi/detik |
| HTTP p99 @ 1000 request | 471,86 ms (bawah NFR-03 1000 ms) |
| HTTP non-blocking check | 2,125 ms (lulus) |
| Temuan audit pada kode referensi | 0 |

Rincian dan metodologi: `benchmarks/RESULTS.md`.

---

## Yang Diperbaiki

38 bug tercatat di `docs/BUG_TRACKER.md`, seluruhnya sudah Fixed.
Lima di antaranya menyangkut keakuratan alat audit itu sendiri
(BNG-031 s.d. BNG-035) — sebelum diperbaiki, `bonang audit` melaporkan 19
temuan palsu pada kode referensi proyek sendiri, sehingga tidak dapat
dipakai sebagai gerbang kualitas. Sekarang: 0 temuan, dengan 11 test
regresi yang mengunci perilakunya.

---

## Persyaratan

- **Node.js >= 22** (diuji pada v24.21.0). `node:sqlite` dipakai langsung.
- **Tanpa dependensi eksternal.** `dependencies: {}` dan
  `devDependencies: {}`. Yang dibutuhkan hanya runtime Node dan, opsional,
  PHP untuk baseline benchmark.

---

## Batasan yang Diketahui

Bonang 0.1.0 **belum** memiliki type checker, ORM, soft delete, keyset
pagination, enkripsi at-rest, sinkronisasi background, atau sinkronisasi
antar-tab. Lintasannya masih perlu penilaian. Daftar lengkap dengan
dampak dan workaround: `docs/KNOWN_LIMITATIONS.md`.

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
