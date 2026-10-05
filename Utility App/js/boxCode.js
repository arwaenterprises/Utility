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
}

function updateBoxDisplaySettings() {
    document.getElementById('boxDisplayPrefix').textContent = PrintState.settings.boxPrefix || 'RTO';
    document.getElementById('boxDisplayMode').textContent = PrintState.settings.boxOutputFormat === 'barcode' ? 'Barcode' : 'QR Code';
}

function updateBoxPreview() {
    const trn = document.getElementById('trnInput').value.trim();
    const previewArea = document.getElementById('boxPreviewArea');
    
    if (!trn) {
        previewArea.innerHTML = '<h4>First Label Preview</h4><p style="color: var(--ak-text-light);">Enter TRN to see preview</p>';
        return;
    }
    
    const startFrom = parseInt(document.getElementById('boxStartFrom').value) || 1;
    const prefix = PrintState.settings.boxPrefix;
    const code1 = prefix ? `${prefix}-${trn}-${String(startFrom).padStart(2, '0')}` : `${trn}-${String(startFrom).padStart(2, '0')}`;
    
    previewArea.innerHTML = '<h4>First Label Preview</h4><div class="preview-label" id="boxPreviewLabel"></div>';
    
    if (PrintState.settings.boxOutputFormat === 'barcode') {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.id = 'boxPreviewBarcode';
        document.getElementById('boxPreviewLabel').appendChild(svg);
        try {
            JsBarcode('#boxPreviewBarcode', code1, { format: 'CODE128', width: 2, height: 60, displayValue: true, fontSize: 12, margin: 5, marginLeft: ITEM_QUIET_ZONE, marginRight: ITEM_QUIET_ZONE });
            if (boxLabelText()) addTextAboveBarcode(document.getElementById('boxPreviewBarcode'), boxLabelText(), 16);
        } catch (e) {
            console.error('Barcode error:', e);
        }
    } else {
        const qrHeader = itemQrHeaderElement(boxLabelText());
        if (qrHeader) document.getElementById('boxPreviewLabel').appendChild(qrHeader);
        const qrDiv = document.createElement('div');
        qrDiv.id = 'boxPreviewQR';
        document.getElementById('boxPreviewLabel').appendChild(qrDiv);
        new QRCode(qrDiv, { text: code1, width: 100, height: 100, colorDark: '#000000', colorLight: '#ffffff' });
        const textDiv = document.createElement('div');
        textDiv.className = 'barcode-text';
        textDiv.textContent = code1;
        document.getElementById('boxPreviewLabel').appendChild(textDiv);
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
    const physicalLabels = Math.ceil(qty / 2);
    
    PrintState.isProcessing = true;
    showBoxStatus('processing', `Generating ${qty} codes on ${physicalLabels} label(s)...`);
    
    try {
        const printContainer = document.getElementById('printContainer');
        printContainer.innerHTML = '';
        
        for (let i = 0; i < qty; i += 2) {
            const num1 = startFrom + i;
            const code1 = prefix ? `${prefix}-${trn}-${String(num1).padStart(2, '0')}` : `${trn}-${String(num1).padStart(2, '0')}`;
            let code2 = null;
            if (i + 1 < qty) {
                const num2 = startFrom + i + 1;
                code2 = prefix ? `${prefix}-${trn}-${String(num2).padStart(2, '0')}` : `${trn}-${String(num2).padStart(2, '0')}`;
            }
            
            const labelDiv = document.createElement('div');
            labelDiv.className = 'print-label';
            
            if (PrintState.settings.boxOutputFormat === 'barcode') {
                const canvas = await createDoubleBoxBarcode(code1, code2, topText);
                labelDiv.appendChild(canvas);
            } else {
                const canvas = await createDoubleBoxQR(code1, code2, 180, topText);
                labelDiv.appendChild(canvas);
            }
            
            printContainer.appendChild(labelDiv);
            await sleep(10);
        }
        
        await sleep(100);
        window.print();
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
// BOX CODE - CANVAS FUNCTIONS (4x6 inch labels)
// ============================================
function createDoubleBoxBarcode(text1, text2, topText) {
    return new Promise((resolve) => {
        const padding = 20;
        const barcodeHeight = 100;
        const fontSize = 28;
        const textHeight = fontSize + 10;
        const lineHeight = 2;
        const headerHeight = topText ? fontSize + 14 : 0;           // the optional text above each code
        const sectionHeight = headerHeight + barcodeHeight + textHeight + lineHeight + 30;
        
        const tempSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        tempSvg.id = 'tempBarcode';
        tempSvg.style.position = 'absolute';
        tempSvg.style.left = '-9999px';
        document.body.appendChild(tempSvg);
        
        JsBarcode('#tempBarcode', text1, { format: 'CODE128', width: 3, height: barcodeHeight, displayValue: false, margin: 0 });
        
        const barcodeWidth = tempSvg.getBBox().width;
        document.body.removeChild(tempSvg);
        
        const tempCanvas = document.createElement('canvas');
        const tempCtx = tempCanvas.getContext('2d');
        tempCtx.font = `bold ${fontSize}px Arial`;
        const textWidth1 = tempCtx.measureText(text1).width;
        const textWidth2 = text2 ? tempCtx.measureText(text2).width : 0;
        const maxTextWidth = Math.max(textWidth1, textWidth2);
        
        const canvasWidth = Math.max(barcodeWidth, maxTextWidth) + (padding * 2);
        const labelHeight = Math.max(576, text2 && topText ? 2 * sectionHeight + 3 * padding : 0);
        const canvasHeight = text2 ? labelHeight : sectionHeight + padding;
        
        const canvas = document.createElement('canvas');
        canvas.width = canvasWidth;
        canvas.height = canvasHeight;
        canvas.style.display = 'block';
        canvas.style.margin = '0 auto';
        
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        const svg1 = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg1.id = 'barcode1';
        svg1.style.position = 'absolute';
        svg1.style.left = '-9999px';
        document.body.appendChild(svg1);
        
        JsBarcode('#barcode1', text1, { format: 'CODE128', width: 3, height: barcodeHeight, displayValue: false, margin: 0 });
        
        const svgData1 = new XMLSerializer().serializeToString(svg1);
        const img1 = new Image();
        
        img1.onload = function() {
            const barcodeX = (canvasWidth - barcodeWidth) / 2;
            if (topText) drawBoxHeaderText(ctx, topText, canvasWidth / 2, padding + fontSize, canvasWidth - padding * 2, fontSize);
            ctx.drawImage(img1, barcodeX, padding + headerHeight);
            
            const line1Y = padding + headerHeight + barcodeHeight + 15;
            ctx.strokeStyle = '#000000';
            ctx.lineWidth = lineHeight;
            ctx.beginPath();
            ctx.moveTo(padding, line1Y);
            ctx.lineTo(canvasWidth - padding, line1Y);
            ctx.stroke();
            
            const text1Y = line1Y + fontSize + 5;
            ctx.fillStyle = '#000000';
            ctx.font = `bold ${fontSize}px Arial`;
            ctx.textAlign = 'center';
            ctx.fillText(text1, canvasWidth / 2, text1Y);
            
            document.body.removeChild(svg1);
            
            if (text2) {
                const svg2 = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
                svg2.id = 'barcode2';
                svg2.style.position = 'absolute';
                svg2.style.left = '-9999px';
                document.body.appendChild(svg2);
                
                JsBarcode('#barcode2', text2, { format: 'CODE128', width: 3, height: barcodeHeight, displayValue: false, margin: 0 });
                
                const svgData2 = new XMLSerializer().serializeToString(svg2);
                const img2 = new Image();
                
                img2.onload = function() {
                    const section2Start = canvasHeight - sectionHeight - padding;
                    if (topText) drawBoxHeaderText(ctx, topText, canvasWidth / 2, section2Start + fontSize, canvasWidth - padding * 2, fontSize);
                    ctx.drawImage(img2, barcodeX, section2Start + headerHeight);
                    
                    const line2Y = section2Start + headerHeight + barcodeHeight + 15;
                    ctx.beginPath();
                    ctx.moveTo(padding, line2Y);
                    ctx.lineTo(canvasWidth - padding, line2Y);
                    ctx.stroke();
                    
                    const text2Y = line2Y + fontSize + 5;
                    ctx.fillStyle = '#000000';
                    ctx.font = `bold ${fontSize}px Arial`;
                    ctx.textAlign = 'center';
                    ctx.fillText(text2, canvasWidth / 2, text2Y);
                    
                    document.body.removeChild(svg2);
                    resolve(canvas);
                };
                
                img2.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgData2)));
            } else {
                resolve(canvas);
            }
        };
        
        img1.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgData1)));
    });
}

function createDoubleBoxQR(text1, text2, qrSize, topText) {
    return new Promise((resolve) => {
        const tempDiv1 = document.createElement('div');
        tempDiv1.style.position = 'absolute';
        tempDiv1.style.left = '-9999px';
        document.body.appendChild(tempDiv1);
        
        const tempDiv2 = document.createElement('div');
        tempDiv2.style.position = 'absolute';
        tempDiv2.style.left = '-9999px';
        document.body.appendChild(tempDiv2);
        
        new QRCode(tempDiv1, { text: text1, width: qrSize, height: qrSize, colorDark: '#000000', colorLight: '#ffffff', correctLevel: QRCode.CorrectLevel.M });
        
        if (text2) {
            new QRCode(tempDiv2, { text: text2, width: qrSize, height: qrSize, colorDark: '#000000', colorLight: '#ffffff', correctLevel: QRCode.CorrectLevel.M });
        }
        
        setTimeout(() => {
            const qrImg1 = tempDiv1.querySelector('img') || tempDiv1.querySelector('canvas');
            const qrImg2 = text2 ? (tempDiv2.querySelector('img') || tempDiv2.querySelector('canvas')) : null;
            
            const fontSize = 32;
            const padding = 20;
            const lineHeight = 2;
            const textHeight = fontSize + 15;
            const headerHeight = topText ? fontSize + 14 : 0;           // the optional text above each code
            const sectionHeight = headerHeight + qrSize + padding + lineHeight + textHeight;
            
            const tempCanvas = document.createElement('canvas');
            const tempCtx = tempCanvas.getContext('2d');
            tempCtx.font = `bold ${fontSize}px Arial`;
            const textWidth1 = tempCtx.measureText(text1).width;
            const textWidth2 = text2 ? tempCtx.measureText(text2).width : 0;
            const maxTextWidth = Math.max(textWidth1, textWidth2);
            
            const canvasWidth = Math.max(qrSize, maxTextWidth) + (padding * 2);
            const labelHeight = Math.max(558, text2 && topText ? 2 * sectionHeight + 3 * padding : 0);
            const canvasHeight = text2 ? labelHeight : sectionHeight + padding;
            
            const canvas = document.createElement('canvas');
            canvas.width = canvasWidth;
            canvas.height = canvasHeight;
            canvas.style.display = 'block';
            canvas.style.margin = '0 auto';
            
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            
            const qrX = (canvasWidth - qrSize) / 2;
            if (topText) drawBoxHeaderText(ctx, topText, canvasWidth / 2, padding + fontSize, canvasWidth - padding * 2, fontSize);
            if (qrImg1) {
                ctx.drawImage(qrImg1, qrX, padding + headerHeight, qrSize, qrSize);
            }
            
            const line1Y = padding + headerHeight + qrSize + 10;
            ctx.strokeStyle = '#000000';
            ctx.lineWidth = lineHeight;
            ctx.beginPath();
            ctx.moveTo(padding, line1Y);
            ctx.lineTo(canvasWidth - padding, line1Y);
            ctx.stroke();
            
            const text1Y = line1Y + fontSize + 10;
            ctx.fillStyle = '#000000';
            ctx.font = `bold ${fontSize}px Arial`;
            ctx.textAlign = 'center';
            ctx.fillText(text1, canvasWidth / 2, text1Y);
            
            if (text2 && qrImg2) {
                const section2Start = canvasHeight - sectionHeight - padding;
                if (topText) drawBoxHeaderText(ctx, topText, canvasWidth / 2, section2Start + fontSize, canvasWidth - padding * 2, fontSize);
                ctx.drawImage(qrImg2, qrX, section2Start + headerHeight, qrSize, qrSize);
                
                const line2Y = section2Start + headerHeight + qrSize + 10;
                ctx.beginPath();
                ctx.moveTo(padding, line2Y);
                ctx.lineTo(canvasWidth - padding, line2Y);
                ctx.stroke();
                
                const text2Y = line2Y + fontSize + 10;
                ctx.fillStyle = '#000000';
                ctx.font = `bold ${fontSize}px Arial`;
                ctx.textAlign = 'center';
                ctx.fillText(text2, canvasWidth / 2, text2Y);
            }
            
            document.body.removeChild(tempDiv1);
            document.body.removeChild(tempDiv2);
            resolve(canvas);
        }, 200);
    });
}

// ============================================
// BOX CODE - SETTINGS
// ============================================
function openBoxSettings() {
    document.getElementById('settingBoxOutputFormat').value = PrintState.settings.boxOutputFormat;
    document.getElementById('settingBoxPrefix').value = PrintState.settings.boxPrefix;
    document.getElementById('boxSettingsModal').classList.add('active');
}

function closeBoxSettings() {
    document.getElementById('boxSettingsModal').classList.remove('active');
}

function saveBoxSettings() {
    PrintState.settings.boxOutputFormat = document.getElementById('settingBoxOutputFormat').value;
    PrintState.settings.boxPrefix = document.getElementById('settingBoxPrefix').value.trim();
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
