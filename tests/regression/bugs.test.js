'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { Compiler, createRequire } = require('../../compiler/compiler');

/**
 * Regression test untuk bug yang sudah diperbaiki.
 *
 * Setiap test mengunci perilaku yang sebelumnya salah agar tidak
 * muncul kembali. Nomor bug merujuk ke `docs/BUG_TRACKER.md`.
 */

/**
 * Kompilasi source Bonang lalu jalankan dan kembalikan exports modul.
 */
function evaluate(source, filename = 'regresi.bng') {
    const compiler = new Compiler();
    const result = compiler.compile(source, filename);
    const moduleObj = { exports: {} };
    const fn = new Function('module', 'exports', 'require', '__filename', '__dirname', result.code);
    fn(moduleObj, moduleObj.exports, createRequire(filename), filename, '.');
    return moduleObj.exports;
}

/**
 * Kompilasi source dan kembalikan kode JavaScript hasil generate.
 */
function generate(source) {
    const compiler = new Compiler();
    return compiler.compile(source, 'regresi.bng').code;
}

// ===== BNG-017: arrow function dengan object literal sebagai body =====

test('BNG-017: arrow function dengan object literal menghasilkan sintaks valid', () => {
    const code = generate('const f = () => ({ name: "x" });');
    assert.match(code, /\(\{[^}]*\}\)/, 'object literal harus dibungkus kurung');

    // Kode harus bisa dieksekusi tanpa error sintaks.
    const exports = evaluate('export fn make() { return () => ({ name: "x", ok: true }); }');
    const result = exports.make()();
    assert.deepStrictEqual(result, { name: 'x', ok: true });
});

test('BNG-017: arrow expression non-object tetap tanpa kurung tambahan', () => {
    const code = generate('const g = () => 42;');
    assert.doesNotMatch(code, /=> \(\s*42\s*\)/);
});

// ===== BNG-016: require bawaan Bonang tidak lagi rekursif =====

test('BNG-016: import modul bawaan bonang berhasil', () => {
    const exports = evaluate('import { uuid } from "bonang"; export fn run() { return typeof uuid; }');
    assert.strictEqual(exports.run(), 'function');
});

test('BNG-016: import modul bawaan bonang/client berhasil', () => {
    const exports = evaluate('import { escapeHtml } from "bonang/client"; export fn run() { return escapeHtml("<b>"); }');
    assert.strictEqual(exports.run(), '&lt;b&gt;');
});

test('BNG-016: import modul bawaan bonang/std berhasil', () => {
    const exports = evaluate('import { rupiah } from "bonang/std"; export fn run() { return rupiah(1000); }');
    assert.ok(typeof exports.run() === 'string');
});

// ===== BNG-015: nama properti yang sama dengan keyword JS =====

test('BNG-015: keyword Bonang boleh dipakai sebagai nama properti objek', () => {
    // `type`, `default`, `get`, `set` adalah keyword Bonang. Sebelum diperbaiki,
    // `rule.type` ditolak parser dengan "Dumplah identifier".
    const exports = evaluate(`
        export fn read() {
            const rule = { type: "number", default: 1, get: "x" };
            return rule.type;
        }
    `);
    assert.strictEqual(exports.read(), 'number');
});

test('BNG-015: nama properti yangreserved di JavaScript memakai bracket notation', () => {
    // `default`, `class`, `function` memang keyword JavaScript — aksesnya
    // harus lewat bracket agar tidak merusak sintaks.
    const code = generate('export fn read() { const o = { default: 1 }; return o.default; }');
    assert.match(code, /\["default"\]/);

    const exports = evaluate(`
        export fn read() {
            const o = { default: 1, class: 2, function: 3 };
            return o["default"] + o["class"] + o["function"];
        }
    `);
    assert.strictEqual(exports.read(), 6);
});

test('BNG-015: akses metode bernama keyword JS berhasil', () => {
    const exports = evaluate(`
        export class Holder {
            get value() { return 42; }
            set value(v) { this._v = v; }
        }
        export fn run() { return new Holder().value; }
    `);
    assert.strictEqual(exports.run(), 42);
});

// ===== BNG-014: export named list =====

test('BNG-014: export { a, b as c } menandai kedua nama sebagai export', () => {
    const exports = evaluate(`
        const a = 1;
        const b = 2;
        export { a, b as c };
    `);
    assert.strictEqual(exports.a, 1);
    assert.strictEqual(exports.c, 2);
});

// ===== BNG-013: literal undefined =====

test('BNG-013: literal undefined tidak dikompilasi menjadi null', () => {
    const exports = evaluate('export fn run() { return undefined; }');
    assert.strictEqual(exports.run(), undefined);
    assert.notStrictEqual(exports.run(), null);
});

// ===== BNG-012: keyword `typeof` dan `function` =====

test('BNG-012: keyword typeof dapat dipakai sebagai operator', () => {
    const exports = evaluate('export fn run() { return typeof 42; }');
    assert.strictEqual(exports.run(), 'number');
});

test('BNG-012: keyword function merupakan alias dari fn', () => {
    const exports = evaluate('export function double(x) { return x * 2; } export fn run() { return double(21); }');
    assert.strictEqual(exports.run(), 42);
});

test('BNG-012: async function merupakan alias async fn', async () => {
    const exports = evaluate('export async function get() { return 7; } export fn run() { return get(); }');
    assert.strictEqual(await exports.run(), 7);
});

// ===== BNG-011: getter dan method dengan nama sama =====

test('BNG-011: getter dan method pada kelas tidak saling menimpa', () => {
    const exports = evaluate(`
        export class User {
            constructor() { this._name = "anonim"; }
            get name() { return this._name; }
            set name(v) { this._name = v; }
            greet(greeting) { return greeting + ", " + this._name; }
        }
        export fn run() {
            const u = new User();
            u.name = "Budi";
            return { name: u.name, greet: u.greet("Halo") };
        }
    `);
    const result = exports.run();
    assert.strictEqual(result.name, 'Budi');
    assert.strictEqual(result.greet, 'Halo, Budi');
});

// ===== BNG-010: export variabel tidak saling menimpa =====

test('BNG-010: beberapa export named dapat hidup berdampingan', () => {
    const exports = evaluate(`
        export const pertama = "a";
        export const kedua = "b";
        export const ketiga = "c";
    `);
    assert.strictEqual(exports.pertama, 'a');
    assert.strictEqual(exports.kedua, 'b');
    assert.strictEqual(exports.ketiga, 'c');
});

// ===== Error runtime membawa details =====

test('BUG-014: ConflictError dan NotFoundError membawa details', () => {
    const exports = evaluate(`
        import { ConflictError, NotFoundError } from "bonang";
        export fn conflict() { throw new ConflictError("bentrok", { server: { id: 1 } }); }
        export fn notFound() { throw new NotFoundError("tidak ada", { id: 9 }); }
    `);

    try {
        exports.conflict();
        assert.fail('harus melempar ConflictError');
    } catch (err) {
        assert.strictEqual(err.code, 'CONFLICT');
        assert.strictEqual(err.statusCode, 409);
        assert.deepStrictEqual(err.details, { server: { id: 1 } });
    }

    try {
        exports.notFound();
        assert.fail('harus melempar NotFoundError');
    } catch (err) {
        assert.strictEqual(err.code, 'NOT_FOUND');
        assert.strictEqual(err.statusCode, 404);
        assert.deepStrictEqual(err.details, { id: 9 });
    }
});
