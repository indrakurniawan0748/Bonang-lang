'use strict';

const { BonangError } = require('../core/runtime');

/**
 * Soft delete untuk Bonang.
 *
 * Penghapusan permanen menghancurkan data yang mungkin masih dibutuhkan:
 * laporan lama, riwayat audit, atau sinkronisasi antar-perangkat yang
 * belum sempat menerima perubahan. Soft delete menandai baris sebagai
 * terhapus (mengisi kolom `deleted_at`) alih-alih menghapusnya, sehingga
 * data masih bisa dipulihkan.
 *
 * ## Batasan yang disengaja
 *
 *  - Kolom penanda harus ada di tabel. Modul ini **tidak** menambah kolom
 *    secara otomatis — skema tabel milik aplikasi, dan menambah kolom
 *    diam-diam bisa merusak tabel yang sudah berisi data.
 *  - Query biasa (`SELECT` tanpa filter soft delete) **tetap** mengembalikan
 *    baris terhapus.-application yang mau menyaringnya harus memanggil
 *    `withDeleted(false)` atau menambah kondisinya sendiri. Menyaring
 *    otomatis akan membuat baris terhapus tak terlihat tanpa jejak — lebih
 *    buruk daripada terlihat.
 *  - `restore()` dan `purge()` harus dipanggil eksplisit.
 */

const { IDENTIFIER_PATTERN, assertIdentifier } = require('./identifiers');

/**
 * Nama kolom penanda soft delete bawaan.
 */
const DEFAULT_DELETED_AT = 'deleted_at';

/**
 * Repository dengan dukungan soft delete.
 *
 * Repository ini jadi lapisan tipis di atas pool: ia menambah kolom
 * penanda, menyaring baris terhapus dari query baca, dan mengubah
 * `remove()` menjadi penandaan.
 *
 * @example
 *   const repo = new SoftDeleteRepository(pool, 'products');
 *   await repo.ensureSoftDeleteColumn();
 *   await repo.create({ name: 'Madu' });
 *   await repo.remove(1);              // tidak menghapus baris
 *   await repo.findAll();              // baris terhapus tidak muncul
 *   await repo.restore(1);             // dikembalikan
 *   await repo.purge(1);               // dihapus permanen
 */
class SoftDeleteRepository {
    /**
     * @param {object} pool   pool database (memiliki `query`/`execute`).
     * @param {string} table  nama tabel.
     * @param {object} options { deletedAtColumn, includeDeleted }.
     */
    constructor(pool, table, options = {}) {
        // Validasi identifier didahulukan: nama tabel/kolom disisipkan ke
        // SQL, jadi harus diperiksa sebelum apa pun yang lain.
        this.table = assertIdentifier(table, 'tabel');
        this.deletedAtColumn = assertIdentifier(
            options.deletedAtColumn || DEFAULT_DELETED_AT,
            'kolom penanda'
        );
        if (!pool || typeof pool.query !== 'function' || typeof pool.execute !== 'function') {
            throw new BonangError('Pool database tidak valid untuk soft delete', 'INVALID_POOL', 500);
        }
        this.pool = pool;
        // `includeDeleted` menentukan perilaku default semua query baca.
        this.includeDeleted = Boolean(options.includeDeleted);
    }

    /**
     * Pastikan tabel punya kolom penanda soft delete.
     *
     * Kolom ditambahkan bila belum ada. Tabel yang sudah punya kolom
     * dengan nama sama tidak diubah.
     */
    async ensureSoftDeleteColumn() {
        const columns = await this.pool.query(`PRAGMA table_info(${this.table})`);
        const exists = columns.some((c) => c.name === this.deletedAtColumn);
        if (exists) return false;
        await this.pool.execute(
            `ALTER TABLE ${this.table} ADD COLUMN ${this.deletedAtColumn} TEXT`
        );
        return true;
    }

    /**
     * Bangun klausa WHERE untuk menyaring baris terhapus.
     */
    buildNotDeletedFilter() {
        return `${this.deletedAtColumn} IS NULL`;
    }

    /**
     * Ambil semua baris.
     */
    async findAll(options = {}) {
        const filters = [];
        const params = [];

        if (options.includeDeleted) {
            // Sengaja tidak difilter — pemanggil meminta semua baris.
        } else if (!this.includeDeleted) {
            filters.push(this.buildNotDeletedFilter());
        }

        if (options.where) {
            filters.push(options.where);
            if (Array.isArray(options.params)) params.push(...options.params);
        }

        const where = filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : '';
        const limit = Math.min(Math.max(Number(options.limit) || 50, 1), 200);
        const offset = Math.max(Number(options.offset) || 0, 0);

        const rows = await this.pool.query(
            `SELECT * FROM ${this.table} ${where} ORDER BY id DESC LIMIT ? OFFSET ?`,
            [...params, limit, offset]
        );

        const totalRow = await this.pool.queryOne(
            `SELECT COUNT(*) AS total FROM ${this.table} ${where}`,
            params
        );

        return {
            items: rows,
            total: totalRow ? totalRow.total : 0,
            limit,
            offset
        };
    }

    /**
     * Ambil satu baris berdasarkan id.
     */
    async findById(id, options = {}) {
        const includeDeleted = options.includeDeleted === true || this.includeDeleted;
        const where = includeDeleted
            ? 'id = ?'
            : `id = ? AND ${this.buildNotDeletedFilter()}`;
        const row = await this.pool.queryOne(
            `SELECT * FROM ${this.table} WHERE ${where}`,
            [Number(id)]
        );
        return row || null;
    }

    /**
     * Simpan baris baru.
     */
    async create(data) {
        const now = new Date().toISOString();
        const keys = Object.keys(data).filter((k) => IDENTIFIER_PATTERN.test(k));
        if (keys.length === 0) {
            throw new BonangError('Tidak ada kolom untuk disimpan', 'VALIDATION_ERROR', 400);
        }
        const columns = keys.map((k) => assertIdentifier(k, 'kolom'));
        const placeholders = columns.map(() => '?').join(', ');
        const values = keys.map((k) => data[k]);

        const result = await this.pool.execute(
            `INSERT INTO ${this.table} (${columns.join(', ')}) VALUES (${placeholders})`,
            values
        );
        return this.findById(result.lastInsertRowid, { includeDeleted: true });
    }

    /**
     * Perbarui baris yang ada.
     */
    async update(id, data) {
        const keys = Object.keys(data).filter((k) => IDENTIFIER_PATTERN.test(k));
        if (keys.length === 0) return null;

        const assignments = keys.map((k) => `${assertIdentifier(k, 'kolom')} = ?`).join(', ');
        const values = keys.map((k) => data[k]);

        await this.pool.execute(
            `UPDATE ${this.table} SET ${assignments} WHERE id = ?`,
            [...values, Number(id)]
        );
        return this.findById(id);
    }

    /**
     * Tandai baris sebagai terhapus (bukan hapus permanen).
     */
    async remove(id) {
        const result = await this.pool.execute(
            `UPDATE ${this.table} SET ${this.deletedAtColumn} = ? WHERE id = ? AND ${this.deletedAtColumn} IS NULL`,
            [new Date().toISOString(), Number(id)]
        );
        return result.changes > 0;
    }

    /**
     * Kembalikan baris yang sebelumnya ditandai terhapus.
     */
    async restore(id) {
        const result = await this.pool.execute(
            `UPDATE ${this.table} SET ${this.deletedAtColumn} = NULL WHERE id = ?`,
            [Number(id)]
        );
        return result.changes > 0;
    }

    /**
     * Hapus baris secara permanen — tidak bisa dibatalkan.
     */
    async purge(id) {
        const result = await this.pool.execute(
            `DELETE FROM ${this.table} WHERE id = ?`,
            [Number(id)]
        );
        return result.changes > 0;
    }

    /**
     * Hapus permanen semua baris yang ditandai terhapus.
     *
     * Mengembalikan jumlah baris yang dihapus.
     */
    async purgeAll() {
        const result = await this.pool.execute(
            `DELETE FROM ${this.table} WHERE ${this.deletedAtColumn} IS NOT NULL`
        );
        return result.changes;
    }

    /**
     * Hitung baris yang masih aktif (tidak terhapus).
     */
    async countActive() {
        const row = await this.pool.queryOne(
            `SELECT COUNT(*) AS total FROM ${this.table} WHERE ${this.buildNotDeletedFilter()}`
        );
        return row ? Number(row.total) : 0;
    }

    /**
     * Hitung baris yang sudah ditandai terhapus.
     */
    async countDeleted() {
        const row = await this.pool.queryOne(
            `SELECT COUNT(*) AS total FROM ${this.table} WHERE ${this.deletedAtColumn} IS NOT NULL`
        );
        return row ? Number(row.total) : 0;
    }
}

/**
 * Fungsi helper untuk menambah kolom soft delete ke skema tabel.
 *
 * Dipakai saat `ensureSchema()` di repository biasa:
 *
 *   await addSoftDeleteColumn(pool, 'products');
 *
 * @returns {Promise<boolean>} true bila kolom baru ditambahkan.
 */
async function addSoftDeleteColumn(pool, table, options = {}) {
    const repo = new SoftDeleteRepository(pool, table, options);
    return repo.ensureSoftDeleteColumn();
}

module.exports = {
    SoftDeleteRepository,
    addSoftDeleteColumn,
    assertIdentifier,
    DEFAULT_DELETED_AT
};
