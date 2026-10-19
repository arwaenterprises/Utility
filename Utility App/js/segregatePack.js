// ============================================
// SEGREGATE & PACK MODULE
// ============================================
// Formerly the "Pallet" mode of Box Segregate, now its own tile. The uploaded TRN# / box list says
// which store/document each box belongs to; scan a box to see where to put it, duplicates are blocked,
// and a download lists which store/document got which boxes (used for AWB generation).
// The list (doc_boxes) is owned per enterprise / individual account, uploaded by the admin (see
// js/lists.js) and looked up from a copy on the device. Scans stay on the device until Reset; they keep
// the storage key and usage name the Pallet mode used, so nothing scanned before the move is lost.

let spDocMap = new Map();     // doc_boxes: box number (lowercase) -> {document_number, box_number, store_name}
let spDocScans = [];          // scans on this device: {box_number, document_number, store_name, scanned_at}
let spListenerAdded = false;
let spIsLooking = false;
let spSummaryOpen = false;           // the box list under the scan result is collapsed until the user expands it
const spOpenGroups = new Set();      // TRN#/store rows whose box numbers are expanded

function spDocScansKey() { return 'bs_doc_scans_' + AppState.user.id; }

async function initSegregatePack() {
    await refOpenDB();
    buildSpDocMap(await refCacheGet('doc_boxes'));
    spDocScans = Storage.getJSON(spDocScansKey()) || [];

    document.getElementById('spUploadBtn').style.display = refCanUpload() ? '' : 'none';
    document.getElementById('spTemplateBtn').style.display = refCanUpload() ? '' : 'none';

    if (!spListenerAdded) {
        const input = document.getElementById('spBarcodeInput');
        input.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') { e.preventDefault(); lookupPackBox(); resetSpKeyboard(); }
        });
        input.addEventListener('blur', resetSpKeyboard);
        document.getElementById('spDocSummary').addEventListener('click', function(e) {
            if (e.target.closest('[data-sp-toggle-summary]')) {
                spSummaryOpen = !spSummaryOpen; spRenderDocSummary(); return;
            }
            const row = e.target.closest('[data-sp-group]');
            if (row) {
                const k = row.dataset.spGroup;
                if (spOpenGroups.has(k)) spOpenGroups.delete(k); else spOpenGroups.add(k);
                spRenderDocSummary();
            }
        });
        spListenerAdded = true;
    }

    document.getElementById('spDocResult').style.display = 'none';
    document.getElementById('spNotFound').style.display = 'none';
    spRenderDocSummary();
    await updateSpTimestamp();

    // Check the list once a day (or when never downloaded); the Sync button forces it.
    if (navigator.onLine && await refIsStale('doc_boxes')) await spSyncList(true);
    setTimeout(() => document.getElementById('spBarcodeInput').focus(), 150);
}

function toggleSpKeyboard() {
    const input = document.getElementById('spBarcodeInput');
    const btn = document.getElementById('spKbdBtn');
    input.removeAttribute('readonly');
    input.inputMode = 'text';
    input.classList.add('bs-kbd-active');
    btn.classList.add('active');
    input.focus();
}

function resetSpKeyboard() {
    const input = document.getElementById('spBarcodeInput');
    const btn = document.getElementById('spKbdBtn');
    input.inputMode = 'none';
    input.classList.remove('bs-kbd-active');
    if (btn) btn.classList.remove('active');
}

// The camera stays open and keeps scanning (js/camera.js); each new code is looked up and shown under the camera.
const spCamera = Camera.create({
    btnId: 'spCamBtn', overlayId: 'spCamOverlay', readerId: 'spQrReader', torchBtnId: 'spTorchBtn',
    onCode: (text) => { document.getElementById('spBarcodeInput').value = text; lookupPackBox(); }
});
function toggleSpCamera() { return spCamera.toggle(); }
function stopSpCamera() { return spCamera.stop(); }

function buildSpDocMap(rows) {
    spDocMap = new Map();
    rows.forEach(r => {
        const key = String(r.box_number || '').toLowerCase().trim();
        if (key) spDocMap.set(key, r);
    });
}

// ============================================
// LOOKUP
// ============================================
function spGroupKey(rec) { return rec.document_number + '||' + rec.store_name; }

function spDocTotals() {
    // group key -> { document_number, store_name, total, scanned }
    const groups = new Map();
    spDocMap.forEach(rec => {
        const k = spGroupKey(rec);
        if (!groups.has(k)) groups.set(k, { document_number: rec.document_number, store_name: rec.store_name, total: 0, scanned: 0 });
        groups.get(k).total++;
    });
    spDocScans.forEach(s => {
        const g = groups.get(s.document_number + '||' + s.store_name);
        if (g) g.scanned++;
    });
    return Array.from(groups.values())
        .sort((a, b) => String(a.document_number).localeCompare(String(b.document_number), undefined, { numeric: true }) ||
                        String(a.store_name).localeCompare(String(b.store_name)));
}

function lookupPackBox() {
    if (spIsLooking) return;
    const input = document.getElementById('spBarcodeInput');
    const barcode = input.value.trim();
    if (!barcode) return;
    spIsLooking = true;
    spScanBox(barcode);
    input.select();
    spIsLooking = false;
}

function spScanBox(barcode) {
    const rec = spDocMap.get(barcode.toLowerCase());
    if (!rec) { Usage.log('box_segregate_pallet', 'box_not_found', 1, 0); showSpNotFound(barcode); return; }

    const already = spDocScans.find(s => s.box_number.toLowerCase() === String(rec.box_number).toLowerCase());
    let duplicate = false;
    if (already) {
        duplicate = true;
        Usage.log('box_segregate_pallet', 'box_duplicate', 1, 0);
    } else {
        Usage.log('box_segregate_pallet', 'box_scanned', 1, 1);
        spDocScans.push({
            box_number: rec.box_number,
            document_number: rec.document_number,
            store_name: rec.store_name,
            scanned_at: new Date().toISOString()
        });
        Storage.setJSON(spDocScansKey(), spDocScans);
    }

    const g = spDocTotals().find(x => x.document_number === rec.document_number && x.store_name === rec.store_name);
    const card = document.getElementById('spDocResult');
    card.className = 'bs-doc-result ' + (duplicate ? 'dup' : 'ok');
    card.innerHTML =
        `<div class="bs-doc-flag">${duplicate ? '⚠️ ALREADY SCANNED' : '✅ PUT ON PALLET'}</div>` +
        `<div class="bs-doc-store">${escapeHtml(rec.store_name)}</div>` +
        `<div class="bs-doc-meta">TRN# <strong>${escapeHtml(rec.document_number)}</strong> &nbsp;·&nbsp; Box <strong>${escapeHtml(rec.box_number)}</strong></div>` +
        (g ? `<div class="bs-doc-meta">${g.scanned} of ${g.total} boxes for this store</div>` : '');
    card.style.display = 'block';
    document.getElementById('spNotFound').style.display = 'none';
    spRenderDocSummary();
}

function showSpNotFound(barcode) {
    document.getElementById('spNotFound').innerHTML =
        `❌ Box not found<span>${escapeHtml(barcode)}</span>`;
    document.getElementById('spNotFound').style.display = 'block';
    document.getElementById('spDocResult').style.display = 'none';
}

function spRenderDocSummary() {
    const el = document.getElementById('spDocSummary');
    const totals = spDocTotals();
    if (!totals.length) {
        el.innerHTML = '<p class="bs-doc-empty">No document list on this device yet. ' +
            (refCanUpload() ? 'Upload one, or tap Sync Data.' : 'Tap Sync Data once your admin has uploaded it.') + '</p>';
        return;
    }
    const scannedAll = spDocScans.length;
    const boxesAll = totals.reduce((n, g) => n + g.total, 0);
    // Collapsed by default: just the running total. Tap it to see the list; tap a TRN# row to see its boxes.
    let html = `<button type="button" class="bs-doc-total bs-doc-toggle" data-sp-toggle-summary="1">` +
        `${spSummaryOpen ? '▾' : '▸'} ${scannedAll} of ${boxesAll} boxes scanned</button>`;
    if (spSummaryOpen) {
        const scannedSet = new Set(spDocScans.map(s => s.box_number.toLowerCase()));
        html += '<table class="scans-table"><thead><tr><th>TRN#</th><th>Store Name</th><th>Boxes</th></tr></thead><tbody>' +
            totals.map(g => {
                const key = spGroupKey(g);
                const open = spOpenGroups.has(key);
                let rowHtml = `<tr class="bs-doc-row${g.scanned === g.total ? ' bs-doc-done' : ''}" data-sp-group="${escapeHtml(key)}">` +
                    `<td>${open ? '▾' : '▸'} ${escapeHtml(g.document_number)}</td><td>${escapeHtml(g.store_name)}</td><td>${g.scanned}/${g.total}</td></tr>`;
                if (open) {
                    const boxes = Array.from(spDocMap.values()).filter(r => spGroupKey(r) === key);
                    rowHtml += `<tr class="bs-doc-boxes"><td colspan="3">` +
                        boxes.map(r => `<span class="bs-doc-box${scannedSet.has(String(r.box_number).toLowerCase()) ? ' scanned' : ''}">${escapeHtml(r.box_number)}${scannedSet.has(String(r.box_number).toLowerCase()) ? ' ✓' : ''}</span>`).join('') +
                        `</td></tr>`;
                }
                return rowHtml;
            }).join('') + '</tbody></table>';
    }
    el.innerHTML = html;
}

// One row per scanned box, grouped by document number then store - the layout used for AWB generation.
function downloadPackExcel() {
    if (!spDocScans.length) { alert('Nothing scanned yet.'); return false; }
    const rows = spDocScans.slice().sort((a, b) =>
        String(a.document_number).localeCompare(String(b.document_number), undefined, { numeric: true }) ||
        String(a.store_name).localeCompare(String(b.store_name)) ||
        (a.scanned_at < b.scanned_at ? -1 : 1)
    ).map(s => ({
        'TRN#': s.document_number,
        'Store Name': s.store_name,
        'Box Number': s.box_number,
        'Scanned At': new Date(s.scanned_at).toLocaleString()
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    ws['!cols'] = [{wch:18},{wch:26},{wch:20},{wch:20}];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Segregation');

    // Second sheet: boxes in the uploaded list that were never scanned (so nothing is forgotten before AWBs
    // are generated). The first sheet stays exactly as it was.
    const scannedSet = new Set(spDocScans.map(s => String(s.box_number).toLowerCase()));
    const missing = Array.from(spDocMap.values())
        .filter(r => !scannedSet.has(String(r.box_number).toLowerCase()))
        .sort((a, b) => String(a.document_number).localeCompare(String(b.document_number), undefined, { numeric: true }) ||
                        String(a.store_name).localeCompare(String(b.store_name)) ||
                        String(a.box_number).localeCompare(String(b.box_number), undefined, { numeric: true }));
    const ws2 = XLSX.utils.aoa_to_sheet([['TRN#', 'Store Name', 'Box Number']].concat(missing.map(r => [r.document_number, r.store_name, r.box_number])));
    ws2['!cols'] = [{wch:18},{wch:26},{wch:20}];
    XLSX.utils.book_append_sheet(wb, ws2, 'Not scanned');

    XLSX.writeFile(wb, `box_segregation_${new Date().toISOString().slice(0, 10)}.xlsx`);
    return true;
}

function resetPackScans() {
    if (!spDocScans.length) {            // nothing scanned: nothing to confirm or download, just clear the screen quietly
        document.getElementById('spDocResult').style.display = 'none';
        spRenderDocSummary();
        return;
    }
    if (!confirm('Download the ' + spDocScans.length + ' scanned boxes and then clear them from this device?')) return;
    if (!downloadPackExcel()) return;
    spDocScans = [];
    Storage.setJSON(spDocScansKey(), spDocScans);
    document.getElementById('spDocResult').style.display = 'none';
    spRenderDocSummary();
}

// ============================================
// SYNC & UPLOAD (with % progress)
// ============================================
async function spSyncList(silent) {
    const btn = document.getElementById('spRefreshBtn');
    const progress = refProgress(btn, 'Syncing');
    try {
        const result = await refSync('doc_boxes', {
            force: !silent,
            onProgress: (p) => progress.update(p, 'Syncing')
        });
        buildSpDocMap(await refCacheGet('doc_boxes'));
        spRenderDocSummary();
        await updateSpTimestamp();
        const meta = await refMetaGet('doc_boxes');
        if (!silent) {
            if (result === 'offline') alert('You are offline. Using cached data.');
            else if (result === 'empty') alert('No ' + REF_LISTS.doc_boxes.label + ' has been uploaded yet.');
            else alert('✅ Synced — ' + (meta ? meta.count : 0) + ' boxes in the document list loaded.');
        }
    } catch (err) {
        console.error('Segregate & Pack sync failed:', err);
        if (!silent) alert('Sync failed: ' + (err.message || err));
    } finally {
        progress.done();
    }
}

function refreshSpData() { return spSyncList(false); }

function uploadSpList() {
    refStartUpload('doc_boxes', document.getElementById('spUploadBtn'), () => spSyncList(false));
}

async function updateSpTimestamp() {
    const el = document.getElementById('spTimestamp');
    if (!el) return;
    el.innerHTML = await refStatusText('doc_boxes', 'boxes');
}
