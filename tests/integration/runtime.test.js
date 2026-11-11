'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { Server, Router } = require('../../runtime/http/server');
const { SQLitePool } = require('../../runtime/database/pool');
const { QueryBuilder } = require('../../runtime/database/query-builder');
const security = require('../../runtime/security/security');
const { Scheduler, WorkerPool } = require('../../runtime/async/scheduler');

/**
 * Helper: jalankan server di port acak, return { server, baseUrl, close }.
 */
async function startServer(configure) {
    const server = new Server({ port: 0, host: '127.0.0.1' });
    configure(server);
    await server.listen(0);
    const baseUrl = `http://127.0.0.1:${server.port}`;
    return {
        server,
        baseUrl,
        close: () => server.close()
    };
}

test('http: server merespons hello world', async () => {
    const { baseUrl, close } = await startServer((server) => {
        server.router.get('/hello', () => ({ message: 'Halo' }));
    });
    try {
        const res = await fetch(`${baseUrl}/hello`);
        assert.equal(res.status, 200);
        assert.deepEqual(await res.json(), { message: 'Halo' });
    } finally {
        await close();
    }
});

test('http: route dengan path parameter', async () => {
    const { baseUrl, close } = await startServer((server) => {
        server.router.get('/products/:id', (ctx) => ({ id: ctx.params.id }));
    });
    try {
        const res = await fetch(`${baseUrl}/products/42`);
        assert.deepEqual(await res.json(), { id: '42' });
    } finally {
        await close();
    }
});

test('http: query parameter terbaca', async () => {
    const { baseUrl, close } = await startServer((server) => {
        server.router.get('/search', (ctx) => ({ q: ctx.query.q, page: ctx.query.page }));
    });
    try {
        const res = await fetch(`${baseUrl}/search?q=kopi&page=2`);
        assert.deepEqual(await res.json(), { q: 'kopi', page: '2' });
    } finally {
        await close();
    }
});

test('http: body JSON di-parse', async () => {
    const { baseUrl, close } = await startServer((server) => {
        server.router.post('/products', (ctx) => ({ received: ctx.json() }));
    });
    try {
        const res = await fetch(`${baseUrl}/products`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: 'Kopi', price: 25000 })
        });
        assert.deepEqual(await res.json(), { received: { name: 'Kopi', price: 25000 } });
    } finally {
        await close();
    }
});

test('http: route tidak ditemukan mengembalikan 404 JSON', async () => {
    const { baseUrl, close } = await startServer(() => {});
    try {
        const res = await fetch(`${baseUrl}/tidak-ada`);
        assert.equal(res.status, 404);
        const body = await res.json();
        assert.equal(body.error, 'NOT_FOUND');
    } finally {
        await close();
    }
});

test('http: method tidak diizinkan mengembalikan 405', async () => {
    const { baseUrl, close } = await startServer((server) => {
        server.router.get('/hanya-get', () => ({}));
    });
    try {
        const res = await fetch(`${baseUrl}/hanya-get`, { method: 'POST' });
        assert.equal(res.status, 405);
        assert.equal((await res.json()).error, 'METHOD_NOT_ALLOWED');
    } finally {
        await close();
    }
});

test('http: error handler mengembalikan pesan aman tanpa stack trace', async () => {
    const { baseUrl, close } = await startServer((server) => {
        server.router.get('/boom', () => {
            throw new Error('rahasia internal');
        });
    });
    try {
        const res = await fetch(`${baseUrl}/boom`);
        assert.equal(res.status, 500);
        const body = await res.json();
        assert.equal(body.message, 'Terjadi kesalahan pada server');
        assert.equal(body.stack, undefined);
    } finally {
        await close();
    }
});

test('http: middleware global berjalan dan bisa menghentikan rantai', async () => {
    const { baseUrl, close } = await startServer((server) => {
        server.router.use((ctx, next) => {
            ctx.state.user = 'admin';
            return next();
        });
        server.router.get('/admin', (ctx) => ({ user: ctx.state.user }));
    });
    try {
        const res = await fetch(`${baseUrl}/admin`);
        assert.deepEqual(await res.json(), { user: 'admin' });
    } finally {
        await close();
    }
});

test('http: validasi body menolak nilai tidak valid dengan 400', async () => {
    const { baseUrl, close } = await startServer((server) => {
        server.router.post('/products', (ctx) => {
            const data = ctx.validate({
                name: { type: 'string', required: true },
                price: { type: 'number', required: true, min: 0 }
            });
            return { ok: true, data };
        });
    });
    try {
        const res = await fetch(`${baseUrl}/products`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ price: -5 })
        });
        assert.equal(res.status, 400);
        assert.equal((await res.json()).error, 'VALIDATION_ERROR');
    } finally {
        await close();
    }
});

test('http: cookie dibaca dari request dan bisa diset di response', async () => {
    const { baseUrl, close } = await startServer((server) => {
        server.router.get('/cookie', (ctx) => {
            ctx.response.cookie('token', 'abc123', { httpOnly: true });
            return { received: ctx.cookies.token };
        });
    });
    try {
        const res = await fetch(`${baseUrl}/cookie`, { headers: { Cookie: 'token=xyz' } });
        assert.deepEqual(await res.json(), { received: 'xyz' });
        const setCookie = res.headers.get('set-cookie');
        assert.match(setCookie, /token=abc123/);
        assert.match(setCookie, /HttpOnly/);
    } finally {
        await close();
    }
});

// ===== DATABASE =====

test('db: insert dan select data nyata', async () => {
    const pool = new SQLitePool({ filename: ':memory:' });
    try {
        await pool.execute(
            'CREATE TABLE products (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, price REAL, stock INTEGER)'
        );
        const result = await pool.execute(
            'INSERT INTO products (name, price, stock) VALUES (?, ?, ?)',
            ['Kopi', 25000, 10]
        );
        assert.equal(result.changes, 1);

        const rows = await pool.query('SELECT * FROM products WHERE name = ?', ['Kopi']);
        assert.equal(rows.length, 1);
        assert.equal(rows[0].name, 'Kopi');
        assert.equal(rows[0].stock, 10);
    } finally {
        await pool.close();
    }
});

test('db: prepared statement mencegah SQL injection', async () => {
    const pool = new SQLitePool({ filename: ':memory:' });
    try {
        await pool.execute('CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)');
        await pool.execute('INSERT INTO users (name) VALUES (?)', ['alice']);

        const malicious = "'; DROP TABLE users; --";
        const rows = await pool.query('SELECT * FROM users WHERE name = ?', [malicious]);
        assert.equal(rows.length, 0);

        // Tabel masih utuh.
        const all = await pool.query('SELECT * FROM users');
        assert.equal(all.length, 1);
    } finally {
        await pool.close();
    }
});

test('db: update dan delete bekerja', async () => {
    const pool = new SQLitePool({ filename: ':memory:' });
    try {
        await pool.execute('CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT, qty INTEGER)');
        await pool.execute('INSERT INTO items (name, qty) VALUES (?, ?)', ['a', 1]);
        await pool.execute('INSERT INTO items (name, qty) VALUES (?, ?)', ['b', 2]);

        await pool.execute('UPDATE items SET qty = ? WHERE name = ?', [10, 'a']);
        const updated = await pool.queryOne('SELECT * FROM items WHERE name = ?', ['a']);
        assert.equal(updated.qty, 10);

        await pool.execute('DELETE FROM items WHERE name = ?', ['b']);
        const remaining = await pool.query('SELECT * FROM items');
        assert.equal(remaining.length, 1);
    } finally {
        await pool.close();
    }
});

test('db: transaksi rollback saat error', async () => {
    const pool = new SQLitePool({ filename: ':memory:' });
    try {
        await pool.execute('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)');
        await assert.rejects(
            pool.transaction(async (tx) => {
                await tx.execute('INSERT INTO t (v) VALUES (?)', ['x']);
                throw new Error('gagal di tengah');
            }),
            /gagal di tengah/
        );
        const rows = await pool.query('SELECT * FROM t');
        assert.equal(rows.length, 0, 'data harus di-rollback');
    } finally {
        await pool.close();
    }
});

test('db: transaksi commit berhasil', async () => {
    const pool = new SQLitePool({ filename: ':memory:' });
    try {
        await pool.execute('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)');
        await pool.transaction(async (tx) => {
            await tx.execute('INSERT INTO t (v) VALUES (?)', ['a']);
            await tx.execute('INSERT INTO t (v) VALUES (?)', ['b']);
        });
        const rows = await pool.query('SELECT * FROM t');
        assert.equal(rows.length, 2);
    } finally {
        await pool.close();
    }
});

test('db: bulk insert banyak baris', async () => {
    const pool = new SQLitePool({ filename: ':memory:' });
    try {
        await pool.execute('CREATE TABLE bulk (id INTEGER PRIMARY KEY, n TEXT)');
        const rows = Array.from({ length: 50 }, (_, i) => ({ n: `item-${i}` }));
        const result = await pool.bulkInsert('bulk', ['n'], rows);
        assert.equal(result.changes, 50);
        const count = await pool.queryOne('SELECT COUNT(*) as c FROM bulk');
        assert.equal(Number(count.c), 50);
    } finally {
        await pool.close();
    }
});

test('db: query builder menghasilkan SQL berparameter', async () => {
    const pool = new SQLitePool({ filename: ':memory:' });
    try {
        await pool.execute('CREATE TABLE products (id INTEGER PRIMARY KEY, name TEXT, price REAL, stock INTEGER)');
        const rows = [
            { name: 'Kopi', price: 25000, stock: 10 },
            { name: 'Teh', price: 15000, stock: 5 },
            { name: 'Cokelat', price: 20000, stock: 8 }
        ];
        for (const r of rows) {
            await pool.execute('INSERT INTO products (name, price, stock) VALUES (?, ?, ?)', [r.name, r.price, r.stock]);
        }

        const qb = QueryBuilder.from(pool, 'products')
            .select('name', 'price')
            .where('stock', '>', 6)
            .orderBy('price', 'DESC');

        const sql = qb.buildSelect();
        assert.match(sql, /WHERE stock > \?/);
        assert.ok(!sql.includes('6'), 'nilai harus via placeholder');

        const result = await qb.get();
        assert.equal(result.length, 2);
        // DESC: harga tertinggi dulu (Kopi 25000, lalu Cokelat 20000).
        assert.equal(result[0].name, 'Kopi');
        assert.equal(result[1].name, 'Cokelat');
    } finally {
        await pool.close();
    }
});

test('db: query builder menolak nama kolom berbahaya', async () => {
    const pool = new SQLitePool({ filename: ':memory:' });
    try {
        assert.throws(() => QueryBuilder.from(pool, 'products; DROP TABLE users').where('x', '=', 1));
        assert.throws(() => QueryBuilder.from(pool, 'products').where('x; DELETE FROM users', '=', 1));
        assert.throws(() => QueryBuilder.from(pool, 'products').where('x', 'OR 1=1', 1));
    } finally {
        await pool.close();
    }
});

test('db: paginate menghasilkan metadata benar', async () => {
    const pool = new SQLitePool({ filename: ':memory:' });
    try {
        await pool.execute('CREATE TABLE items (id INTEGER PRIMARY KEY, n INTEGER)');
        for (let i = 1; i <= 25; i++) {
            await pool.execute('INSERT INTO items (n) VALUES (?)', [i]);
        }
        const result = await QueryBuilder.from(pool, 'items').orderBy('id').paginate(2, 10);
        assert.equal(result.data.length, 10);
        assert.equal(result.meta.total, 25);
        assert.equal(result.meta.totalPages, 3);
        assert.equal(result.meta.hasNext, true);
        assert.equal(result.meta.hasPrev, true);
        assert.equal(result.data[0].n, 11);
    } finally {
        await pool.close();
    }
});

test('db: connection pool membatasi jumlah koneksi', async () => {
    const pool = new SQLitePool({ filename: ':memory:', max: 2 });
    try {
        const results = await Promise.all(
            Array.from({ length: 10 }, (_, i) => pool.query('SELECT ? as n', [i]))
        );
        assert.equal(results.length, 10);
        assert.equal(pool.getStats().total <= 2, true);
    } finally {
        await pool.close();
    }
});

// ===== SECURITY =====

test('security: password hash dan verify', () => {
    const hash = security.hashPassword('rahasia123');
    assert.notEqual(hash, 'rahasia123');
    assert.equal(security.verifyPassword('rahasia123', hash), true);
    assert.equal(security.verifyPassword('salah', hash), false);
});

test('security: hash password berbeda tiap kali (salt unik)', () => {
    const a = security.hashPassword('sama');
    const b = security.hashPassword('sama');
    assert.notEqual(a, b);
    assert.equal(security.verifyPassword('sama', a), true);
    assert.equal(security.verifyPassword('sama', b), true);
});

test('security: escape HTML mencegah XSS', () => {
    const escaped = security.escapeHtml('<script>alert("xss")</script>');
    assert.ok(!escaped.includes('<script>'));
    assert.ok(escaped.includes('&lt;script&gt;'));
});

test('security: safeFilename membuang path traversal', () => {
    assert.equal(security.safeFilename('../../etc/passwd'), 'passwd');
    assert.equal(security.safeFilename('ok.txt'), 'ok.txt');
    assert.equal(security.safeFilename('../..'), null);
    assert.equal(security.safeFilename('bad name!.txt'), null);
});

test('security: safeJoin menolak path keluar dari root', () => {
    const root = path.join(os.tmpdir(), 'bonang-root');
    assert.equal(security.safeJoin(root, 'a/b.txt'), path.join(root, 'a', 'b.txt'));
    assert.equal(security.safeJoin(root, '../../etc/passwd'), null);
});

test('security: rate limiter membatasi request', () => {
    const limiter = new security.RateLimiter({ max: 3, windowMs: 60000 });
    assert.equal(limiter.consume('ip1').allowed, true);
    assert.equal(limiter.consume('ip1').allowed, true);
    assert.equal(limiter.consume('ip1').allowed, true);
    assert.equal(limiter.consume('ip1').allowed, false);
    // Key berbeda punya kuota sendiri.
    assert.equal(limiter.consume('ip2').allowed, true);
});

test('security: session store membuat dan mengambil sesi', () => {
    const store = new security.SessionStore();
    const id = store.create({ userId: 7 });
    assert.equal(store.get(id).userId, 7);
    store.update(id, { role: 'admin' });
    assert.equal(store.get(id).role, 'admin');
    store.destroy(id);
    assert.equal(store.get(id), null);
});

test('security: CSRF token diverifikasi dengan benar', () => {
    const secret = 'rahasia-rahasia';
    const sessionId = 'session-123';
    const token = security.createCsrfToken(sessionId, secret);
    assert.equal(security.verifyCsrfToken(token, sessionId, secret), true);
    assert.equal(security.verifyCsrfToken(token, 'session lain', secret), false);
    assert.equal(security.verifyCsrfToken('token-palsu', sessionId, secret), false);
});

test('security: validasi upload menolak tipe dan ukuran', () => {
    assert.throws(() => security.validateUpload('../../evil.txt', 100, ['txt']));
    assert.throws(() => security.validateUpload('evil.exe', 100, ['txt', 'png']));
    assert.throws(() => security.validateUpload('ok.txt', 10 * 1024 * 1024, ['txt']));
    assert.equal(security.validateUpload('ok.txt', 100, ['txt']), 'ok.txt');
});

// ===== CONCURRENCY =====

test('scheduler: banyak task berjalan concurrently', async () => {
    const scheduler = new Scheduler({ maxConcurrency: 10 });
    const started = Date.now();

    const tasks = Array.from({ length: 50 }, (_, i) =>
        scheduler.schedule(async () => {
            // Simulasi I/O: menunda tanpa memblokir thread lain.
            await new Promise((resolve) => setTimeout(resolve, 20));
            return i;
        })
    );

    const results = await Promise.all(tasks);
    const elapsed = Date.now() - started;

    assert.equal(results.length, 50);
    assert.deepEqual(results, Array.from({ length: 50 }, (_, i) => i));
    // Kalau sekuensial, butuh ~1000ms. Dengan concurrency, jauh lebih cepat.
    assert.ok(elapsed < 500, `waktu ${elapsed}ms menunjukkan task tidak concurrent`);
});

test('scheduler: withConcurrencyLimit membatasi jumlah worker aktif', async () => {
    const scheduler = new Scheduler();
    let active = 0;
    let maxActive = 0;

    const items = Array.from({ length: 20 }, (_, i) => i);
    const results = await scheduler.withConcurrencyLimit(items, 4, async (item) => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active -= 1;
        return item * 2;
    });

    assert.equal(results.length, 20);
    assert.equal(results[5], 10);
    assert.ok(maxActive <= 4, `maksimum worker aktif ${maxActive} melebihi batas 4`);
});

test('scheduler: task yang gagal melempar error', async () => {
    const scheduler = new Scheduler();
    await assert.rejects(
        scheduler.schedule(async () => { throw new Error('gagal'); }),
        /gagal/
    );
    assert.equal(scheduler.getStats().failed, 1);
});

test('scheduler: request yang lambat tidak memblokir request cepat', async () => {
    const { baseUrl, close } = await startServer((server) => {
        server.router.get('/lambat', async () => {
            await new Promise((resolve) => setTimeout(resolve, 300));
            return { status: 'lambat' };
        });
        server.router.get('/cepat', () => ({ status: 'cepat' }));
    });
    try {
        const slowPromise = fetch(`${baseUrl}/lambat`);
        // Request cepat harus selesai jauh sebelum yang lambat.
        const started = Date.now();
        const fast = await fetch(`${baseUrl}/cepat`);
        const fastElapsed = Date.now() - started;

        assert.equal(fast.status, 200);
        assert.ok(fastElapsed < 200, `request cepat tertahan ${fastElapsed}ms`);

        const slow = await slowPromise;
        assert.equal(slow.status, 200);
    } finally {
        await close();
    }
});

test('worker pool: menjalankan fungsi di thread terpisah', async () => {
    const pool = new WorkerPool({ size: 2 });
    try {
        const results = await Promise.all([
            pool.run(function double(x) { return x * 2; }, [21]),
            pool.run(function square(x) { return x * x; }, [7])
        ]);
        // double(21) = 42, square(7) = 49. Urutan task dijaga, tapi
        // perbandingan dibuat tidak bergantung pada urutan.
        assert.deepEqual([...results].sort((a, b) => a - b), [42, 49]);
    } finally {
        await pool.destroy();
    }
});

test('worker pool: task yang gagal mengembalikan error', async () => {
    const pool = new WorkerPool({ size: 1 });
    try {
        await assert.rejects(
            pool.run(function boom() { throw new Error('worker gagal'); }, []),
            /worker gagal/
        );
    } finally {
        await pool.destroy();
    }
});
