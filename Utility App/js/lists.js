// ============================================
// REFERENCE LISTS - shared by Box Segregate, Price Check, Year/Season Sort
// ============================================
// Each enterprise (or individual account) owns its own copy of each list. The
// enterprise admin / the individual uploads a CSV or Excel file; an upload REPLACES
// the whole list and deletes the old rows (supabase/schema.sql, "REFERENCE LISTS").
// Everyone else just downloads the list to their device and looks things up locally,
// so lookups are instant and work offline.
//
// Every upload and every download reports a percentage so users can see how long it
// will take.

// Unique ID for every scan. Generated once at scan time and never regenerated, so a
// resent batch carries the same IDs and Supabase upserts it onto the row it already
// wrote instead of creating a duplicate. Must be a valid UUID (scans.scan_uid is uuid).
function newScanUid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    // Fallback for non-secure contexts where crypto.randomUUID is unavailable
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = Math.random() * 16 | 0;
        return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
}

const REF_LISTS = {
    box_list: {
        label: 'box list',
        columns: [
            { key: 'box_number', required: true },
            { key: 'trn' }, { key: 'increff_order_id' }, { key: 'store_name' },
            { key: 'region' }, { key: 'store_code' }, { key: 'brand' }
        ]
    },
    price_list: {
        label: 'price list',
        columns: [
            { key: 'barcode', required: true },
            { key: 'current_price' }, { key: 'original_price' }, { key: 'style' },
            { key: 'color' }, { key: 'size' }, { key: 'year' }, { key: 'season' }
        ]
    },
    ys_item_master: {
        label: 'item master',
        columns: [{ key: 'barcode', required: true }, { key: 'year' }, { key: 'season' }, { key: 'brand' }]
    },
    ys_ptl_config: {
        label: 'PTL config',
        columns: [
            { key: 'ptl_number', required: true }, { key: 'season' }, { key: 'year' }, { key: 'year_logic' }
        ]
    },
    doc_boxes: {
        label: 'document / box list',
        columns: [
            { key: 'document_number', required: true },
            { key: 'box_number', required: true },
            { key: 'store_name', required: true }
        ]
    }
};

const REF_UPLOAD_CHUNK = 2000;       // records per upload call (server limit is 5000)
const REF_DOWNLOAD_PAGE = 4;         // chunks fetched per request while downloading
const REF_STALE_MS = 24 * 60 * 60 * 1000; // lists are re-checked at most once a day automatically

// ------------------------------------------------
// Who may upload: an individual, or the enterprise admin
// ------------------------------------------------
function refCanUpload() {
    const p = AppState.profile;
    if (!p) return false;
    return !p.enterprise_id || p.tier === 'enterprise_admin';
}

// Limits a query to the lists of the signed-in user's current account (their
// enterprise, or their own individual lists) so an old individual list never mixes
// with an enterprise list after someone joins an enterprise.
function refScope(query) {
    const eid = AppState.profile?.enterprise_id;
    return eid ? query.eq('enterprise_id', eid) : query.is('enterprise_id', null);
}

// ------------------------------------------------
// Progress UI: a percentage on the button plus a thin bar under it
// ------------------------------------------------
function refProgress(anchorEl, baseLabel) {
    let bar = null;
    const btn = anchorEl && anchorEl.tagName === 'BUTTON' ? anchorEl : null;
    const original = btn ? btn.textContent : '';
    function ensureBar() {
        if (bar || !anchorEl) return;
        bar = document.createElement('div');
        bar.className = 'ref-progress';
        bar.innerHTML = '<div class="ref-progress-fill"></div>';
        const host = anchorEl.parentElement;
        host.insertAdjacentElement('afterend', bar);
    }
    return {
        update(pct, text) {
            const p = Math.max(0, Math.min(100, Math.round(pct)));
            ensureBar();
            if (bar) bar.firstChild.style.width = p + '%';
            // Round icon buttons are too small for a label: they show just the percentage.
            if (btn) { btn.disabled = true; btn.textContent = btn.classList.contains('bs-round-btn') ? p + '%' : (text || baseLabel) + ' ' + p + '%'; }
            return p;
        },
        done() {
            if (bar) { bar.remove(); bar = null; }
            if (btn) { btn.disabled = false; btn.textContent = original; }
        }
    };
}

// ------------------------------------------------
// Reading a CSV / Excel file into records
// ------------------------------------------------
function refNormalizeHeader(h) {
    return String(h == null ? '' : h).toLowerCase().replace(/[^a-z0-9]/g, '');
}

// Returns { rows, error }. Headers are matched loosely ("Box Number", "box_number",
// "BoxNumber" are the same), extra columns are ignored, and rows missing a required
// value are skipped (counted in `skipped`).
async function refParseFile(file, listType) {
    const def = REF_LISTS[listType];
    let sheetRows;
    try {
        const buf = await file.arrayBuffer();
        // raw: true keeps every value exactly as written (no number conversion), so
        // barcodes with leading zeros survive.
        const wb = XLSX.read(buf, { type: 'array', raw: true });
        const ws = wb.Sheets[wb.SheetNames[0]];
        sheetRows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '', blankrows: false });
    } catch (e) {
        return { rows: [], error: 'Could not read this file. Please upload a CSV or Excel (.xlsx) file.' };
    }
    if (sheetRows.length < 2) return { rows: [], error: 'The file has no data rows.' };

    const headerIdx = {};
    sheetRows[0].forEach((h, i) => { headerIdx[refNormalizeHeader(h)] = i; });
    const colIndex = {};
    const missing = [];
    def.columns.forEach(c => {
        const idx = headerIdx[refNormalizeHeader(c.key)];
        if (idx === undefined) { if (c.required) missing.push(c.key); }
        else colIndex[c.key] = idx;
    });
    if (missing.length) {
        return { rows: [], error: 'Missing required column(s): ' + missing.join(', ') + '.\nColumns found: ' + sheetRows[0].join(', ') };
    }

    const rows = [];
    let skipped = 0;
    for (let i = 1; i < sheetRows.length; i++) {
        const rec = {};
        def.columns.forEach(c => {
            const idx = colIndex[c.key];
            rec[c.key] = idx === undefined ? '' : String(sheetRows[i][idx] == null ? '' : sheetRows[i][idx]).trim();
        });
        if (def.columns.some(c => c.required && !rec[c.key])) { skipped++; continue; }
        rows.push(rec);
    }
    if (rows.length === 0) return { rows: [], error: 'No usable rows found in the file.' };
    return { rows, skipped };
}

// ------------------------------------------------
// Upload (replace the whole list)
// ------------------------------------------------
async function refUploadList(listType, rows, onProgress) {
    const report = onProgress || function () {};
    report(0);
    let r = await supabaseClient.rpc('begin_list_upload', { p_list_type: listType });
    if (r.error) throw r.error;
    for (let i = 0, seq = 0; i < rows.length; i += REF_UPLOAD_CHUNK, seq++) {
        const chunk = rows.slice(i, i + REF_UPLOAD_CHUNK);
        r = await supabaseClient.rpc('append_list_chunk', { p_list_type: listType, p_seq: seq, p_rows: chunk });
        if (r.error) throw r.error;
        report(Math.min(i + REF_UPLOAD_CHUNK, rows.length) / rows.length * 95);
    }
    r = await supabaseClient.rpc('commit_list_upload', { p_list_type: listType });
    if (r.error) throw r.error;
    report(100);
    return r.data;
}

// Whole upload flow for a button: pick file -> parse -> confirm -> upload -> callback.
function refStartUpload(listType, anchorBtn, onDone) {
    const def = REF_LISTS[listType];
    if (!refCanUpload()) { alert('Only your enterprise admin can upload the ' + def.label + '.'); return; }
    if (!AppState.isOnline) { alert('You are offline. Connect to the internet to upload the ' + def.label + '.'); return; }

    let input = document.getElementById('refFileInput');
    if (!input) {
        input = document.createElement('input');
        input.type = 'file';
        input.id = 'refFileInput';
        input.accept = '.csv,.xlsx,.xls';
        input.style.display = 'none';
        document.body.appendChild(input);
    }
    input.value = '';
    input.onchange = async () => {
        const file = input.files && input.files[0];
        if (!file) return;
        const parsed = await refParseFile(file, listType);
        if (parsed.error) { alert(parsed.error); return; }
        const note = parsed.skipped ? '\n(' + parsed.skipped + ' row(s) with missing required values were skipped.)' : '';
        if (!confirm('Replace the whole ' + def.label + ' with this file (' + parsed.rows.length + ' rows)?\nThe old list will be deleted.' + note)) return;
        const progress = refProgress(anchorBtn, 'Uploading');
        try {
            const total = await refUploadList(listType, parsed.rows, (p) => progress.update(p, 'Uploading'));
            progress.done();
            alert('✅ Uploaded - ' + total + ' rows. Other devices get it on their next Sync.');
            if (onDone) await onDone();
        } catch (e) {
            progress.done();
            console.error('List upload failed:', e);
            alert('Upload failed: ' + (e.message || e) + '\nYour previous list was kept.');
        }
    };
    input.click();
}

// ------------------------------------------------
// Device cache (IndexedDB, one database per signed-in user)
// ------------------------------------------------
let refDB = null;
let refDBName = null;

function refOpenDB() {
    const name = 'AKRef_' + AppState.user.id;
    if (refDB && refDBName === name) return Promise.resolve(refDB);
    if (refDB) { refDB.close(); refDB = null; }
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(name, 1);
        req.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains('lists')) db.createObjectStore('lists');
            if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
        };
        req.onsuccess = () => { refDB = req.result; refDBName = name; resolve(refDB); };
        req.onerror = () => reject(req.error);
    });
}

async function refIdb(store, mode, fn) {
    const db = await refOpenDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction([store], mode);
        const req = fn(tx.objectStore(store));
        tx.oncomplete = () => resolve(req ? req.result : undefined);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
    });
}

async function refCacheGet(listType) {
    const rec = await refIdb('lists', 'readonly', s => s.get(listType));
    return rec ? rec.rows : [];
}
function refMetaGet(listType) { return refIdb('meta', 'readonly', s => s.get(listType)); }
function refMetaPut(listType, meta) { return refIdb('meta', 'readwrite', s => s.put(meta, listType)); }
function refCachePut(listType, rows) { return refIdb('lists', 'readwrite', s => s.put({ rows }, listType)); }

async function refClearLocal(listType) {
    await refIdb('lists', 'readwrite', s => s.delete(listType));
    await refIdb('meta', 'readwrite', s => s.delete(listType));
}

// True when the cached copy is missing or older than a day.
async function refIsStale(listType) {
    const meta = await refMetaGet(listType);
    return !meta || !meta.syncedAt || (Date.now() - meta.syncedAt > REF_STALE_MS);
}

// ------------------------------------------------
// Download (sync) with progress
// ------------------------------------------------
// Returns 'updated' | 'uptodate' | 'offline' | 'empty'. Throws on a real failure.
//   force      - download even if the server copy looks unchanged
//   onProgress - called with 0..100
//   saveRows   - optional async (rows, onSaveProgress) => void to store the rows
//                somewhere else (Price Check / Year-Season keep their own lookup
//                tables); default is this module's own cache
async function refSync(listType, opts) {
    const o = opts || {};
    const report = o.onProgress || function () {};
    if (!AppState.isOnline) return 'offline';

    // 1. Cheap check: which chunks does the server have, and when were they uploaded?
    const metaRes = await refScope(
        supabaseClient.from('reference_chunks')
            .select('id, seq, row_count, uploaded_at')
            .eq('list_type', listType)
    ).order('seq', { ascending: true });
    if (metaRes.error) throw metaRes.error;
    const chunks = metaRes.data || [];
    const total = chunks.reduce((n, c) => n + c.row_count, 0);
    const version = chunks.length
        ? chunks.map(c => c.uploaded_at).sort().pop() + '|' + total
        : '';

    const prev = await refMetaGet(listType);
    if (!chunks.length) {
        // The list was deleted / never uploaded on the server.
        await refClearLocal(listType);
        if (o.saveRows) await o.saveRows([], () => {});
        await refMetaPut(listType, { version: '', count: 0, syncedAt: Date.now() });
        report(100);
        return 'empty';
    }
    if (!o.force && prev && prev.version === version) {
        await refMetaPut(listType, { ...prev, syncedAt: Date.now() });
        report(100);
        return 'uptodate';
    }

    // 2. Download the chunks a few at a time (0-80%), then save to the device (80-100%).
    const rows = [];
    report(0);
    for (let i = 0; i < chunks.length; i += REF_DOWNLOAD_PAGE) {
        const ids = chunks.slice(i, i + REF_DOWNLOAD_PAGE).map(c => c.id);
        const res = await supabaseClient.from('reference_chunks').select('id, seq, rows').in('id', ids);
        if (res.error) throw res.error;
        res.data.sort((a, b) => a.seq - b.seq).forEach(c => { for (const r of c.rows) rows.push(r); });
        report(Math.min(i + REF_DOWNLOAD_PAGE, chunks.length) / chunks.length * 80);
    }
    if (o.saveRows) await o.saveRows(rows, (frac) => report(80 + frac * 20));
    else await refCachePut(listType, rows);
    await refMetaPut(listType, { version, count: rows.length, syncedAt: Date.now() });
    report(100);
    return 'updated';
}

// "12,345 items - synced 01/10/2026, 14:05" style text for the small label next to a Sync button.
async function refStatusText(listType, noun) {
    const meta = await refMetaGet(listType);
    if (!meta || !meta.syncedAt) return 'No data';
    return meta.count + ' ' + noun + '<br>' + new Date(meta.syncedAt).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}
