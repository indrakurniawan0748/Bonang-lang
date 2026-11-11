"use strict";
// Bonang bundle — client
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
function _$$iterable(value) {
  if (value == null) return [];
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') return Array.from(value);
  if (typeof value[Symbol.iterator] === 'function') return Array.from(value);
  if (typeof value === 'object') return Object.keys(value).map((k) => value[k]);
  return [];
}

const { IndexedDBStore, SyncQueue, apiFetch, resolveConflict } = require("./bonang-client.js");
const { validateProduct, normalizeProduct } = __bngRequire("__bng_0");
const API_BASE = "/api";
const DB_NAME = "bonang_crud_demo";
const ENTITY_STORE = "products";
const QUEUE_STORE = "syncQueue";
const state = { products: [], online: true, pendingCount: 0, conflicts: [] };
let store = null;
let queue = null;
async function setupStorage() {
store = new IndexedDBStore({ name: DB_NAME, version: 1, stores: [ENTITY_STORE, QUEUE_STORE] });
await store.open();
queue = new SyncQueue({ store: store, storeName: QUEUE_STORE });
queue.subscribe((online) => {
state.online = online;
renderStatus();
if (online) {
void flushQueue();
}
});
state.online = (navigator.onLine !== false);
}
async function loadProducts() {
const local = await store.getAll(ENTITY_STORE);
state.products = (local || []);
if (!state.online) {
render();
return;
}
const response = await apiFetch((API_BASE + "/products?limit=200"));
if (((response.ok && response.data) && response.data.data)) {
const remote = response.data.data;
const merged = mergeProducts(state.products, remote);
state.products = merged;
await store.putMany(ENTITY_STORE, merged);
}
render();
}
function mergeProducts(local, remote) {
const map = new Map();
for (const item of _$$iterable(remote)) {
map.set(item.id, item);
}
for (const item of _$$iterable(local)) {
const remoteItem = map.get(item.id);
if (!remoteItem) {
map.set(item.id, item);
continue;
}
const resolved = resolveConflict(item, remoteItem, { field: "updatedAt" });
map.set(item.id, resolved.merged);
}
return [...map.values()].sort((a, b) => (b.id - a.id));
}
async function createProduct(form) {
const payload = normalizeProduct({ name: form.name, description: form.description, price: form.price, stock: form.stock });
const errors = validateProduct(payload);
if ((Object.keys(errors).length > 0)) {
showMessage(("Validasi gagal: " + Object.keys(errors).join(", ")), "error");
return false;
}
if (state.online) {
const response = await apiFetch((API_BASE + "/products"), { init: { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) } });
if (response.ok) {
await store.put(ENTITY_STORE, response.data.data);
state.products.unshift(response.data.data);
render();
showMessage("Produk disimpan ke server", "success");
return true;
}
if ((response.status === 0)) {
state.online = false;
}
}
const localProduct = { id: ("local-" + Date.now()), name: payload.name, description: payload.description, price: payload.price, stock: payload.stock, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), pending: true };
await store.put(ENTITY_STORE, localProduct);
state.products.unshift(localProduct);
await queue.enqueue({ id: ("create-" + Date.now()), entity: "product", op: "create", payload: payload });
state.pendingCount = await queue.list().length;
render();
showMessage("Offline: produk disimpan lokal dan dijadwalkan untuk sinkronisasi", "warning");
return true;
}
async function updateProduct(id, form) {
const payload = normalizeProduct({ name: form.name, description: form.description, price: form.price, stock: form.stock });
const errors = validateProduct(payload);
if ((Object.keys(errors).length > 0)) {
showMessage(("Validasi gagal: " + Object.keys(errors).join(", ")), "error");
return false;
}
const existing = state.products.find((p) => (String(p.id) === String(id)));
if (!existing) return false;
if ((state.online && !String(id).startsWith("local-"))) {
const response = await apiFetch(((API_BASE + "/products/") + id), { init: { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) } });
if (response.ok) {
await store.put(ENTITY_STORE, response.data.data);
replaceProduct(response.data.data);
render();
showMessage("Produk diperbarui", "success");
return true;
}
if ((response.status === 409)) {
state.conflicts.push({ id: id, local: payload, server: response.data.data });
showMessage("Konflik: produk sudah diubah di server", "error");
render();
return false;
}
if ((response.status === 0)) {
state.online = false;
}
}
const updated = { ...existing, ...payload, updatedAt: new Date().toISOString(), pending: true };
await store.put(ENTITY_STORE, updated);
replaceProduct(updated);
await queue.enqueue({ id: ((("update-" + id) + "-") + Date.now()), entity: "product", op: "update", entityId: Number(id), payload: payload, baseVersion: existing.updatedAt });
state.pendingCount = await queue.list().length;
render();
showMessage("Offline: perubahan disimpan lokal dan dijadwalkan", "warning");
return true;
}
async function deleteProduct(id) {
const existing = state.products.find((p) => (String(p.id) === String(id)));
if (!existing) return false;
if ((state.online && !String(id).startsWith("local-"))) {
const response = await apiFetch(((API_BASE + "/products/") + id), { init: { method: "DELETE" } });
if (response.ok) {
await store["delete"](ENTITY_STORE, id);
state.products = state.products.filter((p) => (String(p.id) !== String(id)));
render();
showMessage("Produk dihapus", "success");
return true;
}
if ((response.status === 0)) {
state.online = false;
}
}
await store["delete"](ENTITY_STORE, id);
state.products = state.products.filter((p) => (String(p.id) !== String(id)));
await queue.enqueue({ id: ((("delete-" + id) + "-") + Date.now()), entity: "product", op: "delete", entityId: Number(id) });
state.pendingCount = await queue.list().length;
render();
showMessage("Offline: penghapusan dijadwalkan", "warning");
return true;
}
async function flushQueue() {
if (!state.online) return;
const entries = await queue.list();
if ((entries.length === 0)) {
state.pendingCount = 0;
render();
return;
}
const response = await apiFetch((API_BASE + "/sync"), { init: { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ operations: entries }) } });
if (!response.ok) {
showMessage(("Sinkronisasi gagal: " + (response.error || response.status)), "error");
return;
}
const results = response.data.data.results;
for (const result of _$$iterable(results)) {
if ((result.status === "applied")) {
if (result.server) {
await store.put(ENTITY_STORE, result.server);
replaceProduct(result.server);
}
} else if ((result.status === "conflict")) {
state.conflicts.push({ id: result.id, server: result.server, error: result.error });
}
}
for (const result of _$$iterable(results)) {
if (((result.status === "applied") || (result.status === "failed"))) {
await queue.remove(result.id);
}
}
state.pendingCount = await queue.list().length;
render();
const applied = response.data.data.applied;
const conflicted = response.data.data.conflicted;
if ((applied > 0)) {
showMessage((applied + " perubahan disinkronkan ke server"), "success");
}
if ((conflicted > 0)) {
showMessage((conflicted + " perubahan berkonflik dan perlu ditinjau"), "error");
}
}
function replaceProduct(product) {
const index = state.products.findIndex((p) => (String(p.id) === String(product.id)));
if ((index >= 0)) {
state.products[index] = product;
} else {
state.products.unshift(product);
}
}
function render() {
const list = document.getElementById("product-list");
if (!list) return;
list.textContent = "";
if ((state.products.length === 0)) {
const empty = document.createElement("p");
empty.className = "empty";
empty.textContent = "Belum ada produk. Tambahkan lewat formulir di samping.";
list.appendChild(empty);
return;
}
for (const product of _$$iterable(state.products)) {
list.appendChild(renderProductRow(product));
}
}
function renderProductRow(product) {
const row = document.createElement("div");
row.className = "product-row";
const info = document.createElement("div");
info.className = "product-info";
const name = document.createElement("strong");
name.textContent = product.name;
info.appendChild(name);
const meta = document.createElement("span");
meta.className = "meta";
meta.textContent = (((("Rp " + Number(product.price).toLocaleString("id-ID")) + " · stok ") + product.stock) + (product.pending ? " · menunggu sinkronisasi" : ""));
info.appendChild(meta);
if (product.description) {
const desc = document.createElement("span");
desc.className = "meta";
desc.textContent = product.description;
info.appendChild(desc);
}
row.appendChild(info);
const actions = document.createElement("div");
actions.className = "actions";
const editButton = document.createElement("button");
editButton.textContent = "Ubah";
editButton.className = "secondary";
editButton.addEventListener("click", () => fillForm(product));
actions.appendChild(editButton);
const deleteButton = document.createElement("button");
deleteButton.textContent = "Hapus";
deleteButton.className = "danger";
deleteButton.addEventListener("click", () => {
void deleteProduct(product.id);
});
actions.appendChild(deleteButton);
row.appendChild(actions);
return row;
}
function renderStatus() {
const status = document.getElementById("status");
if (!status) return;
status.textContent = (state.online ? ("Online" + ((state.pendingCount > 0) ? ((" · " + state.pendingCount) + " perubahan menunggu sinkronisasi") : "")) : "Offline · perubahan disimpan di perangkat");
status.className = (state.online ? "status online" : "status offline");
}
function showMessage(text, kind) {
const box = document.getElementById("message");
if (!box) return;
box.textContent = text;
box.className = ("message " + (kind || "info"));
}
function fillForm(product) {
document.getElementById("product-id").value = product.id;
document.getElementById("product-name").value = product.name;
document.getElementById("product-description").value = (product.description || "");
document.getElementById("product-price").value = product.price;
document.getElementById("product-stock").value = product.stock;
document.getElementById("form-title").textContent = "Ubah produk";
}
function resetForm() {
document.getElementById("product-id").value = "";
document.getElementById("product-name").value = "";
document.getElementById("product-description").value = "";
document.getElementById("product-price").value = "";
document.getElementById("product-stock").value = "";
document.getElementById("form-title").textContent = "Tambah produk";
}
async function main() {
await setupStorage();
document.getElementById("product-form").addEventListener("submit", async (event) => {
event.preventDefault();
const id = document.getElementById("product-id").value;
const form = { name: document.getElementById("product-name").value, description: document.getElementById("product-description").value, price: document.getElementById("product-price").value, stock: document.getElementById("product-stock").value };
if (id) {
await updateProduct(id, form);
} else {
await createProduct(form);
}
resetForm();
});
document.getElementById("reset-button").addEventListener("click", () => resetForm());
document.getElementById("sync-button").addEventListener("click", () => {
void flushQueue();
});
document.getElementById("reload-button").addEventListener("click", () => {
void loadProducts();
});
await loadProducts();
state.pendingCount = await queue.list().length;
renderStatus();
render();
if (("serviceWorker" in navigator)) {
try {
await navigator.serviceWorker.register("/sw.js");
} catch (error) {
console.warn("Pendaftaran service worker gagal:", error);
}
}
}
Object.assign(module.exports, { main: main, state: state, mergeProducts: mergeProducts, flushQueue: flushQueue });

if (typeof main === 'function' && !module.exports.main) {
    module.exports.main = main;
}
};
__bngRequire("__bng_1");

var __bngEntry = __bngRequire("__bng_1");
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