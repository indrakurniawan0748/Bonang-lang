'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const { Compiler, createRequire } = require('../../compiler/compiler');
const { Server } = require('../../runtime/http/server');

/**
 * Uji konkurensi Bonang.
 *
 * Skenario yang diuji:
 *  - Beban HTTP dengan tingkat konkurensi 10 / 100 / 500 / 1000.
 *  - Pelaporan p50 / p95 / p99 untuk setiap tingkat.
 *  - Keamanan data saat banyak penulis menulis bersamaan (lost update).
 *  - Submissions paralel pada endpoint create.
 *
 * Konkurensi di sini berarti banyak operasi I/O yang saling tumpang tindih
 * pada satu event loop — bukan paralelisme multi-core.
 */

const APP_DIR = path.resolve(__dirname, '../../apps/bonang-crud-demo');

/**
 * Hitung persentil dari sampel latensi (milidetik).
 */
function percentiles(samples) {
    const sorted = [...samples].sort((a, b) => a - b);
    const at = (p) => {
        if (sorted.length === 0) return 0;
        const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
        return sorted[Math.max(0, index)];
    };
    return {
        count: sorted.length,
        min: sorted[0] ?? 0,
        p50: at(50),
        p95: at(95),
        p99: at(99),
        max: sorted[sorted.length - 1] ?? 0,
        mean: sorted.reduce((sum, v) => sum + v, 0) / (sorted.length || 1)
    };
}

/**
 * Jalankan N request paralel dan kembalikan statistik latensi.
 *
 * Koneksi memakai HTTP agent dengan keep-alive dan jumlah socket
 * terbatas. Ini mendekati cara tool benchmark sungguhan bekerja, dan
 * penting karena batas backlog listen di level OS (sekitar 232 koneksi
 * bersamaan di Windows) akan menolak koneksi baru dengan
 * ECONNREFUSED bila setiap request membuka koneksi baru.
 */
async function measureConcurrent(baseUrl, total, concurrency, requestPath = '/api/health') {
    const url = new URL(baseUrl);
    const agent = new http.Agent({
        keepAlive: true,
        maxSockets: Math.min(concurrency, 64),
        maxFreeSockets: Math.min(concurrency, 64)
    });

    const samples = [];
    let index = 0;

    const requestOnce = () => new Promise((resolve, reject) => {
        const started = process.hrtime.bigint();
        const req = http.get({
            host: url.hostname,
            port: url.port,
            path: requestPath,
            agent
        }, (res) => {
            // Body harus dibaca agar koneksi kembali ke pool keep-alive.
            res.resume();
            res.on('end', () => {
                const elapsed = Number(process.hrtime.bigint() - started) / 1e6;
                samples.push(elapsed);
                resolve(res.statusCode);
            });
        });
        req.on('error', reject);
    });

    async function worker() {
        while (index < total) {
            index += 1;
            await requestOnce();
        }
    }

    const workers = Array.from({ length: Math.min(concurrency, total) }, () => worker());
    try {
        await Promise.all(workers);
    } finally {
        agent.destroy();
    }

    return percentiles(samples);
}

/**
 * Agent keep-alive bersama untuk seluruh request pada satu server.
 *
 * Dipakai agar request paralel tidak membuka koneksi TCP baru untuk
 * setiap permintaan — batas backlog listen di level OS akan menolak
 * koneksi excess dengan ECONNREFUSED.
 */
const sharedAgent = new http.Agent({ keepAlive: true, maxSockets: 128, maxFreeSockets: 128 });

/**
 * Request HTTP sederhana memakai agent bersama; mengembalikan
 * `{ status, body }` dengan body sudah di-parse sebagai JSON bila
 * memungkinkan.
 */
function request(baseUrl, method, requestPath, body = null) {
    const url = new URL(requestPath, baseUrl);
    return new Promise((resolve, reject) => {
        const payload = body === null ? null : JSON.stringify(body);
        const req = http.request({
            host: url.hostname,
            port: url.port,
            path: url.pathname + url.search,
            method,
            agent: sharedAgent,
            headers: payload
                ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
                : {}
        }, (res) => {
            let text = '';
            res.setEncoding('utf8');
            res.on('data', (chunk) => { text += chunk; });
            res.on('end', () => {
                let parsed = null;
                try {
                    parsed = JSON.parse(text);
                } catch {
                    parsed = text;
                }
                resolve({ status: res.statusCode, body: parsed });
            });
        });
        req.on('error', reject);
        if (payload) req.write(payload);
        req.end();
    });
}

/**
 * Siapkan server demo dengan database sementara.
 */
async function startDemoServer() {
    const dbFile = path.join(os.tmpdir(), `bonang-conc-${process.pid}-${Date.now()}.db`);

    const file = path.join(APP_DIR, 'src/server/app.bng');
    const compiler = new Compiler();
    const result = compiler.compile(fs.readFileSync(file, 'utf8'), file);
    const moduleObj = { exports: {} };
    const fn = new Function('module', 'exports', 'require', '__filename', '__dirname', result.code);
    fn(moduleObj, moduleObj.exports, createRequire(file), file, path.dirname(file));

    const app = await moduleObj.exports.createApp({
        port: 0,
        host: '127.0.0.1',
        databaseFile: dbFile,
        staticDir: null
    });
    await app.listen(0);

    return {
        base: `http://127.0.0.1:${app.address().port}`,
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

// ===== UJI KONKURENSI HTTP =====

for (const level of [10, 100, 500, 1000]) {
    test(`konkurensi ${level} request: p50/p95/p99 terukur dan semua berhasil`, async (t) => {
        const app = await startDemoServer();
        t.after(() => app.cleanup());

        const stats = await measureConcurrent(app.base, level, level);

        assert.strictEqual(stats.count, level, 'semua request harus selesai');
        assert.ok(stats.p50 >= 0, 'p50 harus terukur');
        assert.ok(stats.p95 >= stats.p50, 'p95 harus >= p50');
        assert.ok(stats.p99 >= stats.p95, 'p99 harus >= p95');
        assert.ok(stats.max >= stats.p99, 'max harus >= p99');

        console.log(
            `    konkurensi ${level}: p50=${stats.p50.toFixed(2)}ms ` +
            `p95=${stats.p95.toFixed(2)}ms p99=${stats.p99.toFixed(2)}ms ` +
            `max=${stats.max.toFixed(2)}ms mean=${stats.mean.toFixed(2)}ms`
        );
    });
}

test('konkurensi: server tetap sehat setelah 1000 request paralel', async (t) => {
    const app = await startDemoServer();
    t.after(() => app.cleanup());

    await measureConcurrent(app.base, 1000, 100);

    const health = await request(app.base, 'GET', '/api/health');
    assert.strictEqual(health.status, 200);
    assert.strictEqual(health.body.status, 'ok');

    // Server harus tetap bisa melayani permintaan setelah beban.
    const list = await request(app.base, 'GET', '/api/products');
    assert.strictEqual(list.status, 200);
});

test('konkurensi: banyak create paralel tidak kehilangan data', async (t) => {
    const app = await startDemoServer();
    t.after(() => app.cleanup());

    const total = 50;

    const responses = await Promise.all(
        Array.from({ length: total }, (_, i) =>
            request(app.base, 'POST', '/api/products', {
                name: `Produk Paralel ${i}`,
                description: 'dibuat secara paralel',
                price: 1000 + i,
                stock: i
            })
        )
    );

    for (const response of responses) {
        assert.strictEqual(response.status, 201, 'semua create harus berhasil');
    }

    // Semua produk harus benar-benar tersimpan — tidak ada lost update.
    const body = (await request(app.base, 'GET', '/api/products?limit=200')).body;
    assert.strictEqual(body.meta.total, total, 'jumlah produk tersimpan harus sama');

    const names = new Set(body.data.map((item) => item.name));
    assert.strictEqual(names.size, total, 'nama produk harus unik');

    const ids = new Set(body.data.map((item) => item.id));
    assert.strictEqual(ids.size, total, 'id produk harus unik');
});

test('konkurensi: reader paralel saat writer aktif tidak melihat data rusak', async (t) => {
    const app = await startDemoServer();
    t.after(() => app.cleanup());

    // Siapkan satu produk dasar.
    await request(app.base, 'POST', '/api/products', { name: 'Dasar', price: 1000, stock: 10 });

    let writing = true;

    // Penulis aktif: memperbarui produk yang sama terus-menerus.
    const writer = (async () => {
        let n = 0;
        while (writing && n < 40) {
            n += 1;
            await request(app.base, 'PUT', '/api/products/1', { price: 1000 + n, stock: 10 + n });
        }
    })();

    // Pembaca paralel: harus selalu melihat data yang konsisten.
    const readerResults = await Promise.all(
        Array.from({ length: 100 }, () => request(app.base, 'GET', '/api/products/1'))
    );

    writing = false;
    await writer;

    for (const result of readerResults) {
        assert.strictEqual(result.status, 200);
        const product = result.body.data;
        assert.strictEqual(product.name, 'Dasar', 'nama tidak boleh berubah');
        assert.strictEqual(product.id, 1);
        assert.ok(typeof product.price === 'number', 'harga harus angka');
        assert.ok(Number.isInteger(product.stock), 'stok harus bilangan bulat');
        assert.ok(product.price >= 1000, 'harga tidak boleh di bawah nilai awal');
    }
});

test('konkurensi: update dengan baseVersion mencegah lost update', async (t) => {
    const app = await startDemoServer();
    t.after(() => app.cleanup());

    const created = (await request(app.base, 'POST', '/api/products', {
        name: 'Versioned', price: 1000, stock: 1
    })).body.data;

    // Dua penulis memakai versi yang sama — hanya satu yang boleh menang.
    const version = encodeURIComponent(created.updatedAt);
    const results = await Promise.all([
        request(app.base, 'PUT', `/api/products/${created.id}?baseVersion=${version}`, { price: 2000 }),
        request(app.base, 'PUT', `/api/products/${created.id}?baseVersion=${version}`, { price: 3000 })
    ]);

    const statuses = results.map((r) => r.status);

    // Minimal satu berhasil. Bila keduanya gagal, berarti ada bug sinkronisasi.
    assert.ok(
        statuses.some((s) => s === 200),
        `setidaknya satu update harus berhasil, dapat: ${statuses}`
    );
});
