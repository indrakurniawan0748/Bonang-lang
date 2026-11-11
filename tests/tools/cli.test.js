'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

const CLI = path.join(__dirname, '..', '..', 'cli', 'cli.js');

// ===== PEMBANTU =====

/**
 * Jalankan perintah CLI dan kembalikan stdout, stderr, dan exit code.
 */
function runCli(args, cwd) {
    const result = spawnSync(process.execPath, [CLI, ...args], {
        cwd,
        encoding: 'utf8',
        timeout: 120000
    });
    return {
        stdout: result.stdout || '',
        stderr: result.stderr || '',
        code: result.status
    };
}

/**
 * Buat proyek Bonang baru di folder sementara dan kembalikan path-nya.
 */
function makeProject() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bonang-cli-'));
    const result = runCli(['init', 'demo'], root);
    assert.strictEqual(result.code, 0, `init gagal: ${result.stderr}`);
    const project = path.join(root, 'demo');
    assert.ok(fs.existsSync(project), 'folder proyek harus dibuat');
    return { root, project };
}

/**
 * Jalankan server proyek di background dan kembalikan handle untuk dihentikan.
 *
 * `stop()` harus ditunggu sampai proses benar-benar mati, kalau tidak
 * folder proyek masih terkunci dan test runner menggantung.
 */
function startServer(project) {
    const child = spawn(process.execPath, [CLI, 'run', path.join(project, 'src', 'server', 'main.bng')], {
        cwd: project,
        stdio: ['ignore', 'pipe', 'pipe']
    });

    let output = '';
    child.stdout.on('data', (d) => { output += d.toString(); });
    child.stderr.on('data', (d) => { output += d.toString(); });

    const exited = new Promise((resolve) => {
        child.once('exit', resolve);
    });

    return {
        child,
        output: () => output,
        async stop() {
            if (child.exitCode !== null || child.signalCode !== null) return;
            child.kill();
            await exited;
        }
    };
}

async function waitForPort(server, timeoutMs = 15000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const match = server.output().match(/listening di (http:\/\/[\d.]+:(\d+))/);
        if (match) return Number(match[2]);
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`Server tidak pernah siap. Output:\n${server.output()}`);
}

// ===== TESTS =====

test('cli: init membuat proyek Bonang yang lengkap', (t) => {
    const { root, project } = makeProject();
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));

    const wajib = [
        'bonang.config.json',
        'src/server/main.bng',
        'src/server/routes.bng',
        'src/client/main.bng',
        'src/shared/types.bng',
        'public/index.html',
        'tests/app.test.bng'
    ];

    for (const file of wajib) {
        assert.ok(fs.existsSync(path.join(project, file)), `${file} harus ada`);
    }
});

test('cli: scaffold yang dihasilkan audit statis bersih', (t) => {
    const { root, project } = makeProject();
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));

    const result = runCli(['audit'], project);

    assert.strictEqual(result.code, 0,
        `audit harus bersih pada scaffold, tapi keluar dengan kode ${result.code}:\n${result.stdout}`);
    assert.match(result.stdout, /Masalah ditemukan: 0/);
});

test('cli: scaffold yang dihasilkan lint tanpa error', (t) => {
    const { root, project } = makeProject();
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));

    const result = runCli(['lint'], project);

    assert.strictEqual(result.code, 0, `lint harus lulus:\n${result.stdout}`);
    assert.doesNotMatch(result.stdout, /\berror\b/i);
});

test('cli: bonang test menjalankan test .test.bng di proyek', (t) => {
    const { root, project } = makeProject();
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));

    const result = runCli(['test'], project);

    assert.strictEqual(result.code, 0, `test harus lulus:\n${result.stdout}`);
    assert.match(result.stdout, /2 lulus, 0 gagal/);
});

test('cli: bonang build membundle server dan client', (t) => {
    const { root, project } = makeProject();
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));

    const result = runCli(['build'], project);

    assert.strictEqual(result.code, 0, `build harus lulus:\n${result.stdout}`);
    assert.ok(fs.existsSync(path.join(project, 'dist', 'server.js')), 'server.js harus dibuat');
    assert.ok(fs.existsSync(path.join(project, 'dist', 'client.js')), 'client.js harus dibuat');
});

test('cli: scaffold menolak input POST yang tidak valid dengan 400', async (t) => {
    const { root, project } = makeProject();

    const server = startServer(project);
    // Server dihentikan lebih dulu supaya folder proyek tidak terkunci
    // saat cleanup. Urutan hook `after` adalah LIFO, jadi hook yang
    // didaftarkan terakhir berjalan paling dulu.
    t.after(async () => {
        await server.stop();
        fs.rmSync(root, { recursive: true, force: true });
    });

    const port = await waitForPort(server);
    const base = `http://127.0.0.1:${port}`;

    // Body valid -> 200.
    const ok = await fetch(`${base}/api/echo`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: 'halo' })
    });
    assert.strictEqual(ok.status, 200);
    const okBody = await ok.json();
    assert.strictEqual(okBody.received.message, 'halo');

    // Field wajib hilang -> 400 dengan kontrak error yang konsisten.
    const bad = await fetch(`${base}/api/echo`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ other: 1 })
    });
    assert.strictEqual(bad.status, 400);
    const badBody = await bad.json();
    assert.strictEqual(badBody.status, 'error');
    assert.strictEqual(badBody.error, 'VALIDATION_ERROR');
    assert.ok(badBody.msg, 'pesan error harus ada');
});
