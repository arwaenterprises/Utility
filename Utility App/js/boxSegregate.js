// ============================================
// BOX SEGREGATE MODULE
// ============================================
// Scan a box, see its details (TRN, store, region, ...) from the box list. The old "Pallet" mode
// is now its own tile, Segregate & Pack (js/segregatePack.js).
// The list is owned per enterprise / individual account, uploaded by the admin (see
// js/lists.js) and looked up from a copy on the device.

let bsMap = new Map();        // box_list: box number (lowercase) -> record
let bsListenerAdded = false;
let bsIsLooking = false;

async function initBoxSegregate() {
    await refOpenDB();
    buildBsMap(await refCacheGet('box_list'));

    document.getElementById('bsUploadBtn').style.display = refCanUpload() ? '' : 'none';
    document.getElementById('bsTemplateBtn').style.display = refCanUpload() ? '' : 'none';

    if (!bsListenerAdded) {
        const input = document.getElementById('bsBarcodeInput');
        input.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') { e.preventDefault(); lookupSegregateBox(); resetBsKeyboard(); }
        });
        input.addEventListener('blur', resetBsKeyboard);
        bsListenerAdded = true;
    }

    document.getElementById('bsResultCard').style.display = 'none';
    document.getElementById('bsNotFound').style.display = 'none';
    await updateBsTimestamp();

    // Check the list once a day (or when never downloaded); the Sync button forces it.
    if (navigator.onLine && await refIsStale('box_list')) await bsSyncList(true);
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

// The camera stays open and keeps scanning (js/camera.js); each new code is looked up and shown under the camera.
const bsCamera = Camera.create({
    btnId: 'bsCamBtn', overlayId: 'bsCamOverlay', readerId: 'bsQrReader', torchBtnId: 'bsTorchBtn',
    onCode: (text) => { document.getElementById('bsBarcodeInput').value = text; lookupSegregateBox(); }
});
function toggleBsCamera() { return bsCamera.toggle(); }
function stopBsCamera() { return bsCamera.stop(); }

function buildBsMap(rows) {
    bsMap = new Map();
    rows.forEach(r => {
        const key = String(r.box_number || '').toLowerCase().trim();
        if (key) bsMap.set(key, r);
    });
}

// ============================================
// LOOKUP
// ============================================
function lookupSegregateBox() {
    if (bsIsLooking) return;
    const input = document.getElementById('bsBarcodeInput');
    const barcode = input.value.trim();
    if (!barcode) return;
    bsIsLooking = true;
    const row = bsMap.get(barcode.toLowerCase());
    Usage.log('box_segregate', row ? 'lookup_found' : 'lookup_not_found', 1, 0);
    if (row) showBsResult(row); else showBsNotFound(barcode);
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
}

// ============================================
// SYNC & UPLOAD (with % progress)
// ============================================
async function bsSyncList(silent) {
    const btn = document.getElementById('bsRefreshBtn');
    const progress = refProgress(btn, 'Syncing');
    try {
        const result = await refSync('box_list', {
            force: !silent,
            onProgress: (p) => progress.update(p, 'Syncing')
        });
        buildBsMap(await refCacheGet('box_list'));
        await updateBsTimestamp();
        const meta = await refMetaGet('box_list');
        if (!silent) {
            if (result === 'offline') alert('You are offline. Using cached data.');
            else if (result === 'empty') alert('No ' + REF_LISTS.box_list.label + ' has been uploaded yet.');
            else alert('✅ Synced — ' + (meta ? meta.count : 0) + ' boxes loaded.');
        }
    } catch (err) {
        console.error('Box Segregate sync failed:', err);
        if (!silent) alert('Sync failed: ' + (err.message || err));
    } finally {
        progress.done();
    }
}

function refreshBsData() { return bsSyncList(false); }

function uploadBsList() {
    refStartUpload('box_list', document.getElementById('bsUploadBtn'), () => bsSyncList(false));
}

async function updateBsTimestamp() {
    const el = document.getElementById('bsTimestamp');
    if (!el) return;
    el.innerHTML = await refStatusText('box_list', 'boxes');
}

function escapeHtml(str) {
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
