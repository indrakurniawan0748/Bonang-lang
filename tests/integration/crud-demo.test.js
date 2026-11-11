'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { Compiler, createRequire } = require('../../compiler/compiler');

/**
 * Uji penerimaan utama Bonang: aplikasi "Bonang CRUD Demo".
 *
 * Aplikasi ini ditulis penuh dalam Bonang (bukan JavaScript):
 *   src/server/product-repository.bng  — lapisan repository (SQLite)
 *   src/server/product-service.bng     — lapisan service (aturan bisnis)
 *   src/server/product-controller.bng  — lapisan controller (HTTP)
 *   src/shared/product.bng             — model & validasi bersama
 *
 * Test ini menjalankan server sungguhan lewat runtime Bonang dan memverifikasi
 * seluruh alur CRUD, validasi, penanganan error, dan endpoint sinkronisasi.
 */

const APP_DIR = path.resolve(__dirname, '../../apps/bonang-crud-demo');

/**
 * Kompilasi modul Bonang dan jalankan sebagai modul CommonJS.
 */
function loadModule(relativePath) {
    const file = path.join(APP_DIR, relativePath);
    const source = fs.readFileSync(file, 'utf8');
    const compiler = new Compiler();
    const result = compiler.compile(source, file);

    const moduleObj = { exports: {} };
    const fn = new Function('module', 'exports', 'require', '__filename', '__dirname', result.code);
    fn(moduleObj, moduleObj.exports, createRequire(file), file, path.dirname(file));
    return moduleObj.exports;
}

/**
 * Siapkan server demo dengan database sementara.
 */
async function startDemoServer() {
    const dbFile = path.join(os.tmpdir(), `bonang-crud-test-${process.pid}-${Date.now()}.db`);

    // Aplikasi dibuat lewat pabrik yang sama dengan entry point produksi.
    const { createApp } = loadModule('src/server/app.bng');

    const app = await createApp({
        port: 0,
        host: '127.0.0.1',
        databaseFile: dbFile
    });
    await app.listen(0);

    const base = `http://127.0.0.1:${app.address().port}`;

    return {
        base,
        app,
        cleanup: async () => {
            await app.close();
            await app.repository.pool.close();
            for (const suffix of ['', '-wal', '-shm']) {
                try {
                    fs.rmSync(dbFile + suffix, { force: true });
                } catch {
                    // abaikan
                }
            }
        }
    };
}

test('CRUD Demo: setup server berjalan', async (t) => {
    const app = await startDemoServer();
    t.after(() => app.cleanup());

    const response = await fetch(`${app.base}/api/health`);
    assert.strictEqual(response.status, 200);
    const body = await response.json();
    assert.strictEqual(body.status, 'ok');
});

test('CRUD Demo: membuat produk, membaca, mengubah, menghapus', async (t) => {
    const app = await startDemoServer();
    t.after(() => app.cleanup());

    // --- CREATE ---
    const createResponse = await fetch(`${app.base}/api/products`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            name: 'Kopi Arabika',
            description: 'Biji kopi single origin',
            price: 85000,
            stock: 25
        })
    });
    assert.strictEqual(createResponse.status, 201);
    const created = (await createResponse.json()).data;
    assert.strictEqual(created.name, 'Kopi Arabika');
    assert.strictEqual(created.price, 85000);
    assert.strictEqual(created.stock, 25);
    assert.ok(created.id > 0, 'produk harus punya id');
    assert.ok(created.createdAt, 'produk harus punya createdAt');
    assert.ok(created.updatedAt, 'produk harus punya updatedAt');

    // --- READ ---
    const listResponse = await fetch(`${app.base}/api/products`);
    assert.strictEqual(listResponse.status, 200);
    const listBody = await listResponse.json();
    assert.strictEqual(listBody.status, 'success');
    assert.strictEqual(listBody.data.length, 1);
    assert.strictEqual(listBody.meta.total, 1);

    const showResponse = await fetch(`${app.base}/api/products/${created.id}`);
    assert.strictEqual(showResponse.status, 200);
    const shown = (await showResponse.json()).data;
    assert.strictEqual(shown.id, created.id);
    assert.strictEqual(shown.name, 'Kopi Arabika');

    // --- UPDATE ---
    const updateResponse = await fetch(`${app.base}/api/products/${created.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Kopi Arabika Premium', price: 95000, stock: 10 })
    });
    assert.strictEqual(updateResponse.status, 200);
    const updated = (await updateResponse.json()).data;
    assert.strictEqual(updated.name, 'Kopi Arabika Premium');
    assert.strictEqual(updated.price, 95000);
    assert.strictEqual(updated.stock, 10);
    assert.strictEqual(updated.id, created.id);

    // --- DELETE ---
    const deleteResponse = await fetch(`${app.base}/api/products/${created.id}`, {
        method: 'DELETE'
    });
    assert.strictEqual(deleteResponse.status, 200);
    const deleted = (await deleteResponse.json()).data;
    assert.strictEqual(deleted.id, created.id);

    const afterDelete = await fetch(`${app.base}/api/products/${created.id}`);
    assert.strictEqual(afterDelete.status, 404);
});

test('CRUD Demo: validasi input menolak produk tidak lengkap', async (t) => {
    const app = await startDemoServer();
    t.after(() => app.cleanup());

    // Nama kosong.
    const noName = await fetch(`${app.base}/api/products`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: '', price: 1000, stock: 1 })
    });
    assert.strictEqual(noName.status, 400);
    const noNameBody = await noName.json();
    assert.strictEqual(noNameBody.status, 'error');
    assert.strictEqual(noNameBody.error, 'VALIDATION_ERROR');
    assert.ok(noNameBody.msg, 'pesan error harus ada');

    // Harga negatif.
    const negativePrice = await fetch(`${app.base}/api/products`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Item', price: -5, stock: 1 })
    });
    assert.strictEqual(negativePrice.status, 400);

    // Stok bukan angka.
    const badStock = await fetch(`${app.base}/api/products`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Item', price: 1000, stock: 'banyak' })
    });
    assert.strictEqual(badStock.status, 400);

    // Tidak ada produk yang tersimpan.
    const list = await (await fetch(`${app.base}/api/products`)).json();
    assert.strictEqual(list.meta.total, 0, 'produk invalid tidak boleh tersimpan');
});

test('CRUD Demo: id tidak valid dan produk tidak ditemukan', async (t) => {
    const app = await startDemoServer();
    t.after(() => app.cleanup());

    const badId = await fetch(`${app.base}/api/products/abc`);
    assert.strictEqual(badId.status, 400);

    const missing = await fetch(`${app.base}/api/products/9999`);
    assert.strictEqual(missing.status, 404);
    const body = await missing.json();
    assert.strictEqual(body.status, 'error');
});

test('CRUD Demo: pencarian dan ringkasan inventaris', async (t) => {
    const app = await startDemoServer();
    t.after(() => app.cleanup());

    const seeds = [
        { name: 'Kopi Arabika', description: 'Single origin', price: 85000, stock: 25 },
        { name: 'Teh Hijau', description: 'Green tea', price: 45000, stock: 5 },
        { name: 'Coklat Batang', description: 'Dark chocolate', price: 32000, stock: 40 }
    ];
    for (const seed of seeds) {
        await fetch(`${app.base}/api/products`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(seed)
        });
    }

    // Pencarian pada nama.
    const search = await (await fetch(`${app.base}/api/products?search=Kopi`)).json();
    assert.strictEqual(search.meta.total, 1);
    assert.strictEqual(search.data[0].name, 'Kopi Arabika');

    // Pencarian pada deskripsi.
    const byDesc = await (await fetch(`${app.base}/api/products?search=chocolate`)).json();
    assert.strictEqual(byDesc.meta.total, 1);
    assert.strictEqual(byDesc.data[0].name, 'Coklat Batang');

    // Ringkasan.
    const summary = await (await fetch(`${app.base}/api/products/summary`)).json();
    assert.strictEqual(summary.data.total, 3);
    assert.strictEqual(summary.data.totalStock, 70);
    // 85000*25 + 45000*5 + 32000*40 = 2125000 + 225000 + 1280000 = 3630000
    assert.strictEqual(summary.data.inventoryValue, 3630000);
    // Stok < 10: Teh Hijau (5).
    assert.strictEqual(summary.data.lowStock.length, 1);
    assert.strictEqual(summary.data.lowStock[0].name, 'Teh Hijau');
});

test('CRUD Demo: pagination', async (t) => {
    const app = await startDemoServer();
    t.after(() => app.cleanup());

    for (let i = 0; i < 7; i++) {
        await fetch(`${app.base}/api/products`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: `Produk ${i}`, price: 1000 + i, stock: i })
        });
    }

    const page1 = await (await fetch(`${app.base}/api/products?limit=3&offset=0`)).json();
    assert.strictEqual(page1.data.length, 3);
    assert.strictEqual(page1.meta.total, 7);
    assert.strictEqual(page1.meta.limit, 3);

    const page3 = await (await fetch(`${app.base}/api/products?limit=3&offset=6`)).json();
    assert.strictEqual(page3.data.length, 1);

    // Batas atas limit dibatasi 200.
    const tooBig = await (await fetch(`${app.base}/api/products?limit=9999`)).json();
    assert.strictEqual(tooBig.meta.limit, 200);
});

test('CRUD Demo: endpoint sinkronisasi menerima antrean offline', async (t) => {
    const app = await startDemoServer();
    t.after(() => app.cleanup());

    // Antrean create.
    const syncResponse = await fetch(`${app.base}/api/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            operations: [
                {
                    id: 'create-1',
                    entity: 'product',
                    op: 'create',
                    payload: { name: 'Dari Offline', description: 'Dibuat offline', price: 12000, stock: 3 }
                }
            ]
        })
    });
    assert.strictEqual(syncResponse.status, 200);
    const syncBody = await syncResponse.json();
    assert.strictEqual(syncBody.data.applied, 1);
    assert.strictEqual(syncBody.data.conflicted, 0);
    assert.strictEqual(syncBody.data.results[0].status, 'applied');
    assert.strictEqual(syncBody.data.results[0].server.name, 'Dari Offline');

    // Produk benar-benar tersimpan di server.
    const list = await (await fetch(`${app.base}/api/products`)).json();
    assert.strictEqual(list.meta.total, 1);
});

test('CRUD Demo: sinkronisasi update mendeteksi konflik versi', async (t) => {
    const app = await startDemoServer();
    t.after(() => app.cleanup());

    // Buat produk lebih dulu.
    const created = (await (await fetch(`${app.base}/api/products`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Konflik', price: 1000, stock: 1 })
    })).json()).data;

    // Klien menyebut versi lama → konflik.
    const conflictResponse = await fetch(`${app.base}/api/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            operations: [{
                id: 'update-conflict',
                entity: 'product',
                op: 'update',
                entityId: created.id,
                baseVersion: '2020-01-01T00:00:00.000Z',
                payload: { name: 'Konflik Baru', price: 2000, stock: 2 }
            }]
        })
    });
    const conflictBody = await conflictResponse.json();
    assert.strictEqual(conflictBody.data.conflicted, 1);
    assert.strictEqual(conflictBody.data.results[0].status, 'conflict');
    assert.ok(conflictBody.data.results[0].server, 'server harus mengembalikan versi terbaru');

    // Versi yang benar → diterapkan.
    const okResponse = await fetch(`${app.base}/api/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            operations: [{
                id: 'update-ok',
                entity: 'product',
                op: 'update',
                entityId: created.id,
                baseVersion: created.updatedAt,
                payload: { name: 'Konflik Baru', price: 2000, stock: 2 }
            }]
        })
    });
    const okBody = await okResponse.json();
    assert.strictEqual(okBody.data.applied, 1);
});

test('CRUD Demo: SQL injection pada parameter ditolak', async (t) => {
    const app = await startDemoServer();
    t.after(() => app.cleanup());

    const payload = "'; DROP TABLE products; --";
    const response = await fetch(`${app.base}/api/products?search=${encodeURIComponent(payload)}`);
    assert.strictEqual(response.status, 200);

    const body = await response.json();
    assert.strictEqual(body.meta.total, 0, 'payload injeksi tidak boleh menemukan data');

    // Tabel masih utuh.
    const list = await (await fetch(`${app.base}/api/products`)).json();
    assert.strictEqual(list.status, 'success');
});

test('CRUD Demo: model shared dipakai server dan client', async () => {
    const shared = loadModule('src/shared/product.bng');

    assert.strictEqual(shared.MAX_NAME_LENGTH, 120);

    const errors = shared.validateProduct({ name: '', price: -1, stock: 'x' });
    assert.ok(errors.name, 'nama kosong harus error');
    assert.ok(errors.price, 'harga negatif harus error');
    assert.ok(errors.stock, 'stok bukan angka harus error');

    const clean = shared.validateProduct({ name: 'Kopi', price: 1000, stock: 5 });
    assert.deepStrictEqual(clean, {});

    const normalized = shared.normalizeProduct({
        name: '  Kopi  ',
        description: '  desc  ',
        price: '1000',
        stock: '5'
    });
    assert.strictEqual(normalized.name, 'Kopi');
    assert.strictEqual(normalized.description, 'desc');
    assert.strictEqual(normalized.price, 1000);
    assert.strictEqual(normalized.stock, 5);
});

test('CRUD Demo: berkas aplikasi benar-benar ada dan linguagem Bonang', async () => {
    const required = [
        'src/server/main.bng',
        'src/server/product-repository.bng',
        'src/server/product-service.bng',
        'src/server/product-controller.bng',
        'src/shared/product.bng',
        'src/client/main.bng',
        'public/index.html',
        'public/style.css',
        'public/sw.js',
        'migrations/001_create_products.bng',
        'bonang.config.json'
    ];

    for (const relative of required) {
        const full = path.join(APP_DIR, relative);
        assert.ok(fs.existsSync(full), `berkas wajib ada: ${relative}`);
    }

    // Berkas Bonang harus memakai sintaks Bonang (`fn`, bukan `function`).
    const repositorySource = fs.readFileSync(
        path.join(APP_DIR, 'src/server/product-repository.bng'),
        'utf8'
    );
    assert.ok(repositorySource.includes('export class ProductRepository'));
    assert.ok(repositorySource.includes('async findAll('));
    assert.ok(!repositorySource.includes('require('), 'repository tidak boleh memakai require langsung');
});
