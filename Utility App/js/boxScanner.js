// ============================================
// BOX SCANNER MODULE - STATE & CONFIG
// ============================================
const ScannerState = {
    staffName: '',
    remark: '',
    currentBox: null,
    boxScanning: false,
    language: 'en',
    inputMode: 'Nu',
    uniqueMode: false,
    scans: [],
    pendingDeleteId: null,
    completedBoxes: new Set(),
    isProcessingClose: false,
    isSyncing: false,
    syncIntervalId: null
};

// Unique ID for every scan. Generated once at scan time and never regenerated,
// so a resent batch carries the same IDs and the server can skip what it already wrote.
function newScanUid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    // Fallback for non-secure contexts where crypto.randomUUID is unavailable
    return 'u-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10) +
           '-' + Math.random().toString(36).slice(2, 10);
}

const ScannerT = {
    en: {
        lblStaffName: "Your Name", lblRemark: "Remark", lblStartSession: "Start Session",
        lblStore: "Store:", lblStaff: "Staff:", lblTotal: "Total", lblBoxQty: "Box Qty", lblBoxes: "Boxes",
        lblBoxId: "Box ID", lblBarcode: "Barcode", lblCloseBox: "Close Box", lblRecentScans: "Last 5 Scans",
        thBarcode: "Barcode", thTime: "Time", thAction: "Del", lblDownload: "Download", lblReset: "Reset",
        lblSettings: "Settings", lblCloseBoxTitle: "Close Box", lblQtyItems: "Quantity:", lblItems: "items",
        lblAreYouSure: "Are you sure you want to close this box?", lblScanToConfirm: "Scan box ID to confirm",
        lblResetTitle: "Reset Session?", lblResetMsg: "This will download your data and start a new session.",
        lblDeleteTitle: "Delete Scan?", lblDeleteMsg: "Delete this scan?", lblSettingsTitle: "Settings",
        lblLanguage: "Language", boxIdPlaceholder: "Scan box ID...", barcodePlaceholder: "Scan barcode...",
        remarkPlaceholder: "e.g., Fall Winter 2023 stocks", staffPlaceholder: "Enter your name...",
        errEnterName: "Please enter your name", errEnterRemark: "Please enter a remark",
        errBoxFirst: "Scan Box ID first", errSameBox: "Scan same Box ID!", errCloseBoxFirst: "Close the box first!",
        errBoxAlreadyClosed: "Box already closed",
        errNumericOnly: "Numeric mode (Nu) is active — alphanumeric barcode not allowed",
        errModeLockedDuringBox: "Close the current box before changing Nu/AlNu mode",
        errDuplicateBarcode: "This barcode was already scanned in this box",
        errUniqueLockedDuringBox: "Close the current box before changing the No Dup setting",
        lblUniqueToggle: "No Dup",
        lblModeNu: "Nu",
        lblModeAlphanumeric: "Alphanumeric"
    },
    ar: {
        lblStaffName: "اسمك", lblRemark: "ملاحظة", lblStartSession: "بدء الجلسة",
        lblStore: "المتجر:", lblStaff: "الموظف:", lblTotal: "الإجمالي", lblBoxQty: "الصندوق", lblBoxes: "مكتمل",
        lblBoxId: "رقم الصندوق", lblBarcode: "الباركود", lblCloseBox: "إغلاق الصندوق", lblRecentScans: "آخر 5 مسح",
        thBarcode: "الباركود", thTime: "الوقت", thAction: "حذف", lblDownload: "تحميل", lblReset: "إعادة",
        lblSettings: "الإعدادات", lblCloseBoxTitle: "إغلاق الصندوق", lblQtyItems: "الكمية:", lblItems: "قطعة",
        lblAreYouSure: "هل أنت متأكد من إغلاق هذا الصندوق؟", lblScanToConfirm: "امسح رقم الصندوق للتأكيد",
        lblResetTitle: "إعادة تعيين؟", lblResetMsg: "سيتم تحميل البيانات وبدء جلسة جديدة.",
        lblDeleteTitle: "حذف المسح؟", lblDeleteMsg: "حذف هذا المسح؟", lblSettingsTitle: "الإعدادات",
        lblLanguage: "اللغة", boxIdPlaceholder: "امسح رقم الصندوق...", barcodePlaceholder: "امسح الباركود...",
        remarkPlaceholder: "مثال: مخزون خريف وشتاء 2023", staffPlaceholder: "أدخل اسمك...",
        errEnterName: "الرجاء إدخال اسمك", errEnterRemark: "الرجاء إدخال ملاحظة",
        errBoxFirst: "امسح رقم الصندوق أولاً", errSameBox: "امسح نفس رقم الصندوق!", errCloseBoxFirst: "أغلق الصندوق أولاً!",
        errBoxAlreadyClosed: "الصندوق مغلق بالفعل",
        errNumericOnly: "وضع الأرقام (Nu) مفعّل — لا يُسمح بباركود يحتوي على حروف",
        errModeLockedDuringBox: "أغلق الصندوق الحالي قبل تغيير وضع Nu/AlNu",
        errDuplicateBarcode: "تم مسح هذا الباركود مسبقًا في هذا الصندوق",
        errUniqueLockedDuringBox: "أغلق الصندوق الحالي قبل تغيير إعداد منع التكرار",
        lblUniqueToggle: "بدون تكرار",
        lblModeNu: "أرقام",
        lblModeAlphanumeric: "أرقام وحروف"
    }
};

function scannerT(key) { return ScannerT[ScannerState.language][key] || key; }

// ============================================
// BOX SCANNER - DATABASE
// ============================================
let scannerDB;
const SCANNER_DB_NAME = 'AKBoxScannerDB';
const SCANNER_STORE = 'scans';

function initScannerDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(SCANNER_DB_NAME, 1);
        req.onerror = () => reject(req.error);
        req.onsuccess = () => { scannerDB = req.result; resolve(scannerDB); };
        req.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(SCANNER_STORE)) {
                db.createObjectStore(SCANNER_STORE, { keyPath: 'id', autoIncrement: true });
            }
        };
    });
}

async function addScan(scan) {
    return new Promise((resolve, reject) => {
        const tx = scannerDB.transaction([SCANNER_STORE], 'readwrite');
        const store = tx.objectStore(SCANNER_STORE);
        const req = store.add(scan);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

async function getAllScans() {
    return new Promise((resolve, reject) => {
        const tx = scannerDB.transaction([SCANNER_STORE], 'readonly');
        const store = tx.objectStore(SCANNER_STORE);
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

// One-time backfill: scans captured before scanUid existed would otherwise be
// unidentifiable to the server and could still duplicate. Give them an ID before
// they are ever synced.
async function backfillScanUids() {
    const scans = await getAllScans();
    const missing = scans.filter(s => !s.scanUid);
    for (const scan of missing) {
        scan.scanUid = newScanUid();
        await updateScan(scan);
    }
    return missing.length;
}

async function updateScan(scan) {
    return new Promise((resolve, reject) => {
        const tx = scannerDB.transaction([SCANNER_STORE], 'readwrite');
        const store = tx.objectStore(SCANNER_STORE);
        const req = store.put(scan);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

async function deleteScanById(id) {
    return new Promise((resolve, reject) => {
        const tx = scannerDB.transaction([SCANNER_STORE], 'readwrite');
        const store = tx.objectStore(SCANNER_STORE);
        const req = store.delete(id);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
    });
}

async function clearAllScans() {
    return new Promise((resolve, reject) => {
        const tx = scannerDB.transaction([SCANNER_STORE], 'readwrite');
        const store = tx.objectStore(SCANNER_STORE);
        const req = store.clear();
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
    });
}

// ============================================
// BOX SCANNER - SESSION PERSISTENCE
// ============================================
function saveScannerSession() {
    Storage.setJSON('scanner_session', {
        staffName: ScannerState.staffName,
        remark: ScannerState.remark,
        currentBox: ScannerState.currentBox,
        boxScanning: ScannerState.boxScanning,
        language: ScannerState.language,
        inputMode: ScannerState.inputMode,
        uniqueMode: ScannerState.uniqueMode,
        completedBoxes: Array.from(ScannerState.completedBoxes)
    });
}

function loadScannerSession() {
    const session = Storage.getJSON('scanner_session');
    if (session) {
        ScannerState.staffName = session.staffName || '';
        ScannerState.remark = session.remark || '';
        ScannerState.currentBox = session.currentBox || null;
        ScannerState.boxScanning = session.boxScanning || false;
        ScannerState.language = session.language || 'en';
        ScannerState.inputMode = session.inputMode || 'Nu';
        ScannerState.uniqueMode = session.uniqueMode || false;
        ScannerState.completedBoxes = new Set(session.completedBoxes || []);
        return true;
    }
    return false;
}

function clearScannerSession() {
    Storage.remove('scanner_session');
    Storage.remove('active_session');
    ScannerState.staffName = '';
    ScannerState.remark = '';
    ScannerState.currentBox = null;
    ScannerState.boxScanning = false;
    ScannerState.scans = [];
    ScannerState.completedBoxes = new Set();
}

// ============================================
// BOX SCANNER - UI HELPERS
// ============================================
function showScannerScreen(screenId) {
    document.querySelectorAll('#boxScannerApp .scanner-screen').forEach(s => {
        s.classList.remove('active');
        s.style.display = 'none';
    });
    const targetScreen = document.getElementById(screenId);
    if (targetScreen) {
        targetScreen.classList.add('active');
        targetScreen.style.display = 'block';
    }
}

function applyScannerTranslations() {
    const lang = ScannerT[ScannerState.language];
    Object.keys(lang).forEach(key => {
        const el = document.getElementById(key);
        if (el && !el.matches('input, select')) el.textContent = lang[key];
    });
    document.getElementById('scannerStaffInput').placeholder = scannerT('staffPlaceholder');
    document.getElementById('scannerRemarkInput').placeholder = scannerT('remarkPlaceholder');
    document.getElementById('boxIdInput').placeholder = scannerT('boxIdPlaceholder');
    document.getElementById('barcodeInput').placeholder = scannerT('barcodePlaceholder');
    document.body.classList.toggle('rtl', ScannerState.language === 'ar');
    document.getElementById('modeToggleBtn').checked = ScannerState.inputMode === 'AlNu';
    document.getElementById('modeToggleLabel').textContent = ScannerState.inputMode === 'AlNu' ? scannerT('lblModeAlphanumeric') : scannerT('lblModeNu');
    document.getElementById('modeToggleWrap').classList.toggle('locked', ScannerState.boxScanning);
    document.getElementById('uniqueToggleBtn').checked = ScannerState.uniqueMode;
    document.getElementById('uniqueToggleWrap').classList.toggle('locked', ScannerState.boxScanning);
    document.getElementById('langEnBtn').classList.toggle('active', ScannerState.language === 'en');
    document.getElementById('langArBtn').classList.toggle('active', ScannerState.language === 'ar');
    document.getElementById('settingsLangEnBtn').classList.toggle('active', ScannerState.language === 'en');
    document.getElementById('settingsLangArBtn').classList.toggle('active', ScannerState.language === 'ar');
}

function setScannerLanguage(lang) {
    ScannerState.language = lang;
    applyScannerTranslations();
    saveScannerSession();
    updateScansTable();
}

function setScannerInputMode(mode) {
    ScannerState.inputMode = mode;
    document.getElementById('modeToggleBtn').checked = mode === 'AlNu';
    document.getElementById('modeToggleLabel').textContent = mode === 'AlNu' ? scannerT('lblModeAlphanumeric') : scannerT('lblModeNu');
    saveScannerSession();
}

function guardScannerModeToggle(e) {
    if (ScannerState.boxScanning) {
        e.preventDefault();
        alert(scannerT('errModeLockedDuringBox'));
    }
}

function syncScannerModeLock() {
    document.getElementById('modeToggleWrap').classList.toggle('locked', ScannerState.boxScanning);
}

function setScannerUniqueMode(enabled) {
    ScannerState.uniqueMode = enabled;
    document.getElementById('uniqueToggleBtn').checked = enabled;
    saveScannerSession();
}

function guardScannerUniqueToggle(e) {
    if (ScannerState.boxScanning) {
        e.preventDefault();
        alert(scannerT('errUniqueLockedDuringBox'));
    }
}

function syncScannerUniqueLock() {
    document.getElementById('uniqueToggleWrap').classList.toggle('locked', ScannerState.boxScanning);
}

// ============================================
// BOX SCANNER - SESSION MANAGEMENT
// ============================================
function startScannerSession() {
    const staff = document.getElementById('scannerStaffInput').value.trim();
    const remark = document.getElementById('scannerRemarkInput').value.trim();

    if (!staff) { alert(scannerT('errEnterName')); document.getElementById('scannerStaffInput').focus(); return; }
    if (!remark) { alert(scannerT('errEnterRemark')); document.getElementById('scannerRemarkInput').focus(); return; }

    ScannerState.staffName = staff;
    ScannerState.remark = remark;
    
    setActiveSession('boxScanner', true);
    saveScannerSession();
    
    document.getElementById('dispScannerStore').textContent = `${AppState.storeId} - ${AppState.storeName}`;
    document.getElementById('dispScannerStaff').textContent = ScannerState.staffName;
    
    showScannerScreen('scannerScanScreen');
    document.getElementById('boxIdInput').focus();
    loadAndDisplayScans();
    updateBackButton();
}

// ============================================
// BOX SCANNER - SCANNING LOGIC
// ============================================
function handleBoxIdScan(e) {
    if (e.key !== 'Enter') return;
    const boxId = document.getElementById('boxIdInput').value.trim();
    if (!boxId) return;
    
    if (!ScannerState.boxScanning) {
        if (ScannerState.completedBoxes.has(boxId)) {
            const boxQty = ScannerState.scans.filter(s => s.boxNumber === boxId).length;
            alert(scannerT('errBoxAlreadyClosed') + ' (' + boxQty + ' items)');
            document.getElementById('boxIdInput').value = '';
            return;
        }
        
        ScannerState.currentBox = boxId;
        ScannerState.boxScanning = true;
        saveScannerSession();

        document.getElementById('boxIdGroup').classList.add('hidden');
        document.getElementById('barcodeGroup').classList.remove('hidden');
        document.getElementById('boxIdInput').value = '';
        document.getElementById('closeBoxRow').classList.add('show');
        document.getElementById('closeBoxBtnId').textContent = boxId;
        document.getElementById('barcodeInput').focus();
        updateScannerStats();
        syncScannerModeLock();
        syncScannerUniqueLock();
    } else {
        document.getElementById('boxIdInput').value = '';
    }
}

async function handleBarcodeScan(e) {
    if (e.key !== 'Enter') return;
    const barcode = document.getElementById('barcodeInput').value.trim();
    if (!barcode) return;

    if (ScannerState.inputMode === 'Nu' && !/^\d+$/.test(barcode)) {
        alert(scannerT('errNumericOnly') + ': ' + barcode);
        document.getElementById('barcodeInput').value = '';
        return;
    }

    if (!ScannerState.boxScanning) {
        alert(scannerT('errBoxFirst'));
        document.getElementById('barcodeInput').value = '';
        document.getElementById('boxIdInput').focus();
        return;
    }

    if (ScannerState.uniqueMode) {
        const isDup = ScannerState.scans.some(s =>
            s.boxNumber === ScannerState.currentBox &&
            s.boxStatus === 'Open' &&
            s.barcode === String(barcode)
        );
        if (isDup) {
            alert(scannerT('errDuplicateBarcode') + ': ' + barcode);
            document.getElementById('barcodeInput').value = '';
            return;
        }
    }

    const scan = {
        scanUid: newScanUid(),
        storeId: AppState.storeId,
        storeName: AppState.storeName,
        staffName: ScannerState.staffName,
        remark: ScannerState.remark,
        boxNumber: String(ScannerState.currentBox),
        barcode: String(barcode),
        qty: 1,
        boxStatus: 'Open',
        timestamp: new Date().toISOString(),
        synced: false
    };
    
    await addScan(scan);
    document.getElementById('barcodeInput').value = '';
    document.getElementById('barcodeInput').classList.add('input-highlight');
    setTimeout(() => document.getElementById('barcodeInput').classList.remove('input-highlight'), 500);
    resetScannerKeyboard();
    await loadAndDisplayScans();
}

// ============================================
// BOX SCANNER - CLOSE BOX
// ============================================
function showCloseBoxModal() {
    const boxQty = ScannerState.scans.filter(s => s.boxNumber === ScannerState.currentBox).length;
    document.getElementById('modalBoxId').textContent = ScannerState.currentBox;
    document.getElementById('modalBoxQty').textContent = boxQty;
    document.getElementById('closeBoxStep1').style.display = 'block';
    document.getElementById('closeBoxStep2').style.display = 'none';
    document.getElementById('closeBoxButtons1').style.display = 'flex';
    document.getElementById('closeBoxButtons2').style.display = 'none';
    document.getElementById('closeBoxScanInput').value = '';
    document.getElementById('closeBoxModal').classList.add('active');
}

function closeBoxProceedToScan() {
    document.getElementById('closeBoxStep1').style.display = 'none';
    document.getElementById('closeBoxStep2').style.display = 'block';
    document.getElementById('closeBoxButtons1').style.display = 'none';
    document.getElementById('closeBoxButtons2').style.display = 'flex';
    setTimeout(() => document.getElementById('closeBoxScanInput').focus(), 100);
}

function handleCloseBoxScan(e) {
    if (e.key !== 'Enter') return;
    const scannedId = document.getElementById('closeBoxScanInput').value.trim();
    if (scannedId === ScannerState.currentBox) {
        executeCloseBox();
    } else {
        alert(scannerT('errSameBox'));
        document.getElementById('closeBoxScanInput').value = '';
        document.getElementById('closeBoxScanInput').focus();
    }
}

function cancelCloseBox() {
    document.getElementById('closeBoxModal').classList.remove('active');
    document.getElementById('closeBoxScanInput').value = '';
    document.getElementById('barcodeInput').focus();
}

async function executeCloseBox() {
    if (ScannerState.isProcessingClose) return;
    ScannerState.isProcessingClose = true;
    document.getElementById('closeBoxModal').classList.remove('active');
    document.getElementById('closeBoxScanInput').value = '';
    
    try {
        const closedBox = ScannerState.currentBox;
        for (const scan of ScannerState.scans) {
            if (scan.boxNumber === closedBox && scan.boxStatus === 'Open') {
                scan.boxStatus = 'Closed';
                scan.synced = false;
                await updateScan(scan);
            }
        }
        if (ScannerState.currentBox) ScannerState.completedBoxes.add(ScannerState.currentBox);
        ScannerState.currentBox = null;
        ScannerState.boxScanning = false;
        saveScannerSession();

        document.getElementById('boxIdGroup').classList.remove('hidden');
        document.getElementById('barcodeGroup').classList.add('hidden');
        document.getElementById('closeBoxRow').classList.remove('show');
        document.getElementById('closeBoxBtnId').textContent = '';
        document.getElementById('boxIdInput').focus();
        await loadAndDisplayScans();
        updateScannerStats();
        syncScannerModeLock();
        syncScannerUniqueLock();
        if (AppState.isOnline) await autoSyncScans();
    } finally {
        ScannerState.isProcessingClose = false;
    }
}

// ============================================
// BOX SCANNER - DISPLAY & STATS
// ============================================
async function loadAndDisplayScans() {
    ScannerState.scans = await getAllScans();
    updateScannerStats();
    updateScansTable();
    updateSyncBadge();
}

function updateScannerStats() {
    document.getElementById('statTotal').textContent = ScannerState.scans.length;
    let boxQty = 0;
    if (ScannerState.currentBox) {
        boxQty = ScannerState.scans.filter(s => s.boxNumber === ScannerState.currentBox).length;
    }
    document.getElementById('statBoxQty').textContent = boxQty;
    document.getElementById('statBoxes').textContent = ScannerState.completedBoxes.size;
}

function updateScansTable() {
    const tbody = document.getElementById('scansTableBody');
    tbody.innerHTML = '';
    const currentBoxScans = ScannerState.scans.filter(s => s.boxNumber === ScannerState.currentBox && s.boxStatus === 'Open');
    const recent = currentBoxScans.slice(-5).reverse();
    
    if (recent.length === 0) {
        tbody.innerHTML = `<tr><td colspan="3" style="text-align: center; color: var(--ak-text-light);">No scans yet</td></tr>`;
        return;
    }
    
    recent.forEach(scan => {
        const tr = document.createElement('tr');
        const time = new Date(scan.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        tr.innerHTML = `<td>${scan.barcode}</td><td>${time}</td><td><button class="delete-scan-btn" data-id="${scan.id}" data-barcode="${scan.barcode}">✕</button></td>`;
        tbody.appendChild(tr);
    });
}

function updateSyncBadge() {
    const pending = ScannerState.scans.filter(s => !s.synced && s.boxStatus === 'Closed').length;
    const badge = document.getElementById('syncBadge');
    if (pending === 0) {
        badge.textContent = '✓';
        badge.className = 'sync-badge synced';
    } else {
        badge.textContent = pending;
        badge.className = 'sync-badge pending';
    }
}

// ============================================
// BOX SCANNER - DELETE SCAN
// ============================================
function showDeleteModal(id, barcode) {
    ScannerState.pendingDeleteId = id;
    document.getElementById('deleteInfo').textContent = barcode;
    document.getElementById('deleteModal').classList.add('active');
}

async function executeDeleteScan(confirmed) {
    document.getElementById('deleteModal').classList.remove('active');
    if (confirmed && ScannerState.pendingDeleteId) {
        await deleteScanById(ScannerState.pendingDeleteId);
        await loadAndDisplayScans();
    }
    ScannerState.pendingDeleteId = null;
}

// ============================================
// BOX SCANNER - GOOGLE SHEETS SYNC
// ============================================
// 45s must stay comfortably above the Apps Script lock wait (20s) plus write time.
// If the client gives up while the server is still working, it resends a batch the
// server has already written - which is what caused the duplicate rows.
const SCANNER_POST_TIMEOUT_MS = 45000;

async function postToGoogleSheets(action, data) {
    if (!AppState.isOnline) return null;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), SCANNER_POST_TIMEOUT_MS);
    try {
        const response = await fetch(CONFIG.GOOGLE_SCRIPT_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain' },
            body: JSON.stringify({ action, ...data }),
            signal: controller.signal
        });
        const result = await response.json();
        return (result && result.success) ? result : null;
    } catch (e) {
        console.error('Google Sheets post error:', e);
        return null;
    } finally {
        clearTimeout(timeout);
    }
}

// The in-page isSyncing flag cannot see a second tab or the installed PWA, which share
// the same IndexedDB. The Web Lock is held across the whole origin, so only one instance
// on the device can be syncing at a time.
async function autoSyncScans() {
    if (!navigator.locks) return runAutoSync();
    return navigator.locks.request('ak-box-scanner-sync', { ifAvailable: true }, async (lock) => {
        if (!lock) return; // another tab holds it
        return runAutoSync();
    });
}

async function runAutoSync() {
    if (ScannerState.isSyncing) return;
    ScannerState.isSyncing = true;
    try {
        const unsynced = ScannerState.scans.filter(s => !s.synced && s.boxStatus === 'Closed');
        if (unsynced.length === 0) return;

        // Random 0–4s jitter so concurrent users don't all hit the script at the same instant
        await new Promise(r => setTimeout(r, Math.random() * 4000));

        // Retrying is safe: every scan carries a scanUid and the server skips IDs it has
        // already written, so a batch that landed but timed out will not be written twice.
        let result = null;
        for (let attempt = 0; attempt < 3; attempt++) {
            result = await postToGoogleSheets('addScans', { scans: unsynced });
            if (result && result.success) break;
            if (attempt < 2) await new Promise(r => setTimeout(r, 2000 * Math.pow(2, attempt)));
        }

        if (result && result.success) {
            // Trust the server's list of what it now holds rather than assuming the whole
            // batch landed. Older server versions don't return it - fall back to the batch.
            const accepted = Array.isArray(result.acceptedUids)
                ? new Set(result.acceptedUids)
                : new Set(unsynced.map(s => s.scanUid));
            for (const scan of unsynced) {
                // A scan with no ID cannot be matched against the server's list; the
                // request succeeded, so treat it as done rather than resending forever.
                if (scan.scanUid && !accepted.has(scan.scanUid)) continue;
                scan.synced = true;
                await updateScan(scan);
            }
            await loadAndDisplayScans();
        }
        // If all attempts failed: scans stay synced=false and will retry on the next 10s tick
    } catch (e) {
        console.log('Auto-sync failed:', e);
    } finally {
        ScannerState.isSyncing = false;
    }
}

// ============================================
// BOX SCANNER - DOWNLOAD EXCEL
// ============================================
async function downloadScannerExcel() {
    if (ScannerState.boxScanning && ScannerState.currentBox) {
        alert(scannerT('errCloseBoxFirst'));
        return;
    }
    const scans = await getAllScans();
    if (scans.length === 0) {
        const data = [['Store ID', 'Store Name', 'Staff', 'Remark', 'Box Number', 'Barcode', 'Qty', 'Box Status', 'Timestamp']];
        const ws = XLSX.utils.aoa_to_sheet(data);
        ws['!cols'] = [{wch:12},{wch:20},{wch:12},{wch:20},{wch:12},{wch:20},{wch:5},{wch:8},{wch:18}];
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Scans');
        XLSX.writeFile(wb, `${AppState.storeId}_empty_${new Date().toISOString().slice(0,10)}.xlsx`);
        return;
    }
    const data = scans.map(s => ({
        'Store ID': s.storeId, 'Store Name': s.storeName, 'Staff': s.staffName,
        'Remark': s.remark, 'Box Number': s.boxNumber, 'Barcode': s.barcode, 'Qty': s.qty,
        'Box Status': s.boxStatus || 'Open', 'Timestamp': new Date(s.timestamp).toLocaleString()
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    ws['!cols'] = [{wch:12},{wch:20},{wch:12},{wch:12},{wch:20},{wch:12},{wch:20},{wch:5},{wch:8},{wch:18}];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Scans');
    XLSX.writeFile(wb, `${AppState.storeId}_${ScannerState.staffName}_${new Date().toISOString().slice(0,10)}.xlsx`);
}

// ============================================
// BOX SCANNER - RESET SESSION
// ============================================
function showResetModal() {
    if (ScannerState.boxScanning && ScannerState.currentBox) {
        alert(scannerT('errCloseBoxFirst'));
        return;
    }
    document.getElementById('resetModal').classList.add('active');
}

async function executeResetSession(confirmed) {
    document.getElementById('resetModal').classList.remove('active');
    if (confirmed) {
        await downloadScannerExcel();
        await clearAllScans();
        clearScannerSession();
        document.getElementById('scannerStaffInput').value = '';
        document.getElementById('scannerRemarkInput').value = '';
        document.getElementById('boxIdInput').value = '';
        document.getElementById('barcodeInput').value = '';
        document.getElementById('barcodeGroup').classList.add('hidden');
        document.getElementById('boxIdGroup').classList.remove('hidden');
        document.getElementById('closeBoxRow').classList.remove('show');
        setActiveSession('boxScanner', false);
        showScannerScreen('scannerSessionScreen');
        updateBackButton();
    }
}

function openScannerSettings() {
    document.getElementById('scannerSettingsModal').classList.add('active');
}

function closeScannerSettings() {
    document.getElementById('scannerSettingsModal').classList.remove('active');
}

// ============================================
// BOX SCANNER - EVENT LISTENERS
// ============================================
let scannerListenersAdded = false;

function setupScannerEventListeners() {
    if (scannerListenersAdded) return;
    scannerListenersAdded = true;
    document.getElementById('langEnBtn').addEventListener('click', () => setScannerLanguage('en'));
    document.getElementById('langArBtn').addEventListener('click', () => setScannerLanguage('ar'));
    document.getElementById('modeToggleBtn').addEventListener('click', guardScannerModeToggle);
    document.getElementById('modeToggleBtn').addEventListener('change', (e) => setScannerInputMode(e.target.checked ? 'AlNu' : 'Nu'));
    document.getElementById('uniqueToggleBtn').addEventListener('click', guardScannerUniqueToggle);
    document.getElementById('uniqueToggleBtn').addEventListener('change', (e) => setScannerUniqueMode(e.target.checked));
    document.getElementById('settingsLangEnBtn').addEventListener('click', () => setScannerLanguage('en'));
    document.getElementById('settingsLangArBtn').addEventListener('click', () => setScannerLanguage('ar'));
    document.getElementById('startSessionBtn').addEventListener('click', startScannerSession);
    document.getElementById('boxIdInput').addEventListener('keypress', handleBoxIdScan);
    document.getElementById('barcodeInput').addEventListener('keypress', handleBarcodeScan);
    document.getElementById('closeBoxBtn').addEventListener('click', showCloseBoxModal);
    document.getElementById('closeBoxYesBtn').addEventListener('click', closeBoxProceedToScan);
    document.getElementById('closeBoxCancelBtn').addEventListener('click', cancelCloseBox);
    document.getElementById('closeBoxBackBtn').addEventListener('click', cancelCloseBox);
    document.getElementById('closeBoxScanInput').addEventListener('keypress', handleCloseBoxScan);
    document.getElementById('scansTableBody').addEventListener('click', (e) => {
        if (e.target.classList.contains('delete-scan-btn')) {
            showDeleteModal(parseInt(e.target.dataset.id), e.target.dataset.barcode);
        }
    });
    document.getElementById('deleteYesBtn').addEventListener('click', () => executeDeleteScan(true));
    document.getElementById('deleteNoBtn').addEventListener('click', () => executeDeleteScan(false));
    document.getElementById('downloadBtn').addEventListener('click', downloadScannerExcel);
    document.getElementById('resetSessionBtn').addEventListener('click', showResetModal);
    document.getElementById('resetYesBtn').addEventListener('click', () => executeResetSession(true));
    document.getElementById('resetNoBtn').addEventListener('click', () => executeResetSession(false));
    document.getElementById('openScannerSettingsBtn').addEventListener('click', (e) => { e.preventDefault(); openScannerSettings(); });
    document.getElementById('closeSettingsBtn').addEventListener('click', closeScannerSettings);
}

// ============================================
// BOX SCANNER - INITIALIZATION
// ============================================
async function initBoxScanner() {
    await initScannerDB();
    await backfillScanUids();
    setupScannerEventListeners();
    const hasSession = loadScannerSession();
    applyScannerTranslations();
    
    if (hasSession && ScannerState.staffName && ScannerState.remark) {
        document.getElementById('dispScannerStore').textContent = `${AppState.storeId} - ${AppState.storeName}`;
        document.getElementById('dispScannerStaff').textContent = ScannerState.staffName;
        setActiveSession('boxScanner', true);
        if (ScannerState.boxScanning && ScannerState.currentBox) {
            document.getElementById('boxIdGroup').classList.add('hidden');
            document.getElementById('barcodeGroup').classList.remove('hidden');
            document.getElementById('closeBoxRow').classList.add('show');
            document.getElementById('closeBoxBtnId').textContent = ScannerState.currentBox;
        }
        showScannerScreen('scannerScanScreen');
        if (ScannerState.boxScanning) {
            document.getElementById('barcodeInput').focus();
        } else {
            document.getElementById('boxIdInput').focus();
        }
        await loadAndDisplayScans();
    } else {
        showScannerScreen('scannerSessionScreen');
    }
    
    // initBoxScanner runs every time the app tile is opened (js/app.js), so clear any
    // interval from a previous open instead of stacking up a new one each time.
    if (ScannerState.syncIntervalId) {
        clearInterval(ScannerState.syncIntervalId);
        ScannerState.syncIntervalId = null;
    }
    // Random phase offset so 100 users don't all fire their sync at the exact same tick
    const syncOffset = Math.random() * 10000;
    setTimeout(() => {
        if (ScannerState.syncIntervalId) clearInterval(ScannerState.syncIntervalId);
        ScannerState.syncIntervalId = setInterval(async () => {
            if (AppState.isOnline && ScannerState.staffName) await autoSyncScans();
        }, 10000);
    }, syncOffset);
}

// ============================================
// BOX SCANNER - KEYBOARD TOGGLE
// ============================================
function toggleScannerKeyboard() {
    const input = document.getElementById('barcodeInput');
    const btn = document.getElementById('scannerKbdBtn');
    if (btn.classList.contains('active')) {
        resetScannerKeyboard();
    } else {
        input.removeAttribute('readonly');
        input.inputMode = 'text';
        btn.classList.add('active');
        input.focus();
    }
}

function resetScannerKeyboard() {
    const input = document.getElementById('barcodeInput');
    const btn = document.getElementById('scannerKbdBtn');
    if (!btn) return;
    input.inputMode = 'none';
    btn.classList.remove('active');
}

