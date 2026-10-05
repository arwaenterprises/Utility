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
        const svg = createBoxLabel(codes, PrintState.settings.boxOutputFormat, boxLabelText(), perLabel);
        if (req !== boxPreviewReq) return;                       // a newer preview has been asked for
        svg.id = 'boxPreviewSvg';
        svg.style.cssText = 'display:block; margin:0 auto; width:100%; max-width:230px; height:auto; border:1px solid var(--ak-gray-300); background:#fff;';
        previewArea.innerHTML = '<h4>First Label Preview</h4><div class="preview-label" id="boxPreviewLabel"></div>';
        document.getElementById('boxPreviewLabel').appendChild(svg);
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
            labelDiv.className = 'print-label box-label';
            labelDiv.appendChild(createBoxLabel(codes, PrintState.settings.boxOutputFormat, topText, perLabel));
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
// BOX CODE - THE 4x6 INCH LABEL (one drawing = one physical label)
// ============================================
// Each label is one vector drawing (SVG) with exactly the 2:3 shape of a 4x6 inch label, 812 x 1218 units: one unit is
// one dot of a 203 dpi label printer. It is printed at the full paper width with no padding, so on a 203 dpi printer
// every bar and square is a whole number of dots, and text and lines stay sharp at any resolution (a bitmap label
// was resampled and looked blocky). The codes share the height in equal slots (1 to 4 barcodes, 1 to 3 QR codes);
// inside a slot, the optional text (white on a black bar), the code and the code's own text are centred as one
// block, so every slot looks the same. A dotted line between two neighbouring slots shows where to cut.
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

// Builds one label with up to `perLabel` codes (codes.length <= perLabel) and returns the <svg>. Unused slots stay
// empty, so a short last label has its codes in the same places as a full one.
function createBoxLabel(codes, format, topText, perLabel) {
    const W = BOX_LABEL_W, H = BOX_LABEL_H, pad = BOX_SIDE_PAD;
    const isBarcode = format === 'barcode';
    const slotH = H / perLabel;
    const fs = ({ 1: 72, 2: 60, 3: 50, 4: 42 })[perLabel] || 50;   // size of the code's own text and of the label text
    const capH = Math.round(fs * 0.72);                       // height of a capital letter: text is placed by its visible top and bottom
    const tagPadY = 14;                                       // blank above and below the white text inside the black bar
    const tagH = topText ? capH + tagPadY * 2 : 0;
    const headerH = topText ? tagH + 18 : 0;                  // the bar plus the gap under it
    const textGap = 20;                                       // gap between the code and its own text
    const textH = textGap + capH;
    const slotMargin = 22;                                    // minimum blank above and below a block (and from the cut line)
    const fixed = headerH + textH + slotMargin * 2;
    const maxCode = Math.max(60, slotH - fixed);
    const maxW = W - pad * 2;

    // the codes, with whole-unit squares / bars
    let codeSize = isBarcode ? Math.min(Math.max(maxCode, 80), 220) : Math.min(maxCode, maxW, 380);
    const items = codes.map((text) => {
        if (isBarcode) {
            let bar = 4, bc = barcodePath(text, Math.round(codeSize), bar, 0, 0);
            while (bc.width > maxW && bar > 1) { bar--; bc = barcodePath(text, Math.round(codeSize), bar, 0, 0); }
            return { text, width: Math.min(bc.width, maxW), scale: bc.width > maxW ? maxW / bc.width : 1, build: (x, y) => barcodePath(text, Math.round(codeSize), bar, x, y).d, height: Math.round(codeSize) };
        }
        const m = qrMatrix(text), mod = Math.max(2, Math.floor(Math.floor(codeSize) / m.count));
        return { text, width: m.count * mod, scale: 1, build: (x, y) => qrPath(m, mod, x, y), height: m.count * mod };
    });
    if (!isBarcode) codeSize = Math.max(...items.map(i => i.height));      // the real size after whole-unit squares

    const svg = svgEl('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, class: 'box-label-svg' });
    svgEl('rect', { x: 0, y: 0, width: W, height: H, fill: '#ffffff' }, svg);
    const blockH = headerH + codeSize + textH;
    items.forEach((it, i) => {
        const y0 = Math.round(i * slotH + (slotH - blockH) / 2);          // top of this slot's block
        const codeY = y0 + headerH;
        const x = Math.round((W - it.width) / 2);
        const y = codeY + Math.round((codeSize - it.height) / 2);
        const path = svgEl('path', { d: it.build(0, 0), fill: '#000000', transform: `translate(${x} ${y})` + (it.scale !== 1 ? ` scale(${it.scale})` : '') }, svg);
        if (topText) {                                                    // white text on a black bar as wide as the code (wider for long text)
            const padX = 22, fit = fitBoldSize(topText, fs, maxW - padX * 2, 12);
            const w = Math.min(maxW, Math.max(it.width, Math.ceil(fit.width) + padX * 2));
            svgEl('rect', { x: Math.round((W - w) / 2), y: y0, width: Math.round(w), height: tagH, fill: '#000000' }, svg);
            const t = svgEl('text', { x: W / 2, y: y0 + tagPadY + Math.round(fit.size * 0.72), 'text-anchor': 'middle', 'font-family': LABEL_FONT, 'font-weight': 700, 'font-size': fit.size, fill: '#ffffff' }, svg);
            t.textContent = topText;
        }
        const fitCode = fitBoldSize(it.text, fs, maxW, 12);
        const ct = svgEl('text', { x: W / 2, y: codeY + Math.round(codeSize) + textGap + capH, 'text-anchor': 'middle', 'font-family': LABEL_FONT, 'font-weight': 700, 'font-size': fitCode.size, fill: '#000000' }, svg);
        ct.textContent = it.text;
    });
    // a dotted line between neighbouring labels, so the operator can see where to cut
    for (let i = 1; i < codes.length; i++) {
        const y = Math.round(i * slotH);
        svgEl('line', { x1: 10, y1: y, x2: W - 10, y2: y, stroke: '#000000', 'stroke-width': 2, 'stroke-dasharray': '5 9', 'shape-rendering': 'crispEdges' }, svg);
    }
    return svg;
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
