'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { safeJoin, safeFilename } = require('../security/security');

/**
 * Modul filesystem Bonang.
 *
 * Setiap operasi path diverifikasi terhadap root agar tidak ada path
 * traversal (../../etc/passwd).
 */

/**
 * Buat file dan pastikan direktorinya ada.
 */
async function writeFile(root, relativePath, content) {
    const target = safeJoin(root, relativePath);
    if (!target) {
        throw new Error('Path berada di luar direktori yang diizinkan');
    }
    await fsp.mkdir(path.dirname(target), { recursive: true });
    await fsp.writeFile(target, content, 'utf8');
    return target;
}

/**
 * Baca file sebagai teks.
 */
async function readFile(root, relativePath) {
    const target = safeJoin(root, relativePath);
    if (!target) {
        throw new Error('Path berada di luar direktori yang diizinkan');
    }
    return fsp.readFile(target, 'utf8');
}

/**
 * Baca file sebagai Buffer.
 */
async function readFileBuffer(root, relativePath) {
    const target = safeJoin(root, relativePath);
    if (!target) {
        throw new Error('Path berada di luar direktori yang diizinkan');
    }
    return fsp.readFile(target);
}

/**
 * Hapus file.
 */
async function removeFile(root, relativePath) {
    const target = safeJoin(root, relativePath);
    if (!target) {
        throw new Error('Path berada di luar direktori yang diizinkan');
    }
    await fsp.unlink(target);
    return true;
}

/**
 * pastikan direktori ada.
 */
async function ensureDir(root, relativePath = '') {
    const target = safeJoin(root, relativePath);
    if (!target) {
        throw new Error('Path berada di luar direktori yang diizinkan');
    }
    await fsp.mkdir(target, { recursive: true });
    return target;
}

/**
 * Daftar isi direktori.
 */
async function listDir(root, relativePath = '') {
    const target = safeJoin(root, relativePath);
    if (!target) {
        throw new Error('Path berada di luar direktori yang diizinkan');
    }
    const entries = await fsp.readdir(target, { withFileTypes: true });
    return entries.map((e) => ({
        name: e.name,
        isDirectory: e.isDirectory(),
        isFile: e.isFile()
    }));
}

/**
 * Cek apakah file ada.
 */
async function exists(root, relativePath) {
    const target = safeJoin(root, relativePath);
    if (!target) return false;
    try {
        await fsp.access(target);
        return true;
    } catch {
        return false;
    }
}

/**
 * Salin file ke direktori upload dengan nama yang sudah disanitasi.
 */
async function saveUpload(root, uploadDir, filename, buffer) {
    const safe = safeFilename(filename);
    if (!safe) {
        throw new Error('Nama file tidak aman');
    }
    const target = safeJoin(root, uploadDir, safe);
    if (!target) {
        throw new Error('Path berada di luar direktori yang diizinkan');
    }
    await fsp.mkdir(path.dirname(target), { recursive: true });
    await fsp.writeFile(target, buffer);
    return target;
}

/**
 * Stream file ke response HTTP tanpa memuat seluruh isi ke memori.
 *
 * Header keamanan ikut dipasang di sini karena berkas statis ditulis
 * langsung ke `response.raw` — tidak melewati `Response.buildHeaders()`.
 */
function streamFile(root, relativePath, response) {
    const target = safeJoin(root, relativePath);
    if (!target) {
        throw new Error('Path berada di luar direktori yang diizinkan');
    }
    if (!fs.existsSync(target)) {
        return false;
    }
    const stat = fs.statSync(target);
    const headers = {
        'Content-Type': contentTypeFor(target),
        'Content-Length': stat.size
    };
    if (response.securityHeaders) {
        for (const [name, value] of Object.entries(response.securityHeaders)) {
            if (headers[name] === undefined) headers[name] = value;
        }
    }
    response.raw.writeHead(200, headers);
    const stream = fs.createReadStream(target);
    stream.pipe(response.raw);
    response.finished = true;
    return true;
}

/**
 * Tentukan Content-Type dari ekstensi file.
 */
function contentTypeFor(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    const types = {
        '.html': 'text/html; charset=utf-8',
        '.js': 'text/javascript; charset=utf-8',
        '.mjs': 'text/javascript; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
        '.json': 'application/json; charset=utf-8',
        '.svg': 'image/svg+xml',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.gif': 'image/gif',
        '.webp': 'image/webp',
        '.ico': 'image/x-icon',
        '.txt': 'text/plain; charset=utf-8',
        '.woff': 'font/woff',
        '.woff2': 'font/woff2'
    };
    return types[ext] || 'application/octet-stream';
}

module.exports = {
    writeFile,
    readFile,
    readFileBuffer,
    removeFile,
    ensureDir,
    listDir,
    exists,
    saveUpload,
    streamFile,
    contentTypeFor
};
