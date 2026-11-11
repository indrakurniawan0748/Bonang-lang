'use strict';

/**
 * Query builder Bonang.
 *
 * Menghasilkan SQL berparameter (placeholder `?`) — tidak pernah menyisipkan
 * nilai user ke dalam string SQL. Nama kolom dan tabel divalidasi terhadap
 * pola identifier yang aman.
 */

const { IDENTIFIER_PATTERN, assertIdentifier } = require('./identifiers');

// Jenis JOIN yang boleh dipakai — allowlist, bukan teks bebas.
const JOIN_TYPES = new Set(['INNER', 'LEFT', 'LEFT OUTER', 'CROSS']);

// Kondisi JOIN: dua nama kolom (opsional berawalan tabel) yang dibanding
// dengan operator=, sehingga tidak ada string bebas yang bisa disisipkan.
const JOIN_CONDITION_PATTERN =
    /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)?\s*=\s*[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)?$/;

/**
 * Validasi kondisi JOIN.
 *
 * Kondisi JOIN disisipkan mentah ke SQL (tidak bisa jadi placeholder), jadi
 * bentuknya dibatasi: hanya perbandingan dua nama kolom dengan `=`.
 */
function assertJoinCondition(condition) {
    if (typeof condition !== 'string' || !JOIN_CONDITION_PATTERN.test(condition.trim())) {
        throw new Error(`Kondisi JOIN tidak valid: '${condition}'`);
    }
    return condition.trim();
}

/**
 * Validasi SQL mentah pada `whereRaw`/`having`.
 *
 * SQL mentah tidak bisa di-parameterkan, jadi bentuknya dibatasi:
 *  - hanya satu statement (tidak boleh ada `;` di luar string literal),
 *  - jumlah placeholder `?` harus sama dengan jumlah parameter.
 *
 * Pemeriksaan kedua menutup kelas bug yang paling sering terjadi:
 * `whereRaw("x = ? AND y = ?", a)` — satu parameter hilang, sehingga
 * nilai_a terikat ke y dan具合 dari kondisi kedua salah.
 */
function assertRawSql(sql, paramCount) {
    if (typeof sql !== 'string' || sql.trim() === '') {
        throw new Error('SQL mentah tidak boleh kosong');
    }
    if (hasStatementSeparator(sql)) {
        throw new Error(
            'SQL mentah hanya boleh satu statement — pisahkan dengan query terpisah'
        );
    }
    const placeholders = countPlaceholders(sql);
    if (placeholders !== paramCount) {
        throw new Error(
            `Jumlah placeholder tidak cocok: SQL punya ${placeholders} placeholder, ` +
            `tapi ${paramCount} parameter diberikan`
        );
    }
    return sql;
}

/**
 * Deteksi `;` di luar string literal — tandastatement tambahan.
 */
function hasStatementSeparator(sql) {
    let quote = null;
    for (let i = 0; i < sql.length; i += 1) {
        const ch = sql[i];
        if (quote) {
            if (ch === '\\') {
                i += 1;
                continue;
            }
            if (ch === quote) quote = null;
            continue;
        }
        if (ch === "'" || ch === '"') {
            quote = ch;
            continue;
        }
        if (ch === ';') {
            // Titik koma di akhir SQL sah (percuma saja, tapi tidak berbahaya).
            const rest = sql.slice(i + 1).trim();
            if (rest !== '') return true;
        }
    }
    return false;
}

/**
 * Hitung placeholder `?` di luar string literal.
 */
function countPlaceholders(sql) {
    let count = 0;
    let quote = null;
    for (let i = 0; i < sql.length; i += 1) {
        const ch = sql[i];
        if (quote) {
            if (ch === '\\') {
                i += 1;
                continue;
            }
            if (ch === quote) quote = null;
            continue;
        }
        if (ch === "'" || ch === '"') {
            quote = ch;
            continue;
        }
        if (ch === '?') count += 1;
    }
    return count;
}

class QueryBuilder {
    constructor(pool, table) {
        this.pool = pool;
        this.table = assertIdentifier(table, 'tabel');
        this.selects = ['*'];
        this.wheres = [];
        this.params = [];
        this.orders = [];
        this.limitValue = null;
        this.offsetValue = null;
        this.joins = [];
        this.groupBys = [];
        this.havings = [];
        this.distinct = false;
    }

    static from(pool, table) {
        return new QueryBuilder(pool, table);
    }

    select(...fields) {
        this.selects = fields.flat().map((f) => {
            if (f === '*') return '*';
            return assertIdentifier(f, 'kolom');
        });
        return this;
    }

    distinct() {
        this.distinct = true;
        return this;
    }

    where(column, operator, value) {
        assertIdentifier(column, 'kolom');
        if (value === undefined) {
            value = operator;
            operator = '=';
        }
        const op = normalizeOperator(operator);
        this.wheres.push(`${column} ${op} ?`);
        this.params.push(value);
        return this;
    }

    whereNull(column) {
        assertIdentifier(column, 'kolom');
        this.wheres.push(`${column} IS NULL`);
        return this;
    }

    whereNotNull(column) {
        assertIdentifier(column, 'kolom');
        this.wheres.push(`${column} IS NOT NULL`);
        return this;
    }

    whereIn(column, values) {
        assertIdentifier(column, 'kolom');
        if (!Array.isArray(values) || values.length === 0) {
            // IN () tidak valid di SQL — gunakan kondisi yang selalu salah.
            this.wheres.push('1 = 0');
            return this;
        }
        this.wheres.push(`${column} IN (${values.map(() => '?').join(', ')})`);
        this.params.push(...values);
        return this;
    }

    whereLike(column, pattern) {
        assertIdentifier(column, 'kolom');
        this.wheres.push(`${column} LIKE ?`);
        this.params.push(pattern);
        return this;
    }

    whereBetween(column, min, max) {
        assertIdentifier(column, 'kolom');
        this.wheres.push(`${column} BETWEEN ? AND ?`);
        this.params.push(min, max);
        return this;
    }

    whereRaw(sql, ...params) {
        this.wheres.push(assertRawSql(sql, params.length));
        this.params.push(...params);
        return this;
    }

    join(table, onCondition, type = 'INNER') {
        assertIdentifier(table, 'tabel');
        assertJoinCondition(onCondition);
        const joinType = String(type).toUpperCase().trim();
        if (!JOIN_TYPES.has(joinType)) {
            throw new Error(`Jenis JOIN tidak valid: '${type}'`);
        }
        this.joins.push(`${joinType} JOIN ${table} ON ${onCondition.trim()}`);
        return this;
    }

    groupBy(...columns) {
        for (const c of columns.flat()) this.groupBys.push(assertIdentifier(c, 'kolom'));
        return this;
    }

    having(sql, ...params) {
        this.havings.push(assertRawSql(sql, params.length));
        this.params.push(...params);
        return this;
    }

    orderBy(column, direction = 'ASC') {
        assertIdentifier(column, 'kolom');
        const dir = String(direction).toUpperCase() === 'DESC' ? 'DESC' : 'ASC';
        this.orders.push(`${column} ${dir}`);
        return this;
    }

    limit(n) {
        this.limitValue = Math.max(0, parseInt(n, 10) || 0);
        return this;
    }

    offset(n) {
        this.offsetValue = Math.max(0, parseInt(n, 10) || 0);
        return this;
    }

    /** Susun WHERE clause dari objek sederhana {col: value}. */
    whereObject(obj) {
        for (const [key, value] of Object.entries(obj)) {
            if (value === null) this.whereNull(key);
            else if (value === undefined) continue;
            else this.where(key, '=', value);
        }
        return this;
    }

    buildSelect() {
        const parts = [];
        parts.push(`SELECT ${this.distinct ? 'DISTINCT ' : ''}${this.selects.join(', ')}`);
        parts.push(`FROM ${this.table}`);
        if (this.joins.length) parts.push(this.joins.join(' '));
        if (this.wheres.length) parts.push(`WHERE ${this.wheres.join(' AND ')}`);
        if (this.groupBys.length) parts.push(`GROUP BY ${this.groupBys.join(', ')}`);
        if (this.havings.length) parts.push(`HAVING ${this.havings.join(' AND ')}`);
        if (this.orders.length) parts.push(`ORDER BY ${this.orders.join(', ')}`);
        if (this.limitValue !== null) parts.push(`LIMIT ${this.limitValue}`);
        if (this.offsetValue !== null) parts.push(`OFFSET ${this.offsetValue}`);
        return parts.join(' ');
    }

    buildCount() {
        const parts = [];
        parts.push(`SELECT COUNT(*) as total FROM ${this.table}`);
        if (this.joins.length) parts.push(this.joins.join(' '));
        if (this.wheres.length) parts.push(`WHERE ${this.wheres.join(' AND ')}`);
        return parts.join(' ');
    }

    async get() {
        return this.pool.query(this.buildSelect(), this.params);
    }

    async first() {
        const sql = `${this.buildSelect()}${this.limitValue === null ? ' LIMIT 1' : ''}`;
        return this.pool.queryOne(sql, this.params);
    }

    async count() {
        const row = await this.pool.queryOne(this.buildCount(), this.params);
        return row ? Number(row.total) : 0;
    }

    /**
     * Jalankan query dengan paginasi dan metadata.
     */
    async paginate(page = 1, perPage = 10) {
        const currentPage = Math.max(1, parseInt(page, 10) || 1);
        const size = Math.min(Math.max(1, parseInt(perPage, 10) || 10), 100);

        const total = await this.count();
        const rows = await this.limit(size).offset((currentPage - 1) * size).get();

        return {
            data: rows,
            meta: {
                page: currentPage,
                perPage: size,
                total,
                totalPages: Math.ceil(total / size),
                hasNext: currentPage * size < total,
                hasPrev: currentPage > 1
            }
        };
    }

    /**
     * Paginasi keyset (cursor).
     *
     * Offset pagination harus menghitung `OFFSET n` — biaya query naik
     * seiring naiknya `n`, dan baris bisa bergeser di antara halaman bila
     * ada data yang masuk/keluar. Keyset pagination memakai "titik terakhir
     * yang dilihat" (cursor) sebagai titik awal, sehingga biaya query
     * tetap konstan dan halaman tidak saling tumpang tindih.
     *
     * Determinisme
     * ------------
     * Satu kolom pengurutan sering punya nilai yang sama pada beberapa
     * baris (mis. `created_at` dalam detik yang sama). Cursor satu kolom
     * lalu bisa melompati atau mengulang baris. Karena itu keyset memakai
     * **dua** kolom: kolom utama (`orderColumn`) plus kolom penyeimbang
     * (`tieColumn`, default `id`) yang harus unik.
     *
     * Kondisi cursor untuk arah ASC:
     *   (a > ?) OR (a = ? AND b > ?)
     * Arah DESC memakai `<`. Nilai keduanya tetap berparameter.
     *
     * @param {object} cursor  { [kolom]: nilai } titik awal, boleh null.
     * @param {number} perPage jumlah baris per halaman.
     * @param {object} options { orderColumn, tieColumn, direction }.
     */
    async paginateByCursor(cursor, perPage = 10, options = {}) {
        const size = Math.min(Math.max(1, parseInt(perPage, 10) || 10), 100);
        const orderColumn = assertIdentifier(options.orderColumn || 'id', 'kolom');
        const tieColumn = assertIdentifier(options.tieColumn || 'id', 'kolom');
        const direction = String(options.direction || 'ASC').toUpperCase() === 'DESC' ? 'DESC' : 'ASC';
        const comparison = direction === 'DESC' ? '<' : '>';

        const hasOrder = cursor && cursor[orderColumn] !== undefined && cursor[orderColumn] !== null;
        const hasTie = cursor && cursor[tieColumn] !== undefined && cursor[tieColumn] !== null;

        if (hasOrder && hasTie) {
            // (a > ?) OR (a = ? AND b > ?) — dua placeholder untuk a,
            // satu untuk b. Semua nilainya berparameter.
            this.whereRaw(
                `(${orderColumn} ${comparison} ?) OR (${orderColumn} = ? AND ${tieColumn} ${comparison} ?)`,
                cursor[orderColumn], cursor[orderColumn], cursor[tieColumn]
            );
        } else if (hasOrder) {
            this.where(orderColumn, comparison, cursor[orderColumn]);
        }

        this.orderBy(orderColumn, direction);
        this.orderBy(tieColumn, direction);
        // Ambil satu baris lebih untuk mengetahui apakah ada halaman berikutnya
        // tanpa menjalankan COUNT(*) — COUNT pada tabel besar mahal.
        this.limit(size + 1);

        const rows = await this.get();
        const hasNext = rows.length > size;
        const data = hasNext ? rows.slice(0, size) : rows;

        let nextCursor = null;
        if (hasNext && data.length > 0) {
            const last = data[data.length - 1];
            nextCursor = { [orderColumn]: last[orderColumn], [tieColumn]: last[tieColumn] };
        }

        return {
            data,
            meta: {
                perPage: size,
                hasNext,
                nextCursor
            }
        };
    }
}

/**
 * Normalisasi operator agar hanya nilai yang dikenal yang sampai ke SQL.
 */
function normalizeOperator(operator) {
    const allowed = ['=', '!=', '<>', '<', '<=', '>', '>=', 'LIKE', 'NOT LIKE', 'IS', 'IS NOT'];
    const upper = String(operator).toUpperCase().trim();
    if (allowed.includes(upper)) return upper;
    if (upper === '!=') return '!=';
    if (upper === '<>') return '!=';
    throw new Error(`Operator tidak diizinkan: '${operator}'`);
}

module.exports = {
    QueryBuilder,
    assertIdentifier,
    assertJoinCondition,
    assertRawSql,
    normalizeOperator,
    IDENTIFIER_PATTERN,
    JOIN_TYPES
};
