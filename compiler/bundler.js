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
 *
 * Dua target, dengan aturan berbeda:
 *
 *  - `server` — dijalankan di Node. `require` apa adanya, modul Node
 *    bawaan boleh dipakai.
 *  - `client` — dijalankan di browser. `require` **tidak boleh**
 *    dipakai karena tidak ada di browser; modul runtime client
 *    di-inline-kan ke dalam bundel, dan modul Node bawaan ditolak
 *    saat bundling (bukan diam-diam gagal saat runtime).
 */

const RUNTIME_MODULE_ID = 'bonang';
const CLIENT_MODULE_ID = 'bonang/client';
const STD_MODULE_ID = 'bonang/std';

/**
 * Modul Node bawaan yang tidak boleh muncul di bundel browser.
 *
 * Daftar ini dipakai untuk menolak bundling client yang menarik
 * dependensi server-only. Menolak saat build jauh lebih baik daripada
 * melempar `require is not defined` di console browser.
 */
const NODE_BUILTIN_PATTERN = /^node:/;

/**
 * Nama global yang dipakai modul runtime client ketika di-inline-kan
 * ke dalam bundel browser.
 */
const CLIENT_RUNTIME_GLOBAL = '__bonangClient';

/**
 * Id modul internal untuk runtime client yang di-inline-kan ke bundel
 * browser. Berbeda dari id modul Bonang (`__bng_0`, `__bng_1`, ...) yang
 * diberi nomor urut.
 */
const CLIENT_RUNTIME_MODULE_ID = '__bng_client_runtime';

/**
 * Muat graf modul dari entry point.
 *
 * Graf modul bisa **siklik**: A mengimpor B, B mengimpor A. Traversal
 * naive (visit → visit → visit → ...) tidak pernah berhenti dan berakhir
 * dengan stack overflow. Modul yang sedang diproses ditandai lebih dulu
 * sehingga siklus dikenali dan tidak diulang.
 *
 * @returns {Map<string, {source: string, deps: Map<string,string>}>}
 */
function collectModules(entryPath, compiler) {
    const modules = new Map();

    const visit = (filePath, stack = []) => {
        const resolved = path.resolve(filePath);
        if (modules.has(resolved)) return resolved;

        // Modul sudah ada di stack Means sedang diproses — ini siklus.
        // Modul ini tetap akan dimasukkan ke peta modul, jadi tidak ada
        // rekursi tak terbatas.
        if (stack.includes(resolved)) {
            return resolved;
        }

        const source = fs.readFileSync(resolved, 'utf8');
        const ast = compiler.parse(source, resolved);
        const deps = new Map();

        // Daftarkan modul SEBELUM membaca dependensinya supaya modul
        // yang mengimpor modul ini (siklus) tidak memaksa traversal
        // tak terbatas.
        modules.set(resolved, { source, deps, path: resolved });

        for (const statement of ast.body) {
            if (statement.type === 'ImportDeclaration') {
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
                visit(target, [...stack, resolved]);
                continue;
            }

            // Dynamic import (`import("./x.bng")`) — path-nya harus literal
            // supaya bisa ditemukan saat build. Modul ikut dimuat ke bundel
            // dan panggilan ditulis ulang menjadi `__bngRequire`.
            const dynamic = collectDynamicImports(statement);
            for (const spec of dynamic) {
                if (isBareSpecifier(spec)) {
                    deps.set(spec, spec);
                    continue;
                }
                const target = resolveRelative(resolved, spec);
                if (!target) {
                    throw new Error(`Modul tidak ditemukan: ${spec} (dari ${resolved})`);
                }
                deps.set(spec, target);
                visit(target, [...stack, resolved]);
            }
        }

        return resolved;
    };

    visit(entryPath);
    return modules;
}

/**
 * Kumpulkan path dari ekspresi `import("...")` di dalam sebuah node AST.
 *
 * Path harus berupa string literal — kalau tidak, nilainya tidak bisa
 * diketahui saat build dan modul tidak bisa dimuat ke bundel.
 */
function collectDynamicImports(node, found = []) {
    if (!node || typeof node !== 'object') return found;

    if (node.type === 'ImportExpression') {
        const source = node.source;
        if (!source || source.type !== 'Literal' || typeof source.value !== 'string') {
            throw new Error(
                'import() hanya menerima string literal — path modul harus diketahui saat build'
            );
        }
        found.push(source.value);
    }

    for (const key of Object.keys(node)) {
        if (key === 'type' || key === 'line' || key === 'column') continue;
        const value = node[key];
        if (Array.isArray(value)) {
            for (const item of value) collectDynamicImports(item, found);
        } else if (value && typeof value === 'object') {
            collectDynamicImports(value, found);
        }
    }
    return found;
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
    const target = options.target || 'server';
    const isClient = target === 'client';
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
    parts.push(`// Bonang bundle — ${target}`);
    parts.push('(function () {');
    parts.push('var __bngModules = {};');
    parts.push('var __bngCache = {};');

    if (isClient) {
        // Loader browser: tidak ada `require` sama sekali. Modul runtime
        // client di-inline sebagai modul internal supaya frontend tidak
        // butuh file tambahan maupun loader eksternal.
        //
        // Modul didaftarkan ke cache SEBELUM factory-nya dijalankan, supaya
        // siklus modul (A -> B -> A) tidak menyebabkan rekursi tak
        // terbatas. Pada siklus, exports yang dikembalikan masih kosong —
        // sama seperti perilaku CommonJS.
        parts.push(`
function __bngRequire(id) {
    if (__bngCache[id]) return __bngCache[id].exports;
    var factory = __bngModules[id];
    if (!factory) throw new Error("Modul Bonang tidak ditemukan: " + id);
    var module = { exports: {} };
    __bngCache[id] = module;
    factory(module, module.exports);
    return module.exports;
}
`);
    } else {
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
    }

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
        code = rewriteRequires(code, info.deps, ids, isClient);

        // Dynamic import ditulis ulang menjadi pemanggilan loader internal.
        // Hasilnya tetap Promise, jadi kode sumber tidak perlu berubah.
        code = rewriteDynamicImports(code, info.deps, ids, isClient);

        if (isClient) {
            // Parameter `require` sengaja TIDAK diberikan di bundel
            // browser. Kalau ada modul yang masih memakainya, errornya
            // harus muncul saat build, bukan diam-diam saat runtime.
            parts.push(`__bngModules[${JSON.stringify(id)}] = function (module, exports) {`);
        } else {
            // Parameter `require` sengaja dibiarkan bernama `require` agar
            // modul yang membutuhkan modul Node bawaan tetap bekerja; modul
            // Bonang relatif diarahkan ke `__bngRequire`.
            parts.push(`__bngModules[${JSON.stringify(id)}] = function (module, exports, require) {`);
        }
        parts.push(code);
        parts.push('};');
    }

    // Modul runtime client di-inline-kan ke dalam bundel browser supaya
    // frontend cukup satu file: `client.js`.
    if (isClient) {
        parts.push(`__bngModules["${CLIENT_RUNTIME_MODULE_ID}"] = function (module, exports) {`);
        parts.push(readClientRuntimeSource());
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
            ${isClient ? '' : 'process.exitCode = 1;'}
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
 *
 * Untuk target `client`, `require` tidak boleh muncul sama sekali —
 * browser tidak memilikinya. Karena itu modul runtime client diarahkan
 * ke modul internal yang di-inline-kan, dan modul Node bawaan
 * **ditolak** dengan pesan yang jelas.
 */
function rewriteRequires(code, deps, ids, isClient = false) {
    return code.replace(/require\((['"])([^'"]+)\1\)/g, (match, quote, spec) => {
        const target = deps.get(spec);
        if (!target) {
            if (isClient) {
                throw new Error(
                    `Modul '${spec}' tidak bisa dipakai di bundel browser. ` +
                    `Frontend tidak punya akses modul Node.`
                );
            }
            return match;
        }

        if (isBareSpecifier(spec)) {
            if (isClient) {
                // Runtime client di-inline-kan ke bundel, bukan file terpisah.
                if (spec === CLIENT_MODULE_ID) {
                    return `__bngRequire(${JSON.stringify(CLIENT_RUNTIME_MODULE_ID)})`;
                }
                if (NODE_BUILTIN_PATTERN.test(spec)) {
                    throw new Error(
                        `Modul Node '${spec}' tidak boleh dipakai di bundel browser. ` +
                        `Pindahkan logika ini ke sisi server.`
                    );
                }
                // Modul runtime server dan standard library tidak tersedia
                // di browser; tolak dengan jelas daripada gagal saat runtime.
                if (spec === RUNTIME_MODULE_ID || spec === STD_MODULE_ID) {
                    throw new Error(
                        `Modul '${spec}' hanya tersedia di server. ` +
                        `Frontend tidak boleh mengimpornya.`
                    );
                }
                throw new Error(
                    `Paket '${spec}' tidak bisa dipakai di bundel browser. ` +
                    `Bundel frontend hanya boleh memakai modul Bonang relatif ` +
                    `dan modul 'bonang/client'.`
                );
            }

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
 * Tulis ulang dynamic import menjadi pemanggilan loader internal bundel.
 *
 * `_$$dynamicImport("./x.bng")` menjadi
 * `Promise.resolve(__bngRequire("__bng_3"))` supaya modul yang diimpor
 * secara dinamis ikut terisi di dalam bundel.
 */
function rewriteDynamicImports(code, deps, ids, isClient = false) {
    return code.replace(/_\$\$dynamicImport\((['"])([^'"]+)\1\)/g, (match, quote, spec) => {
        const target = deps.get(spec);
        if (!target) {
            if (isClient) {
                throw new Error(
                    `Modul '${spec}' tidak bisa dipakai di bundel browser. ` +
                    `Frontend tidak punya akses modul Node.`
                );
            }
            return match;
        }

        if (isBareSpecifier(spec)) {
            if (isClient) {
                if (spec === CLIENT_MODULE_ID) {
                    return `Promise.resolve(__bngRequire(${JSON.stringify(CLIENT_RUNTIME_MODULE_ID)}))`;
                }
                if (NODE_BUILTIN_PATTERN.test(spec)) {
                    throw new Error(
                        `Modul Node '${spec}' tidak boleh dipakai di bundel browser. ` +
                        `Pindahkan logika ini ke sisi server.`
                    );
                }
                throw new Error(
                    `Paket '${spec}' tidak bisa dipakai di bundel browser. ` +
                    `Bundel frontend hanya boleh memakai modul Bonang relatif ` +
                    `dan modul 'bonang/client'.`
                );
            }
            if (spec === RUNTIME_MODULE_ID) return 'Promise.resolve(require("./bonang-runtime.js"))';
            if (spec === CLIENT_MODULE_ID) return 'Promise.resolve(require("./bonang-client.js"))';
            if (spec === STD_MODULE_ID) return 'Promise.resolve(require("./bonang-std.js"))';
            return match;
        }

        const id = ids.get(target);
        return id ? `Promise.resolve(__bngRequire(${JSON.stringify(id)}))` : match;
    });
}

/**
 * Baca sumber runtime client untuk di-inline-kan ke bundel browser.
 *
 * Runtime client ditulis sebagai UMD: `module.exports = factory()` bila
 * ada `module`, selain itu pasang ke global. Karena bundel browser
 * membungkus kode sebagai `function (module, exports) { ... }`, cabang
 * CommonJS-nya yang dipakai — jadi `module.exports` terisi dengan objek
 * runtime tanpa perlu perubahan apa pun pada berkasnya.
 */
function readClientRuntimeSource() {
    const clientPath = path.resolve(__dirname, '../runtime/client/client.js');
    if (!fs.existsSync(clientPath)) {
        throw new Error(`Runtime client tidak ditemukan: ${clientPath}`);
    }
    return fs.readFileSync(clientPath, 'utf8');
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

module.exports = {
    bundle,
    collectModules,
    resolveRelative,
    copyRuntime,
    rewriteRequires,
    rewriteDynamicImports,
    collectDynamicImports,
    readClientRuntimeSource,
    CLIENT_RUNTIME_MODULE_ID
};
