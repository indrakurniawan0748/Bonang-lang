'use strict';

/**
 * Entry point runtime Bonang.
 *
 * Kode Bonang mengimpor API ini melalui `import { ... } from "bonang"` yang
 * oleh compiler diarahkan ke modul ini.
 *
 * Modularisasi: modul ini hanya merangkai sub-modul runtime, tidak
 * mengimplementasikan logika itu sendiri.
 */

const core = require('./core/runtime');
const { Scheduler, WorkerPool, defaultScheduler } = require('./async/scheduler');
const { Server, Request, Response } = require('./http/server');
const { Router, matchPath } = require('./http/router');
const { SQLitePool } = require('./database/pool');
const { QueryBuilder, assertIdentifier } = require('./database/query-builder');
const { SoftDeleteRepository, addSoftDeleteColumn } = require('./database/soft-delete');
const security = require('./security/security');
const filesystem = require('./filesystem/files');
const { createHttpClient } = require('./network/http-client');

module.exports = {
    // Core
    ...core,

    // Async
    Scheduler,
    WorkerPool,
    defaultScheduler,

    // HTTP
    Server,
    Request,
    Response,
    Router,

    // Database
    SQLitePool,
    QueryBuilder,
    SoftDeleteRepository,
    addSoftDeleteColumn,
    db: {
        from: (pool, table) => QueryBuilder.from(pool, table),
        softDelete: (pool, table, options) => new SoftDeleteRepository(pool, table, options)
    },

    // Security
    ...security,

    // Filesystem
    ...filesystem,

    // Network
    createHttpClient,

    /**
     * Buat server Bonang.
     */
    createServer(options = {}) {
        return new Server(options);
    },

    /**
     * Buat router Bonang.
     */
    createRouter() {
        return new Router();
    },

    /**
     * Buat connection pool database.
     */
    createPool(options = {}) {
        return new SQLitePool(options);
    }
};
