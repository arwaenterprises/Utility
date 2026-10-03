// Camera scanner (Box Segregate + Price Check): stays open, keeps scanning, vibrates, torch, closes properly.
// The test browser has no camera, so the scanner library is replaced by a fake that lets the test "see" codes.
const { start, openApp, report, stop } = require('./helpers/harness');

(async () => {
  const ctx = await start();
  const { page, errors } = await openApp(ctx);
  const log = await page.evaluate(async () => {
    const log = []; const ok = (name, cond, extra) => log.push({ pass: !!cond, name, extra: cond ? '' : String(extra === undefined ? '' : extra) });
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    window.alert = (m) => { window.__alerts = (window.__alerts || []).concat(m); };
    window.__vibrations = []; navigator.vibrate = (ms) => { window.__vibrations.push(ms); return true; };
    // fake library
    window.__cams = [];
    window.Html5Qrcode = class {
      constructor(id, cfg) { this.id = id; this.cfg = cfg; this.stopped = false; this.torch = false; window.__cams.push(this); }
      async start(facing, conf, onOk) { this.facing = facing; this.conf = conf; this.onOk = onOk; }
      async stop() { this.stopped = true; }
      clear() {}
      getRunningTrackCameraCapabilities() { const me = this; return { torchFeature: () => ({ isSupported: () => window.__torchSupported !== false, apply: async (on) => { me.torch = on; } }) }; }
    };
    AppState.user = { id: 'u1', email: 'a@b.c' }; AppState.profile = { display_name: 'Ann', enterprise_id: 'E1', tier: 'enterprise_admin' };

    // ---- Price Check ----
    window.__prices = { '111': { Current_Price: '10' }, '222': { Current_Price: '20' } };
    window.pcDbGet = async (code) => window.__prices[code] || null;      // the local price list
    openApp('priceCheck'); document.getElementById('helpCloseBtn').click();
    const find = (id) => document.getElementById(id);
    ok('camera is closed to begin with', find('pcCamOverlay').style.display === 'none');
    await togglePcCamera();
    const cam = window.__cams[0];
    ok('tapping the camera opens it on the back camera, with the built-in detector requested when available', find('pcCamOverlay').style.display === 'block' && cam.facing.facingMode === 'environment' && cam.cfg.experimentalFeatures.useBarCodeDetectorIfSupported === true);
    ok('the picture is read whole (no fixed scan box), at 10 frames a second', cam.conf.fps === 10 && cam.conf.qrbox === undefined);
    ok('the button becomes a cross', find('pcCamBtn').textContent === '✕');
    ok('a torch button shows because the camera has a torch', find('pcTorchBtn').style.display !== 'none');
    cam.onOk('111'); await sleep(80);
    ok('first code: price shown, camera STAYS OPEN', /10/.test(find('pcResultCard').textContent) && find('pcCamOverlay').style.display === 'block' && !cam.stopped, find('pcResultCard').textContent);
    ok('the phone vibrated once', window.__vibrations.length === 1);
    cam.onOk('111'); cam.onOk('111'); await sleep(50);
    ok('the same code seen again straight away is ignored (no second buzz)', window.__vibrations.length === 1);
    cam.onOk('222'); await sleep(80);
    ok('a different code is read at once: next price shown, camera still open', /20/.test(find('pcResultCard').textContent) && window.__vibrations.length === 2 && !cam.stopped);
    // the result sits UNDER the camera
    const camBox = find('pcCamOverlay').getBoundingClientRect(), resBox = find('pcResultCard').getBoundingClientRect();
    ok('the result is displayed below the camera view', resBox.top >= camBox.bottom - 1, camBox.bottom + ' / ' + resBox.top);
    ok('the camera view is compact (about 130px picture + a button bar)', camBox.height < 220, camBox.height);
    cam.onOk('999'); await sleep(80);
    ok('an unknown code shows "not found" and keeps scanning', /999/.test(document.getElementById('pcResultCard').textContent + document.body.textContent) && !cam.stopped);
    await find('pcTorchBtn').click(); await sleep(30);
    ok('torch button switches the light on', cam.torch === true && find('pcTorchBtn').classList.contains('on'));
    await find('pcTorchBtn').click(); await sleep(30);
    ok('...and off again', cam.torch === false && !find('pcTorchBtn').classList.contains('on'));
    await stopPcCamera();
    ok('closing releases the camera, hides the panel and torch', cam.stopped && find('pcCamOverlay').style.display === 'none' && find('pcTorchBtn').style.display === 'none' && find('pcCamBtn').textContent === '📷');

    // no torch on this phone
    window.__torchSupported = false;
    await togglePcCamera();
    ok('no torch button when the camera has no torch', find('pcTorchBtn').style.display === 'none');
    // leaving the tool closes the camera
    const cam2 = window.__cams[window.__cams.length - 1];
    goToHome();
    await sleep(30);
    ok('going back to Home closes the camera', cam2.stopped && find('pcCamOverlay').style.display === 'none');
    window.__torchSupported = true;

    // sending the app to the background closes it
    openApp('priceCheck'); document.getElementById('helpCloseBtn')?.click();
    await togglePcCamera(); const cam3 = window.__cams[window.__cams.length - 1];
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange')); await sleep(30);
    ok('hiding the app (locked screen / another app) releases the camera', cam3.stopped);
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    await stopPcCamera();

    // ---- Box Segregate ----
    window.__camErrors = 0;
    openApp('boxSegregate'); document.getElementById('helpCloseBtn')?.click();
    buildBsMap([{ box_number: 'B100', Document_No: 'D1' }, { box_number: 'B200', Document_No: 'D2' }]);
    await toggleBsCamera(); const bcam = window.__cams[window.__cams.length - 1];
    ok('Box Segregate opens the same compact camera', find('bsCamOverlay').style.display === 'block' && bcam.id === 'bsQrReader');
    bcam.onOk('B100'); await sleep(80);
    ok('a box code is looked up and shown, camera stays open', /B100/.test(document.body.textContent) && !bcam.stopped);
    bcam.onOk('B200'); await sleep(80);
    ok('the next box is scanned without touching anything', /B200/.test(document.body.textContent) && !bcam.stopped);
    await stopBsCamera();
    ok('closing works', bcam.stopped && find('bsCamOverlay').style.display === 'none');
    ok('no unexpected alerts', !(window.__alerts || []).length, JSON.stringify(window.__alerts));
    return log;
  });
  const fails = report(log, errors);
  await stop(ctx);
  process.exit(fails ? 1 : 0);
})();
