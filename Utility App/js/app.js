// ============================================
// SCREEN NAVIGATION
// ============================================
function showScreen(screenId) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(screenId).classList.add('active');
    AppState.currentScreen = screenId;
}

// ============================================
// GOOGLE SHEETS API
// ============================================
// Still used by tools not yet migrated to Supabase (Item Barcode, Box Code,
// Price Check, Box Segregate, Year/Season Sort - hidden in this pilot build).
async function fetchFromGoogleSheets(action, params = {}) {
    if (!AppState.isOnline) return null;
    try {
        const url = new URL(CONFIG.GOOGLE_SCRIPT_URL);
        url.searchParams.append('action', action);
        Object.keys(params).forEach(k => url.searchParams.append(k, params[k]));
        const response = await fetch(url.toString());
        return await response.json();
    } catch (e) {
        console.error('Google Sheets fetch error:', e);
        return null;
    }
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
    await supabaseClient.auth.signOut();
    AppState.user = null;
    AppState.profile = null;
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

async function enterAppAsSignedInUser(session) {
    AppState.user = session.user;
    await loadUserProfile();
    updateHeaderUser();
    checkExistingSession();
    await checkForMyPendingInvite();
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
    const accountBtn = document.getElementById('accountBtn');
    if (AppState.user) {
        el.textContent = AppState.profile?.display_name || AppState.user.email;
        el.classList.add('show');
        signOutBtn.classList.add('show');
        accountBtn.classList.add('show');
    } else {
        el.classList.remove('show');
        signOutBtn.classList.remove('show');
        accountBtn.classList.remove('show');
    }
}

// ============================================
// ACCOUNT / ENTERPRISE
// ============================================
function tierDisplayText(profile) {
    if (!profile) return '';
    if (profile.tier === 'enterprise_admin') return 'Enterprise Admin';
    if (profile.tier === 'enterprise_member') return 'Enterprise Member';
    return 'Individual';
}

async function openAccountModal() {
    document.getElementById('accountEmailDisp').textContent = AppState.user?.email || '';
    document.getElementById('accountTierDisp').textContent = tierDisplayText(AppState.profile);

    const isIndividual = AppState.profile?.tier === 'individual';
    const isAdmin = AppState.profile?.tier === 'enterprise_admin';
    document.getElementById('createEnterpriseSection').style.display = isIndividual ? 'block' : 'none';
    document.getElementById('inviteTeammateSection').style.display = isAdmin ? 'block' : 'none';

    if (isAdmin) await loadPendingInvitesList();

    document.getElementById('accountModal').classList.add('active');
}

function closeAccountModal() {
    document.getElementById('accountModal').classList.remove('active');
}

async function createEnterprise() {
    const name = document.getElementById('enterpriseNameInput').value.trim();
    if (!name) return;
    const { error } = await supabaseClient.rpc('create_enterprise', { enterprise_name: name });
    if (error) {
        alert(error.message);
        return;
    }
    await loadUserProfile();
    updateHeaderUser();
    document.getElementById('enterpriseNameInput').value = '';
    await openAccountModal();
}

async function sendInvite() {
    const email = document.getElementById('inviteEmailInput').value.trim();
    if (!email) return;
    const { error } = await supabaseClient.from('enterprise_invites').insert({
        enterprise_id: AppState.profile.enterprise_id,
        invited_email: email,
        invited_by: AppState.user.id
    });
    if (error) {
        alert(error.message);
        return;
    }
    document.getElementById('inviteEmailInput').value = '';
    await loadPendingInvitesList();
}

async function loadPendingInvitesList() {
    const listEl = document.getElementById('pendingInvitesList');
    const { data, error } = await supabaseClient
        .from('enterprise_invites')
        .select('invited_email, status')
        .eq('enterprise_id', AppState.profile.enterprise_id)
        .order('created_at', { ascending: false });
    if (error) {
        listEl.textContent = '';
        return;
    }
    listEl.innerHTML = data.map(inv =>
        `<div style="font-size: 13px; padding: 4px 0;">${inv.invited_email} — ${inv.status}</div>`
    ).join('') || '<div style="font-size: 13px; color: var(--ak-text-light);">No invites yet</div>';
}

async function checkForMyPendingInvite() {
    if (AppState.profile?.tier !== 'individual') return;
    const { data, error } = await supabaseClient
        .from('enterprise_invites')
        .select('token')
        .eq('status', 'pending')
        .ilike('invited_email', AppState.user.email)
        .limit(1)
        .maybeSingle();
    if (error || !data) return;
    AppState.pendingInviteToken = data.token;
    document.getElementById('inviteBanner').style.display = 'flex';
}

async function acceptMyInvite() {
    if (!AppState.pendingInviteToken) return;
    const { error } = await supabaseClient.rpc('accept_enterprise_invite', { invite_token: AppState.pendingInviteToken });
    if (error) {
        alert(error.message);
        return;
    }
    AppState.pendingInviteToken = null;
    document.getElementById('inviteBanner').style.display = 'none';
    await loadUserProfile();
    updateHeaderUser();
}

// ============================================
// HOME SCREEN
// ============================================
function renderAppGrid() {
    const grid = document.getElementById('appGrid');
    grid.innerHTML = '';
    
    APPS.filter(app => !app.hidden).forEach(app => {
        const tile = document.createElement('div');
        tile.className = 'app-tile';
        tile.dataset.appId = app.id;
        
        const isLocked = AppState.hasActiveSession && AppState.activeSessionApp !== app.id && app.sessionRequired;
        if (isLocked) tile.classList.add('locked');
        
        tile.innerHTML = `
            <span class="app-tile-icon">${app.icon}</span>
            <span class="app-tile-name">${app.name}</span>
            <span class="app-tile-lock">🔒</span>
        `;
        
        tile.addEventListener('click', () => { if (!isLocked) openApp(app.id); });
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
function openApp(appId) {
    const app = APPS.find(a => a.id === appId);
    if (!app) return;
    
    AppState.currentApp = appId;
    document.getElementById('appTitleText').innerHTML = `${app.icon} ${app.name}`;
    document.getElementById('appSubtitleText').textContent = app.description;
    
    document.querySelectorAll('.app-module').forEach(m => m.classList.remove('active'));
    document.getElementById(app.containerId).classList.add('active');
    
    updateBackButton();
    showScreen('appScreen');
    initializeApp(appId);
}

function updateBackButton() {
    const btn = document.getElementById('appBackBtn');
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
    const app = APPS.find(a => a.id === AppState.currentApp);
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
        case 'photoCapture': initPhotoCapture(); break;
        case 'boxSegregate': initBoxSegregate(); break;
        case 'priceCheck': initPriceCheck(); break;
        case 'yearSegregate': initYearSegregate(); break;
    }
}

// EVENT LISTENERS
// ============================================
function setupEventListeners() {
    document.getElementById('googleSignInBtn').addEventListener('click', signInWithGoogle);
    document.getElementById('signOutBtn').addEventListener('click', signOut);
    document.getElementById('appBackBtn').addEventListener('click', goToHome);
    document.getElementById('goToSessionBtn').addEventListener('click', () => { if (AppState.activeSessionApp) openApp(AppState.activeSessionApp); });
    document.getElementById('accountBtn').addEventListener('click', openAccountModal);
    document.getElementById('closeAccountBtn').addEventListener('click', closeAccountModal);
    document.getElementById('createEnterpriseBtn').addEventListener('click', createEnterprise);
    document.getElementById('sendInviteBtn').addEventListener('click', sendInvite);
    document.getElementById('acceptInviteBtn').addEventListener('click', acceptMyInvite);
}

// ============================================
// SERVICE WORKER
// ============================================
// Registers sw.js so every browser/tablet checks for and picks up the latest
// deployed files, with an offline fallback to the last-known-good copy.
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
    registerServiceWorker();

    const { data: { session } } = await supabaseClient.auth.getSession();
    if (session) {
        await enterAppAsSignedInUser(session);
    } else {
        showScreen('loginScreen');
    }

    supabaseClient.auth.onAuthStateChange(async (event, session) => {
        if (event === 'SIGNED_IN' && session) {
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
