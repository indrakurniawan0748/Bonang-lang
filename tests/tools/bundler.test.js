'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { bundle } = require('../../compiler/bundler');

/**
 * Regression test untuk BNG-039.
 *
 * Bundel client Bonang sebelumnya memakai `require(...)` yang tidak ada
 * di browser, dan modul runtime client tidak pernah ikut ke output.
 * Akibatnya frontend melempar `require is not defined` dan seluruh
 * aplikasi gagal total di browser — hanya terlihat saat dibuka lewat
 * browser sungguhan, bukan lewat test Node.
 *
 * Bug ini dikunci di sini dengan dua pemeriksaan:
 *  1. Bundel client tidak boleh memuat `require(` sama sekali.
 *  2. Bundel client harus menyertakan runtime client (IndexedDB, sync
 *     queue) di dalamnya, tanpa file terpisah.
 */

// ===== PEMBANTU =====

/**
 * Buat proyek Bonang sementara berisi entry client, lalu bundel.
 */
function bundleClient(entrySource, extra = {}) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bonang-bundle-'));
    const entry = path.join(root, 'main.bng');
    fs.writeFileSync(entry, entrySource, 'utf8');

    for (const [name, content] of Object.entries(extra)) {
        fs.writeFileSync(path.join(root, name), content, 'utf8');
    }

    const output = path.join(root, 'client.js');
    try {
        const result = bundle({ entry, output, target: 'client' });
        return { result, code: result.code, root };
    } catch (err) {
        fs.rmSync(root, { recursive: true, force: true });
        throw err;
    }
}

// ===== TEST =====

test('bundle: bundel client tidak memuat require (browser tidak punya itu)', () => {
    const { code, root } = bundleClient([
        'import { apiFetch } from "bonang/client";',
        'export async fn main() {',
        '    const result = await apiFetch("/api/health");',
        '    return result;',
        '}'
    ].join('\n'));

    try {
        // `require` hanya boleh muncul di dalam string/identifier, bukan
        // sebagai call expression. Pola di bawah menangkap pemanggilan.
        assert.doesNotMatch(
            code,
            /\brequire\s*\(/,
            'Bundel client tidak boleh memanggil require()'
        );
        // `process` juga tidak ada di browser; error reference ini harus
        // muncul sebagai exception, bukan ReferenceError saat runtime.
        assert.doesNotMatch(code, /\bprocess\.exitCode\b/);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('bundle: bundel client menyertakan runtime client secara inline', () => {
    const { code, root } = bundleClient([
        'import { IndexedDBStore } from "bonang/client";',
        'export async fn main() {',
        '    const store = new IndexedDBStore({ name: "t", version: 1, stores: ["s"] });',
        '    return store;',
        '}'
    ].join('\n'));

    try {
        // API runtime client harus ada di dalam bundel, bukan di file lain.
        assert.match(code, /IndexedDBStore/, 'runtime client harus ter-inline');
        assert.match(code, /SyncQueue|apiFetch/, 'runtime client harus lengkap');
        assert.match(code, /__bngModules\["__bng_client_runtime"\]/);
        // Tidak boleh ada require ke file runtime terpisah.
        assert.doesNotMatch(code, /require\("\.\/bonang-client\.js"\)/);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('bundle: bundel client menolak modul Node bawaan saat build', () => {
    // Kegagalan harus muncul saat build, bukan diam-diam di browser.
    assert.throws(
        () => bundleClient([
            'import { readFileSync } from "node:fs";',
            'export fn main() {',
            '    return readFileSync;',
            '}'
        ].join('\n')),
        /tidak boleh dipakai di bundel browser|tidak bisa dipakai di bundel browser/
    );
});

test('bundle: bundel client menolak modul runtime server', () => {
    assert.throws(
        () => bundleClient([
            'import { createServer } from "bonang";',
            'export fn main() {',
            '    return createServer;',
            '}'
        ].join('\n')),
        /hanya tersedia di server/
    );
});

test('bundle: bundel client menolak paket eksternal', () => {
    assert.throws(
        () => bundleClient([
            'import { debounce } from "lodash";',
            'export fn main() {',
            '    return debounce;',
            '}'
        ].join('\n')),
        /tidak bisa dipakai di bundel browser/
    );
});

test('bundle: bundel server tetap memakai require Node', () => {
    // Target server tidak boleh terpengaruh oleh perbaikan client.
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bonang-bundle-'));
    try {
        const entry = path.join(root, 'main.bng');
        fs.writeFileSync(entry, [
            'import { createServer } from "bonang";',
            'export fn main() {',
            '    return createServer;',
            '}'
        ].join('\n'), 'utf8');

        const output = path.join(root, 'server.js');
        const result = bundle({ entry, output, target: 'server' });

        assert.match(result.code, /require\("\.\/bonang-runtime\.js"\)/);
        assert.match(result.code, /function \(module, exports, require\)/);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('bundle: bundel client menolak modul Node bawaan yang dipanggil di dalam fungsi', () => {
    // Pesan error harus menyebut nama modulnya supaya bisa ditindaklanjuti.
    let message = '';
    try {
        bundleClient([
            'export fn main() {',
            '    const fs = require("node:fs");',
            '    return fs;',
            '}'
        ].join('\n'));
    } catch (err) {
        message = err.message;
    }
    assert.match(message, /node:fs|tidak bisa dipakai di bundel browser/);
});
