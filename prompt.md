# MASTER PROJECT PROMPT — BONANG PROGRAMMING LANGUAGE

## 1\. ROLE AND MISSION

Bertindak sebagai Principal Programming Language Engineer, Compiler Engineer, Runtime Architect, Database Engineer, Security Engineer, dan QA Automation Engineer.

Tugas utama adalah merancang, membangun, menguji, mengaudit, dan menyempurnakan bahasa pemrograman baru bernama:

**BONANG — Browser Optimized Network And Native Graphics**

Bonang adalah bahasa pemrograman full-stack yang dirancang untuk mengembangkan aplikasi web modern menggunakan satu bahasa pemrograman untuk Frontend (FE) dan Backend (BE).

Bonang bukan sekadar framework, wrapper JavaScript, atau kumpulan library. Targetnya adalah menghasilkan bahasa pemrograman dengan compiler/transpiler, runtime, package manager, standard library, database integration, development server, dan tooling sendiri.

Proyek harus benar-benar diimplementasikan dalam repository kerja, bukan hanya menghasilkan dokumentasi atau contoh kode.

Jangan berhenti pada tahap perencanaan. Lanjutkan implementasi sampai bahasa Bonang dapat digunakan untuk menjalankan aplikasi CRUD nyata di localhost.

---

# 2\. VISI DAN TUJUAN UTAMA

Bonang harus memiliki karakteristik:

1. Lightweight: penggunaan CPU dan RAM efisien.
2. High Performance: mampu menangani banyak request secara bersamaan.
3. Non-blocking: request tidak harus menunggu request sebelumnya selesai.
4. Parallel Processing: mendukung concurrency dan parallel execution.
5. Database Optimized: akses database efisien dan connection pooling.
6. Full-stack: satu bahasa untuk FE dan BE.
7. OOP: mendukung Object-Oriented Programming.
8. Offline First: aplikasi tetap dapat digunakan ketika koneksi internet terputus.
9. Local Server: dapat berjalan sepenuhnya pada localhost.
10. Production Ready: memiliki keamanan, stabilitas, logging, testing, dan deployment tooling.

Jangan membuat klaim performa tanpa pengukuran.

Prioritaskan kesederhanaan, efisiensi, maintainability, keamanan, dan performa nyata.

---

# 3\. NON-NEGOTIABLE ENGINEERING PRINCIPLES

Ikuti prinsip berikut sepanjang pengembangan:

- Jangan membuat implementasi palsu atau fitur dummy.
- Jangan menggunakan hardcoded mock response untuk menggantikan fitur yang belum tersedia.
- Jangan menyatakan fitur selesai sebelum diuji.
- Jangan menyembunyikan error dengan mengabaikan exception.
- Jangan menggunakan workaround yang hanya membuat testing terlihat berhasil.
- Jangan menonaktifkan test untuk menghilangkan kegagalan.
- Jangan mengorbankan keamanan demi performa.
- Jangan membuat arsitektur terlalu kompleks tanpa alasan teknis.
- Hindari ketergantungan library yang tidak diperlukan.
- Setiap dependency harus memiliki alasan penggunaan.
- Semua komponen harus memiliki dokumentasi.
- Setiap perubahan harus diikuti pengujian regresi.
- Jangan mengubah spesifikasi inti secara sepihak. Catat perubahan dan alasannya di dokumentasi.
- Jangan mengklaim 100% bebas error. Gunakan bukti testing, audit, dan known limitations.

Jika menemukan masalah, lakukan investigasi akar penyebab, perbaikan, dan pengujian ulang sebelum melanjutkan.

---

# 4\. PHASE 0 — PROJECT DISCOVERY AND ENVIRONMENT AUDIT

Sebelum coding:

1. Periksa sistem operasi dan lingkungan kerja.
2. Identifikasi CPU, RAM, storage, dan toolchain yang tersedia.
3. Identifikasi compiler, runtime, dan bahasa implementasi yang tersedia.
4. Periksa struktur repository.
5. Identifikasi dependency yang sudah terpasang.
6. Pastikan apakah environment dapat menjalankan compiler dan development server.
7. Periksa port localhost yang tersedia.
8. Buat dokumentasi hasil pemeriksaan.

Jangan menghapus atau merusak file yang sudah ada tanpa persetujuan.

Buat:

- `docs/ENVIRONMENT_AUDIT.md`
- `docs/TECHNICAL_DECISIONS.md`
- `docs/RISK_REGISTER.md`

Pilih bahasa implementasi compiler/runtime berdasarkan pertimbangan performa, keamanan memori, portability, dan kemudahan maintenance.

Rust merupakan kandidat utama, tetapi keputusan harus berdasarkan audit teknis.

---

# 5\. PHASE 1 — PRODUCT REQUIREMENTS DOCUMENT (PRD)

Buat dokumen PRD lengkap sebelum implementasi.

File:

`docs/PRD.md`

PRD harus menjelaskan:

## 5.1 Language Specification

Tentukan:

- Syntax dan grammar.
- Keywords.
- Variables.
- Constants.
- Data types.
- Operators.
- Functions.
- Parameters.
- Return values.
- Scope.
- Modules.
- Imports.
- Exports.
- Error handling.
- Async/await.
- Concurrency.
- Parallel processing.
- Generics jika diperlukan.
- Type checking.
- Memory management.

## 5.2 Object-Oriented Programming

Bonang wajib dirancang dengan konsep OOP:

- Class.
- Object.
- Constructor.
- Properties.
- Methods.
- Encapsulation.
- Inheritance.
- Polymorphism.
- Interfaces.
- Abstract classes.
- Static methods.
- Access modifiers.
- Namespaces.

Buat struktur OOP yang mudah dipahami dan tidak terlalu verbose.

## 5.3 Full-stack Architecture

Tentukan bagaimana Bonang membedakan kode frontend dan backend.

Pertimbangkan deklarasi eksplisit seperti:

- `server`
- `client`
- `shared`

Pastikan kode backend tidak pernah ikut dikirim ke browser.

Kode shared harus memiliki batasan API yang jelas dan tidak boleh mengakses resource khusus server atau browser secara sembarangan.

## 5.4 Frontend Requirements

Bonang harus menyediakan:

- UI components.
- Reactive state.
- Event handling.
- DOM manipulation.
- Routing.
- HTTP client.
- Form handling.
- Validation.
- CSS integration.
- Component lifecycle.
- Data binding.
- Error boundaries atau mekanisme penanganan error UI.

Frontend harus menghasilkan kode browser yang efisien.

Jangan mengirim seluruh runtime backend ke browser.

## 5.5 Backend Requirements

Bonang harus menyediakan:

- HTTP server.
- Routing.
- Middleware.
- Request handling.
- Response handling.
- JSON handling.
- Cookie.
- Session.
- Authentication.
- Authorization.
- File upload.
- File streaming.
- WebSocket jika memungkinkan.
- Logging.
- Rate limiting.
- Graceful shutdown.

## 5.6 Concurrency Architecture

Ini merupakan salah satu prioritas tertinggi.

Rancang backend menggunakan:

- Event-driven architecture.
- Non-blocking I/O.
- Async runtime.
- Efficient task scheduling.
- Thread pool atau worker pool jika diperlukan.
- Parallel execution untuk pekerjaan CPU-intensive.
- Connection pooling.
- Backpressure.
- Request cancellation.
- Timeout handling.
- Graceful shutdown.

Jangan membuat satu thread untuk setiap request tanpa pertimbangan.

Pastikan request yang menunggu database atau network tidak memblokir request lain.

Bedakan concurrency dan parallelism secara teknis.

## 5.7 Database Architecture

Bonang harus memiliki database abstraction layer.

Prioritaskan:

- MariaDB.
- MySQL.
- SQLite.

Pertimbangkan PostgreSQL sebagai backend tambahan.

Fitur wajib:

- Connection pooling.
- Prepared statements.
- Parameter binding.
- Transactions.
- Query builder.
- ORM opsional.
- Raw SQL.
- Migration.
- Seeding.
- Relationship.
- Pagination.
- Bulk insert.
- Error handling.
- Connection timeout.
- Query timeout.

Database access harus asynchronous dan tidak memblokir event loop.

Jangan memaksakan ORM jika raw SQL lebih efisien.

## 5.8 Offline First Architecture

Rancang sistem offline-first yang benar-benar dapat digunakan.

Target:

- Local database menggunakan IndexedDB.
- Local data persistence.
- Client-side caching.
- Offline CRUD.
- Background synchronization ketika koneksi kembali.
- Sync queue.
- Retry mechanism.
- Conflict detection.
- Conflict resolution.
- Data versioning.
- Optimistic UI.
- Service Worker integration.

Aplikasi harus tetap dapat melakukan operasi CRUD saat internet terputus, dengan data tersimpan secara lokal.

Bedakan offline pada browser dengan offline pada localhost server. Keduanya harus dijelaskan dalam dokumentasi.

## 5.9 Local Development

Bonang wajib mendukung:

- Local development server.
- Hot reload.
- Automatic compilation.
- Local database.
- Debugging.
- Error reporting.
- Environment configuration.
- Build command.
- Production mode.

Target penggunaan:

`http://localhost:PORT`

Tidak membutuhkan internet untuk menjalankan aplikasi yang dependency-nya sudah tersedia secara lokal.

---

# 6\. PHASE 2 — LANGUAGE DESIGN AND ARCHITECTURE

Buat dokumen:

`docs/LANGUAGE_SPECIFICATION.md`

`docs/ARCHITECTURE.md`

`docs/GRAMMAR.md`

`docs/COMPILER_DESIGN.md`

`docs/RUNTIME_DESIGN.md`

`docs/SECURITY_DESIGN.md`

`docs/DATABASE_DESIGN.md`

`docs/OFFLINE_FIRST_DESIGN.md`

Rancang pipeline:

Source Code → Lexer → Parser → AST → Semantic Analysis → Type Checker → Intermediate Representation → Optimizer → Code Generator → Runtime.

Tentukan dengan jelas apakah Bonang menggunakan:

- Transpilation.
- Bytecode.
- Native compilation.
- Hybrid architecture.

Pilih pendekatan paling realistis untuk menghasilkan FE dan BE yang efisien.

Jangan membuat compiler terlalu kompleks pada tahap awal.

Buat Minimum Viable Language terlebih dahulu, tetapi arsitekturnya harus memungkinkan pengembangan lanjutan tanpa menulis ulang seluruh sistem.

---

# 7\. PHASE 3 — PROJECT STRUCTURE

Buat struktur repository yang rapi dan modular.

Contoh struktur target:

bonang/
├── compiler/
│   ├── lexer/
│   ├── parser/
│   ├── ast/
│   ├── semantic/
│   ├── typechecker/
│   ├── optimizer/
│   └── codegen/
├── runtime/
│   ├── core/
│   ├── async/
│   ├── network/
│   ├── http/
│   ├── database/
│   ├── security/
│   └── filesystem/
├── frontend/
│   ├── compiler/
│   ├── runtime/
│   └── components/
├── standard-library/
├── package-manager/
├── cli/
├── examples/
├── tests/
│   ├── unit/
│   ├── integration/
│   ├── concurrency/
│   ├── database/
│   ├── security/
│   ├── offline/
│   └── regression/
├── benchmarks/
├── docs/
└── README.md

Struktur tersebut merupakan rancangan awal, bukan kewajiban mutlak.

Silakan sesuaikan berdasarkan keputusan arsitektur yang sudah didokumentasikan.

---

# 8\. PHASE 4 — IMPLEMENTATION ROADMAP

Implementasikan secara bertahap.

## Stage 1: Language Core

Implementasikan:

- Lexer.
- Parser.
- AST.
- Variables.
- Constants.
- Data types.
- Expressions.
- Functions.
- Conditions.
- Loops.
- Modules.
- Error messages.

Acceptance criteria:

Program Bonang sederhana dapat dikompilasi dan dijalankan.

## Stage 2: OOP

Implementasikan:

- Classes.
- Objects.
- Constructors.
- Methods.
- Properties.
- Encapsulation.
- Inheritance.
- Interfaces.
- Polymorphism.

Acceptance criteria:

Program OOP dapat dijalankan dan diuji.

## Stage 3: Runtime and Concurrency

Implementasikan:

- Async/await.
- Event loop atau scheduler.
- Non-blocking I/O.
- Worker pool.
- Task management.
- Request cancellation.
- Error propagation.

Acceptance criteria:

Beberapa task asynchronous dapat berjalan secara concurrent tanpa saling memblokir.

## Stage 4: Backend

Implementasikan:

- HTTP server.
- Router.
- Middleware.
- Request/response.
- JSON.
- Cookie.
- Session.
- Authentication.
- File handling.

Acceptance criteria:

Bonang dapat menjalankan REST API localhost.

## Stage 5: Database

Implementasikan:

- Database drivers.
- Connection pooling.
- Prepared statements.
- Transactions.
- Query builder.
- Migration.
- SQLite support.
- MariaDB/MySQL support.

Acceptance criteria:

CRUD database dapat dilakukan tanpa mock data.

## Stage 6: Frontend

Implementasikan:

- Frontend compiler.
- Components.
- Reactive state.
- Events.
- Routing.
- Forms.
- HTTP client.
- CSS support.

Acceptance criteria:

Bonang dapat menghasilkan frontend yang berjalan di browser.

## Stage 7: Offline First

Implementasikan:

- IndexedDB adapter.
- Offline CRUD.
- Sync queue.
- Reconnection detection.
- Retry.
- Conflict handling.
- Service Worker.

Acceptance criteria:

CRUD tetap berjalan ketika koneksi internet terputus dan perubahan dapat disinkronkan kembali.

## Stage 8: Tooling

Implementasikan CLI:

- `bonang init`
- `bonang dev`
- `bonang build`
- `bonang run`
- `bonang test`
- `bonang lint`
- `bonang audit`
- `bonang bench`
- `bonang migrate`

Perintah harus benar-benar berfungsi, bukan sekadar placeholder.

---

# 9\. PHASE 5 — CODING STANDARDS

Terapkan standar:

- Modular architecture.
- Single Responsibility Principle.
- Dependency Injection jika relevan.
- Separation of Concerns.
- SOLID.
- DRY.
- Consistent naming.
- Explicit error handling.
- Strict typing jika memungkinkan.
- Minimal global state.
- Clear ownership dan lifecycle resource.
- No unnecessary allocations.
- No blocking operations pada event loop.
- No hidden database queries.

Semua kode harus mudah dibaca dan dikembangkan.

Hindari satu file raksasa yang mengandung seluruh implementasi.

---

# 10\. PHASE 6 — TESTING STRATEGY

Buat automated testing sejak awal.

## Unit Testing

Uji setiap komponen compiler dan runtime.

## Integration Testing

Uji integrasi:

- Compiler dengan runtime.
- Backend dengan database.
- Frontend dengan API.
- Authentication dengan session.
- Offline storage dengan synchronization.

## Concurrency Testing

Uji:

- 10 concurrent requests.
- 100 concurrent requests.
- 500 concurrent requests.
- 1.000 concurrent requests jika hardware memungkinkan.

Catat:

- Total requests.
- Successful requests.
- Failed requests.
- Requests per second.
- Average latency.
- P50 latency.
- P95 latency.
- P99 latency.
- CPU usage.
- RAM usage.

Jangan memaksakan target yang tidak realistis. Catat hardware dan konfigurasi pengujian.

## Database Testing

Uji:

- Insert.
- Select.
- Update.
- Delete.
- Transactions.
- Concurrent writes.
- Connection exhaustion.
- Database timeout.
- Database unavailable.
- SQL injection protection.

## Offline Testing

Uji:

- Offline page loading.
- Offline insert.
- Offline update.
- Offline delete.
- Reconnection.
- Sync queue.
- Duplicate prevention.
- Conflict resolution.

## Security Testing

Uji:

- SQL injection.
- XSS.
- CSRF.
- Authentication bypass.
- Authorization bypass.
- Path traversal.
- Unsafe file uploads.
- Session fixation.
- Secret leakage.
- Backend code leakage ke frontend.
- Input validation.
- Dependency vulnerabilities.

---

# 11\. PHASE 7 — BUILD REAL CRUD APPLICATION

Ini merupakan acceptance test utama proyek.

Setelah compiler, runtime, backend, frontend, dan database tersedia, WAJIB buat aplikasi CRUD sungguhan menggunakan bahasa Bonang.

Nama aplikasi:

**Bonang CRUD Demo**

Aplikasi harus berjalan di localhost dan tidak menggunakan PHP atau JavaScript sebagai bahasa aplikasi yang ditulis developer.

JavaScript yang dihasilkan compiler untuk browser diperbolehkan sebagai output internal.

## CRUD Requirements

Buat aplikasi manajemen produk dengan fitur:

1. Menampilkan daftar produk.
2. Menambahkan produk.
3. Mengedit produk.
4. Menghapus produk.
5. Melihat detail produk.
6. Search.
7. Pagination.
8. Form validation.
9. Loading indicator.
10. Error handling.
11. Responsive layout.

Database:

`bonang_demo`

Tabel:

`products`

Kolom minimal:

- id
- name
- description
- price
- stock
- created\_at
- updated\_at

Gunakan SQLite untuk pengujian awal agar tidak membutuhkan server database eksternal.

Jika memungkinkan, lakukan pengujian tambahan menggunakan MariaDB.

## OOP Requirement

Aplikasi harus menggunakan struktur OOP.

Contoh pemisahan:

- Product
- ProductRepository
- ProductService
- ProductController

Frontend juga harus menggunakan component architecture.

## Offline First Requirement

Ketika browser offline:

- Daftar produk yang pernah diakses tetap dapat dibuka.
- User dapat menambahkan produk.
- User dapat mengedit produk.
- User dapat menghapus produk.
- Perubahan disimpan ke IndexedDB.
- Perubahan masuk ke synchronization queue.
- Ketika koneksi kembali, perubahan disinkronkan ke backend.
- Tampilkan status synchronization.

Jangan membuat UI offline yang hanya simulasi.

Pastikan data benar-benar disimpan secara lokal.

## Final CRUD Acceptance Criteria

Aplikasi dinyatakan berhasil apabila:

- Berjalan pada localhost.
- Seluruh frontend dibuat menggunakan Bonang.
- Seluruh backend dibuat menggunakan Bonang.
- Database benar-benar digunakan.
- Seluruh operasi CRUD berfungsi.
- OOP digunakan.
- Tidak ada data dummy sebagai pengganti database.
- Offline CRUD benar-benar bekerja.
- Sync dapat diuji.
- Tidak terdapat error fatal.
- Browser console bersih dari error aplikasi.
- Backend log bersih dari error yang tidak tertangani.
- Seluruh automated tests lulus.

---

# 12\. PHASE 8 — PERFORMANCE BENCHMARK

Bandingkan Bonang dengan setidaknya satu baseline yang relevan.

Jika memungkinkan, gunakan:

- PHP dengan konfigurasi PHP-FPM.
- Node.js dengan HTTP server sederhana.

Gunakan:

- Hardware yang sama.
- Endpoint yang sama.
- Database yang sama.
- Data yang sama.
- Jumlah request yang sama.
- Kondisi pengujian yang sama.

Benchmark:

1. Hello World.
2. JSON response.
3. Database SELECT.
4. Database INSERT.
5. Database UPDATE.
6. Database DELETE.
7. Concurrent requests.
8. Memory usage.
9. CPU usage.

Hasil harus objektif dan dapat direproduksi.

Buat:

`benchmarks/RESULTS.md`

Jangan mengklaim Bonang lebih cepat sebelum hasil pengukuran membuktikannya.

---

# 13\. PHASE 9 — ERROR HANDLING AND SELF-RECOVERY

Ini adalah instruksi penting.

AI Agent harus bekerja dengan mekanisme error recovery.

Setiap kali ditemukan error:

### Step 1 — Stop and Identify

Hentikan tahapan yang bergantung pada komponen bermasalah.

Identifikasi:

- Error message.
- Error location.
- Stack trace.
- Reproduction steps.
- Expected behavior.
- Actual behavior.

### Step 2 — Root Cause Analysis

Tentukan apakah masalah berasal dari:

- Syntax.
- Compiler.
- Parser.
- Type checker.
- Runtime.
- Memory.
- Async execution.
- Database.
- Frontend.
- Browser compatibility.
- Configuration.
- Dependency.
- Architecture.

### Step 3 — Create Bug Record

Catat pada:

`docs/BUG_TRACKER.md`

Format:

- Bug ID.
- Date.
- Component.
- Severity.
- Description.
- Root cause.
- Proposed fix.
- Fix applied.
- Regression test.
- Status.

### Step 4 — Fix

Perbaiki sumber masalah.

Jangan hanya menutupi gejala.

### Step 5 — Retest

Jalankan:

1. Test khusus komponen.
2. Unit tests terkait.
3. Integration tests terkait.
4. Regression tests.
5. Full test suite jika diperlukan.

### Step 6 — Audit

Pastikan perbaikan tidak merusak fitur lain.

### Step 7 — Continue

Lanjutkan development setelah masalah teratasi.

Jika belum bisa diperbaiki:

- Jangan menandai fitur sebagai selesai.
- Dokumentasikan blocker.
- Jelaskan penyebabnya.
- Coba pendekatan alternatif.
- Jangan menghapus test yang gagal.
- Jangan mengklaim hasil berhasil.

Jika menemukan bug baru saat regression testing, ulangi proses yang sama.

---

# 14\. PHASE 10 — CONTINUOUS AUDIT

Lakukan audit berkala pada setiap milestone.

Audit meliputi:

## Code Quality

- Duplikasi kode.
- Complexity.
- Dead code.
- Unused dependencies.
- Circular dependencies.
- Memory leaks.
- Resource leaks.

## Performance

- CPU.
- RAM.
- Allocation.
- Database latency.
- Event loop blocking.
- Thread contention.
- Unnecessary serialization.

## Security

- Input validation.
- Authentication.
- Authorization.
- SQL injection.
- XSS.
- CSRF.
- Secret handling.
- Dependency vulnerabilities.

## Architecture

- Modularitas.
- Separation of concerns.
- Coupling.
- Extensibility.
- Error propagation.
- Backward compatibility.

Simpan hasil pada:

`docs/AUDIT_REPORT.md`

---

# 15\. PHASE 11 — PROGRESS TRACKING

Buat:

`docs/PROJECT_PROGRESS.md`

Catat perkembangan secara konsisten.

Format:

| Phase | Task | Status | Progress | Test | Notes |
| --- | --- | --- | --- | --- | --- |
| 0 | Environment audit | Pending | 0% | \- | \- |
| 1 | PRD | Pending | 0% | \- | \- |
| 2 | Architecture | Pending | 0% | \- | \- |
| 3 | Language core | Pending | 0% | \- | \- |
| 4 | OOP | Pending | 0% | \- | \- |
| 5 | Runtime | Pending | 0% | \- | \- |
| 6 | Backend | Pending | 0% | \- | \- |
| 7 | Database | Pending | 0% | \- | \- |
| 8 | Frontend | Pending | 0% | \- | \- |
| 9 | Offline first | Pending | 0% | \- | \- |
| 10 | CRUD application | Pending | 0% | \- | \- |
| 11 | Benchmark | Pending | 0% | \- | \- |
| 12 | Final audit | Pending | 0% | \- | \- |

Status yang diperbolehkan:

- Pending.
- In Progress.
- Blocked.
- Testing.
- Failed.
- Completed.

Jangan menaikkan persentase berdasarkan perkiraan.

Progress harus berdasarkan pekerjaan yang benar-benar selesai.

Setiap milestone harus mencatat:

- Apa yang telah dibuat.
- File yang berubah.
- Fitur yang berhasil.
- Test yang dijalankan.
- Hasil test.
- Bug yang ditemukan.
- Bug yang diperbaiki.
- Known limitations.
- Next action.

Simpan juga:

`docs/CHANGELOG.md`

`docs/TEST_REPORT.md`

`docs/KNOWN_LIMITATIONS.md`

`docs/RELEASE_NOTES.md`

---

# 16\. PHASE 12 — FINAL DOCUMENTATION

Pastikan tersedia:

- README.md
- Installation guide.
- Getting started.
- Language syntax guide.
- OOP guide.
- Frontend guide.
- Backend guide.
- Database guide.
- Offline first guide.
- CLI reference.
- API reference.
- Troubleshooting.
- Performance guide.
- Security guide.
- Deployment guide.
- Migration guide.

Buat contoh aplikasi yang dapat dijalankan langsung.

Pengguna baru harus dapat menginstal Bonang, membuat project, menjalankan localhost, dan membuat CRUD tanpa harus memahami internal compiler.

---

# 17\. DEFINITION OF DONE

Proyek Bonang tidak boleh dinyatakan selesai hanya karena compiler berhasil dibangun.

Status final hanya boleh diberikan jika:

1. Language core berfungsi.
2. OOP berfungsi.
3. Compiler menghasilkan output yang benar.
4. Runtime berjalan stabil.
5. Backend dapat menangani concurrent requests.
6. Database integration berfungsi.
7. Frontend dapat berjalan di browser.
8. Local development server berfungsi.
9. Offline-first CRUD berfungsi.
10. Synchronization berfungsi.
11. Automated tests lulus.
12. Security audit dilakukan.
13. Performance benchmark dilakukan.
14. CRUD application berhasil dijalankan.
15. Dokumentasi tersedia.
16. Known limitations didokumentasikan.
17. Tidak ada critical atau high severity bug yang belum terselesaikan.

Jika ada kriteria yang belum terpenuhi, laporkan sebagai incomplete, bukan completed.

---

# 18\. AGENT EXECUTION RULES

Ikuti workflow berikut:

1. Baca seluruh instruksi.
2. Audit environment.
3. Buat PRD.
4. Buat arsitektur.
5. Buat roadmap.
6. Implementasikan tahap demi tahap.
7. Jalankan test setiap selesai implementasi komponen.
8. Perbaiki error sebelum melanjutkan.
9. Lakukan regression testing.
10. Update progress setiap milestone.
11. Buat aplikasi CRUD nyata.
12. Jalankan aplikasi di localhost.
13. Uji seluruh fungsi melalui browser dan backend.
14. Jalankan offline testing.
15. Jalankan concurrency testing.
16. Jalankan security audit.
17. Jalankan performance benchmark.
18. Buat final audit report.

Jangan berhenti setelah menghasilkan PRD.

Jangan meminta persetujuan untuk setiap file atau tahapan implementasi yang sudah diizinkan oleh instruksi ini.

Jika ada keputusan teknis yang tidak ditentukan, pilih solusi paling rasional, dokumentasikan alasannya, dan lanjutkan.

Jika ada keterbatasan environment, cari alternatif yang realistis tanpa mengklaim pengujian yang tidak dilakukan.

Jangan menghapus atau menimpa pekerjaan pengguna.

---

# 19\. FINAL REPORT

Setelah seluruh pekerjaan selesai, berikan laporan:

1. Status keseluruhan proyek.
2. Arsitektur final Bonang.
3. Compiler dan runtime yang digunakan.
4. Fitur yang telah berfungsi.
5. Fitur yang belum selesai.
6. Struktur repository.
7. Cara instalasi.
8. Cara membuat project baru.
9. Cara menjalankan development server.
10. Cara menjalankan production build.
11. Lokasi aplikasi CRUD.
12. Hasil automated testing.
13. Hasil concurrency testing.
14. Hasil database testing.
15. Hasil offline testing.
16. Hasil security audit.
17. Hasil performance benchmark.
18. Daftar bug yang belum terselesaikan.
19. Known limitations.
20. Rekomendasi pengembangan berikutnya.

Berikan bukti berupa command, output, dan laporan pengujian yang benar-benar dijalankan.

---

# FINAL DIRECTIVE

Mulai dari PHASE 0.

Bangun BONANG sebagai bahasa pemrograman yang benar-benar dapat digunakan, bukan sekadar konsep.

Prioritas tertinggi:

**LIGHTWEIGHT + HIGH PERFORMANCE + NON-BLOCKING + DATABASE EFFICIENCY + FULLSTACK + OFFLINE FIRST.**

Jaga agar setiap keputusan arsitektur mendukung tujuan tersebut.

Jangan terburu-buru membuat banyak fitur tetapi mengorbankan fondasi compiler, runtime, concurrency, dan keamanan.

Bangun fondasi yang benar, lakukan pengujian, audit, perbaiki, dan lanjutkan sampai Bonang berhasil menjalankan aplikasi CRUD nyata di localhost.

Mulai bekerja sekarang.


Satu hal penting: minta agent mempertahankan PROJECT_PROGRESS.md dan BUG_TRACKER.md agar jika sesi agent terputus, pekerjaan bisa dilanjutkan tanpa kehilangan riwayat dan status implementasi.