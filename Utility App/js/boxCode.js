// ============================================
// BOX CODE - INITIALIZATION
// ============================================
function initBoxCode() {
    loadPrintSettings();
    updateBoxDisplaySettings();
    setupBoxCodeListeners();
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
            JsBarcode('#boxPreviewBarcode', code1, { format: 'CODE128', width: 2, height: 60, displayValue: true, fontSize: 12, margin: 5 });
        } catch (e) {
            console.error('Barcode error:', e);
        }
    } else {
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
                const canvas = await createDoubleBoxBarcode(code1, code2);
                labelDiv.appendChild(canvas);
            } else {
                const canvas = await createDoubleBoxQR(code1, code2, 180);
                labelDiv.appendChild(canvas);
            }
            
            printContainer.appendChild(labelDiv);
            await sleep(10);
        }
        
        await sleep(100);
        window.print();
        
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
function createDoubleBoxBarcode(text1, text2) {
    return new Promise((resolve) => {
        const padding = 20;
        const barcodeHeight = 100;
        const fontSize = 28;
        const textHeight = fontSize + 10;
        const lineHeight = 2;
        const sectionHeight = barcodeHeight + textHeight + lineHeight + 30;
        
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
        const labelHeight = 576;
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
            ctx.drawImage(img1, barcodeX, padding);
            
            const line1Y = padding + barcodeHeight + 15;
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
                    ctx.drawImage(img2, barcodeX, section2Start);
                    
                    const line2Y = section2Start + barcodeHeight + 15;
                    ctx.beginPath();
                    ctx.moveTo(padding, line2Y);
                    ctx.lineTo(canvasWidth - padding, line2Y);
                    ctx.stroke();
                    
                    const text2Y = line2Y + fontSize + 5;
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

function createDoubleBoxQR(text1, text2, qrSize) {
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
            const sectionHeight = qrSize + padding + lineHeight + textHeight;
            
            const tempCanvas = document.createElement('canvas');
            const tempCtx = tempCanvas.getContext('2d');
            tempCtx.font = `bold ${fontSize}px Arial`;
            const textWidth1 = tempCtx.measureText(text1).width;
            const textWidth2 = text2 ? tempCtx.measureText(text2).width : 0;
            const maxTextWidth = Math.max(textWidth1, textWidth2);
            
            const canvasWidth = Math.max(qrSize, maxTextWidth) + (padding * 2);
            const labelHeight = 558;
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
            if (qrImg1) {
                ctx.drawImage(qrImg1, qrX, padding, qrSize, qrSize);
            }
            
            const line1Y = padding + qrSize + 10;
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
                ctx.drawImage(qrImg2, qrX, section2Start, qrSize, qrSize);
                
                const line2Y = section2Start + qrSize + 10;
                ctx.beginPath();
                ctx.moveTo(padding, line2Y);
                ctx.lineTo(canvasWidth - padding, line2Y);
                ctx.stroke();
                
                const text2Y = line2Y + fontSize + 10;
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
