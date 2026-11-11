'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { SecurityAuditor } = require('../../cli/auditor');

// ===== PEMBANTU =====

/**
 * Tulis sumber Bonang ke proyek sementara lalu audit.
 */
async function auditSource(source, fileName = 'app.bng') {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bonang-audit-'));
    fs.writeFileSync(path.join(root, fileName), source, 'utf8');
    const auditor = new SecurityAuditor();
    try {
        const report = await auditor.audit(root);
        return report.issues;
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
}

function rules(issues) {
    return issues.map((i) => i.rule);
}

// ===== KASUS: KONSTANTA PROGRAM vs DATA USER =====

test('auditor: tabel dari konstanta kelas bukan SQL injection', async () => {
    const issues = await auditSource([
        'export class ProductRepository {',
        '  constructor(pool) {',
        '    this.pool = pool;',
        '    this.table = "products";',
        '  }',
        '  async find(id) {',
        '    return await this.pool.queryOne(`SELECT * FROM ${this.table} WHERE id = ?`, [id]);',
        '  }',
        '}'
    ].join('\n'));

    assert.deepStrictEqual(rules(issues), []);
});

test('auditor: tabel dari parameter constructor tetap dilaporkan', async () => {
    // Nilai tabel datang dari luar program — tidak bisa dipastikan aman.
    const issues = await auditSource([
        'export class ProductRepository {',
        '  constructor(pool, table) {',
        '    this.pool = pool;',
        '    this.table = table;',
        '  }',
        '  async find(id) {',
        '    return await this.pool.queryOne(`SELECT * FROM ${this.table} WHERE id = ?`, [id]);',
        '  }',
        '}'
    ].join('\n'));

    assert.ok(rules(issues).includes('sql-injection-template'),
        'tabel dinamis harus dilaporkan');
});

test('auditor: interpolasi data user pada SQL template dilaporkan', async () => {
    const issues = await auditSource([
        'export class ProductRepository {',
        '  constructor(pool) {',
        '    this.pool = pool;',
        '  }',
        '  async search(ctx) {',
        '    const name = ctx.body.name;',
        '    return await this.pool.query(`SELECT * FROM products WHERE name = ${name}`);',
        '  }',
        '}'
    ].join('\n'));

    const found = issues.filter((i) => i.rule === 'sql-injection-template');
    assert.strictEqual(found.length, 1);
    assert.strictEqual(found[0].severity, 'critical');
});

// ===== KASUS: DETEKSI ROUTE =====

test('auditor: pemanggilan IndexedDB bukan route HTTP', async () => {
    const issues = await auditSource([
        'const store = new IndexedDBStore({ dbName: "demo" });',
        'await store.put("products", product);',
        'await store.delete("products", id);'
    ].join('\n'));

    assert.deepStrictEqual(rules(issues), [],
        'store.put/store.delete bukan route dan tidak boleh dilaporkan');
});

test('auditor: route tanpa validasi dilaporkan', async () => {
    const issues = await auditSource([
        'export class ProductController {',
        '  registerRoutes(router) {',
        '    router.post("/api/products", (ctx) => this.store(ctx));',
        '  }',
        '  store(ctx) {',
        '    return ctx.body;',
        '  }',
        '}'
    ].join('\n'));

    const found = issues.filter((i) => i.rule === 'missing-input-validation');
    assert.strictEqual(found.length, 1);
    assert.strictEqual(found[0].severity, 'medium');
});

test('auditor: route yang memvalidasi lewat delegasi tidak dilaporkan', async () => {
    const issues = await auditSource([
        'export class ProductController {',
        '  registerRoutes(router) {',
        '    router.post("/api/products", (ctx) => this.store(ctx));',
        '    router.delete("/api/products/:id", (ctx) => this.destroy(ctx));',
        '  }',
        '  store(ctx) {',
        '    const body = this.readBody(ctx);',
        '    return body;',
        '  }',
        '  destroy(ctx) {',
        '    const id = this.parseId(ctx.params.id);',
        '    return id;',
        '  }',
        '}'
    ].join('\n'));

    assert.deepStrictEqual(rules(issues), []);
});

test('auditor: route GET tidak wajib validasi', async () => {
    const issues = await auditSource([
        'export class ProductController {',
        '  registerRoutes(router) {',
        '    router.get("/api/products", (ctx) => this.index(ctx));',
        '  }',
        '  index(ctx) {',
        '    return ctx.query;',
        '  }',
        '}'
    ].join('\n'));

    assert.deepStrictEqual(rules(issues), []);
});

// ===== KASUS: ATURAN LAIN TETAP BERJALAN =====

test('auditor: SQL dengan operator + tetap dilaporkan', async () => {
    const issues = await auditSource([
        'const rows = await pool.query("SELECT * FROM products WHERE name = " + name);'
    ].join('\n'));

    assert.ok(rules(issues).includes('sql-injection'));
});

test('auditor: innerHTML tanpa escaping tetap dilaporkan', async () => {
    const issues = await auditSource([
        'element.innerHTML = data.name;'
    ].join('\n'));

    assert.ok(rules(issues).includes('xss-inner-html'));
});

test('auditor: path traversal tetap dilaporkan', async () => {
    const issues = await auditSource([
        'const content = await readFile(ctx.params.path);'
    ].join('\n'));

    assert.ok(rules(issues).includes('path-traversal'));
});

test('auditor: secret hardcoded tetap dilaporkan', async () => {
    const issues = await auditSource([
        'const apiKey = "AKIAIOSFODNN7EXAMPLE";'
    ].join('\n'));

    assert.ok(rules(issues).includes('no-hardcoded-secret'));
});
