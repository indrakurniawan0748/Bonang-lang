"use strict";
// Bonang bundle — server
(function () {
var __bngModules = {};
var __bngCache = {};

function __bngRequire(id) {
    if (__bngCache[id]) return __bngCache[id].exports;
    var factory = __bngModules[id];
    if (!factory) throw new Error("Modul Bonang tidak ditemukan: " + id);
    var module = { exports: {} };
    __bngCache[id] = module;
    // Parameter require di sini adalah require Node asli, dipakai modul
    // untuk modul bawaan Node dan runtime Bonang. Modul Bonang relatif
    // sudah ditulis ulang menjadi __bngRequire(...).
    factory(module, module.exports, require);
    return module.exports;
}

__bngModules["__bng_0"] = function (module, exports, require) {
function _$$iterable(value) {
  if (value == null) return [];
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') return Array.from(value);
  if (typeof value[Symbol.iterator] === 'function') return Array.from(value);
  if (typeof value === 'object') return Object.keys(value).map((k) => value[k]);
  return [];
}

const MAX_NAME_LENGTH = 120;
Object.assign(module.exports, { MAX_NAME_LENGTH: MAX_NAME_LENGTH });
const MAX_DESCRIPTION_LENGTH = 1000;
Object.assign(module.exports, { MAX_DESCRIPTION_LENGTH: MAX_DESCRIPTION_LENGTH });
const MAX_STOCK = 1000000;
Object.assign(module.exports, { MAX_STOCK: MAX_STOCK });
const MIN_PRICE = 0;
Object.assign(module.exports, { MIN_PRICE: MIN_PRICE });
const productRules = { name: { required: true, minLength: 1, maxLength: MAX_NAME_LENGTH, label: "Nama produk" }, description: { required: false, maxLength: MAX_DESCRIPTION_LENGTH, label: "Deskripsi" }, price: { required: true, type: "number", min: MIN_PRICE, label: "Harga" }, stock: { required: true, type: "number", min: 0, max: MAX_STOCK, label: "Stok" } };
Object.assign(module.exports, { productRules: productRules });
function validateProduct(input) {
const errors = {  };
const data = (input || {  });
for (const field of _$$iterable(Object.keys(productRules))) {
const rule = productRules[field];
const value = data[field];
if ((rule.required && (((value === undefined) || (value === null)) || (value === "")))) {
errors[field] = (rule.label + " wajib diisi");
continue;
}
if ((((value === undefined) || (value === null)) || (value === ""))) continue;
if ((rule.type === "number")) {
const num = Number(value);
if (!Number.isFinite(num)) {
errors[field] = (rule.label + " harus berupa angka");
continue;
}
if (((rule.min !== undefined) && (num < rule.min))) {
errors[field] = ((rule.label + " minimal ") + rule.min);
continue;
}
if (((rule.max !== undefined) && (num > rule.max))) {
errors[field] = ((rule.label + " maksimal ") + rule.max);
continue;
}
}
const text = String(value);
if (((rule.minLength !== undefined) && (text.length < rule.minLength))) {
errors[field] = (((rule.label + " minimal ") + rule.minLength) + " karakter");
continue;
}
if (((rule.maxLength !== undefined) && (text.length > rule.maxLength))) {
errors[field] = (((rule.label + " maksimal ") + rule.maxLength) + " karakter");
continue;
}
}
return errors;
}
module.exports.validateProduct = validateProduct;
function normalizeProduct(input) {
const data = (input || {  });
return { name: String((data.name || "")).trim(), description: String((data.description || "")).trim(), price: (Number(data.price) || 0), stock: (Number(data.stock) || 0) };
}
module.exports.normalizeProduct = normalizeProduct;

if (typeof main === 'function' && !module.exports.main) {
    module.exports.main = main;
}
};
__bngModules["__bng_1"] = function (module, exports, require) {
const { createPool } = require("./bonang-runtime.js");
const { normalizeProduct } = __bngRequire("__bng_0");
class ProductRepository {
  constructor(pool) {
this.pool = pool;
this.table = "products";
}
  createDefault(databaseFile) {
return new ProductRepository(createPool({ filename: databaseFile, max: 10 }));
}
  async ensureSchema() {
await this.pool.execute(`
            CREATE TABLE IF NOT EXISTS products (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                description TEXT NOT NULL DEFAULT '',
                price REAL NOT NULL DEFAULT 0,
                stock INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
        `);
await this.pool.execute("CREATE INDEX IF NOT EXISTS idx_products_name ON products (name)");
await this.pool.execute("CREATE INDEX IF NOT EXISTS idx_products_updated_at ON products (updated_at)");
}
  async findAll(options = {  }) {
const filters = [];
const params = [];
if (options.search) {
filters.push("(name LIKE ? OR description LIKE ?)");
const pattern = `%${options.search}%`;
params.push(pattern, pattern);
}
if (((options.minPrice !== undefined) && (options.minPrice !== null))) {
filters.push("price >= ?");
params.push(Number(options.minPrice));
}
if (((options.maxPrice !== undefined) && (options.maxPrice !== null))) {
filters.push("price <= ?");
params.push(Number(options.maxPrice));
}
const where = ((filters.length > 0) ? `WHERE ${filters.join(" AND ")}` : "");
const limit = Math.min(Math.max((Number(options.limit) || 50), 1), 200);
const offset = Math.max((Number(options.offset) || 0), 0);
const rows = await this.pool.query(`SELECT * FROM ${this.table} ${where} ORDER BY id DESC LIMIT ? OFFSET ?`, [...params, limit, offset]);
const total = await this.pool.queryOne(`SELECT COUNT(*) AS total FROM ${this.table} ${where}`, params);
return { items: rows.map((row) => this.toProduct(row)), total: (total ? total.total : 0), limit: limit, offset: offset };
}
  async findById(id) {
const row = await this.pool.queryOne(`SELECT * FROM ${this.table} WHERE id = ?`, [Number(id)]);
return (row ? this.toProduct(row) : null);
}
  async findByName(name) {
const rows = await this.pool.query(`SELECT * FROM ${this.table} WHERE name = ? ORDER BY id`, [String(name)]);
return rows.map((row) => this.toProduct(row));
}
  async create(input) {
const data = normalizeProduct(input);
const now = new Date().toISOString();
const result = await this.pool.execute(`INSERT INTO ${this.table} (name, description, price, stock, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?)`, [data.name, data.description, data.price, data.stock, now, now]);
return this.findById(result.lastInsertRowid);
}
  async update(id, input) {
const existing = await this.findById(id);
if (!existing) return null;
const data = normalizeProduct({ name: ((input.name !== undefined) ? input.name : existing.name), description: ((input.description !== undefined) ? input.description : existing.description), price: ((input.price !== undefined) ? input.price : existing.price), stock: ((input.stock !== undefined) ? input.stock : existing.stock) });
await this.pool.execute(`UPDATE ${this.table}
             SET name = ?, description = ?, price = ?, stock = ?, updated_at = ?
             WHERE id = ?`, [data.name, data.description, data.price, data.stock, new Date().toISOString(), Number(id)]);
return this.findById(id);
}
  async remove(id) {
const result = await this.pool.execute(`DELETE FROM ${this.table} WHERE id = ?`, [Number(id)]);
return (result.changes > 0);
}
  async summary() {
const totals = await this.pool.queryOne(`SELECT COUNT(*) AS total, COALESCE(SUM(price * stock), 0) AS inventory_value,
                    COALESCE(SUM(stock), 0) AS total_stock
             FROM ${this.table}`);
const lowStock = await this.pool.query(`SELECT * FROM ${this.table} WHERE stock < 10 ORDER BY stock ASC LIMIT 5`);
return { total: (totals ? totals.total : 0), totalStock: (totals ? totals.total_stock : 0), inventoryValue: (totals ? totals.inventory_value : 0), lowStock: lowStock.map((row) => this.toProduct(row)) };
}
  toProduct(row) {
return { id: Number(row.id), name: row.name, description: row.description, price: Number(row.price), stock: Number(row.stock), createdAt: row.created_at, updatedAt: row.updated_at };
}
}
ProductRepository.createDefault = function(databaseFile) {
return new ProductRepository(createPool({ filename: databaseFile, max: 10 }));
};
module.exports.ProductRepository = ProductRepository;

if (typeof main === 'function' && !module.exports.main) {
    module.exports.main = main;
}
};
__bngModules["__bng_2"] = function (module, exports, require) {
const { validateProduct } = __bngRequire("__bng_0");
const { ValidationError, NotFoundError, ConflictError } = require("./bonang-runtime.js");
class ProductService {
  constructor(repository) {
this.repository = repository;
}
  list(options = {  }) {
return this.repository.findAll(options);
}
  async get(id) {
const product = await this.repository.findById(id);
if (!product) {
throw new NotFoundError(`Produk dengan id ${id} tidak ditemukan`);
}
return product;
}
  async create(input) {
const errors = validateProduct(input);
if ((Object.keys(errors).length > 0)) {
throw new ValidationError("Data produk tidak valid", errors);
}
return this.repository.create(input);
}
  async update(id, input, options = {  }) {
const current = await this.repository.findById(id);
if (!current) {
throw new NotFoundError(`Produk dengan id ${id} tidak ditemukan`);
}
if ((options.baseVersion && (options.baseVersion !== current.updatedAt))) {
throw new ConflictError(`Produk ${id} sudah diubah di server sejak versi ${options.baseVersion}`, { server: current, baseVersion: options.baseVersion });
}
const merged = { name: ((input.name !== undefined) ? input.name : current.name), description: ((input.description !== undefined) ? input.description : current.description), price: ((input.price !== undefined) ? input.price : current.price), stock: ((input.stock !== undefined) ? input.stock : current.stock) };
const errors = validateProduct(merged);
if ((Object.keys(errors).length > 0)) {
throw new ValidationError("Data produk tidak valid", errors);
}
return this.repository.update(id, merged);
}
  async remove(id) {
const existing = await this.repository.findById(id);
if (!existing) {
throw new NotFoundError(`Produk dengan id ${id} tidak ditemukan`);
}
const removed = await this.repository.remove(id);
if (!removed) {
throw new NotFoundError(`Produk dengan id ${id} gagal dihapus`);
}
return true;
}
  summary() {
return this.repository.summary();
}
}
module.exports.ProductService = ProductService;

if (typeof main === 'function' && !module.exports.main) {
    module.exports.main = main;
}
};
__bngModules["__bng_3"] = function (module, exports, require) {
function _$$iterable(value) {
  if (value == null) return [];
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') return Array.from(value);
  if (typeof value[Symbol.iterator] === 'function') return Array.from(value);
  if (typeof value === 'object') return Object.keys(value).map((k) => value[k]);
  return [];
}

const { ValidationError } = require("./bonang-runtime.js");
class ProductController {
  constructor(service) {
this.service = service;
}
  registerRoutes(router) {
router.get("/api/products", (ctx) => this.index(ctx));
router.get("/api/products/summary", (ctx) => this.summary(ctx));
router.get("/api/products/:id", (ctx) => this.show(ctx));
router.post("/api/products", (ctx) => this.store(ctx));
router.put("/api/products/:id", (ctx) => this.update(ctx));
router["delete"]("/api/products/:id", (ctx) => this.destroy(ctx));
router.post("/api/sync", (ctx) => this.sync(ctx));
return router;
}
  async index(ctx) {
const query = (ctx.query || {  });
const result = await this.service.list({ search: (query.search || null), limit: query.limit, offset: query.offset });
return { status: "success", data: result.items, meta: { total: result.total, limit: result.limit, offset: result.offset } };
}
  async summary(ctx) {
return { status: "success", data: await this.service.summary() };
}
  async show(ctx) {
const id = this.parseId(ctx.params.id);
const product = await this.service.get(id);
return { status: "success", data: product };
}
  async store(ctx) {
const body = this.readBody(ctx);
const product = await this.service.create(body);
ctx.response.status(201);
return { status: "success", data: product };
}
  async update(ctx) {
const id = this.parseId(ctx.params.id);
const body = this.readBody(ctx);
const baseVersion = (ctx.query ? ctx.query.baseVersion : null);
const product = await this.service.update(id, body, { baseVersion: baseVersion });
return { status: "success", data: product };
}
  async destroy(ctx) {
const id = this.parseId(ctx.params.id);
await this.service.remove(id);
return { status: "success", data: { id: id } };
}
  async sync(ctx) {
const body = this.readBody(ctx);
const operations = (Array.isArray(body.operations) ? body.operations : []);
const results = [];
for (const operation of _$$iterable(operations)) {
const opId = operation.id;
try {
if ((operation.op === "create")) {
const created = await this.service.create(operation.payload);
results.push({ id: opId, status: "applied", server: created });
} else if ((operation.op === "update")) {
const updated = await this.service.update(Number(operation.entityId), operation.payload, { baseVersion: operation.baseVersion });
results.push({ id: opId, status: "applied", server: updated });
} else if ((operation.op === "delete")) {
await this.service.remove(Number(operation.entityId));
results.push({ id: opId, status: "applied" });
} else {
results.push({ id: opId, status: "failed", error: "Operasi tidak dikenal" });
}
} catch (err) {
if ((err.code === "CONFLICT")) {
results.push({ id: opId, status: "conflict", error: err.message, server: (err.details ? err.details.server : null) });
} else if ((err.code === "VALIDATION_ERROR")) {
results.push({ id: opId, status: "failed", error: err.message, details: err.details });
} else {
results.push({ id: opId, status: "failed", error: err.message });
}
}
}
return { status: "success", data: { results: results, applied: results.filter((r) => (r.status === "applied")).length, conflicted: results.filter((r) => (r.status === "conflict")).length, failed: results.filter((r) => (r.status === "failed")).length } };
}
  readBody(ctx) {
const body = ctx.body;
if (((!body || (typeof body !== "object")) || Array.isArray(body))) {
throw new ValidationError("Body harus berupa object JSON");
}
return body;
}
  parseId(raw) {
const id = Number(raw);
if ((!Number.isInteger(id) || (id <= 0))) {
throw new ValidationError(`Id '${raw}' tidak valid`);
}
return id;
}
}
module.exports.ProductController = ProductController;

if (typeof main === 'function' && !module.exports.main) {
    module.exports.main = main;
}
};
__bngModules["__bng_4"] = function (module, exports, require) {
const { createServer } = require("./bonang-runtime.js");
const { ProductRepository } = __bngRequire("__bng_1");
const { ProductService } = __bngRequire("__bng_2");
const { ProductController } = __bngRequire("__bng_3");
async function createApp(options = {  }) {
const port = ((options.port !== undefined) ? options.port : 3000);
const host = (options.host || "127.0.0.1");
const databaseFile = (options.databaseFile || "data/bonang_demo.db");
const staticDir = (options.staticDir || ["public", "dist", "dist/public"]);
const app = createServer({ port: port, host: host, staticDir: staticDir, logger: (options.logger || { info: function() {}, warn: function() {}, error: function() {}, debug: function() {} }) });
const repository = ProductRepository.createDefault(databaseFile);
await repository.ensureSchema();
const service = new ProductService(repository);
const controller = new ProductController(service);
controller.registerRoutes(app.router);
app.router.get("/api/info", () => ({ name: "Bonang CRUD Demo", message: "Gunakan /api/products untuk API CRUD produk.", endpoints: ["GET /api/products", "GET /api/products/summary", "GET /api/products/:id", "POST /api/products", "PUT /api/products/:id", "DELETE /api/products/:id", "POST /api/sync"] }));
app.router.get("/api/health", () => ({ status: "ok", uptime: process.uptime(), database: databaseFile }));
app.repository = repository;
app.service = service;
app.controller = controller;
return app;
}
module.exports.createApp = createApp;
async function startApp(options = {  }) {
const app = await createApp(options);
await app.listen(((options.port !== undefined) ? options.port : 3000));
return app;
}
module.exports.startApp = startApp;

if (typeof main === 'function' && !module.exports.main) {
    module.exports.main = main;
}
};
__bngModules["__bng_5"] = function (module, exports, require) {
const { startApp } = __bngRequire("__bng_4");
const port = 3000;
const databaseFile = "data/bonang_demo.db";
async function main() {
const app = await startApp({ port: port, host: "127.0.0.1", databaseFile: databaseFile });
console.log(("Bonang CRUD Demo berjalan di http://localhost:" + port));
return app;
}
Object.assign(module.exports, { main: main });

if (typeof main === 'function' && !module.exports.main) {
    module.exports.main = main;
}
};
__bngRequire("__bng_5");

var __bngEntry = __bngRequire("__bng_5");
if (__bngEntry && typeof __bngEntry.main === "function") {
    var __bngResult = __bngEntry.main();
    if (__bngResult && typeof __bngResult.catch === "function") {
        __bngResult.catch(function (err) {
            console.error(err && err.stack ? err.stack : err);
            process.exitCode = 1;
        });
    }
}

})();