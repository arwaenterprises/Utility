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
    ok('no unexpected alerts (library engine)', !(window.__alerts || []).length, JSON.stringify(window.__alerts));

    // ============ the phone's own detector: "+", nearest barcode wins, red rectangle ============
    window.__alerts = [];
    window.__streams = [];
    const realGum = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (c) => { const st = await realGum(c); window.__streams.push(st); return st; };
    window.__torchCalls = [];
    MediaStreamTrack.prototype.getCapabilities = function () { return { torch: window.__hasTorch !== false }; };
    MediaStreamTrack.prototype.applyConstraints = async function (c) { window.__torchCalls.push(JSON.stringify(c)); };
    window.__dets = [];
    window.BarcodeDetector = class { static async getSupportedFormats() { return ['qr_code', 'code_128', 'ean_13']; } async detect(v) { if (window.__detFail) throw new Error('not supported on this phone'); return window.__dets.map(d => d(v)); } };
    // a detection placed by picture coordinates relative to the picture centre
    const box = (value, dx, dy, w = 80, h = 40) => (v) => { const cx = v.videoWidth / 2 + dx, cy = v.videoHeight / 2 + dy; const x = cx - w / 2, y = cy - h / 2;
      return { rawValue: value, format: 'code_128', boundingBox: { x, y, width: w, height: h }, cornerPoints: [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }] }; };

    openApp('priceCheck'); document.getElementById('helpCloseBtn')?.click();
    window.__prices['777'] = { Current_Price: '77' }; window.__prices['888'] = { Current_Price: '88' };
    window.__vibrations.length = 0;
    await togglePcCamera(); await sleep(400);
    ok('with the built-in detector the picture is a real video inside the strip', pcCamera.engine === 'native' && !!document.querySelector('#pcQrReader video') && find('pcCamOverlay').style.display === 'block', pcCamera.engine);
    ok('a transparent layer for the "+" and rectangles sits over the picture', !!document.querySelector('#pcCamOverlay canvas.cam-hud'));
    const hud = document.querySelector('#pcCamOverlay canvas.cam-hud');
    const hudBox = hud.getBoundingClientRect(), stripBox = find('pcQrReader').getBoundingClientRect();
    ok('...and it covers exactly the visible strip', Math.abs(hudBox.top - stripBox.top) < 2 && Math.abs(hudBox.height - stripBox.height) < 2 && stripBox.height < 150, hudBox.height + ' vs ' + stripBox.height);
    const dpr = window.devicePixelRatio || 1;
    const px = (x, y) => { const d = hud.getContext('2d').getImageData(Math.round(x * dpr), Math.round(y * dpr), 1, 1).data; return [d[0], d[1], d[2], d[3]]; };
    const isRed = (c) => c[0] > 200 && c[1] < 90 && c[2] < 90 && c[3] > 150;
    await sleep(120);
    const sw = stripBox.width, sh = stripBox.height;
    ok('a red "+" is drawn at the centre of the strip', isRed(px(sw / 2, sh / 2 - 6)) || isRed(px(sw / 2 + 6, sh / 2)) || isRed(px(sw / 2 - 6, sh / 2)), px(sw / 2, sh / 2 - 6));

    // two barcodes in view: one on the "+", one off to the side
    window.__dets = [box('777', 0, 0), box('888', 90, 0)];
    await sleep(400);
    ok('the barcode nearest the "+" is the one read', /77/.test(find('pcResultCard').textContent) && document.getElementById('pcBarcodeInput').value === '777', document.getElementById('pcBarcodeInput').value);
    ok('only one code was registered and the phone vibrated once', window.__vibrations.length === 1);
    const q = pcCamera.read;
    ok('a red rectangle is kept for the barcode that was read', !!q && q.length === 4);
    const midLeft = { x: (q[0].x + q[3].x) / 2, y: (q[0].y + q[3].y) / 2 };
    await sleep(60);
    ok('...and it is really drawn in red on its edge', [0, 1, 2, 3].some(i => isRed(px(midLeft.x + i - 1, midLeft.y))), px(midLeft.x, midLeft.y) + ' @ ' + midLeft.x + ',' + midLeft.y);
    ok('the other barcode in view is only outlined faintly (not read)', pcCamera.others.length === 1);
    // the user moves so the OTHER barcode is on the "+"
    window.__dets = [box('777', -90, 0), box('888', 0, 0)];
    await sleep(400);
    ok('moving the "+" onto the other barcode reads that one next', document.getElementById('pcBarcodeInput').value === '888' && /88/.test(find('pcResultCard').textContent) && window.__vibrations.length === 2);
    // a barcode outside the visible strip is ignored
    window.__dets = [box('777', 0, -9999)];
    await sleep(300);
    ok('a barcode outside the visible strip is ignored', document.getElementById('pcBarcodeInput').value === '888' && window.__vibrations.length === 2);
    // the rectangle goes away when nothing is read any more
    window.__dets = []; await sleep(1000);
    ok('the red rectangle fades away after the barcode leaves the view', pcCamera.read === null || Date.now() > pcCamera.readUntil);
    // torch with the native engine
    ok('torch button shows (this camera reports a torch)', find('pcTorchBtn').style.display !== 'none');
    await find('pcTorchBtn').click(); await sleep(50);
    ok('torch on: asks the camera for the torch', window.__torchCalls.some(c => /"torch":true/.test(c)) && find('pcTorchBtn').classList.contains('on'), window.__torchCalls.join());
    await stopPcCamera();
    ok('closing stops the camera stream completely', window.__streams.every(st => st.getTracks().every(t => t.readyState === 'ended')) && !document.querySelector('#pcQrReader video'));

    // the built-in detector exists but fails on this phone: the library takes over
    window.__detFail = true;
    window.__cams.length = 0;
    await togglePcCamera(); await sleep(500);
    ok('if the built-in detector fails, the library takes over and the camera stays usable', pcCamera.engine === 'library' && window.__cams.length === 1 && find('pcCamOverlay').style.display === 'block', pcCamera.engine);
    await stopPcCamera(); window.__detFail = false;

    // Box Segregate with the built-in detector
    openApp('boxSegregate'); document.getElementById('helpCloseBtn')?.click();
    window.__dets = [box('B100', 0, 0)];
    await toggleBsCamera(); await sleep(400);
    ok('Box Segregate uses the same camera with the "+" and the result below', bsCamera.engine === 'native' && /B100/.test(document.body.textContent) && !!document.querySelector('#bsCamOverlay canvas.cam-hud'));
    await stopBsCamera();
    ok('no unexpected alerts', !(window.__alerts || []).length, JSON.stringify(window.__alerts));
    return log;
  });
  const fails = report(log, errors);
  await stop(ctx);
  process.exit(fails ? 1 : 0);
})();
