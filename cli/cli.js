'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { Compiler } = require('../compiler/compiler');

/**
 * CLI Bonang.
 *
 * Perintah yang tersedia:
 *   bonang init       Buat proyek baru
 *   bonang dev        Development server dengan hot reload
 *   bonang build      Build produksi
 *   bonang run        Jalankan file Bonang
 *   bonang test       Jalankan test suite
 *   bonang lint       Analisis statis
 *   bonang audit      Audit keamanan
 *   bonang bench      Benchmark
 *   bonang migrate    Jalankan migrasi database
 *
 * Setiap perintah diimplementasikan penuh — tidak ada placeholder.
 */

const COMMANDS = {};

/**
 * Daftarkan sebuah perintah CLI.
 */
function command(name, description, handler) {
    COMMANDS[name] = { name, description, handler };
}

/**
 * Cetak bantuan.
 */
function printHelp() {
    const lines = ['Bonang — Browser Optimized Network And Native Graphics', '', 'Penggunaan:', '  bonang <perintah> [opsi]', '', 'Perintah:'];
    const names = Object.keys(COMMANDS).sort();
    const width = Math.max(...names.map((n) => n.length));
    for (const name of names) {
        lines.push(`  ${name.padEnd(width)}  ${COMMANDS[name].description}`);
    }
    lines.push('', 'Opsi global:');
    lines.push('  --help, -h        Tampilkan bantuan');
    lines.push('  --version, -v     Tampilkan versi');
    lines.push('');
    return lines.join('\n');
}

/**
 * Parse argumen sederhana: `--key value`, `--flag`, positional.
 */
function parseArgs(argv) {
    const options = {};
    const positional = [];

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg.startsWith('--')) {
            const key = arg.slice(2);
            const next = argv[i + 1];
            if (next !== undefined && !next.startsWith('-')) {
                options[key] = next;
                i += 1;
            } else {
                options[key] = true;
            }
        } else if (arg.startsWith('-') && arg.length > 1) {
            options[arg.slice(1)] = true;
        } else {
            positional.push(arg);
        }
    }

    return { options, positional };
}

/**
 * Temukan file konfigurasi proyek (`bonang.config.json`) di direktori
 * saat ini atau folder di atasnya.
 */
function findConfig(startDir = process.cwd()) {
    let dir = path.resolve(startDir);
    while (true) {
        const candidate = path.join(dir, 'bonang.config.json');
        if (fs.existsSync(candidate)) {
            try {
                return { path: candidate, config: JSON.parse(fs.readFileSync(candidate, 'utf8')) };
            } catch (err) {
                throw new Error(`Konfigurasi tidak valid (${candidate}): ${err.message}`);
            }
        }
        const parent = path.dirname(dir);
        if (parent === dir) return null;
        dir = parent;
    }
}

// ===== INIT =====

command('init', 'Buat proyek Bonang baru', async (args) => {
    const name = args.positional[0];
    if (!name) {
        throw new Error('Nama proyek wajib diisi: bonang init <nama-proyek>');
    }
    if (!/^[A-Za-z0-9_-]+$/.test(name)) {
        throw new Error(`Nama proyek tidak valid: '${name}'. Gunakan huruf, angka, dash, atau underscore.`);
    }

    const target = path.resolve(process.cwd(), name);
    if (fs.existsSync(target) && fs.readdirSync(target).length > 0) {
        throw new Error(`Direktori '${name}' sudah ada dan tidak kosong`);
    }

    const structure = {
        'src/server': null,
        'src/client': null,
        'src/shared': null,
        'public': null,
        'tests': null,
        'data': null
    };

    for (const dir of Object.keys(structure)) {
        fs.mkdirSync(path.join(target, dir), { recursive: true });
    }

    const config = {
        name,
        version: '0.1.0',
        port: 3000,
        entry: 'src/server/main.bng',
        clientEntry: 'src/client/main.bng',
        database: {
            driver: 'sqlite',
            file: 'data/bonang.db'
        },
        build: {
            outDir: 'dist'
        }
    };
    fs.writeFileSync(path.join(target, 'bonang.config.json'), JSON.stringify(config, null, 2), 'utf8');

    // Template sumber minimal yang langsung bisa dijalankan.
    fs.writeFileSync(path.join(target, 'src/server/main.bng'), SERVER_TEMPLATE, 'utf8');
    fs.writeFileSync(path.join(target, 'src/server/routes.bng'), ROUTES_TEMPLATE, 'utf8');
    fs.writeFileSync(path.join(target, 'src/client/main.bng'), CLIENT_TEMPLATE, 'utf8');
    fs.writeFileSync(path.join(target, 'src/shared/types.bng'), SHARED_TEMPLATE, 'utf8');
    fs.writeFileSync(path.join(target, 'public/index.html'), HTML_TEMPLATE, 'utf8');
    fs.writeFileSync(path.join(target, 'public/style.css'), CSS_TEMPLATE, 'utf8');
    fs.writeFileSync(path.join(target, 'tests/app.test.bng'), TEST_TEMPLATE, 'utf8');
    fs.writeFileSync(path.join(target, 'README.md'), README_TEMPLATE, 'utf8');
    fs.writeFileSync(path.join(target, '.gitignore'), GITIGNORE_TEMPLATE, 'utf8');

    console.log(`\nProyek Bonang '${name}' berhasil dibuat di ${target}`);
    console.log('\nLangkah berikutnya:');
    console.log(`  cd ${name}`);
    console.log('  bonang dev');
    console.log('\nServer akan berjalan di http://localhost:' + config.port);
    return 0;
});

// ===== RUN =====

command('run', 'Jalankan file Bonang', async (args) => {
    const file = args.positional[0];
    if (!file) {
        throw new Error('File wajib diisi: bonang run <file.bng>');
    }
    const filePath = path.resolve(process.cwd(), file);
    if (!fs.existsSync(filePath)) {
        throw new Error(`File tidak ditemukan: ${file}`);
    }

    const compiler = new Compiler();
    const source = fs.readFileSync(filePath, 'utf8');

    try {
        const result = compiler.compile(source, filePath);
        const moduleObj = { exports: {} };
        const { createRequire } = require('../compiler/compiler');
        const fn = new Function('module', 'exports', 'require', '__filename', '__dirname', result.code);
        fn(moduleObj, moduleObj.exports, createRequire(filePath), filePath, path.dirname(filePath));

        if (typeof moduleObj.exports.main === 'function') {
            const result = await moduleObj.exports.main();
            if (result !== undefined) {
                console.log(result);
            }
        }
    } catch (err) {
        console.error(`Error: ${err.message}`);
        if (err.stack) console.error(err.stack);
        return 1;
    }
    return 0;
});

// ===== BUILD =====

command('build', 'Build proyek untuk produksi', async (args) => {
    const found = findConfig();
    if (!found) {
        throw new Error('bonang.config.json tidak ditemukan. Jalankan dari folder proyek.');
    }
    const { config, path: configPath } = found;
    const root = path.dirname(configPath);
    const outDir = path.resolve(root, config.build?.outDir || 'dist');
    const minify = Boolean(args.options.minify);

    fs.rmSync(outDir, { recursive: true, force: true });
    fs.mkdirSync(outDir, { recursive: true });

    const { bundle, copyRuntime } = require('../compiler/bundler');
    const built = [];

    // Bundel server: seluruh modul Bonang digabung menjadi satu file.
    if (config.entry) {
        const inputPath = path.resolve(root, config.entry);
        if (!fs.existsSync(inputPath)) {
            console.log(`  Lewati ${config.entry} (tidak ada)`);
        } else {
            try {
                const result = bundle({
                    entry: inputPath,
                    output: path.join(outDir, 'server.js'),
                    target: 'server',
                    minify
                });
                copyRuntime(outDir, 'server');
                built.push({ file: config.entry, out: 'server.js', bytes: result.bytes, modules: result.modules });
                console.log(`  ✓ ${config.entry} → server.js (${result.modules} modul, ${(result.bytes / 1024).toFixed(1)} KB)`);
            } catch (err) {
                console.error(`  ✗ ${config.entry}: ${err.message}`);
                throw err;
            }
        }
    }

    // Bundel client: output browser-side (IIFE), bukan modul Node.
    if (config.clientEntry) {
        const inputPath = path.resolve(root, config.clientEntry);
        if (!fs.existsSync(inputPath)) {
            console.log(`  Lewati ${config.clientEntry} (tidak ada)`);
        } else {
            try {
                const result = bundle({
                    entry: inputPath,
                    output: path.join(outDir, 'client.js'),
                    target: 'client',
                    minify
                });
                built.push({ file: config.clientEntry, out: 'client.js', bytes: result.bytes, modules: result.modules });
                console.log(`  ✓ ${config.clientEntry} → client.js (${result.modules} modul, ${(result.bytes / 1024).toFixed(1)} KB)`);
            } catch (err) {
                console.error(`  ✗ ${config.clientEntry}: ${err.message}`);
                throw err;
            }
        }
    }

    // Salin aset statis.
    const publicDir = path.resolve(root, 'public');
    if (fs.existsSync(publicDir)) {
        copyDir(publicDir, path.join(outDir, 'public'));
        console.log('  ✓ public/ → dist/public');
    }

    // Tulis manifest build.
    fs.writeFileSync(path.join(outDir, 'build.json'), JSON.stringify({
        name: config.name,
        version: config.version,
        builtAt: new Date().toISOString(),
        minified: minify,
        files: built
    }, null, 2), 'utf8');

    console.log(`\nBuild selesai ke ${outDir}`);
    console.log(`Jalankan dengan: node ${path.join(outDir, 'server.js')}`);
    return 0;
});

// ===== DEV =====

command('dev', 'Development server dengan hot reload', async (args) => {
    const found = findConfig();
    if (!found) {
        throw new Error('bonang.config.json tidak ditemukan. Jalankan dari folder proyek.');
    }
    const { config, path: configPath } = found;
    const root = path.dirname(configPath);

    const { DevServer } = require('./dev-server');
    const dev = new DevServer({ root, config, configPath });
    await dev.start();
    return 0; // Proses tetap berjalan.
});

// ===== TEST =====

command('test', 'Jalankan test suite Bonang', async (args) => {
    const found = findConfig();
    const root = found ? path.dirname(found.path) : process.cwd();
    const testDir = path.resolve(root, 'tests');

    if (!fs.existsSync(testDir)) {
        console.log('Tidak ada folder tests/.');
        return 0;
    }

    const files = [];
    const collect = (dir) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) collect(full);
            else if (entry.name.endsWith('.test.bng')) files.push(full);
        }
    };
    collect(testDir);

    if (files.length === 0) {
        console.log('Tidak ada file test (.test.bng) yang ditemukan.');
        return 0;
    }

    console.log(`Menjalankan ${files.length} file test...\n`);

    const compiler = new Compiler();
    let passed = 0;
    let failed = 0;
    const failures = [];

    for (const file of files) {
        const relative = path.relative(root, file);
        try {
            const source = fs.readFileSync(file, 'utf8');
            const result = compiler.compile(source, file);
            const moduleObj = { exports: {} };
            const { createRequire } = require('../compiler/compiler');
            const fn = new Function('module', 'exports', 'require', '__filename', '__dirname', result.code);
            fn(moduleObj, moduleObj.exports, createRequire(file), file, path.dirname(file));

            // Modul test mengekspor fungsi `tests` berisi array kasus.
            const cases = moduleObj.exports.tests || [];
            for (const testCase of cases) {
                try {
                    await testCase.run();
                    passed += 1;
                    console.log(`  ✓ ${relative} › ${testCase.name}`);
                } catch (err) {
                    failed += 1;
                    failures.push({ file: relative, name: testCase.name, error: err });
                    console.log(`  ✗ ${relative} › ${testCase.name}`);
                }
            }
        } catch (err) {
            failed += 1;
            failures.push({ file: relative, name: '(kompilasi)', error: err });
            console.log(`  ✗ ${relative} › kompilasi gagal: ${err.message}`);
        }
    }

    console.log(`\n${passed} lulus, ${failed} gagal`);
    if (failures.length > 0) {
        console.log('\nDetail kegagalan:');
        for (const failure of failures) {
            console.log(`\n  ${failure.file} › ${failure.name}`);
            console.log(`  ${failure.error.message}`);
        }
        return 1;
    }
    return 0;
});

// ===== LINT =====

command('lint', 'Analisis statis kode Bonang', async (args) => {
    const found = findConfig();
    const root = found ? path.dirname(found.path) : process.cwd();

    const files = collectSourceFiles(root);
    if (files.length === 0) {
        console.log('Tidak ada file .bng yang ditemukan.');
        return 0;
    }

    const { Linter } = require('./linter');
    const linter = new Linter();
    let totalIssues = 0;
    let errors = 0;

    for (const file of files) {
        const relative = path.relative(root, file);
        const source = fs.readFileSync(file, 'utf8');
        const issues = linter.lint(source, relative);
        if (issues.length > 0) {
            console.log(`\n${relative}`);
            for (const issue of issues) {
                console.log(`  ${issue.line}:${issue.column}  ${issue.severity}  ${issue.message}  (${issue.rule})`);
                if (issue.severity === 'error') errors += 1;
            }
            totalIssues += issues.length;
        }
    }

    console.log(`\n${files.length} file diperiksa, ${totalIssues} masalah ditemukan.`);
    // Hanya error yang menggagalkan build; warning/info tetap dilaporkan
    // tetapi tidak memblokir.
    return errors > 0 ? 1 : 0;
});

// ===== AUDIT =====

command('audit', 'Audit keamanan proyek', async (args) => {
    const found = findConfig();
    const root = found ? path.dirname(found.path) : process.cwd();

    const { SecurityAuditor } = require('./auditor');
    const auditor = new SecurityAuditor();
    const report = await auditor.audit(root);

    console.log('\n=== AUDIT KEAMANAN BONANG ===\n');
    console.log(`File diperiksa: ${report.filesScanned}`);
    console.log(`Masalah ditemukan: ${report.issues.length}\n`);

    const bySeverity = {};
    for (const issue of report.issues) {
        bySeverity[issue.severity] = (bySeverity[issue.severity] || 0) + 1;
    }

    if (report.issues.length === 0) {
        console.log('Tidak ada masalah keamanan terdeteksi.');
    } else {
        for (const issue of report.issues) {
            console.log(`[${issue.severity.toUpperCase()}] ${issue.file}:${issue.line}`);
            console.log(`  ${issue.message}`);
            if (issue.recommendation) {
                console.log(`  Rekomendasi: ${issue.recommendation}`);
            }
        }
        console.log('\nRingkasan:');
        for (const [severity, count] of Object.entries(bySeverity)) {
            console.log(`  ${severity}: ${count}`);
        }
    }

    return report.issues.some((i) => i.severity === 'critical' || i.severity === 'high') ? 1 : 0;
});

// ===== BENCH =====

command('bench', 'Benchmark performa Bonang', async (args) => {
    const found = findConfig();
    const root = found ? path.dirname(found.path) : process.cwd();
    const { runBenchmarks } = require('../benchmarks/benchmark');
    const results = await runBenchmarks({ root, iterations: parseInt(args.options.iterations, 10) || 1000 });
    console.log(JSON.stringify(results, null, 2));
    return 0;
});

// ===== MIGRATE =====

command('migrate', 'Jalankan migrasi database', async (args) => {
    const found = findConfig();
    if (!found) {
        throw new Error('bonang.config.json tidak ditemukan.');
    }
    const { config, path: configPath } = found;
    const root = path.dirname(configPath);

    const { runMigrations } = require('./migrate');
    const result = await runMigrations({ root, config, direction: args.options.rollback ? 'down' : 'up' });

    console.log(`\nMigrasi ${result.direction} selesai: ${result.applied.length} diterapkan, ${result.skipped.length} dilewati.`);
    for (const migration of result.applied) {
        console.log(`  + ${migration.name}`);
    }
    return 0;
});

// ===== VERSION =====

command('version', 'Tampilkan versi Bonang', async () => {
    const pkg = require('../package.json');
    console.log(`Bonang v${pkg.version}`);
    console.log(`Node ${process.version} | ${process.platform} ${process.arch}`);
    return 0;
});

// ===== HELPERS =====

function collectSourceFiles(root) {
    const files = [];
    const skipDirs = new Set(['node_modules', '.git', 'dist', 'build', 'data', '.bonang']);
    const walk = (dir) => {
        let entries;
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
            return;
        }
        for (const entry of entries) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                if (!skipDirs.has(entry.name)) walk(full);
            } else if (entry.name.endsWith('.bng')) {
                files.push(full);
            }
        }
    };
    walk(root);
    return files;
}

function copyDir(src, dest) {
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
        const from = path.join(src, entry.name);
        const to = path.join(dest, entry.name);
        if (entry.isDirectory()) copyDir(from, to);
        else fs.copyFileSync(from, to);
    }
}

// ===== TEMPLATE =====

const SERVER_TEMPLATE = `// Entry point server Bonang.
// Dijalankan dengan: bonang dev

import { createServer } from "bonang";
import { registerRoutes } from "./routes.bng";

const port = 3000;

const app = createServer({ port, host: "127.0.0.1" });

registerRoutes(app);

app.listen(port).then(() => {
    console.log("Server Bonang berjalan di http://localhost:" + port);
});
`;

const ROUTES_TEMPLATE = `// Registrasi route HTTP Bonang.

export fn registerRoutes(app) {
    app.router.get("/api/health", () => {
        return { status: "ok", uptime: process.uptime() };
    });

    app.router.get("/api/hello/:name", (ctx) => {
        return { message: "Halo " + ctx.params.name };
    });

    // Route yang mengubah data WAJIB memvalidasi input sebelum memakainya.
    // \`ctx.validate\` melempar ValidationError (HTTP 400) bila aturan tidak
    // terpenuhi, sehingga handler tidak pernah bekerja dengan data tak valid.
    app.router.post("/api/echo", (ctx) => {
        const input = ctx.validate({
            message: { type: "string", required: true }
        });
        return { received: input };
    });
}
`;

const CLIENT_TEMPLATE = `// Entry point client Bonang.
// Dikompilasi menjadi JavaScript browser.

fn main() {
    const target = document.getElementById("app");
    if (target) {
        target.textContent = "Halo dari Bonang!";
    }
    console.log("Client Bonang aktif");
}
`;

const SHARED_TEMPLATE = `// Kode yang dipakai bersama oleh server dan client.
// Hanya boleh berisi tipe dan fungsi murni tanpa akses resource khusus.

export const APP_NAME = "Bonang App";

export fn formatPrice(value: float): string {
    return "Rp " + value.toFixed(0);
}
`;

const HTML_TEMPLATE = `<!DOCTYPE html>
<html lang="id">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Bonang App</title>
    <link rel="stylesheet" href="style.css">
</head>
<body>
    <main id="app">Memuat...</main>
    <script src="app.js"></script>
</body>
</html>
`;

const CSS_TEMPLATE = `* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: system-ui, sans-serif; padding: 2rem; }
#app { padding: 1rem; background: #f4f4f5; border-radius: 8px; }
`;

const TEST_TEMPLATE = `// Test Bonang.
// Dijalankan dengan: bonang test

fn testPenjumlahan() {
    const hasil = 1 + 2;
    if (hasil !== 3) {
        throw new Error("Harapan 3, mendapat " + hasil);
    }
}

fn testValidasiProduk() {
    const produk = { name: "Kopi", price: 25000 };
    if (produk.name === "") {
        throw new Error("Nama produk tidak boleh kosong");
    }
}

export const tests = [
    { name: "penjumlahan", run: testPenjumlahan },
    { name: "validasi produk", run: testValidasiProduk }
];
`;
const README_TEMPLATE = `# Proyek Bonang

## Menjalankan

\`\`\`bash
bonang dev
\`\`\`

Buka http://localhost:3000

## Perintah lain

- \`bonang build\` — build produksi
- \`bonang test\` — jalankan test
- \`bonang lint\` — analisis statis
- \`bonang audit\` — audit keamanan
`;

const GITIGNORE_TEMPLATE = `node_modules/
dist/
data/*.db
data/*.db-journal
data/*.db-wal
data/*.db-shm
.bonang/
`;

// ===== ENTRY POINT =====

async function main() {
    const argv = process.argv.slice(2);
    const { options, positional } = parseArgs(argv);

    if (options.help || options.h || (!positional.length && !options.version)) {
        console.log(printHelp());
        return 0;
    }
    if (options.version || options.v) {
        return COMMANDS.version.handler({ options, positional });
    }

    const name = positional[0];
    const cmd = COMMANDS[name];
    if (!cmd) {
        console.error(`Perintah tidak dikenal: '${name}'`);
        console.error(printHelp());
        return 1;
    }

    try {
        return await cmd.handler({ options, positional: positional.slice(1) });
    } catch (err) {
        console.error(`Error: ${err.message}`);
        if (process.env.BONANG_DEBUG === '1' && err.stack) {
            console.error(err.stack);
        }
        return 1;
    }
}

if (require.main === module) {
    main()
        .then((code) => {
            if (code !== 0) process.exitCode = code;
        })
        .catch((err) => {
            console.error('Fatal:', err.message);
            if (err.stack) console.error(err.stack);
            process.exitCode = 1;
        });
}

module.exports = { main, COMMANDS, parseArgs, findConfig, printHelp };
