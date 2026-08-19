// ============================================
// BOX SEGREGATE MODULE
// ============================================
const BS_SHEET_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQuSptPsV8PGAdrNKzrrQJN4l_PKOoqrrYTZ7Wf6wJXFcH5YOKCRWnyzmXvQ44d_fo1uWrWwD-a7oep/pub?gid=244472051&single=true&output=csv';
const BS_DATA_KEY  = 'segregate_data';
const BS_TS_KEY    = 'segregate_ts';

let bsMap = new Map();
let bsListenerAdded = false;
let bsHtml5Qr = null;
let bsCameraActive = false;
let bsIsLooking = false;

const BS_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

function initBoxSegregate() {
    buildBsMap(Storage.getJSON(BS_DATA_KEY) || []);
    updateBsTimestamp();

    if (!bsListenerAdded) {
        const input = document.getElementById('bsBarcodeInput');
        input.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') { e.preventDefault(); lookupSegregateBox(); resetBsKeyboard(); }
        });
        input.addEventListener('blur', resetBsKeyboard);
        bsListenerAdded = true;
    }

    if (navigator.onLine) {
        const lastSync = Storage.get(BS_TS_KEY);
        const isStale = !lastSync || (Date.now() - new Date(lastSync).getTime() > BS_TTL_MS);
        refreshBsFromSheets(!isStale); // silent if fresh, forced+visible if stale/missing
    }
    setTimeout(() => document.getElementById('bsBarcodeInput').focus(), 150);
}

function toggleBsKeyboard() {
    const input = document.getElementById('bsBarcodeInput');
    const btn = document.getElementById('bsKbdBtn');
    input.removeAttribute('readonly');
    input.inputMode = 'text';
    input.classList.add('bs-kbd-active');
    btn.classList.add('active');
    input.focus();
}

function resetBsKeyboard() {
    const input = document.getElementById('bsBarcodeInput');
    const btn = document.getElementById('bsKbdBtn');
    input.inputMode = 'none';
    input.classList.remove('bs-kbd-active');
    if (btn) btn.classList.remove('active');
}

async function toggleBsCamera() {
    if (bsCameraActive) { stopBsCamera(); return; }
    if (typeof Html5Qrcode === 'undefined') {
        alert('Scanner library not loaded yet — please wait a moment and try again.');
        return;
    }
    const camBtn = document.getElementById('bsCamBtn');
    camBtn.classList.add('active');
    camBtn.textContent = '✕';
    document.getElementById('bsCamOverlay').style.display = 'block';
    bsCameraActive = true;

    try {
        bsHtml5Qr = new Html5Qrcode('bsQrReader');
        await bsHtml5Qr.start(
            { facingMode: 'environment' },
            { fps: 10, qrbox: { width: 240, height: 120 } },
            function(decodedText) {
                document.getElementById('bsBarcodeInput').value = decodedText;
                stopBsCamera();
                lookupSegregateBox();
            }
        );
    } catch (err) {
        alert('Camera error: ' + err);
        stopBsCamera();
    }
}

async function stopBsCamera() {
    if (bsHtml5Qr) {
        try { await bsHtml5Qr.stop(); bsHtml5Qr.clear(); } catch(e) {}
        bsHtml5Qr = null;
    }
    bsCameraActive = false;
    document.getElementById('bsCamOverlay').style.display = 'none';
    const camBtn = document.getElementById('bsCamBtn');
    if (camBtn) { camBtn.classList.remove('active'); camBtn.textContent = '📷'; }
}

function buildBsMap(rows) {
    bsMap = new Map();
    rows.forEach(r => {
        const key = String(r.Box_Number || '').toLowerCase().trim();
        if (key) bsMap.set(key, r);
    });
}

function lookupSegregateBox() {
    if (bsIsLooking) return;
    const input = document.getElementById('bsBarcodeInput');
    const barcode = input.value.trim();
    if (!barcode) return;
    bsIsLooking = true;
    const row = bsMap.get(barcode.toLowerCase());
    if (row) showBsResult(row); else showBsNotFound(barcode);
    input.select();
    bsIsLooking = false;
}

function showBsResult(row) {
    const fields = [
        { label: 'TRN',              value: row.TRN },
        { label: 'Increff Order ID', value: row.Increff_OrderID },
        { label: 'Store Name',       value: row.Store_Name },
        { label: 'Region',           value: row.Region },
        { label: 'Store Code',       value: row.Store_Code },
        { label: 'Brand',            value: row.Brand }
    ];
    document.getElementById('bsResultCard').innerHTML =
        `<div class="bs-result-title">📦 ${escapeHtml(row.Box_Number || '')}</div>` +
        fields.map(f =>
            `<div class="bs-field">
                <span class="bs-label">${f.label}</span>
                <span class="bs-value${!f.value ? ' empty' : ''}">${f.value ? escapeHtml(String(f.value)) : '—'}</span>
            </div>`
        ).join('');
    document.getElementById('bsResultCard').style.display = 'block';
    document.getElementById('bsNotFound').style.display = 'none';
}

function showBsNotFound(barcode) {
    document.getElementById('bsNotFound').innerHTML =
        `❌ Box not found<span>${escapeHtml(barcode)}</span>`;
    document.getElementById('bsNotFound').style.display = 'block';
    document.getElementById('bsResultCard').style.display = 'none';
}

async function refreshBsFromSheets(silent = false) {
    if (!navigator.onLine) { if (!silent) alert('You are offline. Using cached data.'); return; }
    const btn = document.getElementById('bsRefreshBtn');
    if (btn) { btn.textContent = '⏳ Syncing...'; btn.disabled = true; }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
        const resp = await fetch(BS_SHEET_URL, { signal: controller.signal });
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        const rows = parseBsCsv(await resp.text());
        Storage.setJSON(BS_DATA_KEY, rows);
        Storage.set(BS_TS_KEY, new Date().toISOString());
        buildBsMap(rows);
        updateBsTimestamp();
        if (!silent) alert('✅ Synced — ' + rows.length + ' boxes loaded.');
    } catch (err) {
        if (!silent) {
            const isLocal = location.protocol === 'file:';
            alert(isLocal
                ? 'Sync blocked — browser blocks Google Sheets when opening as a local file.\nDeploy to Netlify and it will work automatically.'
                : 'Sync failed: ' + err.message);
        }
    } finally {
        clearTimeout(timeout);
        if (btn) { btn.textContent = '↻ Sync Data'; btn.disabled = false; }
    }
}

function parseBsCsv(text) {
    const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    if (lines.length < 2) return [];
    const headers = parseBsCsvLine(lines[0]).map(h =>
        h.trim().replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_]/g, '')
    );
    const rows = [];
    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        const vals = parseBsCsvLine(line);
        const obj = {};
        headers.forEach((h, idx) => { obj[h] = (vals[idx] || '').trim(); });
        if (obj.Box_Number) rows.push(obj);
    }
    return rows;
}

function parseBsCsvLine(line) {
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

function updateBsTimestamp() {
    const ts = Storage.get(BS_TS_KEY);
    const count = (Storage.getJSON(BS_DATA_KEY) || []).length;
    const el = document.getElementById('bsTimestamp');
    if (!el) return;
    if (ts) { el.innerHTML = count + ' boxes<br>' + ts; }
    else { el.textContent = count ? count + ' cached' : 'No data'; }
}

function escapeHtml(str) {
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
