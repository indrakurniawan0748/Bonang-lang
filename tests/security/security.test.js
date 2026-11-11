'use strict';

const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');

const {
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
} = require('../../runtime/index.js');

/**
 * Uji keamanan Bonang.
 *
 * Cakupan:
 *  - Hashing password (scrypt) dan verifikasi timing-safe.
 *  - Tanda tangan HMAC dan token CSRF.
 *  - Escape HTML dan sanitasi teks.
 *  - Keamanan path (safeFilename, safeJoin) dan validasi upload.
 *  - Rate limiter dan session store.
 */

// ===== PASSWORD =====

test('security: hashPassword menghasilkan hash yang tidak menyimpan password', () => {
    const password = 'rahasia-kuat-123';
    const stored = hashPassword(password);

    assert.ok(stored, 'hash harus ada');
    assert.notStrictEqual(stored, password);
    assert.ok(!stored.includes(password), 'password tidak boleh muncul di hash');
});

test('security: hash dengan salt berbeda menghasilkan nilai berbeda', () => {
    const a = hashPassword('sama');
    const b = hashPassword('sama');
    assert.notStrictEqual(a, b, 'salt membuat hash berbeda');
});

test('security: verifyPassword menerima password benar dan menolak salah', () => {
    const stored = hashPassword('benar');

    assert.strictEqual(verifyPassword('benar', stored), true);
    assert.strictEqual(verifyPassword('salah', stored), false);
    assert.strictEqual(verifyPassword('', stored), false);
});

test('security: verifyPassword menolak hash yang rusak', () => {
    assert.strictEqual(verifyPassword('apa saja', 'bukan-hash-valid'), false);
    assert.strictEqual(verifyPassword('apa saja', ''), false);
});

// ===== TIMING SAFE =====

test('security: timingSafeEqual membandingkan string dengan benar', () => {
    assert.strictEqual(timingSafeEqual('abc', 'abc'), true);
    assert.strictEqual(timingSafeEqual('abc', 'abd'), false);
    assert.strictEqual(timingSafeEqual('abc', 'abcd'), false);
});

test('security: timingSafeEqual membandingkan Buffer dengan benar', () => {
    assert.strictEqual(timingSafeEqual(Buffer.from('abc'), Buffer.from('abc')), true);
    assert.strictEqual(timingSafeEqual(Buffer.from('abc'), Buffer.from('abd')), false);
    assert.strictEqual(timingSafeEqual(Buffer.from('abc'), Buffer.from('abcd')), false);
});

// ===== TOKEN & SIGNATURE =====

test('security: randomToken menghasilkan token acak yang berbeda', () => {
    const a = randomToken(32);
    const b = randomToken(32);

    assert.notStrictEqual(a, b);
    assert.strictEqual(a.length, 64, '32 byte harus jadi 64 karakter hex');
});

test('security: uuid memiliki format yang benar', () => {
    const id = uuid();
    assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
});

test('security: sign dan verifySignature menerima payload yang benar', () => {
    const secret = 'rahasia-server';
    const payload = JSON.stringify({ userId: 42, role: 'admin' });

    const signature = sign(payload, secret);
    assert.ok(signature);
    assert.strictEqual(verifySignature(payload, signature, secret), true);
});

test('security: verifySignature menolak tanda tangan dengan secret atau payload berbeda', () => {
    const secret = 'rahasia-server';
    const payload = JSON.stringify({ userId: 42 });
    const signature = sign(payload, secret);

    assert.strictEqual(verifySignature(payload, signature, 'secret-salah'), false);
    assert.strictEqual(verifySignature(JSON.stringify({ userId: 43 }), signature, secret), false);
});

// ===== CSRF =====

test('security: token CSRF tervalidasi untuk sesi dan secret yang sesuai', () => {
    const secret = 'csrf-secret';
    const sessionId = 'session-123';

    const token = createCsrfToken(sessionId, secret);
    assert.ok(token);
    assert.strictEqual(verifyCsrfToken(token, sessionId, secret), true);
});

test('security: token CSRF ditolak untuk sesi atau secret lain', () => {
    const secret = 'csrf-secret';
    const token = createCsrfToken('session-123', secret);

    assert.strictEqual(verifyCsrfToken(token, 'session-456', secret), false);
    assert.strictEqual(verifyCsrfToken(token, 'session-123', 'secret-salah'), false);
    assert.strictEqual(verifyCsrfToken('token-ngawur', 'session-123', secret), false);
});

// ===== ESCAPE & SANITIZE =====

test('security: escapeHtml menetralkan karakter berbahaya', () => {
    assert.strictEqual(
        escapeHtml('<script>alert("xss")</script>'),
        '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;'
    );
    assert.strictEqual(escapeHtml('a & b < c'), 'a &amp; b &lt; c');
    assert.ok(!escapeHtml('<img src=x onerror=alert(1)>').includes('<'), 'tag harus ter-escape');
});

test('security: escapeHtml mempertahankan input non-string', () => {
    assert.strictEqual(escapeHtml(null), '');
    assert.strictEqual(escapeHtml(undefined), '');
    assert.strictEqual(escapeHtml(123), '123');
});

test('security: stripControlChars membuang karakter kontrol', () => {
    const dirty = 'Halo' + String.fromCharCode(0) + 'World' + String.fromCharCode(7) + String.fromCharCode(0x1B);
    const clean = stripControlChars(dirty);

    assert.ok(!clean.includes(String.fromCharCode(0)), 'NUL harus dibuang');
    assert.ok(!clean.includes(String.fromCharCode(7)), 'BEL harus dibuang');
    assert.ok(!clean.includes(String.fromCharCode(0x1B)), 'ESC harus dibuang');
    assert.ok(clean.includes('Halo'), 'teks normal harus tetap ada');
    assert.ok(clean.includes('World'), 'teks normal harus tetap ada');
});

test('security: stripControlChars mempertahankan newline dan tab', () => {
    const clean = stripControlChars('baris1\nbaris2\tkolom');
    assert.strictEqual(clean, 'baris1\nbaris2\tkolom');
});

test('security: sanitizeText membatasi panjang input', () => {
    const long = 'a'.repeat(500);
    const clean = sanitizeText(long, 100);
    assert.strictEqual(clean.length, 100);
});

test('security: isEmail membedakan email valid dan tidak', () => {
    assert.strictEqual(isEmail('user@example.com'), true);
    assert.strictEqual(isEmail('user+tag@example.co.id'), true);
    assert.strictEqual(isEmail('bukan-email'), false);
    assert.strictEqual(isEmail('user@'), false);
    assert.strictEqual(isEmail('@example.com'), false);
    assert.strictEqual(isEmail(''), false);
});

// ===== PATH SECURITY =====

test('security: safeFilename membuang komponen path', () => {
    assert.strictEqual(safeFilename('foto.jpg'), 'foto.jpg');
    assert.ok(!safeFilename('../../etc/passwd').includes('..'));
    assert.ok(!safeFilename('a/b/c.txt').includes('/'));
    assert.ok(!safeFilename('a\\b\\c.txt').includes('\\'));
});

test('security: safeFilename menolak nama path yang berbahaya', () => {
    assert.strictEqual(safeFilename('..'), null);
    assert.strictEqual(safeFilename('../..'), null);
    assert.strictEqual(safeFilename(''), null);
});

test('security: safeJoin mencegah path traversal', () => {
    const root = path.join(os.tmpdir(), 'bonang-root');

    assert.ok(safeJoin(root, 'a', 'b.txt'), 'path normal harus diizinkan');
    assert.strictEqual(safeJoin(root, '..', 'rahasia.txt'), null);
    assert.strictEqual(safeJoin(root, '../../etc/passwd'), null);
    assert.strictEqual(safeJoin(root, '/etc/passwd'), null);
});

test('security: safeJoin menolak path yang keluar dari root via prefixMirip', () => {
    const root = path.join(os.tmpdir(), 'data');
    // "/data-evil" startsWith "/data" secara string, tapi bukan di dalam root.
    assert.strictEqual(safeJoin(root, '../data-evil/file.txt'), null);
});

// ===== UPLOAD =====

test('security: validateUpload menerima file yang diizinkan', () => {
    const result = validateUpload('foto.jpg', 1024, ['jpg'], 5 * 1024 * 1024);
    assert.strictEqual(result, 'foto.jpg', 'nama file aman harus dikembalikan');
});

test('security: validateUpload menolak nama file dengan path', () => {
    assert.throws(() => validateUpload('../../etc/passwd', 100, [], 1024), /tidak aman/i);
    assert.throws(() => validateUpload('a/b.txt', 100, [], 1024), /tidak aman/i);
});

test('security: validateUpload menolak file terlalu besar', () => {
    assert.throws(() => validateUpload('besar.jpg', 10 * 1024 * 1024, ['jpg'], 1024), /ukuran|besar/i);
});

test('security: validateUpload menolak tipe yang tidak diizinkan', () => {
    assert.throws(() => validateUpload('skrip.exe', 100, ['jpg', 'png'], 1024), /tipe|tidak diizinkan/i);
});

// ===== RATE LIMITER =====

test('security: RateLimiter membatasi jumlah request per jendela waktu', () => {
    const limiter = new RateLimiter({ windowMs: 60000, max: 3 });

    assert.strictEqual(limiter.consume('ip-1').allowed, true);
    assert.strictEqual(limiter.consume('ip-1').allowed, true);
    assert.strictEqual(limiter.consume('ip-1').allowed, true);

    const fourth = limiter.consume('ip-1');
    assert.strictEqual(fourth.allowed, false);
    assert.strictEqual(fourth.remaining, 0);
    assert.ok(fourth.resetAt > Date.now());
});

test('security: RateLimiter memisahkan hit per kunci', () => {
    const limiter = new RateLimiter({ windowMs: 60000, max: 1 });

    assert.strictEqual(limiter.consume('ip-1').allowed, true);
    assert.strictEqual(limiter.consume('ip-2').allowed, true, 'kunci lain punya kuota sendiri');
    assert.strictEqual(limiter.consume('ip-1').allowed, false);
});

test('security: RateLimiter menganggarkan kuota setelah jendela berakhir', () => {
    const limiter = new RateLimiter({ windowMs: 40, max: 1 });

    assert.strictEqual(limiter.consume('ip-1').allowed, true);
    assert.strictEqual(limiter.consume('ip-1').allowed, false);

    // Tunggu jendela waktu lewat.
    return new Promise((resolve) => {
        setTimeout(() => {
            assert.strictEqual(limiter.consume('ip-1').allowed, true);
            resolve();
        }, 60);
    });
});

// ===== SESSION =====

test('security: SessionStore membuat dan membaca sesi', () => {
    const store = new SessionStore();
    const id = store.create({ userId: 7, role: 'admin' });

    assert.ok(id);
    const data = store.get(id);
    assert.strictEqual(data.userId, 7);
    assert.strictEqual(data.role, 'admin');
});

test('security: SessionStore mengembalikan null untuk sesi tidak dikenal', () => {
    const store = new SessionStore();
    assert.strictEqual(store.get('tidak-ada'), null);
    assert.strictEqual(store.get(''), null);
    assert.strictEqual(store.get(null), null);
});

test('security: SessionStore.update memperbarui dan memperpanjang masa berlaku', () => {
    const store = new SessionStore({ ttl: 1000 });
    const id = store.create({ userId: 1 });

    assert.strictEqual(store.update(id, { role: 'editor' }), true);
    assert.strictEqual(store.get(id).role, 'editor');
    assert.strictEqual(store.get(id).userId, 1, 'field lama harus dipertahankan');
});

test('security: SessionStore.destroy menghapus sesi', () => {
    const store = new SessionStore();
    const id = store.create({ userId: 1 });

    assert.strictEqual(store.destroy(id), true);
    assert.strictEqual(store.get(id), null);
});

test('security: SessionStore membuang sesi kedaluwarsa', () => {
    const store = new SessionStore({ ttl: 30 });
    const id = store.create({ userId: 1 });

    return new Promise((resolve) => {
        setTimeout(() => {
            assert.strictEqual(store.get(id), null, 'sesi kedaluwarsa tidak boleh dibaca');
            resolve();
        }, 60);
    });
});

test('security: id sesi tidak memuat data sensitif', () => {
    const store = new SessionStore();
    const id = store.create({ password: 'rahasia', token: 'jwt-isi' });

    assert.ok(!id.includes('rahasia'));
    assert.ok(!id.includes('jwt-isi'));
    assert.ok(id.length >= 32, 'id sesi harus cukup panjang untuk acak');
});
