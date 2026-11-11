'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const {
    auditStructure,
    printStructureReport,
    LARGE_FILE_LINES
} = require('../../cli/structure-audit');

/**
 * Uji audit struktur (PHASE 10).
 *
 * Audit struktur memeriksa hal yang tidak dicakup auditor keamanan:
 * siklus dependensi, dead code, duplikasi, dan berkas oversized.
 */

test('audit struktur: basis kode Bonang tidak punya siklus dependensi', () => {
    const report = auditStructure();
    assert.deepStrictEqual(
        report.cycles,
        [],
        `ditemukan siklus: ${report.cycles.map((c) => c.join(' -> ')).join(', ')}`
    );
});

test('audit struktur: tidak ada kandidat dead code yang tak dikenal', () => {
    const report = auditStructure();
    assert.deepStrictEqual(
        report.deadCandidates,
        [],
        `kandidat dead code: ${report.deadCandidates.join(', ')}`
    );
});

test('audit struktur: tidak ada berkas duplikat identik', () => {
    const report = auditStructure();
    assert.deepStrictEqual(
        report.duplicates,
        [],
        `duplikat: ${report.duplicates.map((g) => g.join(' = ')).join(', ')}`
    );
});

test('audit struktur: memindai seluruh modul runtime dan compiler', () => {
    const report = auditStructure();
    assert.ok(report.filesScanned >= 25, `hanya ${report.filesScanned} berkas`);
});

test('audit struktur: daftar berkas besar terurut dari yang terbesar', () => {
    const report = auditStructure();
    assert.ok(report.largeFiles.length > 0, 'harus ada berkas di atas ambang');

    for (const file of report.largeFiles) {
        assert.ok(
            file.lines > LARGE_FILE_LINES,
            `${file.file} hanya ${file.lines} baris`
        );
    }

    for (let i = 1; i < report.largeFiles.length; i++) {
        assert.ok(
            report.largeFiles[i - 1].lines >= report.largeFiles[i].lines,
            'urutan harus menurun'
        );
    }
});

test('audit struktur: modul client dan sw-cache bukan dead code', () => {
    // Keduanya dimuat lewat path dinamis, bukan `require()` biasa —
    // pemindai harus tahu itu, kalau tidak akan salah dilaporkan.
    const report = auditStructure();
    assert.ok(!report.deadCandidates.includes('runtime/client/client.js'));
    assert.ok(!report.deadCandidates.includes('runtime/client/sw-cache.js'));
});

test('audit struktur: pengguna pool tercatat', () => {
    const report = auditStructure();
    assert.ok(report.poolUsers.length > 0, 'harus ada pengguna pool tercatat');
});

test('audit struktur: pencetakan laporan tidak melempar', () => {
    const report = auditStructure();
    const original = console.log;
    const lines = [];
    console.log = (...args) => lines.push(args.join(' '));
    try {
        printStructureReport(report);
    } finally {
        console.log = original;
    }
    assert.ok(lines.length > 0, 'laporan harus mencetak sesuatu');
    assert.ok(
        lines.some((l) => l.includes('Siklus dependensi')),
        'laporan harus menyebut siklus dependensi'
    );
});

test('audit struktur: identifier SQL memakai satu sumber kebenaran', () => {
    // `assertIdentifier` pernah diduplikasi di query-builder dan
    // soft-delete. Sekarang keduanya mengimpor dari modul yang sama.
    const identifiers = require('../../runtime/database/identifiers');
    const queryBuilder = require('../../runtime/database/query-builder');

    assert.strictEqual(
        queryBuilder.IDENTIFIER_PATTERN,
        identifiers.IDENTIFIER_PATTERN,
        'query builder harus memakai pola dari modul identifiers'
    );

    const softDelete = require('../../runtime/database/soft-delete');
    assert.strictEqual(
        softDelete.assertIdentifier,
        identifiers.assertIdentifier,
        'soft delete harus memakai fungsi dari modul identifiers'
    );
});

test('audit struktur: assertIdentifier menolak nama berbahaya', () => {
    const { assertIdentifier } = require('../../runtime/database/identifiers');
    for (const bad of ['products; DROP TABLE x', 'products--', '1products', '', 'a b']) {
        assert.throws(
            () => assertIdentifier(bad, 'tabel'),
            /tidak valid/,
            `harus menolak: ${JSON.stringify(bad)}`
        );
    }
    assert.strictEqual(assertIdentifier('products', 'tabel'), 'products');
});

test('audit struktur: identifier SQL menolak nama path traversal', () => {
    const { assertIdentifier } = require('../../runtime/database/identifiers');
    for (const bad of ['../etc/passwd', 'a/b', 'a\\b', 'a.b']) {
        assert.throws(() => assertIdentifier(bad, 'kolom'), /tidak valid/);
    }
});

test('audit struktur: file struktur audit berada di path yang benar', () => {
    const file = require.resolve('../../cli/structure-audit');
    assert.strictEqual(
        path.basename(file),
        'structure-audit.js'
    );
});
