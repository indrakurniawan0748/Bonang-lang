'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { Compiler } = require('../compiler/compiler');

/**
 * Benchmark Bonang.
 *
 * Mengukur beberapa skenario yang relevan untuk bahasa full-stack:
 *  - kompilasi (lexer → parser → codegen)
 *  - eksekusi fungsi murni (throughput)
 *  - query database (insert + select)
 *  - request HTTP (latency & concurrency)
 *
 * Setiap skenario dijalankan beberapa kali; hasil yang dilaporkan adalah
 * median agar noise mesin tidak mendominasi kesimpulan.
 */

const DEFAULT_ITERATIONS = 1000;

/**
 * Hitung statistik dasar dari array durasi (ms).
 */
function stats(samples) {
    const sorted = [...samples].sort((a, b) => a - b);
    const at = (p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
    const sum = sorted.reduce((a, b) => a + b, 0);
    return {
        samples: sorted.length,
        min: round(sorted[0]),
        p50: round(at(0.5)),
        p95: round(at(0.95)),
        p99: round(at(0.99)),
        max: round(sorted[sorted.length - 1]),
        mean: round(sum / sorted.length)
    };
}

function round(value) {
    return Math.round(value * 1000) / 1000;
}

/**
 * Benchmark kompilasi source Bonang.
 */
async function benchCompile(source, iterations, rounds = 5) {
    const compiler = new Compiler();
    const samples = [];
    for (let r = 0; r < rounds; r++) {
        const start = process.hrtime.bigint();
        for (let i = 0; i < iterations; i++) {
            compiler.compile(source, 'bench.bng');
        }
        const end = process.hrtime.bigint();
        samples.push(Number(end - start) / 1e6);
    }
    const perOp = stats(samples);
    return {
        scenario: 'compile',
        unit: 'ms per batch',
        iterations,
        ...perOp,
        opsPerSecond: Math.round(iterations / ((perOp.mean || 1) / 1000))
    };
}

/**
 * Benchmark eksekusi fungsi Bonang yang dikompilasi.
 */
async function benchExecution(source, iterations, rounds = 5) {
    const compiler = new Compiler();
    const result = compiler.compile(source, 'bench.bng');
    const moduleObj = { exports: {} };
    const { createRequire } = require('../compiler/compiler');
    const fn = new Function('module', 'exports', 'require', '__filename', '__dirname', result.code);
    fn(moduleObj, moduleObj.exports, createRequire('bench.bng'), path.resolve('bench.bng'), process.cwd());

    const work = moduleObj.exports.bench;
    if (typeof work !== 'function') {
        throw new Error('Benchmark membutuhkan ekspor `bench` berupa fungsi');
    }

    const samples = [];
    for (let r = 0; r < rounds; r++) {
        const start = process.hrtime.bigint();
        for (let i = 0; i < iterations; i++) {
            work(i);
        }
        const end = process.hrtime.bigint();
        samples.push(Number(end - start) / 1e6);
    }
    const perOp = stats(samples);
    return {
        scenario: 'execution',
        unit: 'ms per batch',
        iterations,
        ...perOp,
        opsPerSecond: Math.round(iterations / ((perOp.mean || 1) / 1000))
    };
}

/**
 * Benchmark query SQLite: bulk insert lalu select.
 */
async function benchDatabase(iterations, rounds = 3) {
    const { SQLitePool } = require('../runtime/database/pool');
    const os = require('node:os');
    const file = path.join(os.tmpdir(), `bonang-bench-${process.pid}-${Date.now()}.db`);
    const pool = new SQLitePool({ filename: file });

    try {
        await pool.execute(`CREATE TABLE bench (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            value REAL NOT NULL
        )`);

        const insertSamples = [];
        for (let r = 0; r < rounds; r++) {
            const start = process.hrtime.bigint();
            for (let i = 0; i < iterations; i++) {
                await pool.execute('INSERT INTO bench (name, value) VALUES (?, ?)', [`row-${i}`, i * 1.5]);
            }
            const end = process.hrtime.bigint();
            insertSamples.push(Number(end - start) / 1e6);
        }

        const selectSamples = [];
        for (let r = 0; r < rounds; r++) {
            const start = process.hrtime.bigint();
            for (let i = 0; i < Math.min(iterations, 500); i++) {
                await pool.query('SELECT * FROM bench WHERE name = ?', [`row-${i}`]);
            }
            const end = process.hrtime.bigint();
            selectSamples.push(Number(end - start) / 1e6);
        }

        const insert = stats(insertSamples);
        const select = stats(selectSamples);
        return {
            scenario: 'database',
            iterations,
            insert: { ...insert, opsPerSecond: Math.round(iterations / ((insert.mean || 1) / 1000)) },
            select: { ...select, opsPerSecond: Math.round(Math.min(iterations, 500) / ((select.mean || 1) / 1000)) }
        };
    } finally {
        await pool.close();
        for (const suffix of ['', '-wal', '-shm']) {
            try {
                fs.rmSync(file + suffix, { force: true });
            } catch {
                // abaikan
            }
        }
    }
}

/**
 * Benchmark HTTP: request berurutan dan batch concurrently.
 */
async function benchHttp(iterations, rounds = 3) {
    const { Server } = require('../runtime/http/server');

    const server = new Server({ port: 0, host: '127.0.0.1' });
    server.router.get('/ping', (ctx) => ({ pong: true }));
    server.router.get('/slow', async (ctx) => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        return { ok: true };
    });

    await server.listen(0);
    const address = server.address();
    const base = `http://127.0.0.1:${address.port}`;

    /**
     * Request yang body-nya selalu dikonsumsi. Bila body tidak dibaca,
     * koneksi tetap terbuka dan `server.close()` tidak pernah selesai.
     */
    const ping = async () => {
        const response = await fetch(`${base}/ping`);
        await response.text();
    };

    try {
        const sequential = [];
        for (let r = 0; r < rounds; r++) {
            const start = process.hrtime.bigint();
            for (let i = 0; i < Math.min(iterations, 300); i++) {
                await ping();
            }
            const end = process.hrtime.bigint();
            sequential.push(Number(end - start) / 1e6);
        }

        const concurrency = [];
        const batchSize = 50;
        for (let r = 0; r < rounds; r++) {
            const start = process.hrtime.bigint();
            const tasks = [];
            for (let i = 0; i < batchSize; i++) {
                tasks.push(ping());
            }
            await Promise.all(tasks);
            const end = process.hrtime.bigint();
            concurrency.push(Number(end - start) / 1e6);
        }

        // Uji bahwa request lambat tidak memblokir request cepat.
        const mixedStart = process.hrtime.bigint();
        const slow = fetch(`${base}/slow`).then((r) => r.text());
        const fast = await ping();
        const fastMs = Number(process.hrtime.bigint() - mixedStart) / 1e6;
        await slow;

        return {
            scenario: 'http',
            sequential: { ...stats(sequential), requests: Math.min(iterations, 300) },
            concurrent: { ...stats(concurrency), requests: batchSize },
            nonBlockingCheck: {
                fastRequestMs: round(fastMs),
                passed: fastMs < 200,
                note: 'Request cepat harus selesai jauh sebelum request lambat (20ms) selesai'
            }
        };
    } finally {
        await server.close();
    }
}

/**
 * Benchmark Bonang vs PHP vs Node (baseline pembanding).
 *
 * PHP hanya dijalankan bila binary `php` tersedia di PATH; bila tidak,
 * bagian PHP dilewati dan dicatat sebagai tidak tersedia — bukan diestimasi.
 */
async function benchBaselines(iterations) {
    const results = {};
    const compiler = new Compiler();

    // --- Node baseline: fungsi murni setara ---
    const nodeSource = `
        function work(i) {
            let total = 0;
            for (let k = 0; k < 50; k++) total += (i + k) * 0.5;
            return total;
        }
        module.exports.bench = work;
    `;
    const nodeSamples = [];
    const nodeFn = new Function('module', 'exports', nodeSource);
    const nodeModule = { exports: {} };
    nodeFn(nodeModule, nodeModule.exports);
    for (let r = 0; r < 5; r++) {
        const start = process.hrtime.bigint();
        for (let i = 0; i < iterations; i++) nodeModule.exports.bench(i);
        nodeSamples.push(Number(process.hrtime.bigint() - start) / 1e6);
    }
    results.node = { ...stats(nodeSamples), opsPerSecond: Math.round(iterations / ((stats(nodeSamples).mean || 1) / 1000)) };

    // --- Bonang: fungsi setara ---
    const bonangSource = `
export fn bench(i: int): float {
    let total = 0;
    for (let k = 0; k < 50; k++) {
        total = total + (i + k) * 0.5;
    }
    return total;
}
`;
    const compiled = compiler.compile(bonangSource, 'bench.bng');
    const modObj = { exports: {} };
    const fn = new Function('module', 'exports', 'require', '__filename', '__dirname', compiled.code);
    fn(modObj, modObj.exports, require, path.resolve('bench.bng'), process.cwd());
    const bonangSamples = [];
    for (let r = 0; r < 5; r++) {
        const start = process.hrtime.bigint();
        for (let i = 0; i < iterations; i++) modObj.exports.bench(i);
        bonangSamples.push(Number(process.hrtime.bigint() - start) / 1e6);
    }
    results.bonang = { ...stats(bonangSamples), opsPerSecond: Math.round(iterations / ((stats(bonangSamples).mean || 1) / 1000)) };

    // --- PHP baseline: hanya bila php tersedia ---
    const phpAvailable = await hasPhp();
    if (phpAvailable) {
        const phpFile = path.join(require('node:os').tmpdir(), `bonang-bench-${process.pid}.php`);
        fs.writeFileSync(phpFile, `<?php
function bench($i) {
    $total = 0;
    for ($k = 0; $k < 50; $k++) { $total += ($i + $k) * 0.5; }
    return $total;
}
$t = microtime(true);
for ($x = 0; $x < ${iterations}; $x++) { bench($x); }
echo (microtime(true) - $t) * 1000;
`, 'utf8');
        const { execFile } = require('node:child_process');
        const phpMs = await new Promise((resolve) => {
            execFile('php', [phpFile], (err, stdout) => {
                resolve(err ? null : parseFloat(stdout));
            });
        });
        fs.rmSync(phpFile, { force: true });
        if (phpMs !== null && !Number.isNaN(phpMs)) {
            results.php = {
                samples: 1,
                mean: round(phpMs),
                opsPerSecond: Math.round(iterations / ((phpMs || 1) / 1000)),
                note: 'Diukur satu kali pada interpreter PHP (startup tidak dihitung)'
            };
        } else {
            results.php = { unavailable: true, reason: 'Perintah php gagal dijalankan' };
        }
    } else {
        results.php = { unavailable: true, reason: 'Binary php tidak tersedia di PATH' };
    }

    // Rasio perbandingan.
    if (results.node?.opsPerSecond && results.bonang?.opsPerSecond) {
        results.comparison = {
            bonangVsNode: round(results.bonang.opsPerSecond / results.node.opsPerSecond),
            interpretation: 'Rasio > 1 berarti Bonang lebih throughput pada skenario ini'
        };
    }

    return results;
}

/**
 * Cek apakah binary php tersedia.
 */
async function hasPhp() {
    const { execFile } = require('node:child_process');
    return new Promise((resolve) => {
        execFile('php', ['-v'], (err) => resolve(!err));
    });
}

/**
 * Jalankan seluruh skenario benchmark.
 */
async function runBenchmarks(options = {}) {
    const iterations = options.iterations || DEFAULT_ITERATIONS;
    const source = options.source || BENCH_SOURCE;

    const results = {
        node: process.version,
        platform: `${process.platform} ${process.arch}`,
        iterations,
        at: new Date().toISOString(),
        scenarios: {}
    };

    results.scenarios.compile = await benchCompile(source, Math.min(iterations, 200));
    results.scenarios.execution = await benchExecution(source, iterations);
    results.scenarios.database = await benchDatabase(Math.min(iterations, 500));
    results.scenarios.http = await benchHttp(iterations);
    results.baselines = await benchBaselines(iterations);

    return results;
}

/**
 * Source Bonang yang dipakai sebagai workload benchmark.
 */
const BENCH_SOURCE = `
export fn bench(i: int): float {
    let total = 0;
    for (let k = 0; k < 50; k++) {
        total = total + (i + k) * 0.5;
    }
    return total;
}
`;

module.exports = { runBenchmarks, benchCompile, benchExecution, benchDatabase, benchHttp, benchBaselines, stats };
