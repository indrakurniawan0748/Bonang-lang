'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { safeJoin, safeFilename } = require('../runtime/security/security');

/**
 * Package manager Bonang.
 *
 * Format paket mengikuti konvensi npm sehingga dapat memakai registry npm,
 * namun file sumber tetap berekstensi `.bng`.
 *
 * Manifest proyek: `bonang.json`
 *   {
 *     "name": "my-app",
 *     "version": "1.0.0",
 *     "dependencies": { "left-pad": "1.3.0" }
 *   }
 *
 * Folder paket terinstal: `node_modules/<nama>`
 * Lockfile: `bonang.lock.json`
 */

const MANIFEST_NAME = 'bonang.json';
const LOCKFILE_NAME = 'bonang.lock.json';
const MODULES_DIR = 'node_modules';

/**
 * Baca manifest proyek.
 */
function readManifest(root) {
    const file = path.join(root, MANIFEST_NAME);
    if (!fs.existsSync(file)) return null;
    try {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (err) {
        throw new Error(`Manifest tidak valid (${file}): ${err.message}`);
    }
}

/**
 * Tulis manifest proyek.
 */
function writeManifest(root, manifest) {
    const file = path.join(root, MANIFEST_NAME);
    fs.writeFileSync(file, JSON.stringify(manifest, null, 2), 'utf8');
    return file;
}

/**
 * Baca lockfile.
 */
function readLockfile(root) {
    const file = path.join(root, LOCKFILE_NAME);
    if (!fs.existsSync(file)) return { lockfileVersion: 1, packages: {} };
    try {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
        return { lockfileVersion: 1, packages: {} };
    }
}

/**
 * Tulis lockfile.
 */
function writeLockfile(root, lockfile) {
    const file = path.join(root, LOCKFILE_NAME);
    fs.writeFileSync(file, JSON.stringify(lockfile, null, 2), 'utf8');
    return file;
}

/**
 * Normalisasi nama paket: hanya huruf, angka, titik, dash, underscore.
 */
function assertPackageName(name) {
    if (!/^(?:@[a-z0-9-]+\/)?[a-z0-9-._]+$/i.test(String(name || ''))) {
        throw new Error(`Nama paket tidak valid: '${name}'`);
    }
    return String(name);
}

/**
 * Ambil folder paket yang sah (proteksi path traversal).
 */
function packageDir(root, name) {
    assertPackageName(name);
    const target = path.join(root, MODULES_DIR, name);
    // safeJoin memastikan hasil tetap berada di dalam node_modules.
    return safeJoin(path.join(root, MODULES_DIR), name);
}

/**
 * Daftar paket yang sudah terpasang.
 */
function listInstalled(root) {
    const modulesDir = path.join(root, MODULES_DIR);
    if (!fs.existsSync(modulesDir)) return [];

    const names = [];
    for (const entry of fs.readdirSync(modulesDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        if (entry.name.startsWith('@')) {
            // Cakupan: iterasi paket di dalam folder scope.
            const scopeDir = path.join(modulesDir, entry.name);
            for (const scoped of fs.readdirSync(scopeDir, { withFileTypes: true })) {
                if (scoped.isDirectory()) names.push(`${entry.name}/${scoped.name}`);
            }
        } else {
            names.push(entry.name);
        }
    }
    return names.sort();
}

/**
 * Pasang dependensi proyek.
 *
 * Paket diambil dari registry npm sebagai tarball lalu diekstrak ke
 * `node_modules/<nama>`. Sumber paket Bonang (`.bng`) di-build ke `.js`
 * bila registry menyediakannya.
 */
async function install(root, options = {}) {
    const manifest = readManifest(root);
    if (!manifest) {
        throw new Error(`${MANIFEST_NAME} tidak ditemukan. Jalankan di dalam proyek Bonang.`);
    }

    const dependencies = manifest.dependencies || {};
    const names = options.only
        ? (Array.isArray(options.only) ? options.only : [options.only])
        : Object.keys(dependencies);

    const installed = [];
    const failed = [];

    for (const name of names) {
        const version = dependencies[name];
        try {
            const result = await installPackage(root, name, version);
            installed.push(result);
        } catch (err) {
            failed.push({ name, error: err.message });
        }
    }

    const lockfile = readLockfile(root);
    for (const entry of installed) {
        lockfile.packages[entry.name] = {
            version: entry.version,
            resolved: entry.resolved,
            integrity: entry.integrity || null
        };
    }
    writeLockfile(root, lockfile);

    return { installed, failed };
}

/**
 * Pasang satu paket dari registry npm.
 */
async function installPackage(root, name, versionRange) {
    assertPackageName(name);

    const metadata = await fetchRegistryMetadata(name);
    const version = resolveVersion(metadata.versions, versionRange);
    const info = metadata.versions[version];
    if (!info || !info.dist || !info.dist.tarball) {
        throw new Error(`Versi '${versionRange}' tidak ditemukan untuk paket '${name}'`);
    }

    const tarball = await downloadTarball(info.dist.tarball);
    const target = packageDir(root, name);
    fs.rmSync(target, { recursive: true, force: true });
    fs.mkdirSync(target, { recursive: true });

    extractTarball(tarball, target);

    // Build file .bng menjadi .js bila ada.
    const built = buildBonangSources(target);

    return {
        name,
        version,
        resolved: info.dist.tarball,
        integrity: info.dist.integrity || null,
        built
    };
}

/**
 * Ambil metadata paket dari registry npm.
 */
async function fetchRegistryMetadata(name) {
    const registry = process.env.BONANG_REGISTRY || 'https://registry.npmjs.org';
    const url = `${registry}/${encodeURIComponent(name).replace('%40', '@')}`;
    const response = await fetch(url, {
        headers: { accept: 'application/vnd.npm.install-v1+json' }
    });
    if (!response.ok) {
        throw new Error(`Registry menjawab status ${response.status} untuk '${name}'`);
    }
    return response.json();
}

/**
 * Pilih versi yang memenuhi rentang. Rentang yang didukung: `*`, `latest`,
 * `^x.y.z`, `~x.y.z`, dan versi persis.
 */
function resolveVersion(versions, range) {
    const available = Object.keys(versions).sort(compareVersions);
    if (available.length === 0) throw new Error('Paket tidak memiliki versi');

    if (!range || range === '*' || range === 'latest') {
        return available[available.length - 1];
    }
    if (range.startsWith('^')) {
        const base = range.slice(1);
        const major = parseInt(base.split('.')[0], 10);
        const match = available.filter((v) => {
            const parts = v.split('.');
            if (parts[0].includes('-')) return false;
            return parseInt(parts[0], 10) === major;
        });
        if (match.length === 0) throw new Error(`Tidak ada versi yang cocok dengan '${range}'`);
        return match[match.length - 1];
    }
    if (range.startsWith('~')) {
        const base = range.slice(1).split('.');
        const match = available.filter((v) => {
            const parts = v.split('.');
            return parts[0] === base[0] && parts[1] === base[1];
        });
        if (match.length === 0) throw new Error(`Tidak ada versi yang cocok dengan '${range}'`);
        return match[match.length - 1];
    }
    if (available.includes(range)) return range;
    throw new Error(`Versi '${range}' tidak tersedia`);
}

/**
 * Bandingkan versi semver sederhana.
 */
function compareVersions(a, b) {
    const pa = a.split(/[.-]/).map((x) => (/^\d+$/.test(x) ? Number(x) : x));
    const pb = b.split(/[.-]/).map((x) => (/^\d+$/.test(x) ? Number(x) : x));
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        const va = pa[i] ?? 0;
        const vb = pb[i] ?? 0;
        if (va === vb) continue;
        if (typeof va === 'number' && typeof vb === 'number') return va - vb;
        return String(va) < String(vb) ? -1 : 1;
    }
    return 0;
}

/**
 * Unduh tarball paket.
 */
async function downloadTarball(url) {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Gagal mengunduh tarball (status ${response.status})`);
    }
    return Buffer.from(await response.arrayBuffer());
}

/**
 * Ekstrak tarball gzip. Format npm: `package/...` di dalam arsip.
 *
 * Diimplementasikan manual memakai `zlib` bawaan Node agar package manager
 * tidak memerlukan dependensi eksternal. Hanya entri file reguler dan
 * direktori yang diambil; path di luar target ditolak.
 */
function extractTarball(buffer, target) {
    const zlib = require('node:zlib');
    const tarData = zlib.gunzipSync(buffer);

    let offset = 0;
    let extracted = 0;

    while (offset + 512 <= tarData.length) {
        const header = tarData.subarray(offset, offset + 512);
        // Dua blok nol menandai akhir arsip.
        if (header.every((byte) => byte === 0)) break;

        const name = readTarString(header, 0, 100);
        const prefix = readTarString(header, 345, 155);
        const sizeField = readTarString(header, 124, 12).trim();
        const typeFlag = String.fromCharCode(header[156]) || '0';
        const mode = parseInt(readTarString(header, 100, 8).trim() || '644', 8);

        offset += 512;
        const size = parseInt(sizeField, 10) || 0;
        const content = tarData.subarray(offset, offset + size);
        offset += Math.ceil(size / 512) * 512;

        // Hanya entri di dalam folder `package/` yang dipakai (format npm).
        const relative = prefix ? `${prefix}/${name}` : name;
        const stripped = relative.replace(/^package\//, '');
        if (!stripped || stripped.endsWith('/')) {
            if (stripped) {
                const dir = safeJoin(target, stripped);
                if (dir) fs.mkdirSync(dir, { recursive: true });
            }
            continue;
        }
        if (typeFlag !== '0' && typeFlag !== '\0' && typeFlag !== '') continue;

        // Path traversal dicegah oleh safeJoin: hasil di luar target diabaikan.
        const destination = safeJoin(target, stripped);
        if (!destination) continue;

        fs.mkdirSync(path.dirname(destination), { recursive: true });
        fs.writeFileSync(destination, content, { mode: mode & 0o777 });
        extracted += 1;
    }

    return { extracted };
}

/**
 * Baca string dari header tar (NUL-terminated).
 */
function readTarString(header, start, length) {
    const slice = header.subarray(start, start + length);
    const end = slice.indexOf(0);
    return slice.toString('utf8', 0, end === -1 ? slice.length : end);
}

/**
 * Build file `.bng` di dalam paket menjadi `.js` yang dapat diimpor.
 *
 * Modul Bonang di dalam paket memakai `require("./x.bng")`; file hasil build
 * `./x.js` diletakkan di sampingnya sehingga require relative tetap bekerja.
 */
function buildBonangSources(dir) {
    const { Compiler } = require('../compiler/compiler');
    const compiler = new Compiler();
    const built = [];

    const walk = (current) => {
        for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
            const full = path.join(current, entry.name);
            if (entry.isDirectory()) {
                if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
                walk(full);
            } else if (entry.name.endsWith('.bng')) {
                try {
                    const source = fs.readFileSync(full, 'utf8');
                    const result = compiler.compile(source, full);
                    const out = full.replace(/\.bng$/, '.js');
                    fs.writeFileSync(out, result.code, 'utf8');
                    built.push(path.relative(dir, out));
                } catch (err) {
                    throw new Error(`Gagal build ${path.relative(dir, full)}: ${err.message}`);
                }
            }
        }
    };

    walk(dir);
    return built;
}

module.exports = {
    MANIFEST_NAME,
    LOCKFILE_NAME,
    MODULES_DIR,
    readManifest,
    writeManifest,
    readLockfile,
    writeLockfile,
    assertPackageName,
    listInstalled,
    install,
    installPackage,
    resolveVersion,
    compareVersions,
    extractTarball,
    buildBonangSources
};
