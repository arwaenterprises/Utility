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

    AppState.isOnline = true; await autoSyncScans();                           // online but server failing
    ok('failed upload keeps scans pending', badge() === '2' && serverScans() === 0);
    window.__fail = false; await autoSyncScans();                              // server recovers
    ok('recovered upload clears the badge', badge() === '✓' && serverScans() === 2, badge());
    (await getAllScans()).forEach(s => s.synced = false); for (const s of await getAllScans()) await updateScan(s);
    await autoSyncScans();
    ok('resending the same scans does not duplicate rows', serverScans() === 2);
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
    return log;
  });
  const failures = report(log, errors.filter(e => !/Failed to load resource/.test(e)));
  await stop(ctx);
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('TEST CRASH', e); process.exit(1); });
