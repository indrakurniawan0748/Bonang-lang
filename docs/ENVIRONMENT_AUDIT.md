# ENVIRONMENT AUDIT — BONANG

Audit lingkungan kerja yang dipakai membangun BONANG. Semua angka di sini
diambil dari mesin yang benar-benar menjalankan build dan test, bukan
estimasi.

Audit ini dilakukan pada **2026-11-11**.

---

## 1. Ringkasan

| Aspek | Nilai | Dampak ke keputusan teknis |
| --- | --- | --- |
| OS | Windows 11 Home 10.0.26300 | Path dipisah `path.sep` (`\`), bukan `/` |
| Arsitektur | x64 | Build byte-code Node tidak perlu cross-compile |
| Node.js | v24.21.0 | `node:sqlite` stabil, `node:test` matang, Worker API lengkap |
| npm | 11.19.0 | Hanya dipakai untuk introspection; runtime tidak butuh npm |
| PHP | 8.2.12 (ZTS, VS 2019) | Tersedia sebagai baseline benchmark |
| Java | OpenJDK 17.0.19 | Tersedia, tidak dipakai |
| Python | 3.11 | Tersedia, tidak dipakai |
| Rust / Go | **Tidak terpasang** | Compiler native tidak bisa dibangun di sini |
| Git | 2.54.0.windows.1 | Repo ini sengaja tidak di-init (lihat §6) |
| CPU | 12 core logis | Worker pool punya ruang untuk paralelisme CPU-bound |
| RAM | 17,0 GB | Pool koneksi + benchmark muat tanpa tekanan |
| Internet | Tidak diandalkan | Runtime wajib jalan tanpa unduhan eksternal |

---

## 2. Toolchain yang tersedia

### 2.1 Yang dipakai BONANG

| Tool | Versi | Dipakai untuk |
| --- | --- | --- |
| Node.js | v24.21.0 | Runtime target, test runner, toolchain compiler |
| `node:sqlite` | bawaan v24 | Database driver (tanpa dependensi npm) |
| `node:test` | bawaan v24 | Test runner untuk seluruh suite |
| `node:http` | bawaan v24 | HTTP server |
| `node:worker_threads` | bawaan v24 | Paralelisme CPU-bound |

### 2.2 Yang hanya dipakai sebagai pembanding

| Tool | Peran |
| --- | --- |
| PHP 8.2.12 | Baseline benchmark throughput |
| Node.js langsung | Baseline implementasi JS murni |

### 2.3 Yang tidak tersedia

- **Rust** (`rustc` tidak ditemukan di PATH) — membangun compiler native
  (LLVM-based) mustahil di lingkungan ini tanpa toolchain tambahan.
- **Go** (`go` tidak ditemukan di PATH) — opsi backend native yang sama.
- **JavaScript bundler pihak ketiga** (esbuild, rollup, webpack) — tidak ada
  di `node_modules` dan tidak ada kebijakan untuk menambahkannya.

---

## 3. Konsekuensi terhadap arsitektur

### 3.1 Keputusan utama: transpiler, bukan compiler native

Karena Rust dan Go tidak tersedia, BONANG tidak bisa menghasilkan binary
mandiri. Keputusan yang diambil: **BONANG adalah transpiler ke JavaScript**,
dengan Node.js/V8 sebagai mesin eksekusi.

Konsekuensi:

- Zero dependensi npm. `package.json` tidak punya `dependencies` maupun
  `devDependencies`.
- Build Extremely cepat (tidak ada linking, tidak ada codegen LLVM).
- Perfek runtime setara JavaScript, bukan menceqati bahasa seperti Rust atau
  Go — danBonang tidak mengklaim lebih cepat tanpa bukti.
- Target lain (browser, Deno, Bun) menjadi mungkin karena output-nya JS murni.

### 3.2 Database

`node:sqlite` (`DatabaseSync`) tersedia di Node 24 dan bersifat sinkron. Ini
sebenarnya menguntungkan untuk model concurrency BONANG: pemanggilan database
singkat, tidak perlu driver native async yang rebuild.

Konsekuensi yang harus disadari:

- Operasi database memblokir event loop selama eksekusi SQL. Untuk beban
  read/write ringan (kasus CRUD tipikal) ini jauh lebih cepat daripada
  thread-pool async; untuk query panjang, `WorkerPool` adalah jalan yang benar
  dan sudah tersedia di runtime.
- Kontrol konkurensi SQLite dijaga lewat `busy_timeout` dan mode WAL.

### 3.3 Concurrency

Windows membatasi backlog `listen()` pada level OS (sekitar 232 koneksi
simultan pada build ini). Ditemukan saat pengujian konkurensi: 1000 koneksi
sekaligus ditolak dengan `ECONNREFUSED`.

Solusi yang diterapkan (bukan workaround semu):

- Backlog listen dinaikkan ke 8192 di `runtime/http/server.js`.
- `maxConnections` **tidak** disetel ke 0 (Node membaca 0 sebagai "tolak
  semua koneksi") dan dibiarkan default (unlimited).
- Test harness memakai `http.Agent` dengan `keepAlive: true` dan jumlah
  socket dibatasi — cara kerja tool benchmark sungguhan.

### 3.4 Path dan encoding

- Pemisahan path memakai `path.sep`; `safeJoin` dibandingkan dengan
  `resolvedRoot + path.sep` supaya `/data-evil` tidak lolos dari root `/data`.
- Semua berkas proyek disimpan UTF-8 tanpa BOM.

---

## 4. Verifikasi environment

Perintah berikut dijalankan untuk memastikan klaim di atas benar:

```
$ node -v
v24.21.0

$ npm -v
11.19.0

$ php -v
PHP 8.2.12 (cli) (built: Oct 24 2023 21:15:15) (ZTS Visual C++ 2019 x64)

$ java -version
openjdk version "17.0.19" 2026-04-21

$ git --version
git version 2.54.0.windows.1

$ node -e "console.log(require('os').cpus().length,'cores', require('os').totalmem()/1e9,'GB')"
12 cores 17.00962304 GB

$ where rustc
INFO: Could not find "rustc".

$ where go
INFO: Could not find "go".
```

---

## 5. Batasan lingkungan yang memengaruhi roadmap

| Batasan | Efek | Mitigasi yang dipakai |
| --- | --- | --- |
| Tanpa Rust/Go | Tidak ada binary native | Transpiler ke JS; target Node/browser |
| Backlog listen Windows rendah | 1000 koneksi simultan ditolak | Backlog 8192 + agent keep-alive di harness |
| `node:sqlite` sinkron | Query panjang memblokir loop | `WorkerPool` untuk pekerjaan CPU-bound |
| Tanpa jaringan terjamin | `npm install` tidak selalu mungkin | Nol dependensi eksternal |
| Single-machine | Skala horizontal tidak terukur | Konkurensi diukur in-process; clustering markah rencana |

---

## 6. Keputusan regarding kendali versi

Direktori kerja **tidak** diinisialisasi sebagai repository git. Repository
kosong akan menambah artefak yang tidak diminta `prompt.md`, sementara seluruh
progres sudah tercatat di `docs/PROJECT_PROGRESS.md` dan
`docs/BUG_TRACKER.md`. Semua artefak proyek berada di
`c:\Users\adria\Desktop\Bonang-lang`.

---

## 7. Ringkasan temuan dan rekomendasi

**Temuan:**

1. Node 24 menyediakan seluruh primitive yang dibutuhkan (SQLite, test
   runner, worker threads, HTTP) — tidak ada alasan menambah dependensi.
2. Toolchain compiler native tidak ada di sini.
3. Batas backlog socket Windows adalah penyebab sebenarnya kegagalan
   `ECONNREFUSED` pada beban 500/1000 request, bukan defect BONANG.

**Rekomendasi yang sudah diterapkan:**

1. Transpiler ke JavaScript sebagai model eksekusi tunggal.
2. Nol dependensi npm sebagai postulate arsitektur.
3. Backlog listen dinaikkan dan harness benchmark memakai keep-alive agent.
4. Akses filesystem di semua jalur melewati `safeJoin`.
5. SQL hanya lewat prepared statement dengan placeholder positional `?`.
