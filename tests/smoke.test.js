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
    // Help guides: every tool has one; it opens by itself once, and the "?" button opens it again.
    const modal = () => document.getElementById('helpModal').classList.contains('active');
    for (const id of APPS.map(a => a.id)) {
      localStorage.clear();
      ok('help guide written in English for: ' + id, !!HELP[id] && HELP[id].en.steps.length >= 3);
      ok('help guide written in Arabic for: ' + id, !!HELP[id].ar && HELP[id].ar.steps.length === HELP[id].en.steps.length && /[\u0600-\u06FF]/.test(HELP[id].ar.intro) && !!HELP[id].ar.before === !!HELP[id].en.before);
      openApp(id);
      ok('guide opens by itself the first time: ' + id, modal());
      const title = document.getElementById('helpTitle').textContent;
      document.getElementById('helpCloseBtn').click();
      ok('"Got it" closes the guide: ' + id, !modal() && title.includes(APPS.find(a => a.id === id).name));
      openApp(id);
      ok('guide does not open by itself the second time: ' + id, !modal());
      document.getElementById('helpBtn').click();
      ok('"?" button opens the guide again: ' + id, modal());
      document.querySelector('#helpLang [data-lang="ar"]').click();
      ok('Arabic toggle shows the guide right-to-left: ' + id, document.getElementById('helpBody').dir === 'rtl' && /[\u0600-\u06FF]/.test(document.getElementById('helpBody').textContent));
      document.querySelector('#helpLang [data-lang="en"]').click();
      ok('English toggle brings it back: ' + id, document.getElementById('helpBody').dir === 'ltr' && !/[\u0600-\u06FF]/.test(document.getElementById('helpBody').textContent));
      document.getElementById('helpCloseBtn').click();
    }
    // Long-press hints for icon buttons (phones have no hover).
    const touch = (el, type) => el.dispatchEvent(new PointerEvent(type, { pointerType: 'touch', bubbles: true, cancelable: true, clientX: 50, clientY: 50 }));
    const wait = ms => new Promise(r => setTimeout(r, ms));
    localStorage.clear(); openApp('boxSegregate'); document.getElementById('helpCloseBtn').click();
    const hb = document.getElementById('helpBtn');
    touch(hb, 'pointerdown'); await wait(650);
    const bubble = document.querySelector('.longpress-tip');
    ok('long-press on an icon shows what it does', !!bubble && bubble.textContent === 'How to use this tool', bubble && bubble.textContent);
    touch(hb, 'pointerup'); hb.click();
    ok('the release after a long press does not press the button', !document.getElementById('helpModal').classList.contains('active'));
    await wait(100); touch(hb, 'pointerdown'); touch(hb, 'pointerup'); hb.click();
    ok('a normal quick tap still works', document.getElementById('helpModal').classList.contains('active') && !document.querySelector('.longpress-tip'));
    document.getElementById('helpCloseBtn').click();
    localStorage.setItem('aku_help_lang', 'ar');
    touch(hb, 'pointerdown'); await wait(650); touch(hb, 'pointerup'); hb.click();
    const ab = document.querySelector('.longpress-tip');
    ok('long-press hint appears in Arabic when Arabic is chosen', !!ab && /[\u0600-\u06FF]/.test(ab.textContent) && ab.dir === 'rtl', ab && ab.textContent);
    localStorage.clear();
    const dyn = document.createElement('button'); dyn.className = 'delete-scan-btn'; dyn.textContent = '✕'; document.body.appendChild(dyn);
    touch(dyn, 'pointerdown'); await wait(650); touch(dyn, 'pointerup');
    ok('buttons created later (no title) still get a hint', document.querySelector('.longpress-tip') && document.querySelector('.longpress-tip').textContent === 'Delete this scan');
    dyn.remove();
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
  const cleared = await page.evaluate(async () => { await clearAppCaches(); return { regs: (await navigator.serviceWorker.getRegistrations()).length, caches: (await caches.keys()).length }; });
  log.push({ pass: cleared.regs === 0 && cleared.caches === 0, name: '"Update now" step clears the old service worker and the offline file cache', extra: JSON.stringify(cleared) });
  const failures = report(log, errors.filter(e => !/Failed to load resource/.test(e)));
  await stop(ctx);
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('TEST CRASH', e); process.exit(1); });
