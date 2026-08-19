// ============================================
// AK UTILITY - SERVICE WORKER
// ============================================
// Goal: every tablet/browser gets the latest deployed files as soon as
// possible, while still working offline off the last-known-good copy.
//
// BUMP CACHE_VERSION every time you deploy a change to index.html/js/css,
// same as the ?v= numbers in index.html's script tags.
const CACHE_VERSION = 'ak-utility-v9';

const APP_SHELL = [
    './',
    './index.html',
    './style.css',
    './js/config.js',
    './js/app.js',
    './js/boxScanner.js',
    './js/itemBarcode.js',
    './js/boxCode.js',
    './js/photoCapture.js',
    './js/boxSegregate.js',
    './js/priceCheck.js',
    './js/yearSegregate.js'
];

self.addEventListener('install', (event) => {
    // Activate this version immediately instead of waiting for old tabs to close.
    self.skipWaiting();
    event.waitUntil(
        caches.open(CACHE_VERSION)
            .then((cache) => cache.addAll(APP_SHELL))
            .catch(() => {})
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then((keys) => Promise.all(
                keys.filter((key) => key !== CACHE_VERSION).map((key) => caches.delete(key))
            ))
            .then(() => self.clients.claim())
    );
});

// Network-first: always try to fetch the latest file first so devices pick up
// updates right away. Only fall back to the cached copy when offline. CDN/API
// requests are left alone (not intercepted) since they're cross-origin.
self.addEventListener('fetch', (event) => {
    if (event.request.method !== 'GET') return;
    if (new URL(event.request.url).origin !== self.location.origin) return;

    event.respondWith(
        fetch(event.request)
            .then((response) => {
                const copy = response.clone();
                caches.open(CACHE_VERSION).then((cache) => cache.put(event.request, copy)).catch(() => {});
                return response;
            })
            .catch(() => caches.match(event.request))
    );
});
