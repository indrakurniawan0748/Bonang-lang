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

const core = require('./runtime/core/runtime');
const { Scheduler, WorkerPool, defaultScheduler } = require('./runtime/async/scheduler');
const { Server, Request, Response } = require('./runtime/http/server');
const { Router, matchPath } = require('./runtime/http/router');
const { SQLitePool } = require('./runtime/database/pool');
const { QueryBuilder, assertIdentifier } = require('./runtime/database/query-builder');
const security = require('./runtime/security/security');
const filesystem = require('./runtime/filesystem/files');
const { createHttpClient } = require('./runtime/network/http-client');

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
    db: {
        from: (pool, table) => QueryBuilder.from(pool, table)
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
