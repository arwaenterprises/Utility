// ============================================
// PRICE CHECK MODULE
// ============================================
const PC_DB_PREFIX = 'AKPriceCheckDB_';   // one lookup database per signed-in user
const PC_STORE     = 'prices';

let pcDb = null;
let pcDbName = null;
let pcListenerAdded = false;

// ============================================
// INDEXEDDB
// ============================================
function openPcDb() {
    const name = PC_DB_PREFIX + AppState.user.id;
    if (pcDb && pcDbName === name) return Promise.resolve(pcDb);
    if (pcDb) { pcDb.close(); pcDb = null; }
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(name, 1);
        req.onupgradeneeded = function(e) {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(PC_STORE)) {
                db.createObjectStore(PC_STORE, { keyPath: 'Barcode' });
            }
        };
        req.onsuccess = function(e) { pcDb = e.target.result; pcDbName = name; resolve(pcDb); };
        req.onerror   = function(e) { reject(e.target.error); };
    });
}

function pcDbGet(barcode) {
    return openPcDb().then(function(db) {
        return new Promise(function(resolve, reject) {
            const req = db.transaction(PC_STORE, 'readonly')
                          .objectStore(PC_STORE)
                          .get(String(barcode));
            req.onsuccess = function() { resolve(req.result || null); };
            req.onerror   = function() { resolve(null); };
        });
    });
}

// Replaces the whole lookup table. Written in chunks so a very large price list
// can report progress (onProgress receives 0..1).
async function pcDbStoreAll(rows, onProgress) {
    const db = await openPcDb();
    const run = function(fn) {
        return new Promise(function(resolve, reject) {
            const tx = db.transaction(PC_STORE, 'readwrite');
            fn(tx.objectStore(PC_STORE));
            tx.oncomplete = resolve;
            tx.onerror    = function() { reject(tx.error); };
            tx.onabort    = function() { reject(tx.error); };
        });
    };
    await run(function(store) { store.clear(); });
    const CHUNK = 5000;
    for (let i = 0; i < rows.length; i += CHUNK) {
        const part = rows.slice(i, i + CHUNK);
        await run(function(store) { part.forEach(function(r) { store.put(r); }); });
        if (onProgress) onProgress(Math.min(i + CHUNK, rows.length) / rows.length);
    }
    if (onProgress) onProgress(1);
}

// ============================================
// INIT
// ============================================
async function initPriceCheck() {
    await openPcDb();
    await refOpenDB();
    document.getElementById('pcUploadBtn').style.display = refCanUpload() ? '' : 'none';
    document.getElementById('pcTemplateBtn').style.display = refCanUpload() ? '' : 'none';
    await updatePcTimestamp();

    if (!pcListenerAdded) {
        const input = document.getElementById('pcBarcodeInput');
        input.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                lookupPriceCheck();
                resetPcKeyboard();
            }
        });
        input.addEventListener('blur', resetPcKeyboard);
        pcListenerAdded = true;
    }

    document.getElementById('pcResultCard').style.display = 'none';
    document.getElementById('pcNotFound').style.display   = 'none';
    setTimeout(function() { document.getElementById('pcBarcodeInput').focus(); }, 150);

    // Check for a newer list once a day (or when this device has never downloaded it).
    if (navigator.onLine && await refIsStale('price_list')) pcSyncList(true);
}

// ============================================
// KEYBOARD TOGGLE
// ============================================
function togglePcKeyboard() {
    const input = document.getElementById('pcBarcodeInput');
    const btn   = document.getElementById('pcKbdBtn');
    input.removeAttribute('readonly');
    input.inputMode = 'text';
    input.classList.add('bs-kbd-active');
    btn.classList.add('active');
    input.focus();
}

function resetPcKeyboard() {
    const input = document.getElementById('pcBarcodeInput');
    const btn   = document.getElementById('pcKbdBtn');
    input.inputMode = 'none';
    input.classList.remove('bs-kbd-active');
    if (btn) btn.classList.remove('active');
}

// ============================================
// CAMERA
// ============================================
// The camera stays open and keeps scanning (js/camera.js); each new code is looked up and shown under the camera.
const pcCamera = Camera.create({
    btnId: 'pcCamBtn', overlayId: 'pcCamOverlay', readerId: 'pcQrReader', torchBtnId: 'pcTorchBtn',
    onCode: (text) => { document.getElementById('pcBarcodeInput').value = text; lookupPriceCheck(); }
});
function togglePcCamera() { return pcCamera.toggle(); }
function stopPcCamera() { return pcCamera.stop(); }

// ============================================
// LOOKUP
// ============================================
async function lookupPriceCheck() {
    const input   = document.getElementById('pcBarcodeInput');
    const barcode = input.value.trim();
    if (!barcode) return;

    const row = await pcDbGet(barcode);
    Usage.log('price_check', row ? 'lookup_found' : 'lookup_not_found', 1, 0);
    if (row) showPcResult(row);
    else     showPcNotFound(barcode);

    input.select();
}

function showPcResult(row) {
    const currentPrice = (row.Current_Price !== undefined && row.Current_Price !== null && String(row.Current_Price).trim() !== '')
        ? escapeHtml(String(row.Current_Price)) : '—';

    document.getElementById('pcResultCard').innerHTML =
        '<div class="pc-price-highlight">' +
            '<span class="pc-label">Current Price</span>' +
            '<span class="pc-current-price">' + currentPrice + '</span>' +
        '</div>' +
        '<div class="pc-fields">' +
            pcField('Original Price', row.Original_Price) +
            pcField('Style',          row.Style) +
            pcField('Color',          row.Color) +
            pcField('Size',           row.Size) +
            pcField('Year',           row.Year) +
            pcField('Season',         row.Season) +
        '</div>' +
        '<div class="pc-scanned-bar">Barcode: ' + escapeHtml(row.Barcode) + '</div>';

    document.getElementById('pcResultCard').style.display = 'block';
    document.getElementById('pcNotFound').style.display   = 'none';
}

function pcField(label, value) {
    const display = (value !== undefined && value !== null && String(value).trim() !== '')
        ? escapeHtml(String(value))
        : '<span style="color:var(--ak-gray-300);font-style:italic;font-weight:400">—</span>';
    return '<div class="pc-field-row">' +
               '<span class="pc-field-label">' + label + '</span>' +
               '<span class="pc-field-val">' + display + '</span>' +
           '</div>';
}

function showPcNotFound(barcode) {
    document.getElementById('pcNotFound').innerHTML =
        '❌ Barcode not found<span>' + escapeHtml(barcode) + '</span>';
    document.getElementById('pcNotFound').style.display   = 'block';
    document.getElementById('pcResultCard').style.display = 'none';
}

// ============================================
// SYNC & UPLOAD (shared list code in js/lists.js, with % progress)
// ============================================
// The price list is owned per enterprise / individual account. The admin uploads it;
// every device copies it into its own lookup table below.
async function pcSaveRows(rows, onProgress) {
    const mapped = rows.map(function(r) {
        return {
            Barcode: String(r.barcode || '').trim(),
            Current_Price: r.current_price, Original_Price: r.original_price,
            Style: r.style, Color: r.color, Size: r.size, Year: r.year, Season: r.season
        };
    }).filter(function(r) { return r.Barcode; });
    await pcDbStoreAll(mapped, onProgress);
}

async function pcSyncList(silent) {
    const btn = document.getElementById('pcRefreshBtn');
    const progress = refProgress(btn, 'Syncing');
    try {
        const result = await refSync('price_list', {
            force: !silent,
            onProgress: function(p) { progress.update(p, 'Syncing'); },
            saveRows: pcSaveRows
        });
        await updatePcTimestamp();
        const meta = await refMetaGet('price_list');
        if (!silent) {
            if (result === 'offline') alert('You are offline. Using cached data.');
            else if (result === 'empty') alert('No price list has been uploaded yet.');
            else alert('✅ Synced — ' + (meta ? meta.count : 0) + ' items loaded.');
        }
    } catch (err) {
        console.error('Price Check sync failed:', err);
        if (!silent) alert('Sync failed: ' + (err.message || err));
    } finally {
        progress.done();
    }
}

function refreshPcData() { return pcSyncList(false); }

function uploadPcList() {
    refStartUpload('price_list', document.getElementById('pcUploadBtn'), function() { return pcSyncList(false); });
}

async function updatePcTimestamp() {
    const el = document.getElementById('pcTimestamp');
    if (!el) return;
    el.innerHTML = await refStatusText('price_list', 'items');
}
