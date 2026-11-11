// Service worker Bonang CRUD Demo.
//
// Menyediakan:
//  - cache aset statis (HTML, CSS, JS) agar aplikasi bisa dibuka offline
//  - fallback ke cache untuk request navigasi
//  - API GET tidak di-cache (data produk disimpan di IndexedDB, bukan Cache API)

const CACHE_NAME = "bonang-crud-demo-v1";
const PRECACHE_URLS = ["/", "/index.html", "/style.css", "/client.js"];

self.addEventListener("install", (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => cache.addAll(PRECACHE_URLS))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener("activate", (event) => {
    event.waitUntil(
        caches.keys()
            .then((keys) => Promise.all(
                keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
            ))
            .then(() => self.clients.claim())
    );
});

self.addEventListener("fetch", (event) => {
    const request = event.request;

    if (request.method !== "GET") return;

    const url = new URL(request.url);
    if (url.origin !== self.location.origin) return;

    // Request API selalu ke jaringan — status sinkronisasi harus akurat.
    if (url.pathname.startsWith("/api/")) return;

    // Navigasi: coba jaringan, jatuh ke cache saat offline.
    if (request.mode === "navigate") {
        event.respondWith(
            fetch(request)
                .then((response) => {
                    const copy = response.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
                    return response;
                })
                .catch(() => caches.match("/index.html"))
        );
        return;
    }

    // Aset statis: sajikan dari cache, perbarui di belakang layar.
    event.respondWith(
        caches.match(request).then((cached) => {
            const network = fetch(request)
                .then((response) => {
                    if (response.ok) {
                        const copy = response.clone();
                        caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
                    }
                    return response;
                })
                .catch(() => cached);

            return cached || network;
        })
    );
});
