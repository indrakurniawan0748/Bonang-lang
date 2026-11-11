'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { URL } = require('node:url');
const { Router } = require('./router');
const { BonangError, ValidationError, getLogger } = require('../core/runtime');
const { signValue } = require('../security/security');

const MAX_BODY_BYTES = 5 * 1024 * 1024; // 5 MB

/**
 * Header keamanan bawaan.
 *
 * Diterapkan otomatis ke setiap respons (JSON, teks, redirect, aset
 * statis, dan respons error) karena ditetapkan di lapisan Response —
 * bukan di handler — sehingga tidak ada jalur keluar yang bisa
 * melewatkannya.
 *
 * Nilai bisa dilonggarkan per-aplikasi lewat opsi `securityHeaders`
 * pada `createServer`, dan bisa ditimpa per-route lewat
 * `response.set(...)`.
 */
const DEFAULT_SECURITY_HEADERS = {
    // Cegah browser menebak-nebak tipe konten (mitigasi content sniffing).
    'x-content-type-options': 'nosniff',
    // Cegah halaman di-embed lewat iframe (mitigasi clickjacking).
    'x-frame-options': 'SAMEORIGIN',
    // Jangan kirim URL lengkap ke origin lain.
    'referrer-policy': 'strict-origin-when-cross-origin',
    // Batasi sumber daya yang boleh dimuat halaman. Default 'self' berarti
    // hanya aset dari origin sendiri yang boleh dimuat — termasuk skrip,
    // gaya, dan koneksi API.
    'content-security-policy': [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self'",
        "img-src 'self' data:",
        "font-src 'self'",
        "connect-src 'self'",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        "frame-ancestors 'self'"
    ].join('; '),
    // Matikan fitur browser sensitif yang tidak dipakai aplikasi Bonang.
    'permissions-policy': 'geolocation=(), camera=(), microphone=(), payment=()',
    // Nonaktifkan filter XSS lawas browser yang bisa membocorkan URL.
    'x-xss-protection': '0'
};

/**
 * Susun konfigurasi header keamanan dari opsi server.
 *
 * - `undefined` → pakai bawaan.
 * - `false`      → nonaktifkan sepenuhnya (hanya untuk kasus yang
 *                  memang butuh, mis. server yang hanya jadi proxy).
 * - objek       → gabung dengan bawaan; nilai aplikasi menang.
 *
 * Kunci dinormalkan ke huruf kecil supaya konsisten dengan
 * `Response.set()` yang juga menyimpan kunci huruf kecil.
 */
function resolveSecurityHeaders(option) {
    if (option === false) return null;
    if (option === undefined || option === null) return { ...DEFAULT_SECURITY_HEADERS };
    if (typeof option !== 'object') {
        throw new TypeError('Opsi securityHeaders harus object atau false');
    }
    const merged = { ...DEFAULT_SECURITY_HEADERS };
    for (const [name, value] of Object.entries(option)) {
        if (value === null || value === false) {
            delete merged[name.toLowerCase()];
            continue;
        }
        merged[name.toLowerCase()] = String(value);
    }
    return merged;
}

/**
 * Objek Request Bonang.
 *
 * Body sudah di-parse (JSON atau form-encoded) dan query diparse menjadi
 * object biasa sehingga handler tidak perlu mem-parsing ulang.
 */
class Request {
    constructor(raw, server) {
        this.raw = raw;
        this.method = raw.method;
        this.url = raw.url;
        this.headers = raw.headers;

        const parsed = new URL(raw.url, `http://${raw.headers.host || 'localhost'}`);
        this.path = parsed.pathname;
        this.query = Object.fromEntries(parsed.searchParams.entries());
        this.queryAll = parsed.searchParams;

        this.params = {};
        this.body = null;
        this.rawBody = null;
        this.cookies = parseCookies(raw.headers.cookie);
        this.state = {}; // tempat middleware menyimpan data antar handler
        this.ip = raw.socket ? raw.socket.remoteAddress : null;
        this.server = server;
        // Response diisi oleh server sebelum handler dipanggil, sehingga
        // handler dapat mengatur cookie/header tanpa menerima argumen kedua.
        this.response = null;
    }

    /** Ambil header dengan fallback. */
    header(name, fallback = undefined) {
        const value = this.headers[name.toLowerCase()];
        return value === undefined ? fallback : value;
    }

    /** Ambil body sebagai object, atau `fallback` bila body kosong. */
    json(fallback = null) {
        if (this.body === null || typeof this.body !== 'object') return fallback;
        return this.body;
    }

    /**
     * Ambil nilai cookie bertanda tangan.
     *
     * Mengembalikan nilai asli bila signature cocok, atau `fallback` (null
     * secara bawaan) bila cookie tidak ada, rusak, atau signature tidak
     * cocok. Cookie yang gagal verifikasi diperlakukan sama dengan cookie
     * yang tidak ada — caller tidak boleh bisa membedakan keduanya lewat
     * nilai balik.
     */
    signedCookie(name, secret, fallback = null) {
        const { verifySignedValue } = require('../security/security');
        const raw = this.cookies ? this.cookies[name] : undefined;
        if (raw === undefined) return fallback;
        const value = verifySignedValue(raw, secret);
        return value === null ? fallback : value;
    }

    /** Ambil satu field dari body. */
    field(name, fallback = undefined) {
        if (!this.body || typeof this.body !== 'object') return fallback;
        return this.body[name];
    }

    /**
     * Validasi body terhadap skema sederhana.
     *
     * Skema: { field: { type, required, min, max, enum } }
     * Mengembalikan objek nilai yang sudah divalidasi, melempar ValidationError.
     */
    validate(schema) {
        const body = this.body || {};
        const result = {};

        for (const [field, rules] of Object.entries(schema)) {
            const value = body[field];
            const present = value !== undefined && value !== null && value !== '';

            if (rules.required && !present) {
                throw new ValidationError(`Field '${field}' wajib diisi`, { field });
            }
            if (!present) {
                if (rules.default !== undefined) result[field] = rules.default;
                continue;
            }

            if (rules.type && !matchesType(value, rules.type)) {
                throw new ValidationError(
                    `Field '${field}' harus bertipe ${rules.type}`,
                    { field, expected: rules.type, received: typeof value }
                );
            }
            if (rules.min !== undefined && typeof value === 'number' && value < rules.min) {
                throw new ValidationError(`Field '${field}' minimal ${rules.min}`, { field });
            }
            if (rules.max !== undefined && typeof value === 'number' && value > rules.max) {
                throw new ValidationError(`Field '${field}' maksimal ${rules.max}`, { field });
            }
            if (rules.maxLength !== undefined && typeof value === 'string' && value.length > rules.maxLength) {
                throw new ValidationError(`Field '${field}' maksimal ${rules.maxLength} karakter`, { field });
            }
            if (rules.enum && !rules.enum.includes(value)) {
                throw new ValidationError(
                    `Field '${field}' harus salah satu dari: ${rules.enum.join(', ')}`,
                    { field, allowed: rules.enum }
                );
            }

            result[field] = value;
        }

        return result;
    }
}

/**
 * Objek Response Bonang.
 *
 * Body dikirim satu kali pada `send()`/`json()`/`end()`. Header yang sudah
 * dikirim tidak dapat diubah lagi — pemanggil bertanggung jawab.
 */
class Response {
    constructor(raw, securityHeaders = DEFAULT_SECURITY_HEADERS) {
        this.raw = raw;
        this.statusCode = 200;
        this.headers = {};
        this.finished = false;
        this.cookies = [];
        this.securityHeaders = securityHeaders;
    }

    status(code) {
        this.statusCode = code;
        return this;
    }

    set(name, value) {
        this.headers[name.toLowerCase()] = value;
        return this;
    }

    type(contentType) {
        return this.set('Content-Type', contentType);
    }

    /**
     * Set cookie. Opsi mengikuti atribut cookie HTTP.
     *
     * Bila `options.signed` true, nilai dilindungi HMAC dengan
     * `options.secret` sebelum dikirim.
     */
    cookie(name, value, options = {}) {
        if (options.signed) {
            if (!options.secret) {
                throw new ValidationError('Secret wajib diisi untuk signed cookie');
            }
            const { secret, signed, ...rest } = options;
            this.cookies.push({ name, value: signValue(value, secret), ...rest, signed: true });
            return this;
        }
        this.cookies.push({ name, value, ...options });
        return this;
    }

    /**
     * Set cookie bertanda tangan (signed cookie).
     *
     * Nilai cookie dilindungi HMAC dengan `secret`, sehingga client bisa
     * membaca nilainya tetapi tidak bisa memalsukan atau memodifikasinya.
     * Opsi `signed`/`secret` pada `cookie()` biasa juga didukung; fungsi
     * ini hanya jalan pintas yang mewajibkan secret ada.
     */
    signedCookie(name, value, options = {}) {
        if (!options.secret) {
            throw new ValidationError('Secret wajib diisi untuk signed cookie');
        }
        return this.cookie(name, value, { ...options, signed: true });
    }

    /** Kirim JSON. */
    json(data, statusCode) {
        if (statusCode) this.statusCode = statusCode;
        if (!this.headers['content-type']) {
            this.headers['content-type'] = 'application/json; charset=utf-8';
        }
        const payload = JSON.stringify(data);
        this.raw.writeHead(this.statusCode, this.buildHeaders());
        this.raw.end(payload);
        this.finished = true;
    }

    /** Kirim body teks/HTML. */
    send(body, contentType) {
        if (contentType) this.headers['content-type'] = contentType;
        this.raw.writeHead(this.statusCode, this.buildHeaders());
        this.raw.end(body);
        this.finished = true;
    }

    /** Kirim respons kosong (204). */
    end() {
        this.raw.writeHead(this.statusCode, this.buildHeaders());
        this.raw.end();
        this.finished = true;
    }

    /** Redirect. */
    redirect(location, code = 302) {
        this.statusCode = code;
        this.headers.location = location;
        this.end();
    }

    buildHeaders() {
        const headers = { ...this.headers };
        if (this.cookies.length > 0) {
            headers['set-cookie'] = this.cookies.map(serializeCookie);
        }
        // Header keamanan bawaan. Disini — bukan di server — supaya
        // respons statis, respons error, dan respons handler sama-sama
        // terlindungi, dan supaya aplikasi bisa menimpanya per-route
        // dengan `response.set(...)`.
        if (this.securityHeaders) {
            for (const [name, value] of Object.entries(this.securityHeaders)) {
                if (headers[name] === undefined) headers[name] = value;
            }
        }
        return headers;
    }
}

/**
 * HTTP server Bonang.
 *
 * Berbasis `node:http` sehingga I/O tetap non-blocking. Request yang
 * menunggu database atau network tidak memblokir request lain karena
 * seluruh handler bersifat async.
 */
class Server {
    constructor(options = {}) {
        this.port = options.port || 3000;
        this.host = options.host || '127.0.0.1';
        this.router = options.router || new Router();
        this.logger = options.logger || getLogger();
        this.onError = options.onError || null;
        this.staticDir = options.staticDir || null;
        this.notFoundHandler = options.notFoundHandler || null;
        this.methodNotAllowedHandler = options.methodNotAllowedHandler || null;
        this.requestCount = 0;
        this.activeRequests = 0;
        this.maxConcurrent = options.maxConcurrent || 0;
        this.shutdownTimeout = options.shutdownTimeout || 10000;
        this.isShuttingDown = false;
        this.httpServer = null;
        this.connections = new Set();
        // Header keamanan aktif untuk server ini. `false` mematikan
        // seluruhnya; object menimpa sebagian bawaan.
        this.securityHeaders = resolveSecurityHeaders(options.securityHeaders);

        // Helper cache service worker disediakan runtime supaya aplikasi
        // tidak perlu menyalin berkas runtime ke folder public-nya.
        // Rute bawaan ini selalu didahulukan oleh berkas statis karena
        // route terdaftar diproses sebelum fallback statis.
        this.installRuntimeRoutes();
    }

    /**
     * Pasang rute bawaan yang menyediakan helper service worker.
     */
    installRuntimeRoutes() {
        this.router.get('/bonang/sw-cache.js', (ctx) => {
            const helperPath = require.resolve('../client/sw-cache.js');
            const source = fs.readFileSync(helperPath, 'utf8');
            ctx.response.type('text/javascript; charset=utf-8');
            ctx.response.send(source);
        });

        // Manifest precache dibuat oleh `bonang build` di folder build.
        // Service worker membacanya untuk tahu hash tiap aset.
        this.router.get('/precache-manifest.json', (ctx) => {
            const manifestPath = this.findPrecacheManifest();
            if (!manifestPath) {
                ctx.response.status(404).json({
                    status: 'error',
                    msg: 'Manifest precache belum dibuat — jalankan `bonang build`'
                });
                return;
            }
            ctx.response.type('application/json; charset=utf-8');
            ctx.response.send(fs.readFileSync(manifestPath, 'utf8'));
        });
    }

    /**
     * Cari berkas `precache-manifest.json` di lokasi yang wajar.
     *
     * Lokasi diperiksa berurutan: root build (`dist/`), folder statis
     * yang dikonfigurasi, dan direktori kerja. Dengan begitu service
     * worker tetap menemukan manifest baik saat dev (root proyek) maupun
     * saat produksi (folder `dist/`).
     */
    findPrecacheManifest() {
        const candidates = [];

        // Root build: dirname dari lokasi skrip server saat produksi.
        try {
            candidates.push(path.join(path.dirname(require.main.filename), 'precache-manifest.json'));
        } catch {
            // `require.main` tidak selalu ada (mis. saat di-embed).
        }

        const roots = Array.isArray(this.staticDir) ? this.staticDir : [this.staticDir];
        for (const root of roots) {
            if (!root) continue;
            candidates.push(path.resolve(root, 'precache-manifest.json'));
            candidates.push(path.resolve(root, '..', 'precache-manifest.json'));
        }

        candidates.push(path.resolve(process.cwd(), 'precache-manifest.json'));
        candidates.push(path.resolve(process.cwd(), 'dist', 'precache-manifest.json'));

        for (const candidate of candidates) {
            if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
                return candidate;
            }
        }
        return null;
    }

    route(path, handler, options) {
        this.router.get(path, handler, options);
        return this;
    }

    use(middleware) {
        this.router.use(middleware);
        return this;
    }

    /**
     * Ambil alamat server yang sedang listening.
     * Mengembalikan null bila server belum berjalan.
     */
    address() {
        if (!this.httpServer) return null;
        const addr = this.httpServer.address();
        if (!addr) return null;
        return typeof addr === 'string' ? { address: addr, port: this.port } : addr;
    }

    /**
     * Sajikan berkas statis dari `staticDir`.
     *
     * `staticDir` boleh berupa string tunggal atau array folder. Array
     * dicoba berurutan sehingga aset yang sama bisa dilayani dari beberapa
     * sumber (misalnya `public/` untuk HTML dan `dist/` untuk bundel
     * client).
     *
     * Dipanggil hanya bila route tidak cocok dan method adalah GET/HEAD.
     * Path dinormalisasi lewat `safeJoin` sehingga `..` tidak bisa keluar
     * dari folder statis.
     */
    serveStatic(request, response) {
        if (!this.staticDir) return false;
        if (request.method !== 'GET' && request.method !== 'HEAD') return false;

        const roots = Array.isArray(this.staticDir) ? this.staticDir : [this.staticDir];
        if (roots.length === 0) return false;

        let pathname;
        try {
            pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
        } catch {
            return false;
        }

        // Root statis dilayani oleh index.html.
        const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
        if (!relative) return false;

        const { safeJoin } = require('../security/security');
        const { streamFile } = require('../filesystem/files');

        for (const root of roots) {
            if (!root) continue;
            const target = safeJoin(root, relative);
            if (!target) continue;
            if (!fs.existsSync(target) || !fs.statSync(target).isFile()) continue;
            if (streamFile(root, relative, response)) return true;
        }
        return false;
    }

    listen(port) {
        if (port !== undefined) this.port = port;
        return new Promise((resolve, reject) => {
            this.httpServer = http.createServer((req, res) => {
                this.handleRequest(req, res);
            });

            // Backlog bawaan Node (511) terlalu kecil untuk beban
            // konkurensi tinggi — koneksi excess ditolak dengan
            // ECONNREFUSED. Dinaikkan agar server tetap melayani
            // antrean koneksi yang masuk. `maxConnections` dibiarkan
            // default (unlimited) — menyetelnya ke 0 sama dengan
            // menolak semua koneksi.
            this.httpServer.on('connection', (socket) => {
                this.connections.add(socket);
                socket.on('close', () => this.connections.delete(socket));
            });

            this.httpServer.on('error', reject);
            const listenOptions = { port: this.port, host: this.host, backlog: 8192 };
            this.httpServer.listen(listenOptions, () => {
                const addr = this.httpServer.address();
                this.port = addr.port;
                this.logger.info(`Server Bonang listening di http://${this.host}:${this.port}`);
                resolve(this);
            });
        });
    }

    async handleRequest(rawReq, rawRes) {
        this.requestCount += 1;
        this.activeRequests += 1;
        const startedAt = process.hrtime.bigint();

        const request = new Request(rawReq, this);
        const response = new Response(rawRes, this.securityHeaders);

        try {
            if (this.isShuttingDown) {
                response.status(503).json({ error: 'SERVICE_UNAVAILABLE', message: 'Server sedang shutting down' });
                return;
            }

            // Batas ukuran body untuk mencegah abuse.
            if (this.maxConcurrent > 0 && this.activeRequests > this.maxConcurrent) {
                response.status(503).json({ error: 'OVERLOADED', message: 'Server sedang sibuk' });
                return;
            }

            await this.readBody(rawReq, request);

            // Response disambungkan ke context request supaya handler dapat
            // mengatur header dan cookie lewat `ctx.response`.
            request.response = response;

            let result;
            try {
                result = await this.router.handle(request);
            } catch (err) {
                // Route tidak cocok → coba sajikan berkas statis. Route yang
                // terdaftar tetap didahulukan supaya tidak tertutup aset.
                if (err && err.code === 'NOT_FOUND' && this.serveStatic(request, response)) {
                    return;
                }
                throw err;
            }

            if (!response.finished) {
                if (result !== undefined && result !== null) {
                    response.json(result);
                } else {
                    response.status(204).end();
                }
            }
        } catch (err) {
            await this.handleError(err, request, response);
        } finally {
            this.activeRequests -= 1;
            const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
            if (elapsedMs > 1000) {
                this.logger.warn(`Request lambat ${request.method} ${request.path} ${elapsedMs.toFixed(1)}ms`);
            }
        }
    }

    /**
     * Baca dan parse body request.
     */
    readBody(rawReq, request) {
        return new Promise((resolve, reject) => {
            const contentType = (rawReq.headers['content-type'] || '').toLowerCase();

            // Body pada GET/HEAD tidak perlu dibaca.
            if (rawReq.method === 'GET' || rawReq.method === 'HEAD') {
                resolve();
                return;
            }

            const chunks = [];
            let size = 0;
            let aborted = false;

            rawReq.on('data', (chunk) => {
                if (aborted) return;
                size += chunk.length;
                if (size > MAX_BODY_BYTES) {
                    aborted = true;
                    rawReq.destroy();
                    reject(new BonangError('Body request terlalu besar', 'PAYLOAD_TOO_LARGE', 413));
                    return;
                }
                chunks.push(chunk);
            });

            rawReq.on('end', () => {
                if (aborted) return;
                const raw = Buffer.concat(chunks);
                request.rawBody = raw;

                if (raw.length === 0) {
                    request.body = null;
                    resolve();
                    return;
                }

                const text = raw.toString('utf8');
                if (contentType.includes('application/json')) {
                    try {
                        request.body = JSON.parse(text);
                    } catch {
                        reject(new ValidationError('Body JSON tidak valid'));
                        return;
                    }
                } else if (contentType.includes('application/x-www-form-urlencoded')) {
                    request.body = Object.fromEntries(new URLSearchParams(text).entries());
                } else if (contentType.includes('multipart/form-data')) {
                    // Multipart ditangani khusus oleh helper upload.
                    request.body = { __multipart: true, raw };
                } else {
                    request.body = text;
                }
                resolve();
            });

            rawReq.on('error', (err) => {
                if (!aborted) reject(err);
            });
        });
    }

    /**
     * Ubah error menjadi respons JSON yang aman.
     * Detail internal hanya ditulis ke log, tidak pernah ke body respons.
     */
    async handleError(err, request, response) {
        if (response.finished) return;

        const statusCode = err.statusCode || 500;
        const code = err.code || 'INTERNAL_ERROR';

        // Log full detail untuk developer, balas generik untuk client.
        this.logger.error(`${request.method} ${request.path} -> ${statusCode} ${code}: ${err.message}`);
        if (statusCode >= 500) {
            this.logger.error(err.stack || String(err));
        }

        if (this.onError) {
            try {
                await this.onError(err, request, response);
                if (response.finished) return;
            } catch (handlerErr) {
                this.logger.error('Error handler gagal: ' + handlerErr.message);
            }
        }

        // Di mode development, sertakan stack trace agar mudah debugging.
        const includeStack = process.env.BONANG_ENV === 'development' && statusCode >= 500;

        const message = statusCode >= 500 && !includeStack
            ? 'Terjadi kesalahan pada server'
            : err.message;

        // Bentuk respons mengikuti kontrak Bonang: `status` untuk penanda
        // sukses/gagal, `msg` untuk pesan yang aman ditampilkan ke user.
        // `error` dan `message` dipertahankan sebagai alias agar consumer
        // lama tidak rusak.
        response.status(statusCode).json({
            status: 'error',
            msg: message,
            error: code,
            message,
            ...(err.details ? { details: err.details } : {}),
            ...(includeStack ? { stack: err.stack } : {})
        });
    }

    /**
     * Shutdown gracefully: berhenti menerima koneksi baru, tunggu request
     * yang sedang berjalan, lalu tutup server.
     */
    async close() {
        if (this.isShuttingDown) return;
        this.isShuttingDown = true;

        if (this.httpServer) {
            await new Promise((resolve) => {
                const timer = setTimeout(() => {
                    // Paksa tutup bila request tidak selesai dalam batas waktu.
                    for (const socket of this.connections) socket.destroy();
                    resolve();
                }, this.shutdownTimeout);
                this.httpServer.close(() => {
                    clearTimeout(timer);
                    resolve();
                });
            });
        }

        this.logger.info('Server Bonang berhenti');
    }
}

/**
 * Parse header Cookie menjadi object.
 */
function parseCookies(header) {
    const out = {};
    if (!header) return out;
    for (const part of header.split(';')) {
        const idx = part.indexOf('=');
        if (idx === -1) continue;
        const name = part.slice(0, idx).trim();
        const value = part.slice(idx + 1).trim();
        if (name) {
            try {
                out[name] = decodeURIComponent(value);
            } catch {
                out[name] = value;
            }
        }
    }
    return out;
}

/**
 * Serialisasi cookie untuk header Set-Cookie.
 */
function serializeCookie({ name, value, maxAge, expires, path: cookiePath, domain, httpOnly, secure, sameSite }) {
    const parts = [`${name}=${encodeURIComponent(value)}`];
    if (maxAge !== undefined) parts.push(`Max-Age=${maxAge}`);
    if (expires) parts.push(`Expires=${new Date(expires).toUTCString()}`);
    parts.push(`Path=${cookiePath || '/'}`);
    if (domain) parts.push(`Domain=${domain}`);
    if (httpOnly !== false) parts.push('HttpOnly');
    if (secure) parts.push('Secure');
    parts.push(`SameSite=${sameSite || 'Lax'}`);
    return parts.join('; ');
}

/**
 * Cek apakah nilai cocok dengan tipe yang diminta.
 */
function matchesType(value, type) {
    switch (type) {
        case 'string': return typeof value === 'string';
        case 'number': return typeof value === 'number' && !Number.isNaN(value);
        case 'int': return Number.isInteger(value);
        case 'float': return typeof value === 'number';
        case 'boolean': return typeof value === 'boolean';
        case 'array': return Array.isArray(value);
        case 'object': return value !== null && typeof value === 'object' && !Array.isArray(value);
        default: return true;
    }
}

module.exports = {
    Server,
    Request,
    Response,
    parseCookies,
    serializeCookie,
    DEFAULT_SECURITY_HEADERS,
    resolveSecurityHeaders
};
