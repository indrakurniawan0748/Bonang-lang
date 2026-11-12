# RISK REGISTER — BONANG

Register risiko proyek. Diperbarui 2026-11-11.

Skala probabilitas dan dampak: **Rendah / Sedang / Tinggi / Sangat Tinggi**.
Status: `Ter mitigating`, `Ter mitigated`, `Diterima`, `Terbuka`.

---

## R-01 — Ketergantungan penuh pada ekosistem Node

- **Probabilitas**: Tinggi (tidak bisa hilang selama Node masih didukung)
- **Dampak**: Tinggi
- **Deskripsi**: BONANG adalah transpiler ke JavaScript, jadi seluruh
 Runtime bergsandar pada Node built-ins. Regresi atau perubahan
  kebijakan lisensi Node berdampak langsung.
- **Mitigasi**: Hanya API stabil yang dipakai (`node:sqlite`, `node:http`,
  `node:test`, `node:worker_threads` — semuanya di major/minor yang stabil).
  Target output adalah JavaScript murni, jadi porting ke Deno/Bun/browser
  realistis tanpa menyentuh compiler.
- **Status**: Diterima (dengan catatan)

---

## R-02 — Type safety tidak ditegakkan

- **Probabilitas**: Pasti (fitur belum ada)
- **Dampak**: Sedang
- **Deskripsi**: Anotasi tipe diparse lalu diabaikan saat codegen.
  Kesalahan tipe baru ketahuan saat runtime.
- **Mitigasi**: Validasi runtime yang eksplisit (`Request.validate()`,
  validator di service layer). Type checker incrementale adalah item
  roadmap, bukan klaim sekarang.
- **Status**: Terbuka — didokumentasikan di `docs/KNOWN_LIMITATIONS.md`

---

## R-03 — Batas backlog socket Windows saat beban tinggi

- **Probabilitas**: Tinggi (sudah terjadi)
- **Dampak**: Sedang
- **Deskripsi**: 500/1000 koneksi TCP simultan ditolak dengan
  `ECONNREFUSED` karena backlog listen default Node (511) dan batas OS
  Windows (±232 koneksi).
- **Mitigasi**: Backlog dinaikkan ke 8192; harness benchmark memakai
  `http.Agent` keep-alive. Test konkurensi kini lulus pada 1000 request.
  Untuk produksi di belakang reverse proxy, ini bukan isu.
- **Status**: Ter mitigated

---

## R-04 — `node:sqlite` bersifat sinkron

- **Probabilitas**: Pasti
- **Dampak**: Sedang
- **Deskripsi**: Query panjang memblokir event loop sehingga request lain
  tertunda.
- **Mitigasi**: `WorkerPool` tersedia untuk memindahkan pekerjaan CPU-bound
  dan query berat ke worker thread. Untuk beban CRUD normal,blocking SQLite
  justru lebih cepat daripada driver async.
- **Status**: Diterima

---

## R-05 — Skala database terbatas pada satu file SQLite

- **Probabilitas**: Tinggi
- **Dampak**: Tinggi untuk produksi serious
- **Deskripsi**: SQLite tidak cocok untuk multi-writer di banyak host.
- **Mitigasi**: Arsitektur repository mengisolasi akses SQL; adapter database
  bisa ditambahkan tanpa mengubah service/controller. Demo CRUD secara
  eksplisit memakai SQLite sesuai requirement.
- **Status**: Diterima untuk target demo

---

## R-06 — Resolusi konflik last-write-wins bisa menimpa data

- **Probabilitas**: Sedang
- **Dampak**: Sedang
- **Deskripsi**: Dua perangkat offline mengedit entitas yang sama — edit
  terakhir menang, data satu perangkat hilang.
- **Mitigasi**: Deteksi konflik berbasis `baseVersion` di server (409
  `CONFLICT` dengan `details.server`), sehingga UI bisa menampilkan diff dan
  meminta pilihan pengguna. `resolveConflict`/`reconcile` di client runtime
  mendukung policies kustom.
- **Status**: Ter mitigated (LWW + deteksi, bukan CRDT)

---

## R-07 — Bundler belum menangani dynamic import dan circular dependency

- **Probabilitas**: Rendah
- **Dampak**: Rendah
- **Deskripsi**: ~~Bundler hanya menangani import statis. `import()` dinamis
  dan siklus impor dapat menghasilkan `undefined` saat inisialisasi modul.~~
  **Selesai diperbaiki (BNG-048).** Bundler kini menangani siklus modul
  dan dynamic `import()`.
- **Mitigasi**: Bundler mendaftarkan modul sebelum membaca dependensinya,
  memakai cache modul bersama, dan codegen memakai **live binding**
  (`const _$$modN = require(...)`, dibaca dari `module.exports` saat
  dipakai) sehingga nilai modul siklik tidak terkunci `undefined`.
  Dynamic `import()` punya node AST `ImportExpression` dan helper
  `_$$dynamicImport`; modul yang diimpor dinamis ikut ter-bundle.
  Sisa batasan: path `import()` harus string literal (L-34).
  Dikunci 10 test di `tests/tools/module-graph.test.js`.
- **Status**: Ditutup (BNG-048)

---

## R-08 — CLI `test` dan `node --test` memakai dua format berbeda

- **Probabilitas**: Pasti
- **Dampak**: Rendah
- **Deskripsi**: Dua runner dengan dua konvensi file bisa membingungkan
  kontributor baru.
- **Mitigasi**: Pemisahan diklarifikasi: `bonang test` untuk kode **pengguna**
  (`.test.bng`), `node --test` untuk test internal repositori. Dicatat di
  `docs/TEST_REPORT.md` dan README.
- **Status**: Diterima

---

## R-09 — Single-process runtime: tidak ada clustering bawaan

- **Probabilitas**: Tinggi
- **Dampak**: Tinggi untuk produksi
- **Deskripsi**: `bonang dev`/`node dist/server.js` menjalankan satu proses.
- **Mitigasi**: Server menutup socket dengan rapi (graceful shutdown), jadi
  bisa dijalankan di belakang process manager atau di balik reverse proxy.
  Clustering `node:cluster` adalah item roadmap.
- **Status**: Terbuka

---

## R-10 — Package manager belum mendukung registry privat

- **Probabilitas**: Sedang
- **Dampak**: Rendah
- **Deskripsi**: `bonang install` hanya tahu registry npm publik.
- **Mitigasi**: Fungsi ekstraksi tarball sudah terpisah, jadi penambahan
  konfigurasi registry privat hanya menyentuh lapisan konfigurasi.
- **Status**: Terbuka

---

## R-11 — Tidak ada type checker statis pada compiler

- **Probabilitas**: Pasti
- **Dampak**: Sedang
- **Deskripsi**: Salah ketik pada nama variabel hanya ketahuan saat runtime.
  Compiler sudah menangkap undefined variable — scope tracking
  di codegen — tetapi tipe belum diperiksa.
- **Mitigasi**: Scope tracking di codegen (`Scope` dengan rantai parent)
  sudah menangkap identifier tak terdefinisi. Type checking adalah item
  roadmap terpisah.
- **Status**: Terbuka

---

## R-12 — Ukuran proyek dan waktu pemeliharaan

- **Probabilitas**: Sedang
- **Dampak**: Sedang
- **Deskripsi**: Bahasa + compiler + runtime + CLI + tooling adalah proyek
  besar. Kalau roadmap tidak diprioritaskan, fitur setengah jadi menumpuk.
- **Mitigasi**: `docs/PROJECT_PROGRESS.md` dan `docs/BUG_TRACKER.md` dipelihara
  sebagai sumber kebenaran; progres hanya naik bila ada bukti test.
- **Status**: Ter mitigating

---

## R-13 — Kerentanan pada modul-modul kriptografi

- **Probabilitas**: Rendah
- **Dampak**: Tinggi kalau terjadi
- **Deskripsi**: Implementasi hashing/CSRF sendiri bisa disalahpahami.
- **Mitigasi**: Semua primitif kriptografi memakai `node:crypto` (scrypt,
  HMAC, `timingSafeEqual`, `randomBytes`) — tidak ada algoritma buatan
  sendiri. Suite keamanan menguji setiap primitif.
- **Status**: Ter mitigated

---

## R-14 — Service worker bisa menyajikan aset basi

- **Probabilitas**: Sedang
- **Dampak**: Rendah
- **Deskripsi**: Cache-first untuk aset statis berarti deploy baru tidak
  langsung terlihat pengguna yang sudah pernah buka.
- **Mitigasi**: Versi cache di-key pada build hash; API tetap network-first.
  **Sudah diperkuat (BNG-043).** `bonang build` menghasilkan
  `precache-manifest.json` (hash SHA-256 per aset) dan
  `CacheInvalidator` menyediakan `prune`, `matchFresh`, dan `store` —
  hanya file yang berubah yang di-refresh, bukan seluruh cache.
  Dikunci 8 test di `tests/tools/sw-cache.test.js`, plus verifikasi di
  Chrome sungguhan lewat DevTools Protocol.
- **Status**: Ter mitigating (diperkuat BNG-043)

---

## R-15 — Benchmark bisa menyesatkan

- **Probabilitas**: Sedang
- **Dampak**: Sedang
- **Deskripsi**: Angka performa pada satu mesin tidak mewakili produksi.
  Perbandingan unfair (mis. Bonnie mengukur startup PHP tapi tidak startup
  Node) bisa membuat klaim palsu.
- **Mitigasi**: `prompt.md` mewajibkan tidak mengklaim Bonang lebih cepat
  sebelum ada bukti. Semua angka di `benchmarks/RESULTS.md` menyertakan
  kondisi mesin, konfigurasi, dan catatan metodologi. Baseline PHP diukur satu
  kali dengan startup di luar hitungan — dicatat eksplisit.
- **Status**: Ter mitigating

---

## Ringkasan Prioritas

| Prioritas | Risiko |
| --- | --- |
| Tinggi | R-01 (Node), R-05 (SQLite skala), R-09 (clustering) |
| Sedang | R-02 (tipe), R-04 (sqlite sinkron), R-06 (konflik), R-11 (type checker), R-12 (pemeliharaan), R-15 (benchmark) |
| Rendah | R-08 (dua runner), R-10 (registry privat), R-14 (cache aset) |
| Sudah dimitigasi | R-03 (backlog), R-13 (kriptografi) |
| Ditutup | R-07 (bundler: siklus modul & dynamic import — BNG-048) |
