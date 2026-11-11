'use strict';

/**
 * Inti runtime Bonang.
 *
 * Menyediakanprimitif yang dibutuhkan kode Bonang: promise helper, error
 * dengan kode, timing, logging, dan utilitas umum.
 *
 * Runtime ini sengaja tidak bergantung pada library eksternal apa pun —
 * hanya `node:` builtins.
 */

// ===== ERROR =====

/**
 * Error terstruktur untuk Bonang.
 *
 * `code` dipakai handler HTTP agar dapat memetakan ke status code yang
 * benar tanpa membocorkan detail internal ke client.
 */
class BonangError extends Error {
    constructor(message, code = 'INTERNAL_ERROR', statusCode = 500, details = null) {
        super(message);
        this.name = 'BonangError';
        this.code = code;
        this.statusCode = statusCode;
        this.details = details;
    }

    toJSON() {
        return { error: this.code, message: this.message, details: this.details };
    }
}

/** Error input tidak valid — dipetakan ke HTTP 400. */
class ValidationError extends BonangError {
    constructor(message, details = null) {
        super(message, 'VALIDATION_ERROR', 400, details);
        this.name = 'ValidationError';
    }
}

/** Error autentikasi gagal — dipetakan ke HTTP 401. */
class AuthError extends BonangError {
    constructor(message = 'Autentikasi gagal') {
        super(message, 'UNAUTHORIZED', 401);
        this.name = 'AuthError';
    }
}

/** Error otorisasi gagal — dipetakan ke HTTP 403. */
class ForbiddenError extends BonangError {
    constructor(message = 'Akses ditolak') {
        super(message, 'FORBIDDEN', 403);
        this.name = 'ForbiddenError';
    }
}

/** Resource tidak ditemukan — dipetakan ke HTTP 404. */
class NotFoundError extends BonangError {
    constructor(message = 'Resource tidak ditemukan', details = null) {
        super(message, 'NOT_FOUND', 404, details);
        this.name = 'NotFoundError';
    }
}

/** Konflik data — dipetakan ke HTTP 409. */
class ConflictError extends BonangError {
    constructor(message = 'Data sudah ada', details = null) {
        super(message, 'CONFLICT', 409, details);
        this.name = 'ConflictError';
    }
}

// ===== TIMING =====

/** Jeda dalam milidetik. */
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Jeda dalam detik. */
function delay(seconds) {
    return sleep(seconds * 1000);
}

/** Batas waktu untuk promise. */
function withTimeout(promise, ms, message = 'Waktu tunggu habis') {
    let timer;
    const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => {
            const err = new BonangError(message, 'TIMEOUT', 504);
            reject(err);
        }, ms);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// ===== LOGGING =====

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };

class Logger {
    constructor(options = {}) {
        this.level = options.level || 'info';
        this.prefix = options.prefix || '[bonang]';
        this.silent = options.silent || false;
        this.stream = options.stream || process.stdout;
        this.errorStream = options.errorStream || process.stderr;
    }

    shouldLog(level) {
        return LEVELS[level] <= LEVELS[this.level];
    }

    format(level, args) {
        const stamp = new Date().toISOString();
        const message = args
            .map((a) => (typeof a === 'string' ? a : safeStringify(a)))
            .join(' ');
        return `${stamp} ${this.prefix} ${level.toUpperCase()} ${message}`;
    }

    log(level, ...args) {
        if (this.silent || !this.shouldLog(level)) return;
        const line = this.format(level, args);
        if (level === 'error') {
            this.errorStream.write(`${line}\n`);
        } else {
            this.stream.write(`${line}\n`);
        }
    }

    error(...args) { this.log('error', ...args); }
    warn(...args) { this.log('warn', ...args); }
    info(...args) { this.log('info', ...args); }
    debug(...args) { this.log('debug', ...args); }
}

/** Stringify yang tidak melempar error pada circular reference. */
function safeStringify(value) {
    try {
        return JSON.stringify(value, replacerForCircular());
    } catch {
        return String(value);
    }
}

function replacerForCircular() {
    const seen = new WeakSet();
    return function (key, value) {
        if (typeof value === 'object' && value !== null) {
            if (seen.has(value)) return '[Circular]';
            seen.add(value);
        }
        return value;
    }
}

const defaultLogger = new Logger();

function getLogger() {
    return defaultLogger;
}

// ===== UTILITAS NILAI =====

/**
 * Ambil nilai deeply, dengan path berupa string bertitik ("user.profile.name").
 */
function get(source, path, fallback = undefined) {
    if (!path) return source;
    const parts = String(path).split('.');
    let current = source;
    for (const part of parts) {
        if (current === null || current === undefined) return fallback;
        current = current[part];
    }
    return current === undefined ? fallback : current;
}

/** Set nilai deeply dengan path bertitik. Object baru dibuat bila perlu. */
function set(target, path, value) {
    const parts = String(path).split('.');
    let current = target;
    for (let i = 0; i < parts.length - 1; i++) {
        const key = parts[i];
        if (current[key] === null || typeof current[key] !== 'object') {
            current[key] = {};
        }
        current = current[key];
    }
    current[parts[parts.length - 1]] = value;
    return target;
}

/** Gabungkan objek; nilai `undefined` tidak menimpa nilai yang sudah ada. */
function merge(target, ...sources) {
    const output = { ...target };
    for (const source of sources) {
        if (!source) continue;
        for (const [key, value] of Object.entries(source)) {
            if (value === undefined) continue;
            if (value && typeof value === 'object' && !Array.isArray(value)) {
                output[key] = merge(output[key] || {}, value);
            } else {
                output[key] = value;
            }
        }
    }
    return output;
}

/** Shallow copy objek. */
function clone(obj) {
    if (obj === null || typeof obj !== 'object') return obj;
    if (Array.isArray(obj)) return [...obj];
    return { ...obj };
}

/** Clareza: array unik berdasarkan nilai primitif. */
function unique(arr) {
    return [...new Set(arr)];
}

/** Group array berdasarkan fungsi key. */
function groupBy(arr, keyFn) {
    const out = {};
    for (const item of arr) {
        const key = keyFn(item);
        if (!out[key]) out[key] = [];
        out[key].push(item);
    }
    return out;
}

/**
 * Batasi nilai numerik dalam rentang [min, max].
 */
function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
}

module.exports = {
    BonangError,
    ValidationError,
    AuthError,
    ForbiddenError,
    NotFoundError,
    ConflictError,
    Logger,
    defaultLogger,
    getLogger,
    sleep,
    delay,
    withTimeout,
    get,
    set,
    merge,
    clone,
    unique,
    groupBy,
    clamp,
    safeStringify
};
