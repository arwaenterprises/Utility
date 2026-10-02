// ============================================
// CONFIGURATION
// ============================================
const CONFIG = {
    STORAGE_PREFIX: 'aku_',
    SUPABASE_URL: 'https://pacqjqjigmepkycfjapa.supabase.co',
    SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBhY3FqcWppZ21lcGt5Y2ZqYXBhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA4MzE0NzIsImV4cCI6MjEwNjQwNzQ3Mn0.v339tfTdsSoHOdrHRXGdgcjqV86ub8b_LKuTX2OP28A'
};

// ============================================
// APP REGISTRY
// ============================================
const APPS = [
    { id: 'boxScanner', name: 'Box-Item Scan', icon: '📦', description: 'Scan items into boxes', sessionRequired: true, containerId: 'boxScannerApp' },
    { id: 'itemBarcode', name: 'Item Barcode Print', icon: '🏷️', description: 'Print item labels', sessionRequired: false, containerId: 'itemBarcodeApp' },
    { id: 'boxCode', name: 'Box Code Print', icon: '🖨️', description: 'Generate box labels', sessionRequired: false, containerId: 'boxCodeApp' },
    { id: 'boxSegregate', name: 'Box Segregate', icon: '🔍', description: 'Look up box details by barcode', sessionRequired: false, containerId: 'boxSegregateApp' },
    { id: 'priceCheck', name: 'Price Check', icon: '💰', description: 'Check item price by barcode', sessionRequired: false, containerId: 'priceCheckApp' },
    { id: 'yearSegregate', name: 'Year/Season Sort', icon: '🗂️', description: 'Sort items by year & season into PTL boxes', sessionRequired: true, containerId: 'yearSegregateApp' },
    // modal: true = opens a window (Data Management) instead of a tool screen
    { id: 'dataManagement', name: 'Data Management', icon: '🗄️', iconImg: 'icons/ui-data.png', description: 'View, download or reset your scans', sessionRequired: false, modal: true }
];

// A tool's icon as HTML: its picture when it has one, otherwise its emoji.
function appIconHtml(app, cls) {
    return app.iconImg ? `<img class="${cls || 'app-icon-img'}" src="${app.iconImg}" alt="">` : app.icon;
}

// ============================================
// GLOBAL STATE
// ============================================
const AppState = {
    user: null,
    profile: null,
    pendingInvites: [],          // invitations waiting for this person (see checkForMyPendingInvite)
    currentApp: null,
    currentScreen: 'loginScreen',
    hasActiveSession: false,
    activeSessionApp: null,
    isOnline: navigator.onLine,
    // Year/Season Sort identifies the operator by these two fields; both come from the
    // signed-in Google account.
    get storeId() { return this.user?.email || ''; },
    get storeName() { return this.profile?.display_name || this.user?.email || ''; }
};

// ============================================
// STORAGE HELPERS
// ============================================
const Storage = {
    get(key) { return localStorage.getItem(CONFIG.STORAGE_PREFIX + key); },
    set(key, value) { localStorage.setItem(CONFIG.STORAGE_PREFIX + key, value); },
    remove(key) { localStorage.removeItem(CONFIG.STORAGE_PREFIX + key); },
    getJSON(key) {
        const val = this.get(key);
        if (!val) return null;
        try { return JSON.parse(val); } catch (e) { return null; }
    },
    setJSON(key, value) { this.set(key, JSON.stringify(value)); }
};

// ============================================
// ONLINE STATUS
// ============================================
function updateOnlineStatus() {
    AppState.isOnline = navigator.onLine;
    const el = document.getElementById('onlineStatus');
    if (AppState.isOnline) {
        el.textContent = 'Online';
        el.className = 'online-status online';
    } else {
        el.textContent = 'Offline';
        el.className = 'online-status offline';
    }
}

window.addEventListener('online', updateOnlineStatus);
window.addEventListener('offline', updateOnlineStatus);

// ============================================
// SHARED UTILITIES
// ============================================
function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

function createQRWithText(text, size) {
    return new Promise((resolve) => {
        const tempDiv = document.createElement('div');
        tempDiv.style.position = 'absolute';
        tempDiv.style.left = '-9999px';
        document.body.appendChild(tempDiv);

        new QRCode(tempDiv, {
            text: text,
            width: size,
            height: size,
            colorDark: '#000000',
            colorLight: '#ffffff',
            correctLevel: QRCode.CorrectLevel.M
        });

        setTimeout(() => {
            const qrImg = tempDiv.querySelector('img') || tempDiv.querySelector('canvas');
            const canvas = document.createElement('canvas');
            const padding = 10;
            const textHeight = 30;
            canvas.width = size + (padding * 2);
            canvas.height = size + textHeight + (padding * 2);
            canvas.style.display = 'block';
            canvas.style.margin = '0 auto';
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            if (qrImg) { ctx.drawImage(qrImg, padding, padding, size, size); }
            const maxTextWidth = canvas.width - (padding * 2);
            let fontSize = 14;
            const minFontSize = 8;
            ctx.fillStyle = '#000000';
            ctx.font = `bold ${fontSize}px Courier New`;
            while (ctx.measureText(text).width > maxTextWidth && fontSize > minFontSize) {
                fontSize--;
                ctx.font = `bold ${fontSize}px Courier New`;
            }
            ctx.textAlign = 'center';
            ctx.fillText(text, canvas.width / 2, size + padding + 20);
            document.body.removeChild(tempDiv);
            resolve(canvas);
        }, 150);
    });
}

