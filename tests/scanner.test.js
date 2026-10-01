// Box Scanner offline-first behaviour: scans are saved on the device first, closed boxes sync
// to Supabase in the background (idempotently), and Reset follows the account type.
const { start, openApp, report, stop } = require('./helpers/harness');

(async () => {
  const ctx = await start();
  const { page, errors } = await openApp(ctx);
  const log = await page.evaluate(async () => {
    const log = []; const ok = (name, cond, extra) => log.push({ pass: !!cond, name, extra: extra === undefined ? '' : String(extra) });
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const alerts = []; window.alert = m => alerts.push(String(m)); window.confirm = () => true;
    window.XLSX = Object.assign({}, window.XLSX, { writeFile() {} }); // no real downloads
    const badge = () => document.getElementById('syncBadge').textContent;
    const scan = async (code, id) => { const i = document.getElementById(id); i.value = code; await (id === 'boxIdInput' ? handleBoxIdScan : handleBarcodeScan)({ key: 'Enter' }); await sleep(30); };
    const serverScans = () => __db.scans.length;
    const localScans = async () => (await getAllScans()).length;

    // ---------- individual account ----------
    AppState.user = { id: 'u1', email: 'a@b.c' };
    AppState.profile = { display_name: 'Ann', enterprise_id: null, tier: 'individual' };
    AppState.isOnline = true;
    await initBoxScanner();
    document.getElementById('scannerRemarkInput').value = 'R1'; startScannerSession();

    window.__fail = true; AppState.isOnline = false;                        // go offline
    await scan('B1', 'boxIdInput'); await scan('111', 'barcodeInput'); await scan('222', 'barcodeInput');
    ok('offline scans are saved on the device', (await localScans()) === 2 && serverScans() === 0);
    ScannerState.uniqueMode = true; await scan('222', 'barcodeInput');
    ok('No Dup blocks a repeated barcode', (await localScans()) === 2);
    ScannerState.uniqueMode = false;
    await executeCloseBox();
    ok('closed box is pending sync (badge shows count)', badge() === '2' && serverScans() === 0, badge());
    ok('usage statistics wait on the device while offline', __db.usage_daily.length === 0 && Object.keys(Storage.getJSON('usage_pending_u1') || {}).length === 1);

    AppState.isOnline = true; await autoSyncScans();                           // online but server failing
    ok('failed upload keeps scans pending', badge() === '2' && serverScans() === 0);
    window.__fail = false; await autoSyncScans();                              // server recovers
    ok('recovered upload clears the badge', badge() === '✓' && serverScans() === 2, badge());
    (await getAllScans()).forEach(s => s.synced = false); for (const s of await getAllScans()) await updateScan(s);
    await autoSyncScans();
    ok('resending the same scans does not duplicate rows', serverScans() === 2);
    await Usage.flush(); await Usage.flush();
    const bc = __db.usage_daily.filter(u => u.tool === 'box_scanner' && u.action === 'box_closed');
    ok('usage: closed box counted once with its quantity', bc.length === 1 && bc[0].event_count === 1 && bc[0].qty === 2, JSON.stringify(bc));
    ok('usage: pending list is emptied after sending', Object.keys(Storage.getJSON('usage_pending_u1') || {}).length === 0);
    ok('scan ids are valid UUIDs', __db.scans.every(s => /^[0-9a-f-]{36}$/.test(s.scan_uid)));

    await executeResetSession(true);
    ok('individual Reset clears the device AND the server', (await localScans()) === 0 && serverScans() === 0);

    // ---------- enterprise member ----------
    AppState.profile = { display_name: 'Mia', enterprise_id: 'E1', tier: 'enterprise_member' };
    await initBoxScanner();
    document.getElementById('scannerRemarkInput').value = 'R2'; startScannerSession();
    window.__fail = true; AppState.isOnline = false;
    await scan('B2', 'boxIdInput'); await scan('333', 'barcodeInput'); await executeCloseBox();
    alerts.length = 0;
    await executeResetSession(true);
    ok('member Reset is blocked while a closed box has not uploaded', (await localScans()) === 1 && alerts.some(a => /haven't uploaded/.test(a)), alerts.join('|'));
    window.__fail = false; AppState.isOnline = true;
    await executeResetSession(true);
    ok('member Reset clears only the device; the server keeps the data', (await localScans()) === 0 && serverScans() === 1);
    await initBoxScanner();
    ok('member does not pull server data back after Reset', (await localScans()) === 0);

    // ---------- another account on the same device ----------
    AppState.user = { id: 'u2', email: 'x@y.z' }; AppState.profile = { display_name: 'Xi', enterprise_id: null, tier: 'individual' };
    await initBoxScanner();
    ok('each account has its own device database', (await localScans()) === 0);

    // ---------- View Box ----------
    window.__fail = true; AppState.isOnline = false;
    AppState.user = { id: 'u3', email: 'v@w.x' }; AppState.profile = { display_name: 'Vi', enterprise_id: null, tier: 'individual' };
    document.querySelectorAll('.screen').forEach(sc => sc.classList.remove('active')); showScreen('homeScreen'); renderAppGrid();
    openApp('boxScanner'); await sleep(500);
    document.getElementById('scannerRemarkInput').value = 'RV'; startScannerSession(); await sleep(100);
    const visible = el => !!el && el.offsetParent !== null && getComputedStyle(el).display !== 'none';
    const row = document.getElementById('closeBoxRow');
    ok('View Box is available before any box is opened (Close Box is not)', visible(document.getElementById('viewBoxBtn')) && !visible(document.getElementById('closeBoxBtn')));
    await scan('B1', 'boxIdInput'); await scan('11', 'barcodeInput'); await scan('22', 'barcodeInput'); await executeCloseBox();
    await scan('B2', 'boxIdInput'); await scan('33', 'barcodeInput');
    const rw = row.getBoundingClientRect().width, cw = document.getElementById('closeBoxBtn').getBoundingClientRect().width, vw = document.getElementById('viewBoxBtn').getBoundingClientRect().width;
    ok('with a box open, Close Box is 40% of the row', cw / rw > 0.37 && cw / rw < 0.42, (cw / rw).toFixed(3));
    ok('... and View Box sits beside it at about 40%', vw / rw > 0.37 && vw / rw < 0.42 && visible(document.getElementById('scannerKbdBtn')), (vw / rw).toFixed(3));

    const view = async (v) => { const i = document.getElementById('viewBoxScanInput'); i.value = v; await handleViewBoxScan({ key: 'Enter' }); await sleep(30); return document.getElementById('viewBoxResult'); };
    document.getElementById('viewBoxBtn').click(); await sleep(150);
    ok('View Box opens a pop-up with the scan field focused', document.getElementById('viewBoxModal').classList.contains('active') && document.activeElement.id === 'viewBoxScanInput', document.activeElement.id);
    let res = await view('b1');
    ok('a scanned (closed) box shows its content', /B1/.test(res.textContent) && /2 items/.test(res.textContent) && /Closed/.test(res.textContent) && /11/.test(res.textContent) && /22/.test(res.textContent), res.textContent.replace(/\s+/g, ' '));
    res = await view('B2');
    ok('the open box can be viewed too, marked Open', /3|33/.test(res.textContent) && /Open/.test(res.textContent) && /1 items/.test(res.textContent), res.textContent.replace(/\s+/g, ' '));
    ok('the scan field is emptied and ready for the next box', document.getElementById('viewBoxScanInput').value === '');
    res = await view('NOPE');
    ok('a box with no scans says so', /No scans found for this box/.test(res.textContent) && /NOPE/.test(res.textContent), res.textContent.replace(/\s+/g, ' '));
    const rgb = getComputedStyle(document.getElementById('viewBoxCloseBtn')).backgroundColor.match(/\d+/g).map(Number);
    ok('the Close button is red', rgb[0] > 180 && rgb[1] < 90 && rgb[2] < 90, rgb.join());
    document.getElementById('viewBoxCloseBtn').click(); await sleep(50);
    ok('Close shuts the pop-up and returns to the barcode field of the open box', !document.getElementById('viewBoxModal').classList.contains('active') && document.activeElement.id === 'barcodeInput' && ScannerState.currentBox === 'B2' && ScannerState.boxScanning, document.activeElement.id);
    await scan('44', 'barcodeInput');
    ok('scanning continues normally after viewing', (await getAllScans()).filter(x => x.box_number === 'B2').length === 2);
    await executeCloseBox();
    document.getElementById('viewBoxBtn').click(); await sleep(100); res = await view('B2'); document.getElementById('viewBoxCloseBtn').click(); await sleep(50);
    ok('after closing the box, View Box still works and focus returns to the Box ID field', /2 items/.test(res.textContent) && /Closed/.test(res.textContent) && document.activeElement.id === 'boxIdInput', document.activeElement.id);
    ScannerState.language = 'ar'; applyScannerTranslations();
    ok('View Box button is translated (Arabic)', document.getElementById('lblViewBox').textContent === 'عرض الصندوق');
    ScannerState.language = 'en'; applyScannerTranslations();
    return log;
  });
  const failures = report(log, errors.filter(e => !/Failed to load resource/.test(e)));
  await stop(ctx);
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('TEST CRASH', e); process.exit(1); });
