'use strict';

const crypto = require('node:crypto');
const { BonangError, ValidationError } = require('../core/runtime');

/**
 * Modul keamanan Bonang.
 *
 * Fokus: hashing password, token acak, timing-safe comparison, proteksi
 * CSRF, sanitasi input, dan pentestersan path file.
 */

// ===== PASSWORD =====

/**
 * Hash password dengan scrypt.
 *
 * Format hasil: `scrypt$N$r$p$salt$hash` (base64) sehingga parameter
 * cost dapat diubah di masa depan tanpa merusak hash lama.
 */
function hashPassword(password, options = {}) {
    const N = options.N || 16384;
    const r = options.r || 8;
    const p = options.p || 1;
    const keylen = options.keylen || 64;
    const salt = crypto.randomBytes(16);

    const derived = crypto.scryptSync(password, salt, keylen, { N, r, p, maxmem: 128 * N * r * 2 });

    return ['scrypt', N, r, p, salt.toString('base64'), derived.toString('base64')].join('$');
}

/**
 * Verifikasi password terhadap hash. Perbandingan dibuat timing-safe.
 */
function verifyPassword(password, stored) {
    if (typeof stored !== 'string') return false;
    const parts = stored.split('$');
    if (parts.length !== 6 || parts[0] !== 'scrypt') return false;

    const N = parseInt(parts[1], 10);
    const r = parseInt(parts[2], 10);
    const p = parseInt(parts[3], 10);
    const salt = Buffer.from(parts[4], 'base64');
    const expected = Buffer.from(parts[5], 'base64');

    let derived;
    try {
        derived = crypto.scryptSync(password, salt, expected.length, { N, r, p, maxmem: 128 * N * r * 2 });
    } catch {
        return false;
    }
    return timingSafeEqual(derived, expected);
}

/**
 * Bandingkan dua nilai secara timing-safe.
 *
 * Nilai dapat berupa string atau Buffer. String dinormalisasi ke Buffer UTF-8
 * supaya perbandingan byte dilakukan atas representasi yang sama.
 */
function timingSafeEqual(a, b) {
    const bufA = Buffer.isBuffer(a) ? a : Buffer.from(String(a));
    const bufB = Buffer.isBuffer(b) ? b : Buffer.from(String(b));
    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
}

// ===== TOKEN =====

/** Token acak kriptografis dalam format hex. */
function randomToken(bytes = 32) {
    return crypto.randomBytes(bytes).toString('hex');
}

/** UUID v4. */
function uuid() {
    return crypto.randomUUID();
}

/**
 * Buat signature HMAC untuk payload (mis. cookie session atau webhook).
 */
function sign(payload, secret, algorithm = 'sha256') {
    return crypto.createHmac(algorithm, secret).update(payload).digest('hex');
}

/**
 * Verifikasi signature HMAC dengan timing-safe comparison.
 */
function verifySignature(payload, signature, secret, algorithm = 'sha256') {
    const expected = sign(payload, secret, algorithm);
    return timingSafeEqual(Buffer.from(expected), Buffer.from(String(signature)));
}

// ===== CSRF =====

/**
 * Token CSRF stateless berbasis HMAC.
 *
 * Token disimpan pada cookie dan dikirim balik melalui header, lalu
 * diverifikasi dengan membandingkan signature.
 */
function createCsrfToken(sessionId, secret) {
    return sign(sessionId, secret);
}

/**
 * Verifikasi token CSRF. Constant-time perbandingan.
 */
function verifyCsrfToken(token, sessionId, secret) {
    if (!token || !sessionId || !secret) return false;
    return verifySignature(sessionId, token, secret);
}

// ===== INPUT SANITIZATION =====

/**
 * Escape HTML untuk mencegah XSS.
 * Aman untukDisisipkan ke dalam teks HTML dan atribut nilai.
 */
function escapeHtml(input) {
    if (input === null || input === undefined) return '';
    return String(input)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#x27;')
        .replace(/`/g, '&#x60;');
}

/**
 * Buang karakter kontrol yang tidak perlu (kecuali newline/tab).
 */
function stripControlChars(input) {
    if (input === null || input === undefined) return '';
    // eslint-disable-next-line no-control-regex
    return String(input).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
}

/**
 * Normalisasi input teks: trim, hapus karakter kontrol, batasi panjang.
 */
function sanitizeText(input, maxLength = 10000) {
    if (input === null || input === undefined) return '';
    return stripControlChars(String(input)).trim().slice(0, maxLength);
}

/**
 * Validasi email dengan pola konservatif.
 */
function isEmail(value) {
    if (typeof value !== 'string') return false;
    const trimmed = value.trim();
    if (trimmed.length > 254) return false;
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
}

/**
 * Normalisasi nama file: buang path traversal dan karakter berbahaya.
 * Mengembalikan null bila nama file tidak aman.
 */
function safeFilename(filename) {
    if (typeof filename !== 'string' || filename.length === 0) return null;
    // Ambil basename untuk membuang directory traversal.
    const base = filename.replace(/\\/g, '/').split('/').pop();
    if (!base || base === '.' || base === '..') return null;
    if (!/^[A-Za-z0-9._-]+$/.test(base)) return null;
    if (base.length > 255) return null;
    return base;
}

/**
 * Resolusi path aman terhadap path root.
 * Mengembalikan null bila hasil resolusinya keluar dari root.
 */
function safeJoin(root, ...segments) {
    const path = require('node:path');
    const resolvedRoot = path.resolve(root);
    const target = path.resolve(resolvedRoot, ...segments);
    // Perbandingan dengan pemisah path agar "/data-evil" tidak lolos dari "/data".
    if (target !== resolvedRoot && !target.startsWith(resolvedRoot + path.sep)) {
        return null;
    }
    return target;
}

/**
 * Batasi ukuran upload dan tipe file yang diizinkan.
 */
function validateUpload(filename, size, allowedTypes = [], maxSize = 5 * 1024 * 1024) {
    // Nama file yang memuat path separator ditolak secara eksplisit.
    // Fungsi aman `safeFilename` akan mengambil basename-nya, tetapi
    // menerima percobaan traversal secara diam-diam menutupi serangan
    // alih-alih menolaknya.
    if (typeof filename !== 'string' || filename.includes('/') || filename.includes('\\')) {
        throw new ValidationError('Nama file tidak aman');
    }
    const safe = safeFilename(filename);
    if (!safe) {
        throw new ValidationError('Nama file tidak aman');
    }
    if (size > maxSize) {
        throw new ValidationError(`Ukuran file melebihi batas ${maxSize} byte`);
    }
    if (allowedTypes.length > 0) {
        const ext = safe.includes('.') ? safe.slice(safe.lastIndexOf('.') + 1).toLowerCase() : '';
        if (!allowedTypes.map((t) => t.toLowerCase()).includes(ext)) {
            throw new ValidationError(`Tipe file tidak diizinkan: ${ext}`);
        }
    }
    return safe;
}

/**
 * Batasi jumlah request per periode (rate limiting in-memory).
 */
class RateLimiter {
    constructor(options = {}) {
        this.windowMs = options.windowMs || 60000;
        this.max = options.max || 100;
        this.hits = new Map();
    }

    /**
     * Catat satu request dan kembalikan { allowed, remaining, resetAt }.
     */
    consume(key) {
        const now = Date.now();
        const windowStart = now - this.windowMs;

        const timestamps = (this.hits.get(key) || []).filter((t) => t > windowStart);
        if (timestamps.length >= this.max) {
            this.hits.set(key, timestamps);
            return {
                allowed: false,
                remaining: 0,
                resetAt: timestamps[0] + this.windowMs
            };
        }

        timestamps.push(now);
        this.hits.set(key, timestamps);
        return {
            allowed: true,
            remaining: this.max - timestamps.length,
            resetAt: now + this.windowMs
        };
    }

    /** Bersihkan entri yang sudah kedaluwarsa. */
    cleanup() {
        const windowStart = Date.now() - this.windowMs;
        for (const [key, timestamps] of this.hits) {
            const active = timestamps.filter((t) => t > windowStart);
            if (active.length === 0) this.hits.delete(key);
            else this.hits.set(key, active);
        }
    }
}

/**
 * Session store in-memory.
 *
 * Sesi dibuat server-side dengan id acak, dan cookie hanya membawa id —
 * bukan data sesi — sehingga data sensitif tidak terekspos ke client.
 */
class SessionStore {
    constructor(options = {}) {
        this.ttl = options.ttl || 24 * 60 * 60 * 1000;
        this.sessions = new Map();
    }

    create(data = {}) {
        const id = randomToken(32);
        this.sessions.set(id, { data: { ...data }, createdAt: Date.now(), expiresAt: Date.now() + this.ttl });
        return id;
    }

    get(id) {
        if (!id) return null;
        const session = this.sessions.get(id);
        if (!session) return null;
        if (session.expiresAt < Date.now()) {
            this.sessions.delete(id);
            return null;
        }
        return session.data;
    }

    update(id, data) {
        const session = this.sessions.get(id);
        if (!session) return false;
        session.data = { ...session.data, ...data };
        session.expiresAt = Date.now() + this.ttl;
        return true;
    }

    destroy(id) {
        return this.sessions.delete(id);
    }

    cleanup() {
        const now = Date.now();
        for (const [id, session] of this.sessions) {
            if (session.expiresAt < now) this.sessions.delete(id);
        }
    }
}

module.exports = {
    hashPassword,
    verifyPassword,
    timingSafeEqual,
    randomToken,
    uuid,
    sign,
    verifySignature,
    createCsrfToken,
    verifyCsrfToken,
    escapeHtml,
    stripControlChars,
    sanitizeText,
    isEmail,
    safeFilename,
    safeJoin,
    validateUpload,
    RateLimiter,
    SessionStore
};
