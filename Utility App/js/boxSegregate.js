// ============================================
// BOX SEGREGATE MODULE
// ============================================
// Two modes, switched with the "Pallet" toggle:
//   Normal   - scan a box, see its details (TRN, store, region, ...) from the box list.
//   Pallet   - the uploaded document list says which store/document each box belongs to;
//              scan a box to see where to put it, duplicates are blocked, and a download
//              lists which store/document got which boxes (used for AWB generation).
// Both lists are owned per enterprise / individual account, uploaded by the admin (see
// js/lists.js) and looked up from a copy on the device.

let bsMap = new Map();        // box_list: box number (lowercase) -> record
let bsDocMap = new Map();     // doc_boxes: box number (lowercase) -> {document_number, box_number, store_name}
let bsDocScans = [];          // Pallet-mode scans on this device: {box_number, document_number, store_name, scanned_at}
let bsListenerAdded = false;
let bsHtml5Qr = null;
let bsCameraActive = false;
let bsIsLooking = false;
let bsPalletMode = false;

function bsActiveList() { return bsPalletMode ? 'doc_boxes' : 'box_list'; }
function bsDocScansKey() { return 'bs_doc_scans_' + AppState.user.id; }

async function initBoxSegregate() {
    await refOpenDB();
    buildBsMap(await refCacheGet('box_list'));
    buildBsDocMap(await refCacheGet('doc_boxes'));
    bsDocScans = Storage.getJSON(bsDocScansKey()) || [];
    bsPalletMode = Storage.get('bs_pallet_mode') === '1';

    document.getElementById('bsUploadBtn').style.display = refCanUpload() ? '' : 'none';

    if (!bsListenerAdded) {
        const input = document.getElementById('bsBarcodeInput');
        input.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') { e.preventDefault(); lookupSegregateBox(); resetBsKeyboard(); }
        });
        input.addEventListener('blur', resetBsKeyboard);
        document.getElementById('bsPalletToggle').addEventListener('change', function(e) { bsSetPalletMode(e.target.checked); });
        bsListenerAdded = true;
    }

    bsApplyMode();
    await updateBsTimestamp();

    if (navigator.onLine) {
        // Check both lists once a day (or when never downloaded); the Sync button forces it.
        for (const listType of ['box_list', 'doc_boxes']) {
            if (await refIsStale(listType)) await bsSyncList(listType, true);
        }
    }
    setTimeout(() => document.getElementById('bsBarcodeInput').focus(), 150);
}

function bsSetPalletMode(on) {
    bsPalletMode = !!on;
    Storage.set('bs_pallet_mode', on ? '1' : '0');
    bsApplyMode();
    updateBsTimestamp();
    document.getElementById('bsBarcodeInput').focus();
}

function bsApplyMode() {
    document.getElementById('bsPalletToggle').checked = bsPalletMode;
    document.getElementById('bsNormalWrap').style.display = bsPalletMode ? 'none' : '';
    document.getElementById('bsPalletWrap').style.display = bsPalletMode ? '' : 'none';
    document.getElementById('bsResultCard').style.display = 'none';
    document.getElementById('bsNotFound').style.display = 'none';
    if (bsPalletMode) { bsRenderDocSummary(); document.getElementById('bsDocResult').style.display = 'none'; }
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
        const key = String(r.box_number || '').toLowerCase().trim();
        if (key) bsMap.set(key, r);
    });
}

function buildBsDocMap(rows) {
    bsDocMap = new Map();
    rows.forEach(r => {
        const key = String(r.box_number || '').toLowerCase().trim();
        if (key) bsDocMap.set(key, r);
    });
}

// ============================================
// LOOKUP (dispatches by mode)
// ============================================
function lookupSegregateBox() {
    if (bsIsLooking) return;
    const input = document.getElementById('bsBarcodeInput');
    const barcode = input.value.trim();
    if (!barcode) return;
    bsIsLooking = true;
    if (bsPalletMode) lookupPalletBox(barcode);
    else {
        const row = bsMap.get(barcode.toLowerCase());
        if (row) showBsResult(row); else showBsNotFound(barcode);
    }
    input.select();
    bsIsLooking = false;
}

function showBsResult(row) {
    const fields = [
        { label: 'TRN',              value: row.trn },
        { label: 'Increff Order ID', value: row.increff_order_id },
        { label: 'Store Name',       value: row.store_name },
        { label: 'Region',           value: row.region },
        { label: 'Store Code',       value: row.store_code },
        { label: 'Brand',            value: row.brand }
    ];
    document.getElementById('bsResultCard').innerHTML =
        `<div class="bs-result-title">📦 ${escapeHtml(row.box_number || '')}</div>` +
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
    document.getElementById('bsDocResult').style.display = 'none';
}

// ============================================
// PALLET MODE
// ============================================
function bsGroupKey(rec) { return rec.document_number + '||' + rec.store_name; }

function bsDocTotals() {
    // group key -> { document_number, store_name, total, scanned }
    const groups = new Map();
    bsDocMap.forEach(rec => {
        const k = bsGroupKey(rec);
        if (!groups.has(k)) groups.set(k, { document_number: rec.document_number, store_name: rec.store_name, total: 0, scanned: 0 });
        groups.get(k).total++;
    });
    bsDocScans.forEach(s => {
        const g = groups.get(s.document_number + '||' + s.store_name);
        if (g) g.scanned++;
    });
    return Array.from(groups.values())
        .sort((a, b) => String(a.document_number).localeCompare(String(b.document_number), undefined, { numeric: true }) ||
                        String(a.store_name).localeCompare(String(b.store_name)));
}

function lookupPalletBox(barcode) {
    const rec = bsDocMap.get(barcode.toLowerCase());
    if (!rec) { showBsNotFound(barcode); return; }

    const already = bsDocScans.find(s => s.box_number.toLowerCase() === String(rec.box_number).toLowerCase());
    let duplicate = false;
    if (already) {
        duplicate = true;
    } else {
        bsDocScans.push({
            box_number: rec.box_number,
            document_number: rec.document_number,
            store_name: rec.store_name,
            scanned_at: new Date().toISOString()
        });
        Storage.setJSON(bsDocScansKey(), bsDocScans);
    }

    const g = bsDocTotals().find(x => x.document_number === rec.document_number && x.store_name === rec.store_name);
    const card = document.getElementById('bsDocResult');
    card.className = 'bs-doc-result ' + (duplicate ? 'dup' : 'ok');
    card.innerHTML =
        `<div class="bs-doc-flag">${duplicate ? '⚠️ ALREADY SCANNED' : '✅ PUT ON PALLET'}</div>` +
        `<div class="bs-doc-store">${escapeHtml(rec.store_name)}</div>` +
        `<div class="bs-doc-meta">Document <strong>${escapeHtml(rec.document_number)}</strong> &nbsp;·&nbsp; Box <strong>${escapeHtml(rec.box_number)}</strong></div>` +
        (g ? `<div class="bs-doc-meta">${g.scanned} of ${g.total} boxes for this store</div>` : '');
    card.style.display = 'block';
    document.getElementById('bsNotFound').style.display = 'none';
    bsRenderDocSummary();
}

function bsRenderDocSummary() {
    const el = document.getElementById('bsDocSummary');
    const totals = bsDocTotals();
    if (!totals.length) {
        el.innerHTML = '<p class="bs-doc-empty">No document list on this device yet. ' +
            (refCanUpload() ? 'Upload one, or tap Sync Data.' : 'Tap Sync Data once your admin has uploaded it.') + '</p>';
        return;
    }
    const scannedAll = bsDocScans.length;
    const boxesAll = totals.reduce((n, g) => n + g.total, 0);
    el.innerHTML =
        `<div class="bs-doc-total">${scannedAll} of ${boxesAll} boxes scanned</div>` +
        '<table class="scans-table"><thead><tr><th>Document</th><th>Store</th><th>Boxes</th></tr></thead><tbody>' +
        totals.map(g =>
            `<tr${g.scanned === g.total ? ' class="bs-doc-done"' : ''}><td>${escapeHtml(g.document_number)}</td><td>${escapeHtml(g.store_name)}</td><td>${g.scanned}/${g.total}</td></tr>`
        ).join('') + '</tbody></table>';
}

// One row per scanned box, grouped by document number then store - the layout used for AWB generation.
function downloadPalletExcel() {
    if (!bsDocScans.length) { alert('Nothing scanned yet.'); return false; }
    const rows = bsDocScans.slice().sort((a, b) =>
        String(a.document_number).localeCompare(String(b.document_number), undefined, { numeric: true }) ||
        String(a.store_name).localeCompare(String(b.store_name)) ||
        (a.scanned_at < b.scanned_at ? -1 : 1)
    ).map(s => ({
        'Document Number': s.document_number,
        'Store Name': s.store_name,
        'Box Number': s.box_number,
        'Scanned At': new Date(s.scanned_at).toLocaleString()
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    ws['!cols'] = [{wch:18},{wch:26},{wch:20},{wch:20}];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Segregation');
    XLSX.writeFile(wb, `box_segregation_${new Date().toISOString().slice(0, 10)}.xlsx`);
    return true;
}

function resetPalletScans() {
    if (!bsDocScans.length) { alert('Nothing to reset.'); return; }
    if (!confirm('Download the ' + bsDocScans.length + ' scanned boxes and then clear them from this device?')) return;
    if (!downloadPalletExcel()) return;
    bsDocScans = [];
    Storage.setJSON(bsDocScansKey(), bsDocScans);
    document.getElementById('bsDocResult').style.display = 'none';
    bsRenderDocSummary();
}

// ============================================
// SYNC & UPLOAD (with % progress)
// ============================================
async function bsSyncList(listType, silent) {
    const btn = document.getElementById('bsRefreshBtn');
    const progress = refProgress(btn, 'Syncing');
    try {
        const result = await refSync(listType, {
            force: !silent,
            onProgress: (p) => progress.update(p, 'Syncing')
        });
        if (listType === 'box_list') buildBsMap(await refCacheGet('box_list'));
        else { buildBsDocMap(await refCacheGet('doc_boxes')); if (bsPalletMode) bsRenderDocSummary(); }
        await updateBsTimestamp();
        const meta = await refMetaGet(listType);
        if (!silent) {
            if (result === 'offline') alert('You are offline. Using cached data.');
            else if (result === 'empty') alert('No ' + REF_LISTS[listType].label + ' has been uploaded yet.');
            else alert('✅ Synced — ' + (meta ? meta.count : 0) + (listType === 'box_list' ? ' boxes' : ' boxes in the document list') + ' loaded.');
        }
    } catch (err) {
        console.error('Box Segregate sync failed:', err);
        if (!silent) alert('Sync failed: ' + (err.message || err));
    } finally {
        progress.done();
    }
}

function refreshBsData() { return bsSyncList(bsActiveList(), false); }

function uploadBsList() {
    const listType = bsActiveList();
    refStartUpload(listType, document.getElementById('bsUploadBtn'), () => bsSyncList(listType, false));
}

async function updateBsTimestamp() {
    const el = document.getElementById('bsTimestamp');
    if (!el) return;
    el.innerHTML = await refStatusText(bsActiveList(), 'boxes');
}

function escapeHtml(str) {
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
