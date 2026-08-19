// ============================================
// PHOTO CAPTURE APP
// ============================================

const PhotoState = {
    mode: 'single',
    photos: [],
    skuCounts: {},
    stream: null,
    downloadType: 'session'
};

function initPhotoCapture() {
    loadPhotoSettings();
    updatePhotoDisplay();
    startCamera();
    
    document.getElementById('skuInput').addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
            capturePhoto();
        }
    });
    
    document.getElementById('downloadType').addEventListener('change', function() {
        PhotoState.downloadType = this.value;
        savePhotoSettings();
    });
}

function loadPhotoSettings() {
    const saved = localStorage.getItem('aku_photo_settings');
    if (saved) {
        const settings = JSON.parse(saved);
        PhotoState.mode = settings.mode || 'single';
        PhotoState.downloadType = settings.downloadType || 'session';
    }
    
    document.getElementById('downloadType').value = PhotoState.downloadType;
    updateModeUI();
}

function savePhotoSettings() {
    localStorage.setItem('aku_photo_settings', JSON.stringify({
        mode: PhotoState.mode,
        downloadType: PhotoState.downloadType
    }));
}

function setPhotoMode(mode) {
    PhotoState.mode = mode;
    updateModeUI();
    savePhotoSettings();
}

function updateModeUI() {
    document.getElementById('singleModeBtn').classList.toggle('active', PhotoState.mode === 'single');
    document.getElementById('multiModeBtn').classList.toggle('active', PhotoState.mode === 'multi');
    
    const hint = document.getElementById('skuHint');
    if (PhotoState.mode === 'single') {
        hint.textContent = 'Single mode: 1 photo per SKU';
    } else {
        hint.textContent = 'Multi mode: up to 8 photos per SKU (_1, _2, _3...)';
    }
    
    updateSkuPhotoCount();
}

async function startCamera() {
    try {
        const constraints = {
            video: {
                facingMode: 'environment',
                width: { ideal: 1920 },
                height: { ideal: 1080 }
            }
        };
        
        PhotoState.stream = await navigator.mediaDevices.getUserMedia(constraints);
        const video = document.getElementById('cameraVideo');
        video.srcObject = PhotoState.stream;
    } catch (error) {
        console.error('Camera error:', error);
        alert('Unable to access camera. Please ensure camera permissions are granted.');
    }
}

function stopCamera() {
    if (PhotoState.stream) {
        PhotoState.stream.getTracks().forEach(track => track.stop());
        PhotoState.stream = null;
    }
}

function updateSkuPhotoCount() {
    const sku = document.getElementById('skuInput').value.trim();
    const count = PhotoState.skuCounts[sku] || 0;
    document.getElementById('skuPhotoCount').textContent = count;
}
function capturePhoto() {
    const sku = document.getElementById('skuInput').value.trim();
    
    if (!sku) {
        alert('Please enter a SKU first');
        document.getElementById('skuInput').focus();
        return;
    }
    
    if (!/^\d+$/.test(sku)) {
        alert('SKU must be numeric only');
        document.getElementById('skuInput').focus();
        return;
    }
    
    const currentCount = PhotoState.skuCounts[sku] || 0;
    
    if (PhotoState.mode === 'single' && currentCount >= 1) {
        alert('SKU already captured. Switch to Multi mode for multiple photos.');
        return;
    }
    
    if (PhotoState.mode === 'multi' && currentCount >= 8) {
        alert('Maximum 8 photos per SKU reached.');
        return;
    }
    
    const video = document.getElementById('cameraVideo');
    const canvas = document.getElementById('cameraCanvas');
    
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0);
    
    const imageData = canvas.toDataURL('image/jpeg', 0.95);
    
    let fileName;
    if (PhotoState.mode === 'single') {
        fileName = `${sku}.jpg`;
    } else {
        const photoNum = currentCount + 1;
        fileName = `${sku}_${photoNum}.jpg`;
    }
    
    const photo = {
        sku: sku,
        fileName: fileName,
        data: imageData,
        timestamp: new Date().toISOString()
    };
    
    PhotoState.photos.push(photo);
    PhotoState.skuCounts[sku] = currentCount + 1;
    
    updateSkuPhotoCount();
    updatePhotoDisplay();
    updatePhotoStats();
    
    if (PhotoState.mode === 'single') {
        document.getElementById('skuInput').value = '';
        document.getElementById('skuInput').focus();
    }
}

function updatePhotoDisplay() {
    const grid = document.getElementById('photoGrid');
    
    if (PhotoState.photos.length === 0) {
        grid.innerHTML = '<p style="color: var(--ak-text-light); text-align: center; grid-column: 1/-1; padding: 20px;">No photos captured yet</p>';
        return;
    }
    
    grid.innerHTML = PhotoState.photos.map((photo, index) => `
        <div class="photo-thumb">
            <img src="${photo.data}" alt="${photo.fileName}">
            <button class="delete-photo" onclick="deletePhoto(${index})">×</button>
            <div class="photo-name">${photo.fileName}</div>
        </div>
    `).join('');
}

function updatePhotoStats() {
    const uniqueSkus = Object.keys(PhotoState.skuCounts).length;
    const totalPhotos = PhotoState.photos.length;
    
    let totalSize = 0;
    PhotoState.photos.forEach(photo => {
        const base64Length = photo.data.length - 'data:image/jpeg;base64,'.length;
        totalSize += (base64Length * 0.75);
    });
    
    const sizeMB = (totalSize / (1024 * 1024)).toFixed(1);
    
    document.getElementById('totalSkus').textContent = uniqueSkus;
    document.getElementById('totalPhotos').textContent = totalPhotos;
    document.getElementById('sessionSize').textContent = `${sizeMB} MB`;
}

function deletePhoto(index) {
    const photo = PhotoState.photos[index];
    const sku = photo.sku;
    
    PhotoState.photos.splice(index, 1);
    PhotoState.skuCounts[sku]--;
    
    if (PhotoState.skuCounts[sku] <= 0) {
        delete PhotoState.skuCounts[sku];
    }
    
    updateSkuPhotoCount();
    updatePhotoDisplay();
    updatePhotoStats();
}

function clearPhotoSession() {
    if (PhotoState.photos.length === 0) return;
    
    if (!confirm('Clear all captured photos?')) return;
    
    PhotoState.photos = [];
    PhotoState.skuCounts = {};
    
    document.getElementById('skuInput').value = '';
    updateSkuPhotoCount();
    updatePhotoDisplay();
    updatePhotoStats();
}

async function downloadPhotos() {
    if (PhotoState.photos.length === 0) {
        alert('No photos to download');
        return;
    }
    
    const downloadType = document.getElementById('downloadType').value;
    
    if (downloadType === 'session') {
        await downloadAsSessionZip();
    } else {
        await downloadAsSkuZips();
    }
}

async function downloadAsSessionZip() {
    const zip = new JSZip();
    
    PhotoState.photos.forEach(photo => {
        const base64Data = photo.data.split(',')[1];
        zip.file(photo.fileName, base64Data, { base64: true });
    });
    
    const content = await zip.generateAsync({ type: 'blob' });
    const timestamp = new Date().toISOString().slice(0, 10);
    const fileName = `photos_${timestamp}.zip`;
    
    const link = document.createElement('a');
    link.href = URL.createObjectURL(content);
    link.download = fileName;
    link.click();
    URL.revokeObjectURL(link.href);
}

async function downloadAsSkuZips() {
    const skuGroups = {};
    
    PhotoState.photos.forEach(photo => {
        if (!skuGroups[photo.sku]) {
            skuGroups[photo.sku] = [];
        }
        skuGroups[photo.sku].push(photo);
    });
    
    for (const sku in skuGroups) {
        const zip = new JSZip();
        
        skuGroups[sku].forEach(photo => {
            const base64Data = photo.data.split(',')[1];
            zip.file(photo.fileName, base64Data, { base64: true });
        });
        
        const content = await zip.generateAsync({ type: 'blob' });
        const fileName = `${sku}.zip`;
        
        const link = document.createElement('a');
        link.href = URL.createObjectURL(content);
        link.download = fileName;
        link.click();
        URL.revokeObjectURL(link.href);
        
        await new Promise(resolve => setTimeout(resolve, 500));
    }
}
// createQRWithText is defined in config.js
