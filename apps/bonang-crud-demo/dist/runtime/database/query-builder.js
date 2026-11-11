'use strict';

/**
 * Query builder Bonang.
 *
 * Menghasilkan SQL berparameter (placeholder `?`) — tidak pernah menyisipkan
 * nilai user ke dalam string SQL. Nama kolom dan tabel divalidasi terhadap
 * pola identifier yang aman.
 */

const IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

// Jenis JOIN yang boleh dipakai — allowlist, bukan teks bebas.
const JOIN_TYPES = new Set(['INNER', 'LEFT', 'LEFT OUTER', 'CROSS']);

// Kondisi JOIN: dua nama kolom (opsional berawalan tabel) yang dibanding
// dengan operator=, sehingga tidak ada string bebas yang bisa disisipkan.
const JOIN_CONDITION_PATTERN =
    /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)?\s*=\s*[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)?$/;

/**
 * Pastikan nama kolom/tabel aman untuk disisipkan ke SQL.
 * Nilai user TIDAK boleh melewati fungsi ini — hanya nama struktural.
 */
function assertIdentifier(name, label = 'identifier') {
    if (typeof name !== 'string' || !IDENTIFIER_PATTERN.test(name)) {
        throw new Error(`Nama ${label} tidak valid: '${name}'`);
    }
    return name;
}

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
        this.wheres.push(sql);
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
        this.havings.push(sql);
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
    normalizeOperator,
    IDENTIFIER_PATTERN,
    JOIN_TYPES
};
