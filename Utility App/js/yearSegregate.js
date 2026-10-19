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

// The Setup button (item master / PTL config: upload, paste, templates, presets) is only for individuals and enterprise admins.
function ysSetupUploadButtons() {
    document.getElementById('ysUploadRow').style.display = refCanUpload() ? 'flex' : 'none';
    const itemsBtn = document.getElementById('ysUploadItemsBtn');
    const ptlBtn = document.getElementById('ysUploadPtlBtn');
    itemsBtn.onclick = () => refStartUpload('ys_item_master', itemsBtn, ysAfterItemsUpload);
    ptlBtn.onclick = () => refStartUpload('ys_ptl_config', ptlBtn, ysAfterPtlUpload);
    document.getElementById('ysSetupBtn').onclick = ysOpenSetup;
    document.getElementById('ysSetupCloseBtn').onclick = () => document.getElementById('ysSetupModal').classList.remove('active');
    document.querySelectorAll('#ysSetupModal [data-ys-tab]').forEach(b => { b.onclick = () => ysSetupTab(b.dataset.ysTab); });
    const pasteItemsBtn = document.getElementById('ysPasteItemsBtn');
    pasteItemsBtn.onclick = async () => {
        const box = document.getElementById('ysPasteItems');
        if (!box.value.trim()) { alert('Paste the rows first (copy them in Excel, header row included).'); return; }
        if (await refUploadPasted('ys_item_master', box.value, pasteItemsBtn, ysAfterItemsUpload)) box.value = '';
    };
    const pastePtlBtn = document.getElementById('ysPastePtlBtn');
    pastePtlBtn.onclick = async () => {
        const box = document.getElementById('ysPastePtl');
        if (!box.value.trim()) { alert('Paste the rows first (copy them in Excel, header row included).'); return; }
        if (await refUploadPasted('ys_ptl_config', box.value, pastePtlBtn, ysAfterPtlUpload)) box.value = '';
    };
    document.getElementById('ysPresetList').onclick = (e) => {
        const btn = e.target.closest('[data-ys-preset]');
        if (btn && !btn.disabled) ysPickPreset(btn.dataset.ysPreset);
    };
    const rowsEl = document.getElementById('ysPresetRows');
    rowsEl.oninput = (e) => {
        const tr = e.target.closest('tr[data-i]');
        if (!tr) return;
        const row = YSSetup.rows[Number(tr.dataset.i)];
        if (e.target.dataset.f === 'ptl') row.ptl = e.target.value; else row.rule = e.target.value;
        ysSetupRecount();
    };
    rowsEl.onclick = (e) => {
        const del = e.target.closest('[data-ys-del]');
        if (!del) return;
        YSSetup.rows.splice(Number(del.dataset.ysDel), 1);
        ysRenderPresetRows();
    };
    document.getElementById('ysPresetAddBtn').onclick = ysPresetAddRow;
    const applyBtn = document.getElementById('ysPresetApplyBtn');
    applyBtn.onclick = () => refUploadParsed('ys_ptl_config',
        { rows: YSSetup.rows.map(r => ({ ptl_number: String(r.ptl).trim(), rule: String(r.rule).trim() })).filter(r => r.ptl_number) },
        applyBtn, ysAfterPtlUpload);
}

async function ysAfterItemsUpload() {
    await syncItemMaster(null, true);
    await ysUpdateImCount();
    if (document.getElementById('ysSetupModal').classList.contains('active')) await ysOpenSetup();
}

async function ysAfterPtlUpload() {
    await syncHuConfig(true);
    buildHuStates();
    ysRenderHuPanel();
    ysUpdateStats();
    document.getElementById('ysPresetEditor').style.display = 'none';
    YSSetup.preset = null;
    if (document.getElementById('ysSetupModal').classList.contains('active')) ysRenderSetup();
}

// ============================================
// SETUP WINDOW: item master info, current PTL rules, presets (up to 12 PTLs) and the rule editor
// ============================================
const YS_PRESET_PTLS = 12;
const YSSetup = { vals: [], presets: [], preset: null, rows: [], tab: 'items' };

async function ysOpenSetup() {
    const items = await ysDbGetAll(YS_ITEMS_STORE);
    YSSetup.vals = items.map(ysItemValues);
    YSSetup.presets = ysBuildPresets(items);
    ysRenderSetup();
    ysSetupTab(YSSetup.tab);
    document.getElementById('ysSetupModal').classList.add('active');
}

function ysSetupTab(tab) {
    YSSetup.tab = tab;
    document.querySelectorAll('#ysSetupModal [data-ys-tab]').forEach(b => b.classList.toggle('on', b.dataset.ysTab === tab));
    document.getElementById('ysSetupItems').style.display = tab === 'items' ? '' : 'none';
    document.getElementById('ysSetupPtl').style.display = tab === 'ptl' ? '' : 'none';
}

function ysRenderSetup() {
    const cols = Storage.getJSON('ys_item_columns');
    document.getElementById('ysSetupItemsInfo').textContent = YSSetup.vals.length
        ? `${YSSetup.vals.length} items on this device.` + (cols ? ' Columns: ' + Object.values(cols).join(', ') + '.' : '')
        : 'No item master on this device yet.';
    const cur = YSState.huConfig;
    document.getElementById('ysSetupPtlCurrent').innerHTML = cur.length
        ? '<b>Current rules</b> (checked top to bottom):<br>' + cur.map(c => `${escapeHtml(c.ptlNumber)} &nbsp;${escapeHtml(c.rule)}`).join('<br>')
        : 'No PTL config yet - pick a preset below, paste, or upload a file.';
    document.getElementById('ysPresetList').innerHTML = YSSetup.presets.map(p =>
        `<button type="button" class="ys-preset${YSSetup.preset === p.id ? ' on' : ''}" data-ys-preset="${p.id}"${p.rules ? '' : ' disabled'}>` +
        `<b>${escapeHtml(p.name)}</b><span>${escapeHtml(p.rules ? p.rules.length + ' PTLs · ' + p.desc : p.why)}</span></button>`).join('');
}

// Presets are built from the Season / Year values in the item master on this device. Each fits in 12 PTLs:
// when a preset has more values than that, the oldest go into the last PTL. A "*" PTL is added for items
// the preset would otherwise not place (no Season / Year, or another season) when there is room.
function ysBuildPresets(items) {
    const seasonCount = new Map();
    const yearSet = new Set();
    const combos = new Map();
    items.forEach(it => {
        const s = normaliseSeason(it.season);
        const y = Number(it.year) || 0;
        if (s) seasonCount.set(s, (seasonCount.get(s) || 0) + 1);
        if (y) yearSet.add(y);
        if (s && y) combos.set(s + '|' + y, { s, y });
    });
    const seasons = Array.from(seasonCount.keys()).sort((a, b) =>
        (a === 'FW' ? 0 : a === 'SS' ? 1 : 2) - (b === 'FW' ? 0 : b === 'SS' ? 1 : 2) || a.localeCompare(b));
    const years = Array.from(yearSet).sort((a, b) => b - a);
    const sy = (s, y) => `Season=${s}, Year=${y}`;
    const comboList = years.flatMap(y => seasons.filter(s => combos.has(s + '|' + y)).map(s => ({ s, y })));
    const cap = (rules) => rules.length <= YS_PRESET_PTLS ? rules : rules.slice(0, YS_PRESET_PTLS - 1).concat(['*']);
    // newest N years one PTL per season, then one "older" PTL per season
    const lastYears = (n) => {
        if (years.length <= n) return null;
        const cut = years[n];
        const rules = comboList.filter(c => c.y > cut).map(c => sy(c.s, c.y));
        seasons.forEach(s => { if (comboList.some(c => c.s === s && c.y <= cut)) rules.push(`Season=${s}, Year<=${cut}`); });
        return cap(rules);
    };
    const noData = !seasons.length && !years.length ? 'Needs Season / Year in the item master' : null;
    const list = [
        { id: 'sy', name: 'Season + Year', desc: 'one PTL per season and year, newest first',
          rules: comboList.length ? cap(comboList.map(c => sy(c.s, c.y))) : null, why: 'Needs Season and Year' },
        { id: 'last1', name: 'Latest year + older', desc: 'latest year by season, older grouped by season', rules: lastYears(1), why: 'Needs 2 or more years' },
        { id: 'last2', name: 'Last 2 years + older', desc: 'last 2 years by season, older grouped', rules: lastYears(2), why: 'Needs 3 or more years' },
        { id: 'last3', name: 'Last 3 years + older', desc: 'last 3 years by season, older grouped', rules: lastYears(3), why: 'Needs 4 or more years' },
        { id: 'last5', name: 'Last 5 years + older', desc: 'last 5 years by season, older grouped', rules: lastYears(5), why: 'Needs 6 or more years' },
        { id: 'season', name: 'Season only', desc: 'one PTL per season', rules: seasons.length ? cap(seasons.map(s => `Season=${s}`)) : null, why: 'Needs Season' },
        { id: 'year', name: 'Year only', desc: 'one PTL per year, newest first',
          rules: years.length ? (years.length <= YS_PRESET_PTLS ? years.map(y => `Year=${y}`)
              : years.slice(0, YS_PRESET_PTLS - 1).map(y => `Year=${y}`).concat([`Year<=${years[YS_PRESET_PTLS - 1]}`])) : null, why: 'Needs Year' },
        { id: 'newold', name: 'New vs old', desc: `last 2 years in one PTL, older in another`,
          rules: years.length > 2 ? [`Year>=${years[1]}`, `Year<${years[1]}`] : null, why: 'Needs 3 or more years' }
    ];
    const vals = items.map(ysItemValues);
    list.forEach(p => {
        if (noData) { p.rules = null; p.why = noData; return; }
        if (!p.rules || p.rules.includes('*') || p.rules.length >= YS_PRESET_PTLS) return;
        const compiled = p.rules.map(ysCompiledRule);
        if (vals.some(v => !compiled.some(r => ysRuleMatches(r, v)))) p.rules = p.rules.concat(['*']);
    });
    return list;
}

function ysPickPreset(id) {
    const p = YSSetup.presets.find(x => x.id === id);
    if (!p || !p.rules) return;
    YSSetup.preset = id;
    YSSetup.rows = p.rules.map((rule, i) => ({ ptl: String(i + 1).padStart(2, '0'), rule }));
    document.getElementById('ysPresetTitle').textContent = `${p.name} - edit any rule, add or remove PTLs, then Apply`;
    document.getElementById('ysPresetEditor').style.display = '';
    ysRenderSetup();
    ysRenderPresetRows();
    document.getElementById('ysPresetEditor').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// "+ Add PTL": the next free number, placed before a final "*" row so the catch-all stays last.
function ysPresetAddRow() {
    const max = YSSetup.rows.reduce((m, r) => Math.max(m, parseInt(r.ptl, 10) || 0), 0);
    const row = { ptl: String(max + 1).padStart(2, '0'), rule: '' };
    const last = YSSetup.rows[YSSetup.rows.length - 1];
    if (last && last.rule.trim() === '*') YSSetup.rows.splice(YSSetup.rows.length - 1, 0, row); else YSSetup.rows.push(row);
    ysRenderPresetRows();
    const inputs = document.querySelectorAll('#ysPresetRows input[data-f="rule"]');
    const idx = YSSetup.rows.indexOf(row);
    if (inputs[idx]) inputs[idx].focus();
}

function ysRenderPresetRows() {
    document.getElementById('ysPresetRows').innerHTML = YSSetup.rows.map((r, i) =>
        `<tr data-i="${i}"><td class="ys-preset-ptl"><input data-f="ptl" value="${escapeHtml(r.ptl)}" aria-label="PTL number"></td>` +
        `<td><input data-f="rule" value="${escapeHtml(r.rule)}" placeholder="e.g. Season=FW, Year=2025" aria-label="Rule"></td>` +
        `<td class="n" data-count="${i}"></td>` +
        `<td><button type="button" class="ys-preset-del" data-ys-del="${i}" title="Remove this PTL" aria-label="Remove this PTL">✕</button></td></tr>`).join('');
    ysSetupRecount();
}

// Items per row with the real matching (first match from the top wins), from the item master on this device.
function ysSetupRecount() {
    const compiled = YSSetup.rows.map(r => ysParseRule(r.rule));
    const hits = compiled.map(() => 0);
    let unmatched = 0;
    for (const v of YSSetup.vals) {
        const i = compiled.findIndex(r => ysRuleMatches(r, v));
        if (i >= 0) hits[i]++; else unmatched++;
    }
    compiled.forEach((r, i) => {
        const td = document.querySelector(`#ysPresetRows [data-count="${i}"]`);
        if (!td) return;
        td.textContent = r.error ? '⚠ ' + r.error : String(hits[i]);
        td.className = 'n' + (r.error || hits[i] === 0 ? ' warn' : '');
        td.title = r.error || (hits[i] === 0 ? 'No item goes here (a typo, or a rule above takes them)' : '');
    });
    document.getElementById('ysPresetUnmatched').textContent = YSSetup.vals.length
        ? (unmatched ? `${unmatched} items match no rule (they would show "Not configured").` : 'Every item has a PTL.')
        : 'No item master on this device, so the rules cannot be tried.';
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
// Columns other than Barcode / Season / Year / Brand go into `attrs` under their own header, so a PTL rule
// can use them; the column names are remembered for checking rules at upload.
const YS_ITEM_FIXED = ['barcode', 'season', 'year', 'brand'];
async function ysSaveItemMaster(rows, onProgress) {
    const columns = {};
    const mapped = rows
        .filter(row => row.barcode)
        .map(row => {
            const item = {
                barcode: String(row.barcode).trim(),
                year: Number(row.year) || 0,
                season: String(row.season || '').trim().toUpperCase(),
                brand: String(row.brand || '').trim()
            };
            for (const k in row) {
                if (YS_ITEM_FIXED.includes(k)) continue;
                if (!item.attrs) item.attrs = {};
                item.attrs[k] = row[k];
                columns[refNormalizeHeader(k)] = k;
            }
            return item;
        });
    YS_ITEM_FIXED.forEach(k => { columns[k] = refHeaderLabel(k); });
    Storage.setJSON('ys_item_columns', columns);

    await ysDbClearStore(YS_ITEMS_STORE);

    const CHUNK = 5000;
    for (let i = 0; i < mapped.length; i += CHUNK) {
        await ysDbBulkPut(YS_ITEMS_STORE, mapped.slice(i, i + CHUNK));
        if (onProgress) onProgress(Math.min(i + CHUNK, mapped.length) / mapped.length);
    }
    if (onProgress) onProgress(1);
    Storage.set('ys_item_master_ts', ysNow());
}

// One entry per row of the file, in file order (the order decides which rule wins): { ptlNumber, rule }.
function ysSavePtlConfig(rows) {
    const config = rows
        .filter(row => row.ptl_number && String(row.ptl_number).trim() !== '')
        .map(row => ({ ptlNumber: String(row.ptl_number).trim().padStart(2, '0'), rule: ysRowRule(row) }));
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
        // a device that last synced before rules existed has {ptlNumber, season, year, yearLogic}
        YSState.huConfig = cached.map(c => c.rule !== undefined ? c
            : { ptlNumber: c.ptlNumber, rule: ysLegacyRule(c.season, c.year, c.yearLogic) });
        return true;
    }
    return false;
}

// Build fresh HU states from config (merge with existing session states): one per PTL, whose label is
// its rules joined with " / " (a PTL on several rows). Any PTL not in the current config is dropped,
// even if it has existing state.
function buildHuStates() {
    const existing = YSState.huStates;
    const rulesByPtl = new Map();
    YSState.huConfig.forEach(cfg => {
        if (!rulesByPtl.has(cfg.ptlNumber)) rulesByPtl.set(cfg.ptlNumber, []);
        rulesByPtl.get(cfg.ptlNumber).push(cfg.rule);
    });

    YSState.huStates = Array.from(rulesByPtl, ([ptlNumber, rules]) => {
        const rule = rules.join(' / ');
        const prev = existing.find(s => s.ptlNumber === ptlNumber);
        return prev
            ? { ...prev, rule }
            : {
                ptlNumber,
                rule,
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
// The PTL config has two columns, PTL Number and Rule. A rule can name ANY Item Master column:
//   Season=FW, Year<=2024     comma = AND (all must be true)
//   Color=Red+Blue            plus = OR inside one column
//   Color!=Black              != = NOT
//   *                         everything not matched by a row above
// The same PTL Number on several rows = OR across columns. Rows are checked top to bottom and the
// first match wins. Values ignore capitals and end spaces; Season also accepts Fall/Winter etc.
const ysRuleCache = new Map();

function ysParseRule(text) {
    const src = String(text || '').trim();
    if (!src) return { error: 'the Rule is empty' };
    if (src === '*') return { any: true, conds: [] };
    const conds = [];
    for (const part of src.split(',').map(x => x.trim()).filter(Boolean)) {
        const m = part.match(/^([^<>=!]*?)\s*(<=|>=|!=|=|<|>)\s*(.*)$/);
        if (!m) return { error: `"${part}" has no = sign (write Column=value)` };
        const col = refNormalizeHeader(m[1]);
        const op = m[2];
        const values = m[3].split('+').map(v => v.trim()).filter(Boolean);
        if (!col) return { error: `"${part}" has no column name before ${op}` };
        if (!values.length) return { error: `"${part}" has no value after ${op}` };
        const numeric = op === '<=' || op === '>=' || op === '<' || op === '>';
        if (numeric && (values.length > 1 || !isFinite(Number(values[0])))) return { error: `"${part}": ${op} needs one number` };
        const norm = (v) => (col === 'season' ? normaliseSeason(v) : v).toLowerCase();
        conds.push({ col, name: m[1].trim(), op, numeric, values: values.map(norm), num: Number(values[0]) });
    }
    if (!conds.length) return { error: 'the Rule is empty' };
    return { any: false, conds };
}

function ysCompiledRule(text) {
    if (!ysRuleCache.has(text)) ysRuleCache.set(text, ysParseRule(text));
    return ysRuleCache.get(text);
}

// An item's values by normalised column name ("Style ID" -> "styleid"); a missing Year (stored as 0) is empty.
function ysItemValues(item) {
    const vals = {};
    const add = (k, v) => { const n = refNormalizeHeader(k); if (n && !(n in vals)) vals[n] = String(v == null ? '' : v).trim(); };
    add('barcode', item.barcode); add('season', item.season); add('year', item.year ? item.year : ''); add('brand', item.brand);
    if (item.attrs) for (const k in item.attrs) add(k, item.attrs[k]);
    return vals;
}

function ysRuleMatches(rule, vals) {
    if (!rule || rule.error) return false;
    for (const c of rule.conds) {
        const v = vals[c.col] === undefined ? '' : vals[c.col];
        if (c.numeric) {
            if (v === '' || !isFinite(Number(v))) return false;
            const n = Number(v);
            if (!(c.op === '<=' ? n <= c.num : c.op === '>=' ? n >= c.num : c.op === '<' ? n < c.num : n > c.num)) return false;
        } else {
            const hit = c.values.includes((c.col === 'season' ? normaliseSeason(v) : v).toLowerCase());
            if (c.op === '=' ? !hit : hit) return false;
        }
    }
    return true;
}

// Index in YSState.huStates of the PTL whose rule matches first, or -1.
function matchItemToHu(item) {
    const vals = ysItemValues(item);
    for (const cfg of YSState.huConfig) {
        if (ysRuleMatches(ysCompiledRule(cfg.rule), vals)) return YSState.huStates.findIndex(h => h.ptlNumber === cfg.ptlNumber);
    }
    return -1;
}

// Older 4-column configs: Season + Year + Year Logic (lte = that year and earlier, exact = that year only).
function ysLegacyRule(season, year, logic) {
    if (!String(season || '').trim()) return '';
    const y = Number(year) || 0;
    return `Season=${String(season).trim().toUpperCase()}, Year${String(logic || 'lte').trim().toLowerCase() === 'exact' ? '=' : '<='}${y}`;
}
function ysRowRule(row) {
    return String(row.rule || '').trim() || ysLegacyRule(row.season, row.year, row.year_logic);
}

// Upload check (js/lists.js calls it before anything is sent): every row needs a rule that makes sense,
// and its columns must exist in the item master on this device (when one is loaded).
function ysValidatePtlRows(rows) {
    const columns = Storage.getJSON('ys_item_columns');
    const problems = [];
    rows.forEach((row, i) => {
        const ptl = String(row.ptl_number).trim().padStart(2, '0');
        const where = `PTL ${ptl} (rule ${i + 1})`;
        const rule = ysParseRule(ysRowRule(row));
        if (rule.error) { problems.push(`${where}: ${rule.error}`); return; }
        if (columns) rule.conds.filter(c => !(c.col in columns)).forEach(c => problems.push(`${where}: no column "${c.name}" in the item master`));
    });
    if (!problems.length) return null;
    return problems.length + ' problem(s) in the rules:\n' + problems.slice(0, 10).join('\n') + (problems.length > 10 ? '\n...' : '') +
        (columns && problems.some(p => /no column/.test(p)) ? '\n\nItem master columns: ' + Object.values(columns).join(', ') : '');
}

// Upload preview: how many items of the item master on this device each PTL would get.
async function ysPreviewPtlRows(rows) {
    const items = ysDB ? await ysDbGetAll(YS_ITEMS_STORE) : [];
    if (!items.length) return 'Preview: no item master on this device yet, so the rules could not be tried.';
    const config = rows.map(r => ({ ptlNumber: String(r.ptl_number).trim().padStart(2, '0'), rule: ysRowRule(r), hits: 0 }));
    const perPtl = new Map();
    config.forEach(c => perPtl.set(c.ptlNumber, 0));
    let unmatched = 0;
    for (const item of items) {
        const vals = ysItemValues(item);
        const c = config.find(x => ysRuleMatches(ysCompiledRule(x.rule), vals));
        if (c) { c.hits++; perPtl.set(c.ptlNumber, perPtl.get(c.ptlNumber) + 1); } else unmatched++;
    }
    const lines = Array.from(perPtl, ([ptl, n]) => `PTL ${ptl}: ${n} items${n === 0 ? '  ⚠' : ''}`);
    const idle = config.filter(c => c.hits === 0 && perPtl.get(c.ptlNumber) > 0);
    return `Preview with the ${items.length} items on this device:\n` + lines.join('\n') +
        (unmatched ? `\nNot matched by any rule: ${unmatched} items` : '') +
        (idle.length ? '\n⚠ These rules get no items (a typo, or a rule above takes them): ' + idle.map(c => `PTL ${c.ptlNumber} "${c.rule}"`).join('; ') : '');
}

REF_LISTS.ys_ptl_config.validate = async (rows) => ysValidatePtlRows(rows);
REF_LISTS.ys_ptl_config.preview = ysPreviewPtlRows;

function normaliseSeason(s) {
    const upper = String(s || '').toUpperCase().trim();
    if (upper === 'SS' || upper === 'SPRING' || upper === 'SUMMER' || upper === 'SPRING/SUMMER') return 'SS';
    if (upper === 'FW' || upper === 'FALL' || upper === 'WINTER' || upper === 'FALL/WINTER') return 'FW';
    return upper;
}

// Plain text (escape it before putting it in HTML - rules contain < and >).
function huLabel(hu) {
    return hu.rule !== undefined ? hu.rule : ysLegacyRule(hu.season, hu.year, hu.yearLogic);
}

// ============================================
// SCAN LOGIC
// ============================================
async function handleYsScan(e) {
    if (e.key !== 'Enter') return;
    const raw = document.getElementById('ysBarcodeInput').value.trim();
    document.getElementById('ysBarcodeInput').value = '';
    if (!raw) return;
    if (typeof operatorBlocked === 'function' && operatorBlocked()) { alert(opT('blocked')); return; }

    // The first scan begins the session - which needs the Remark.
    if (!YSState.staffName && !(await ysBeginSession())) return;

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

    const huIdx = matchItemToHu(item);
    if (huIdx === -1) {
        ysSetResult('error', barcode, 'Not configured for any PTL', 'Ask your supervisor to add a PTL rule for this item');
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
    const huIdx = matchItemToHu(item);
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
        rule: huLabel(hu),
        season: normaliseSeason(item.season),
        year: item.year,
        brand: item.brand || '',
        attrs: item.attrs || null,
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
    document.getElementById('ysCloseModalSeason').textContent = huLabel(hu);
    document.getElementById('ysCloseModalBox').textContent = hu.boxBarcode;
    document.getElementById('ysCloseModalQty').textContent = hu.itemCount;
    document.getElementById('ysCloseStep1').style.display = 'block';
    document.getElementById('ysCloseStep2').style.display = 'none';
    document.getElementById('ysCloseButtons1').style.display = 'flex';
    document.getElementById('ysCloseButtons2').style.display = 'none';
    document.getElementById('ysCloseBoxInput').value = '';
    ysSetResult('close', `PTL ${ptlPadded}`, 'Close Box', `${huLabel(hu)} — ${hu.itemCount} items`);
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
        ptl_rule: s.rule || null,
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

function ysServerRowForDb(s) {
    const row = ysToServerRow(s);
    if (YSState.noRuleColumn) delete row.ptl_rule;
    return row;
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
            const send = () => supabaseClient.from('ys_scans').upsert(batch.map(ysServerRowForDb), { onConflict: 'scan_uid' });
            let { error } = await send();
            if (error && /ptl_rule/.test(error.message || '') && !YSState.noRuleColumn) {
                // schema.sql not re-run yet: send without the rule rather than leaving scans stuck
                YSState.noRuleColumn = true;
                ({ error } = await send());
            }
            if (error && isPermissionError(error)) {
                // Team membership probably changed since the profile was loaded: re-read it and retry once.
                await refreshProfile(0);
                ({ error } = await send());
            }
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
        if (typeof operatorNoteScanRefused === 'function') operatorNoteScanRefused(YSState.lastSyncError);
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
        'PTL Number', 'PTL Rule', 'Season', 'Year', 'Brand',
        'Barcode', 'Qty', 'Box Barcode', 'Box Status', 'Scan Timestamp'
    ];
    // the item's own extra Item Master columns (Style, Color...) follow, in the order first seen
    const extra = [];
    scans.forEach(s => { if (s.attrs) for (const k in s.attrs) if (!extra.includes(k) && !headers.includes(k)) extra.push(k); });
    headers.push(...extra);

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
        'PTL Rule': s.rule || '',
        'Season': s.season,
        'Year': s.year,
        'Brand': s.brand,
        'Barcode': s.barcode,
        'Qty': s.qty,
        'Box Barcode': s.boxBarcode,
        'Box Status': s.boxStatus,
        'Scan Timestamp': s.scanTimestamp,
        ...Object.fromEntries(extra.map(k => [k, s.attrs && s.attrs[k] != null ? s.attrs[k] : '']))
    }));

    const ws = XLSX.utils.json_to_sheet(rows, { header: headers });
    ws['!cols'] = headers.map(() => ({ wch: 16 }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'YS Scans');
    XLSX.writeFile(wb, `${AppState.storeId}_${YSState.staffName}_YS_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

// ============================================
// RESET SESSION
// ============================================
async function ysShowResetModal() {
    // A session with no scans has nothing to confirm or download: just close it.
    if ((await ysDbGetAll(YS_SCANS_STORE)).length === 0) {
        document.getElementById('ysResetModal').classList.remove('active');
        ysFinishReset();
        return;
    }
    const openPtls = YSState.huStates.filter(h => h.status === 'Open').map(h => `PTL ${h.ptlNumber}`);
    if (openPtls.length > 0) {
        ysShowError(`Cannot reset — ${openPtls.join(', ')} ${openPtls.length === 1 ? 'is' : 'are'} still open. Close all boxes before resetting.`);
        return;
    }
    document.getElementById('ysResetModal').classList.add('active');
}

// Reset only ever clears THIS device (after downloading it and making sure every closed box has reached the
// server). Uploaded data stays on the server until the enterprise admin deletes it in Data Management.
async function ysExecuteReset() {
    document.getElementById('ysResetModal').classList.remove('active');
    // Nothing closed may be lost before the device is cleared: wait until it has reached the server.
    if (AppState.isOnline) await ysAutoSync();
    const pending = (await ysDbGetAll(YS_SCANS_STORE)).filter(s => !s.synced && s.boxStatus === 'Closed');
    if (pending.length > 0) {
        ysUpdateSyncBadge();
        ysShowError("Some closed boxes haven't uploaded yet. Connect to the internet and wait for the sync badge to show ✓, then reset.");
        return;
    }
    await ysDownloadExcel();
    await ysDbClearStore(YS_SCANS_STORE);
    ysFinishReset();
}

// The last step of every Reset: forget the session and go back to the start screen.
function ysFinishReset() {
    clearYsSession();
    setActiveSession('yearSegregate', false);
    updateBackButton();
    return ysOpenFresh();
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
                        <div class="ys-hu-cell-cfg" title="${escapeHtml(huLabel(hu))}">${escapeHtml(huLabel(hu))}</div>
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
                <div class="ys-hu-cell-cfg" title="${escapeHtml(huLabel(hu))}">${escapeHtml(huLabel(hu))}</div>
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
// There is no "Start Session" screen. Opening the tool loads the item master + PTL config (from the device when
// it already has them) and shows the scan screen with an empty Remark. The Remark is mandatory (it tells the
// different jobs apart); the session begins with the first scan and the Remark is then locked until Reset.

// Loads the item master + PTL configuration: from the device cache when present, else from the server with progress.
// Returns false when there is nothing usable to scan with.
async function ysPrepareData() {
    const syncStatus = document.getElementById('ysSyncStatus');
    const syncError = document.getElementById('ysSyncError');
    syncStatus.style.display = 'flex';
    syncError.style.display = 'none';

    const hasCachedHu = loadCachedHuConfig();
    const cachedItemCount = hasCachedHu ? await ysDbCount(YS_ITEMS_STORE) : 0;
    const hasCache = hasCachedHu && cachedItemCount > 0;

    if (!AppState.isOnline) {
        syncStatus.style.display = 'none';
        if (!hasCache) {
            syncError.textContent = 'No internet and no cached data. Connect and try again.';
            syncError.style.display = 'block';
            return false;
        }
    } else if (hasCache) {
        // Cache already populated - skip auto-sync. Use the sync button to refresh manually.
        syncStatus.style.display = 'none';
    } else {
        // First launch or cache cleared - must sync
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

        if (!huOk || !imOk) {
            if (!loadCachedHuConfig()) {
                syncError.textContent = 'Could not load the item master / PTL config. Ask your admin to upload them, or check your connection.';
                syncError.style.display = 'block';
                return false;
            }
            syncError.textContent = 'Using cached data (live sync failed). Proceed with caution.';
            syncError.style.display = 'block';
        }
    }

    // Build/restore HU states
    loadYsHuStates();
    buildHuStates();
    return true;
}

// Once the job has started the Remark goes away completely; before that it is the only thing asked, and the
// scan field stays switched off until a Remark has been typed.
function ysSetRemarkLocked(locked) {
    const input = document.getElementById('ysRemarkInput');
    const jobRemark = typeof operatorRemark === 'function' ? operatorRemark() : '';     // a labourer's Remark is the job name from the QR link
    input.readOnly = locked || !!jobRemark;
    input.classList.toggle('locked', locked || !!jobRemark);
    if (locked) input.value = YSState.remark; else if (jobRemark) input.value = jobRemark;
    document.getElementById('ysRemarkCard').style.display = (locked || jobRemark) ? 'none' : '';
    ysUpdateScanFieldsEnabled();
}

function ysUpdateScanFieldsEnabled() {
    const ready = !!(YSState.staffName || document.getElementById('ysRemarkInput').value.trim()) && !(typeof operatorBlocked === 'function' && operatorBlocked());
    ['ysBarcodeInput', 'ysKbdBtn'].forEach(id => { document.getElementById(id).disabled = !ready; });
}

// Called by the first scan. Needs the Remark and loaded data; the operator's name comes from the signed-in account.
async function ysBeginSession() {
    const input = document.getElementById('ysRemarkInput');
    const remark = input.value.trim();
    if (!remark) { alert('Please enter a remark.'); input.focus(); return false; }
    if (!YSState.huStates.length) {
        ysShowError('The item master and PTL configuration are not loaded yet. Check your connection and tap the sync button, or ask your admin to upload them.');
        return false;
    }
    YSState.staffName = AppState.storeName || 'Operator';
    YSState.remark = remark;
    document.getElementById('ysDispStaff').textContent = YSState.staffName;
    setActiveSession('yearSegregate', true);
    saveYsSession();
    ysSetRemarkLocked(true);
    updateBackButton();
    return true;
}

// The scan screen for a job that has not started: empty Remark, data loaded.
async function ysOpenFresh() {
    ysShowScreen('ysScanScreen');
    document.getElementById('ysRemarkInput').value = '';
    ysSetRemarkLocked(false);
    document.getElementById('ysDispStore').textContent = `${AppState.storeId} - ${AppState.storeName}`;
    const ok = await ysPrepareData();
    if (ok) {
        ysRenderHuPanel();
        ysUpdateStats();
        await ysUpdateTotalStat();
        await ysUpdateImCount();
    }
    updateBackButton();
    document.getElementById('ysRemarkInput').focus();
}

// ============================================
// EVENT LISTENERS
// ============================================
function setupYsEventListeners() {
    document.getElementById('ysBarcodeInput').addEventListener('keypress', handleYsScan);
    document.getElementById('ysRemarkInput').addEventListener('input', ysUpdateScanFieldsEnabled);
    document.getElementById('ysRemarkInput').addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && e.target.value.trim()) { ysUpdateScanFieldsEnabled(); document.getElementById('ysBarcodeInput').focus(); }
    });

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
            ysSetRemarkLocked(true);
            ysRenderHuPanel();
            ysUpdateStats();
            await ysUpdateTotalStat();
    await ysUpdateImCount();
            document.getElementById('ysBarcodeInput').focus();
        } else {
            await ysOpenFresh();
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
        ysSetRemarkLocked(true);
        ysRenderHuPanel();
        ysUpdateStats();
        await ysUpdateTotalStat();
    await ysUpdateImCount();
        updateBackButton();
        document.getElementById('ysBarcodeInput').focus();
    } else {
        await ysOpenFresh();
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
