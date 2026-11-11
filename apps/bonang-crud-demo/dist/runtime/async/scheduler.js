'use strict';

const os = require('node:os');

/**
 * Scheduler task Bonang.
 *
 * Menyediakan concurrency (banyak task,- non-blocking I/O) dan parallelism
 * (pekerjaan CPU-bound(thread pool) secara terpisah.
 *
 * Perbedaan teknis yang dijaga modul ini:
 * - Concurrency: banyak operasi I/O berjalan bersamaan di satu thread event
 *   loop. Request yang menunggu database/network TIDAK memblokir request lain.
 * - Parallelism: pekerjaan CPU-bound dijalankan di worker thread terpisah
 *   agar event loop tetap responsif.
 */

class Task {
    constructor(id, fn, options = {}) {
        this.id = id;
        this.fn = fn;
        this.options = options;
        this.status = 'pending';
        this.result = null;
        this.error = null;
        this.startedAt = null;
        this.finishedAt = null;
        this.cancelled = false;
    }

    get duration() {
        if (this.startedAt === null) return null;
        return (this.finishedAt === null ? Date.now() : this.finishedAt) - this.startedAt;
    }
}

/**
 * Task scheduler sederhana.
 *
 * Menjalankan task secara konkuren dengan batas并发 configurable.
 */
class Scheduler {
    constructor(options = {}) {
        this.maxConcurrency = options.maxConcurrency || 64;
        this.tasks = new Map();
        this.running = new Set();
        this.queue = [];
        this.nextId = 1;
        this.stats = { created: 0, completed: 0, failed: 0, cancelled: 0 };
    }

    /**
     * Jalankan task dan kembalikan promise hasilnya.
     */
    schedule(fn, options = {}) {
        const task = new Task(this.nextId++, fn, options);
        this.tasks.set(task.id, task);
        this.stats.created += 1;
        return new Promise((resolve, reject) => {
            task.resolve = resolve;
            task.reject = reject;
            this.queue.push(task);
            this.pump();
        });
    }

    /** Jalankan banyak task sekaligus, kembalikan hasil dalam urutan input. */
    async all(tasks) {
        return Promise.all(tasks);
    }

    /** Jalankan banyak task, abaikan yang gagal; kembalikan {value, error}. */
    async allSettled(tasks) {
        return Promise.allSettled(tasks);
    }

    /**
     * Jalankan task dengan batas konkurensi. Tasks yang melewati batas
     * menunggu dalam antrean tanpa memblokir task lain.
     */
    async withConcurrencyLimit(items, limit, worker) {
        const results = new Array(items.length);
        let cursor = 0;

        const runners = new Array(Math.min(limit, items.length)).fill(null).map(async () => {
            while (true) {
                const index = cursor;
                cursor += 1;
                if (index >= items.length) return;
                results[index] = await worker(items[index], index);
            }
        });

        await Promise.all(runners);
        return results;
    }

    pump() {
        while (this.running.size < this.maxConcurrency && this.queue.length > 0) {
            const task = this.queue.shift();
            if (task.cancelled) continue;
            this.runTask(task);
        }
    }

    runTask(task) {
        task.status = 'running';
        task.startedAt = Date.now();
        this.running.add(task);

        let promise;
        try {
            promise = Promise.resolve(task.fn());
        } catch (err) {
            promise = Promise.reject(err);
        }

        promise.then(
            (value) => {
                task.status = 'completed';
                task.result = value;
                task.finishedAt = Date.now();
                this.stats.completed += 1;
                this.running.delete(task);
                task.resolve(value);
                this.pump();
            },
            (err) => {
                task.status = task.cancelled ? 'cancelled' : 'failed';
                task.error = err;
                task.finishedAt = Date.now();
                if (task.cancelled) this.stats.cancelled += 1;
                else this.stats.failed += 1;
                this.running.delete(task);
                task.reject(err);
                this.pump();
            }
        );
    }

    /**
     * Batalkan task yang belum selesai. Task yang sudah berjalan tidak dapat
     * dihentikan paksa; pembatalan berlaku saat checkpoint berikutnya.
     */
    cancel(taskId) {
        const task = this.tasks.get(taskId);
        if (!task) return false;
        if (task.status === 'completed' || task.status === 'failed') return false;
        task.cancelled = true;
        if (task.status === 'pending') {
            this.queue = this.queue.filter((t) => t !== task);
            task.status = 'cancelled';
            task.finishedAt = Date.now();
            this.stats.cancelled += 1;
            task.reject(new Error('Task dibatalkan'));
            this.pump();
            return true;
        }
        return true;
    }

    getStats() {
        return {
            ...this.stats,
            pending: this.queue.length,
            running: this.running.size,
            total: this.tasks.size
        };
    }
}

/**
 * Worker pool untuk pekerjaan CPU-bound.
 *
 * Memakai `node:worker_threads`. Setiap worker menjalankan satu task pada
 * waktu tertentu sehingga event loop server tetap bisa melayani request.
 */
class WorkerPool {
    constructor(options = {}) {
        this.size = options.size || Math.max(1, Math.min(os.cpus().length - 1, 4));
        this.timeout = options.timeout || 30000;
        this.workers = [];
        this.idle = [];
        this.queue = [];
        this.nextId = 1;
        this.pending = new Map();
        this.destroyed = false;
    }

    /**
     * Jalankan `fn` di worker thread. `fn` harus bisa diserialisasi (tidak
     * boleh menangkap closure yang tidak bisa di-clone).
     *
     * @param {Function} fn fungsi yang dijalankan di worker
     * @param {Array} args argumen yang diteruskan
     * @param {Object} options {transferList}
     */
    run(fn, args = [], options = {}) {
        if (this.destroyed) return Promise.reject(new Error('Worker pool sudah dihancurkan'));
        return new Promise((resolve, reject) => {
            this.queue.push({ fn, args, options, resolve, reject, id: this.nextId++ });
            this.dispatch();
        });
    }

    dispatch() {
        while (this.queue.length > 0) {
            const worker = this.takeWorker();
            if (!worker) return;
            const task = this.queue.shift();
            this.execute(worker, task);
        }
    }

    takeWorker() {
        if (this.idle.length > 0) return this.idle.pop();
        if (this.workers.length < this.size) {
            const worker = this.createWorker();
            this.workers.push(worker);
            return worker;
        }
        return null;
    }

    createWorker() {
        // Worker dibuat secara lazy via worker_threads agar modul ini tetap
        // bisa di-require di lingkungan tanpa worker support.
        //
        // `eval: true` dipakai agar source worker dijalankan sebagai inline
        // script, bukan sebagai file path.
        const { Worker } = require('node:worker_threads');
        const worker = new Worker(WORKER_SOURCE, { eval: true });
        worker.isBusy = false;
        worker.on('message', (message) => {
            const pending = this.pending.get(message.id);
            if (!pending) return;
            this.pending.delete(message.id);
            worker.isBusy = false;
            clearTimeout(pending.timer);
            if (message.error) {
                pending.reject(new Error(message.error));
            } else {
                pending.resolve(message.result);
            }
            this.idle.push(worker);
            this.dispatch();
        });
        worker.on('error', (err) => {
            // Worker gagal total: tolak task yang sedang menunggu.
            for (const [, pending] of this.pending) {
                clearTimeout(pending.timer);
                pending.reject(err);
            }
            this.pending.clear();
            this.workers = this.workers.filter((w) => w !== worker);
        });
        worker.on('exit', () => {
            this.workers = this.workers.filter((w) => w !== worker);
            this.idle = this.idle.filter((w) => w !== worker);
        });
        worker.unref();
        return worker;
    }

    execute(worker, task) {
        worker.isBusy = true;
        const id = this.nextId;
        const timer = setTimeout(() => {
            this.pending.delete(id);
            task.reject(new Error('Worker task timeout'));
            worker.terminate();
        }, this.timeout);
        this.pending.set(id, { resolve: task.resolve, reject: task.reject, timer });
        worker.postMessage({ id, fn: task.fn.toString(), args: task.args });
    }

    /** Hentikan semua worker dan kosongkan antrean. */
    async destroy() {
        this.destroyed = true;
        for (const [, pending] of this.pending) {
            clearTimeout(pending.timer);
            pending.reject(new Error('Worker pool dihentikan'));
        }
        this.pending.clear();
        this.queue = [];
        await Promise.all(this.workers.map((w) => w.terminate().catch(() => {})));
        this.workers = [];
        this.idle = [];
    }

    getStats() {
        return {
            size: this.size,
            workers: this.workers.length,
            busy: this.workers.filter((w) => w.isBusy).length,
            queued: this.queue.length
        };
    }
}

/**
 * Sumber worker. Function dijalankan lewat `eval` di dalam worker dengan
 * argumen yang sudah diserialisasi.
 */
const WORKER_SOURCE = `
const { parentPort } = require('node:worker_threads');

parentPort.on('message', (message) => {
    const { id, fn, args } = message;
    try {
        // eslint-disable-next-line no-eval
        const factory = eval('(' + fn + ')');
        const result = factory.apply(null, args);
        if (result && typeof result.then === 'function') {
            result.then(
                (value) => parentPort.postMessage({ id, result: value }),
                (error) => parentPort.postMessage({ id, error: error.message })
            );
            return;
        }
        parentPort.postMessage({ id, result });
    } catch (err) {
        parentPort.postMessage({ id, error: err.message });
    }
});
`;

const defaultScheduler = new Scheduler();

module.exports = { Scheduler, WorkerPool, Task, defaultScheduler, WORKER_SOURCE };
