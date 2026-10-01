// ============================================
// YEAR/SEASON SEGREGATION MODULE
// ============================================
var YSState = {
    staffName: '',
    remark: '',
    inputMode: 'Nu',
    huStates: [],
    huConfig: [],
    scanStep: 'item',
    pendingItem: null,
    pendingHuIdx: null,
    isSyncing: false,
    lastSyncError: '',
    isProcessingClose: false,
    initialized: false,
    syncIntervalId: null
};

// ============================================
// RIYADH TIMESTAMP
// ============================================
function ysNow() {
    return new Date().toLocaleString('en-GB', { timeZone: 'Asia/Riyadh' });
}

// ============================================
// YEAR/SEASON SEGREGATION — DATABASE
// ============================================
var ysDB;
var YS_DB_PREFIX = 'AKYSSegregateDB_';   // one database per signed-in user
var ysDBName = null;
var YS_SCANS_STORE = 'ys_scans';
var YS_ITEMS_STORE = 'ys_item_master';

function initYsDB() {
    const name = YS_DB_PREFIX + AppState.user.id;
    if (ysDB && ysDBName === name) return Promise.resolve(ysDB);
    if (ysDB) { ysDB.close(); ysDB = null; }
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(name, 1);
        req.onerror = () => reject(req.error);
        req.onsuccess = () => { ysDB = req.result; ysDBName = name; resolve(ysDB); };
        req.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(YS_SCANS_STORE)) {
                db.createObjectStore(YS_SCANS_STORE, { keyPath: 'id', autoIncrement: true });
            }
            if (!db.objectStoreNames.contains(YS_ITEMS_STORE)) {
                db.createObjectStore(YS_ITEMS_STORE, { keyPath: 'barcode' });
            }
        };
    });
}

function ysDbAdd(storeName, record) {
    return new Promise((resolve, reject) => {
        const tx = ysDB.transaction([storeName], 'readwrite');
        const store = tx.objectStore(storeName);
        const req = store.add(record);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

function ysDbPut(storeName, record) {
    return new Promise((resolve, reject) => {
        const tx = ysDB.transaction([storeName], 'readwrite');
        const store = tx.objectStore(storeName);
        const req = store.put(record);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

function ysDbGetAll(storeName) {
    return new Promise((resolve, reject) => {
        const tx = ysDB.transaction([storeName], 'readonly');
        const store = tx.objectStore(storeName);
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

function ysDbGet(storeName, key) {
    return new Promise((resolve, reject) => {
        const tx = ysDB.transaction([storeName], 'readonly');
        const store = tx.objectStore(storeName);
        const req = store.get(key);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

function ysDbCount(storeName) {
    return new Promise((resolve, reject) => {
        const tx = ysDB.transaction([storeName], 'readonly');
        const req = tx.objectStore(storeName).count();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

function ysDbBulkPut(storeName, records) {
    return new Promise((resolve, reject) => {
        const tx = ysDB.transaction([storeName], 'readwrite');
        const store = tx.objectStore(storeName);
        records.forEach(r => store.put(r));
        tx.oncomplete = () => resolve(records.length);
        tx.onerror = () => reject(tx.error);
    });
}

function ysDbClearStore(storeName) {
    return new Promise((resolve, reject) => {
        const tx = ysDB.transaction([storeName], 'readwrite');
        const store = tx.objectStore(storeName);
        const req = store.clear();
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
    });
}

// Persistent used-box tracker: keyed by storeId + Riyadh date so it auto-resets at midnight
// and survives session resets (localStorage is not cleared on reset)
function ysUsedBoxesKey() {
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Riyadh' });
    return `ys_used_boxes_${AppState.storeId}_${today}`;
}
function ysGetUsedBoxesToday() {
    return new Set(JSON.parse(localStorage.getItem(ysUsedBoxesKey()) || '[]'));
}
function ysMarkBoxUsed(barcode) {
    const boxes = ysGetUsedBoxesToday();
    boxes.add(barcode);
    localStorage.setItem(ysUsedBoxesKey(), JSON.stringify([...boxes]));
}

// Scans captured before sync used scan IDs get one now, before they are ever uploaded.
async function ysBackfillScanUids() {
    const all = await ysDbGetAll(YS_SCANS_STORE);
    for (const scan of all) {
        if (!scan.scanUid) { scan.scanUid = newScanUid(); await ysDbPut(YS_SCANS_STORE, scan); }
    }
}

// Upload buttons (item master / PTL config) are only for individuals and enterprise admins.
function ysSetupUploadButtons() {
    document.getElementById('ysUploadRow').style.display = refCanUpload() ? 'flex' : 'none';
    const itemsBtn = document.getElementById('ysUploadItemsBtn');
    const ptlBtn = document.getElementById('ysUploadPtlBtn');
    itemsBtn.onclick = () => refStartUpload('ys_item_master', itemsBtn, async () => { await syncItemMaster(null, true); await ysUpdateImCount(); });
    ptlBtn.onclick = () => refStartUpload('ys_ptl_config', ptlBtn, async () => { await syncHuConfig(true); });
}

// Update all scan records for a given box (by ptlNumber + boxBarcode) to Closed
async function ysCloseBoxScans(ptlNumber, boxBarcode) {
    const allScans = await ysDbGetAll(YS_SCANS_STORE);
    const boxScans = allScans.filter(s =>
        s.ptlNumber === ptlNumber && s.boxBarcode === boxBarcode && s.boxStatus === 'Open'
    );
    for (const scan of boxScans) {
        scan.boxStatus = 'Closed';
        scan.synced = false;
        scan.pendingSince = Date.now();            // when it started waiting to upload (drives the "stuck" message)
        await ysDbPut(YS_SCANS_STORE, scan);
    }
    return boxScans.length;
}

// ============================================
// SESSION PERSISTENCE
// ============================================
function saveYsSession() {
    Storage.setJSON('ys_session', {
        staffName: YSState.staffName,
        remark: YSState.remark,
        inputMode: YSState.inputMode
    });
    Storage.setJSON('ys_hu_states', YSState.huStates);
}

function loadYsSession() {
    const session = Storage.getJSON('ys_session');
    if (session && session.staffName) {
        YSState.staffName = session.staffName;
        YSState.remark = session.remark || '';
        YSState.inputMode = session.inputMode || 'AlNu';
        return true;
    }
    return false;
}

function loadYsHuStates() {
    const states = Storage.getJSON('ys_hu_states');
    if (states && Array.isArray(states)) {
        YSState.huStates = states;
    }
}

function clearYsSession() {
    Storage.remove('ys_session');
    Storage.remove('ys_hu_states');
    Storage.remove('active_session');
    YSState.staffName = '';
    YSState.remark = '';
    YSState.huStates = [];
    YSState.scanStep = 'item';
    YSState.pendingItem = null;
    YSState.pendingHuIdx = null;
}

// ============================================
// ITEM MASTER & PTL CONFIG SYNC (shared list code in js/lists.js)
// ============================================
// Both lists are owned per enterprise / individual account and uploaded by the admin.
// Each device keeps its own copy for instant, offline lookups.

// Saves the item master into this tool's lookup table (chunked, so progress can be shown).
async function ysSaveItemMaster(rows, onProgress) {
    const mapped = rows
        .filter(row => row.barcode)
        .map(row => ({
            barcode: String(row.barcode).trim(),
            year: Number(row.year) || 0,
            season: String(row.season || '').trim().toUpperCase(),
            brand: String(row.brand || '').trim()
        }));

    await ysDbClearStore(YS_ITEMS_STORE);

    const CHUNK = 5000;
    for (let i = 0; i < mapped.length; i += CHUNK) {
        await ysDbBulkPut(YS_ITEMS_STORE, mapped.slice(i, i + CHUNK));
        if (onProgress) onProgress(Math.min(i + CHUNK, mapped.length) / mapped.length);
    }
    if (onProgress) onProgress(1);
    Storage.set('ys_item_master_ts', ysNow());
}

function ysSavePtlConfig(rows) {
    const config = rows
        .filter(row => row.ptl_number && String(row.ptl_number).trim() !== '')
        .map(row => ({
            ptlNumber: String(row.ptl_number).trim().padStart(2, '0'),
            season: String(row.season || '').trim().toUpperCase(),
            year: Number(row.year) || 0,
            yearLogic: String(row.year_logic || 'lte').trim().toLowerCase()
        }));
    YSState.huConfig = config;
    Storage.setJSON('ys_hu_config', config);
}

// Returns true on success (including "already up to date"), false on failure.
// onProgress receives 0..100.
async function syncItemMaster(onProgress, force) {
    try {
        await refSync('ys_item_master', { force: !!force, onProgress, saveRows: ysSaveItemMaster });
        return true;
    } catch (e) {
        console.error('Item master sync failed:', e);
        return false;
    }
}

async function syncHuConfig(force) {
    try {
        await refSync('ys_ptl_config', {
            force: !!force,
            saveRows: async (rows) => ysSavePtlConfig(rows)
        });
        // "up to date" leaves the local copy untouched - make sure it is loaded.
        if (!YSState.huConfig.length) loadCachedHuConfig();
        return true;
    } catch (e) {
        console.error('PTL config sync failed:', e);
        return false;
    }
}

function loadCachedHuConfig() {
    const cached = Storage.getJSON('ys_hu_config');
    if (cached && Array.isArray(cached) && cached.length > 0) {
        YSState.huConfig = cached;
        return true;
    }
    return false;
}

// Build fresh HU states from config (merge with existing session states)
// Any PTL not in the current config is dropped, even if it has existing state.
function buildHuStates() {
    const existing = YSState.huStates;

    YSState.huStates = YSState.huConfig.map(cfg => {
        const prev = existing.find(s => s.ptlNumber === cfg.ptlNumber);
        return prev
            ? { ...prev, season: cfg.season, year: cfg.year, yearLogic: cfg.yearLogic }
            : {
                ptlNumber: cfg.ptlNumber,
                season: cfg.season,
                year: cfg.year,
                yearLogic: cfg.yearLogic,
                status: 'Empty',
                boxBarcode: null,
                boxOpenTime: null,
                itemCount: 0
            };
    });

    // Sort by ptlNumber
    YSState.huStates.sort((a, b) => a.ptlNumber.localeCompare(b.ptlNumber));
    saveYsSession();
}

// ============================================
// HU MATCHING
// ============================================
function matchItemToHu(year, season) {
    // season normalised: 'SS' or 'FW'
    const normSeason = normaliseSeason(season);
    for (let i = 0; i < YSState.huStates.length; i++) {
        const hu = YSState.huStates[i];
        if (normaliseSeason(hu.season) !== normSeason) continue;
        if (hu.yearLogic === 'lte' && year <= hu.year) return i;
        if (hu.yearLogic === 'exact' && year === hu.year) return i;
    }
    return -1;
}

function normaliseSeason(s) {
    const upper = String(s || '').toUpperCase().trim();
    if (upper === 'SS' || upper === 'SPRING' || upper === 'SUMMER' || upper === 'SPRING/SUMMER') return 'SS';
    if (upper === 'FW' || upper === 'FALL' || upper === 'WINTER' || upper === 'FALL/WINTER') return 'FW';
    return upper;
}

function huLabel(hu) {
    const logic = hu.yearLogic === 'lte' ? `≤${hu.year}` : `${hu.year}`;
    return `${normaliseSeason(hu.season)} ${logic}`;
}

// ============================================
// SCAN LOGIC
// ============================================
async function handleYsScan(e) {
    if (e.key !== 'Enter') return;
    const raw = document.getElementById('ysBarcodeInput').value.trim();
    document.getElementById('ysBarcodeInput').value = '';
    if (!raw) return;

    const upper = raw.toUpperCase();

    // ST/CL codes always pass through regardless of Nu/AlNu mode
    const stMatch = upper.match(/^ST(\d+)$/);
    if (stMatch) {
        await handleStartBoxScan(stMatch[1].padStart(2, '0'));
        return;
    }
    const clMatch = upper.match(/^CL(\d+)$/);
    if (clMatch) {
        await handleCloseInitiate(clMatch[1].padStart(2, '0'));
        return;
    }

    // Waiting for ST scan — only ST0X accepted here
    if (YSState.scanStep === 'st_wait') {
        const ptl = YSState.huStates[YSState.pendingHuIdx].ptlNumber;
        ysShowError(`Waiting for ST${ptl} scan to open the box. You scanned "${raw}" — please scan the ST QR code at PTL ${ptl}.`);
        return;
    }

    // Box barcode and box confirm scans pass through (can be alphanumeric)
    if (YSState.scanStep === 'box_id_capture') {
        await handleBoxIdCapture(raw);
        return;
    }
    if (YSState.scanStep === 'box_confirm') {
        await handleBoxBarcodeScan(raw);
        return;
    }

    // Nu mode guard applies only to item barcode scans
    if (YSState.inputMode === 'Nu' && !/^\d+$/.test(raw)) {
        ysShowError(`Numeric mode is active — only numeric barcodes allowed. Switch to AlNu mode to scan alphanumeric barcodes.`);
        return;
    }

    // Item re-scan or normal item scan
    if (YSState.scanStep === 'item_rescan') {
        await handleItemRescan(raw);
        return;
    }
    await handleItemScan(raw);
}

async function handleItemScan(barcode) {
    const item = await ysDbGet(YS_ITEMS_STORE, barcode);

    if (!item) {
        ysSetResult('error', barcode, 'Not found in Item Master', 'Please inform your supervisor');
        ysVoice('notFound');
        return;
    }

    const huIdx = matchItemToHu(item.year, item.season);
    if (huIdx === -1) {
        const label = `${normaliseSeason(item.season)} ${item.year}`;
        ysSetResult('error', label, 'Not configured for any PTL', 'Ask your supervisor to add this season/year to HU config');
        ysVoice('notConfigured');
        return;
    }

    const hu = YSState.huStates[huIdx];

    if (hu.status === 'Empty' || hu.status === 'Closed') {
        // Need to create a new box (first time or after previous box was closed)
        YSState.pendingItem = item;
        YSState.pendingHuIdx = huIdx;
        YSState.scanStep = 'st_wait';
        saveYsSession();
        ysSetResult('waiting', `Scan ST${hu.ptlNumber}`, `Scan ST${hu.ptlNumber} to start`, `${huLabel(hu)} | ${item.brand || ''}`);
        ysSetInputLabel(`Scan ST${hu.ptlNumber}`);
        ysRenderHuPanel();
        return;
    }

    // HU is Open — ask for box barcode confirmation
    YSState.pendingItem = item;
    YSState.pendingHuIdx = huIdx;
    YSState.scanStep = 'box_confirm';
    saveYsSession();
    ysSetResult('match', `PUT IN PTL ${hu.ptlNumber}`, `${huLabel(hu)} | ${item.brand || ''}`, `Scan Box on PTL ${hu.ptlNumber}`);
    ysSetInputLabel(`Scan Box on PTL ${hu.ptlNumber}`);
    ysRenderHuPanel();
}

async function handleStartBoxScan(ptlPadded) {
    if (YSState.scanStep !== 'st_wait') {
        ysShowError(`Unexpected scan: ST${ptlPadded}. Scan an item barcode first.`);
        return;
    }

    const hu = YSState.huStates[YSState.pendingHuIdx];
    if (hu.ptlNumber !== ptlPadded) {
        ysShowError(`Wrong PTL. Please scan ST${hu.ptlNumber} for the correct location.`);
        return;
    }

    // Open the HU — box barcode must be scanned next to register the box
    hu.status = 'Open';
    hu.boxBarcode = null;
    hu.itemCount = 0;
    YSState.scanStep = 'box_id_capture';
    saveYsSession();

    ysSetResult('st', `Scan Box ID on ${hu.ptlNumber}`, `Stick label on box & scan it`, `${huLabel(hu)}`);
    ysSetInputLabel(`Scan Box Barcode`);
    ysRenderHuPanel();
    ysUpdateStats();
    ysSyncModeLock();
}

async function handleBoxIdCapture(barcode) {
    const hu = YSState.huStates[YSState.pendingHuIdx];

    // Box barcode cannot be an item barcode
    const existingItem = await ysDbGet(YS_ITEMS_STORE, barcode);
    if (existingItem) {
        ysShowError(`"${barcode}" is an item barcode, not a box barcode. Please scan the physical box label for PTL ${hu.ptlNumber}.`);
        ysVoice('itemAsBox');
        return;
    }

    // Box barcode cannot already be in use on any PTL this session (open state)
    const usedByHu = YSState.huStates.find(h => h.boxBarcode === barcode);
    if (usedByHu) {
        ysShowError(`Box "${barcode}" is already assigned to PTL ${usedByHu.ptlNumber}. Each box must have a unique barcode.`);
        return;
    }

    // Box barcode cannot have been used in a previous closed box this session (IndexedDB)
    const allScans = await ysDbGetAll(YS_SCANS_STORE);
    const prevBox = allScans.find(s => s.boxBarcode === barcode);
    if (prevBox) {
        ysShowError(`Box "${barcode}" was already used on PTL ${prevBox.ptlNumber} this session. Please use a different box.`);
        ysVoice('duplicateBox');
        return;
    }

    // Box barcode cannot have been used today even across session resets (localStorage)
    const usedToday = ysGetUsedBoxesToday();
    if (usedToday.has(barcode)) {
        ysShowError(`Box "${barcode}" was already used today. Please use a different box.`);
        ysVoice('duplicateBox');
        return;
    }

    ysMarkBoxUsed(barcode);
    hu.boxBarcode = barcode;
    YSState.scanStep = 'item_rescan';
    saveYsSession();
    ysSyncModeLock();

    ysSetResult('box', `Box Created`, `Now scan the item`, `${huLabel(hu)} | Box: ${barcode}`);
    ysSetInputLabel(`Scan item`);
}

async function handleItemRescan(barcode) {
    const item = await ysDbGet(YS_ITEMS_STORE, barcode);
    if (!item) {
        ysShowError(`Barcode ${barcode} not found in Item Master.`);
        return;
    }
    const huIdx = matchItemToHu(item.year, item.season);
    if (huIdx !== YSState.pendingHuIdx) {
        // Different item — reset pending state and route as a fresh scan
        // (the box on the original PTL stays open, ready for future scans)
        YSState.pendingItem = null;
        YSState.pendingHuIdx = null;
        YSState.scanStep = 'item';
        saveYsSession();
        await handleItemScan(barcode);
        return;
    }
    const hu = YSState.huStates[huIdx];
    YSState.pendingItem = item;
    YSState.scanStep = 'box_confirm';
    saveYsSession();
    ysSetResult('match', `PUT IN PTL ${hu.ptlNumber}`, `${huLabel(hu)} | ${item.brand || ''}`, `Scan Box on PTL ${hu.ptlNumber}`);
    ysSetInputLabel(`Scan Box on PTL ${hu.ptlNumber}`);
    ysRenderHuPanel();
}

async function handleBoxBarcodeScan(barcode) {
    const huIdx = YSState.pendingHuIdx;
    const hu = YSState.huStates[huIdx];
    const item = YSState.pendingItem;

    if (!item) {
        // Box barcode scanned with no pending item — could be re-scan of item first
        // Treat as a new item scan
        YSState.scanStep = 'item';
        YSState.pendingItem = null;
        YSState.pendingHuIdx = null;
        saveYsSession();
        await handleItemScan(barcode);
        return;
    }

    // Verify box barcode matches registered box
    if (hu.boxBarcode !== barcode) {
        ysShowError(`Wrong box — please scan the barcode for PTL ${hu.ptlNumber} (${hu.boxBarcode})`);
        ysVoice('wrongBox');
        ysSetInputLabel(`Scan box barcode`);
        return;
    }

    // Log the scan
    const scanTs = ysNow();
    const scanRecord = {
        scanUid: newScanUid(),
        scanIso: new Date().toISOString(),
        storeId: AppState.storeId,
        storeName: AppState.storeName,
        staffName: YSState.staffName,
        remark: YSState.remark,
        ptlNumber: hu.ptlNumber,
        season: normaliseSeason(hu.season),
        year: hu.year,
        brand: item.brand || '',
        barcode: item.barcode,
        qty: 1,
        boxBarcode: hu.boxBarcode,
        boxStatus: 'Open',
        scanTimestamp: scanTs,
        dedupKey: `${AppState.storeId}_${hu.ptlNumber}_${hu.boxBarcode}_${item.barcode}_${scanTs}`,
        synced: false
    };

    await ysDbAdd(YS_SCANS_STORE, scanRecord);
    hu.itemCount++;
    YSState.pendingItem = null;
    YSState.pendingHuIdx = null;
    YSState.scanStep = 'item';
    saveYsSession();

    ysSetResult('match', `✓ PTL ${hu.ptlNumber}`, `Item logged`, `${huLabel(hu)} | ${hu.itemCount} item${hu.itemCount === 1 ? '' : 's'}`);
    ysSetInputLabel(`Scan Barcode`);
    ysRenderHuPanel();
    ysUpdateStats();

    // Flash clear after 1.5s
    setTimeout(() => {
        if (YSState.scanStep === 'item') {
            ysSetResult('idle', '—', 'Scan an item to begin', '');
        }
    }, 1500);
}

// ============================================
// CLOSE BOX FLOW
// ============================================
async function handleCloseInitiate(ptlPadded) {
    const huIdx = YSState.huStates.findIndex(h => h.ptlNumber === ptlPadded);
    if (huIdx === -1) {
        ysShowError(`PTL ${ptlPadded} is not configured.`);
        return;
    }
    const hu = YSState.huStates[huIdx];
    if (hu.status !== 'Open') {
        ysShowError(`PTL ${ptlPadded} has no open box.`);
        return;
    }

    // Show close modal
    document.getElementById('ysCloseModalPtl').textContent = ptlPadded;
    document.getElementById('ysCloseModalSeason').textContent = `${normaliseSeason(hu.season)} ${hu.year}`;
    document.getElementById('ysCloseModalBox').textContent = hu.boxBarcode;
    document.getElementById('ysCloseModalQty').textContent = hu.itemCount;
    document.getElementById('ysCloseStep1').style.display = 'block';
    document.getElementById('ysCloseStep2').style.display = 'none';
    document.getElementById('ysCloseButtons1').style.display = 'flex';
    document.getElementById('ysCloseButtons2').style.display = 'none';
    document.getElementById('ysCloseBoxInput').value = '';
    ysSetResult('close', `PTL ${ptlPadded}`, 'Close Box', `${normaliseSeason(hu.season)} ${hu.year} — ${hu.itemCount} items`);
    document.getElementById('ysCloseModal').classList.add('active');

    YSState.pendingHuIdx = huIdx;
}

function ysCloseBoxProceedToScan() {
    document.getElementById('ysCloseStep1').style.display = 'none';
    document.getElementById('ysCloseStep2').style.display = 'block';
    document.getElementById('ysCloseButtons1').style.display = 'none';
    document.getElementById('ysCloseButtons2').style.display = 'flex';
    document.getElementById('ysCloseBoxInput').inputMode = 'none';
    setTimeout(() => document.getElementById('ysCloseBoxInput').focus(), 100);
}

function ysHandleCloseBoxConfirmScan(e) {
    if (e.key !== 'Enter') return;
    const scanned = document.getElementById('ysCloseBoxInput').value.trim();
    if (!scanned) return;
    document.getElementById('ysCloseBoxInput').value = '';

    const hu = YSState.huStates[YSState.pendingHuIdx];
    if (hu.boxBarcode && hu.boxBarcode !== scanned) {
        ysShowError(`Wrong box — please scan the barcode for PTL ${hu.ptlNumber}`);
        ysVoice('wrongBox');
        document.getElementById('ysCloseModal').classList.remove('active');
        return;
    }

    ysExecuteCloseBox(scanned);
}

async function ysExecuteCloseBox(confirmedBoxBarcode) {
    if (YSState.isProcessingClose) return;
    YSState.isProcessingClose = true;
    document.getElementById('ysCloseModal').classList.remove('active');

    try {
        const hu = YSState.huStates[YSState.pendingHuIdx];

        const closedQty = hu.itemCount;
        await ysCloseBoxScans(hu.ptlNumber, hu.boxBarcode);
        Usage.log('year_season', 'box_closed', 1, closedQty);

        hu.status = 'Closed';
        hu.itemCount = 0;
        YSState.scanStep = 'item';
        YSState.pendingHuIdx = null;
        YSState.pendingItem = null;
        saveYsSession();

        ysRenderHuPanel();
        ysUpdateStats();
        ysSyncModeLock();
        ysSetResult('idle', '—', 'Scan an item to begin', '');
        ysSetInputLabel('Scan Barcode');

        if (AppState.isOnline) await ysAutoSync();
    } finally {
        YSState.isProcessingClose = false;
    }
}

function ysCancelClose() {
    document.getElementById('ysCloseModal').classList.remove('active');
    document.getElementById('ysCloseBoxInput').value = '';
    YSState.pendingHuIdx = null;
    document.getElementById('ysBarcodeInput').focus();
}

// ============================================
// SUPABASE SYNC (closed boxes -> ys_scans)
// ============================================
const YS_SYNC_BATCH = 500;

// Local scan record -> ys_scans row. scan_uid makes a resend land on the same row.
function ysToServerRow(s) {
    return {
        scan_uid: s.scanUid,
        user_id: AppState.user.id,
        enterprise_id: AppState.profile?.enterprise_id || null,
        staff_name: s.staffName,
        remark: s.remark,
        ptl_number: s.ptlNumber,
        season: s.season,
        year: s.year,
        brand: s.brand,
        barcode: s.barcode,
        qty: s.qty || 1,
        box_barcode: s.boxBarcode,
        box_status: s.boxStatus,
        scan_timestamp: s.scanTimestamp,
        scanned_at: s.scanIso || new Date().toISOString()
    };
}

function ysFromServerRow(r) {
    return {
        scanUid: r.scan_uid, storeId: AppState.storeId, storeName: AppState.storeName,
        staffName: r.staff_name, remark: r.remark, ptlNumber: r.ptl_number, season: r.season,
        year: r.year, brand: r.brand, barcode: r.barcode, qty: r.qty, boxBarcode: r.box_barcode,
        boxStatus: r.box_status, scanTimestamp: r.scan_timestamp, scanIso: r.scanned_at, synced: true
    };
}

// The in-page isSyncing flag cannot see a second tab or the installed PWA, which share
// the same IndexedDB. The Web Lock is held across the whole origin, so only one instance
// on the device can be syncing at a time.
async function ysAutoSync() {
    if (!navigator.locks) return ysRunAutoSync();
    return navigator.locks.request('ak-year-segregate-sync', { ifAvailable: true }, async (lock) => {
        if (!lock) return; // another tab holds it
        return ysRunAutoSync();
    });
}

async function ysRunAutoSync() {
    if (!ysDB || !AppState.user || !AppState.isOnline) return;
    if (YSState.isSyncing) return;
    YSState.isSyncing = true;
    try {
        const allScans = await ysDbGetAll(YS_SCANS_STORE);
        const unsynced = allScans.filter(s => !s.synced && s.boxStatus === 'Closed');
        if (unsynced.length === 0) return;

        const badge = document.getElementById('ysSyncBadge');
        for (let i = 0; i < unsynced.length; i += YS_SYNC_BATCH) {
            const batch = unsynced.slice(i, i + YS_SYNC_BATCH);
            const { error } = await supabaseClient.from('ys_scans')
                .upsert(batch.map(ysToServerRow), { onConflict: 'scan_uid' });
            if (error) throw error;
            for (const scan of batch) {
                scan.synced = true;
                delete scan.pendingSince;
                await ysDbPut(YS_SCANS_STORE, scan);
            }
            YSState.lastSyncError = '';
            Storage.set(ysLastUploadKey(), String(Date.now()));
            if (badge) badge.textContent = Math.round(Math.min(i + YS_SYNC_BATCH, unsynced.length) / unsynced.length * 100) + '%';
        }
    } catch (e) {
        // Scans stay synced=false and are retried on the next tick; the status line says why.
        YSState.lastSyncError = (e && e.message) || String(e);
        console.error('YS auto-sync error:', e);
    } finally {
        YSState.isSyncing = false;
        ysUpdateSyncBadge();
    }
}

// ============================================
// EXCEL DOWNLOAD
// ============================================
async function ysDownloadExcel() {
    const scans = await ysDbGetAll(YS_SCANS_STORE);
    const headers = [
        'Store ID', 'Store Name', 'Staff', 'Remark',
        'PTL Number', 'Season', 'Year', 'Brand',
        'Barcode', 'Qty', 'Box Barcode', 'Box Status', 'Scan Timestamp'
    ];

    if (scans.length === 0) {
        const ws = XLSX.utils.aoa_to_sheet([headers]);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'YS Scans');
        XLSX.writeFile(wb, `${AppState.storeId}_YS_empty_${new Date().toISOString().slice(0, 10)}.xlsx`);
        return;
    }

    const rows = scans.map(s => ({
        'Store ID': s.storeId,
        'Store Name': s.storeName,
        'Staff': s.staffName,
        'Remark': s.remark,
        'PTL Number': s.ptlNumber,
        'Season': s.season,
        'Year': s.year,
        'Brand': s.brand,
        'Barcode': s.barcode,
        'Qty': s.qty,
        'Box Barcode': s.boxBarcode,
        'Box Status': s.boxStatus,
        'Scan Timestamp': s.scanTimestamp
    }));

    const ws = XLSX.utils.json_to_sheet(rows);
    ws['!cols'] = headers.map(() => ({ wch: 16 }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'YS Scans');
    XLSX.writeFile(wb, `${AppState.storeId}_${YSState.staffName}_YS_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

// ============================================
// RESET SESSION
// ============================================
function ysShowResetModal() {
    const openPtls = YSState.huStates.filter(h => h.status === 'Open').map(h => `PTL ${h.ptlNumber}`);
    if (openPtls.length > 0) {
        ysShowError(`Cannot reset — ${openPtls.join(', ')} ${openPtls.length === 1 ? 'is' : 'are'} still open. Close all boxes before resetting.`);
        return;
    }
    document.getElementById('ysResetModal').classList.add('active');
}

// Individuals own their data: Reset clears this device AND their server copy.
// Enterprise members only clear their own device - the data stays in Supabase until
// the enterprise admin resets it from the Team console. Either way the data is
// downloaded first, and an enterprise member's Reset waits until every closed box has
// reached the server so nothing the admin should see is lost.
async function ysExecuteReset() {
    document.getElementById('ysResetModal').classList.remove('active');
    const isEnterpriseMember = !!AppState.profile?.enterprise_id;

    if (isEnterpriseMember) {
        if (AppState.isOnline) await ysAutoSync();
        const pending = (await ysDbGetAll(YS_SCANS_STORE)).filter(s => !s.synced && s.boxStatus === 'Closed');
        if (pending.length > 0) {
            ysUpdateSyncBadge();
            ysShowError("Some closed boxes haven't uploaded to your admin yet. Connect to the internet and wait for the sync badge to show ✓, then reset.");
            return;
        }
        await ysDownloadExcel();
        await ysDbClearStore(YS_SCANS_STORE);
    } else {
        if (!AppState.isOnline) {
            ysShowError('Reset needs an internet connection so your server data is cleared too.');
            return;
        }
        try {
            // Pull in anything on the server this device lacks so the export holds every
            // row that the reset is about to delete.
            const { data, error } = await supabaseClient.from('ys_scans').select('*').eq('user_id', AppState.user.id);
            if (error) throw error;
            const have = new Set((await ysDbGetAll(YS_SCANS_STORE)).map(s => s.scanUid));
            for (const r of data || []) if (!have.has(r.scan_uid)) await ysDbAdd(YS_SCANS_STORE, ysFromServerRow(r));
        } catch (err) {
            console.error('Pre-reset refresh failed:', err);
            ysShowError('Could not load your data from the server. Please try again.');
            return;
        }
        await ysDownloadExcel();
        const del = await supabaseClient.from('ys_scans').delete().eq('user_id', AppState.user.id);
        if (del.error) {
            console.error('Clear server scans failed:', del.error);
            ysShowError('Could not clear your server data. Please try again.');
            return;
        }
        await ysDbClearStore(YS_SCANS_STORE);
    }
    clearYsSession();
    setActiveSession('yearSegregate', false);
    ysShowScreen('ysSessionScreen');
    updateBackButton();
}

function ysCancelReset() {
    document.getElementById('ysResetModal').classList.remove('active');
}

// ============================================
// UI HELPERS
// ============================================
function ysShowScreen(screenId) {
    document.querySelectorAll('#yearSegregateApp .scanner-screen').forEach(s => {
        s.classList.remove('active');
        s.style.display = 'none';
    });
    const target = document.getElementById(screenId);
    if (target) {
        target.classList.add('active');
        target.style.display = 'block';
    }
}

// ============================================
// VOICE SYSTEM
// ============================================
var ysVoiceLang = 'off';
const YS_VOICE_LANGS  = ['off', 'hi', 'bn', 'ar'];
const YS_LANG_CODES   = { hi: 'hi-IN', bn: 'bn-BD', ar: 'ar-SA' };
const YS_LANG_LABELS  = { off: '🌐 Off', hi: '🇮🇳 हिं', bn: '🇧🇩 বাং', ar: '🇸🇦 عر' };

const YS_VOICE_MAP = {
    hi: {
        notFound:      'गलत बारकोड, सुपरवाइज़र को बताएं।',
        notConfigured: 'गलत बारकोड, सुपरवाइज़र को बताएं।',
        wrongBox:      'गलत बॉक्स ID',
        duplicateBox:  'डुप्लिकेट बॉक्स ID',
        itemAsBox:     'आइटम का बारकोड स्कैन करें, बॉक्स ID नहीं।'
    },
    bn: {
        notFound:      'ভুল বারকোড, সুপারভাইজারকে জানান।',
        notConfigured: 'ভুল বারকোড, সুপারভাইজারকে জানান।',
        wrongBox:      'ভুল বক্স আইডি',
        duplicateBox:  'ডুপ্লিকেট বক্স আইডি',
        itemAsBox:     'বক্স আইডি নয়, বরং আইটেমের বারকোড স্ক্যান করুন।'
    },
    ar: {
        notFound:      'باركود خاطئ، أخبر المشرف.',
        notConfigured: 'باركود خاطئ، أخبر المشرف.',
        wrongBox:      'معرف الصندوق خاطئ',
        duplicateBox:  'معرف الصندوق مكرر',
        itemAsBox:     'امسح باركود العنصر وليس معرف الصندوق.'
    }
};

function ysVoice(key) {
    if (ysVoiceLang === 'off' || !window.speechSynthesis) return;
    const text = (YS_VOICE_MAP[ysVoiceLang] || {})[key];
    if (!text) return;
    const langCode = YS_LANG_CODES[ysVoiceLang];
    const langPrefix = langCode.split('-')[0];

    function speak() {
        const utt = new SpeechSynthesisUtterance(text);
        utt.lang = langCode;
        utt.rate = 0.88;
        const voices = speechSynthesis.getVoices();
        if (voices.length > 0) {
            const voice = voices.find(v => v.lang === langCode)
                       || voices.find(v => v.lang.startsWith(langPrefix));
            if (voice) utt.voice = voice;
        }
        speechSynthesis.cancel();
        speechSynthesis.speak(utt);
    }

    // Voices load asynchronously on Android — wait if not ready yet
    if (speechSynthesis.getVoices().length === 0) {
        speechSynthesis.onvoiceschanged = function() {
            speechSynthesis.onvoiceschanged = null;
            speak();
        };
    } else {
        speak();
    }
}

function ysCycleVoiceLang() {
    const idx = YS_VOICE_LANGS.indexOf(ysVoiceLang);
    ysVoiceLang = YS_VOICE_LANGS[(idx + 1) % YS_VOICE_LANGS.length];
    const btn = document.getElementById('ysVoiceLangBtn');
    if (btn) {
        btn.textContent = YS_LANG_LABELS[ysVoiceLang];
        btn.classList.toggle('active', ysVoiceLang !== 'off');
    }
}

const YS_ICON_MAP = {
    idle: 'ysIconIdle', waiting: 'ysIconWaiting', st: 'ysIconSt',
    box: 'ysIconBox', match: 'ysIconMatch', close: 'ysIconClose', error: 'ysIconError'
};
const YS_ICON_IDS = Object.values(YS_ICON_MAP);

function ysSetResult(type, ptl, label, sub) {
    const card = document.getElementById('ysResultCard');
    card.className = 'ys-result-card' + (type !== 'idle' ? ` ${type}` : '');
    document.getElementById('ysResultPtl').textContent = ptl;
    document.getElementById('ysResultLabel').textContent = label;
    document.getElementById('ysResultSub').textContent = sub;
    const activeId = YS_ICON_MAP[type] || 'ysIconIdle';
    YS_ICON_IDS.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = (id === activeId) ? '' : 'none';
    });
}

function ysSetInputLabel(text) {
    document.getElementById('ysInputLabel').textContent = text;
}

function ysShowError(msg) {
    document.getElementById('ysErrorMsg').textContent = msg;
    document.getElementById('ysErrorModal').classList.add('active');
}

function ysRenderHuPanel() {
    const panel = document.getElementById('ysHuPanel');
    if (!YSState.huStates.length) {
        panel.innerHTML = '<p style="color:var(--ak-text-light);text-align:center;padding:12px;">No HU configuration loaded</p>';
        return;
    }
    const pendingPtl = (YSState.pendingHuIdx !== null && YSState.pendingHuIdx !== undefined)
        ? (YSState.huStates[YSState.pendingHuIdx] || {}).ptlNumber || null
        : null;

    panel.innerHTML = YSState.huStates.map((hu) => {
        const statusClass = hu.status === 'Open' ? 'open' : hu.status === 'Closed' ? 'closed-session' : '';
        const isActivePending = pendingPtl === hu.ptlNumber &&
            ['st_wait', 'box_id_capture', 'item_rescan', 'box_confirm'].includes(YSState.scanStep);
        const pendingClass = isActivePending ? ' pending' : '';
        const boxLine = hu.status === 'Open' && hu.boxBarcode
            ? `<div class="ys-hu-cell-box">${hu.boxBarcode}</div>` : '';
        if (hu.status === 'Empty') {
            const isStWait = pendingPtl === hu.ptlNumber && YSState.scanStep === 'st_wait';
            if (isStWait) {
                return `<div class="ys-hu-cell pending" data-ptl="${hu.ptlNumber}">
                    <div class="ys-hu-cell-num">${hu.ptlNumber}</div>
                    <div class="ys-hu-cell-info">
                        <div class="ys-hu-cell-cfg">${huLabel(hu)}</div>
                    </div>
                </div>`;
            }
            return `<div class="ys-hu-cell ys-hu-cell-ghost" data-ptl="${hu.ptlNumber}">
                <div class="ys-hu-cell-num">${hu.ptlNumber}</div>
            </div>`;
        }
        return `<div class="ys-hu-cell ${statusClass}${pendingClass}" data-ptl="${hu.ptlNumber}">
            <div class="ys-hu-cell-num">${hu.ptlNumber}</div>
            <div class="ys-hu-cell-info">
                <div class="ys-hu-cell-cfg">${huLabel(hu)}</div>
                ${boxLine}
            </div>
        </div>`;
    }).join('');
}

function ysUpdateStats() {
    document.getElementById('ysStatOpen').textContent = YSState.huStates.filter(h => h.status === 'Open').length;
    document.getElementById('ysStatClosed').textContent = YSState.huStates.filter(h => h.status === 'Closed').length;
}

async function ysUpdateTotalStat() {
    const all = await ysDbGetAll(YS_SCANS_STORE);
    // Total qty = count of all scan records
    document.getElementById('ysStatQtys').textContent = all.reduce((s, r) => s + (r.qty || 1), 0);
    // Distinct closed boxes = unique ptlNumber+boxBarcode pairs with boxStatus Closed
    const closedBoxes = new Set(
        all.filter(s => s.boxStatus === 'Closed').map(s => `${s.ptlNumber}_${s.boxBarcode}`)
    );
    document.getElementById('ysStatBoxClosed').textContent = closedBoxes.size;
    ysUpdateSyncBadge(all);
}

function ysLastUploadKey() { return 'last_upload_ys_' + (AppState.user ? AppState.user.id : ''); }

// One plain-words line: all uploaded / waiting / offline / stuck (and why).
function ysUpdateSyncLine(pendingScans) {
    const el = document.getElementById('ysSyncStatusLine');
    if (!el || !AppState.user) return;
    const oldest = pendingScans.reduce((m, s) => Math.min(m, s.pendingSince || Date.now()), Infinity);
    SyncStatus.render(el, {
        pending: pendingScans.length, oldestMs: isFinite(oldest) ? oldest : 0, online: AppState.isOnline,
        lastOkMs: Number(Storage.get(ysLastUploadKey()) || 0), lastError: YSState.lastSyncError, noun: 'items'
    });
}

function ysUpdateSyncBadge(scans) {
    if (!scans) {
        ysDbGetAll(YS_SCANS_STORE).then(all => ysUpdateSyncBadge(all));
        return;
    }
    const pendingScans = scans.filter(s => !s.synced && s.boxStatus === 'Closed');
    const pending = pendingScans.length;
    ysUpdateSyncLine(pendingScans);
    const badge = document.getElementById('ysSyncBadge');
    if (pending === 0) {
        badge.textContent = '✓';
        badge.className = 'sync-badge synced';
    } else {
        badge.textContent = pending;
        badge.className = 'sync-badge pending';
    }
}

// ============================================
// PTL DETAIL POPUP
// ============================================
async function ysShowPtlDetail(ptlNumber) {
    const hu = YSState.huStates.find(h => h.ptlNumber === ptlNumber);
    if (!hu) return;

    const modal = document.getElementById('ysPtlDetailModal');
    const title = document.getElementById('ysPtlDetailTitle');
    const body  = document.getElementById('ysPtlDetailBody');
    const resetBtn = document.getElementById('ysPtlResetEmptyBtn');

    title.textContent = `PTL ${hu.ptlNumber} — ${huLabel(hu)}`;
    resetBtn.style.display = 'none';

    // Orphaned: Open but no box barcode (interrupted mid-creation)
    if (hu.status === 'Open' && !hu.boxBarcode) {
        body.innerHTML = `
            <p style="color:#e65100;font-weight:600;">⚠ Box not registered</p>
            <p style="margin-top:6px;color:var(--ak-text-light);font-size:14px;">
                ST${hu.ptlNumber} was scanned but the session was interrupted before the box barcode was registered.
                No items were saved to this box.
            </p>`;
        resetBtn.style.display = 'inline-block';
        resetBtn.onclick = () => {
            hu.status = 'Empty';
            hu.boxBarcode = null;
            hu.itemCount = 0;
            if (YSState.pendingHuIdx === YSState.huStates.indexOf(hu)) {
                YSState.pendingHuIdx = null;
                YSState.pendingItem = null;
                YSState.scanStep = 'item';
            }
            saveYsSession();
            ysRenderHuPanel();
            ysSyncModeLock();
            modal.classList.remove('active');
            ysSetResult('idle', '—', 'Scan an item to begin', '');
            ysSetInputLabel('Scan Barcode');
        };
        modal.classList.add('active');
        return;
    }

    if (hu.status === 'Empty') {
        body.innerHTML = `<p style="color:var(--ak-text-light);text-align:center;padding:8px 0;">This PTL has no active box.</p>`;
        modal.classList.add('active');
        return;
    }

    // Open or Closed — load scans from IndexedDB
    const allScans = await ysDbGetAll(YS_SCANS_STORE);
    const boxScans = allScans.filter(s => s.ptlNumber === ptlNumber && s.boxBarcode === hu.boxBarcode);

    // Group by barcode
    const grouped = {};
    boxScans.forEach(s => {
        if (!grouped[s.barcode]) grouped[s.barcode] = { barcode: s.barcode, brand: s.brand, qty: 0 };
        grouped[s.barcode].qty += (s.qty || 1);
    });
    const items = Object.values(grouped);
    const totalQty = items.reduce((sum, r) => sum + r.qty, 0);

    const statusBadge = hu.status === 'Open'
        ? `<span style="color:#e65100;font-weight:700;">● Open</span>`
        : `<span style="color:#2e7d32;font-weight:700;">✓ Closed</span>`;

    const rowsHtml = items.length
        ? items.map(r => `
            <div style="display:flex;justify-content:space-between;align-items:center;padding:5px 0;border-bottom:1px solid var(--ak-gray-200);font-size:13px;">
                <div>
                    <div style="font-weight:600;font-family:monospace;">${r.barcode}</div>
                    <div style="color:var(--ak-text-light);font-size:11px;">${r.brand || '—'}</div>
                </div>
                <div style="font-weight:700;font-size:16px;color:var(--ak-maroon);">×${r.qty}</div>
            </div>`).join('')
        : `<p style="color:var(--ak-text-light);font-size:13px;text-align:center;">No items scanned yet.</p>`;

    body.innerHTML = `
        <div style="display:flex;justify-content:space-between;margin-bottom:10px;font-size:13px;">
            <span>Status: ${statusBadge}</span>
            <span style="color:var(--ak-text-light);">Box: <strong>${hu.boxBarcode || '—'}</strong></span>
        </div>
        <div style="font-weight:700;margin-bottom:8px;font-size:14px;">
            ${totalQty} item${totalQty !== 1 ? 's' : ''} (${items.length} SKU${items.length !== 1 ? 's' : ''})
        </div>
        <div style="max-height:240px;overflow-y:auto;">${rowsHtml}</div>`;

    modal.classList.add('active');
}

// ============================================
// ITEM MASTER COUNT DISPLAY
// ============================================
async function ysUpdateImCount() {
    const all = await ysDbGetAll(YS_ITEMS_STORE);
    const el = document.getElementById('ysImCount');
    if (!el) return;
    if (all.length === 0) {
        el.textContent = 'No items synced';
        el.className = 'ys-im-count';
    } else {
        el.textContent = `${all.length} items`;
        el.className = 'ys-im-count synced';
    }
}

async function ysRefreshItemMaster() {
    if (!AppState.isOnline) {
        ysShowError('No internet connection. Cannot refresh data.');
        return;
    }
    const btn = document.getElementById('ysImSyncBtn');
    const el = document.getElementById('ysImCount');
    btn.classList.add('spinning');
    el.textContent = 'Syncing…';
    el.className = 'ys-im-count syncing';

    const [imOk, huOk] = await Promise.all([
        syncItemMaster((p) => { el.textContent = `Syncing… ${Math.round(p)}%`; }, true),
        syncHuConfig(true)
    ]);

    if (huOk) {
        buildHuStates();
        ysRenderHuPanel();
        ysUpdateStats();
    }

    btn.classList.remove('spinning');
    if (imOk && huOk) {
        await ysUpdateImCount();
    } else if (imOk) {
        await ysUpdateImCount();
        ysShowError('Item Master synced but HU Config sync failed. PTL config may be stale.');
    } else if (huOk) {
        el.textContent = 'IM sync failed';
        el.className = 'ys-im-count';
        ysShowError('HU Config synced but Item Master sync failed.');
    } else {
        el.textContent = 'Sync failed';
        el.className = 'ys-im-count';
        ysShowError('Could not sync the item master and PTL config. Check your connection.');
    }
}

// ============================================
// INPUT MODE (Nu / AlNu)
// ============================================
function ysGuardModeToggle(e) {
    const openPtls = YSState.huStates.filter(h => h.status === 'Open').map(h => 'PTL ' + h.ptlNumber);
    if (openPtls.length > 0) {
        e.preventDefault();
        ysShowError(`Cannot switch mode — ${openPtls.join(', ')} still open. Close all boxes before changing Nu/AlNu mode.`);
    }
}

function ysSetInputMode(mode) {
    YSState.inputMode = mode;
    document.getElementById('ysNuBtn').checked = mode === 'Nu';
    document.getElementById('ysAlNuBtn').checked = mode === 'AlNu';
    document.getElementById('ysModeLock').classList.toggle('locked', YSState.huStates.some(h => h.status === 'Open'));
    saveYsSession();
}

function ysSyncModeLock() {
    document.getElementById('ysModeLock').classList.toggle('locked', YSState.huStates.some(h => h.status === 'Open'));
}

function ysToggleKeyboard() {
    const input = document.getElementById('ysBarcodeInput');
    const btn = document.getElementById('ysKbdBtn');
    if (btn.classList.contains('active')) {
        input.inputMode = 'none';
        btn.classList.remove('active');
    } else {
        input.removeAttribute('readonly');
        input.inputMode = 'text';
        btn.classList.add('active');
        input.focus();
    }
}

// ============================================
// SESSION START
// ============================================
async function ysStartSession() {
    const staff = document.getElementById('ysStaffInput').value.trim();
    const remark = document.getElementById('ysRemarkInput').value.trim();

    if (!staff) { alert('Please enter your name.'); document.getElementById('ysStaffInput').focus(); return; }
    if (!remark) { alert('Please enter a remark.'); document.getElementById('ysRemarkInput').focus(); return; }

    YSState.staffName = staff;
    YSState.remark = remark;

    // Show sync status
    const syncStatus = document.getElementById('ysSyncStatus');
    const syncError = document.getElementById('ysSyncError');
    const startBtn = document.getElementById('ysStartSessionBtn');
    syncStatus.style.display = 'flex';
    syncError.style.display = 'none';
    startBtn.disabled = true;

    const hasCachedHu = loadCachedHuConfig();
    const cachedItemCount = hasCachedHu ? await ysDbCount(YS_ITEMS_STORE) : 0;
    const hasCache = hasCachedHu && cachedItemCount > 0;

    if (!AppState.isOnline) {
        syncStatus.style.display = 'none';
        startBtn.disabled = false;
        if (!hasCache) {
            syncError.textContent = 'No internet and no cached data. Connect and try again.';
            syncError.style.display = 'block';
            return;
        }
    } else if (hasCache) {
        // Cache already populated — skip auto-sync. Use ↻ to refresh manually.
        syncStatus.style.display = 'none';
        startBtn.disabled = false;
    } else {
        // First launch or cache cleared — must sync
        const syncMsg = document.getElementById('ysSyncMsg');
        syncMsg.textContent = 'Syncing PTL configuration… (1/2)';
        const huOk = await syncHuConfig();

        syncMsg.textContent = 'Downloading item master… 0%';
        const bar = document.getElementById('ysSyncBar');
        bar.style.display = 'block';
        const imOk = await syncItemMaster((pct) => {
            syncMsg.textContent = `Downloading item master… ${Math.round(pct)}%`;
            bar.firstChild.style.width = Math.round(pct) + '%';
        });
        bar.style.display = 'none';

        syncStatus.style.display = 'none';
        startBtn.disabled = false;

        if (!huOk || !imOk) {
            if (!loadCachedHuConfig()) {
                syncError.textContent = 'Could not load the item master / PTL config. Ask your admin to upload them, or check your connection.';
                syncError.style.display = 'block';
                return;
            }
            syncError.textContent = 'Using cached data (live sync failed). Proceed with caution.';
            syncError.style.display = 'block';
        }
    }

    // Build/restore HU states
    loadYsHuStates();
    buildHuStates();

    // Update UI
    document.getElementById('ysDispStore').textContent = `${AppState.storeId} - ${AppState.storeName}`;
    document.getElementById('ysDispStaff').textContent = YSState.staffName;

    setActiveSession('yearSegregate', true);
    saveYsSession();

    ysShowScreen('ysScanScreen');
    ysRenderHuPanel();
    ysUpdateStats();
    await ysUpdateTotalStat();
    await ysUpdateImCount();
    updateBackButton();
    document.getElementById('ysBarcodeInput').focus();
}

// ============================================
// EVENT LISTENERS
// ============================================
function setupYsEventListeners() {
    document.getElementById('ysStartSessionBtn').addEventListener('click', ysStartSession);
    document.getElementById('ysBarcodeInput').addEventListener('keypress', handleYsScan);

    document.getElementById('ysNuBtn').addEventListener('click', ysGuardModeToggle);
    document.getElementById('ysAlNuBtn').addEventListener('click', ysGuardModeToggle);
    document.getElementById('ysNuBtn').addEventListener('change', () => ysSetInputMode('Nu'));
    document.getElementById('ysAlNuBtn').addEventListener('change', () => ysSetInputMode('AlNu'));
    document.getElementById('ysKbdBtn').addEventListener('click', ysToggleKeyboard);
    document.getElementById('ysImSyncBtn').addEventListener('click', ysRefreshItemMaster);

    // Close box modal
    document.getElementById('ysCloseYesBtn').addEventListener('click', ysCloseBoxProceedToScan);
    document.getElementById('ysCloseCancelBtn').addEventListener('click', ysCancelClose);
    document.getElementById('ysCloseBackBtn').addEventListener('click', ysCancelClose);
    document.getElementById('ysCloseBoxInput').addEventListener('keypress', ysHandleCloseBoxConfirmScan);

    // Reset modal
    document.getElementById('ysResetBtn').addEventListener('click', ysShowResetModal);
    document.getElementById('ysResetConfirmBtn').addEventListener('click', ysExecuteReset);
    document.getElementById('ysResetCancelBtn').addEventListener('click', ysCancelReset);

    // Error modal
    document.getElementById('ysErrorOkBtn').addEventListener('click', () => {
        document.getElementById('ysErrorModal').classList.remove('active');
        document.getElementById('ysBarcodeInput').focus();
    });

    // Download
    document.getElementById('ysDownloadBtn').addEventListener('click', ysDownloadExcel);
    document.getElementById('ysSyncStatusLine').addEventListener('click', (e) => {
        if (e.currentTarget.classList.contains('tappable') && AppState.isOnline) ysAutoSync();      // tap to retry now
    });
    window.addEventListener('online', () => ysUpdateSyncBadge());
    window.addEventListener('offline', () => ysUpdateSyncBadge());

    // PTL cell click → detail popup
    document.getElementById('ysHuPanel').addEventListener('click', (e) => {
        const cell = e.target.closest('.ys-hu-cell');
        if (!cell) return;
        const ptl = cell.dataset.ptl;
        if (ptl) ysShowPtlDetail(ptl);
    });
    document.getElementById('ysPtlDetailCloseBtn').addEventListener('click', () => {
        document.getElementById('ysPtlDetailModal').classList.remove('active');
    });
    document.getElementById('ysPtlDetailModal').addEventListener('click', (e) => {
        if (e.target === document.getElementById('ysPtlDetailModal'))
            document.getElementById('ysPtlDetailModal').classList.remove('active');
    });

    // Dismiss modals on overlay click
    ['ysCloseModal', 'ysResetModal', 'ysErrorModal'].forEach(id => {
        document.getElementById(id).addEventListener('click', (e) => {
            if (e.target === document.getElementById(id)) {
                document.getElementById(id).classList.remove('active');
                if (id === 'ysCloseModal') { ysCancelClose(); }
            }
        });
    });
}

// ============================================
// INITIALIZATION
// ============================================
async function initYearSegregate() {
    if (YSState.initialized) {
        // A different account on the same device gets its own database.
        await initYsDB();
        await refOpenDB();
        ysSetupUploadButtons();
        // Already set up — just restore screen state
        const hasSession = loadYsSession();
        if (hasSession) {
            loadYsHuStates();
            loadCachedHuConfig();
            if (YSState.huConfig.length) buildHuStates();
            document.getElementById('ysDispStore').textContent = `${AppState.storeId} - ${AppState.storeName}`;
            document.getElementById('ysDispStaff').textContent = YSState.staffName;
            ysShowScreen('ysScanScreen');
            ysRenderHuPanel();
            ysUpdateStats();
            await ysUpdateTotalStat();
    await ysUpdateImCount();
            document.getElementById('ysBarcodeInput').focus();
        } else {
            ysShowScreen('ysSessionScreen');
        }
        return;
    }

    await initYsDB();
    await refOpenDB();
    await ysBackfillScanUids();
    setupYsEventListeners();
    ysSetupUploadButtons();
    YSState.initialized = true;

    const hasSession = loadYsSession();
    if (hasSession && YSState.staffName) {
        loadYsHuStates();
        loadCachedHuConfig();
        if (YSState.huConfig.length) buildHuStates();
        document.getElementById('ysDispStore').textContent = `${AppState.storeId} - ${AppState.storeName}`;
        document.getElementById('ysDispStaff').textContent = YSState.staffName;
        setActiveSession('yearSegregate', true);
        ysShowScreen('ysScanScreen');
        ysRenderHuPanel();
        ysUpdateStats();
        await ysUpdateTotalStat();
    await ysUpdateImCount();
        updateBackButton();
        document.getElementById('ysBarcodeInput').focus();
    } else {
        ysShowScreen('ysSessionScreen');
    }

    // Background sync interval — same pattern as Box Scanner.
    // This init runs every time the app tile is opened (js/app.js), so clear any
    // interval from a previous open instead of stacking up a new one each time.
    if (YSState.syncIntervalId) {
        clearInterval(YSState.syncIntervalId);
        YSState.syncIntervalId = null;
    }
    const syncOffset = Math.random() * 10000;
    setTimeout(() => {
        if (YSState.syncIntervalId) clearInterval(YSState.syncIntervalId);
        YSState.syncIntervalId = setInterval(async () => {
            if (AppState.isOnline && YSState.staffName) await ysAutoSync();
            ysUpdateSyncBadge();                      // keeps "x min ago" fresh
        }, 10000);
    }, syncOffset);
}
