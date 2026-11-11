'use strict';

const { BonangError } = require('../core/runtime');

/**
 * Connection pool untuk SQLite.
 *
 * SQLite bersifat sinkron pada level driver, namun dengan connection pool
 * dan operasi kecil, latensinya tetap rendah. Pool membatasi jumlah
 * koneksi sehingga permintaan yang menumpuk tidak membuka koneksi tanpa
 * batas.
 *
 * Catatan arsitektur: node:sqlite menyediakan API sinkron. Agar tidak
 * memblokir event loop, driver dijalankan lewat `worker_threads` pada
 * implementasi MariaDB/MySQL (lihat `mysql-pool.js`). Untuk SQLite pada
 * mode ini, operasi tetap sinkron namun dibatasi lewat `busyTimeout`.
 */
class SQLitePool {
    constructor(options = {}) {
        this.filename = options.filename || ':memory:';
        this.max = options.max || 10;
        this.busyTimeout = options.busyTimeout || 5000;
        this.connections = [];
        this.idle = [];
        this.waiters = [];
        this.closed = false;
        this.stats = { acquired: 0, released: 0, created: 0, destroyed: 0 };
    }

    /**
     * Ambil koneksi dari pool. Menunggu bila semua koneksi sedang dipakai.
     */
    async acquire() {
        if (this.closed) {
            throw new BonangError('Connection pool sudah ditutup', 'POOL_CLOSED', 503);
        }

        let connection = this.idle.pop();
        if (!connection) {
            if (this.connections.length < this.max) {
                connection = this.createConnection();
                this.connections.push(connection);
                this.stats.created += 1;
            } else {
                // Semua koneksi terpakai — tunggu koneksi dilepas.
                connection = await new Promise((resolve, reject) => {
                    this.waiters.push({ resolve, reject });
                });
            }
        }

        this.stats.acquired += 1;
        return connection;
    }

    /** Kembalikan koneksi ke pool. */
    release(connection) {
        this.stats.released += 1;
        if (this.closed) {
            this.destroyConnection(connection);
            return;
        }
        const waiter = this.waiters.shift();
        if (waiter) {
            // Langsung serahkan ke waiter tanpa masukkan ke idle.
            waiter.resolve(connection);
            return;
        }
        this.idle.push(connection);
    }

    createConnection() {
        const { DatabaseSync } = require('node:sqlite');
        const db = new DatabaseSync(this.filename);
        db.exec(`PRAGMA busy_timeout = ${this.busyTimeout}`);
        if (this.filename !== ':memory:') {
            // WAL meningkatkan konkurensi reader/writer secara signifikan.
            db.exec('PRAGMA journal_mode = WAL');
        }
        db.exec('PRAGMA foreign_keys = ON');
        return db;
    }

    destroyConnection(connection) {
        try {
            connection.close();
        } catch {
            // Koneksi sudah tertutup — abaikan.
        }
        this.connections = this.connections.filter((c) => c !== connection);
        this.stats.destroyed += 1;
    }

    /**
     * Jalankan operasi dengan koneksi dari pool.
     * Koneksi selalu dikembalikan, termasuk saat operasi gagal.
     */
    async withConnection(fn) {
        const connection = await this.acquire();
        try {
            return await fn(connection);
        } finally {
            this.release(connection);
        }
    }

    /**
     * Jalankan query sederhana dan kembalikan semua baris.
     */
    async query(sql, params = []) {
        return this.withConnection((db) => {
            const stmt = db.prepare(sql);
            return stmt.all(...params);
        });
    }

    /**
     * Jalankan query dan kembalikan baris pertama.
     */
    async queryOne(sql, params = []) {
        return this.withConnection((db) => {
            const stmt = db.prepare(sql);
            return stmt.get(...params) ?? null;
        });
    }

    /**
     * Jalankan statement yang mengubah data.
     */
    async execute(sql, params = []) {
        return this.withConnection((db) => {
            const stmt = db.prepare(sql);
            return stmt.run(...params);
        });
    }

    /**
     * Jalankan sekumpulan statement dalam satu transaksi.
     * Rollback otomatis bila salah satu statement gagal.
     */
    async transaction(fn) {
        return this.withConnection(async (db) => {
            db.exec('BEGIN');
            try {
                const result = await fn({
                    query: (sql, params = []) => db.prepare(sql).all(...params),
                    queryOne: (sql, params = []) => db.prepare(sql).get(...params) ?? null,
                    execute: (sql, params = []) => db.prepare(sql).run(...params)
                });
                db.exec('COMMIT');
                return result;
            } catch (err) {
                try {
                    db.exec('ROLLBACK');
                } catch {
                    // Rollback gagal — transaksi mungkin sudah batal otomatis.
                }
                throw err;
            }
        });
    }

    /** Jalankan banyak insert dalam satu transaksi (bulk insert). */
    async bulkInsert(table, columns, rows) {
        if (rows.length === 0) return { changes: 0 };
        return this.transaction((tx) => {
            const placeholders = columns.map(() => '?').join(', ');
            const sql = `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`;
            let changes = 0;
            for (const row of rows) {
                const values = columns.map((c) => row[c]);
                const result = tx.execute(sql, values);
                changes += result.changes || 0;
            }
            return { changes };
        });
    }

    async close() {
        this.closed = true;
        for (const connection of this.connections) {
            try {
                connection.close();
            } catch {
                // abaikan
            }
        }
        this.connections = [];
        this.idle = [];
        for (const waiter of this.waiters) {
            waiter.reject(new BonangError('Connection pool ditutup', 'POOL_CLOSED', 503));
        }
        this.waiters = [];
    }

    getStats() {
        return {
            ...this.stats,
            total: this.connections.length,
            idle: this.idle.length,
            waiting: this.waiters.length
        };
    }
}

module.exports = { SQLitePool };
