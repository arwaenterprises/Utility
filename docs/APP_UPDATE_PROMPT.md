# PROMPT FOR A NEW CHAT — build the in-app “update available” logic in my Attendance app

*(Copy everything below this line into the new chat as your first message. It is written to be self-contained: it contains the working code from my other app, “Utility”, which is live and tested. Nothing here needs access to the Utility repository.)*

---

You are helping me add **reliable app-update logic** to my **Attendance app**. I already built this for another app (“Utility”) and it works well in the field; I want the same behaviour and quality here. Read all of this first, then look at my Attendance code, then tell me your plan before changing anything.

## Rules for how you work with me
- If something is unclear, or you are not sure a function / API exists, **say so and ask me in plain text, one question at a time**. Do not guess and do not invent function names or library methods — tell me to verify in the current docs.
- Do nothing destructive (no deleting files, no force-pushing) unless I ask. Work on the branch I name. Do not create a pull request unless I ask.
- Keep it simple; do not over-engineer. No automatic e-mails, no analytics.
- Write a test for every behaviour you add (Playwright headless browser test with a mocked network, like the ones described at the end), and run all tests before saying it is done. Report honestly if anything fails.
- If my Attendance app has a different structure from what is described here (framework, bundler, hosting), tell me what changes before you start.

## What this app type looks like (Utility — and probably Attendance)
Static web app / PWA: plain HTML + JavaScript files (no bundler), hosted on Netlify (publish folder = the app folder), offline-first with a service worker, installed on tablets and phones. Users keep the app open or installed for days, so **a new deploy can go unnoticed**. That is the problem this logic solves.

## The design (what the logic does)
1. **One version number per release.** An integer *N*. It must always be the same in two places: (a) the `?v=N` query on **every** `<script src>` tag of the app’s own JS files in `index.html`, and (b) `const CACHE_VERSION = 'ak-attendance-vN'` in `sw.js`. **Bump both on every deploy that changes any app file.** Static checks + CI enforce this (see below).
2. **Service worker (`sw.js`)**: on install → `skipWaiting()` and pre-cache the app shell into the cache named `CACHE_VERSION`; on activate → delete every cache with a different name, then `clients.claim()`; on fetch → handle only same-origin GET requests, **ignore any request that has a `?check=` parameter** (never cache the version check), **network-first** (try network, store the copy in the cache, return it; if the network fails return the cached copy). So online devices always get fresh files; offline devices run the last good copy.
3. **Server must never cache `index.html` and `sw.js`**: Netlify headers `Cache-Control: no-cache` for both (snippet below).
4. **Running version** = the number in the `?v=` of the `app.js` script tag of the page that is running.
5. **Server version** = fetch `sw.js?check=<Date.now()>` with `{cache: 'no-store'}`, read `CACHE_VERSION` with a regular expression, compare the numbers. Server number > running number ⇒ an update is available.
6. **When it checks:** 4 seconds after the app opens; when the app/tab returns to the foreground *and* the last check was more than 5 minutes ago; 2 seconds after the `online` event. It never checks while offline.
7. **What the user sees:** an **update icon button in the top bar next to the Online/Offline badge**. A **red dot** on it means “a new version is waiting”. Tapping the icon: if an update is waiting → opens the popup; otherwise → checks now and the popup shows the result (“Checking…”, “You have the latest version”, “You are offline…”, “Could not check right now”). The popup is a **centred modal in the middle of the screen** (an earlier bottom banner was covered by the “Powered by Netlify” badge in the bottom-right corner, hiding its button). Buttons: **Update now** and **Later** (just **OK** when there is no update). When a *check finds* a newer version the popup opens by itself — **unless another modal window is already open** (then only the dot appears). **It never reloads by itself**: a reload in the middle of work would lose the operator’s place.
8. **Update now** = unregister all service workers + delete all caches (this does NOT touch IndexedDB / localStorage, so no user data is lost), then `location.reload()`. When offline it refuses with a message.
9. **`controllerchange` safety:** if the page already had a service worker controller when it loaded and a different worker later takes control, reload once (guarded so it can only happen once). On the very first install (no controller yet) do nothing.
10. **Everything user-visible must be bilingual if my app is** (my Utility app is English + Arabic with right-to-left layout; ask me whether Attendance needs Arabic and follow the same rule: new texts, tooltips and help in both languages, tests fail if a translation is missing).

## Code to reproduce (adapt names to the Attendance app)

### `sw.js`
```js
// ============================================
// ATTENDANCE - SERVICE WORKER
// ============================================
// Goal: every tablet/browser gets the latest deployed files as soon as
// possible, while still working offline off the last-known-good copy.
//
// BUMP CACHE_VERSION every time you deploy a change to index.html/js/css,
// same as the ?v= numbers in index.html's script tags.
const CACHE_VERSION = 'ak-attendance-v55';

const APP_SHELL = [
    './',
    './index.html',
    './style.css',
    './manifest.webmanifest',
    // ... EVERY file the app needs offline: all js files, icons, other pages
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
```

### Update logic in the main JS file (`app.js`)
`AppState.isOnline` is a boolean the app keeps up to date from the browser’s online/offline events; `AppState.updatePending` holds the server version number (or null).
```js
// ============================================
// APP UPDATES
// ============================================
// An installed app (PWA) that stays in the background keeps running the page it loaded, so a new
// deploy can go unnoticed for days. Every deploy bumps the version number (the ?v= on the script tags
// and CACHE_VERSION in sw.js). The app compares the version it is running with the one on the server
// when it opens, when it comes back to the foreground and when the connection returns, and shows a
// red dot and a popup instead of reloading by itself (a reload in the middle of work would be worse).
function runningAppVersion() {
    const tag = document.querySelector('script[src*="js/app.js"]');
    const m = tag && tag.getAttribute('src').match(/[?&]v=(\d+)/);
    return m ? Number(m[1]) : 0;
}

async function fetchServerAppVersion() {
    const res = await fetch('sw.js?check=' + Date.now(), { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const m = (await res.text()).match(/CACHE_VERSION\s*=\s*'ak-attendance-v(\d+)'/);
    return m ? Number(m[1]) : 0;
}

// Returns 'newer' | 'current' | 'offline' | 'unknown'.
// 'newer' also lights the red dot on the update icon; with { popup: true } it opens the centred popup by itself
// (unless another window is open - then only the dot shows and the popup waits for a tap on the icon).
async function checkForAppUpdate(opts) {
    if (!AppState.isOnline) return 'offline';
    try {
        const server = await fetchServerAppVersion();
        const running = runningAppVersion();
        if (!server || !running) return 'unknown';
        if (server > running) {
            AppState.updatePending = server;
            document.getElementById('updateDot').hidden = false;
            if (opts && opts.popup && !document.querySelector('.modal-overlay.active')) showUpdateModal('newer');
            return 'newer';
        }
        AppState.updatePending = null;
        document.getElementById('updateDot').hidden = true;
        return 'current';
    } catch (e) {
        return 'unknown';
    }
}

// The centred update popup. state: 'checking' | 'newer' | 'current' | 'offline' | 'unknown'
function showUpdateModal(state) {
    const text = {
        checking: 'Checking for a new version…',
        newer: `A new version (v${AppState.updatePending}) is ready. Tap Update now to install it.`,
        current: 'You have the latest version.',
        offline: 'You are offline - connect to the internet to check for updates.',
        unknown: 'Could not check right now. Please try again in a moment.'
    };
    document.getElementById('appVersionDisp').textContent = 'v' + runningAppVersion();
    document.getElementById('updateModalText').textContent = text[state] || text.unknown;
    document.getElementById('updateNowBtn').style.display = state === 'newer' ? '' : 'none';
    document.getElementById('updateLaterBtn').textContent = state === 'newer' ? 'Later' : 'OK';
    document.getElementById('updateModal').classList.add('active');
}

async function onUpdateIconTap() {
    if (AppState.updatePending) { showUpdateModal('newer'); return; }
    showUpdateModal('checking');
    const result = await checkForAppUpdate();
    showUpdateModal(result);
}

// Forget the offline copy of the app files (NOT your scans or settings) and the old service worker.
async function clearAppCaches() {
    try {
        if ('serviceWorker' in navigator) {
            for (const reg of await navigator.serviceWorker.getRegistrations()) await reg.unregister();
        }
        if (window.caches) {
            for (const key of await caches.keys()) await caches.delete(key);
        }
    } catch (e) { /* reload anyway */ }
}

async function updateAppNow() {
    if (!AppState.isOnline) { alert('You are offline. Connect to the internet to update the app.'); return; }
    await clearAppCaches();
    window.location.reload();
}

let lastUpdateCheck = 0;
function scheduleUpdateChecks() {
    const run = () => { lastUpdateCheck = Date.now(); checkForAppUpdate({ popup: true }); };
    setTimeout(run, 4000);                                           // shortly after opening
    document.addEventListener('visibilitychange', () => {            // coming back to the foreground
        if (document.visibilityState === 'visible' && Date.now() - lastUpdateCheck > 5 * 60000) run();
    });
    window.addEventListener('online', () => setTimeout(run, 2000));
}

function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;

    // A controller already present means an earlier visit's service worker is
    // running this page. If that flips to a different one later, it's a real
    // update. On a first-ever visit there's no controller yet, so a claim
    // right after install isn't an update - don't reload for that one.
    const hadController = !!navigator.serviceWorker.controller;

    window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js').catch((err) => console.error('SW registration failed:', err));
    });

    let swRefreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (!hadController) return;
        if (swRefreshing) return;
        swRefreshing = true;
        window.location.reload();
    });
}
```
Wiring (once, when the page’s event listeners are set up):
```js
    document.getElementById('updateBtn').addEventListener('click', onUpdateIconTap);
    document.getElementById('updateNowBtn').addEventListener('click', updateAppNow);
    document.getElementById('updateLaterBtn').addEventListener('click', () => { document.getElementById('updateModal').classList.remove('active'); });
```
Also call `registerServiceWorker();` and `scheduleUpdateChecks();` when the app starts.

### HTML — the top-bar icon and the popup
Use your own icon picture (a small “box with a down arrow” in my app). Put the button next to the online badge.
```html
        <button class="hdr-btn" id="updateBtn" type="button" title="App updates" aria-label="App updates"><img src="icons/ui-update.png" alt=""><span class="hdr-dot" id="updateDot" hidden></span></button>

    <!-- APP UPDATE POPUP (centred, so nothing in a corner can cover its buttons). Opened by the update icon in the top bar,
         or by itself when the server has a newer version than the one running. -->
    <div class="modal-overlay update-overlay" id="updateModal" role="dialog" aria-modal="true" aria-labelledby="updateModalTitle">
        <div class="modal update-modal">
            <img class="update-modal-icon" src="icons/ui-update.png" alt="">
            <h3 class="modal-title" id="updateModalTitle">App update</h3>
            <div class="modal-body">
                <p id="updateModalText"></p>
                <p class="update-ver">Running version <strong id="appVersionDisp">v?</strong></p>
            </div>
            <div class="modal-buttons">
                <button class="btn btn-primary" id="updateNowBtn" type="button">Update now</button>
                <button class="btn btn-secondary" id="updateLaterBtn" type="button">Later</button>
            </div>
        </div>
    </div>
```
(The popup relies on the app’s existing modal classes `.modal-overlay` / `.modal` / `.modal-title` / `.modal-body` / `.modal-buttons`, with `.modal-overlay.active { display: flex; }`. If Attendance has no modal styles, create equivalent ones.)

### CSS (only the update-specific rules)
```css
/* update icon in the top bar, with the red dot (use your own header colour instead of var(--ak-maroon)) */
.hdr-btn img { width: 22px; height: 22px; display: block; }
.hdr-btn { position: relative; width: 34px; height: 34px; padding: 5px; border-radius: 50%; border: none; background: rgba(255, 255, 255, 0.15); display: flex; align-items: center; justify-content: center; cursor: pointer; flex: 0 0 auto; }
.hdr-dot { position: absolute; top: 1px; right: 1px; width: 11px; height: 11px; border-radius: 50%; background: #ff3b30; border: 2px solid var(--ak-maroon); }
.hdr-dot[hidden] { display: none; }
/* app update popup: centred, above everything */
.update-overlay { z-index: 1200; }
.update-modal { max-width: 360px; text-align: center; }
.update-modal-icon { width: 64px; height: 64px; display: block; margin: 0 auto 6px; }
.update-ver { font-size: 12px; color: var(--ak-text-light); margin-top: 6px; }
```

### Netlify headers (`netlify.toml`)
```toml
[[headers]]
  for = "/index.html"
  [headers.values]
    Cache-Control = "no-cache"

[[headers]]
  for = "/sw.js"
  [headers.values]
    Cache-Control = "no-cache"
```

## Automatic safety nets (static checks run in CI on every push)
These caught real mistakes in my other app. Please add equivalents (a Node script `tests/static-checks.js`, run by GitHub Actions with `BASE_SHA` set):
```js
// 2. index.html script tags: files exist, one shared ?v= number, and all are cached by the service worker.
const tags = [...html.matchAll(/<script src="(js\/[^"?]+)\?v=(\d+)"><\/script>/g)].map(m => ({ file: m[1], v: m[2] }));
check('index.html loads app scripts', tags.length >= 8, tags.length);
check('every script file exists', tags.every(t => fs.existsSync(path.join(APP, t.file))), tags.filter(t => !fs.existsSync(path.join(APP, t.file))).map(t => t.file).join());
check('all script tags use the same ?v= number', new Set(tags.map(t => t.v)).size === 1, [...new Set(tags.map(t => t.v))].join());
const swVersionNum = Number((sw.match(/CACHE_VERSION\s*=\s*'ak-attendance-v(\d+)'/) || [])[1]);
check('sw.js CACHE_VERSION number equals the ?v= number on the script tags (the in-app "new version" check compares them)', tags.length > 0 && tags.every(t => Number(t.v) === swVersionNum), `sw=${swVersionNum} tags=${[...new Set(tags.map(t => t.v))].join()}`);
```
```js
// 6. Cache version bump: any change inside "Attendance App/" (other than sw.js itself) needs a new CACHE_VERSION,
//    otherwise tablets keep running the old files.
const version = s => (s.match(/CACHE_VERSION\s*=\s*'([^']+)'/) || [])[1];
const base = process.env.BASE_SHA;
if (base && !/^0+$/.test(base)) {
  let changed = [];
  let baseSw = '';
  try {
    changed = execSync(`git diff --name-only ${base} HEAD -- "Attendance App"`, { cwd: ROOT }).toString().split('\n').filter(f => f && !f.endsWith('/sw.js'));
    baseSw = execSync(`git show ${base}:"Attendance App/sw.js"`, { cwd: ROOT }).toString();
  } catch (e) { console.log('NOTE could not compare with ' + base + ' (' + String(e.message).split('\n')[0] + ')'); }
  if (baseSw) check('cache version bumped when the app changed', changed.length === 0 || version(baseSw) !== version(sw), `${changed.length} app file(s) changed but CACHE_VERSION is still ${version(sw)}`);
} else {
  console.log('NOTE BASE_SHA not set - skipping the cache-version-bump check');
}
```
GitHub Actions step (the `BASE_SHA` is what lets the check compare with the previous commit):
```yaml
      - name: Static checks
        run: node tests/static-checks.js
        env:
          BASE_SHA: ${{ github.event.pull_request.base.sha || github.event.before }}
```
Also check: the service worker’s `APP_SHELL` lists every JS file the page loads and every file it lists exists.

## Tests I expect (Playwright, headless Chromium, network mocked, `window.fetch` replaced)
- the running version is read from the script tags;
- against the real file: “up to date” → no red dot, no popup;
- a newer `CACHE_VERSION` on the “server” → red dot lights; a plain manual check does not open the popup;
- an automatic check finding a newer version opens the **centred** popup (assert its centre is near the middle of the viewport, not at the bottom) with the new number and an **Update now** button; **Later** closes it and the dot stays;
- tapping the icon with an update waiting re-opens the popup;
- an automatic check does **not** open the popup while another modal is open (dot only);
- same version again clears the dot; a failed fetch is harmless (“unknown”, no dot); offline → no check is made;
- tapping the icon when up to date shows “latest version” and the running version number;
- “Update now” clears the service workers and caches (assert registrations = 0 and caches = 0) but leaves localStorage/IndexedDB data alone.

## Pitfalls I hit (avoid them)
- **Version drift:** forgetting to bump `?v=` or `CACHE_VERSION` ⇒ devices never see the update. The static checks above exist for this reason.
- **The version regex must keep matching:** keep the line exactly `const CACHE_VERSION = 'ak-attendance-vN';` (single quotes, that prefix).
- **Never cache the `?check=` request** in the service worker, or “latest version” would be answered from the cache forever.
- **Popup position:** a bottom banner can be hidden by other fixed elements (Netlify badge, on-screen keyboards). Centre it, with a z-index above all other modals.
- **Don’t interrupt work:** no automatic reload; no popup on top of another open window.
- **Windows line endings:** some of my files use CRLF; edit them in a way that preserves the line endings, and never write a file with a call that truncates it before reading it.
- **iOS Safari:** a Safari tab and the installed home-screen app keep **separate** storage; test the update flow in both and tell me what you find.
- **Hosting:** if Attendance is not on Netlify, tell me how to set “no-cache” for `index.html` and `sw.js` on that host.

## What I want from you now
1. Look at the Attendance code and tell me: framework/bundler, where the JS files are, whether a service worker or manifest exists already, how modals and the top bar are built, whether it needs Arabic.
2. Tell me your plan and the list of files you will touch. Wait for my “go”.
3. Build it, with the tests and static checks, run everything, and show me screenshots of the top bar icon (with and without the red dot) and the popup on a phone-sized screen.
4. Commit to the branch I name and tell me how to verify it on a real device (how to simulate “a new version is deployed”).
