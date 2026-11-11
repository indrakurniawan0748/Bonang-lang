'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { SQLitePool } = require('../runtime/database/pool');

/**
 * Runner migrasi database Bonang.
 *
 * Migrasi disimpan sebagai file `.bng` di folder `migrations/`. Setiap
 * migrasi memiliki fungsi `up` dan (opsional) `down`.
 *
 * Urutan migrasi dicatat di tabel `bonang_migrations` sehingga migrasi
 * tidak dijalankan dua kali.
 */
async function runMigrations(options = {}) {
    const { root, config, direction = 'up' } = options;

    const dbConfig = config.database || {};
    if (dbConfig.driver && dbConfig.driver !== 'sqlite') {
        throw new Error(`Driver '${dbConfig.driver}' belum didukung untuk migrasi. Saat ini hanya 'sqlite'.`);
    }

    const dbFile = path.resolve(root, dbConfig.file || 'data/bonang.db');
    fs.mkdirSync(path.dirname(dbFile), { recursive: true });

    const pool = new SQLitePool({ filename: dbFile });
    const applied = [];
    const skipped = [];

    try {
        await pool.execute(`
            CREATE TABLE IF NOT EXISTS bonang_migrations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE,
                applied_at TEXT NOT NULL
            )
        `);

        const migrationsDir = path.resolve(root, 'migrations');
        if (!fs.existsSync(migrationsDir)) {
            return { direction, applied, skipped };
        }

        const { Compiler } = require('../compiler/compiler');
        const { createRequire } = require('../compiler/compiler');
        const compiler = new Compiler();

        const files = fs.readdirSync(migrationsDir)
            .filter((f) => f.endsWith('.bng'))
            .sort();

        const executed = await pool.query('SELECT name FROM bonang_migrations');
        const appliedNames = new Set(executed.map((r) => r.name));

        for (const file of files) {
            const name = file.replace(/\.bng$/, '');

            if (direction === 'up' && appliedNames.has(name)) {
                skipped.push({ name, reason: 'sudah diterapkan' });
                continue;
            }

            const filePath = path.join(migrationsDir, file);
            const source = fs.readFileSync(filePath, 'utf8');

            try {
                const result = compiler.compile(source, filePath);
                const moduleObj = { exports: {} };
                const fn = new Function('module', 'exports', 'require', '__filename', '__dirname', result.code);
                fn(moduleObj, moduleObj.exports, createRequire(filePath), filePath, path.dirname(filePath));

                if (direction === 'up') {
                    if (typeof moduleObj.exports.up !== 'function') {
                        throw new Error('Migrasi harus mengekspor fungsi `up`');
                    }
                    await moduleObj.exports.up({
                        query: (sql, params = []) => pool.query(sql, params),
                        queryOne: (sql, params = []) => pool.queryOne(sql, params),
                        execute: (sql, params = []) => pool.execute(sql, params)
                    });
                    await pool.execute(
                        'INSERT INTO bonang_migrations (name, applied_at) VALUES (?, ?)',
                        [name, new Date().toISOString()]
                    );
                } else {
                    if (typeof moduleObj.exports.down !== 'function') {
                        skipped.push({ name, reason: 'tidak punya fungsi down' });
                        continue;
                    }
                    await moduleObj.exports.down({
                        query: (sql, params = []) => pool.query(sql, params),
                        queryOne: (sql, params = []) => pool.queryOne(sql, params),
                        execute: (sql, params = []) => pool.execute(sql, params)
                    });
                    await pool.execute('DELETE FROM bonang_migrations WHERE name = ?', [name]);
                }

                applied.push({ name, file });
            } catch (err) {
                throw new Error(`Migrasi '${name}' gagal: ${err.message}`);
            }
        }
    } finally {
        await pool.close();
    }

    return { direction, applied, skipped };
}

module.exports = { runMigrations };
