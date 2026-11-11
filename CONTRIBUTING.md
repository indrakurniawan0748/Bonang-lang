# Berkontribusi ke Bonang

Bonang adalah bahasa pemrograman open source. Semua kontribusi diterima —
dari memperbaiki typo di dokumentasi sampai menambah fitur baru di
compiler.

---

## Kontrak Kontribusi (Contribution Contract)

Empat aturan ini tidak bisa dilanggar. Kalau Contributions Violates
satu saja, PR akan ditolak:

1. **Tidak boleh ada implementasi palsu.** Tidak ada stub, mock, atau
   fungsi yang selalu mengembalikan nilai tetap.
2. **Tidak boleh ada test yang dinonaktifkan.** Kalau sebuah test gagal,
   perbaiki penyebabnya — jangan dihapus, jangan di-`skip`, jangan
   di-`todo`.
3. **Tidak boleh ada klaim fitur selesai sebelum diuji.** PR harus
   menyertakan bukti eksekusi, bukan asumsi.
4. **Tidak boleh ada exception yang disembunyikan.** Kalau ada error,
   tangkap dengan benar dan laporkan — jangan di-swallow.

---

## Getting Started

```bash
git clone https://github.com/<user>/bonang-lang.git
cd bonang-lang
npm test                 # pastikan baseline hijau (250 lulus)
```

Tidak ada `npm install` yang dibutuhkan — proyek ini sengaja **nol
dependensi eksternal**. Yang dibutuhkan hanya Node.js >= 22.

---

## Alur Kerja

1. **Buat issue dulu** untuk bug atau fitur besar. Diskusikan pendekatan
   di issue sebelum menulis kode — jauh lebih murah daripada PR besar
   yang perlu dibongkar.
2. **Buat branch** dari `main`:
   ```bash
   git checkout -b feat/nama-fitur
   ```
3. **Tulis test lebih dulu** untuk perilaku yang berubah. Test gagal
   dulu (RED), lalu implementasi sampai hijau (GREEN), lalu refactor.
4. **Jalankan seluruh suite** sebelum membuka PR:
   ```bash
   npm test
   node cli/cli.js lint
   node cli/cli.js audit
   ```
5. **Kirim PR.** Jelaskan *mengapa* perubahan ini perlu, bukan hanya
   *apa* yang berubah.

---

## Standar Kode

| Aspek | Aturan |
| --- | --- |
| Indentasi | 4 spasi, konsisten di seluruh repo |
| Gaya | `if (...) {` dengan kurung di baris sama |
| Nama variabel | `snake_case` untuk data lokal |
| Prepared statement | Selalu `?` positional. **Dilarang** named placeholder (`:nama`) — koneksi memakai `ATTR_EMULATE_PREPARES = false`, jadi named placeholder yang dipakai dua kali akan error `HY093` |
| Identitas tabel/kolom | Selalu lewat `assertIdentifier()` / allowlist, jangan pernah interpolasi nilai user ke dalam SQL |
| Komentar | Bahasa Indonesia, menjelaskan **kenapa** (bukan apa) |
| Error handling | Tangkap dengan `try/catch`, tulis detail ke `error_log()`, balas pesan generik ke user |

Contoh prepares statement yang benar:

```js
const stmt = pool.prepare("SELECT * FROM products WHERE sku = ? AND created_at <= ?");
const rows = await stmt.execute([sku, endDate]);
```

---

## Struktur Repo

```
compiler/      lexer, parser, AST, codegen, bundler
runtime/       core, async, http, database, security, filesystem, client
standard-library/
package-manager/
cli/           cli, linter, auditor, dev-server, migrate
apps/          bonang-crud-demo
examples/
tests/         unit, integration, regression, offline, concurrency,
               database, security, tools
benchmarks/
docs/          desain dan status
```

---

## Menambah Aturan Linter atau Auditor

Dua tempat utama:

- `cli/linter.js` — aturan analisis statis. Setiap aturan punya
  `rule` (kode singkat), `severity`, dan `message`.
- `cli/auditor.js` — pemeriksaan keamanan. Empat di antaranya berbasis
  AST, bukan regex.

Wajib menambah test di `tests/tools/` untuk setiap aturan baru —
termasuk kasus negatif (kode yang benar-benar bermasalah **harus**
dilaporkan).

---

## Siklus Perbaikan Bug

Sudah dipakai 38 kali di repo ini. Ikuti polanya, dokumentasinya ada di
[`docs/BUG_TRACKER.md`](docs/BUG_TRACKER.md):

1. **Reproduksi** — test yang gagal, minimal.
2. **Root cause** — kenapa bug itu muncul, bukan gejalanya.
3. **Perbaikan minimal** — ubah secukupnya.
4. **Regression test** — test yang mengunci perilaku yang benar.
5. **Verifikasi** — `npm test` hijau.
6. **Dokumentasi** — entri baru di `docs/BUG_TRACKER.md` lengkap dengan
   tanggal, komponen, severity, deskripsi, root cause, fix, regression
   test, dan status.

---

## Dokumentasi

Dokumen yang wajib diperbarui saat ada perubahan relevan:

| Perubahan | Dokumen yang diperbarui |
| --- | --- |
| Sintaks bahasa baru | `docs/LANGUAGE_SPECIFICATION.md`, `docs/GRAMMAR.md` |
| Komponen compiler baru | `docs/COMPILER_DESIGN.md`, `docs/ARCHITECTURE.md` |
| Fitur runtime baru | `docs/RUNTIME_DESIGN.md` |
| Perubahan API database | `docs/DATABASE_DESIGN.md` |
| Perubahan keamanan | `docs/SECURITY_DESIGN.md` |
| Test baru / jumlah test berubah | `docs/TEST_REPORT.md` |
| Bug diperbaiki | `docs/BUG_TRACKER.md`, `docs/CHANGELOG.md` |
| Batasan baru | `docs/KNOWN_LIMITATIONS.md` |
| Fase pekerjaan selesai | `docs/PROJECT_PROGRESS.md` |

Angka di dokumentasi harus berasal dari eksekusi nyata. Kalau ada
benchmark, sertakan metodologinya dan variasi antar-jalankan.

---

## Commit Message

Format: `tipe(scope): deskripsi singkat`

```
feat(router): dukung route wildcard dengan parameter
fix(auditor): jangan laporkan konstanta kelas sebagai data user
docs(grammar): perbarui aturan arrow function
test(database): kunci validasi jenis JOIN
```

Tipe yang dipakai: `feat`, `fix`, `docs`, `test`, `refactor`, `perf`,
`chore`.

---

## Pertanyaan?

Buka issue. Tidak ada pertanyaan yang terlalu kecil.

---

## Lisensi

Kontribusi kamu dianggap berada di bawah lisensi MIT yang sama dengan
proyek ini.
