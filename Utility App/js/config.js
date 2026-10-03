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
    { id: 'boxScanner', name: 'Box-Item Scan', nameAr: 'مسح الصناديق والقطع', icon: '📦', description: 'Scan items into boxes', descAr: 'مسح القطع داخل الصناديق', sessionRequired: true, containerId: 'boxScannerApp' },
    { id: 'itemBarcode', name: 'Item Barcode Print', nameAr: 'طباعة باركود القطع', icon: '🏷️', description: 'Print item labels', descAr: 'طباعة ملصقات القطع', sessionRequired: false, containerId: 'itemBarcodeApp' },
    { id: 'boxCode', name: 'Box Code Print', nameAr: 'طباعة رمز الصندوق', icon: '🖨️', description: 'Generate box labels', descAr: 'إنشاء ملصقات الصناديق', sessionRequired: false, containerId: 'boxCodeApp' },
    { id: 'boxSegregate', name: 'Box Segregate', nameAr: 'فرز الصناديق', icon: '🔍', description: 'Look up box details by barcode', descAr: 'البحث عن تفاصيل الصندوق بالباركود', sessionRequired: false, containerId: 'boxSegregateApp' },
    { id: 'priceCheck', name: 'Price Check', nameAr: 'التحقق من السعر', icon: '💰', description: 'Check item price by barcode', descAr: 'معرفة سعر القطعة بالباركود', sessionRequired: false, containerId: 'priceCheckApp' },
    { id: 'yearSegregate', name: 'Year/Season Sort', nameAr: 'الفرز حسب السنة والموسم', icon: '🗂️', description: 'Sort items by year & season into PTL boxes', descAr: 'فرز القطع حسب السنة والموسم في صناديق PTL', sessionRequired: true, containerId: 'yearSegregateApp' },
    // modal: true = opens a window (Data Management) instead of a tool screen
    { id: 'dataManagement', name: 'Data Management', nameAr: 'إدارة البيانات', icon: '🗄️', iconImg: 'icons/ui-data.png', description: 'View, download or reset your scans', descAr: 'عرض عمليات المسح أو تحميلها أو إعادة ضبطها', sessionRequired: false, modal: true }
];

// A tool's name / one-line description in the app language (Arabic when the app is Arabic; see js/lang.js).
// Pass 'ar' or 'en' to force a language (the guides use their own).
function appName(app, lang) {
    const l = lang || ((typeof AppLang !== 'undefined' && AppLang.get() === 'ar') ? 'ar' : 'en');
    return l === 'ar' && app.nameAr ? app.nameAr : app.name;
}
function appDesc(app, lang) {
    const l = lang || ((typeof AppLang !== 'undefined' && AppLang.get() === 'ar') ? 'ar' : 'en');
    return l === 'ar' && app.descAr ? app.descAr : app.description;
}

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
    operator: null,              // set when this device joined a job through a team QR link (see js/operator.js)
    currentApp: null,
    currentScreen: 'loginScreen',
    hasActiveSession: false,
    activeSessionApp: null,
    isOnline: navigator.onLine,
    // Year/Season Sort identifies the operator by these two fields; both come from the
    // signed-in Google account.
    get storeId() { return this.operator ? this.operator.enterprise_name : (this.user?.email || ''); },
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

