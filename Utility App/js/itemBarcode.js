// ============================================
// PRINT MODULES - SHARED STATE
// ============================================
const PrintState = {
    settings: {
        outputFormat: 'barcode',
        barcodeType: 'numeric',
        boxPrefix: 'RTO',
        boxOutputFormat: 'barcode',
        labelTextOn: false,       // Item Barcode: print a line of text above the barcode
        labelText: ''
    },
    printMode: 'single',
    csvData: [],
    isProcessing: false
};

function loadPrintSettings() {
    const saved = Storage.getJSON('print_settings');
    if (saved) PrintState.settings = { ...PrintState.settings, ...saved };
}

function savePrintSettings() {
    Storage.setJSON('print_settings', PrintState.settings);
}

// ============================================
// ITEM BARCODE - LABEL DRAWING
// ============================================
// Bar height is 70 (it used to be 80: about 12% shorter). The preview is scaled the same way.
const ITEM_BAR_HEIGHT = 70;
const ITEM_PREVIEW_BAR_HEIGHT = 52;
// The number under the bars (was 16) and the optional text above them are the same, larger size.
const ITEM_NUMBER_FONT = 22;
// Code 128 needs a blank "quiet zone" of at least 10 bar-widths (20px at width 2) left and right of the bars,
// otherwise a scanner can fail to find where the barcode starts.
const ITEM_QUIET_ZONE = 20;
const ITEM_PREVIEW_NUMBER_FONT = 19;

// The text to print above the barcode, or '' when "Add text" is off.
function itemLabelText() {
    return PrintState.settings.labelTextOn ? String(PrintState.settings.labelText || '').trim() : '';
}

// Adds a bold line of text above an already drawn barcode (SVG), left-aligned with the bars:
//   Apparel
//   |||| ||| |||||
//   300100010265
// The text for one CSV row: its own Text, else the default text box; nothing when "Add text" is off.
function csvRowText(row) {
    if (!PrintState.settings.labelTextOn) return '';
    return (row.text || '').trim() || itemLabelText();
}

function csvRowsWithoutText() {
    return PrintState.csvData.filter(r => !(r.text || '').trim()).length;
}

// "Add text" is on but nothing is typed: stop before printing a label without the text the user asked for.
function itemTextMissing(rows) {
    // rows (CSV print): fine when every row has its own text or a default text exists
    const needsDefault = rows ? rows.some(r => !(r.text || '').trim()) : true;
    if (PrintState.settings.labelTextOn && needsDefault && !itemLabelText()) {
        showItemStatus('error', 'Enter the text for the label, or turn off "Add text"');
        document.getElementById('itemLabelText').focus();
        setTimeout(() => hideItemStatus(), 2500);
        return true;
    }
    return false;
}

function addTextAboveBarcode(svg, text, size) {
    const NS = 'http://www.w3.org/2000/svg';
    const width = parseFloat(svg.getAttribute('width')) || 200;
    const height = parseFloat(svg.getAttribute('height')) || 100;
    const margin = ITEM_QUIET_ZONE;
    let fontSize = size || ITEM_NUMBER_FONT;
    // shrink long text so it never runs past the end of the bars
    const approxWidth = (size) => text.length * size * 0.6;
    while (fontSize > 9 && approxWidth(fontSize) > width - margin * 2) fontSize--;
    const headerHeight = Math.round(fontSize + 10);

    const bg = document.createElementNS(NS, 'rect');
    bg.setAttribute('x', '0'); bg.setAttribute('y', '0');
    bg.setAttribute('width', '100%'); bg.setAttribute('height', String(headerHeight));
    bg.setAttribute('fill', '#ffffff');

    const body = document.createElementNS(NS, 'g');
    body.setAttribute('transform', `translate(0 ${headerHeight})`);
    while (svg.firstChild) body.appendChild(svg.firstChild);

    const label = document.createElementNS(NS, 'text');
    label.setAttribute('x', String(margin));
    label.setAttribute('y', String(fontSize + 2));
    label.setAttribute('font-family', 'Arial, Helvetica, sans-serif');
    label.setAttribute('font-weight', '700');
    label.setAttribute('font-size', String(fontSize));
    label.setAttribute('fill', '#000000');
    label.setAttribute('class', 'item-label-text');
    label.textContent = text;

    svg.appendChild(bg);
    svg.appendChild(body);
    svg.appendChild(label);
    svg.setAttribute('shape-rendering', 'crispEdges');
    svg.setAttribute('height', (height + headerHeight) + 'px');
    svg.setAttribute('viewBox', `0 0 ${width} ${height + headerHeight}`);
}

// Draws the barcode for `value` into the <svg id=svgId> that is already in the page, with the optional text on top.
function drawItemBarcode(svgId, value, opts) {
    const o = { height: ITEM_BAR_HEIGHT, fontSize: ITEM_NUMBER_FONT, margin: 5, ...(opts || {}) };
    const bars = { width: 2, height: o.height, displayValue: true, fontSize: o.fontSize, margin: o.margin, marginLeft: ITEM_QUIET_ZONE, marginRight: ITEM_QUIET_ZONE };
    try {
        const format = PrintState.settings.barcodeType === 'numeric' ? 'CODE128C' : 'CODE128B';
        JsBarcode('#' + svgId, value, { format: format, ...bars });
    } catch (e) {
        JsBarcode('#' + svgId, value, { format: 'CODE128', ...bars });
    }
    // o.text lets a CSV row bring its own text; otherwise the text box (or nothing when "Add text" is off)
    const text = o.text !== undefined ? o.text : itemLabelText();
    if (text) addTextAboveBarcode(document.getElementById(svgId), text, o.fontSize);
}

// QR labels get the same text as a bold line above the code.
function itemQrHeaderElement(textOverride) {
    const text = textOverride !== undefined ? textOverride : itemLabelText();
    if (!text) return null;
    const div = document.createElement('div');
    div.className = 'item-label-text';
    div.style.cssText = `font: 700 ${ITEM_NUMBER_FONT}px Arial, Helvetica, sans-serif; text-align: left; width: 100%; padding: 0 4px 4px;`;
    div.textContent = text;
    return div;
}

// ============================================
// ITEM BARCODE - INITIALIZATION
// ============================================
function initItemBarcode() {
    loadPrintSettings();
    updateItemDisplaySettings();
    setupItemBarcodeListeners();
    syncItemTextControls();
}

// Shows / hides the text box to match the toggle and restores what was saved.
function syncItemTextControls() {
    const on = !!PrintState.settings.labelTextOn;
    document.getElementById('itemTextToggle').checked = on;
    const input = document.getElementById('itemLabelText');
    input.style.display = on ? '' : 'none';
    input.value = PrintState.settings.labelText || '';
}

function handleItemTextToggle(e) {
    PrintState.settings.labelTextOn = e.target.checked;
    savePrintSettings();
    syncItemTextControls();
    if (e.target.checked) document.getElementById('itemLabelText').focus();
    updateItemPreview();
    if (PrintState.csvData.length && document.getElementById('itemCsvPreview').classList.contains('show')) showCSVPreview();
}

function handleItemTextInput(e) {
    PrintState.settings.labelText = e.target.value;
    savePrintSettings();
    updateItemPreview();
    if (PrintState.csvData.length && document.getElementById('itemCsvPreview').classList.contains('show')) showCSVPreview();
}

function setupItemBarcodeListeners() {
    // Mode toggle
    document.getElementById('itemModeSingle').addEventListener('click', () => setItemPrintMode('single'));
    document.getElementById('itemModeBulk').addEventListener('click', () => setItemPrintMode('bulk'));
    
    // Barcode input
    document.getElementById('itemBarcodeInput').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') handleItemBarcodeEnter();
    });
    document.getElementById('itemBarcodeInput').addEventListener('input', updateItemPreview);

    // "Add text" toggle + text box (listeners are added once; this function runs on every open of the tab)
    if (!setupItemBarcodeListeners.textBound) {
        setupItemBarcodeListeners.textBound = true;
        document.getElementById('itemTextToggle').addEventListener('change', handleItemTextToggle);
        document.getElementById('itemLabelText').addEventListener('input', handleItemTextInput);
        document.getElementById('itemLabelText').addEventListener('keypress', (e) => { if (e.key === 'Enter') document.getElementById('itemBarcodeInput').focus(); });
    }
    
    // Quantity input
    document.getElementById('itemQtyInput').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') printItemLabel();
    });
    
    // CSV
    document.getElementById('downloadTemplateBtn').addEventListener('click', downloadTemplate);
    document.getElementById('uploadCsvBtn').addEventListener('click', () => document.getElementById('csvFileInput').click());
    document.getElementById('csvFileInput').addEventListener('change', handleFileUpload);
    document.getElementById('printCsvBtn').addEventListener('click', printFromCSV);
    document.getElementById('cancelCsvBtn').addEventListener('click', cancelCSV);
    
    // Print button
    document.getElementById('printItemBtn').addEventListener('click', printItemLabel);
    
    // Settings
    document.getElementById('openItemSettingsBtn').addEventListener('click', openItemSettings);
    document.getElementById('cancelItemSettingsBtn').addEventListener('click', closeItemSettings);
    document.getElementById('saveItemSettingsBtn').addEventListener('click', saveItemSettings);
    document.getElementById('testPrintBtn').addEventListener('click', testPrint);
}

function updateItemDisplaySettings() {
    document.getElementById('itemDisplayMode').textContent = PrintState.settings.outputFormat === 'barcode' ? 'Barcode' : 'QR Code';
    document.getElementById('itemDisplayType').textContent = PrintState.settings.barcodeType === 'numeric' ? 'Numeric' : 'Alphanumeric';
}

function setItemPrintMode(mode) {
    PrintState.printMode = mode;
    document.getElementById('itemModeSingle').classList.toggle('active', mode === 'single');
    document.getElementById('itemModeBulk').classList.toggle('active', mode === 'bulk');
    document.getElementById('itemQtyGroup').classList.toggle('show', mode === 'bulk');
    document.getElementById('itemBarcodeInput').focus();
}

function handleItemBarcodeEnter() {
    const input = document.getElementById('itemBarcodeInput').value.trim();
    if (!input) return;
    
    {
        const barcodes = splitItemBarcodes(input);
        if (barcodes.length > 0) {
            PrintState.csvData = barcodes.map(barcode => ({ barcode, qty: 1, text: '' }));
            showCSVPreview();
            return;
        }
    }
    
    if (PrintState.printMode === 'bulk') {
        document.getElementById('itemQtyInput').focus();
        document.getElementById('itemQtyInput').select();
    } else {
        printItemLabel();
    }
}

function updateItemPreview() {
    const input = document.getElementById('itemBarcodeInput').value.trim();
    const previewArea = document.getElementById('itemPreviewArea');
    
    if (!input) {
        previewArea.innerHTML = '<h4>Label Preview</h4><p style="color: var(--ak-text-light);">Scan a barcode to see preview</p>';
        return;
    }
    
    let barcode = input.includes(',') ? input.split(',')[0].trim() : input;
    
    previewArea.innerHTML = '<h4>Label Preview</h4><div class="preview-label" id="previewLabel"></div>';
    
    if (PrintState.settings.outputFormat === 'barcode') {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.id = 'previewBarcode';
        document.getElementById('previewLabel').appendChild(svg);
        drawItemBarcode('previewBarcode', barcode, { height: ITEM_PREVIEW_BAR_HEIGHT, fontSize: ITEM_PREVIEW_NUMBER_FONT });
    } else {
        const qrHeader = itemQrHeaderElement();
        if (qrHeader) document.getElementById('previewLabel').appendChild(qrHeader);
        const qrDiv = document.createElement('div');
        qrDiv.id = 'previewQR';
        document.getElementById('previewLabel').appendChild(qrDiv);
        new QRCode(qrDiv, { text: barcode, width: 100, height: 100, colorDark: '#000000', colorLight: '#ffffff' });
        const textDiv = document.createElement('div');
        textDiv.className = 'barcode-text';
        textDiv.textContent = barcode;
        document.getElementById('previewLabel').appendChild(textDiv);
    }
}

// ============================================
// ITEM BARCODE - PRINT FUNCTIONS
// ============================================
// Opens the print dialog for the labels in #printContainer. While it is open everything else in the page is
// removed from the layout (class printing-labels, see style.css): with only visibility:hidden the browser still
// laid out the whole app on every one of the (e.g. 100) pages and the print window never appeared.
async function printLabelContainer() {
    document.body.classList.add('printing-labels');
    const done = () => { document.body.classList.remove('printing-labels'); window.removeEventListener('afterprint', done); };
    window.addEventListener('afterprint', done);
    try {
        await sleep(100);
        window.print();
    } finally {
        // some browsers never fire afterprint; print() has returned by now, so the page can come back
        setTimeout(done, 500);
    }
}

// "111, 222, 333" -> ['111','222','333']; a single barcode -> []
function splitItemBarcodes(input) {
    if (!input.includes(',')) return [];
    return input.split(',').map(b => b.trim()).filter(b => b);
}

async function printItemLabel() {
    if (PrintState.isProcessing) return;
    
    const barcode = document.getElementById('itemBarcodeInput').value.trim();
    if (!barcode) {
        showItemStatus('error', 'Please enter a barcode');
        return;
    }
    if (itemTextMissing()) return;

    // Pasted comma-separated values are separate barcodes: one label each (never one barcode holding the commas)
    const many = splitItemBarcodes(barcode);
    if (many.length) {
        let q = PrintState.printMode === 'bulk' ? parseInt(document.getElementById('itemQtyInput').value) || 1 : 1;
        q = Math.min(Math.max(q, 1), 200);
        PrintState.csvData = many.map(b => ({ barcode: b, qty: q, text: '' }));
        const ok = await printFromCSV();
        if (ok) {
            document.getElementById('itemBarcodeInput').value = '';
            document.getElementById('itemQtyInput').value = '1';
            updateItemPreview();
        }
        return;
    }
    
    let qty = PrintState.printMode === 'bulk' ? parseInt(document.getElementById('itemQtyInput').value) || 1 : 1;
    if (qty < 1) qty = 1;
    if (qty > 200) qty = 200;
    
    PrintState.isProcessing = true;
    showItemStatus('processing', `Generating ${qty} label(s)...`);
    
    try {
        const printContainer = document.getElementById('printContainer');
        printContainer.innerHTML = '';
        
        for (let i = 0; i < qty; i++) {
            const labelDiv = document.createElement('div');
            labelDiv.className = 'print-label';
            
            if (PrintState.settings.outputFormat === 'barcode') {
                const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
                svg.id = `printBarcode_${i}`;
                labelDiv.appendChild(svg);
                printContainer.appendChild(labelDiv);
                drawItemBarcode(`printBarcode_${i}`, barcode);
            } else {
                const qrCanvas = await createQRWithText(barcode, 150);
                const qrHeader = itemQrHeaderElement();
                if (qrHeader) labelDiv.appendChild(qrHeader);
                labelDiv.appendChild(qrCanvas);
                printContainer.appendChild(labelDiv);
            }
        }
        
        await printLabelContainer();
        Usage.log('item_barcode', 'print_job', 1, qty);
        
        showItemStatus('success', `✓ ${qty} label(s) sent to printer`);
        document.getElementById('itemBarcodeInput').value = '';
        document.getElementById('itemQtyInput').value = '1';
        updateItemPreview();
        
        setTimeout(() => hideItemStatus(), 2000);
    } catch (error) {
        showItemStatus('error', `Error: ${error.message}`);
        setTimeout(() => hideItemStatus(), 3000);
    } finally {
        PrintState.isProcessing = false;
    }
}

// ============================================
// ITEM BARCODE - CSV FUNCTIONS
// ============================================
function downloadTemplate() {
    // Text is optional: with "Add text" on, a row's Text is printed above its barcode (empty = the default text box).
    const csvContent = "Barcode,Qty,Text\n,,\n,,\n,,\n,,\n,,";
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'AK_Print_Template.csv';
    link.click();
}

function handleFileUpload(event) {
    const file = event.target.files[0];
    if (!file) return;
    if (file.size > 2_000_000) {
        showItemStatus('error', 'File too large — maximum 2 MB');
        setTimeout(() => hideItemStatus(), 3000);
        event.target.value = '';
        return;
    }
    const reader = new FileReader();
    if (/\.xlsx?$/i.test(file.name) && typeof XLSX !== 'undefined') {
        // Excel file: the first sheet becomes CSV text, so it goes through the same parser as a .csv file
        reader.onload = (e) => {
            try {
                const wb = XLSX.read(e.target.result, { type: 'array' });
                parseCSV(XLSX.utils.sheet_to_csv(wb.Sheets[wb.SheetNames[0]]));
            } catch (err) {
                showItemStatus('error', 'Could not read this Excel file');
                setTimeout(() => hideItemStatus(), 3000);
            }
        };
        reader.readAsArrayBuffer(file);
    } else {
        reader.onload = (e) => parseCSV(e.target.result);
        reader.readAsText(file);
    }
    event.target.value = '';
}

// One CSV line -> cells. Understands "quoted, values" and "" inside quotes (so text like "Men, Apparel" stays whole).
function splitCsvLine(line) {
    const cells = [];
    let cur = '', quoted = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
            if (quoted && line[i + 1] === '"') { cur += '"'; i++; }
            else quoted = !quoted;
        } else if (ch === ',' && !quoted) {
            cells.push(cur); cur = '';
        } else {
            cur += ch;
        }
    }
    cells.push(cur);
    return cells.map(c => c.trim());
}

function parseCSV(content) {
    const lines = content.replace(/^\uFEFF/, '').split(/\r?\n/).filter(line => line.trim());
    PrintState.csvData = [];
    // The first line is the header. Columns are found by name (Barcode, Qty, Text, any order); files with only
    // Barcode and Qty - the old template - keep working, their Text is simply empty.
    const header = lines.length ? splitCsvLine(lines[0]).map(h => h.toLowerCase()) : [];
    const col = (name, fallback) => { const i = header.indexOf(name); return i >= 0 ? i : fallback; };
    const iBarcode = col('barcode', 0), iQty = col('qty', 1), iText = col('text', 2);
    for (let i = 1; i < lines.length; i++) {
        const parts = splitCsvLine(lines[i]);
        const barcode = parts[iBarcode] || '';
        const qty = parts[iQty] ? parseInt(parts[iQty]) || 1 : 1;
        const text = (parts[iText] || '').slice(0, 40);
        if (barcode) PrintState.csvData.push({ barcode, qty, text });
    }
    if (PrintState.csvData.length === 0) {
        showItemStatus('error', 'No valid barcodes found in CSV');
        setTimeout(() => hideItemStatus(), 2000);
        return;
    }
    showCSVPreview();
}

function showCSVPreview() {
    const previewContent = document.getElementById('itemCsvPreviewContent');
    const previewSummary = document.getElementById('itemCsvPreviewSummary');
    let html = '';
    const showCount = Math.min(PrintState.csvData.length, 10);
    for (let i = 0; i < showCount; i++) {
        const row = PrintState.csvData[i];
        const text = csvRowText(row);
        html += `<div class="csv-preview-row">${escapeHtml(row.barcode)} × ${row.qty}` + (text ? ` — <strong>${escapeHtml(text)}</strong>` : '') + `</div>`;
    }
    if (PrintState.csvData.length > 10) html += `<div class="csv-preview-row">... and ${PrintState.csvData.length - 10} more</div>`;
    previewContent.innerHTML = html;
    const totalLabels = PrintState.csvData.reduce((sum, item) => sum + item.qty, 0);
    previewSummary.textContent = `Total: ${PrintState.csvData.length} unique barcodes, ${totalLabels} labels`;
    const missing = csvRowsWithoutText();
    if (PrintState.settings.labelTextOn && missing > 0 && !itemLabelText()) {
        previewSummary.textContent += ` · ${missing} row(s) have no text - type a default text above or fill the Text column`;
    }
    document.getElementById('itemCsvPreview').classList.add('show');
}

function cancelCSV() {
    PrintState.csvData = [];
    document.getElementById('itemCsvPreview').classList.remove('show');
}

async function printFromCSV() {
    if (PrintState.isProcessing || PrintState.csvData.length === 0) return false;
    if (itemTextMissing(PrintState.csvData)) return false;
    PrintState.isProcessing = true;
    document.getElementById('itemCsvPreview').classList.remove('show');
    const totalLabels = PrintState.csvData.reduce((sum, item) => sum + item.qty, 0);
    
    try {
        showItemStatus('processing', `Generating ${totalLabels} labels...`);
        const printContainer = document.getElementById('printContainer');
        printContainer.innerHTML = '';
        let labelCount = 0;
        
        for (const item of PrintState.csvData) {
            for (let q = 0; q < item.qty; q++) {
                const labelDiv = document.createElement('div');
                labelDiv.className = 'print-label';
                
                if (PrintState.settings.outputFormat === 'barcode') {
                    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
                    svg.id = `printBarcode_${labelCount}`;
                    labelDiv.appendChild(svg);
                    printContainer.appendChild(labelDiv);
                    drawItemBarcode(`printBarcode_${labelCount}`, item.barcode, { text: csvRowText(item) });
                } else {
                    const qrCanvas = await createQRWithText(item.barcode, 150);
                    const qrHeader = itemQrHeaderElement(csvRowText(item));
                    if (qrHeader) labelDiv.appendChild(qrHeader);
                    labelDiv.appendChild(qrCanvas);
                    printContainer.appendChild(labelDiv);
                }
                labelCount++;
                if (labelCount % 20 === 0) await sleep(0);   // let the "Generating..." message paint on big jobs
            }
        }
        
        await printLabelContainer();
        Usage.log('item_barcode', 'print_job', 1, totalLabels);
        showItemStatus('success', `✓ ${totalLabels} labels sent to printer`);
        PrintState.csvData = [];
        setTimeout(() => hideItemStatus(), 2000);
        return true;
    } catch (error) {
        showItemStatus('error', `Error: ${error.message}`);
        setTimeout(() => hideItemStatus(), 3000);
        return false;
    } finally {
        PrintState.isProcessing = false;
    }
}

// ============================================
// ITEM BARCODE - SETTINGS
// ============================================
function openItemSettings() {
    document.getElementById('settingOutputFormat').value = PrintState.settings.outputFormat;
    document.getElementById('settingBarcodeType').value = PrintState.settings.barcodeType;
    document.getElementById('itemSettingsModal').classList.add('active');
}

function closeItemSettings() {
    document.getElementById('itemSettingsModal').classList.remove('active');
}

function saveItemSettings() {
    PrintState.settings.outputFormat = document.getElementById('settingOutputFormat').value;
    PrintState.settings.barcodeType = document.getElementById('settingBarcodeType').value;
    savePrintSettings();
    updateItemDisplaySettings();
    closeItemSettings();
    updateItemPreview();
}

async function testPrint() {
    const printContainer = document.getElementById('printContainer');
    printContainer.innerHTML = '';
    const labelDiv = document.createElement('div');
    labelDiv.className = 'print-label';
    
    if (PrintState.settings.outputFormat === 'barcode') {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.id = 'testBarcode';
        labelDiv.appendChild(svg);
        printContainer.appendChild(labelDiv);
        JsBarcode('#testBarcode', 'TEST-12345', { format: 'CODE128', width: 2, height: ITEM_BAR_HEIGHT, displayValue: true, fontSize: ITEM_NUMBER_FONT, margin: 10 });
        if (itemLabelText()) addTextAboveBarcode(document.getElementById('testBarcode'), itemLabelText(), ITEM_NUMBER_FONT);
    } else {
        const qrCanvas = await createQRWithText('TEST-12345', 150);
        labelDiv.appendChild(qrCanvas);
        printContainer.appendChild(labelDiv);
    }
    
    setTimeout(() => window.print(), 200);
}

function showItemStatus(type, message) {
    const container = document.getElementById('itemStatus');
    container.className = `print-status show ${type}`;
    document.getElementById('itemStatusText').textContent = message;
}

function hideItemStatus() {
    document.getElementById('itemStatus').classList.remove('show');
}

