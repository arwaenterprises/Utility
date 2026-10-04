// Item Barcode: shorter bars and the "Add text" toggle (text above the barcode), using the real JsBarcode library.
const { start, openApp, report, stop } = require('./helpers/harness');

(async () => {
  const ctx = await start();
  const { page, errors } = await openApp(ctx);
  const log = await page.evaluate(async () => {
    const log = []; const ok = (name, cond, extra) => log.push({ pass: !!cond, name, extra: extra === undefined ? '' : String(extra) });
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    window.alert = () => {}; let prints = 0; window.print = () => { prints++; };
    AppState.user = { id: 'u1', email: 'a@b.c' }; AppState.profile = { display_name: 'A', enterprise_id: null, tier: 'individual' };
    localStorage.clear();
    initItemBarcode();

    const draw = (id, text) => {
      PrintState.settings.labelTextOn = !!text; PrintState.settings.labelText = text || '';
      const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.id = id; document.body.appendChild(s);
      drawItemBarcode(id, '300100010265'); return s;
    };
    // the bars are the narrow rectangles (the white background rectangles are as wide as the whole label)
    const barHeights = (svg) => [...svg.querySelectorAll('rect')].filter(r => /^\d+$/.test(r.getAttribute('width') || '') && Number(r.getAttribute('width')) < 20).map(r => parseFloat(r.getAttribute('height')));

    // ---------- bar height ----------
    const old = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); old.id = 'old'; document.body.appendChild(old);
    JsBarcode('#old', '300100010265', { format: 'CODE128C', width: 2, height: 80, displayValue: true, fontSize: 16, margin: 5 });
    const off = draw('off', '');
    const oldBar = Math.max(...barHeights(old)), newBar = Math.max(...barHeights(off));
    ok('bars are 12.5% shorter than before (80 -> 70)', oldBar === 80 && newBar === 70 && (oldBar - newBar) / oldBar > 0.10 && (oldBar - newBar) / oldBar < 0.15, oldBar + ' -> ' + newBar);

    // ---------- toggle off: today's label ----------
    ok('toggle off: no extra text, label is just bars + number', !off.querySelector('.item-label-text') && /300100010265/.test(off.textContent));
    const numFont = (svg) => (svg.querySelector('text').getAttribute('style') || '').match(/(\d+)px/)?.[1];
    ok('the number under the bars is bigger (16px -> 22px)', numFont(old) === '16' && numFont(off) === '22', numFont(old) + ' -> ' + numFont(off));

    // ---------- toggle on: text above the bars ----------
    const on = draw('on', 'Apparel');
    const t = on.querySelector('.item-label-text');
    ok('toggle on: the text is drawn above the barcode, bold, left-aligned with the bars', !!t && t.textContent === 'Apparel' && t.getAttribute('font-weight') === '700' && Number(t.getAttribute('x')) === ITEM_QUIET_ZONE, t && t.outerHTML);
    ok('toggle on: the number is still printed under the bars', /300100010265/.test(on.textContent));
    ok('toggle on: the text above is the same size as the number (22)', t.getAttribute('font-size') === '22' && numFont(on) === '22');
    ok('toggle on: the label grew by the header height only; bars unchanged (70)', parseFloat(on.getAttribute('height')) > parseFloat(off.getAttribute('height')) && Math.max(...barHeights(on)) === 70);
    ok('toggle on: the text sits above the bars (smaller y than the first bar)', Number(t.getAttribute('y')) < 30 && on.querySelector('g').getAttribute('transform').startsWith('translate(0 '), on.querySelector('g').getAttribute('transform'));
    const long = draw('long', 'A very long line of label text 1234567890');
    ok('a long text shrinks to fit within the bars instead of running off the label', Number(long.querySelector('.item-label-text').getAttribute('font-size')) < 18 && Number(long.querySelector('.item-label-text').getAttribute('font-size')) >= 9, long.querySelector('.item-label-text').getAttribute('font-size'));
    ok('HTML in the text is shown as text, not run', (() => { const s = draw('evil', '<img src=x onerror=alert(1)>'); return s.querySelectorAll('img').length === 0 && s.querySelector('.item-label-text').textContent.includes('<img'); })());

    // ---------- the controls ----------
    PrintState.settings.labelTextOn = false; PrintState.settings.labelText = ''; syncItemTextControls();
    const toggle = document.getElementById('itemTextToggle'), box = document.getElementById('itemLabelText');
    ok('controls: off by default, text box hidden', !toggle.checked && getComputedStyle(box).display === 'none');
    toggle.checked = true; toggle.dispatchEvent(new Event('change'));
    ok('controls: switching on shows the text box', getComputedStyle(box).display !== 'none' && PrintState.settings.labelTextOn === true);
    box.value = 'Apparel'; box.dispatchEvent(new Event('input'));
    document.getElementById('itemBarcodeInput').value = '300100010265'; document.getElementById('itemBarcodeInput').dispatchEvent(new Event('input'));
    ok('controls: the preview shows the text above the barcode', /Apparel/.test(document.getElementById('itemPreviewArea').textContent) && !!document.querySelector('#previewBarcode .item-label-text'));
    ok('controls: choice and text are remembered on this device', JSON.parse(localStorage.getItem('aku_print_settings')).labelTextOn === true && JSON.parse(localStorage.getItem('aku_print_settings')).labelText === 'Apparel');
    PrintState.settings.labelTextOn = false; PrintState.settings.labelText = ''; initItemBarcode();
    ok('controls: remembered after reopening the tab', toggle.checked === true && box.value === 'Apparel' && getComputedStyle(box).display !== 'none');
    toggle.checked = false; toggle.dispatchEvent(new Event('change'));
    ok('controls: switching off hides the box and the preview goes back to the plain label', getComputedStyle(box).display === 'none' && !document.querySelector('#previewBarcode .item-label-text'));

    // ---------- printing ----------
    const statusText = () => document.getElementById('itemStatusText').textContent;
    document.getElementById('itemBarcodeInput').value = '300100010265';
    toggle.checked = true; toggle.dispatchEvent(new Event('change')); box.value = ''; box.dispatchEvent(new Event('input'));
    prints = 0; await printItemLabel(); await sleep(150);
    ok('print with the toggle on but no text: stopped with a clear message, nothing printed', prints === 0 && /Enter the text for the label/.test(statusText()), statusText());
    box.value = 'Apparel'; box.dispatchEvent(new Event('input'));
    setItemPrintMode('bulk'); document.getElementById('itemQtyInput').value = '3';
    await printItemLabel(); await sleep(400);
    const labels = [...document.querySelectorAll('#printContainer .print-label')];
    ok('print: 3 labels, each with the text above the barcode', prints === 1 && labels.length === 3 && labels.every(l => l.querySelector('.item-label-text')?.textContent === 'Apparel'), labels.length + ' labels, prints=' + prints);
    toggle.checked = false; toggle.dispatchEvent(new Event('change'));
    document.getElementById('itemBarcodeInput').value = '300100010265'; setItemPrintMode('single'); prints = 0;
    await printItemLabel(); await sleep(400);
    ok('print with the toggle off: the plain label, no text', prints === 1 && document.querySelectorAll('#printContainer .item-label-text').length === 0 && document.querySelectorAll('#printContainer .print-label').length === 1);
    // pasted comma-separated values: one label per barcode, printed straight from the Print Label button
    toggle.checked = false; toggle.dispatchEvent(new Event('change')); setItemPrintMode('single');
    document.getElementById('itemBarcodeInput').value = '1,2,3,4,5,6'; prints = 0;
    await printItemLabel(); await sleep(500);
    const sixLabels = [...document.querySelectorAll('#printContainer .print-label')];
    ok('Print Label with comma-separated values: 6 separate labels, none holding commas', prints === 1 && sixLabels.length === 6 && sixLabels.every((l, i) => l.textContent.trim() === String(i + 1)), sixLabels.map(l => l.textContent).join('|'));
    ok('...and the input is cleared afterwards', document.getElementById('itemBarcodeInput').value === '');
    ok('while labels print the page switches to print layout, then back', !document.body.classList.contains('printing-labels'));
    // 100 rows (the Excel/CSV case that used to hang)
    let big = 'Barcode,Qty,Text\n'; for (let i = 0; i < 100; i++) big += (300100010000 + i) + ',1,\n';
    parseCSV(big); prints = 0; const t0 = performance.now(); await printFromCSV(); await sleep(300);
    ok('100 CSV rows: 100 labels and the print window opens quickly', prints === 1 && document.querySelectorAll('#printContainer .print-label').length === 100 && performance.now() - t0 < 5000, Math.round(performance.now() - t0) + ' ms');
    ok('bars have a 20px quiet zone each side', (() => { const s = document.querySelector('#printContainer svg'); const first = [...s.querySelectorAll('rect')].filter(r => Number(r.getAttribute('width')) < 20 && /^\d+$/.test(r.getAttribute('width')))[0]; return Number(first.getAttribute('x')) >= 20 || /translate\(20/.test(first.parentNode.getAttribute('transform') || '') || Number(first.getAttribute('x')) >= 20; })());
    toggle.checked = true; toggle.dispatchEvent(new Event('change'));
    // CSV upload path
    toggle.checked = true; toggle.dispatchEvent(new Event('change')); box.value = 'Footwear'; box.dispatchEvent(new Event('input'));
    PrintState.csvData = [{ barcode: '111', qty: 2 }, { barcode: '222', qty: 1 }]; prints = 0;
    await printFromCSV(); await sleep(500);
    const csvLabels = [...document.querySelectorAll('#printContainer .print-label')];
    ok('CSV print: every label carries the same text', prints === 1 && csvLabels.length === 3 && csvLabels.every(l => l.querySelector('.item-label-text')?.textContent === 'Footwear'), csvLabels.length + ' labels');

    // ---------- bulk (CSV) upload with a Text column ----------
    PrintState.settings.outputFormat = 'barcode';
    const origClick = HTMLAnchorElement.prototype.click; let tplBlob = null;
    URL.createObjectURL = (b) => { tplBlob = b; return 'blob:test'; }; HTMLAnchorElement.prototype.click = () => {};
    downloadTemplate(); HTMLAnchorElement.prototype.click = origClick;
    const tpl = await tplBlob.text();
    ok('CSV template has the columns Barcode, Qty, Text', tpl.split('\n')[0] === 'Barcode,Qty,Text', tpl.split('\n')[0]);
    parseCSV('Barcode,Qty,Text\r\n111,2,Apparel\r\n222,1,"Men, Apparel"\r\n333,1,\r\n444,3\r\n,,\r\n555,1,"He said ""hi"""\r\n');
    const rows = PrintState.csvData;
    ok('CSV: text column is read per row, incl. commas inside quotes and doubled quotes', rows.length === 5 && rows[0].text === 'Apparel' && rows[1].text === 'Men, Apparel' && rows[2].text === '' && rows[3].text === '' && rows[4].text === 'He said "hi"', JSON.stringify(rows.map(r => r.text)));
    ok('CSV: quantities still read', rows.map(r => r.qty).join() === '2,1,1,3,1');
    parseCSV('Barcode,Qty\n111,2\n222,1\n');
    ok('CSV: an old two-column file (Barcode,Qty) still works, text empty', PrintState.csvData.length === 2 && PrintState.csvData.every(r => r.text === '') && PrintState.csvData[0].qty === 2);
    parseCSV('Text,Qty,Barcode\nShoes,4,777\n');
    ok('CSV: columns are found by name, in any order', PrintState.csvData[0].barcode === '777' && PrintState.csvData[0].qty === 4 && PrintState.csvData[0].text === 'Shoes');
    parseCSV('﻿Barcode,Qty,Text\n888,1,x\n');
    ok('CSV: a file saved by Excel with a byte-order mark is read correctly', PrintState.csvData.length === 1 && PrintState.csvData[0].barcode === '888');

    const csv = 'Barcode,Qty,Text\n111,2,Apparel\n222,1,"Men, Apparel"\n333,1,\n444,3\n';
    // toggle ON + a default text: rows with their own text use it, the others use the default
    toggle.checked = true; toggle.dispatchEvent(new Event('change')); box.value = 'Default'; box.dispatchEvent(new Event('input'));
    parseCSV(csv);
    ok('CSV preview shows each row\'s text (own or default)', /111 × 2 — <strong>Apparel/.test(document.getElementById('itemCsvPreviewContent').innerHTML) && /333 × 1 — <strong>Default/.test(document.getElementById('itemCsvPreviewContent').innerHTML), document.getElementById('itemCsvPreviewContent').textContent);
    prints = 0; await printFromCSV(); await sleep(600);
    let texts = [...document.querySelectorAll('#printContainer .print-label')].map(l => l.querySelector('.item-label-text')?.textContent);
    ok('CSV print: every label carries its own row text, or the default for rows without', prints === 1 && texts.join('|') === 'Apparel|Apparel|Men, Apparel|Default|Default|Default|Default', texts.join('|'));
    // toggle ON, no default text, but every row has its own text: prints fine
    box.value = ''; box.dispatchEvent(new Event('input'));
    PrintState.csvData = [{ barcode: '1', qty: 1, text: 'A' }, { barcode: '2', qty: 1, text: 'B' }];
    prints = 0; await printFromCSV(); await sleep(500);
    ok('CSV print: no default text needed when every row has its own', prints === 1 && [...document.querySelectorAll('#printContainer .item-label-text')].map(x => x.textContent).join() === 'A,B');
    // toggle ON, no default, a row without text: stopped with a message
    PrintState.csvData = [{ barcode: '1', qty: 1, text: 'A' }, { barcode: '2', qty: 1, text: '' }];
    prints = 0; await printFromCSV(); await sleep(150);
    ok('CSV print: a row without text and no default stops the print with a message', prints === 0 && /Enter the text for the label/.test(statusText()), statusText());
    // toggle OFF: the Text column is ignored
    toggle.checked = false; toggle.dispatchEvent(new Event('change'));
    PrintState.csvData = [{ barcode: '1', qty: 1, text: 'A' }, { barcode: '2', qty: 2, text: 'B' }];
    prints = 0; await printFromCSV(); await sleep(500);
    ok('CSV print with Add text off: plain labels, the Text column is ignored', prints === 1 && document.querySelectorAll('#printContainer .print-label').length === 3 && document.querySelectorAll('#printContainer .item-label-text').length === 0);
    // comma-separated barcodes typed in the box use the default text
    toggle.checked = true; toggle.dispatchEvent(new Event('change')); box.value = 'Typed'; box.dispatchEvent(new Event('input'));
    document.getElementById('itemBarcodeInput').value = '10,20,30'; handleItemBarcodeEnter();
    ok('comma-separated barcodes: one label each, all with the default text', PrintState.csvData.length === 3 && PrintState.csvData.every(r => csvRowText(r) === 'Typed'));

    // QR labels get the text as a header above the code
    PrintState.settings.outputFormat = 'qr';
    window.createQRWithText = async () => { const c = document.createElement('canvas'); c.width = 10; c.height = 10; return c; };
    document.getElementById('itemBarcodeInput').value = '999'; prints = 0; await printItemLabel(); await sleep(400);
    const qrLabel = document.querySelector('#printContainer .print-label');
    ok('QR label: the text is a header above the code', !!qrLabel && qrLabel.firstElementChild.classList.contains('item-label-text') && qrLabel.firstElementChild.textContent === 'Typed' && qrLabel.lastElementChild.tagName === 'CANVAS');
    PrintState.settings.outputFormat = 'barcode';
    return log;
  });
  const failures = report(log, errors.filter(e => !/Failed to load resource/.test(e)));
  await stop(ctx);
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('TEST CRASH', e); process.exit(1); });
