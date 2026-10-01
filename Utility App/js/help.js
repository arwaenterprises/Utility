// ============================================
// HELP - step-by-step guide for each tool
// ============================================
// A "?" button in every tool's header opens the guide. The first time a person opens a
// tool, its guide opens by itself once (remembered per person on this device).
// To add a tool's guide: add an entry to HELP using the same id as in APPS (config.js).
const HELP = {
    boxScanner: {
        intro: 'Scan items into boxes, close each box, then download the list.',
        steps: [
            'Type a <b>Remark</b> (for example "Fall Winter 2023 stocks") and tap <b>Start Session</b>.',
            'Scan the <b>Box ID</b> (the label on the box).',
            'Scan each <b>item barcode</b> that goes into that box. The last 5 scans show below; tap <b>Del</b> to remove a mistake.',
            'When the box is full, tap <b>Close Box</b>, tap <b>Yes</b>, then scan the Box ID again to confirm.',
            'Repeat for the next box. Tap <b>View Box</b> and scan any box ID to see what is inside it.',
            'When you are finished, tap <b>Download</b> to get the Excel file, then <b>Reset</b> to start a new session.'
        ],
        tips: [
            '<b>Nu</b> accepts numbers only; <b>AlNu</b> accepts letters and numbers. You can change it only when no box is open.',
            '<b>No Dup</b> stops the same barcode being scanned twice.',
            'Works offline. The &#10003; badge shows your scans are saved to the server.',
            'The &#9000;&#65039; button shows or hides the on-screen keyboard (handy with a handheld scanner).'
        ]
    },
    itemBarcode: {
        intro: 'Print barcode or QR labels for items, one at a time or many at once.',
        steps: [
            'Check <b>Mode</b> and <b>Type</b> at the top. Tap <b>Settings</b> to choose Barcode or QR Code, and Numeric or Alphanumeric.',
            '<b>Single:</b> scan or type a barcode, enter the quantity (up to 200), then tap <b>Print Label</b>.',
            '<b>Bulk:</b> tap <b>Template</b>, fill it in (Barcode, Qty and, if you want, Text), tap <b>Upload</b>, check the preview, then <b>Print All</b>.',
            'Switch on <b>Add text</b> to print a line of text above the barcode.'
        ],
        tips: [
            'In Settings, tap <b>Print Test Label</b> first to check your printer.',
            'You can also paste several barcodes separated by commas, for example 123,456,789.'
        ]
    },
    boxCode: {
        intro: 'Print numbered box labels for a transfer (TRN).',
        steps: [
            'Check the <b>Prefix</b> and mode at the top. Tap <b>Settings</b> to change them.',
            'Type the <b>TRN number</b> (Transfer Reference Number).',
            'Enter <b>Start From</b> (the first box number) and <b>Quantity</b> (up to 100).',
            'Check the preview, then tap <b>Print Box Labels</b>.'
        ],
        tips: [
            'Labels are 4&times;6 inches and print 2 codes per label, so Quantity 10 gives 5 labels.'
        ]
    },
    boxSegregate: {
        intro: 'Scan a box barcode to see its details, or check boxes against a pallet.',
        before: 'Your box list must be uploaded first. If you work alone or are your team\'s admin, tap the upload icon (the page icon gives you the template). Team members: your admin uploads the list; tap &#8635; to get it.',
        steps: [
            'Tap <b>&#8635;</b> to load the latest list. The time next to it shows when it was last updated.',
            'Scan the box barcode with the camera (&#128247;) or a handheld scanner. Use &#9000;&#65039; to type it instead.',
            'The result card shows the box details. If it says <b>not found</b>, check the barcode and that the list has been uploaded.',
            '<b>Pallet mode:</b> switch on <b>Pallet</b>, then scan each box on the pallet. The app counts them and flags duplicates and boxes that are not in the list.',
            'In Pallet mode, tap <b>Download</b> for the Excel file, and <b>Reset</b> when the pallet is done.'
        ],
        tips: ['Works offline once the list has been loaded on this device.']
    },
    priceCheck: {
        intro: 'Scan an item to see its price.',
        before: 'The price list must be uploaded first. If you work alone or are your team\'s admin, tap the upload icon (the page icon gives you the template). Team members: your admin uploads the list; tap &#8635; to get it.',
        steps: [
            'Tap <b>&#8635;</b> to load the latest price list. The time next to it shows when it was last updated.',
            'Scan the item with the camera (&#128247;) or a handheld scanner. Use &#9000;&#65039; to type the barcode instead.',
            'The price appears on screen. If it says <b>not found</b>, the item is missing from the price list.'
        ],
        tips: ['Works offline once the list has been loaded on this device.']
    },
    yearSegregate: {
        intro: 'Sort items by year and season into PTL boxes.',
        before: 'The <b>Item Master</b> and <b>PTL config</b> lists must be uploaded first (use the &#11014; Items and &#11014; PTL buttons; the page icons give the templates). Team members: your admin uploads them.',
        steps: [
            'Enter <b>Your Name</b> and a <b>Remark</b>, wait for the items to finish syncing, then tap <b>Start Session</b>.',
            'Choose <b>Nu</b> (numbers only) or <b>AlNu</b> (letters and numbers) at the top.',
            'Scan an <b>item barcode</b>. The app shows which PTL the item belongs to.',
            'Go to that PTL and scan its <b>ST</b> code (for example ST05) to open the box. For a new box, scan the physical box label when asked.',
            'Keep scanning items for that PTL. The app warns you if you scan the wrong PTL or box.',
            'When the box is full, close it (scan the PTL\'s close code, or tap the PTL and choose Close) and scan the box barcode to confirm.',
            'When all boxes are closed and the sync badge shows &#10003;, tap <b>Download</b>, then <b>Reset</b> for a new session.'
        ],
        tips: [
            'You cannot change Nu/AlNu or Reset while a PTL box is still open.',
            'The &#127760; button turns spoken prompts on or off and picks their language.',
            'Tap a PTL in the list to see its details.'
        ]
    }
};

function helpSeenKey(appId) {
    return 'help_seen_' + appId + '_' + ((AppState.user && AppState.user.id) || 'anon');
}

function helpShow(appId) {
    const h = HELP[appId];
    const app = (typeof APPS !== 'undefined') ? APPS.find(a => a.id === appId) : null;
    if (!h || !app) return;
    document.getElementById('helpTitle').innerHTML = app.icon + ' How to use ' + app.name;
    const list = (arr, tag) => '<' + tag + '>' + arr.map(x => '<li>' + x + '</li>').join('') + '</' + tag + '>';
    document.getElementById('helpBody').innerHTML =
        '<p class="help-intro">' + h.intro + '</p>' +
        (h.before ? '<div class="help-before"><b>Before you start:</b> ' + h.before + '</div>' : '') +
        '<h4>Step by step</h4>' + list(h.steps, 'ol') +
        (h.tips && h.tips.length ? '<h4>Good to know</h4>' + list(h.tips, 'ul') : '');
    document.getElementById('helpModal').classList.add('active');
    document.getElementById('helpBody').scrollTop = 0;
    try { Storage.set(helpSeenKey(appId), '1'); } catch (e) { /* storage blocked: fine */ }
}

function helpAutoShowOnce(appId) {
    if (!HELP[appId]) return;
    let seen = null;
    try { seen = Storage.get(helpSeenKey(appId)); } catch (e) { /* storage blocked: show it */ }
    if (!seen) helpShow(appId);
}

document.addEventListener('DOMContentLoaded', () => {
    const open = document.getElementById('helpBtn');
    const close = document.getElementById('helpCloseBtn');
    if (open) open.addEventListener('click', () => { if (AppState.currentApp) helpShow(AppState.currentApp); });
    if (close) close.addEventListener('click', () => document.getElementById('helpModal').classList.remove('active'));
});
