'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { SQLitePool, QueryBuilder } = require('../../runtime/index.js');

/**
 * Uji lapisan database Bonang.
 *
 * Cakupan:
 *  - Connection pool: acquire/release, batas maksimum, state setelah close.
 *  - Prepared statement dengan placeholder positional `?`.
 *  - Transaction: commit dan rollback.
 *  - QueryBuilder: validasi identifier, allowlist operator, paginasi.
 *  - QueryBuilder menolak SQL injection lewat nama kolom/tabel/operator.
 */

let counter = 0;

/**
 * Buat file database sementara yang dihapus setelah test.
 */
function tempDbFile() {
    counter += 1;
    return path.join(os.tmpdir(), `bonang-db-test-${process.pid}-${counter}.db`);
}

/**
 * Buat pool untuk file database sementara, plus fungsi pembersih.
 */
async function makePool(options = {}) {
    const file = tempDbFile();
    const pool = new SQLitePool({ filename: file, max: options.max || 5 });
    return {
        pool,
        file,
        cleanup: async () => {
            await pool.close();
            for (const suffix of ['', '-wal', '-shm']) {
                try {
                    fs.rmSync(file + suffix, { force: true });
                } catch {
                    // abaikan
                }
            }
        }
    };
}

// ===== POOL =====

test('db: pool membuat skema dan menyimpan data', async (t) => {
    const { pool, cleanup } = await makePool();
    t.after(cleanup);

    await pool.execute('CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT NOT NULL, price REAL)');

    const result = await pool.execute(
        'INSERT INTO items (name, price) VALUES (?, ?)',
        ['Kopi', 85000]
    );
    assert.strictEqual(result.changes, 1);
    assert.ok(result.lastInsertRowid > 0);

    const row = await pool.queryOne('SELECT * FROM items WHERE id = ?', [result.lastInsertRowid]);
    assert.strictEqual(row.name, 'Kopi');
    assert.strictEqual(row.price, 85000);
});

test('db: query mengembalikan banyak baris dan queryOne satu baris', async (t) => {
    const { pool, cleanup } = await makePool();
    t.after(cleanup);

    await pool.execute('CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT)');
    await pool.execute('INSERT INTO items (name) VALUES (?)', ['A']);
    await pool.execute('INSERT INTO items (name) VALUES (?)', ['B']);
    await pool.execute('INSERT INTO items (name) VALUES (?)', ['C']);

    const all = await pool.query('SELECT * FROM items ORDER BY id');
    assert.strictEqual(all.length, 3);

    const one = await pool.queryOne('SELECT * FROM items WHERE name = ?', ['B']);
    assert.strictEqual(one.id, 2);

    const missing = await pool.queryOne('SELECT * FROM items WHERE name = ?', ['Z']);
    assert.strictEqual(missing, null);
});

test('db: pool membatasi jumlah koneksi dan menunggu koneksi tersedia', async (t) => {
    const { pool, cleanup } = await makePool({ max: 2 });
    t.after(cleanup);

    await pool.execute('CREATE TABLE items (id INTEGER PRIMARY KEY)');

    // Ambil ketiga koneksi tanpa melepas — pemanggil ketiga harus menunggu.
    const c1 = await pool.acquire();
    const c2 = await pool.acquire();

    let thirdAcquired = false;
    const thirdPromise = pool.acquire().then((c) => {
        thirdAcquired = true;
        return c;
    });

    // Beri kesempatan event loop untuk menjalankan penunggu.
    await new Promise((r) => setTimeout(r, 30));
    assert.strictEqual(thirdAcquired, false, 'koneksi ketiga harus menunggu');

    pool.release(c1);
    const c3 = await thirdPromise;
    assert.ok(c3, 'koneksi ketiga harus diberikan setelah ada yang dilepas');

    pool.release(c2);
    pool.release(c3);
});

test('db: pool menolak dipakai setelah ditutup', async (t) => {
    const { pool, cleanup } = await makePool();
    t.after(cleanup);

    await pool.close();
    await assert.rejects(() => pool.acquire(), /ditutup/);
});

test('db: statistik pool mencatat akuisisi dan pelepasan', async (t) => {
    const { pool, cleanup } = await makePool();
    t.after(cleanup);

    await pool.execute('CREATE TABLE items (id INTEGER PRIMARY KEY)');
    await pool.query('SELECT * FROM items');

    const stats = pool.getStats();
    assert.ok(stats.acquired >= 1);
    assert.ok(stats.released >= 1);
    assert.ok(stats.total >= 1);
});

// ===== TRANSACTION =====

test('db: transaction commit menyimpan perubahan', async (t) => {
    const { pool, cleanup } = await makePool();
    t.after(cleanup);

    await pool.execute('CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT)');

    await pool.transaction(async (tx) => {
        await tx.execute('INSERT INTO items (name) VALUES (?)', ['satu']);
        await tx.execute('INSERT INTO items (name) VALUES (?)', ['dua']);
    });

    const rows = await pool.query('SELECT * FROM items');
    assert.strictEqual(rows.length, 2);
});

test('db: transaction rollback membatalkan semua perubahan', async (t) => {
    const { pool, cleanup } = await makePool();
    t.after(cleanup);

    await pool.execute('CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT)');

    await assert.rejects(() => pool.transaction(async (tx) => {
        await tx.execute('INSERT INTO items (name) VALUES (?)', ['satu']);
        throw new Error('gagal di tengah');
    }), /gagal di tengah/);

    const rows = await pool.query('SELECT * FROM items');
    assert.strictEqual(rows.length, 0, 'rollback harus membatalkan insert');
});

test('db: bulkInsert menulis banyak baris dalam satu transaksi', async (t) => {
    const { pool, cleanup } = await makePool();
    t.after(cleanup);

    await pool.execute('CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT, price REAL)');

    const rows = Array.from({ length: 25 }, (_, i) => ({ name: `Item ${i}`, price: i * 100 }));
    const result = await pool.bulkInsert('items', ['name', 'price'], rows);

    assert.strictEqual(result.changes, 25);
    assert.strictEqual((await pool.query('SELECT * FROM items')).length, 25);
});

// ===== PLACEHOLDER & INJECTION =====

test('db: placeholder positional mengisolasi nilai dari SQL', async (t) => {
    const { pool, cleanup } = await makePool();
    t.after(cleanup);

    await pool.execute('CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT)');
    await pool.execute('INSERT INTO items (name) VALUES (?)', ['Kopi Susu']);

    // Payload injeksi harus diperlakukan sebagai data biasa.
    const payload = "'; DROP TABLE items; --";
    const rows = await pool.query('SELECT * FROM items WHERE name = ?', [payload]);
    assert.strictEqual(rows.length, 0);

    // Tabel masih utuh.
    const all = await pool.query('SELECT * FROM items');
    assert.strictEqual(all.length, 1);
});

test('db: LIKE dengan wildcard ke wildcard pengguna tetap aman', async (t) => {
    const { pool, cleanup } = await makePool();
    t.after(cleanup);

    await pool.execute('CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT)');
    await pool.execute('INSERT INTO items (name) VALUES (?)', ['Kopi Arabika']);

    const rows = await pool.query('SELECT * FROM items WHERE name LIKE ?', ['%Arabika%']);
    assert.strictEqual(rows.length, 1);

    const noMatch = await pool.query('SELECT * FROM items WHERE name LIKE ?', ['%Teh%']);
    assert.strictEqual(noMatch.length, 0);
});

// ===== QUERY BUILDER =====

test('db: QueryBuilder membangun select dengan where dan order', async (t) => {
    const { pool, cleanup } = await makePool();
    t.after(cleanup);

    await pool.execute('CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT, price REAL)');
    await pool.execute('INSERT INTO items (name, price) VALUES (?, ?)', ['A', 100]);
    await pool.execute('INSERT INTO items (name, price) VALUES (?, ?)', ['B', 200]);
    await pool.execute('INSERT INTO items (name, price) VALUES (?, ?)', ['C', 300]);

    const rows = await QueryBuilder.from(pool, 'items')
        .where('price', '>=', 200)
        .orderBy('price', 'DESC')
        .get();

    assert.strictEqual(rows.length, 2);
    assert.strictEqual(rows[0].name, 'C');
});

test('db: QueryBuilder.count dan paginate menghasilkan metadata benar', async (t) => {
    const { pool, cleanup } = await makePool();
    t.after(cleanup);

    await pool.execute('CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT)');
    for (let i = 0; i < 7; i++) {
        await pool.execute('INSERT INTO items (name) VALUES (?)', [`Item ${i}`]);
    }

    const total = await QueryBuilder.from(pool, 'items').count();
    assert.strictEqual(total, 7);

    const page = await QueryBuilder.from(pool, 'items').paginate(2, 3);
    assert.strictEqual(page.data.length, 3);
    assert.strictEqual(page.meta.page, 2);
    assert.strictEqual(page.meta.perPage, 3);
    assert.strictEqual(page.meta.total, 7);
    assert.strictEqual(page.meta.totalPages, 3);
    assert.strictEqual(page.meta.hasNext, true);
    assert.strictEqual(page.meta.hasPrev, true);
});

test('db: QueryBuilder menolak nama tabel dan kolom yang berbahaya', async (t) => {
    const { pool, cleanup } = await makePool();
    t.after(cleanup);

    assert.throws(
        () => QueryBuilder.from(pool, 'items; DROP TABLE items'),
        /tidak valid|penilhaian/i
    );
    assert.throws(
        () => QueryBuilder.from(pool, 'items').where('name; DROP TABLE items', '=', 'x'),
        /tidak valid|penilhaian/i
    );
});

test('db: QueryBuilder menolak operator di luar allowlist', async (t) => {
    const { pool, cleanup } = await makePool();
    t.after(cleanup);

    assert.throws(
        () => QueryBuilder.from(pool, 'items').where('name', '= 1 OR 1=1', 'x'),
        /Operator tidak diizinkan/
    );
});

test('db: QueryBuilder.where menerima dua argumen sebagai shorthand', async (t) => {
    const { pool, cleanup } = await makePool();
    t.after(cleanup);

    await pool.execute('CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT)');
    await pool.execute('INSERT INTO items (name) VALUES (?)', ['A']);

    const rows = await QueryBuilder.from(pool, 'items').where('name', 'A').get();
    assert.strictEqual(rows.length, 1);
});

test('db: QueryBuilder join menghasilkan SQL berparameter yang benar', async (t) => {
    const { pool, cleanup } = await makePool();
    t.after(cleanup);

    await pool.execute('CREATE TABLE products (id INTEGER PRIMARY KEY, name TEXT)');
    await pool.execute('CREATE TABLE orders (id INTEGER PRIMARY KEY, product_id INTEGER, total REAL)');
    await pool.execute('INSERT INTO products (id, name) VALUES (1, ?) ', ['P1']);
    await pool.execute('INSERT INTO orders (product_id, total) VALUES (?, ?)', [1, 50]);

    const rows = await QueryBuilder.from(pool, 'products')
        .join('orders', 'orders.product_id = products.id')
        .get();

    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].name, 'P1');
    assert.strictEqual(rows[0].total, 50);
});

test('db: QueryBuilder menolak jenis JOIN dan kondisi JOIN berbahaya', async (t) => {
    const { pool, cleanup } = await makePool();
    t.after(cleanup);

    // Jenis JOIN di luar allowlist.
    assert.throws(
        () => QueryBuilder.from(pool, 'items').join('orders', 'orders.item_id = items.id', 'INNER; DROP TABLE items'),
        /Jenis JOIN tidak valid/
    );

    // Kondisi JOIN yang memuat SQL bebas.
    assert.throws(
        () => QueryBuilder.from(pool, 'items').join('orders', '1=1 OR 1=1'),
        /Kondisi JOIN tidak valid/
    );

    // Nama tabel join tetap divalidasi sebagai identifier.
    assert.throws(
        () => QueryBuilder.from(pool, 'items').join('orders; DROP TABLE items', 'orders.item_id = items.id'),
        /tidak valid/i
    );
});

// ===== INTEGRITAS DATA =====
test('db: kolom NOT NULL menolak nilai kosong', async (t) => {
    const { pool, cleanup } = await makePool();
    t.after(cleanup);

    await pool.execute('CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT NOT NULL)');

    await assert.rejects(() => pool.execute('INSERT INTO items (name) VALUES (?)', [null]));
});

test('db: transaksi rollback mengembalikan koneksi ke pool', async (t) => {
    const { pool, cleanup } = await makePool();
    t.after(cleanup);

    await pool.execute('CREATE TABLE items (id INTEGER PRIMARY KEY)');

    await assert.rejects(() => pool.transaction(async (tx) => {
        await tx.execute('INSERT INTO items (id) VALUES (1)');
        throw new Error('batal');
    }));

    // Pool harus tetap bisa dipakai setelah rollback.
    const rows = await pool.query('SELECT * FROM items');
    assert.strictEqual(rows.length, 0);

    const stats = pool.getStats();
    assert.strictEqual(stats.waiting, 0, 'tidak boleh ada waiter yang menggantung');
});
