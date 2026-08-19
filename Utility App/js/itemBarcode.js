// ============================================
// PRINT MODULES - SHARED STATE
// ============================================
const PrintState = {
    settings: {
        outputFormat: 'barcode',
        barcodeType: 'numeric',
        boxPrefix: 'RTO',
        boxOutputFormat: 'barcode'
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
// ITEM BARCODE - INITIALIZATION
// ============================================
function initItemBarcode() {
    loadPrintSettings();
    updateItemDisplaySettings();
    setupItemBarcodeListeners();
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
    
    if (input.includes(',')) {
        const barcodes = input.split(',').map(b => b.trim()).filter(b => b);
        if (barcodes.length > 0) {
            PrintState.csvData = barcodes.map(barcode => ({ barcode, qty: 1 }));
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
        try {
            const format = PrintState.settings.barcodeType === 'numeric' ? 'CODE128C' : 'CODE128B';
            JsBarcode('#previewBarcode', barcode, { format: format, width: 2, height: 60, displayValue: true, fontSize: 14, margin: 5 });
        } catch (e) {
            JsBarcode('#previewBarcode', barcode, { format: 'CODE128', width: 2, height: 60, displayValue: true, fontSize: 14, margin: 5 });
        }
    } else {
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
async function printItemLabel() {
    if (PrintState.isProcessing) return;
    
    const barcode = document.getElementById('itemBarcodeInput').value.trim();
    if (!barcode) {
        showItemStatus('error', 'Please enter a barcode');
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
                try {
                    const format = PrintState.settings.barcodeType === 'numeric' ? 'CODE128C' : 'CODE128B';
                    JsBarcode(`#printBarcode_${i}`, barcode, { format: format, width: 2, height: 80, displayValue: true, fontSize: 16, margin: 5 });
                } catch (e) {
                    JsBarcode(`#printBarcode_${i}`, barcode, { format: 'CODE128', width: 2, height: 80, displayValue: true, fontSize: 16, margin: 5 });
                }
            } else {
                const qrCanvas = await createQRWithText(barcode, 150);
                labelDiv.appendChild(qrCanvas);
                printContainer.appendChild(labelDiv);
            }
        }
        
        await sleep(100);
        window.print();
        
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
    const csvContent = "Barcode,Qty\n,,\n,,\n,,\n,,\n,,";
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
    reader.onload = (e) => parseCSV(e.target.result);
    reader.readAsText(file);
    event.target.value = '';
}

function parseCSV(content) {
    const lines = content.split('\n').filter(line => line.trim());
    PrintState.csvData = [];
    for (let i = 1; i < lines.length; i++) {
        const parts = lines[i].split(',');
        const barcode = parts[0] ? parts[0].trim() : '';
        const qty = parts[1] ? parseInt(parts[1].trim()) || 1 : 1;
        if (barcode) PrintState.csvData.push({ barcode, qty });
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
        html += `<div class="csv-preview-row">${PrintState.csvData[i].barcode} × ${PrintState.csvData[i].qty}</div>`;
    }
    if (PrintState.csvData.length > 10) html += `<div class="csv-preview-row">... and ${PrintState.csvData.length - 10} more</div>`;
    previewContent.innerHTML = html;
    const totalLabels = PrintState.csvData.reduce((sum, item) => sum + item.qty, 0);
    previewSummary.textContent = `Total: ${PrintState.csvData.length} unique barcodes, ${totalLabels} labels`;
    document.getElementById('itemCsvPreview').classList.add('show');
}

function cancelCSV() {
    PrintState.csvData = [];
    document.getElementById('itemCsvPreview').classList.remove('show');
}

async function printFromCSV() {
    if (PrintState.isProcessing || PrintState.csvData.length === 0) return;
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
                    try {
                        const format = PrintState.settings.barcodeType === 'numeric' ? 'CODE128C' : 'CODE128B';
                        JsBarcode(`#printBarcode_${labelCount}`, item.barcode, { format: format, width: 2, height: 80, displayValue: true, fontSize: 16, margin: 5 });
                    } catch (e) {
                        JsBarcode(`#printBarcode_${labelCount}`, item.barcode, { format: 'CODE128', width: 2, height: 80, displayValue: true, fontSize: 16, margin: 5 });
                    }
                } else {
                    const qrCanvas = await createQRWithText(item.barcode, 150);
                    labelDiv.appendChild(qrCanvas);
                    printContainer.appendChild(labelDiv);
                }
                labelCount++;
            }
        }
        
        await sleep(100);
        window.print();
        showItemStatus('success', `✓ ${totalLabels} labels sent to printer`);
        PrintState.csvData = [];
        setTimeout(() => hideItemStatus(), 2000);
    } catch (error) {
        showItemStatus('error', `Error: ${error.message}`);
        setTimeout(() => hideItemStatus(), 3000);
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
        JsBarcode('#testBarcode', 'TEST-12345', { format: 'CODE128', width: 2, height: 80, displayValue: true, fontSize: 16, margin: 10 });
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

