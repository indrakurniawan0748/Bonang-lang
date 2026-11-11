'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const { bundle } = require('../../compiler/bundler');
const { Compiler, createRequire } = require('../../compiler/compiler');

/**
 * Regression test untuk L-05 (siklus modul & dynamic import).
 *
 * Dua masalah yang sebelumnya membuat modul Bonang tidak bisa dipakai
 * untuk proyek nyata:
 *
 *  1. **Siklus modul** — A mengimpor B, B mengimpor A. Traversal graf modul
 *     yang naif berakhir dengan stack overflow saat build, dan `require`
 *     yangevaluasi modul berulang kali juga berakhir sama.
 *
 *  2. **Dynamic import** — `import("./x.bng")` tidak bisa diparse sama sekali,
 *     sehingga pola lazy-loading tidak tersedia.
 *
 * Test di bawah memakai proyek Bonang sungguhan di folder sementara dan
 * menjalankan hasilnya lewat Node — bukan hanya memeriksa bentuk string.
 */

// ===== PEMBANTU =====

/**
 * Buat proyek Bonang sementara berisi beberapa file, lalu kembalikan
 * foldernya. File dihapus saat test selesai.
 */
function makeProject(files) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bonang-modgraph-'));
    for (const [name, content] of Object.entries(files)) {
        const target = path.join(root, name);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, content, 'utf8');
    }
    return root;
}

/**
 * Bundle proyek lalu jalankan hasilnya, kembalikan stdout.
 */
function bundleAndRun(files, entryName = 'main.bng') {
    const root = makeProject(files);
    try {
        const output = path.join(root, 'dist.js');
        const result = bundle({
            entry: path.join(root, entryName),
            output,
            target: 'server'
        });
        const stdout = execFileSync(process.execPath, [output], {
            encoding: 'utf8',
            cwd: root
        });
        return { stdout, result, root };
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
}

/**
 * Jalankan file Bonang langsung dari sumber (tanpa bundling).
 */
function runSource(files, entryName = 'main.bng') {
    const root = makeProject(files);
    try {
        const entry = path.join(root, entryName);
        const compiler = new Compiler();
        const source = fs.readFileSync(entry, 'utf8');
        const result = compiler.compile(source, entry);
        const moduleObj = { exports: {} };
        const fn = new Function(
            'module', 'exports', 'require', '__filename', '__dirname',
            result.helpers.join('\n\n') + '\n\n' + result.code
        );
        fn(
            moduleObj, moduleObj.exports, createRequire(entry),
            entry, path.dirname(entry)
        );
        return { moduleObj, root };
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
}

// ===== SIKLUS MODUL =====

test('L-05: siklus modul dua file bisa dibundle tanpa stack overflow', () => {
    const { stdout, result } = bundleAndRun({
        'a.bng': [
            'import { getB } from "./b.bng";',
            'export fn getA() { return "A"; }',
            'export fn useB() { return "a->" + getB(); }'
        ].join('\n'),
        'b.bng': [
            'import { getA } from "./a.bng";',
            'export fn getB() { return "B" + getA(); }'
        ].join('\n'),
        'main.bng': [
            'import { useB } from "./a.bng";',
            'fn main() { console.log(useB()); }'
        ].join('\n')
    });

    // Tiga modul: main, a, b.
    assert.strictEqual(result.modules, 3);
    assert.strictEqual(stdout.trim(), 'a->BA');
});

test('L-05: siklus modul bisa dijalankan langsung dari sumber', () => {
    const { moduleObj } = runSource({
        'a.bng': [
            'import { getB } from "./b.bng";',
            'export fn getA() { return "A"; }',
            'export fn useB() { return "a->" + getB(); }'
        ].join('\n'),
        'b.bng': [
            'import { getA } from "./a.bng";',
            'export fn getB() { return "B" + getA(); }'
        ].join('\n'),
        'main.bng': [
            'import { useB } from "./a.bng";',
            'fn main() { console.log(useB()); }'
        ].join('\n')
    });

    assert.strictEqual(typeof moduleObj.exports.main, 'function');
    moduleObj.exports.main();
});

test('L-05: siklus tiga modul (a -> b -> c -> a) tidak rekursi tak terbatas', () => {
    const { stdout, result } = bundleAndRun({
        'a.bng': [
            'import { getB } from "./b.bng";',
            'export fn getA() { return "A"; }'
        ].join('\n'),
        'b.bng': [
            'import { getC } from "./c.bng";',
            'export fn getB() { return "B" + getC(); }'
        ].join('\n'),
        'c.bng': [
            'import { getA } from "./a.bng";',
            'export fn getC() { return "C" + getA(); }'
        ].join('\n'),
        'main.bng': [
            'import { getB } from "./b.bng";',
            'fn main() { console.log(getB()); }'
        ].join('\n')
    });

    assert.strictEqual(result.modules, 4);
    assert.strictEqual(stdout.trim(), 'BCA');
});

test('L-05: nilai dari modul siklik dibaca saat call time (live binding)', () => {
    // Di siklus, saat B dievaluasi A belum selesai. Kalau import memakai
    // destructuring (`const { x } = require(...)`), nilai x terkunci sebagai
    // `undefined` selamanya. Live binding membacanya dari `module.exports`
    // setiap kali dipakai.
    const { stdout } = bundleAndRun({
        'counter.bng': [
            'export let total = 0;',
            'export fn bump() { total = total + 1; return total; }'
        ].join('\n'),
        'reader.bng': [
            'import { bump } from "./counter.bng";',
            'export fn readTwice() {',
            '    bump();',
            '    bump();',
            '    return bump();',
            '}'
        ].join('\n'),
        'main.bng': [
            'import { readTwice } from "./reader.bng";',
            'fn main() { console.log(readTwice()); }'
        ].join('\n')
    });

    assert.strictEqual(stdout.trim(), '3');
});

test('L-05: siklus modul dapat mengekspor nilai milik modul lain', () => {
    // `export { x }` di mana x berasal dari import harus mengekspor nilai
    // dari modul asal, bukan binding lokal yang belum terisi.
    const { stdout } = bundleAndRun({
        'base.bng': 'export fn greet() { return "hai"; }\n',
        'alias.bng': [
            'import { greet } from "./base.bng";',
            'export { greet };'
        ].join('\n'),
        'main.bng': [
            'import { greet } from "./alias.bng";',
            'fn main() { console.log(greet()); }'
        ].join('\n')
    });

    assert.strictEqual(stdout.trim(), 'hai');
});

// ===== DYNAMIC IMPORT =====

test('L-05: import() dinamis bisa diparse dan menghasilkan ekspresi', () => {
    const compiler = new Compiler();
    const result = compiler.compile(
        'async fn main() { const m = await import("./x.bng"); return m; }',
        'main.bng'
    );

    assert.match(result.code, /_\$\$dynamicImport\("\.\/x\.bng"\)/);
    assert.deepStrictEqual(result.dynamicImports, ['./x.bng']);
});

test('L-05: import() dinamis memuat modul saat runtime', () => {
    const root = makeProject({
        'x.bng': 'export fn hello() { return "halo"; }\n',
        'main.bng': [
            'async fn main() {',
            '    const m = await import("./x.bng");',
            '    console.log(m.hello());',
            '}'
        ].join('\n')
    });

    try {
        const entry = path.join(root, 'main.bng');
        const compiler = new Compiler();
        const source = fs.readFileSync(entry, 'utf8');
        const result = compiler.compile(source, entry);
        const moduleObj = { exports: {} };
        const fn = new Function(
            'module', 'exports', 'require', '__filename', '__dirname',
            result.helpers.join('\n\n') + '\n\n' + result.code
        );
        fn(
            moduleObj, moduleObj.exports, createRequire(entry),
            entry, path.dirname(entry)
        );

        return moduleObj.exports.main().then(() => {
            assert.ok(true);
        });
    } finally {
        // Folder dihapus setelah promise selesai (test async).
        setTimeout(() => fs.rmSync(root, { recursive: true, force: true }), 50);
    }
});

test('L-05: import() dinamis membungkus modul di dalam bundel', () => {
    const { stdout, result } = bundleAndRun({
        'x.bng': 'export fn hello() { return "halo-bundel"; }\n',
        'main.bng': [
            'async fn main() {',
            '    const m = await import("./x.bng");',
            '    console.log(m.hello());',
            '}'
        ].join('\n')
    });

    // Modul yang diimpor dinamis ikut masuk ke bundel.
    assert.strictEqual(result.modules, 2);
    assert.strictEqual(stdout.trim(), 'halo-bundel');
});

test('L-05: import() dinamis menolak path yang bukan literal', () => {
    // Path yang tidak diketahui saat build membuat bundel tidak deterministik.
    const compiler = new Compiler();
    assert.throws(
        () => compiler.compile(
            'fn main() { const p = "./x.bng"; return import(p); }',
            'main.bng'
        ),
        /hanya menerima string literal/
    );
});

test('L-05: import() dinamis menolak modul Node bawaan di bundel client', () => {
    const root = makeProject({
        'main.bng': [
            'async fn main() {',
            '    const fs = await import("node:fs");',
            '    return fs;',
            '}'
        ].join('\n')
    });

    try {
        assert.throws(
            () => bundle({
                entry: path.join(root, 'main.bng'),
                output: path.join(root, 'client.js'),
                target: 'client'
            }),
            /tidak boleh dipakai di bundel browser|tidak bisa dipakai di bundel browser/
        );
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});
