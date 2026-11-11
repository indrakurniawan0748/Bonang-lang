# Bonang

**Browser Optimized Network And Native Graphics** — bahasa pemrograman
full-stack untuk web, dengan satu bahasa untuk backend, frontend, dan
lapisan offline-first.

```
$ node cli/cli.js init my-app
$ cd my-app
$ node ../cli/cli.js dev
```

---

## Status

Rilis **0.1.0** (2026-11-11). Lengkap dan terverifikasi.

| Metrik | Nilai |
| --- | --- |
| Test | 250 lulus, 0 gagal, 0 dilewati |
| Bug | 38 tercatat, 38 Fixed, 0 Open |
| Audit statis | 0 temuan pada kode referensi |
| Dependensi eksternal | **0** |

Rincian: [`docs/PROJECT_PROGRESS.md`](docs/PROJECT_PROGRESS.md),
[`docs/TEST_REPORT.md`](docs/TEST_REPORT.md),
[`docs/AUDIT_REPORT.md`](docs/AUDIT_REPORT.md).

---

## Apa Itu Bonang

Bonang adalah bahasa pemrograman yang dikompilasi ke JavaScript dan
dijalankan di V8. Bukan dokumentasi, bukan pseudocode — ada compiler,
runtime, standard library, package manager, CLI, dan aplikasi contoh yang
benar-benar berjalan.

**Yang bisa dilakukan:**

- Menulis backend HTTP dengan routing, middleware, dan validasi.
- Menulis frontend dengan runtime DOM, IndexedDB, dan service worker.
- Bekerja offline dengan antrean sinkronisasi dan resolusi konflik.
- Menyimpan data di SQLite dengan prepared statement dan query builder.
- Membangun, meng-lint, meng-audit, meng-benchmark, dan memigrasikan
  semuanya dari satu CLI.

**Yang belum ada (jujur):** type checker, ORM, soft delete, keyset
pagination, enkripsi at-rest, sinkronisasi background. Daftar lengkap 31
batasan: [`docs/KNOWN_LIMITATIONS.md`](docs/KNOWN_LIMITATIONS.md).

---

## Persyaratan

- **Node.js >= 22** (diuji pada v24.21.0). Memakai `node:sqlite` langsung.
- **Tanpa dependensi eksternal.** `dependencies: {}` dan
  `devDependencies: {}`. Yang dibutuhkan hanya runtime Node.

---

## Instalasi

```bash
npm install -g .          # pasang CLI secara global
bonang version            # bonang v0.1.0
```

Atau tanpa instalasi:

```bash
node cli/cli.js <perintah>
```

---

## CLI

| Perintah | Fungsi |
| --- | --- |
| `bonang init <dir>` | Membuat proyek Bonang baru |
| `bonang run <entry>` | Kompilasi lalu jalankan |
| `bonang build` | Bundel server + client ke `dist/` |
| `bonang dev` | Dev server dengan hot reload (SSE) |
| `bonang test` | Menjalankan test suite Bonang |
| `bonang lint` | 10 aturan analisis statis |
| `bonang audit` | 7 pemeriksaan keamanan (AST-based) |
| `bonang bench` | 5 skenario benchmark |
| `bonang migrate` | Menjalankan migrasi database |
| `bonang version` | Versi bahasa |

Semuanya berfungsi — bukan placeholder.

---

## Contoh Kode

```bonang
import { createServer, createPool, ValidationError, NotFoundError } from "bonang";

export async fn main() {
    const pool = createPool({ filename: "./data/app.db" });
    const app = createServer({ port: 3000 });

    app.router.get("/api/products/:id", async (ctx) => {
        const id = Number.parseInt(ctx.params.id, 10);
        if (!Number.isInteger(id)) {
            throw new ValidationError("id harus angka bulat");
        }
        const product = await pool.queryOne(
            "SELECT * FROM products WHERE id = ?",
            [id]
        );
        if (!product) throw new NotFoundError(`Produk ${id} tidak ditemukan`);
        return { status: "success", data: product };
    });

    await app.listen(3000);
    return app;
}
```

Nilai selalu lewat placeholder positional `?`. Nama kolom/tabel yang
tidak bisa diparameterkan divalidasi terhadap allowlist identifier.

> Top-level `await` belum didukung — gunakan `async fn main()`.

---

## Aplikasi Demo

`apps/bonang-crud-demo` — aplikasi CRUD penuh yang ditulis dalam Bonang:
model `Product`, `ProductRepository`, `ProductService`,
`ProductController`, SQLite `bonang_demo`, migrasi, frontend, service
worker, IndexedDB + sync queue, dan resolusi konflik.

```bash
cd apps/bonang-crud-demo
node ../../cli/cli.js build
node dist/server.js
```

| Route | Metode | Fungsi |
| --- | --- | --- |
| `/api/info` | GET | Metadata aplikasi |
| `/api/health` | GET | Health check |
| `/api/products` | GET | Daftar + paginasi |
| `/api/products/summary` | GET | Agregasi inventaris |
| `/api/products/:id` | GET | Detail satu produk |
| `/api/products` | POST | Buat produk |
| `/api/products/:id` | PUT | Update (dukungan `baseVersion`) |
| `/api/products/:id` | DELETE | Hapus produk |
| `/api/sync` | POST | Sinkronisasi antrean offline |

Konflik versi ditangani dengan optimistic concurrency: client mengirim
`baseVersion`, server menolak dengan **409 CONFLICT** dan mengembalikan
data server di `details.server`.

---

## Struktur Proyek

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
benchmarks/    benchmark.js, RESULTS.md
docs/          17 dokumen desain dan status
```

---

## Menjalankan Test

```bash
npm test               # 250 test, semua suite
node --test "tests/unit/*.test.js"
node --test "tests/security/*.test.js"
```

Tidak ada test yang dinonaktifkan, dilewati, atau di-`todo`.

---

## Performa

Diukur pada Windows 11 / Node v24.21.0, satu mesin:

| Skenario | Throughput |
| --- | --- |
| Kompilasi | 4 932 batch/detik |
| Eksekusi Bonang | 2 873 563 op/detik |
| Eksekusi Node.js | 2 710 027 op/detik |
| Eksekusi PHP 8.2 | 339 785 op/detik |
| HTTP p99 @ 1000 request | 471,86 ms |

Angka di atas adalah snapshot satu eksekusi; benchmark pada mesin yang
sama berfluktuatasi nyata antar-jalankan (compile 4 932-8 213 batch/detik
pada tiga eksekusi). Yang stabil: rasio Bonang vs Node 1,05x-1,06x.

**Bonang berada pada paritas dengan JavaScript** (rasio 1,06x, masih dalam
rentang noise antar-jalankan). Klaim keunggulan performa **tidak**
dibuktikan — Bonang adalah transpiler ke JavaScript, jadi advantage
struktural tidak mungkin diharapkan. Yang terbukti: paritas dengan Node,
urutan magnitude di atas PHP, dan event loop yang tidak diblokir I/O.

Metodologi lengkap: [`benchmarks/RESULTS.md`](benchmarks/RESULTS.md).

---

## Dokumentasi

| Dokumen | Isi |
| --- | --- |
| [LANGUAGE_SPECIFICATION.md](docs/LANGUAGE_SPECIFICATION.md) | Sintaks dan semantik |
| [GRAMMAR.md](docs/GRAMMAR.md) | Grammar formal |
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | Komponen dan aliran data |
| [COMPILER_DESIGN.md](docs/COMPILER_DESIGN.md) | Pipeline compiler |
| [RUNTIME_DESIGN.md](docs/RUNTIME_DESIGN.md) | Runtime dan concurrency |
| [SECURITY_DESIGN.md](docs/SECURITY_DESIGN.md) | Model keamanan |
| [DATABASE_DESIGN.md](docs/DATABASE_DESIGN.md) | Skema, pool, query builder |
| [OFFLINE_FIRST_DESIGN.md](docs/OFFLINE_FIRST_DESIGN.md) | Sync queue dan konflik |
| [PRD.md](docs/PRD.md) | Requirements |
| [TECHNICAL_DECISIONS.md](docs/TECHNICAL_DECISIONS.md) | Keputusan dan alasannya |
| [RISK_REGISTER.md](docs/RISK_REGISTER.md) | Risiko dan mitigasi |
| [BUG_TRACKER.md](docs/BUG_TRACKER.md) | 38 bug dan perbaikannya |
| [AUDIT_REPORT.md](docs/AUDIT_REPORT.md) | Hasil audit |
| [KNOWN_LIMITATIONS.md](docs/KNOWN_LIMITATIONS.md) | 31 batasan terverifikasi |
| [PROJECT_PROGRESS.md](docs/PROJECT_PROGRESS.md) | Status per fase |
| [TEST_REPORT.md](docs/TEST_REPORT.md) | Hasil pengujian |
| [CHANGELOG.md](docs/CHANGELOG.md) | Riwayat perubahan |
| [RELEASE_NOTES.md](docs/RELEASE_NOTES.md) | Ringkasan rilis |

---

## Lisensi

MIT.
