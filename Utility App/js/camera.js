// ============================================
// CAMERA SCANNER (Box Segregate, Price Check)
// ============================================
// A small, compact camera that STAYS OPEN and keeps scanning: every new code is handed to the tool (its lookup
// result shows underneath the camera), the phone vibrates, and the same code is not read twice in a row.
// A torch button appears only when the phone's camera has a torch.
// Engine: the html5-qrcode library served from this site. It is asked to use the browser's built-in
// BarcodeDetector when the phone has one (faster and more accurate), and falls back to its own decoder otherwise.
// The camera is released when the tool is closed, the app is sent to the background, or the person signs out.
const Camera = (function () {
    const SAME_CODE_PAUSE_MS = 2500;      // the same code seen again within this time is ignored
    const instances = [];

    function create(cfg) {
        // cfg: { btnId, overlayId, readerId, torchBtnId, onCode(text) }
        const inst = { active: false, qr: null, torchOn: false, lastText: '', lastAt: 0 };
        const el = (id) => document.getElementById(id);

        function setButton(active) {
            const b = el(cfg.btnId);
            if (b) { b.classList.toggle('active', active); b.textContent = active ? '✕' : '📷'; }
        }
        function buzz() {
            try { if (navigator.vibrate) navigator.vibrate(80); } catch (e) { /* not supported (e.g. iPhone): fine */ }
        }
        function handle(text) {
            const now = Date.now();
            if (text === inst.lastText && now - inst.lastAt < SAME_CODE_PAUSE_MS) { inst.lastAt = now; return; }
            inst.lastText = text; inst.lastAt = now;
            buzz();
            cfg.onCode(text);
        }
        function showTorchIfAvailable() {
            const tb = el(cfg.torchBtnId);
            if (!tb) return;
            tb.style.display = 'none';
            try {
                const torch = inst.qr.getRunningTrackCameraCapabilities().torchFeature();
                if (torch && torch.isSupported()) { tb.style.display = ''; tb.classList.remove('on'); inst.torchOn = false; }
            } catch (e) { /* this camera has no torch */ }
        }

        inst.start = async function () {
            if (inst.active) return;
            if (typeof Html5Qrcode === 'undefined') {
                alert('Scanner library not loaded yet — please wait a moment and try again.');
                return;
            }
            Camera.stopAll();                                   // only one camera at a time
            inst.active = true; inst.lastText = ''; inst.lastAt = 0;
            setButton(true);
            el(cfg.overlayId).style.display = 'block';
            try {
                inst.qr = new Html5Qrcode(cfg.readerId, { verbose: false, experimentalFeatures: { useBarCodeDetectorIfSupported: true } });
                // No fixed scan box: the whole picture is read, and the page only SHOWS a narrow strip of it.
                await inst.qr.start({ facingMode: 'environment' }, { fps: 10 }, handle, () => {});
                showTorchIfAvailable();
            } catch (err) {
                alert('Camera error: ' + err);
                await inst.stop();
            }
        };

        inst.stop = async function () {
            if (inst.qr) {
                try { await inst.qr.stop(); inst.qr.clear(); } catch (e) { /* already stopped */ }
                inst.qr = null;
            }
            inst.active = false; inst.torchOn = false;
            const o = el(cfg.overlayId); if (o) o.style.display = 'none';
            const tb = el(cfg.torchBtnId); if (tb) { tb.style.display = 'none'; tb.classList.remove('on'); }
            setButton(false);
        };

        inst.toggle = function () { return inst.active ? inst.stop() : inst.start(); };

        inst.toggleTorch = async function () {
            if (!inst.qr) return;
            try {
                const torch = inst.qr.getRunningTrackCameraCapabilities().torchFeature();
                inst.torchOn = !inst.torchOn;
                await torch.apply(inst.torchOn);
                const tb = el(cfg.torchBtnId); if (tb) tb.classList.toggle('on', inst.torchOn);
            } catch (e) { inst.torchOn = false; }
        };

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
