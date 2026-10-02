// ============================================
// UTILITY - SERVICE WORKER
// ============================================
// Goal: every tablet/browser gets the latest deployed files as soon as
// possible, while still working offline off the last-known-good copy.
//
// BUMP CACHE_VERSION every time you deploy a change to index.html/js/css,
// same as the ?v= numbers in index.html's script tags.
const CACHE_VERSION = 'ak-utility-v51';

const APP_SHELL = [
    './',
    './index.html',
    './style.css',
    './manifest.webmanifest',
    './about.html',
    './privacy.html',
    './terms.html',
    './security.html',
    './icons/icon.svg',
    './icons/logo-light.svg',
    './icons/favicon.svg',
    './icons/icon-32.png',
    './icons/icon-192.png',
    './icons/icon-512.png',
    './icons/icon-maskable-512.png',
    './icons/apple-touch-icon.png',
    './icons/ui-update.png',
    './icons/ui-users.png',
    './icons/ui-logout.png',
    './icons/ui-data.png',
    './icons/ui-sync.png',
    './icons/ui-upload.png',
    './icons/ui-download.png',
    './vendor/xlsx.full.min.js',
    './vendor/JsBarcode.all.min.js',
    './vendor/qrcode.min.js',
    './vendor/html5-qrcode.min.js',
    './vendor/supabase.js',
    './js/config.js',
    './js/lang.js',
    './js/supabaseClient.js',
    './js/lists.js',
    './js/usage.js',
    './js/syncstatus.js',
    './js/help.js',
    './js/tooltip.js',
    './js/app.js',
    './js/boxScanner.js',
    './js/itemBarcode.js',
    './js/boxCode.js',
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
    if (new URL(event.request.url).searchParams.has('check')) return;   // the app's "is there a newer version?" request: never cache it

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
