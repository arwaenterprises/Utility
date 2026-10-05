// ============================================
// BOX CODE - INITIALIZATION
// ============================================
function initBoxCode() {
    loadPrintSettings();
    updateBoxDisplaySettings();
    setupBoxCodeListeners();
    syncBoxTextControls();
}

// The text to print above each code, or '' when "Add text" is off.
function boxLabelText() {
    return PrintState.settings.boxLabelTextOn ? String(PrintState.settings.boxLabelText || '').trim() : '';
}

// Shows / hides the text box to match the toggle and restores what was saved.
function syncBoxTextControls() {
    const on = !!PrintState.settings.boxLabelTextOn;
    document.getElementById('boxTextToggle').checked = on;
    const input = document.getElementById('boxLabelText');
    input.style.display = on ? '' : 'none';
    input.value = PrintState.settings.boxLabelText || '';
}

function handleBoxTextToggle(e) {
    PrintState.settings.boxLabelTextOn = e.target.checked;
    savePrintSettings();
    syncBoxTextControls();
    if (e.target.checked) document.getElementById('boxLabelText').focus();
    updateBoxPreview();
}

function handleBoxTextInput(e) {
    PrintState.settings.boxLabelText = e.target.value;
    savePrintSettings();
    updateBoxPreview();
}

// Draws bold text centred at x, shrinking it so it never runs wider than maxWidth (never below 12px).
function drawBoxHeaderText(ctx, text, cx, baselineY, maxWidth, size) {
    let fs = size;
    ctx.font = `bold ${fs}px Arial`;
    while (fs > 12 && ctx.measureText(text).width > maxWidth) { fs--; ctx.font = `bold ${fs}px Arial`; }
    ctx.fillStyle = '#000000';
    ctx.textAlign = 'center';
    ctx.fillText(text, cx, baselineY);
}

function setupBoxCodeListeners() {
    document.getElementById('trnInput').addEventListener('input', updateBoxPreview);
    document.getElementById('boxStartFrom').addEventListener('input', updateBoxPreview);
    document.getElementById('boxQtyInput').addEventListener('input', updateBoxPreview);
    
    document.getElementById('trnInput').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') document.getElementById('boxStartFrom').focus();
    });
    document.getElementById('boxStartFrom').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') document.getElementById('boxQtyInput').focus();
    });
    document.getElementById('boxQtyInput').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') printBoxLabels();
    });
    
    // "Add text" toggle + text box (listeners are added once; this function runs on every open of the tab)
    if (!setupBoxCodeListeners.textBound) {
        setupBoxCodeListeners.textBound = true;
        document.getElementById('boxTextToggle').addEventListener('change', handleBoxTextToggle);
        document.getElementById('boxLabelText').addEventListener('input', handleBoxTextInput);
        document.getElementById('boxLabelText').addEventListener('keypress', (e) => { if (e.key === 'Enter') document.getElementById('trnInput').focus(); });
    }

    document.getElementById('printBoxBtn').addEventListener('click', printBoxLabels);
    document.getElementById('openBoxSettingsBtn').addEventListener('click', openBoxSettings);
    document.getElementById('cancelBoxSettingsBtn').addEventListener('click', closeBoxSettings);
    document.getElementById('saveBoxSettingsBtn').addEventListener('click', saveBoxSettings);
    document.getElementById('settingBoxOutputFormat').addEventListener('change', syncBoxPerLabelOptions);
}

function updateBoxDisplaySettings() {
    document.getElementById('boxDisplayPrefix').textContent = PrintState.settings.boxPrefix || 'RTO';
    document.getElementById('boxDisplayMode').textContent = PrintState.settings.boxOutputFormat === 'barcode' ? 'Barcode' : 'QR Code';
    const n = boxPerLabel();
    document.getElementById('boxDisplayPerLabel').textContent = String(n);
    document.getElementById('boxLabelNote').textContent = n === 1
        ? 'Prints 1 code on each 4×6 inch label. Example: Qty 10 = 10 physical labels.'
        : `Prints ${n} sequential codes on each 4×6 inch label to save space. Example: Qty 10 = ${Math.ceil(10 / n)} physical labels.`;
}

// The preview is the real first label (same drawing as the print), shown small, so the layout and the number of
// codes per label can be checked before printing.
let boxPreviewReq = 0;
async function updateBoxPreview() {
    const trn = document.getElementById('trnInput').value.trim();
    const previewArea = document.getElementById('boxPreviewArea');
    const req = ++boxPreviewReq;
    
    if (!trn) {
        previewArea.innerHTML = '<h4>First Label Preview</h4><p style="color: var(--ak-text-light);">Enter TRN to see preview</p>';
        return;
    }
    
    const startFrom = Math.max(parseInt(document.getElementById('boxStartFrom').value) || 1, 1);
    const qty = Math.min(Math.max(parseInt(document.getElementById('boxQtyInput').value) || 1, 1), 100);
    const prefix = PrintState.settings.boxPrefix;
    const perLabel = boxPerLabel();
    const codes = [];
    for (let k = 0; k < Math.min(qty, perLabel); k++) {
        const n = String(startFrom + k).padStart(2, '0');
        codes.push(prefix ? `${prefix}-${trn}-${n}` : `${trn}-${n}`);
    }
    try {
        const canvas = await createBoxLabel(codes, PrintState.settings.boxOutputFormat, boxLabelText(), perLabel);
        if (req !== boxPreviewReq) return;                       // a newer preview has been asked for
        canvas.id = 'boxPreviewCanvas';
        canvas.style.cssText = 'display:block; margin:0 auto; width:100%; max-width:230px; border:1px solid var(--ak-gray-300); background:#fff;';
        previewArea.innerHTML = '<h4>First Label Preview</h4><div class="preview-label" id="boxPreviewLabel"></div>';
        document.getElementById('boxPreviewLabel').appendChild(canvas);
    } catch (e) {
        console.error('Preview error:', e);
    }
}

// ============================================
// BOX CODE - PRINT FUNCTION
// ============================================
async function printBoxLabels() {
    if (PrintState.isProcessing) return;
    
    const trn = document.getElementById('trnInput').value.trim();
    if (!trn) {
        showBoxStatus('error', 'Please enter a TRN number');
        setTimeout(() => hideBoxStatus(), 2000);
        return;
    }
    
    if (PrintState.settings.boxLabelTextOn && !boxLabelText()) {
        showBoxStatus('error', 'Enter the text for the label, or turn off "Add text"');
        document.getElementById('boxLabelText').focus();
        setTimeout(() => hideBoxStatus(), 2500);
        return;
    }
    const topText = boxLabelText();

    let startFrom = parseInt(document.getElementById('boxStartFrom').value) || 1;
    if (startFrom < 1) startFrom = 1;
    let qty = parseInt(document.getElementById('boxQtyInput').value) || 1;
    if (qty < 1) qty = 1;
    if (qty > 100) qty = 100;
    
    const prefix = PrintState.settings.boxPrefix;
    const perLabel = boxPerLabel();
    const physicalLabels = Math.ceil(qty / perLabel);
    const codeFor = (n) => prefix ? `${prefix}-${trn}-${String(n).padStart(2, '0')}` : `${trn}-${String(n).padStart(2, '0')}`;
    
    PrintState.isProcessing = true;
    showBoxStatus('processing', `Generating ${qty} codes on ${physicalLabels} label(s)...`);
    
    try {
        const printContainer = document.getElementById('printContainer');
        printContainer.innerHTML = '';
        
        for (let i = 0; i < qty; i += perLabel) {
            const codes = [];
            for (let k = i; k < Math.min(i + perLabel, qty); k++) codes.push(codeFor(startFrom + k));
            
            const labelDiv = document.createElement('div');
            labelDiv.className = 'print-label';
            labelDiv.appendChild(await createBoxLabel(codes, PrintState.settings.boxOutputFormat, topText, perLabel));
            printContainer.appendChild(labelDiv);
            await sleep(10);
        }
        
        await printLabelContainer();
        Usage.log('box_code', 'print_job', 1, qty);
        
        showBoxStatus('success', `✓ ${qty} codes on ${physicalLabels} label(s) sent to printer`);
        document.getElementById('trnInput').value = '';
        document.getElementById('boxStartFrom').value = '1';
        document.getElementById('boxQtyInput').value = '1';
        updateBoxPreview();
        
        setTimeout(() => {
            hideBoxStatus();
            document.getElementById('trnInput').focus();
        }, 2000);
    } catch (error) {
        showBoxStatus('error', `Error: ${error.message}`);
        setTimeout(() => hideBoxStatus(), 3000);
    } finally {
        PrintState.isProcessing = false;
    }
}

// ============================================
// BOX CODE - THE 4x6 INCH LABEL (one canvas = one physical label)
// ============================================
// The canvas has exactly the 2:3 shape of a 4x6 inch label, at the 203 dpi of a label printer (812 x 1218 px). It
// is printed at the paper width, so it always fills the label and can never run onto a second page. The codes on
// it share the height in equal slots (1 to 4 barcodes, 1 to 3 QR codes); inside a slot, the optional text, the code,
// a rule and the code's own text are centred as one block, so every slot looks the same.
const BOX_LABEL_W = 812;
const BOX_LABEL_H = 1218;
const BOX_SIDE_PAD = 30;              // blank paper left and right of the content
const BOX_MAX_BARCODES = 4;
const BOX_MAX_QR = 3;

// How many codes go on one label: the setting, limited to what fits for the chosen format.
function boxPerLabel() {
    const max = PrintState.settings.boxOutputFormat === 'barcode' ? BOX_MAX_BARCODES : BOX_MAX_QR;
    const n = parseInt(PrintState.settings.boxPerLabel) || 2;
    return Math.min(Math.max(n, 1), max);
}

// A barcode as an image: the widest bars (up to 4 px) that still fit between the side margins.
function boxBarcodeImage(text, height) {
    return new Promise((resolve, reject) => {
        const maxW = BOX_LABEL_W - BOX_SIDE_PAD * 2;
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.id = 'tempBoxBarcode';
        svg.style.position = 'absolute';
        svg.style.left = '-9999px';
        document.body.appendChild(svg);
        let width = 0;
        try {
            for (const bar of [4, 3, 2, 1]) {
                JsBarcode('#tempBoxBarcode', text, { format: 'CODE128', width: bar, height: height, displayValue: false, margin: 0 });
                width = parseFloat(svg.getAttribute('width'));
                if (width <= maxW) break;
            }
            svg.setAttribute('shape-rendering', 'crispEdges');
            const data = new XMLSerializer().serializeToString(svg);
            const img = new Image();
            img.onload = () => resolve({ img, width: Math.min(width, maxW), height });
            img.onerror = () => reject(new Error('Could not draw the barcode'));
            img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(data)));
        } catch (e) {
            reject(e);
        } finally {
            document.body.removeChild(svg);
        }
    });
}

// A QR code drawn with a whole number of pixels per square (so every square is exactly the same size and sharp),
// as large as fits in maxSize.
function boxQrCanvas(text, maxSize) {
    const holder = document.createElement('div');
    const qr = new QRCode(holder, { text: text, width: 10, height: 10, colorDark: '#000000', colorLight: '#ffffff', correctLevel: QRCode.CorrectLevel.M });
    const model = qr._oQRCode;                              // the library's matrix of squares
    const count = model.getModuleCount();
    const mod = Math.max(2, Math.floor(maxSize / count));
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = mod * count;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#000000';
    for (let r = 0; r < count; r++) for (let c = 0; c < count; c++) if (model.isDark(r, c)) ctx.fillRect(c * mod, r * mod, mod, mod);
    return canvas;
}

// Builds one label with up to `perLabel` codes (codes.length <= perLabel). Unused slots stay empty, so a short last
// label has its codes in the same places as a full one.
async function createBoxLabel(codes, format, topText, perLabel) {
    const W = BOX_LABEL_W, H = BOX_LABEL_H, pad = BOX_SIDE_PAD;
    const isBarcode = format === 'barcode';
    const slotH = H / perLabel;
    const fs = perLabel <= 2 ? 36 : 30;                       // code text and top text size
    const capH = Math.round(fs * 0.72);                       // height of a capital letter: text is placed by its visible top and bottom
    const headerH = topText ? capH + 22 : 0;
    const gapAboveRule = 16, ruleH = 2, textGap = 16;        // the rule under the code, then the code's own text
    const textH = textGap + capH;
    const slotMargin = 22;                                    // minimum blank above and below a block
    const fixed = headerH + gapAboveRule + ruleH + textH + slotMargin * 2;
    const maxCode = Math.max(60, slotH - fixed);
    let codeSize = isBarcode ? Math.min(Math.max(maxCode, 80), 220) : Math.min(maxCode, W - pad * 2, 380);
    const qrs = isBarcode ? null : codes.map(c => boxQrCanvas(c, Math.floor(codeSize)));
    if (qrs) codeSize = Math.max(...qrs.map(q => q.height));          // the real size after whole-pixel squares

    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    canvas.style.display = 'block';
    canvas.style.margin = '0 auto';
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, W, H);

    const blockH = headerH + codeSize + gapAboveRule + ruleH + textH;
    for (let i = 0; i < codes.length; i++) {
        const y0 = Math.round(i * slotH + (slotH - blockH) / 2);          // top of this slot's block
        if (topText) drawBoxHeaderText(ctx, topText, W / 2, y0 + capH, W - pad * 2, fs);
        const codeY = y0 + headerH;
        if (isBarcode) {
            const bc = await boxBarcodeImage(codes[i], Math.round(codeSize));
            ctx.drawImage(bc.img, Math.round((W - bc.width) / 2), codeY, bc.width, bc.height);
        } else {
            ctx.drawImage(qrs[i], Math.round((W - qrs[i].width) / 2), codeY + Math.round((codeSize - qrs[i].height) / 2));
        }
        const ruleY = codeY + Math.round(codeSize) + gapAboveRule;
        ctx.fillStyle = '#000000';
        ctx.fillRect(pad, ruleY, W - pad * 2, ruleH);
        drawBoxHeaderText(ctx, codes[i], W / 2, ruleY + ruleH + textGap + capH, W - pad * 2, fs);
    }
    return canvas;
}

// ============================================
// BOX CODE - SETTINGS
// ============================================
function openBoxSettings() {
    document.getElementById('settingBoxOutputFormat').value = PrintState.settings.boxOutputFormat;
    document.getElementById('settingBoxPrefix').value = PrintState.settings.boxPrefix;
    document.getElementById('settingBoxPerLabel').value = String(PrintState.settings.boxPerLabel || 2);
    syncBoxPerLabelOptions();
    document.getElementById('boxSettingsModal').classList.add('active');
}

// QR codes need more room than barcodes: only up to BOX_MAX_QR fit on a label.
function syncBoxPerLabelOptions() {
    const isBarcode = document.getElementById('settingBoxOutputFormat').value === 'barcode';
    const sel = document.getElementById('settingBoxPerLabel');
    [...sel.options].forEach(o => { o.disabled = !isBarcode && Number(o.value) > BOX_MAX_QR; });
    if (sel.options[sel.selectedIndex].disabled) sel.value = String(BOX_MAX_QR);
    document.getElementById('boxPerLabelHint').textContent = isBarcode ? 'Barcodes: 1 to 4 per label.' : 'QR codes: 1 to 3 per label.';
}

function closeBoxSettings() {
    document.getElementById('boxSettingsModal').classList.remove('active');
}

function saveBoxSettings() {
    PrintState.settings.boxOutputFormat = document.getElementById('settingBoxOutputFormat').value;
    PrintState.settings.boxPrefix = document.getElementById('settingBoxPrefix').value.trim();
    PrintState.settings.boxPerLabel = parseInt(document.getElementById('settingBoxPerLabel').value) || 2;
    savePrintSettings();
    updateBoxDisplaySettings();
    closeBoxSettings();
    updateBoxPreview();
}

function showBoxStatus(type, message) {
    const container = document.getElementById('boxStatus');
    container.className = `print-status show ${type}`;
    document.getElementById('boxStatusText').textContent = message;
}

function hideBoxStatus() {
    document.getElementById('boxStatus').classList.remove('show');
}

// sleep is defined in config.js
