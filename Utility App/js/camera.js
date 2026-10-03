// ============================================
// CAMERA SCANNER (Box Segregate, Price Check)
// ============================================
// A compact camera that STAYS OPEN and keeps scanning. A "+" marks the spot the camera is aiming at. When several
// barcodes are in view, the one NEAREST the "+" is the one that is read, and a red rectangle is drawn around it
// (the other barcodes get a faint white outline so you can see they were seen but not chosen). Each read vibrates
// the phone and hands the code to the tool, whose result shows underneath. The same code is not read twice in a row.
//
// Two engines:
//  1. The phone's own BarcodeDetector (Chrome on Android) - fast, reads QR and 1D barcodes, and reports WHERE each
//     barcode is, which is what makes the rectangle and "nearest the +" possible.
//  2. Fallback (browsers without it): the html5-qrcode library served from this site. It only reports the text, so
//     there is just the "+" and no rectangle, and no choice between several barcodes.
// A torch button appears only when the camera has a torch. The camera is released when the tool is closed, the app
// goes to the background, or the person signs out.
const Camera = (function () {
    const SAME_CODE_PAUSE_MS = 2500;      // the same code seen again within this time is ignored
    const DETECT_EVERY_MS = 90;           // native engine: ~11 looks a second
    const READ_BOX_MS = 700;              // how long the red rectangle stays after the last sighting
    const instances = [];

    function create(cfg) {
        // cfg: { btnId, overlayId, readerId, torchBtnId, onCode(text) }
        const inst = {
            active: false, engine: null, torchOn: false, lastText: '', lastAt: 0,
            qr: null,                                   // fallback engine
            stream: null, video: null, detector: null, timer: null, busy: false,      // native engine
            hud: null, raf: 0, others: [], read: null, readUntil: 0
        };
        const el = (id) => document.getElementById(id);

        function setButton(active) {
            const b = el(cfg.btnId);
            if (b) { b.classList.toggle('active', active); b.textContent = active ? '✕' : '📷'; }
        }
        function buzz() {
            try { if (navigator.vibrate) navigator.vibrate(80); } catch (e) { /* not supported (e.g. iPhone): fine */ }
        }
        // Accept a code unless it is the one just read.
        function accept(text) {
            const now = Date.now();
            const repeat = text === inst.lastText && now - inst.lastAt < SAME_CODE_PAUSE_MS;
            inst.lastText = text; inst.lastAt = now;
            if (repeat) return false;
            buzz();
            cfg.onCode(text);
            return true;
        }

        // ---------- the "+" and the rectangles (a transparent layer over the picture) ----------
        function ensureHud() {
            const overlay = el(cfg.overlayId);
            let c = overlay.querySelector('canvas.cam-hud');
            if (!c) { c = document.createElement('canvas'); c.className = 'cam-hud'; overlay.insertBefore(c, overlay.firstChild); }
            inst.hud = c;
        }
        function viewSize() {
            const r = el(cfg.readerId).getBoundingClientRect();
            return { w: Math.max(1, Math.round(r.width)), h: Math.max(1, Math.round(r.height)) };
        }
        // Picture pixels -> screen pixels, as the picture is shown (centred, cropped to fill the strip).
        function mapper() {
            const v = inst.video, s = viewSize();
            if (!v || !v.videoWidth) return null;
            const k = Math.max(s.w / v.videoWidth, s.h / v.videoHeight);
            const ox = (s.w - v.videoWidth * k) / 2, oy = (s.h - v.videoHeight * k) / 2;
            return { pt: (p) => ({ x: p.x * k + ox, y: p.y * k + oy }), w: s.w, h: s.h };
        }
        function quadOf(d, m) {
            const pts = (d.cornerPoints && d.cornerPoints.length === 4) ? d.cornerPoints
                : (d.boundingBox ? [{ x: d.boundingBox.x, y: d.boundingBox.y }, { x: d.boundingBox.x + d.boundingBox.width, y: d.boundingBox.y },
                                    { x: d.boundingBox.x + d.boundingBox.width, y: d.boundingBox.y + d.boundingBox.height }, { x: d.boundingBox.x, y: d.boundingBox.y + d.boundingBox.height }] : null);
            return pts ? pts.map(m.pt) : null;
        }
        function drawHud() {
            if (!inst.active || !inst.hud) return;
            const s = viewSize(), dpr = window.devicePixelRatio || 1;
            if (inst.hud.width !== Math.round(s.w * dpr) || inst.hud.height !== Math.round(s.h * dpr)) { inst.hud.width = Math.round(s.w * dpr); inst.hud.height = Math.round(s.h * dpr); }
            const g = inst.hud.getContext('2d');
            g.setTransform(dpr, 0, 0, dpr, 0, 0);
            g.clearRect(0, 0, s.w, s.h);
            const poly = (q, stroke, fill, width) => {
                g.beginPath(); g.moveTo(q[0].x, q[0].y); for (let i = 1; i < q.length; i++) g.lineTo(q[i].x, q[i].y); g.closePath();
                if (fill) { g.fillStyle = fill; g.fill(); }
                g.lineWidth = width; g.strokeStyle = stroke; g.stroke();
            };
            inst.others.forEach(q => poly(q, 'rgba(255,255,255,0.55)', null, 1.5));          // seen, not chosen
            if (inst.read && Date.now() < inst.readUntil) poly(inst.read, '#ff2d2d', 'rgba(255,45,45,0.18)', 3);   // the one that was read
            // the "+" : where the camera is aiming
            const cx = s.w / 2, cy = s.h / 2, a = 13;
            g.lineCap = 'round';
            for (const [w, col] of [[4, 'rgba(0,0,0,0.55)'], [2, '#ff2d2d']]) {
                g.lineWidth = w; g.strokeStyle = col;
                g.beginPath(); g.moveTo(cx - a, cy); g.lineTo(cx + a, cy); g.moveTo(cx, cy - a); g.lineTo(cx, cy + a); g.stroke();
            }
        }
        function hudLoop() { drawHud(); inst.raf = inst.active ? requestAnimationFrame(hudLoop) : 0; }

        // ---------- engine 1: the phone's own detector ----------
        async function nativeAvailable() {
            try {
                if (typeof BarcodeDetector === 'undefined') return false;
                if (BarcodeDetector.getSupportedFormats) { const f = await BarcodeDetector.getSupportedFormats(); if (!f || !f.length) return false; }
                return true;
            } catch (e) { return false; }
        }
        async function startNative() {
            inst.stream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false
            });
            const v = document.createElement('video');
            v.setAttribute('playsinline', ''); v.muted = true; v.autoplay = true; v.srcObject = inst.stream;
            const reader = el(cfg.readerId); reader.innerHTML = ''; reader.appendChild(v);
            inst.video = v;
            await v.play().catch(() => {});
            inst.detector = new BarcodeDetector();
            inst.engine = 'native';
            try {
                const caps = inst.stream.getVideoTracks()[0].getCapabilities ? inst.stream.getVideoTracks()[0].getCapabilities() : {};
                if (caps && caps.torch) showTorch();
            } catch (e) { /* no torch */ }
            scheduleLook();
        }
        function scheduleLook() { if (inst.active && inst.engine === 'native') inst.timer = setTimeout(look, DETECT_EVERY_MS); }
        async function look() {
            if (!inst.active || inst.engine !== 'native') return;
            const v = inst.video;
            if (v && v.readyState >= 2 && v.videoWidth) {
                try {
                    const found = await inst.detector.detect(v);
                    if (!inst.active) return;
                    handleFound(found || []);
                } catch (e) {
                    // The built-in detector does not work on this phone after all: use the library instead.
                    console.log('Built-in barcode detector failed, using the library:', e);
                    await switchToFallback();
                    return;
                }
            }
            scheduleLook();
        }
        function handleFound(found) {
            const m = mapper(); if (!m) return;
            // Only barcodes that are visible in the strip count; the one nearest the "+" is chosen.
            const seen = found.map(d => ({ d, q: quadOf(d, m) })).filter(x => x.q && x.d.rawValue).map(x => {
                const cx = x.q.reduce((a, p) => a + p.x, 0) / 4, cy = x.q.reduce((a, p) => a + p.y, 0) / 4;
                return { ...x, cx, cy, dist: Math.hypot(cx - m.w / 2, cy - m.h / 2), visible: cx >= 0 && cx <= m.w && cy >= 0 && cy <= m.h };
            }).filter(x => x.visible);
            if (!seen.length) { inst.others = []; return; }
            seen.sort((a, b) => a.dist - b.dist);
            const target = seen[0];
            inst.others = seen.slice(1).map(x => x.q);
            const fresh = accept(target.d.rawValue);
            if (fresh || target.d.rawValue === inst.lastText) { inst.read = target.q; inst.readUntil = Date.now() + READ_BOX_MS; }
        }

        // ---------- engine 2: the html5-qrcode library (no positions available) ----------
        async function startFallback() {
            if (typeof Html5Qrcode === 'undefined') throw new Error('Scanner library not loaded yet - please wait a moment and try again.');
            const reader = el(cfg.readerId); reader.innerHTML = '';
            inst.qr = new Html5Qrcode(cfg.readerId, { verbose: false, experimentalFeatures: { useBarCodeDetectorIfSupported: true } });
            // No fixed scan box: the whole picture is read, and the page only SHOWS a narrow strip of it.
            await inst.qr.start({ facingMode: 'environment' }, { fps: 10 }, (text) => accept(text), () => {});
            inst.engine = 'library';
            try {
                const torch = inst.qr.getRunningTrackCameraCapabilities().torchFeature();
                if (torch && torch.isSupported()) showTorch();
            } catch (e) { /* this camera has no torch */ }
        }
        async function switchToFallback() {
            releaseNative();
            try { await startFallback(); } catch (err) { alert('Camera error: ' + err); await inst.stop(); }
        }

        // ---------- torch (both engines) ----------
        function showTorch() {
            const tb = el(cfg.torchBtnId);
            if (tb) { tb.style.display = ''; tb.classList.remove('on'); inst.torchOn = false; }
        }
        inst.toggleTorch = async function () {
            try {
                const on = !inst.torchOn;
                if (inst.engine === 'native' && inst.stream) await inst.stream.getVideoTracks()[0].applyConstraints({ advanced: [{ torch: on }] });
                else if (inst.qr) await inst.qr.getRunningTrackCameraCapabilities().torchFeature().apply(on);
                else return;
                inst.torchOn = on;
                const tb = el(cfg.torchBtnId); if (tb) tb.classList.toggle('on', on);
            } catch (e) { inst.torchOn = false; }
        };

        function releaseNative() {
            if (inst.timer) { clearTimeout(inst.timer); inst.timer = null; }
            if (inst.stream) { inst.stream.getTracks().forEach(t => { try { t.stop(); } catch (e) { /* ignore */ } }); inst.stream = null; }
            if (inst.video) { try { inst.video.srcObject = null; inst.video.remove(); } catch (e) { /* ignore */ } inst.video = null; }
            inst.detector = null;
        }

        inst.start = async function () {
            if (inst.active) return;
            Camera.stopAll();                                   // only one camera at a time
            inst.active = true; inst.lastText = ''; inst.lastAt = 0; inst.others = []; inst.read = null; inst.engine = null;
            setButton(true);
            el(cfg.overlayId).style.display = 'block';
            ensureHud();
            try {
                if (await nativeAvailable()) {
                    try { await startNative(); }
                    catch (err) {
                        if (err && (err.name === 'NotAllowedError' || err.name === 'NotFoundError' || err.name === 'SecurityError')) throw err;
                        releaseNative(); await startFallback();       // anything else: try the library
                    }
                } else {
                    await startFallback();
                }
                hudLoop();
            } catch (err) {
                alert('Camera error: ' + (err && err.message ? err.message : err));
                await inst.stop();
            }
        };

        inst.stop = async function () {
            inst.active = false;
            releaseNative();
            if (inst.qr) {
                try { await inst.qr.stop(); inst.qr.clear(); } catch (e) { /* already stopped */ }
                inst.qr = null;
            }
            if (inst.raf) { cancelAnimationFrame(inst.raf); inst.raf = 0; }
            inst.engine = null; inst.torchOn = false; inst.others = []; inst.read = null;
            const o = el(cfg.overlayId); if (o) o.style.display = 'none';
            const tb = el(cfg.torchBtnId); if (tb) { tb.style.display = 'none'; tb.classList.remove('on'); }
            setButton(false);
        };

        inst.toggle = function () { return inst.active ? inst.stop() : inst.start(); };

        const tb = el(cfg.torchBtnId);
        if (tb) tb.addEventListener('click', inst.toggleTorch);
        instances.push(inst);
        return inst;
    }

    function stopAll() { return Promise.all(instances.map(i => (i.active ? i.stop() : null))); }

    // A camera must never keep running behind a locked screen or another app.
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') stopAll(); });

    return { create, stopAll };
})();
