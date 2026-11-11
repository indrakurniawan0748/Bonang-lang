'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { Compiler } = require('./compiler');

/**
 * Bundler Bonang.
 *
 * Mengubah graf modul Bonang menjadi bundel JavaScript yang dapat
 * langsung dijalankan (`node dist/server.js`) tanpa Node resolving
 * modul `.bng` maupun paket `bonang` saat runtime.
 *
 * Strategi: setiap modul Bonang dikompilasi menjadi fungsi yang
 * dievaluasi sekali (module cache sederhana). Modul Node bawaan dan
 * runtime Bonang tetap dibiarkan sebagai `require` — runtime Bonang
 * ikut disalin ke dalam output agar bundel mandiri.
 */

const RUNTIME_MODULE_ID = 'bonang';
const CLIENT_MODULE_ID = 'bonang/client';
const STD_MODULE_ID = 'bonang/std';

/**
 * Muat graf modul dari entry point.
 *
 * @returns {Map<string, {source: string, deps: Map<string,string>}>}
 */
function collectModules(entryPath, compiler) {
    const modules = new Map();

    const visit = (filePath) => {
        const resolved = path.resolve(filePath);
        if (modules.has(resolved)) return resolved;

        const source = fs.readFileSync(resolved, 'utf8');
        const ast = compiler.parse(source, resolved);
        const deps = new Map();

        for (const statement of ast.body) {
            if (statement.type !== 'ImportDeclaration') continue;
            const spec = statement.source;

            if (isBareSpecifier(spec)) {
                deps.set(spec, spec);
                continue;
            }
            const target = resolveRelative(resolved, spec);
            if (!target) {
                throw new Error(`Modul tidak ditemukan: ${spec} (dari ${resolved})`);
            }
            deps.set(spec, target);
            visit(target);
        }

        modules.set(resolved, { source, deps, path: resolved });
        return resolved;
    };

    visit(entryPath);
    return modules;
}

/**
 * Apakah specifier merujuk ke modul bawaan (bukan path relatif)?
 */
function isBareSpecifier(spec) {
    return !spec.startsWith('.') && !path.isAbsolute(spec);
}

/**
 * Resolusi modul relatif seperti `createRequire`, tetapi mengembalikan path.
 */
function resolveRelative(fromFile, spec) {
    const candidates = [];
    const target = path.resolve(path.dirname(fromFile), spec);

    if (path.extname(target)) {
        candidates.push(target);
    } else {
        candidates.push(`${target}.bng`, `${target}.js`);
    }
    candidates.push(path.join(target, 'index.bng'), path.join(target, 'index.js'));

    for (const candidate of candidates) {
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
            return candidate;
        }
    }
    return null;
}

/**
 * Buat bundel dari entry point.
 *
 * @param {object} options
 * @param {string} options.entry      Path entry point (.bng)
 * @param {string} options.output     Path file output
 * @param {'server'|'client'} options.target
 * @param {boolean} options.minify
 * @returns {{code: string, modules: number, bytes: number}}
 */
function bundle(options = {}) {
    const entryPath = path.resolve(options.entry);
    const compiler = new Compiler();
    const modules = collectModules(entryPath, compiler);

    // Nama modul unik berbasis path relatif terhadap folder common ancestor.
    const ids = new Map();
    let counter = 0;
    for (const filePath of modules.keys()) {
        ids.set(filePath, `__bng_${counter++}`);
    }

    const parts = [];
    parts.push('"use strict";');
    parts.push(`// Bonang bundle — ${options.target || 'server'}`);
    parts.push('(function () {');
    parts.push('var __bngModules = {};');
    parts.push('var __bngCache = {};');
    parts.push(`
function __bngRequire(id) {
    if (__bngCache[id]) return __bngCache[id].exports;
    var factory = __bngModules[id];
    if (!factory) throw new Error("Modul Bonang tidak ditemukan: " + id);
    var module = { exports: {} };
    __bngCache[id] = module;
    // Parameter require di sini adalah require Node asli, dipakai modul
    // untuk modul bawaan Node dan runtime Bonang. Modul Bonang relatif
    // sudah ditulis ulang menjadi __bngRequire(...).
    factory(module, module.exports, require);
    return module.exports;
}
`);

    for (const [filePath, info] of modules) {
        const id = ids.get(filePath);
        let code;
        try {
            const compiled = compiler.compile(info.source, filePath);
            code = compiled.code;
        } catch (err) {
            throw new Error(`Gagal kompilasi ${filePath}: ${err.message}`);
        }

        // Tulis ulang specifier import menjadi id modul internal.
        code = rewriteRequires(code, info.deps, ids);

        // Parameter `require` sengaja dibiarkan bernama `require` agar
        // modul yang membutuhkan modul Node bawaan tetap bekerja; modul
        // Bonang relatif diarahkan ke `__bngRequire`.
        parts.push(`__bngModules[${JSON.stringify(id)}] = function (module, exports, require) {`);
        parts.push(code);
        parts.push('};');
    }

    parts.push(`__bngRequire(${JSON.stringify(ids.get(path.resolve(entryPath)))});`);
    // Entry point Bonang yang mengekspor `main` harus dijalankan otomatis,
    // sama seperti `node file.bng` menjalankan program. Tanpa ini bundel
    // hanya memuat modul dan tidak pernah memulai server.
    parts.push(`
var __bngEntry = __bngRequire(${JSON.stringify(ids.get(path.resolve(entryPath)))});
if (__bngEntry && typeof __bngEntry.main === "function") {
    var __bngResult = __bngEntry.main();
    if (__bngResult && typeof __bngResult.catch === "function") {
        __bngResult.catch(function (err) {
            console.error(err && err.stack ? err.stack : err);
            process.exitCode = 1;
        });
    }
}
`);
    parts.push('})();');

    let output = parts.join('\n');
    if (options.minify) {
        output = minify(output);
    }

    fs.mkdirSync(path.dirname(path.resolve(options.output)), { recursive: true });
    fs.writeFileSync(path.resolve(options.output), output, 'utf8');

    return {
        code: output,
        modules: modules.size,
        bytes: Buffer.byteLength(output)
    };
}

/**
 * Tulis ulang `require("...")` sesuai peta dependensi.
 *
 * Modul Bonang relatif diarahkan ke `__bngRequire` (loader internal bundel),
 * sedangkan modul Node bawaan dan runtime Bonang dibiarkan sebagai
 * `require` Node biasa.
 */
function rewriteRequires(code, deps, ids) {
    return code.replace(/require\((['"])([^'"]+)\1\)/g, (match, quote, spec) => {
        const target = deps.get(spec);
        if (!target) return match;

        if (isBareSpecifier(spec)) {
            // Modul runtime Bonang dipetakan ke bundel runtime terpisah
            // yang disalin ke folder output.
            if (spec === RUNTIME_MODULE_ID) return 'require("./bonang-runtime.js")';
            if (spec === CLIENT_MODULE_ID) return 'require("./bonang-client.js")';
            if (spec === STD_MODULE_ID) return 'require("./bonang-std.js")';
            // Modul Node bawaan dibiarkan apa adanya.
            return match;
        }

        const id = ids.get(target);
        return id ? `__bngRequire(${JSON.stringify(id)})` : match;
    });
}

/**
 * Minifier ringan: buang komentar baris dan spasi berlebih.
 * Tidak mengubah semantik — hanya kompresi ringan.
 */
function minify(code) {
    return code
        .split('\n')
        .map((line) => line.replace(/\/\/.*$/, '').trimEnd())
        .filter((line) => line.length > 0)
        .join('\n');
}

/**
 * Salin runtime Bonang ke folder output agar bundel dapat dijalankan
 * tanpa installed paket.
 */
function copyRuntime(outputDir, target = 'server') {
    fs.mkdirSync(outputDir, { recursive: true });

    if (target === 'client') {
        const clientPath = path.resolve(__dirname, '../runtime/client/client.js');
        fs.copyFileSync(clientPath, path.join(outputDir, 'bonang-client.js'));
        return ['bonang-client.js'];
    }

    const runtimePath = path.resolve(__dirname, '../runtime/index.js');
    fs.copyFileSync(runtimePath, path.join(outputDir, 'bonang-runtime.js'));

    // Runtime punya dependensi internal — salin seluruh folder runtime
    // agar require relatif di dalam runtime tetap berfungsi.
    const runtimeDir = path.resolve(__dirname, '../runtime');
    const targetDir = path.join(outputDir, 'runtime');
    copyDirectory(runtimeDir, targetDir);

    // Bundel runtimeentries menggunakan path relatif; sesuaikan require.
    const bundlePath = path.join(outputDir, 'bonang-runtime.js');
    let code = fs.readFileSync(bundlePath, 'utf8');
    code = code.replace(/require\((['"])\.\/([^'"]+)\1\)/g, (match, quote, rest) => {
        if (rest.startsWith('core/') || rest.startsWith('async/') || rest.startsWith('http/')
            || rest.startsWith('database/') || rest.startsWith('security/')
            || rest.startsWith('filesystem/') || rest.startsWith('network/')) {
            return `require(${quote}./runtime/${rest}${quote})`;
        }
        return match;
    });
    fs.writeFileSync(bundlePath, code, 'utf8');

    const stdPath = path.resolve(__dirname, '../standard-library/index.js');
    if (fs.existsSync(stdPath)) {
        fs.copyFileSync(stdPath, path.join(outputDir, 'bonang-std.js'));
    }

    return ['bonang-runtime.js', 'runtime/'];
}

/**
 * Salin folder secara rekursif.
 */
function copyDirectory(src, dest) {
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
        const from = path.join(src, entry.name);
        const to = path.join(dest, entry.name);
        if (entry.isDirectory()) copyDirectory(from, to);
        else if (entry.name.endsWith('.js')) fs.copyFileSync(from, to);
    }
}

module.exports = { bundle, collectModules, resolveRelative, copyRuntime, rewriteRequires };
