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
        unique: 'box_number',        // a box number may appear only once
        columns: [
            { key: 'box_number', required: true, aliases: ['box_code', 'box_id', 'box_no'] },
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
        label: 'TRN / box list',
        unique: 'box_number',        // a box can only go on one pallet, so each number may appear once
        strict: true,                // all three columns are mandatory: an incomplete row stops the upload
        columns: [
            // stored as document_number (older uploads use that name); shown to users as TRN#
            { key: 'document_number', label: 'TRN#', required: true, aliases: ['trn', 'trn_number', 'transfer_number', 'document', 'doc_number'] },
            { key: 'box_number', required: true, aliases: ['box_code', 'box_id', 'box_no'] },
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
    const original = btn ? btn.innerHTML : '';              // innerHTML, so an icon picture comes back after the % display
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
            if (btn) { btn.disabled = false; btn.innerHTML = original; }
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
        const names = [c.key, c.label].concat(c.aliases || []).filter(Boolean).map(refNormalizeHeader);
        const idx = names.map(n => headerIdx[n]).find(i => i !== undefined);
        if (idx === undefined) { if (c.required) missing.push(refHeaderLabel(c)); }
        else colIndex[c.key] = idx;
    });
    if (missing.length) {
        return { rows: [], error: 'Missing required column(s): ' + missing.join(', ') + '.\nColumns found: ' + sheetRows[0].join(', ') };
    }

    const rows = [];
    const rowNumbers = [];      // spreadsheet row number of each kept record (row 1 = headers)
    const incomplete = [];      // strict lists: rows with a missing mandatory value
    let skipped = 0;
    for (let i = 1; i < sheetRows.length; i++) {
        const rec = {};
        def.columns.forEach(c => {
            const idx = colIndex[c.key];
            rec[c.key] = idx === undefined ? '' : String(sheetRows[i][idx] == null ? '' : sheetRows[i][idx]).trim();
        });
        const missingCols = def.columns.filter(c => c.required && !rec[c.key]);
        if (missingCols.length) {
            if (def.strict) incomplete.push('row ' + (i + 1) + ' (missing ' + missingCols.map(refHeaderLabel).join(', ') + ')');
            else skipped++;
            continue;
        }
        rows.push(rec);
        rowNumbers.push(i + 1);
    }
    if (incomplete.length) {
        return { rows: [], error: 'Upload stopped: every row needs ' + def.columns.map(refHeaderLabel).join(', ') + '.\n' +
            incomplete.length + ' row(s) are incomplete: ' + incomplete.slice(0, 10).join('; ') + (incomplete.length > 10 ? '; ...' : '') };
    }
    if (rows.length === 0) return { rows: [], error: 'No usable rows found in the file.' };

    // Duplicate check (before anything is uploaded): the same value twice in the key column.
    const duplicates = [];
    if (def.unique) {
        const seen = new Map();
        rows.forEach((r, n) => {
            const k = r[def.unique].toLowerCase();
            if (!seen.has(k)) seen.set(k, { value: r[def.unique], rows: [] });
            seen.get(k).rows.push(rowNumbers[n]);
        });
        seen.forEach(v => { if (v.rows.length > 1) duplicates.push(v); });
    }
    return { rows, skipped, duplicates };
}

// ------------------------------------------------
// Template download: an Excel file with the right column headers
// ------------------------------------------------
const REF_HEADER_WORDS = { id: 'ID', trn: 'TRN', ptl: 'PTL' };
function refHeaderLabel(colOrKey) {
    if (colOrKey && colOrKey.label) return colOrKey.label;
    const key = typeof colOrKey === 'string' ? colOrKey : colOrKey.key;
    return key.split('_').map(w => REF_HEADER_WORDS[w] || (w.charAt(0).toUpperCase() + w.slice(1))).join(' ');
}

const REF_TEMPLATE_NOTES = {
    box_list: ['Box Number is required (a column called Box Code also works). Everything else is optional.', 'A box number may appear only once - duplicates stop the upload.'],
    price_list: ['Barcode is required. Everything else is optional.'],
    ys_item_master: ['Barcode is required.', 'Season: SS or FW.'],
    ys_ptl_config: ['PTL Number is required (1 becomes 01).', 'Season: SS or FW.', 'Year Logic: lte (that year and earlier) or exact (that year only).'],
    doc_boxes: ['TRN#, Box Number and Store Name are all required on every row.', 'One row per box. A box number may appear only once - duplicates stop the upload.']
};

// Sheet 1 ("Data") holds only the header row - that is the sheet the upload reads.
// Sheet 2 ("Instructions") explains the columns and is ignored by the upload.
function refDownloadTemplate(listType) {
    const def = REF_LISTS[listType];
    const wb = XLSX.utils.book_new();
    const headers = def.columns.map(c => refHeaderLabel(c));
    const ws = XLSX.utils.aoa_to_sheet([headers]);
    ws['!cols'] = headers.map(h => ({ wch: Math.max(14, h.length + 4) }));
    XLSX.utils.book_append_sheet(wb, ws, 'Data');
    const info = [['Column', 'Required?']]
        .concat(def.columns.map(c => [refHeaderLabel(c), c.required ? 'Required' : 'Optional']))
        .concat([[''], ['Notes']])
        .concat((REF_TEMPLATE_NOTES[listType] || []).map(n => [n]))
        .concat([['Fill the Data sheet from row 2 down, save, then upload. An upload replaces the whole list.']]);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(info), 'Instructions');
    XLSX.writeFile(wb, 'template_' + def.label.replace(/[^a-z0-9]+/gi, '_') + '.xlsx');
}

// ------------------------------------------------
// Upload (replace the whole list)
// ------------------------------------------------
// Speed: chunks go up several at a time (REF_UPLOAD_PARALLEL), and each chunk is sent as
// plain value arrays plus ONE list of column names instead of repeating the names in every
// row (about half the bytes). The server turns them back into the usual records, so what is
// stored and downloaded is unchanged. If the database has not been updated with the newer
// append_list_chunk_compact function yet, the older (bigger) format is used automatically.
const REF_UPLOAD_PARALLEL = 4;

function refMissingFunction(err) {
    return !!err && (err.code === 'PGRST202' || /could not find the function|does not exist/i.test(err.message || ''));
}

async function refUploadList(listType, rows, onProgress) {
    const report = onProgress || function () {};
    report(0);
    let r = await supabaseClient.rpc('begin_list_upload', { p_list_type: listType });
    if (r.error) throw r.error;

    const keySet = new Set();
    rows.forEach(o => { for (const k in o) keySet.add(k); });
    const keys = Array.from(keySet);
    const chunkCount = Math.ceil(rows.length / REF_UPLOAD_CHUNK);
    let compact = true;
    let sentRows = 0;
    let failure = null;
    let nextSeq = 0;

    async function sendChunk(seq) {
        const chunk = rows.slice(seq * REF_UPLOAD_CHUNK, (seq + 1) * REF_UPLOAD_CHUNK);
        if (compact) {
            const res = await supabaseClient.rpc('append_list_chunk_compact', {
                p_list_type: listType, p_seq: seq, p_keys: keys,
                p_rows: chunk.map(o => keys.map(k => (o[k] == null ? '' : String(o[k]))))
            });
            if (!res.error) return;
            if (!refMissingFunction(res.error)) throw res.error;
            compact = false;                       // database not updated yet: use the older format
        }
        const res = await supabaseClient.rpc('append_list_chunk', { p_list_type: listType, p_seq: seq, p_rows: chunk });
        if (res.error) throw res.error;
        return chunk.length;
    }

    async function worker() {
        while (!failure) {
            const seq = nextSeq++;
            if (seq >= chunkCount) return;
            try {
                await sendChunk(seq);
                sentRows += Math.min(REF_UPLOAD_CHUNK, rows.length - seq * REF_UPLOAD_CHUNK);
                report(sentRows / rows.length * 95);
            } catch (e) { failure = failure || e; return; }
        }
    }
    await Promise.all(Array.from({ length: Math.min(REF_UPLOAD_PARALLEL, chunkCount) }, worker));
    if (failure) throw failure;

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
        if (parsed.duplicates && parsed.duplicates.length) {
            const uniqueLabel = refHeaderLabel(def.columns.find(c => c.key === def.unique));
            alert('Upload stopped: ' + parsed.duplicates.length + ' ' + uniqueLabel + '(s) appear more than once.\n' +
                parsed.duplicates.slice(0, 10).map(d => d.value + ' (rows ' + d.rows.join(', ') + ')').join('\n') +
                (parsed.duplicates.length > 10 ? '\n...' : '') +
                '\n\nRemove the duplicates and upload again. Nothing was changed.');
            return;
        }
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
