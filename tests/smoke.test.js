// Smoke test: the app loads, every tool tile is present and every tool opens without errors.
const { start, openApp, report, stop } = require('./helpers/harness');

(async () => {
  const ctx = await start();
  const { page, errors } = await openApp(ctx);
  const log = await page.evaluate(async () => {
    const log = []; const ok = (name, cond, extra) => log.push({ pass: !!cond, name, extra: extra === undefined ? '' : String(extra) });
    window.alert = () => {};
    AppState.user = { id: 'u1', email: 'a@b.c' }; AppState.profile = { display_name: 'Ann', enterprise_id: null, tier: 'individual' };
    renderAppGrid();
    const tiles = [...document.querySelectorAll('.app-tile')].map(t => t.dataset.appId);
    ok('home shows all 6 tools', tiles.join() === 'boxScanner,itemBarcode,boxCode,boxSegregate,priceCheck,yearSegregate', tiles.join());
    for (const id of APPS.map(a => a.id)) {
      let err = '';
      try { await initializeApp(id); await new Promise(r => setTimeout(r, 150)); } catch (e) { err = e.message; }
      ok('tool opens: ' + id, !err && !!document.getElementById(APPS.find(a => a.id === id).containerId), err);
    }
    ok('Year/Season store id comes from the Google account', AppState.storeId === 'a@b.c' && AppState.storeName === 'Ann');
    ok('no Google Apps Script / hard-coded admin code left in the app', typeof CONFIG.GOOGLE_SCRIPT_URL === 'undefined' && typeof CONFIG.ADMIN_CODE === 'undefined' && typeof CONFIG.YS_SCRIPT_URL === 'undefined' && typeof CONFIG.PC_SCRIPT_URL === 'undefined');
    return log;
  });
  // Ask Chrome itself whether this is an installable app (manifest + icons + service worker + secure context).
  await page.waitForTimeout(1500);                                  // let the service worker finish installing
  const cdp = await page.context().newCDPSession(page);
  const m = await cdp.send('Page.getAppManifest');
  const inst = await cdp.send('Page.getInstallabilityErrors');
  const manifestJson = m.data ? JSON.parse(m.data) : {};
  log.push({ pass: !(m.errors || []).length && manifestJson.name === 'Utility', name: 'Chrome reads the manifest without errors', extra: JSON.stringify(m.errors || []) });
  log.push({ pass: (inst.installabilityErrors || []).length === 0, name: 'Chrome reports no reasons the app cannot be installed', extra: JSON.stringify(inst.installabilityErrors || []) });
  const sw = await page.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration(); return r ? (r.active ? 'active' : (r.installing ? 'installing' : 'registered')) : 'none'; });
  log.push({ pass: sw === 'active', name: 'service worker is active (offline files cached)', extra: sw });
  const cached = await page.evaluate(async () => { const keys = await caches.keys(); const c = await caches.open(keys[0]); return (await c.keys()).map(r => new URL(r.url).pathname); });
  log.push({ pass: cached.some(p => p.endsWith('manifest.webmanifest')) && cached.some(p => p.endsWith('icon-512.png')), name: 'manifest and icons are in the offline cache', extra: cached.length + ' files' });
  const failures = report(log, errors.filter(e => !/Failed to load resource/.test(e)));
  await stop(ctx);
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('TEST CRASH', e); process.exit(1); });
