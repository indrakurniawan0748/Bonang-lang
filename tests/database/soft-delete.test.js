'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { SQLitePool, SoftDeleteRepository } = require('../../runtime/index.js');

/**
 * Uji soft delete (L-14).
 *
 * Soft delete menandai baris dengan mengisi kolom `deleted_at`, bukan
 * menghapusnya. Test di bawah memakai database SQLite sungguhan.
 */

let counter = 0;

function tempDbFile() {
    counter += 1;
    return path.join(os.tmpdir(), `bonang-softdelete-${process.pid}-${counter}.db`);
}

/**
 * Buat pool + tabel `items`, plus repository soft delete.
 */
async function makeRepo(options = {}) {
    const file = tempDbFile();
    const pool = new SQLitePool({ filename: file, max: 5 });
    await pool.execute(
        'CREATE TABLE items (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, price REAL)'
    );
    const repo = new SoftDeleteRepository(pool, 'items', options);
    return {
        pool,
        repo,
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

// ===== KOLOM PENANDA =====

test('soft delete: kolom penanda ditambahkan bila belum ada', async (t) => {
    const { repo, pool, cleanup } = await makeRepo();
    t.after(cleanup);

    assert.strictEqual(await repo.ensureSoftDeleteColumn(), true);

    const columns = await pool.query('PRAGMA table_info(items)');
    assert.ok(columns.some((c) => c.name === 'deleted_at'));
});

test('soft delete: kolom penanda yang sudah ada tidak diubah', async (t) => {
    const { repo, cleanup } = await makeRepo();
    t.after(cleanup);

    assert.strictEqual(await repo.ensureSoftDeleteColumn(), true);
    // Panggilan kedua tidak boleh menambahkan kolom yang sama.
    assert.strictEqual(await repo.ensureSoftDeleteColumn(), false);
});

test('soft delete: nama kolom penanda kustom dihormati', async (t) => {
    const { repo, pool, cleanup } = await makeRepo({ deletedAtColumn: 'archived_at' });
    t.after(cleanup);

    await repo.ensureSoftDeleteColumn();
    const columns = await pool.query('PRAGMA table_info(items)');
    assert.ok(columns.some((c) => c.name === 'archived_at'));
    assert.ok(!columns.some((c) => c.name === 'deleted_at'));
});

// ===== PENANDAAN DAN PENYARINGAN =====

test('soft delete: remove() menandai baris tanpa menghapusnya', async (t) => {
    const { repo, pool, cleanup } = await makeRepo();
    t.after(cleanup);

    await repo.ensureSoftDeleteColumn();
    await repo.create({ name: 'Madu', price: 10 });
    await repo.create({ name: 'Gula', price: 5 });

    assert.strictEqual(await repo.remove(1), true);

    // Baris masih ada di tabel — hanya ditandai.
    const raw = await pool.query('SELECT * FROM items WHERE id = 1');
    assert.strictEqual(raw.length, 1);
    assert.ok(raw[0].deleted_at, 'deleted_at harus terisi');
});

test('soft delete: baris terhapus tidak muncul di findAll', async (t) => {
    const { repo, cleanup } = await makeRepo();
    t.after(cleanup);

    await repo.ensureSoftDeleteColumn();
    await repo.create({ name: 'Madu', price: 10 });
    await repo.create({ name: 'Gula', price: 5 });

    await repo.remove(1);

    const result = await repo.findAll();
    assert.strictEqual(result.total, 1);
    assert.strictEqual(result.items.length, 1);
    assert.strictEqual(result.items[0].name, 'Gula');
});

test('soft delete: findById mengembalikan null untuk baris terhapus', async (t) => {
    const { repo, cleanup } = await makeRepo();
    t.after(cleanup);

    await repo.ensureSoftDeleteColumn();
    await repo.create({ name: 'Madu', price: 10 });
    await repo.remove(1);

    assert.strictEqual(await repo.findById(1), null);
});

test('soft delete: findAll dengan includeDeleted mengembalikan baris terhapus', async (t) => {
    const { repo, cleanup } = await makeRepo();
    t.after(cleanup);

    await repo.ensureSoftDeleteColumn();
    await repo.create({ name: 'Madu', price: 10 });
    await repo.remove(1);

    const result = await repo.findAll({ includeDeleted: true });
    assert.strictEqual(result.total, 1);
});

test('soft delete: hitungan baris aktif dan terhapus terpisah', async (t) => {
    const { repo, cleanup } = await makeRepo();
    t.after(cleanup);

    await repo.ensureSoftDeleteColumn();
    await repo.create({ name: 'A', price: 1 });
    await repo.create({ name: 'B', price: 2 });
    await repo.create({ name: 'C', price: 3 });

    await repo.remove(2);

    assert.strictEqual(await repo.countActive(), 2);
    assert.strictEqual(await repo.countDeleted(), 1);
});

// ===== RESTORE & PURGE =====

test('soft delete: restore() mengembalikan baris ke daftar aktif', async (t) => {
    const { repo, cleanup } = await makeRepo();
    t.after(cleanup);

    await repo.ensureSoftDeleteColumn();
    await repo.create({ name: 'Madu', price: 10 });
    await repo.remove(1);

    assert.strictEqual(await repo.restore(1), true);
    assert.strictEqual(await repo.countActive(), 1);
    assert.strictEqual(await repo.countDeleted(), 0);
});

test('soft delete: purge() menghapus baris secara permanen', async (t) => {
    const { repo, pool, cleanup } = await makeRepo();
    t.after(cleanup);

    await repo.ensureSoftDeleteColumn();
    await repo.create({ name: 'Madu', price: 10 });
    await repo.remove(1);

    assert.strictEqual(await repo.purge(1), true);

    const raw = await pool.query('SELECT * FROM items');
    assert.strictEqual(raw.length, 0, 'baris harus benar-benar hilang');
});

test('soft delete: purgeAll() menghapus semua baris terhapus', async (t) => {
    const { repo, pool, cleanup } = await makeRepo();
    t.after(cleanup);

    await repo.ensureSoftDeleteColumn();
    await repo.create({ name: 'A', price: 1 });
    await repo.create({ name: 'B', price: 2 });
    await repo.create({ name: 'C', price: 3 });

    await repo.remove(1);
    await repo.remove(3);

    assert.strictEqual(await repo.purgeAll(), 2);

    const raw = await pool.query('SELECT * FROM items');
    assert.strictEqual(raw.length, 1);
    assert.strictEqual(raw[0].name, 'B');
});

test('soft delete: remove() pada baris yang sudah terhapus tidak mengubah apa pun', async (t) => {
    const { repo, cleanup } = await makeRepo();
    t.after(cleanup);

    await repo.ensureSoftDeleteColumn();
    await repo.create({ name: 'Madu', price: 10 });

    assert.strictEqual(await repo.remove(1), true);
    // Penghapusan kedua tidak boleh mengembalikan true.
    assert.strictEqual(await repo.remove(1), false);
});

// ===== VALIDASI =====

test('soft delete: nama tabel berbahaya ditolak', () => {
    assert.throws(
        () => new SoftDeleteRepository({}, 'items; DROP TABLE items'),
        /tabel tidak valid/
    );
});

test('soft delete: nama kolom penanda berbahaya ditolak', () => {
    assert.throws(
        () => new SoftDeleteRepository({}, 'items', { deletedAtColumn: 'deleted_at; DROP TABLE items' }),
        /kolom penanda tidak valid/
    );
});

test('soft delete: pool yang tidak valid ditolak', () => {
    assert.throws(
        () => new SoftDeleteRepository(null, 'items'),
        /Pool database tidak valid/
    );
});
