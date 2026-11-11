'use strict';

const { ValidationError, NotFoundError, BonangError } = require('../core/runtime');

/**
 * Router Bonang.
 *
 * Mendukung path parameter (`:id`), wildcard (`*`), dan middleware per route.
 * Pencocokan dilakukan berurutan; route dengan parameter lebih spesifik
 * dievaluasi lebih dulu.
 */
class Router {
    constructor() {
        this.routes = [];
        this.middleware = [];
    }

    /** Middleware global yang berjalan untuk semua route. */
    use(fn) {
        this.middleware.push(fn);
        return this;
    }

    add(method, path, handler, routeOptions = {}) {
        this.routes.push({
            method: method.toUpperCase(),
            path,
            handler,
            middleware: routeOptions.middleware || [],
            meta: routeOptions.meta || {}
        });
        return this;
    }

    get(path, handler, options) { return this.add('GET', path, handler, options); }
    post(path, handler, options) { return this.add('POST', path, handler, options); }
    put(path, handler, options) { return this.add('PUT', path, handler, options); }
    patch(path, handler, options) { return this.add('PATCH', path, handler, options); }
    delete(path, handler, options) { return this.add('DELETE', path, handler, options); }
    all(path, handler, options) { return this.add('*', path, handler, options); }

    /**
     * Cari route yang cocok dengan method dan path.
     * Mengembalikan {route, params} atau null.
     */
    match(method, path) {
        const upperMethod = method.toUpperCase();
        const normalizedPath = normalizePath(path);

        let wildcard = null;
        for (const route of this.routes) {
            const params = matchPath(route.path, normalizedPath);
            if (params === null) continue;

            if (route.method === upperMethod || route.method === '*') {
                return { route, params };
            }
            // Simpan wildcard untuk pesan "method not allowed" yang lebih akurat.
            if (!wildcard) wildcard = { route, params };
        }

        if (wildcard) {
            return { route: wildcard.route, params: wildcard.params, methodMismatch: true };
        }
        return null;
    }

    /**
     * Jalankan handler route dan seluruh middleware.
     */
    async handle(ctx) {
        const matched = this.match(ctx.method, ctx.path);

        if (!matched) {
            throw new NotFoundError(`Route ${ctx.method} ${ctx.path} tidak ditemukan`);
        }
        if (matched.methodMismatch) {
            throw new BonangError(
                `Method ${ctx.method} tidak diizinkan untuk ${ctx.path}`,
                'METHOD_NOT_ALLOWED',
                405
            );
        }

        ctx.params = matched.params;
        ctx.route = matched.route;

        // Rantai middleware: global lalu per-route.
        const chain = [...this.middleware, ...matched.route.middleware, matched.route.handler];
        let index = -1;

        const next = async () => {
            index += 1;
            if (index >= chain.length) return undefined;
            const fn = chain[index];
            try {
                return await fn(ctx, next);
            } catch (err) {
                // Middleware boleh menghentikan rantai dengan melempar error.
                throw err;
            }
        };

        return next();
    }

    /** Daftar route untuk keperluan diagnostics dan audit. */
    list() {
        return this.routes.map((r) => ({
            method: r.method,
            path: r.path,
            middleware: r.middleware.length
        }));
    }
}

/**
 * Normalisasi path: hapus trailing slash (kecuali root) dan query string.
 */
function normalizePath(path) {
    let p = path.split('?')[0];
    if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
    return p || '/';
}

/**
 * Cocokkan path dengan template route.
 *
 * Template: `/products/:id` -> params {id}, `/files/*` -> wildcard.
 * Mengembalikan objek params, atau null bila tidak cocok.
 */
function matchPath(template, path) {
    const templateParts = template.split('/').filter((p) => p !== '');
    const pathParts = path.split('/').filter((p) => p !== '');

    const params = {};

    for (let i = 0; i < templateParts.length; i++) {
        const tpl = templateParts[i];

        if (tpl === '*') {
            params['*'] = pathParts.slice(i).join('/');
            return params;
        }

        if (i >= pathParts.length) return null;

        if (tpl.startsWith(':')) {
            params[tpl.slice(1)] = decodeURIComponent(pathParts[i]);
            continue;
        }

        if (tpl !== pathParts[i]) return null;
    }

    if (pathParts.length !== templateParts.length) return null;
    return params;
}

module.exports = { Router, matchPath, normalizePath };
