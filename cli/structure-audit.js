'use strict';

/**
 * Audit struktur basis kode (PHASE 10).
 *
 * Memeriksa hal-hal yang tidak bisa dilihat auditor keamanan:
 *  - siklus dependensi antar-modul,
 *  - modul yang tidak pernah di-require (kandidat dead code),
 *  - berkas yang tumbuh di atas ambang readability,
 *  - duplikasi berkas identik,
 *  - pemakaian pool database tanpa `close()`.
 *
 * Semua pemeriksaan berjalan statis terhadap kode sumber — tidak
 * menjalankan apa pun, jadi aman dipanggil kapan saja.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '..');

/** Direktori yang dipindai. */
const SCAN_ROOTS = ['compiler', 'runtime', 'cli', 'standard-library', 'package-manager'];

/** Ambang baris untuk ditandai sebagai "terlalu besar". */
const LARGE_FILE_LINES = 400;

/** Modul yang memang tidak di-require lewat `require()` biasa. */
const KNOWN_DYNAMIC_MODULES = new Set([
    // Entry point CLI — dipanggil langsung oleh Node, bukan di-require.
    'cli/cli.js',
    // Dimuat lewat `path.resolve(__dirname, ...)` di bundler & compiler.
    'runtime/client/client.js',
    // Dimuat lewat `require.resolve(...)` di HTTP server (helper service worker).
    'runtime/client/sw-cache.js'
]);

/**
 * Kumpulkan seluruh berkas `.js` di bawah direktori yang diminta.
 */
function collectFiles(roots) {
    const files = [];
    const walk = (dir) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            if (entry.name === 'node_modules' || entry.name === '.git') continue;
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) walk(full);
            else if (entry.name.endsWith('.js')) files.push(full);
        }
    };
    for (const root of roots) {
        const abs = path.join(ROOT, root);
        if (fs.existsSync(abs)) walk(abs);
    }
    return files;
}

/**
 * Bangun graf dependensi internal (relatif antar-modul).
 */
function buildGraph(files) {
    const graph = new Map();
    for (const file of files) {
        const src = fs.readFileSync(file, 'utf8');
        const deps = [];
        const re = /require\(\s*['"]([^'"]+)['"]\s*\)/g;
        let m;
        while ((m = re.exec(src)) !== null) {
            const spec = m[1];
            if (!spec.startsWith('.')) continue;
            const base = path.resolve(path.dirname(file), spec);
            let target = null;
            if (fs.existsSync(base) && fs.statSync(base).isDirectory()) {
                target = path.join(base, 'index.js');
            } else if (fs.existsSync(base + '.js')) {
                target = base + '.js';
            }
            if (target && target.startsWith(ROOT)) deps.push(path.relative(ROOT, target).split(path.sep).join('/'));
        }
        graph.set(path.relative(ROOT, file).split(path.sep).join('/'), deps);
    }
    return graph;
}

/**
 * Cari siklus pada graf (DFS dengan pewarnaan).
 */
function findCycles(graph) {
    const state = new Map();
    const stack = [];
    const cycles = [];

    const visit = (node) => {
        state.set(node, 1);
        stack.push(node);
        for (const dep of graph.get(node) || []) {
            if (state.get(dep) === 1) {
                cycles.push(stack.slice(stack.indexOf(dep)).concat(dep));
            } else if (!state.has(dep)) {
                visit(dep);
            }
        }
        stack.pop();
        state.set(node, 2);
    };

    for (const node of graph.keys()) {
        if (!state.has(node)) visit(node);
    }
    return cycles;
}

/**
 * Jalankan audit struktur.
 *
 * Mengembalikan objek laporan (bukan langsung mencetak) supaya bisa
 * dipakai oleh CLI maupun oleh test.
 */
function auditStructure(options = {}) {
    const roots = options.roots || SCAN_ROOTS;
    const files = collectFiles(roots);
    const graph = buildGraph(files);
    const cycles = findCycles(graph);

    const referenced = new Set();
    for (const deps of graph.values()) {
        for (const dep of deps) referenced.add(dep);
    }
    const deadCandidates = [...graph.keys()].filter(
        (file) => !referenced.has(file) && !KNOWN_DYNAMIC_MODULES.has(file) && !file.endsWith('/index.js')
    );

    const largeFiles = files
        .map((file) => ({
            file: path.relative(ROOT, file).split(path.sep).join('/'),
            lines: fs.readFileSync(file, 'utf8').split('\n').length
        }))
        .filter((f) => f.lines > LARGE_FILE_LINES)
        .sort((a, b) => b.lines - a.lines);

    const byHash = new Map();
    for (const file of files) {
        const hash = crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex');
        if (!byHash.has(hash)) byHash.set(hash, []);
        byHash.get(hash).push(path.relative(ROOT, file).split(path.sep).join('/'));
    }
    const duplicates = [...byHash.values()].filter((group) => group.length > 1);

    const poolUsers = files
        .filter((file) => /createPool\(|new Pool\(/.test(fs.readFileSync(file, 'utf8')))
        .map((file) => ({
            file: path.relative(ROOT, file).split(path.sep).join('/'),
            hasClose: /\.close\(/.test(fs.readFileSync(file, 'utf8'))
        }));

    return {
        filesScanned: files.length,
        cycles,
        deadCandidates,
        largeFiles,
        duplicates,
        poolUsers
    };
}

/**
 * Cetak hasil audit struktur dalam bentuk yang mudah dibaca.
 */
function printStructureReport(report) {
    console.log('\n=== AUDIT STRUKTUR BONANG ===\n');
    console.log(`Berkas JS dipindai: ${report.filesScanned}`);

    console.log(`\nSiklus dependensi: ${report.cycles.length}`);
    for (const cycle of report.cycles) console.log(`  cycle: ${cycle.join(' -> ')}`);

    console.log(`\nKandidat dead code: ${report.deadCandidates.length}`);
    for (const file of report.deadCandidates) console.log(`  dead?: ${file}`);

    console.log(`\nBerkas di atas ${LARGE_FILE_LINES} baris: ${report.largeFiles.length}`);
    for (const file of report.largeFiles) console.log(`  ${file.file} — ${file.lines} baris`);

    console.log(`\nDuplikat identik: ${report.duplicates.length}`);
    for (const group of report.duplicates) console.log(`  dup: ${group.join(' = ')}`);

    console.log('\nPengguna connection pool:');
    for (const user of report.poolUsers) {
        console.log(`  ${user.file} — close() di berkas sama: ${user.hasClose}`);
    }
}

module.exports = {
    SCAN_ROOTS,
    LARGE_FILE_LINES,
    KNOWN_DYNAMIC_MODULES,
    auditStructure,
    printStructureReport
};
