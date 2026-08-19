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
// STORE LOGIN
// ============================================
async function lookupStore() {
    const input = document.getElementById('storeIdInput');
    const errorDiv = document.getElementById('loginError');
    const btn = document.getElementById('lookupStoreBtn');
    const btnText = document.getElementById('lookupBtnText');
    
    const storeId = input.value.trim().toUpperCase();
    if (!storeId) {
        showError(errorDiv, 'Please enter a Store ID');
        return;
    }
    
    btn.disabled = true;
    btnText.innerHTML = '<span class="spinner"></span> Looking up...';
    errorDiv.classList.remove('show');
    
    const result = await fetchFromGoogleSheets('getStore', { storeId });
    
    btn.disabled = false;
    btnText.textContent = 'Lookup Store';
    
    if (result && result.success && result.store) {
        AppState.storeId = result.store.storeId;
        AppState.storeName = result.store.storeName;
        AppState.storeLocation = result.store.location;
        
        document.getElementById('confirmStoreId').textContent = result.store.storeId;
        document.getElementById('confirmStoreName').textContent = result.store.storeName;
        document.getElementById('confirmLocation').textContent = result.store.location;
        
        document.getElementById('storeConfirmBox').style.display = 'block';
        btn.style.display = 'none';
    } else {
        showError(errorDiv, 'Store not found. Please check the Store ID.');
    }
}

function confirmStore(confirmed) {
    if (confirmed) {
        Storage.set('store_id', AppState.storeId);
        Storage.set('store_name', AppState.storeName);
        Storage.set('store_location', AppState.storeLocation);
        updateHeaderStore();
        showScreen('homeScreen');
        renderAppGrid();
    } else {
        document.getElementById('storeIdInput').value = '';
        document.getElementById('storeConfirmBox').style.display = 'none';
        document.getElementById('lookupStoreBtn').style.display = 'block';
        AppState.storeId = '';
        AppState.storeName = '';
        AppState.storeLocation = '';
    }
}

function showError(element, message) {
    element.textContent = message;
    element.classList.add('show');
}

function updateHeaderStore() {
    const el = document.getElementById('headerStore');
    if (AppState.storeId) {
        el.textContent = AppState.storeId;
        el.classList.add('show');
    } else {
        el.classList.remove('show');
    }
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
    document.getElementById('storeIdInput').addEventListener('keypress', (e) => { if (e.key === 'Enter') lookupStore(); });
    document.getElementById('lookupStoreBtn').addEventListener('click', lookupStore);
    document.getElementById('confirmYesBtn').addEventListener('click', () => confirmStore(true));
    document.getElementById('confirmNoBtn').addEventListener('click', () => confirmStore(false));
    document.getElementById('appBackBtn').addEventListener('click', goToHome);
    document.getElementById('goToSessionBtn').addEventListener('click', () => { if (AppState.activeSessionApp) openApp(AppState.activeSessionApp); });
}

// ============================================
// INITIALIZATION
// ============================================
async function initApp() {
    updateOnlineStatus();
    setupEventListeners();
    const storedStoreId = Storage.get('store_id');
    if (storedStoreId) {
        AppState.storeId = storedStoreId;
        AppState.storeName = Storage.get('store_name') || '';
        AppState.storeLocation = Storage.get('store_location') || '';
        updateHeaderStore();
        checkExistingSession();
        showScreen('homeScreen');
        renderAppGrid();
    } else {
        showScreen('loginScreen');
    }
}

document.addEventListener('DOMContentLoaded', initApp);
