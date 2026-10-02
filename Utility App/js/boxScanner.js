// ============================================
// BOX SCANNER MODULE - STATE & CONFIG
// ============================================
const ScannerState = {
    remark: '',
    currentBox: null,
    boxScanning: false,
    language: (typeof AppLang !== 'undefined') ? AppLang.get() : 'en',
    inputMode: 'Nu',
    uniqueMode: false,
    scans: [],
    pendingDeleteId: null,
    completedBoxes: new Set(),
    isProcessingClose: false,
    isSyncing: false,
    syncIntervalId: null,
    lastSyncError: ''
};

const ScannerT = {
    en: {
        lblRemark: "Remark", lblStartSession: "Start Session",
        lblTotal: "Total", lblBoxQty: "Box Qty", lblBoxes: "Boxes",
        lblBoxId: "Box ID", lblBarcode: "Barcode", lblCloseBox: "Close Box", lblRecentScans: "Last 5 Scans",
        thBarcode: "Barcode", thTime: "Time", thAction: "Del", lblDownload: "Download", lblReset: "Reset",
        lblCloseBoxTitle: "Close Box", lblQtyItems: "Quantity:", lblItems: "items",
        lblAreYouSure: "Are you sure you want to close this box?", lblScanToConfirm: "Scan box ID to confirm",
        lblResetTitle: "Reset Session?", lblResetMsg: "This will download your data and start a new session.",
        lblDeleteTitle: "Delete Scan?", lblDeleteMsg: "Delete this scan?",
        boxIdPlaceholder: "Scan box ID...", barcodePlaceholder: "Scan barcode...",
        remarkPlaceholder: "e.g., Fall Winter 2023 stocks",
        errEnterRemark: "Please enter a remark",
        errBoxFirst: "Scan Box ID first", errSameBox: "Scan same Box ID!", errCloseBoxFirst: "Close the box first!",
        errBoxAlreadyClosed: "Box already closed",
        errNumericOnly: "Numeric mode (Nu) is active — alphanumeric barcode not allowed",
        errModeLockedDuringBox: "Close the current box before changing Nu/AlNu mode",
        errDuplicateBarcode: "This barcode was already scanned in this box",
        errUniqueLockedDuringBox: "Close the current box before changing the No Dup setting",
        errResetNeedsConnection: "Reset needs an internet connection so your server data is cleared too",
        errResetPendingSync: "Some closed boxes haven't uploaded to your admin yet. Connect to the internet and wait for the sync badge to show ✓, then reset",
        errSaveFailed: "Could not save scan, please try again",
        errLoadFailed: "Could not load your scans, please try again",
        lblUniqueToggle: "No Dup",
        lblModeNu: "Nu",
        lblModeAlphanumeric: "ALNU",
        lblViewBox: "View Box", lblViewBoxTitle: "View Box", lblViewBoxClose: "Close",
        viewBoxPlaceholder: "Scan box ID...", errViewBoxNone: "No scans found for this box",
        lblStatusOpen: "Open", lblStatusClosed: "Closed", lblViewBoxItems: "items"
    },
    ar: {
        lblRemark: "ملاحظة", lblStartSession: "بدء الجلسة",
        lblTotal: "الإجمالي", lblBoxQty: "الصندوق", lblBoxes: "مكتمل",
        lblBoxId: "رقم الصندوق", lblBarcode: "الباركود", lblCloseBox: "إغلاق الصندوق", lblRecentScans: "آخر 5 مسح",
        thBarcode: "الباركود", thTime: "الوقت", thAction: "حذف", lblDownload: "تحميل", lblReset: "إعادة",
        lblCloseBoxTitle: "إغلاق الصندوق", lblQtyItems: "الكمية:", lblItems: "قطعة",
        lblAreYouSure: "هل أنت متأكد من إغلاق هذا الصندوق؟", lblScanToConfirm: "امسح رقم الصندوق للتأكيد",
        lblResetTitle: "إعادة تعيين؟", lblResetMsg: "سيتم تحميل البيانات وبدء جلسة جديدة.",
        lblDeleteTitle: "حذف المسح؟", lblDeleteMsg: "حذف هذا المسح؟",
        boxIdPlaceholder: "امسح رقم الصندوق...", barcodePlaceholder: "امسح الباركود...",
        remarkPlaceholder: "مثال: مخزون خريف وشتاء 2023",
        errEnterRemark: "الرجاء إدخال ملاحظة",
        errBoxFirst: "امسح رقم الصندوق أولاً", errSameBox: "امسح نفس رقم الصندوق!", errCloseBoxFirst: "أغلق الصندوق أولاً!",
        errBoxAlreadyClosed: "الصندوق مغلق بالفعل",
        errNumericOnly: "وضع الأرقام (Nu) مفعّل — لا يُسمح بباركود يحتوي على حروف",
        errModeLockedDuringBox: "أغلق الصندوق الحالي قبل تغيير وضع Nu/AlNu",
        errDuplicateBarcode: "تم مسح هذا الباركود مسبقًا في هذا الصندوق",
        errUniqueLockedDuringBox: "أغلق الصندوق الحالي قبل تغيير إعداد منع التكرار",
        errResetNeedsConnection: "إعادة التعيين تحتاج إلى اتصال بالإنترنت لمسح بيانات الخادم أيضًا",
        errResetPendingSync: "بعض الصناديق المغلقة لم تُرفع إلى المسؤول بعد. اتصل بالإنترنت وانتظر حتى تظهر علامة ✓ ثم أعد التعيين",
        errSaveFailed: "تعذر حفظ المسح، حاول مرة أخرى",
        errLoadFailed: "تعذر تحميل المسح، حاول مرة أخرى",
        lblUniqueToggle: "بدون تكرار",
        lblModeNu: "Nu",
        lblModeAlphanumeric: "ALNU",
        lblViewBox: "عرض الصندوق", lblViewBoxTitle: "عرض الصندوق", lblViewBoxClose: "إغلاق",
        viewBoxPlaceholder: "امسح رقم الصندوق...", errViewBoxNone: "لا توجد عمليات مسح لهذا الصندوق",
        lblStatusOpen: "مفتوح", lblStatusClosed: "مغلق", lblViewBoxItems: "قطعة"
    }
};

function scannerT(key) { return ScannerT[ScannerState.language][key] || key; }

// ============================================
// BOX SCANNER - LOCAL DATABASE (IndexedDB)
// ============================================
// Offline-first, same model as the main branch: every scan is written to
// IndexedDB first (instant, works with no connection), and closed boxes are
// pushed to Supabase in the background (see "SUPABASE SYNC" below). Local rows
// use the same snake_case fields as the Supabase `scans` table, plus a local-only
// `synced` flag. The database is per signed-in user so two accounts sharing a
// device never see each other's scans.
let scannerDB = null;
let scannerDBName = null;
const SCANNER_STORE = 'scans';

function initScannerDB() {
    const name = 'AKBoxScannerDB_' + AppState.user.id;
    if (scannerDB && scannerDBName === name) return Promise.resolve(scannerDB);
    if (scannerDB) { scannerDB.close(); scannerDB = null; }
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(name, 1);
        req.onerror = () => reject(req.error);
        req.onsuccess = () => { scannerDB = req.result; scannerDBName = name; resolve(scannerDB); };
        req.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(SCANNER_STORE)) {
                db.createObjectStore(SCANNER_STORE, { keyPath: 'scan_uid' });
            }
        };
    });
}

function scannerStoreOp(mode, fn) {
    return new Promise((resolve, reject) => {
        const tx = scannerDB.transaction([SCANNER_STORE], mode);
        const req = fn(tx.objectStore(SCANNER_STORE));
        tx.oncomplete = () => resolve(req ? req.result : undefined);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
    });
}

function addScan(scan) { return scannerStoreOp('readwrite', (store) => store.add(scan)); }
function updateScan(scan) { return scannerStoreOp('readwrite', (store) => store.put(scan)); }
function deleteScanById(scanUid) { return scannerStoreOp('readwrite', (store) => store.delete(scanUid)); }
function clearLocalScans() { return scannerStoreOp('readwrite', (store) => store.clear()); }

async function getAllScans() {
    const scans = await scannerStoreOp('readonly', (store) => store.getAll());
    return scans.sort((a, b) => (a.scanned_at < b.scanned_at ? -1 : a.scanned_at > b.scanned_at ? 1 : 0));
}

// ============================================
// BOX SCANNER - SUPABASE SYNC
// ============================================
const SCANNER_SYNC_BATCH = 500;
const SCANNER_SYNC_INTERVAL_MS = 10000;

// Upserting on scan_uid makes a retry safe: a batch that reached Supabase but whose
// response was lost is simply written onto the same rows again.
async function pushScansToServer(scans, onProgress) {
    // Every row is stamped with the team the account belongs to RIGHT NOW (not the one it belonged to
    // when the box was scanned): the server refuses a scan stamped with a team the person has left.
    const toRow = ({ synced, pending_since, ...row }) => ({ ...row, enterprise_id: AppState.profile?.enterprise_id || null });
    for (let i = 0; i < scans.length; i += SCANNER_SYNC_BATCH) {
        const batch = scans.slice(i, i + SCANNER_SYNC_BATCH);
        let { error } = await supabaseClient.from('scans').upsert(batch.map(toRow), { onConflict: 'scan_uid' });
        if (error && isPermissionError(error)) {
            // Most likely the team membership changed since the profile was loaded: re-read it and retry once.
            await refreshProfile(0);
            ({ error } = await supabaseClient.from('scans').upsert(batch.map(toRow), { onConflict: 'scan_uid' }));
        }
        if (error) throw error;
        if (onProgress) onProgress(Math.min(i + SCANNER_SYNC_BATCH, scans.length) / scans.length * 100);
    }
}

// The in-page isSyncing flag cannot see a second tab or the installed PWA, which share
// the same IndexedDB. The Web Lock is held across the whole origin, so only one
// instance on the device can be syncing at a time.
async function autoSyncScans() {
    if (!navigator.locks) return runAutoSync();
    return navigator.locks.request('ak-box-scanner-sync', { ifAvailable: true }, async (lock) => {
        if (!lock) return; // another tab holds it
        return runAutoSync();
    });
}

async function runAutoSync() {
    if (ScannerState.isSyncing || !AppState.isOnline || !AppState.user || !scannerDB) return;
    ScannerState.isSyncing = true;
    try {
        // Read from the local DB (not ScannerState.scans) so a second tab's changes are seen.
        const all = await getAllScans();
        const unsynced = all.filter(s => !s.synced && s.box_status === 'Closed');
        if (unsynced.length === 0) return;
        // While uploading, the sync badge shows a percentage instead of the pending count.
        const badge = document.getElementById('syncBadge');
        await pushScansToServer(unsynced, (pct) => { if (badge) badge.textContent = Math.round(pct) + '%'; });
        for (const scan of unsynced) {
            scan.synced = true;
            scan.enterprise_id = AppState.profile?.enterprise_id || null;   // keep the device copy in step with the server copy
            delete scan.pending_since;
            await updateScan(scan);
        }
        ScannerState.lastSyncError = '';
        Storage.set(scannerLastUploadKey(), String(Date.now()));
        await loadAndDisplayScans();
    } catch (err) {
        // Scans stay synced=false and are retried on the next tick; the status line says why.
        ScannerState.lastSyncError = (err && err.message) || String(err);
        console.log('Auto-sync failed:', err);
        updateScannerSyncLine();
    } finally {
        ScannerState.isSyncing = false;
    }
}

// Pull the signed-in user's own rows that this device does not have yet (a new device,
// cleared browser data, or scans from before offline support existed). Pulled rows are
// marked synced. Own rows only: an enterprise admin's RLS also exposes team rows.
async function fetchOwnServerScans() {
    const rows = [];
    const pageSize = 1000;
    for (let from = 0; ; from += pageSize) {
        const { data, error } = await supabaseClient
            .from('scans').select('*')
            .eq('user_id', AppState.user.id)
            .order('scanned_at', { ascending: true })
            .range(from, from + pageSize - 1);
        if (error) throw error;
        rows.push(...data);
        if (data.length < pageSize) break;
    }
    return rows;
}

// Enterprise members only ever clear their own device on Reset; their rows stay in
// Supabase until the enterprise admin resets them from the Team console. Individual
// accounts own their data, so their Reset also clears the server copy.
function isEnterpriseMember() {
    return !!AppState.profile?.enterprise_id;
}

async function hydrateFromServer() {
    // An enterprise member's device is the working copy; pulling server rows back in
    // would undo their local Reset (the server keeps the data for the admin).
    if (isEnterpriseMember()) return;
    const serverRows = await fetchOwnServerScans();
    const local = new Set((await getAllScans()).map(s => s.scan_uid));
    for (const row of serverRows) {
        if (local.has(row.scan_uid)) continue;
        await addScan({
            scan_uid: row.scan_uid, user_id: row.user_id, enterprise_id: row.enterprise_id,
            remark: row.remark, box_number: row.box_number, barcode: row.barcode, qty: row.qty,
            box_status: row.box_status, scanned_at: row.scanned_at, synced: true
        });
        if (row.box_status === 'Closed') ScannerState.completedBoxes.add(row.box_number);
    }
}

async function clearServerScans() {
    const { error } = await supabaseClient.from('scans').delete().eq('user_id', AppState.user.id);
    if (error) throw error;
}

// ============================================
// BOX SCANNER - SESSION PERSISTENCE
// ============================================
function saveScannerSession() {
    Storage.setJSON('scanner_session', {
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
        ScannerState.remark = session.remark || '';
        ScannerState.currentBox = session.currentBox || null;
        ScannerState.boxScanning = session.boxScanning || false;
        ScannerState.language = AppLang.get();      // the app-wide language, not the saved session's
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
    document.getElementById('scannerRemarkInput').placeholder = scannerT('remarkPlaceholder');
    document.getElementById('boxIdInput').placeholder = scannerT('boxIdPlaceholder');
    document.getElementById('barcodeInput').placeholder = scannerT('barcodePlaceholder');
    document.getElementById('viewBoxScanInput').placeholder = scannerT('viewBoxPlaceholder');
    document.body.classList.toggle('rtl', ScannerState.language === 'ar');
    document.getElementById('modeToggleBtn').checked = ScannerState.inputMode === 'AlNu';
    document.getElementById('modeToggleLabel').textContent = ScannerState.inputMode === 'AlNu' ? scannerT('lblModeAlphanumeric') : scannerT('lblModeNu');
    document.getElementById('modeToggleWrap').classList.toggle('locked', ScannerState.boxScanning);
    document.getElementById('uniqueToggleBtn').checked = ScannerState.uniqueMode;
    document.getElementById('uniqueToggleWrap').classList.toggle('locked', ScannerState.boxScanning);
}

// The language is chosen once for the whole app (see js/lang.js); the toggles in this tool just set it.
function setScannerLanguage(lang) {
    AppLang.set(lang);
}
AppLang.onChange((lang) => {
    ScannerState.language = lang;
    applyScannerTranslations();
    if (typeof saveScannerSession === 'function' && AppState.user) saveScannerSession();
    if (AppState.user && scannerDB) updateScansTable();
});

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
    const remark = document.getElementById('scannerRemarkInput').value.trim();

    if (!remark) { alert(scannerT('errEnterRemark')); document.getElementById('scannerRemarkInput').focus(); return; }

    ScannerState.remark = remark;

    setActiveSession('boxScanner', true);
    saveScannerSession();

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
            const boxQty = ScannerState.scans.filter(s => s.box_number === boxId).length;
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
            s.box_number === ScannerState.currentBox &&
            s.box_status === 'Open' &&
            s.barcode === String(barcode)
        );
        if (isDup) {
            alert(scannerT('errDuplicateBarcode') + ': ' + barcode);
            document.getElementById('barcodeInput').value = '';
            return;
        }
    }

    const scan = {
        scan_uid: newScanUid(),
        user_id: AppState.user.id,
        enterprise_id: AppState.profile?.enterprise_id || null,
        remark: ScannerState.remark,
        box_number: String(ScannerState.currentBox),
        barcode: String(barcode),
        qty: 1,
        box_status: 'Open',
        scanned_at: new Date().toISOString(),
        synced: false
    };

    try {
        await addScan(scan);
    } catch (err) {
        console.error('Save scan failed:', err);
        alert(scannerT('errSaveFailed'));
        return;
    }
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
    const boxQty = ScannerState.scans.filter(s => s.box_number === ScannerState.currentBox).length;
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
        const closedQty = ScannerState.scans
            .filter(s => s.box_number === closedBox)
            .reduce((n, s) => n + (s.qty || 1), 0);
        for (const scan of ScannerState.scans) {
            if (scan.box_number === closedBox && scan.box_status === 'Open') {
                scan.box_status = 'Closed';
                scan.synced = false;
                scan.pending_since = Date.now();     // when it started waiting to upload (drives the "stuck" message)
                await updateScan(scan);
            }
        }
        Usage.log('box_scanner', 'box_closed', 1, closedQty);
        if (closedBox) ScannerState.completedBoxes.add(closedBox);
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
        if (AppState.isOnline) autoSyncScans();
    } catch (err) {
        console.error('Close box failed:', err);
        alert(scannerT('errSaveFailed'));
    } finally {
        ScannerState.isProcessingClose = false;
    }
}

// ============================================
// BOX SCANNER - DISPLAY & STATS
// ============================================
async function loadAndDisplayScans() {
    try {
        ScannerState.scans = await getAllScans();
    } catch (err) {
        console.error('Load scans failed:', err);
        alert(scannerT('errLoadFailed'));
        return;
    }
    updateScannerStats();
    updateScansTable();
    updateSyncBadge();
    updateScannerSyncLine();
}

function scannerLastUploadKey() { return 'last_upload_bs_' + (AppState.user ? AppState.user.id : ''); }

// One plain-words line under the badge: all uploaded / waiting / offline / stuck (and why).
function updateScannerSyncLine() {
    const el = document.getElementById('syncStatusLine');
    if (!el || !AppState.user) return;
    const pending = ScannerState.scans.filter(s => !s.synced && s.box_status === 'Closed');
    const oldest = pending.reduce((m, s) => Math.min(m, s.pending_since || new Date(s.scanned_at).getTime()), Infinity);
    SyncStatus.render(el, {
        pending: pending.length, oldestMs: isFinite(oldest) ? oldest : 0, online: AppState.isOnline,
        lastOkMs: Number(Storage.get(scannerLastUploadKey()) || 0), lastError: ScannerState.lastSyncError, noun: 'items'
    });
}

function updateSyncBadge() {
    const badge = document.getElementById('syncBadge');
    if (!badge) return;
    const pending = ScannerState.scans.filter(s => !s.synced && s.box_status === 'Closed').length;
    if (pending === 0) {
        badge.textContent = '✓';
        badge.className = 'sync-badge synced';
    } else {
        badge.textContent = pending;
        badge.className = 'sync-badge pending';
    }
}

function updateScannerStats() {
    document.getElementById('statTotal').textContent = ScannerState.scans.length;
    let boxQty = 0;
    if (ScannerState.currentBox) {
        boxQty = ScannerState.scans.filter(s => s.box_number === ScannerState.currentBox).length;
    }
    document.getElementById('statBoxQty').textContent = boxQty;
    document.getElementById('statBoxes').textContent = ScannerState.completedBoxes.size;
}

function updateScansTable() {
    const tbody = document.getElementById('scansTableBody');
    tbody.innerHTML = '';
    const currentBoxScans = ScannerState.scans.filter(s => s.box_number === ScannerState.currentBox && s.box_status === 'Open');
    const recent = currentBoxScans.slice(-5).reverse();

    if (recent.length === 0) {
        tbody.innerHTML = `<tr><td colspan="3" style="text-align: center; color: var(--ak-text-light);">No scans yet</td></tr>`;
        return;
    }

    recent.forEach(scan => {
        const tr = document.createElement('tr');
        const time = new Date(scan.scanned_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        tr.innerHTML = `<td>${scan.barcode}</td><td>${time}</td><td><button class="delete-scan-btn" title="Delete this scan" data-id="${scan.scan_uid}" data-barcode="${scan.barcode}">✕</button></td>`;
        tbody.appendChild(tr);
    });
}

// ============================================
// BOX SCANNER - VIEW BOX
// ============================================
// "View Box" is available at any time (with or without an open box). Scan any box ID to see what
// was scanned into it; closing the pop-up returns to the scan field so work continues where it was.
function openViewBox() {
    document.getElementById('viewBoxScanInput').value = '';
    document.getElementById('viewBoxResult').innerHTML = '';
    document.getElementById('viewBoxModal').classList.add('active');
    setTimeout(() => document.getElementById('viewBoxScanInput').focus(), 100);
}

function closeViewBox() {
    document.getElementById('viewBoxModal').classList.remove('active');
    const input = document.getElementById('viewBoxScanInput');
    input.inputMode = 'none';
    document.getElementById('viewBoxKbdBtn').classList.remove('active');
    // back to the scan field the user was on
    document.getElementById(ScannerState.boxScanning ? 'barcodeInput' : 'boxIdInput').focus();
}

async function handleViewBoxScan(e) {
    if (e.key !== 'Enter') return;
    const input = document.getElementById('viewBoxScanInput');
    const boxId = input.value.trim();
    if (!boxId) return;
    input.value = '';
    let scans;
    try { scans = await getAllScans(); } catch (err) { scans = ScannerState.scans; }
    renderViewBoxResult(boxId, scans);
    input.focus();
}

function renderViewBoxResult(boxId, allScans) {
    const out = document.getElementById('viewBoxResult');
    const key = boxId.toLowerCase();
    const scans = allScans
        .filter(s => String(s.box_number).toLowerCase() === key)
        .sort((a, b) => (a.scanned_at < b.scanned_at ? -1 : a.scanned_at > b.scanned_at ? 1 : 0));
    if (scans.length === 0) {
        out.innerHTML = `<div class="view-box-empty">❌ ${escapeHtml(scannerT('errViewBoxNone'))}<br><span class="view-box-id">${escapeHtml(boxId)}</span></div>`;
        return;
    }
    const closed = scans.every(s => s.box_status === 'Closed');
    const qty = scans.reduce((n, s) => n + (s.qty || 1), 0);
    const rows = scans.map((s, i) => {
        const time = new Date(s.scanned_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        return `<tr><td>${i + 1}</td><td>${escapeHtml(s.barcode)}</td><td>${time}</td></tr>`;
    }).join('');
    out.innerHTML =
        `<div class="view-box-summary">
            <div><span class="view-box-id">📦 ${escapeHtml(scans[0].box_number)}</span><br>${qty} ${escapeHtml(scannerT('lblViewBoxItems'))}</div>
            <span class="view-box-status ${closed ? 'closed' : 'open'}">${escapeHtml(scannerT(closed ? 'lblStatusClosed' : 'lblStatusOpen'))}</span>
        </div>
        <div class="view-box-list"><table class="scans-table"><thead><tr><th>#</th><th>${escapeHtml(scannerT('thBarcode'))}</th><th>${escapeHtml(scannerT('thTime'))}</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function toggleViewBoxKeyboard() {
    const input = document.getElementById('viewBoxScanInput');
    const btn = document.getElementById('viewBoxKbdBtn');
    const on = btn.classList.toggle('active');
    input.inputMode = on ? 'text' : 'none';
    input.focus();
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
        try {
            await deleteScanById(ScannerState.pendingDeleteId);
            await loadAndDisplayScans();
        } catch (err) {
            console.error('Delete scan failed:', err);
            alert(scannerT('errSaveFailed'));
        }
    }
    ScannerState.pendingDeleteId = null;
}

// ============================================
// BOX SCANNER - DOWNLOAD EXCEL
// ============================================
async function downloadScannerExcel() {
    if (ScannerState.boxScanning && ScannerState.currentBox) {
        alert(scannerT('errCloseBoxFirst'));
        return;
    }
    let scans;
    try {
        scans = await getAllScans();
    } catch (err) {
        console.error('Load scans for export failed:', err);
        alert(scannerT('errLoadFailed'));
        return;
    }
    const nameForFile = (AppState.profile?.display_name || AppState.user?.email || 'export').replace(/[^a-z0-9]+/gi, '_');
    if (scans.length === 0) {
        const data = [['Remark', 'Box Number', 'Barcode', 'Qty', 'Box Status', 'Scanned At']];
        const ws = XLSX.utils.aoa_to_sheet(data);
        ws['!cols'] = [{wch:20},{wch:12},{wch:20},{wch:5},{wch:8},{wch:18}];
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Scans');
        XLSX.writeFile(wb, `${nameForFile}_empty_${new Date().toISOString().slice(0,10)}.xlsx`);
        return;
    }
    const data = scans.map(s => ({
        'Remark': s.remark, 'Box Number': s.box_number, 'Barcode': s.barcode, 'Qty': s.qty,
        'Box Status': s.box_status || 'Open', 'Scanned At': new Date(s.scanned_at).toLocaleString()
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    ws['!cols'] = [{wch:20},{wch:12},{wch:20},{wch:5},{wch:8},{wch:18}];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Scans');
    XLSX.writeFile(wb, `${nameForFile}_${new Date().toISOString().slice(0,10)}.xlsx`);
}

// ============================================
// BOX SCANNER - RESET SESSION
// ============================================
async function showResetModal() {
    // A session with no scans has nothing to confirm or download: just close it.
    if ((await getAllScans()).length === 0) {
        document.getElementById('resetModal').classList.remove('active');
        finishScannerReset();
        return;
    }
    if (ScannerState.boxScanning && ScannerState.currentBox) {
        alert(scannerT('errCloseBoxFirst'));
        return;
    }
    document.getElementById('resetModal').classList.add('active');
}

async function executeResetSession(confirmed) {
    document.getElementById('resetModal').classList.remove('active');
    if (confirmed) {
        if (isEnterpriseMember()) {
            // Admin's copy lives on the server: nothing closed may be lost before we clear the device.
            if (AppState.isOnline) await autoSyncScans();
            const pending = (await getAllScans()).filter(s => !s.synced && s.box_status === 'Closed');
            if (pending.length > 0) {
                await loadAndDisplayScans();
                alert(scannerT('errResetPendingSync'));
                return;
            }
            await downloadScannerExcel();
            try {
                await clearLocalScans();
            } catch (err) {
                console.error('Clear local scans failed:', err);
                alert(scannerT('errSaveFailed'));
                return;
            }
        } else {
            if (!AppState.isOnline) {
                alert(scannerT('errResetNeedsConnection'));
                return;
            }
            try {
                // Bring in anything on the server this device lacks, so the export holds
                // every row that the reset is about to delete.
                await hydrateFromServer();
                await loadAndDisplayScans();
            } catch (err) {
                console.error('Pre-reset refresh failed:', err);
                alert(scannerT('errLoadFailed'));
                return;
            }
            await downloadScannerExcel();
            try {
                await clearServerScans();
                await clearLocalScans();
            } catch (err) {
                console.error('Clear scans failed:', err);
                alert(scannerT('errSaveFailed'));
                return;
            }
        }
        finishScannerReset();
    }
}

// The last step of every Reset: forget the session and go back to the start screen.
function finishScannerReset() {
    clearScannerSession();
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

// ============================================
// BOX SCANNER - EVENT LISTENERS
// ============================================
let scannerListenersAdded = false;

function setupScannerEventListeners() {
    if (scannerListenersAdded) return;
    scannerListenersAdded = true;
    document.getElementById('modeToggleBtn').addEventListener('click', guardScannerModeToggle);
    document.getElementById('modeToggleBtn').addEventListener('change', (e) => setScannerInputMode(e.target.checked ? 'AlNu' : 'Nu'));
    document.getElementById('uniqueToggleBtn').addEventListener('click', guardScannerUniqueToggle);
    document.getElementById('uniqueToggleBtn').addEventListener('change', (e) => setScannerUniqueMode(e.target.checked));
    document.getElementById('startSessionBtn').addEventListener('click', startScannerSession);
    document.getElementById('boxIdInput').addEventListener('keypress', handleBoxIdScan);
    document.getElementById('barcodeInput').addEventListener('keypress', handleBarcodeScan);
    document.getElementById('closeBoxBtn').addEventListener('click', showCloseBoxModal);
    document.getElementById('closeBoxYesBtn').addEventListener('click', closeBoxProceedToScan);
    document.getElementById('closeBoxCancelBtn').addEventListener('click', cancelCloseBox);
    document.getElementById('closeBoxBackBtn').addEventListener('click', cancelCloseBox);
    document.getElementById('closeBoxScanInput').addEventListener('keypress', handleCloseBoxScan);
    document.getElementById('syncStatusLine').addEventListener('click', (e) => {
        if (e.currentTarget.classList.contains('tappable') && AppState.isOnline) autoSyncScans();     // tap to retry now
    });
    window.addEventListener('online', updateScannerSyncLine);
    window.addEventListener('offline', updateScannerSyncLine);
    document.getElementById('viewBoxBtn').addEventListener('click', openViewBox);
    document.getElementById('viewBoxCloseBtn').addEventListener('click', closeViewBox);
    document.getElementById('viewBoxScanInput').addEventListener('keypress', handleViewBoxScan);
    document.getElementById('viewBoxKbdBtn').addEventListener('click', toggleViewBoxKeyboard);
    document.getElementById('viewBoxModal').addEventListener('keydown', (e) => { if (e.key === 'Escape') closeViewBox(); });
    document.getElementById('scansTableBody').addEventListener('click', (e) => {
        if (e.target.classList.contains('delete-scan-btn')) {
            showDeleteModal(e.target.dataset.id, e.target.dataset.barcode);
        }
    });
    document.getElementById('deleteYesBtn').addEventListener('click', () => executeDeleteScan(true));
    document.getElementById('deleteNoBtn').addEventListener('click', () => executeDeleteScan(false));
    document.getElementById('downloadBtn').addEventListener('click', downloadScannerExcel);
    document.getElementById('resetSessionBtn').addEventListener('click', showResetModal);
    document.getElementById('resetYesBtn').addEventListener('click', () => executeResetSession(true));
    document.getElementById('resetNoBtn').addEventListener('click', () => executeResetSession(false));
}

// ============================================
// BOX SCANNER - INITIALIZATION
// ============================================
async function initBoxScanner() {
    try {
        await initScannerDB();
    } catch (err) {
        console.error('Open local scan database failed:', err);
        alert(scannerT('errLoadFailed'));
        return;
    }
    setupScannerEventListeners();
    const hasSession = loadScannerSession();
    if (AppState.isOnline && !isEnterpriseMember()) {
        try { await hydrateFromServer(); } catch (err) { console.log('Server refresh failed:', err); }
        saveScannerSession();
    }
    applyScannerTranslations();

    if (hasSession && ScannerState.remark) {
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
    if (ScannerState.syncIntervalId) clearInterval(ScannerState.syncIntervalId);
    ScannerState.syncIntervalId = setInterval(() => {
        if (AppState.isOnline && AppState.user) autoSyncScans();
        updateScannerSyncLine();                      // keeps "x min ago" fresh
    }, SCANNER_SYNC_INTERVAL_MS);
    autoSyncScans();
}

// Push pending scans the moment the connection comes back instead of waiting for the next tick.
window.addEventListener('online', () => {
    if (ScannerState.syncIntervalId && AppState.user) autoSyncScans();
});

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
