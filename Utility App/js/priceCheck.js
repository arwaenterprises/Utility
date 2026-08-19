// ============================================
// PRICE CHECK MODULE
// ============================================
const PC_SHEET_URL = 'https://docs.google.com/spreadsheets/d/1lI4oXU5Riy6XzhqLq_eV9vc8XaAY0EMj-BNGCpVuG9k/pub?gid=0&single=true&output=csv';
const PC_TS_KEY    = 'price_check_ts';
const PC_COUNT_KEY = 'price_check_count';
const PC_DB_NAME   = 'AKPriceCheckDB';
const PC_STORE     = 'prices';

let pcDb = null;
let pcListenerAdded = false;
let pcHtml5Qr = null;
let pcCameraActive = false;

// ============================================
// INDEXEDDB
// ============================================
function openPcDb() {
    if (pcDb) return Promise.resolve(pcDb);
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(PC_DB_NAME, 1);
        req.onupgradeneeded = function(e) {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(PC_STORE)) {
                db.createObjectStore(PC_STORE, { keyPath: 'Barcode' });
            }
        };
        req.onsuccess = function(e) { pcDb = e.target.result; resolve(pcDb); };
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

function pcDbStoreAll(rows) {
    return openPcDb().then(function(db) {
        return new Promise(function(resolve, reject) {
            const tx    = db.transaction(PC_STORE, 'readwrite');
            const store = tx.objectStore(PC_STORE);
            store.clear();
            rows.forEach(function(r) { store.put(r); });
            tx.oncomplete = resolve;
            tx.onerror    = reject;
        });
    });
}

// ============================================
// INIT
// ============================================
async function initPriceCheck() {
    await openPcDb();
    updatePcTimestamp();

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
async function togglePcCamera() {
    if (pcCameraActive) { stopPcCamera(); return; }
    if (typeof Html5Qrcode === 'undefined') {
        alert('Scanner library not loaded yet — please wait a moment and try again.');
        return;
    }
    const camBtn = document.getElementById('pcCamBtn');
    camBtn.classList.add('active');
    camBtn.textContent = '✕';
    document.getElementById('pcCamOverlay').style.display = 'block';
    pcCameraActive = true;

    try {
        pcHtml5Qr = new Html5Qrcode('pcQrReader');
        await pcHtml5Qr.start(
            { facingMode: 'environment' },
            { fps: 10, qrbox: { width: 240, height: 120 } },
            function(decodedText) {
                document.getElementById('pcBarcodeInput').value = decodedText;
                stopPcCamera();
                lookupPriceCheck();
            }
        );
    } catch (err) {
        alert('Camera error: ' + err);
        stopPcCamera();
    }
}

async function stopPcCamera() {
    if (pcHtml5Qr) {
        try { await pcHtml5Qr.stop(); pcHtml5Qr.clear(); } catch(e) {}
        pcHtml5Qr = null;
    }
    pcCameraActive = false;
    document.getElementById('pcCamOverlay').style.display = 'none';
    const camBtn = document.getElementById('pcCamBtn');
    if (camBtn) { camBtn.classList.remove('active'); camBtn.textContent = '📷'; }
}

// ============================================
// LOOKUP
// ============================================
async function lookupPriceCheck() {
    const input   = document.getElementById('pcBarcodeInput');
    const barcode = input.value.trim();
    if (!barcode) return;

    const row = await pcDbGet(barcode);
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
// SYNC FROM SHEETS
// ============================================
async function refreshPcData(silent) {
    silent = silent === true;

    if (!navigator.onLine) {
        if (!silent) alert('You are offline. Using cached data.');
        return;
    }

    const btn = document.getElementById('pcRefreshBtn');
    if (btn) { btn.textContent = '⏳ Syncing...'; btn.disabled = true; }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    try {
        const resp = await fetch(CONFIG.PC_SCRIPT_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain' },
            body: JSON.stringify({ action: 'getPriceCsv' }),
            signal: controller.signal
        });

        if (!resp.ok) throw new Error('HTTP ' + resp.status);

        const text = await resp.text();
        const rows = parsePcCsv(text);

        await pcDbStoreAll(rows);

        Storage.set(PC_TS_KEY,    new Date().toLocaleString());
        Storage.set(PC_COUNT_KEY, String(rows.length));
        updatePcTimestamp();

        if (!silent) alert('✅ Synced — ' + rows.length + ' items loaded.');
    } catch (err) {
        if (!silent) {
            const isLocal = location.protocol === 'file:';
            alert(isLocal
                ? 'Sync blocked — open the app via Netlify, not as a local file.'
                : 'Sync failed: ' + err.message);
        }
    } finally {
        clearTimeout(timeout);
        if (btn) { btn.textContent = '↻ Sync Data'; btn.disabled = false; }
    }
}

// ============================================
// CSV PARSER (same as boxSegregate)
// ============================================
function parsePcCsv(text) {
    const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    if (lines.length < 2) return [];
    const headers = parsePcCsvLine(lines[0]).map(function(h) {
        return h.trim().replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_]/g, '');
    });
    const rows = [];
    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        const vals = parsePcCsvLine(line);
        const obj  = {};
        headers.forEach(function(h, idx) { obj[h] = (vals[idx] || '').trim(); });
        if (obj.Barcode) rows.push(obj);
    }
    return rows;
}

function parsePcCsvLine(line) {
    const result = [];
    let cur = '', inQuote = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
            if (inQuote && line[i + 1] === '"') { cur += '"'; i++; }
            else { inQuote = !inQuote; }
        } else if (ch === ',' && !inQuote) {
            result.push(cur); cur = '';
        } else { cur += ch; }
    }
    result.push(cur);
    return result;
}

// ============================================
// TIMESTAMP
// ============================================
function updatePcTimestamp() {
    const ts    = Storage.get(PC_TS_KEY);
    const count = Storage.get(PC_COUNT_KEY) || '0';
    const el    = document.getElementById('pcTimestamp');
    if (!el) return;
    if (ts) { el.innerHTML = count + ' items<br>' + ts; }
    else    { el.textContent = 'No data — tap Sync'; }
}

