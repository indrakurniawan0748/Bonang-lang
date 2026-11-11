'use strict';

/**
 * Standard library Bonang.
 *
 * Koleksi fungsi siap pakai yang tidak bergantung pada platform tertentu.
 * Semua modul ini murni (tanpa I/O) kecuali yang ditandai jelas, sehingga
 * bisa dipakai di server maupun browser.
 */

// ===== STRING =====

const strings = {
    /** Huruf pertama menjadi kapital. */
    capitalize(value) {
        const text = String(value ?? '');
        return text.charAt(0).toUpperCase() + text.slice(1);
    },

    /** Ubah teks menjadi kebab-case. */
    kebabCase(value) {
        return String(value ?? '')
            .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
            .replace(/[\s_]+/g, '-')
            .toLowerCase();
    },

    /** Ubah teks menjadi snake_case. */
    snakeCase(value) {
        return String(value ?? '')
            .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
            .replace(/[\s-]+/g, '_')
            .toLowerCase();
    },

    /** Ubah teks menjadi camelCase. */
    camelCase(value) {
        const parts = String(value ?? '').split(/[^A-Za-z0-9]+/).filter(Boolean);
        return parts
            .map((part, index) => (index === 0
                ? part.toLowerCase()
                : part.charAt(0).toUpperCase() + part.slice(1).toLowerCase()))
            .join('');
    },

    /** Potong teks dengan ellipsis bila melebihi panjang maksimum. */
    truncate(value, max = 80) {
        const text = String(value ?? '');
        return text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1))}…`;
    },

    /** Buang spasi ganda dan trim. */
    normalizeWhitespace(value) {
        return String(value ?? '').replace(/\s+/g, ' ').trim();
    },

    /** Slug aman untuk URL. */
    slug(value) {
        return String(value ?? '')
            .normalize('NFKD')
            .replace(/[̀-ͯ]/g, '')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '');
    },

    /** Mask sebagian string, misalnya untuk menyamarkan kartu kredit. */
    mask(value, visibleStart = 0, visibleEnd = 4, char = '*') {
        const text = String(value ?? '');
        if (text.length <= visibleStart + visibleEnd) return text;
        const head = text.slice(0, visibleStart);
        const tail = visibleEnd > 0 ? text.slice(-visibleEnd) : '';
        const hidden = char.repeat(Math.max(0, text.length - visibleStart - visibleEnd));
        return head + hidden + tail;
    }
};

// ===== VALIDASI =====

const validation = {
    /** Nomor telepon Indonesia: awalan 62/0 lalu 8-13 digit. */
    isIndonesianPhone(value) {
        return /^(?:\+62|62|0)\d{8,13}$/.test(String(value ?? '').replace(/[\s-]/g, ''));
    },

    /** Nomor NPWP format Indonesia. */
    isNpwp(value) {
        return /^\d{2}\.\d{3}\.\d{3}\.\-\d{3}\.\d{3}$/.test(String(value ?? '').trim());
    },

    /** Nilai numerik dalam rentang tertentu. */
    isInRange(value, min, max) {
        const num = Number(value);
        return Number.isFinite(num) && num >= min && num <= max;
    },

    /** Objek tanpa properti bernilai null/undefined. */
    isEmpty(value) {
        if (value === null || value === undefined) return true;
        if (typeof value === 'string' || Array.isArray(value)) return value.length === 0;
        if (typeof value === 'object') return Object.keys(value).length === 0;
        return false;
    }
};

// ===== FORMAT =====

const format = {
    /** Rupiah tanpa pemisah. */
    rupiah(value) {
        const num = Math.round(Number(value) || 0);
        return `Rp${num.toLocaleString('id-ID')}`;
    },

    /** Angka dengan pemisah ribuan. */
    number(value, decimals = 0) {
        const num = Number(value) || 0;
        return num.toLocaleString('id-ID', {
            minimumFractionDigits: decimals,
            maximumFractionDigits: decimals
        });
    },

    /** Tanggal menjadi format `YYYY-MM-DD`. */
    isoDate(value) {
        const date = value instanceof Date ? value : new Date(value);
        if (Number.isNaN(date.getTime())) return '';
        return date.toISOString().slice(0, 10);
    },

    /** Tanggal menjadi format lokal Indonesia. */
    longDate(value) {
        const date = value instanceof Date ? value : new Date(value);
        if (Number.isNaN(date.getTime())) return '';
        return date.toLocaleDateString('id-ID', {
            day: 'numeric', month: 'long', year: 'numeric'
        });
    },

    /** Selisih waktu menjadi teks ringkas ("2 jam lalu"). */
    relativeTime(value, now = Date.now()) {
        const date = value instanceof Date ? value : new Date(value);
        const diff = now - date.getTime();
        const seconds = Math.round(diff / 1000);
        if (Number.isNaN(seconds)) return '';
        const units = [
            ['tahun', 31536000],
            ['bulan', 2592000],
            ['hari', 86400],
            ['jam', 3600],
            ['menit', 60],
            ['detik', 1]
        ];
        for (const [label, size] of units) {
            if (Math.abs(seconds) >= size) {
                const count = Math.round(seconds / size);
                return `${count} ${label} ${count < 0 ? 'lagi' : 'lalu'}`;
            }
        }
        return 'baru saja';
    },

    /** Ukuran byte menjadi teks yang mudah dibaca. */
    bytes(value) {
        const num = Number(value) || 0;
        const units = ['B', 'KB', 'MB', 'GB', 'TB'];
        let index = 0;
        let size = num;
        while (size >= 1024 && index < units.length - 1) {
            size /= 1024;
            index += 1;
        }
        return `${Math.round(size * 100) / 100} ${units[index]}`;
    }
};

// ===== KOLEKSI =====

const collections = {
    /** Kelompokkan array berdasarkan fungsi key. */
    groupBy(items, keyFn) {
        const out = {};
        for (const item of items || []) {
            const key = keyFn(item);
            if (!out[key]) out[key] = [];
            out[key].push(item);
        }
        return out;
    },

    /** Pecah array menjadi potongan berukuran tertentu. */
    chunk(items, size) {
        const out = [];
        const step = Math.max(1, size);
        for (let i = 0; i < (items || []).length; i += step) {
            out.push(items.slice(i, i + step));
        }
        return out;
    },

    /** Urutkan objek berdasarkan kunci, stabil dan tanpa mengubah aslinya. */
    sortBy(items, keyFn, direction = 'asc') {
        const sign = direction === 'desc' ? -1 : 1;
        return [...(items || [])].sort((a, b) => {
            const ka = keyFn(a);
            const kb = keyFn(b);
            if (ka < kb) return -1 * sign;
            if (ka > kb) return 1 * sign;
            return 0;
        });
    },

    /** Ambil nilai unik berdasarkan key. */
    uniqueBy(items, keyFn) {
        const seen = new Set();
        const out = [];
        for (const item of items || []) {
            const key = keyFn(item);
            if (seen.has(key)) continue;
            seen.add(key);
            out.push(item);
        }
        return out;
    },

    /** Jumlahkan nilai numerik dari array objek. */
    sumBy(items, keyFn) {
        let total = 0;
        for (const item of items || []) total += Number(keyFn(item)) || 0;
        return total;
    },

    /** Rata-rata nilai numerik dari array objek. */
    avgBy(items, keyFn) {
        const list = items || [];
        if (list.length === 0) return 0;
        return collections.sumBy(list, keyFn) / list.length;
    }
};

// ===== ID =====

const ids = {
    /** Pengenal acak berformat UUID v4. */
    uuid() {
        const { randomUUID } = require('node:crypto');
        return randomUUID();
    },

    /** Token acak heksadesimal. */
    randomToken(length = 32) {
        const { randomBytes } = require('node:crypto');
        return randomBytes(Math.ceil(length / 2)).toString('hex').slice(0, length);
    },

    /** Kode acak untuk OTP. */
    otp(length = 6) {
        const { randomInt } = require('node:crypto');
        let code = '';
        for (let i = 0; i < length; i++) {
            code += String(randomInt(0, 10));
        }
        return code;
    }
};

module.exports = {
    strings,
    validation,
    format,
    collections,
    ids,
    // Ekspor datar agar mudah dipakai: `import { rupiah } from "bonang/std"`.
    ...strings,
    ...validation,
    ...format,
    ...collections,
    ...ids
};
