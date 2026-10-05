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
    { id: 'dataManagement', name: 'Team & Data', nameAr: 'الفريق والبيانات', icon: '🗄️', iconImg: 'icons/ui-data.png', description: 'Jobs, QR links, people and data', descAr: 'المهام وروابط QR والأشخاص والبيانات', sessionRequired: false, modal: true }
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
    // a small round light (green = online, amber = offline); the words are only for screen readers and the hover hint
    const word = AppState.isOnline ? 'Online' : 'Offline';
    el.className = 'online-status ' + (AppState.isOnline ? 'online' : 'offline');
    el.title = word;
    el.setAttribute('aria-label', word);
}

window.addEventListener('online', updateOnlineStatus);
window.addEventListener('offline', updateOnlineStatus);

// ============================================
// SHARED UTILITIES
// ============================================
function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

// ============================================
// LABELS AS VECTOR DRAWINGS
// ============================================
// Labels are drawn as SVG (bars, squares, text and lines stay sharp at any printer resolution) instead of bitmaps,
// which looked blocky when the browser or the printer driver resampled them. One drawing unit is one dot of a
// 203 dpi label printer; bars and squares are whole units, so on such a printer every bar is a whole number of dots.
const SVG_NS = 'http://www.w3.org/2000/svg';
const LABEL_DPI = 203;
const LABEL_FONT = 'Arial, Helvetica, sans-serif';

function svgEl(tag, attrs, parent) {
    const el = document.createElementNS(SVG_NS, tag);
    Object.keys(attrs || {}).forEach(k => el.setAttribute(k, String(attrs[k])));
    if (parent) parent.appendChild(el);
    return el;
}

// The largest font size (not above `size`, not below `min`) at which bold `text` fits in maxWidth.
function fitBoldSize(text, size, maxWidth, min) {
    const ctx = document.createElement('canvas').getContext('2d');
    let fs = size;
    ctx.font = `bold ${fs}px Arial`;
    while (fs > (min || 12) && ctx.measureText(text).width > maxWidth) { fs--; ctx.font = `bold ${fs}px Arial`; }
    return { size: fs, width: ctx.measureText(text).width };
}

// The squares of a QR code as one path of whole-unit rectangles (neighbouring dark squares in a row are merged).
function qrMatrix(text) {
    const holder = document.createElement('div');
    const qr = new QRCode(holder, { text: text, width: 10, height: 10, colorDark: '#000000', colorLight: '#ffffff', correctLevel: QRCode.CorrectLevel.M });
    const model = qr._oQRCode;                              // the library's matrix of squares
    return { count: model.getModuleCount(), isDark: (r, c) => model.isDark(r, c) };
}
function qrPath(m, mod, x0, y0) {
    let d = '';
    for (let r = 0; r < m.count; r++) {
        for (let c = 0; c < m.count; c++) {
            if (!m.isDark(r, c)) continue;
            let e = c;
            while (e + 1 < m.count && m.isDark(r, e + 1)) e++;
            d += `M${x0 + c * mod} ${y0 + r * mod}h${(e - c + 1) * mod}v${mod}h-${(e - c + 1) * mod}z`;
            c = e;
        }
    }
    return d;
}

// A Code 128 barcode as one path: bars `bar` units wide, `height` units tall, from (x0, y0). Returns { d, width }.
function barcodePath(text, height, bar, x0, y0) {
    const svg = document.createElementNS(SVG_NS, 'svg');
    JsBarcode(svg, text, { format: 'CODE128', width: bar, height: height, displayValue: false, margin: 0 });
    let d = '';
    svg.querySelectorAll('g > rect').forEach(r => {
        d += `M${x0 + Number(r.getAttribute('x'))} ${y0}h${r.getAttribute('width')}v${height}h-${r.getAttribute('width')}z`;
    });
    return { d, width: parseFloat(svg.getAttribute('width')) };
}

// An item QR label (QR code with its text below) as a vector drawing: squares of 10 dots, so about 36 mm wide.
function createQRWithText(text) {
    const mod = 10, pad = 20;
    const m = qrMatrix(text);
    const qs = m.count * mod;
    const W = qs + pad * 2;
    const fit = fitBoldSize(text, 30, W - pad * 2, 10);
    const H = pad + qs + 14 + Math.round(fit.size * 0.72) + pad;
    const svg = svgEl('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, class: 'qr-label-svg' });
    svg.style.width = (W / LABEL_DPI) + 'in';                // whole dots on a 203 dpi printer
    svgEl('rect', { x: 0, y: 0, width: W, height: H, fill: '#ffffff' }, svg);
    svgEl('path', { d: qrPath(m, mod, pad, pad), fill: '#000000' }, svg);
    const t = svgEl('text', { x: W / 2, y: pad + qs + 14 + Math.round(fit.size * 0.72), 'text-anchor': 'middle', 'font-family': LABEL_FONT, 'font-weight': 700, 'font-size': fit.size, fill: '#000000' }, svg);
    t.textContent = text;
    return svg;
}

