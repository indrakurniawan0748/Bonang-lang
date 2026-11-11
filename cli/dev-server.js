'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { Compiler } = require('../compiler/compiler');

/**
 * Development server Bonang.
 *
 * Menjalankan server HTTP, sekaligus memantau perubahan file untuk hot reload.
 * Modul sumber dikompilasi ulang ketika berubah, dan browser di-informasikan
 * via SSE (Server-Sent Events) untuk memuat ulang halaman.
 */
class DevServer {
    constructor(options = {}) {
        this.root = options.root || process.cwd();
        this.config = options.config || {};
        this.configPath = options.configPath;
        this.compiler = new Compiler();
        this.server = null;
        this.clients = new Set();
        this.watchers = [];
        this.debounceTimer = null;
        this.restartTimer = null;
    }

    async start() {
        const port = this.config.port || 3000;
        const { Server } = require('../runtime/http/server');

        this.server = new Server({
            port,
            host: this.config.host || '127.0.0.1',
            logger: createQuietLogger()
        });

        // Route hot reload harus dipasang sebelum route aplikasi.
        this.server.router.get('/__bonang/live', (ctx) => {
            ctx.response.raw.writeHead(200, {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                Connection: 'keep-alive',
                'X-Content-Type-Options': 'nosniff'
            });
            ctx.response.raw.write(': connected\n\n');
            ctx.response.finished = true;

            this.clients.add(ctx.response.raw);
            ctx.response.raw.on('close', () => {
                this.clients.delete(ctx.response.raw);
            });
        });

        this.server.router.get('/__bonang/status', () => ({
            status: 'running',
            watched: this.watchers.length
        }));

        // Route aplikasi dimuat dari file handler yang dikonfigurasi.
        await this.loadApplicationRoutes();

        await this.server.listen(port);
        this.startWatching();

        console.log(`\n  Bonang dev server`);
        console.log(`  ➜  http://localhost:${port}`);
        console.log(`  ➜  project: ${this.root}`);
        console.log(`  ➜  hot reload aktif — tekan Ctrl+C untuk berhenti\n`);

        // Tutup dengan rapi saat proses dihentikan.
        const shutdown = async () => {
            console.log('\nMenghentikan dev server...');
            await this.stop();
            process.exit(0);
        };
        process.on('SIGINT', shutdown);
        process.on('SIGTERM', shutdown);
    }

    /**
     * Muat route aplikasi dari file handler.
     */
    async loadApplicationRoutes() {
        const routesFile = this.config.routes
            ? path.resolve(this.root, this.config.routes)
            : null;

        if (!routesFile || !fs.existsSync(routesFile)) {
            // Tanpa file route, sediakan route bawaan yang berguna.
            this.server.router.get('/', () => ({
                name: this.config.name || 'Bonang App',
                message: 'Dev server aktif. Tambahkan file route untuk API.',
                endpoints: ['/__bonang/status', '/__bonang/live']
            }));
            return;
        }

        try {
            const source = fs.readFileSync(routesFile, 'utf8');
            const result = this.compiler.compile(source, routesFile);
            const moduleObj = { exports: {} };
            const { createRequire } = require('../compiler/compiler');
            const fn = new Function('module', 'exports', 'require', '__filename', '__dirname', result.code);
            fn(moduleObj, moduleObj.exports, createRequire(routesFile), routesFile, path.dirname(routesFile));

            if (typeof moduleObj.exports.registerRoutes === 'function') {
                moduleObj.exports.registerRoutes(this.server);
            }
        } catch (err) {
            console.error(`Gagal memuat routes: ${err.message}`);
        }
    }

    /**
     * Pantau perubahan file sumber.
     */
    startWatching() {
        const srcDir = path.resolve(this.root, 'src');
        if (!fs.existsSync(srcDir)) return;

        try {
            const watcher = fs.watch(srcDir, { recursive: true }, (eventType, filename) => {
                if (!filename || !filename.endsWith('.bng')) return;
                this.onChange(filename);
            });
            this.watchers.push(watcher);
        } catch (err) {
            console.error(`Tidak dapat memantau file: ${err.message}`);
        }
    }

    /**
     * Tangani perubahan file: restart server dan beri tahu browser.
     */
    onChange(filename) {
        clearTimeout(this.debounceTimer);
        this.debounceTimer = setTimeout(() => {
            console.log(`  ↻ ${filename} berubah — reload...`);
            this.restart();
        }, 120);
    }

    async restart() {
        try {
            // Router di-reset lalu route aplikasi dimuat ulang.
            const { Router } = require('../runtime/http/router');
            const preserved = this.server.router;
            this.server.router = new Router();
            // Route internal hot reload dipasang ulang.
            this.installInternalRoutes();
            await this.loadApplicationRoutes();
            void preserved;

            this.notifyClients('reload');
        } catch (err) {
            console.error(`Reload gagal: ${err.message}`);
            this.notifyClients('error');
        }
    }

    installInternalRoutes() {
        this.server.router.get('/__bonang/live', (ctx) => {
            ctx.response.raw.writeHead(200, {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                Connection: 'keep-alive',
                'X-Content-Type-Options': 'nosniff'
            });
            ctx.response.raw.write(': connected\n\n');
            ctx.response.finished = true;
            this.clients.add(ctx.response.raw);
            ctx.response.raw.on('close', () => this.clients.delete(ctx.response.raw));
        });
        this.server.router.get('/__bonang/status', () => ({
            status: 'running',
            watched: this.watchers.length
        }));
    }

    /** Kirim pesan ke semua browser yang terhubung via SSE. */
    notifyClients(event) {
        for (const client of this.clients) {
            try {
                client.write(`event: ${event}\ndata: ${JSON.stringify({ at: Date.now() })}\n\n`);
            } catch {
                this.clients.delete(client);
            }
        }
    }

    async stop() {
        for (const watcher of this.watchers) {
            try {
                watcher.close();
            } catch {
                // abaikan
            }
        }
        this.watchers = [];
        for (const client of this.clients) {
            try {
                client.end();
            } catch {
                // abaikan
            }
        }
        this.clients.clear();
        if (this.server) await this.server.close();
    }
}

/**
 * Logger yang tidak membanjiri output dev server.
 */
function createQuietLogger() {
    const { Logger } = require('../runtime/core/runtime');
    return new Logger({ level: 'warn', prefix: '[bonang:dev]' });
}

module.exports = { DevServer };
