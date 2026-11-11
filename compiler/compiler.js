'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { parse } = require('./parser/parser');
const { generate } = require('./codegen/generator');
const { CompilerError } = require('./lexer/lexer');

/**
 * Ekspor entry point otomatis. Dipasang setelah kode program sehingga
 * deklarasi `main` selalu tersedia saat baris ini dieksekusi.
 */
const ENTRY_POINT_EXPORT = `if (typeof main === 'function' && !module.exports.main) {
    module.exports.main = main;
}`;

/**
 * Compiler Bonang.
 *
 * Pipeline: Source → Lexer → Parser → AST → Code Generator → JavaScript.
 *
 * Bonang dipilih memakai arsitektur transpiler: source Bonang dikompilasi
 * menjadi JavaScript yang langsung dieksekusi oleh engine V8. Pilihan ini
 * memberi startup cepat, reuse optimizer/runtime V8 yang sudah matang, dan
 * memungkinkan satu bahasa dipakai untuk frontend (browser) maupun backend
 * (Node.js) tanpadua runtime terpisah.
 */
class Compiler {
    constructor(options = {}) {
        this.options = options;
    }

    /**
     * Kompilasi source Bonang menjadi kode JavaScript.
     *
     * @param {string} source
     * @param {object} options
     * @returns {{code: string, helpers: string[], imports: object[], exportedNames: string[]}}
     */
    compile(source, file = '<input>') {
        const ast = this.parse(source, file);
        return this.generate(ast, file);
    }

    parse(source, file = '<input>') {
        return parse(source, file);
    }

    generate(ast, file = '<input>') {
        const result = generate(ast, { ...this.options, file });
        const parts = [];
        if (result.helpers.length) {
            parts.push(result.helpers.join('\n\n'));
        }
        parts.push(result.code);
        // Entry point `main` diekspor otomatis bila ada, sehingga runner
        // dapat memanggilnya tanpa perlu `export` eksplisit.
        parts.push(ENTRY_POINT_EXPORT);
        result.code = parts.join('\n\n');
        return result;
    }

    /**
     * Kompilasi file Bonang dan tulis hasilnya ke disk.
     */
    compileFile(inputPath, outputPath) {
        const source = fs.readFileSync(inputPath, 'utf8');
        const result = this.compile(source, inputPath);
        fs.mkdirSync(path.dirname(outputPath), { recursive: true });
        fs.writeFileSync(outputPath, result.code, 'utf8');
        return result;
    }

    /**
     * Kompilasi source dan eksekusi langsung, mengembalikan nilai ekspor modul.
     */
    run(source, file = '<input>', extraGlobals = {}) {
        const result = this.compile(source, file);
        const moduleObj = { exports: {} };
        const fn = new Function('module', 'exports', 'require', '__filename', '__dirname', result.code);
        fn(moduleObj, moduleObj.exports, createRequire(file), path.resolve(file), path.dirname(path.resolve(file)));

        // Fungsi `main` dipanggil otomatis bila ada —.entry point bahasa.
        if (typeof moduleObj.exports.main === 'function') {
            return moduleObj.exports.main();
        }
        return moduleObj.exports;
    }
}

/**
 *Buat fungsi `require` sederhana yang hanya mendukung modul Bonang
 * dan modul Node bawaan.
 *
 * **Siklus modul**
 * ---------------
 * Modul Bonang boleh mengimpor modul yang (langsung atau tak langsung)
 * mengimpornya kembali. Tanpa penanganan khusus, A → B → A menyebabkan
 * rekursi tak terbatas dan berakhir dengan stack overflow.
 *
 * Modul yang sedang dievaluasi dimasukkan ke cache **sebelum** body-nya
 * dieksekusi. Ketika siklus terjadi, `require` untuk modul yang sedang
 * dievaluasi mengembalikan `module.exports` yang masih kosong — persis
 * seperti perilaku CommonJS di Node. Modul yang memakai nilai dari
 * modul siklik harus mengambilnya saat runtime (bukan saat import di
 * tingkat atas), yang memang satu-satunya cara yang benar.
 *
 * Cache diwariskan ke modul anak (`createRequire(resolved, cache)`),
 * sehingga satu siklus dikenali sebagai satu siklus, bukan dua.
 */
function createRequire(fromFile, sharedCache = null) {
    const cache = sharedCache || new Map();
    const baseDir = path.dirname(path.resolve(fromFile));

    // `nodeRequire` disimpan terpisah: parameter fungsi di bawah bernama
    // `require` dan akan menutupi `require` modul-level kalau tidak di-shadow.
    const nodeRequire = require;

    return function require(request) {
        // Modul bawaan Bonang dipetakan ke runtime resmi.
        if (request === 'bonang' || request === 'bonang/runtime') {
            return nodeRequire('../runtime/index.js');
        }
        if (request === 'bonang/client') {
            return nodeRequire('../runtime/client/client.js');
        }
        if (request === 'bonang/std') {
            return nodeRequire('../standard-library/index.js');
        }
        if (!request.startsWith('.') && !path.isAbsolute(request)) {
            return nodeRequire(request);
        }
        const resolved = resolveBonangModule(request, baseDir);
        if (!resolved) {
            throw new Error(`Modul tidak ditemukan: ${request}`);
        }
        // Modul sudah selesai dimuat (atau sedang dimuat) — kembalikan
        // exports-nya. Untuk siklus, exports masih kosong, sesuai
        // perilaku CommonJS.
        if (cache.has(resolved)) return cache.get(resolved).exports;

        const moduleObj = { exports: {} };
        // Daftarkan SEBELUM evaluasi supaya siklus tidak rekursi.
        cache.set(resolved, moduleObj);

        const source = fs.readFileSync(resolved, 'utf8');
        const compiler = new Compiler();
        const result = compiler.compile(source, resolved);
        const fn = new Function('module', 'exports', 'require', '__filename', '__dirname', result.code);
        fn(moduleObj, moduleObj.exports, createRequire(resolved, cache), resolved, path.dirname(resolved));
        return moduleObj.exports;
    };
}

/**
 * Cari file modul Bonang: coba `.bng`, lalu `.js`, lalu `index.bng`.
 */
function resolveBonangModule(request, baseDir) {
    const candidates = [];
    const target = path.resolve(baseDir, request);

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

module.exports = { Compiler, CompilerError, createRequire, resolveBonangModule };
