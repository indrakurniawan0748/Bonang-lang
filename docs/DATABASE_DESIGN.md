# DATABASE DESIGN — BONANG

Dokumen desain lapisan database: connection pool, prepared statement, query
builder, transaksi, migrasi, dan skema demo.

---

## 1. Prinsip

1. **Tidak ada input user di string SQL.** Semua nilai dikirim via
   placeholder positional `?`.
2. **Identifier dinamis divalidasi allowlist.** Nama tabel/kolum tidak bisa
   diparameterkan, jadi harus lolos pola ketat.
3. **Operator divalidasi allowlist.** Operator dari input user ditolak.
4. **Transaksi selalu mengembalikan koneksi ke pool**, termasuk saat
   rollback.
5. **WAL mode** supaya reader tidak diblokir writer.

---

## 2. Connection Pool

```js
const pool = createPool({ filename: 'data/app.db', max: 10 });
```

`SQLitePool` manages a fixed set of connections to a single SQLite file.

| Opsi | Default | Fungsi |
| --- | --- | --- |
| `filename` | `':memory:'` | Lokasi file database |
| `max` | 5 | Koneksi maksimum |
| `busyTimeout` | 5000 | Timeout lock (ms) |
| `wal` | true | Aktifkan mode WAL |

### 2.1 Akuisisi

```js
const conn = await pool.acquire();
// ... pakai conn ...
pool.release(conn);
```

Bila `max` koneksi sudah dipakai, pemanggil **menunggu** dalam antrean.
Tidak ada error "too many connections" — pemunggu dilayani saat
koneksi dilepas.

### 2.2 Pelepasan

Koneksi kembali ke pool pada:
- `release(conn)` eksplisit.
- finally blok pada `transaction()`.
- Error apa pun pada `transaction()` → rollback → release.

### 2.3 Setelah ditutup

Setelah `pool.close()`, `acquire()` menolak dengan rejection yang
mempunyai pesan "ditutup". Pemanggil wajib menangani.

### 2.4 Statistik

```js
pool.getStats();  // { total, idle, acquired, waiting, created }
```

Dipakai untuk monitoring dan untuk memastikan tidak ada waiter yang
menggantung setelah rollback (diuji di `tests/database/database.test.js`).

---

## 3. Query

```js
await pool.execute('INSERT INTO items (name) VALUES (?)', ['Kopi']);
await pool.query('SELECT * FROM items WHERE name = ?', ['Kopi']);
await pool.queryOne('SELECT * FROM items WHERE id = ?', [1]);
```

- `execute` → `{ changes, lastInsertRowid }`.
- `query` → array of plain objects.
- `queryOne` → object pertama atau `null`.

Semua memakai prepared statement native `node:sqlite`.

### 3.1 Kenapa placeholder positional

Native prepared statement tidak mengizinkan satu named placeholder dipakai
beberapa kali dalam satu statement (`SQLSTATE[HY093]: Invalid parameter
number`). Placeholder positional `?` boleh diulang, dan cukup mengulang
nilainya di array `execute`.

> Catatan: ini berbeda dari stack PHP/PDO proyek lain yang memakai emulated
> prepares dan named placeholder. Perbedaan ini disengaja — lihat
> `docs/TECHNICAL_DECISIONS.md` TD-003.

---

## 4. Transaksi

```js
await pool.transaction(async (tx) => {
    await tx.execute('INSERT INTO a (v) VALUES (?)', [1]);
    await tx.execute('INSERT INTO b (v) VALUES (?)', [2]);
});
```

- `BEGIN` → jalankan callback → `COMMIT`.
- Error apa pun → `ROLLBACK` → error dilempar ke pemanggil → koneksi
  dikembalikan ke pool.
- Callback yang melempar `ValidationError` (error aplikasi, bukan error
  DB) juga menyebabkan rollback — ini perilaku yang diharapkan.

### 4.1 Bulk insert

```js
await pool.bulkInsert('items', ['name', 'price'], rows);
```

Menulis banyak baris dalam satu transaksi. Mengembalikan
`{ changes }`.

---

## 5. Query Builder

```js
const rows = await QueryBuilder.from(pool, 'items')
    .where('price', '>=', 200)
    .orderBy('price', 'DESC')
    .limit(20)
    .get();
```

### 5.1 Metode

| Metode | Hasil |
| --- | --- |
| `where(col, op, val)` | Filter. Dua argumen (`where(col, val)`) diperlakukan sebagai `=` |
| `orderBy(col, dir)` | Pengurutan (`ASC`/`DESC`) |
| `limit(n)` / `offset(n)` | Paginasi |
| `get()` | Array baris |
| `first()` | Baris pertama atau `null` |
| `count()` | Jumlah baris yang cocok |
| `paginate(page, perPage)` | `{ data, meta }` |

Metadata `paginate`:

```js
{
    page, perPage, total, totalPages,
    hasNext, hasPrev, offset, limit
}
```

### 5.2 Allowlist identifier

```js
const IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
```

Pola ini hidup di satu tempat saja —
`runtime/database/identifiers.js` — dan dipakai bersama oleh query
builder dan soft delete, sehingga tidak ada dua implementasi aturan
validasi yang bisa berbeda satu sama lain.

- `*` diizinkan untuk kolom COUNT.
- Segera di lempar bila tidak cocok.
- Nama yang cocok: `items`, `user_id`, `created_at`.
- Nama yang ditolak: `items; DROP TABLE items`, `name'--`, `1=1`,
  `a-b`.

Pengaman ini penting karena nama kolom **tidak bisa** diparameterkan —
nilainya selalu masuk ke teks SQL.

### 5.3 Allowlist operator

| Operator | Status |
| --- | --- |
| `=`, `!=`, `<>`, `<`, `>`, `<=`, `>=` | Diizinkan |
| `LIKE`, `NOT LIKE` | Diizinkan |
| `IN`, `NOT IN` | Diizinkan |
| `IS`, `IS NOT` | Diizinkan |
| `= 1 OR 1=1`, `;`, `UNION SELECT` | Ditolak |

Operator di luar allowlist dilempar dengan pesan
"Operator tidak diizinkan".

---

## 6. PRAGMA

| PRAGMA | Nilai | Alasan |
| --- | --- | --- |
| `journal_mode` | `WAL` | Reader tidak diblokir writer |
| `foreign_keys` | `ON` | Integritas referensial ditegakkan |
| `busy_timeout` | `5000` | Menunggu lock alih-alih langsung error |
| `synchronous` | `NORMAL` | Kompromi throughput vs durability pada WAL |

---

## 7. Migrasi

Runner di `cli/migrate.js`. Format file: `NNN_nama.bng`.

Isi file migrasi:

```
-- up
CREATE TABLE products (...);

-- down
DROP TABLE products;
```

Perintah:

```
$ bonang migrate up
Migrasi up selesai: 1 diterapkan, 0 dilewati.
  + 001_create_products

$ bonang migrate down
Migrasi down: 1 dibatalkan.
  - 001_create_products
```

Tabel `bonang_migrations` mencatat nama migrasi dan waktu penerapannya.
Migrasi yang sudah diterapkan **dilewati** — menjalankan `migrate up`
berulang aman (idempoten).

---

## 8. Skema Demo (`bonang_demo`)

```sql
CREATE TABLE products (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT    NOT NULL,
    description TEXT    NOT NULL DEFAULT '',
    price       REAL    NOT NULL,
    stock       INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT    NOT NULL,
    updated_at  TEXT    NOT NULL
);

CREATE INDEX idx_products_name ON products(name);
CREATE INDEX idx_products_updated_at ON products(updated_at);
```

Kolom `updated_at` dipakai sebagai `version` untuk deteksi konflik
sinkronisasi offline (lihat `docs/OFFLINE_FIRST_DESIGN.md`).

---

## 9. Lapisan Repository

Aplikasi tidak mengakses SQL langsung di handler. Urutan lapisan:

```
Controller  →  Service  →  Repository  →  SQLitePool  →  SQLite
```

| Lapisan | Tanggung jawab |
| --- | --- |
| Controller | Parse request, panggil service, bentuk respons |
| Service | Aturan bisnis, validasi, konflik |
| Repository | SQL, pemetaan baris ke objek domain |
| Pool | Koneksi, transaksi, prepared statement |

Konsekuensi: mengganti SQLite dengan database lain hanya menyentuh
repository.

Contoh repository:

```
class ProductRepository {
    constructor(pool) { this.pool = pool; }
    async findAll(options) { ... }
    async findById(id) { ... }
    async create(input) { ... }
    async update(id, input) { ... }
    async remove(id) { ... }
    async summary() { ... }
}
```

---

## 10. Pengujian

`tests/database/database.test.js` — 32 test:

- Pool: membuat skema, batas koneksi, antrean menunggu, penolakan setelah
  ditutup, statistik.
- Transaksi: commit, rollback, bulk insert, pengembalian koneksi.
- Placeholder: isolasi nilai dari SQL, wildcard LIKE aman.
- Query builder: select/count/paginate, allowlist identifier, allowlist
  operator, shorthand `where`, JOIN (jenis + kondisi).
- Integritas: kolom NOT NULL menolak nilai kosong.
- Raw SQL: `whereRaw`/`having` menolak statement tambahan dan jumlah
  placeholder yang tidak cocok.
- Keyset pagination: halaman pertama tanpa cursor, tidak ada baris yang
  terlewat atau terduplikasi, arah `DESC`, cursor berisi payload injeksi
  diperlakukan sebagai data.

`tests/database/soft-delete.test.js` — 15 test: penambahan kolom penanda
(idempoten), `remove` menandai tanpa menghapus, penyaringan pada `findAll`
dan `findById`, opsi `includeDeleted`, penghitungan baris aktif vs
terhapus, `restore`, `purge`, `purgeAll`, serta penolakan nama tabel dan
kolom berbahaya.

---

## 11. Fitur Soft Delete

`runtime/database/soft-delete.js` menyediakan lapisan soft delete di atas
pool, terpisah dari query builder.

```js
const { createPool, db } = require("bonang");

const pool = createPool({ filename: "data/app.db" });
const repo = db.softDelete(pool, "products");

await repo.ensureSoftDeleteColumn();   // ALTER TABLE ... ADD COLUMN deleted_at TEXT
await repo.create({ name: "Kopi", price: 85000 });
await repo.remove(1);                  // UPDATE ... SET deleted_at = ? (baris tetap ada)
await repo.findAll();                  // hanya baris aktif
await repo.findAll({ includeDeleted: true });
await repo.restore(1);                 // deleted_at = NULL
await repo.purge(1);                   // DELETE permanen
```

| API | Perilaku |
| --- | --- |
| `ensureSoftDeleteColumn()` | Menambah kolom penanda bila belum ada; idempoten. Mengembalikan `true` bila kolom baru ditambahkan. |
| `remove(id)` | Menandai baris terhapus. `false` bila id tidak ada atau sudah terhapus. |
| `restore(id)` | Mengosongkan kolom penanda. `false` bila id tidak ada. |
| `purge(id)` | Menghapus baris secara permanen. |
| `purgeAll()` | Menghapus semua baris yang ditandai terhapus. |
| `findAll(options)` | `includeDeleted: true` meloloskan baris terhapus. Mendukung `limit`/`offset`. |
| `findById(id, options)` | Sama seperti `findAll` untuk satu baris. |
| `countActive()` / `countDeleted()` | Menghitung baris aktif dan terhapus secara terpisah. |

**Batasan yang disengaja.** Kolom penanda **tidak** dibuat otomatis —
`ensureSoftDeleteColumn()` harus dipanggil eksplisit, supaya kueri
tidak pernah mengubah skema tabel pengguna tanpa sepengetahuan. Query
biasa juga **tidak** memfilter otomatis: baris terhapus yang lolos ke
pemanggil lebih mudah dikenali daripada baris yang menghilang tanpa
jejak.

Nama tabel dan kolom divalidasi lewat `assertIdentifier()` yang sama
dengan query builder (`runtime/database/identifiers.js`), sehingga tidak
ada dua implementasi aturan berbeda.

### 11.1 Pagination Keyset

Query builder punya `paginateByCursor()` untuk pagination dua kolom
(kolom utama + kolom penyeimbang), sehingga halaman berikutnya tidak
melompati maupun menggandakan baris dengan nilai pengurutan yang sama.
Cursor berisi parameter terenkripsi secara aman.

---

## 12. Batasan yang Diketahui

1. SQLite — satu file, satu writer. Tidak cocok untuk multi-host.
2. `node:sqlite` sinkron — query panjang memblokir event loop.
3. Belum ada ORM atau migrasi otomatis (schema diff) — L-13.
4. Belum ada enkripsi at-rest — L-16.
5. Query builder sudah mendukung JOIN sederhana
   (`.join('orders', 'orders.product_id', 'products.id')`), tetapi belum
   mendukung JOIN bertipe (LEFT/RIGHT/FULL), subquery pada klausa FROM,
   maupun agregasi per-tabel hasil join.
6. Query builder belum mendukung `GROUP BY` yang digabung dengan `HAVING`
   bertingkat pada ekspresi agregat yang sama.
7. Belum ada pooling antar-proses — pool hanya berlaku di dalam satu
   proses Node.js.
8. Soft delete hanya untuk tabel dengan kolom penanda `deleted_at`; tabel
   tanpa kolom itu tidak otomatis mendapatkannya demi demi kueri yang
   tidak mengubah skema pengguna secara diam-diam.
