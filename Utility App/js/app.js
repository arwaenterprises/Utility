// ============================================
// SCREEN NAVIGATION
// ============================================
function showScreen(screenId) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(screenId).classList.add('active');
    AppState.currentScreen = screenId;
}

// ============================================
// AUTH (Google sign-in via Supabase)
// ============================================
async function signInWithGoogle() {
    const errorDiv = document.getElementById('loginError');
    errorDiv.classList.remove('show');
    const { error } = await supabaseClient.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: window.location.origin }
    });
    if (error) showError(errorDiv, error.message);
}

async function signOut() {
    Camera.stopAll();
    await supabaseClient.auth.signOut();
    AppState.user = null;
    AppState.profile = null;
    AppState.operator = null;
    document.body.classList.remove('operator-mode');
    updateHeaderUser();
    showScreen('loginScreen');
}

async function loadUserProfile() {
    const { data, error } = await supabaseClient
        .from('profiles')
        .select('*')
        .eq('id', AppState.user.id)
        .single();
    if (error) {
        console.error('Failed to load profile:', error);
        return;
    }
    AppState.profile = data;
}

// Re-reads this account's profile from the server. Team membership can change while a phone is
// open (the admin removes or adds the person), and every scan is checked against the CURRENT team
// when it is uploaded - a stale profile would stamp scans with a team the person no longer belongs to
// and the server would refuse them. minGapMs stops repeated calls (0 = always ask).
let lastProfileCheckMs = 0;
async function refreshProfile(minGapMs) {
    if (!AppState.user || !AppState.isOnline) return false;
    const now = Date.now();
    if (minGapMs && now - lastProfileCheckMs < minGapMs) return false;
    lastProfileCheckMs = now;
    const { data, error } = await supabaseClient.from('profiles').select('*').eq('id', AppState.user.id).single();
    if (error || !data) return false;
    const changed = (AppState.profile?.enterprise_id || null) !== (data.enterprise_id || null) || AppState.profile?.tier !== data.tier;
    AppState.profile = data;
    if (changed) {
        updateHeaderUser();
        if (document.getElementById('homeScreen').classList.contains('active')) renderAppGrid();
    }
    return changed;
}

// "new row violates row-level security policy" (code 42501) = the server refused the data for this account.
function isPermissionError(err) {
    return !!err && (err.code === '42501' || /row-level security|permission denied/i.test(err.message || ''));
}

async function enterAppAsSignedInUser(session) {
    AppState.user = session.user;
    await loadUserProfile();
    // Every Google sign-in is its own team: accounts made before that rule get theirs on the next sign-in.
    if (AppState.profile?.tier === 'individual' && !AppState.profile?.enterprise_id && AppState.isOnline) {
        const { error: teamError } = await supabaseClient.rpc('ensure_own_team');
        if (!teamError) await loadUserProfile();
    }
    updateHeaderUser();
    checkExistingSession();
    showScreen('homeScreen');
    renderAppGrid();
}

function showError(element, message) {
    element.textContent = message;
    element.classList.add('show');
}

function updateHeaderUser() {
    const el = document.getElementById('headerUser');
    const signOutBtn = document.getElementById('signOutBtn');
    if (AppState.user && AppState.operator) {          // a labourer: name and "leave this job" only
        el.textContent = AppState.operator.name;
        el.classList.add('show');
        signOutBtn.classList.add('show');
    } else if (AppState.user) {
        el.textContent = AppState.profile?.display_name || AppState.user.email;
        el.classList.add('show');
        signOutBtn.classList.add('show');
    } else {
        el.classList.remove('show');
        signOutBtn.classList.remove('show');
    }
}

// ============================================
// SHARED HELPERS
// ============================================
function escapeHtml(str) {
    return String(str ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Supabase returns at most ~1000 rows per request, so anything that exports (and then
// possibly deletes) a member's data must page through ALL of it, or rows would be
// deleted without ever having been exported. makeQuery(from, to) builds one page.
async function fetchAllPages(makeQuery) {
    const pageSize = 1000;
    const rows = [];
    for (let from = 0; ; from += pageSize) {
        const { data, error } = await makeQuery(from, from + pageSize - 1);
        if (error) return { data: null, error };
        rows.push(...data);
        if (data.length < pageSize) break;
    }
    return { data: rows, error: null };
}

// ---- Year/Season Sort scans (separate from Box Scanner scans) ----

// ============================================
// HOME SCREEN
// ============================================
function renderAppGrid() {
    const grid = document.getElementById('appGrid');
    grid.innerHTML = '';
    
    // the Team & Data tile is for the team's admin (every Google sign-in is the admin of its own team)
    APPS.filter(app => !app.hidden && !(app.modal && AppState.profile?.tier !== 'enterprise_admin')).forEach(app => {
        const tile = document.createElement('div');
        tile.className = 'app-tile';
        tile.dataset.appId = app.id;
        
        const isLocked = AppState.hasActiveSession && AppState.activeSessionApp !== app.id && app.sessionRequired;
        if (isLocked) tile.classList.add('locked');
        
        tile.innerHTML = `
            <span class="app-tile-icon">${appIconHtml(app, 'app-tile-img')}</span>
            <span class="app-tile-name">${appName(app)}</span>
            <span class="app-tile-lock">🔒</span>
        `;
        
        tile.addEventListener('click', () => { if (isLocked) return; if (app.modal) openWorkspace(); else openApp(app.id); });
        grid.appendChild(tile);
    });
    
    updateSessionBanner();
}

function updateSessionBanner() {
    const banner = document.getElementById('sessionBanner');
    banner.classList.toggle('show', AppState.hasActiveSession);
}

// ============================================
// APP NAVIGATION
// ============================================
// The title bar of an open tool, in the app language.
function setAppTitle(app) {
    document.getElementById('appTitleText').innerHTML = `${appIconHtml(app, 'title-icon')} ${appName(app)}`;
    document.getElementById('appSubtitleText').textContent = appDesc(app);
}

// Tool names follow the app language everywhere they are shown.
function refreshToolNames() {
    if (document.getElementById('homeScreen').classList.contains('active')) renderAppGrid();
    const open = APPS.find(a => a.id === AppState.currentApp);
    if (open && document.getElementById('appScreen').classList.contains('active')) setAppTitle(open);
}

function openApp(appId) {
    const app = APPS.find(a => a.id === appId);
    if (!app) return;
    
    AppState.currentApp = appId;
    setAppTitle(app);
    
    document.querySelectorAll('.app-module').forEach(m => m.classList.remove('active'));
    document.getElementById(app.containerId).classList.add('active');
    
    updateBackButton();
    showScreen('appScreen');
    initializeApp(appId);
    if (typeof helpAutoShowOnce === 'function') helpAutoShowOnce(appId);
}

function updateBackButton() {
    const btn = document.getElementById('appBackBtn');
    if (AppState.operator) return;                 // a labourer's device has no Home: the back button is hidden by CSS
    const app = APPS.find(a => a.id === AppState.currentApp);
    
    if (app && app.sessionRequired && AppState.hasActiveSession) {
        btn.classList.add('disabled');
        btn.title = 'Complete or reset session to go back';
    } else {
        btn.classList.remove('disabled');
        btn.title = 'Back to Home';
    }
}

function goToHome() {
    Camera.stopAll();                              // never leave a camera running behind another screen
    const app = APPS.find(a => a.id === AppState.currentApp);
    if (AppState.operator) return;                 // a labourer stays inside the one tool of the QR link
    if (app && app.sessionRequired && AppState.hasActiveSession) return;
    
    AppState.currentApp = null;
    showScreen('homeScreen');
    renderAppGrid();
}

// ============================================
// SESSION MANAGEMENT
// ============================================
function setActiveSession(appId, active) {
    AppState.hasActiveSession = active;
    AppState.activeSessionApp = active ? appId : null;
    if (active) {
        Storage.set('active_session', appId);
    } else {
        Storage.remove('active_session');
    }
    updateBackButton();
}

function checkExistingSession() {
    const activeSession = Storage.get('active_session');
    if (activeSession) {
        AppState.hasActiveSession = true;
        AppState.activeSessionApp = activeSession;
    }
}

// ============================================
// APP INITIALIZATION
// ============================================
function initializeApp(appId) {
    switch (appId) {
        case 'boxScanner': initBoxScanner(); break;
        case 'itemBarcode': initItemBarcode(); break;
        case 'boxCode': initBoxCode(); break;
        case 'boxSegregate': initBoxSegregate(); break;
        case 'priceCheck': initPriceCheck(); break;
        case 'yearSegregate': initYearSegregate(); break;
    }
}

// EVENT LISTENERS
// ============================================
function setupEventListeners() {
    document.getElementById('googleSignInBtn').addEventListener('click', signInWithGoogle);
    document.getElementById('signOutBtn').addEventListener('click', () => { if (AppState.operator) operatorLeave(); else signOut(); });
    document.getElementById('joinBtn').addEventListener('click', operatorSubmitJoin);
    document.getElementById('joinNameInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') operatorSubmitJoin(); });
    document.getElementById('joinSignOutBtn').addEventListener('click', async () => { await signOut(); const t = operatorTokenFromUrl(); if (t) operatorShowJoin(t, null); });
    document.getElementById('appBackBtn').addEventListener('click', goToHome);
    document.getElementById('goToSessionBtn').addEventListener('click', () => { if (AppState.activeSessionApp) openApp(AppState.activeSessionApp); });
    document.getElementById('updateBtn').addEventListener('click', onUpdateIconTap);
    document.getElementById('updateNowBtn').addEventListener('click', updateAppNow);
    document.getElementById('updateLaterBtn').addEventListener('click', () => { document.getElementById('updateModal').classList.remove('active'); });
}

// ============================================
// SERVICE WORKER
// ============================================
// Registers sw.js so every browser/tablet checks for and picks up the latest
// deployed files, with an offline fallback to the last-known-good copy.
// ============================================
// APP UPDATES
// ============================================
// An installed app (PWA) that stays in the background keeps running the page it loaded, so a new
// deploy can go unnoticed for days. Every deploy bumps the version number (the ?v= on the script tags
// and CACHE_VERSION in sw.js). The app compares the version it is running with the one on the server
// when it opens, when it comes back to the foreground and when the connection returns, and shows a
// red dot and a popup instead of reloading by itself (a reload in the middle of a scan would be worse).
function runningAppVersion() {
    const tag = document.querySelector('script[src*="js/app.js"]');
    const m = tag && tag.getAttribute('src').match(/[?&]v=(\d+)/);
    return m ? Number(m[1]) : 0;
}

async function fetchServerAppVersion() {
    const res = await fetch('sw.js?check=' + Date.now(), { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const m = (await res.text()).match(/CACHE_VERSION\s*=\s*'ak-utility-v(\d+)'/);
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

// ============================================
// INITIALIZATION
// ============================================
async function initApp() {
    updateOnlineStatus();
    setupEventListeners();
    if (typeof AppLang !== 'undefined') AppLang.onChange(refreshToolNames);
    refreshToolNames();
    registerServiceWorker();
    scheduleUpdateChecks();

    const { data: { session } } = await supabaseClient.auth.getSession();
    const joinToken = operatorTokenFromUrl();
    if (joinToken) {
        await operatorShowJoin(joinToken, session);
    } else if (isOperatorSession(session)) {
        await operatorEnter(session);
    } else if (session) {
        await enterAppAsSignedInUser(session);
    } else {
        showScreen('loginScreen');
    }

    window.addEventListener('online', () => refreshProfile(60000));
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refreshProfile(60000); });

    supabaseClient.auth.onAuthStateChange(async (event, session) => {
        if (event === 'SIGNED_IN' && session) {
            if (isOperatorSession(session)) return;        // a labourer's anonymous sign-in: js/operator.js takes it from here
            // Supabase re-fires SIGNED_IN on token refresh (e.g. when the tab
            // regains focus after being idle), not just on a genuine new login.
            // Only navigate to home for an actual new sign-in - otherwise this
            // was yanking people back to the home screen mid-task (e.g. out of
            // an open Box Scanner session) every time the tab refocused.
            if (AppState.user) {
                AppState.user = session.user;
                return;
            }
            await enterAppAsSignedInUser(session);
        } else if (event === 'SIGNED_OUT') {
            AppState.user = null;
            AppState.profile = null;
            updateHeaderUser();
            showScreen('loginScreen');
        }
    });
}

document.addEventListener('DOMContentLoaded', initApp);
