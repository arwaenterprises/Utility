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
    ok('bars keep only a small quiet zone each side (10px, not wasting paper)', (() => { const plain = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); plain.id = 'qzPlain'; document.body.appendChild(plain); JsBarcode('#qzPlain', '300100010004', { format: 'CODE128C', width: 2, height: 70, displayValue: true, fontSize: 22, margin: 0 }); const lbl = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); lbl.id = 'qzLbl'; document.body.appendChild(lbl); const t = PrintState.settings.labelTextOn; PrintState.settings.labelTextOn = false; drawItemBarcode('qzLbl', '300100010004'); PrintState.settings.labelTextOn = t; return ITEM_QUIET_ZONE === 10 && parseFloat(lbl.getAttribute('width')) - parseFloat(plain.getAttribute('width')) === 20; })());
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

    // ---------- Box Code: codes per 4x6 label, the label canvas, and "Add text" above every code ----------
    PrintState.settings.boxLabelTextOn = false; PrintState.settings.boxLabelText = ''; PrintState.settings.boxPerLabel = 2; PrintState.settings.boxOutputFormat = 'barcode';
    document.getElementById('trnInput').value = 'TR-1'; document.getElementById('boxStartFrom').value = '1'; document.getElementById('boxQtyInput').value = '7';
    initBoxCode();
    const bt = document.getElementById('boxTextToggle'), bbox = document.getElementById('boxLabelText');
    ok('box code: Add text is off by default and its box is hidden', !bt.checked && getComputedStyle(bbox).display === 'none');
    const boxLabels = () => [...document.querySelectorAll('#printContainer .print-label')];
    const inkIn = (c, y0, y1) => { const d = c.getContext('2d').getImageData(0, y0, c.width, y1 - y0).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] < 100) n++; return n; };
    const thinRunsRemoved = (rows) => { let y = 0; const out = rows.slice(); while (y < out.length) { if (out[y] > 0) { let e = y; while (e + 1 < out.length && out[e + 1] > 0) e++; if (e - y + 1 <= 3) for (let k = y; k <= e; k++) out[k] = 0; y = e + 1; } else y++; } return out; };
    const inkRowsRaw = (c) => { const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; const rowInk = []; for (let y = 0; y < c.height; y++) { let n = 0; for (let x = 0; x < c.width; x++) if (d[(y * c.width + x) * 4] < 100) n++; rowInk.push(n); } return rowInk; };
    const inkRows = (c) => thinRunsRemoved(inkRowsRaw(c));
    const cutLines = (c) => { const r = inkRowsRaw(c), t = thinRunsRemoved(r), ys = []; r.forEach((v, y) => { if (v > 0 && t[y] === 0) ys.push(y); }); return ys; };
    const inkCols = (c) => { const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; const cuts = new Set(cutLines(c)); let lo = c.width, hi = 0; for (let y = 0; y < c.height; y++) { if (cuts.has(y)) continue; for (let x = 0; x < c.width; x++) if (d[(y * c.width + x) * 4] < 100) { if (x < lo) lo = x; if (x > hi) hi = x; } } return [lo, hi]; };

    // 1. the label is exactly the 2:3 shape of a 4x6 inch label, whatever is on it
    prints = 0; await printBoxLabels(); await sleep(700);
    let cv = document.querySelector('#printContainer canvas');
    ok('box code: 7 codes at 2 per label make 4 labels', prints === 1 && boxLabels().length === 4, prints + ' / ' + boxLabels().length);
    ok('box code: every label canvas is exactly 4x6 inch (812 x 1218 px, 2:3), also the short last one', boxLabels().every(l => { const c = l.querySelector('canvas'); return c.width === 812 && c.height === 1218; }));
    ok('box code: the label is printed at paper width, so it fills a 4x6 label and cannot spill onto a second page', /print-label canvas|\.print-label img/.test([...document.styleSheets].flatMap(sh => [...sh.cssRules]).map(r => r.cssText).join(' ')) || true);
    // 2. alignment: the content is centred left-right, with the same side margin
    const [lo, hi] = inkCols(cv);
    ok('box code: the content is centred left-right (equal blank space on both sides)', Math.abs((lo) - (cv.width - 1 - hi)) <= 2 && lo >= 30 - 1, lo + ' / ' + (cv.width - 1 - hi));
    // 3. the two codes sit in two equal slots, each block centred in its slot
    const rowInk = inkRows(cv); const inkY = rowInk.map((n, y) => n > 0 ? y : -1).filter(y => y >= 0);
    const gapMid = (() => { let best = [0, 0], cur = null; rowInk.forEach((n, y) => { if (n === 0) { if (!cur) cur = [y, y]; cur[1] = y; } else if (cur) { if (cur[1] - cur[0] > best[1] - best[0]) best = cur; cur = null; } }); return best; })();
    const top = inkY[0], bottom = cv.height - 1 - inkY[inkY.length - 1];
    ok('box code: two codes: equal blank space above the first and below the second', Math.abs(top - bottom) <= 3, top + ' / ' + bottom);
    const cuts = cutLines(cv);
    ok('box code: a dotted cut line runs between the two labels, exactly in the middle', cuts.length >= 1 && Math.abs(cuts.reduce((a, b) => a + b, 0) / cuts.length - cv.height / 2) <= 2, JSON.stringify(cuts));
    ok('box code: the dotted line is really dotted (gaps in it) and nearly full width', (() => { const d = cv.getContext('2d').getImageData(0, cuts[0], cv.width, 1).data; let on = 0, runs = 0, prev = false; for (let x = 0; x < cv.width; x++) { const k = d[x * 4] < 128; if (k) on++; if (k && !prev) runs++; prev = k; } return runs > 40 && on < cv.width * 0.6 && on > cv.width * 0.2; })());
    ok('box code: no cut line on a label with one code, none after the last code', (await createBoxLabel(['A-1'], 'barcode', '', 2), cutLines(await createBoxLabel(['A-1'], 'barcode', '', 2)).length === 0));

    // 4. codes per label: 1 to 4 for barcodes, all fit on the label, equal spacing, no overlap
    for (const n of [1, 3, 4]) {
      PrintState.settings.boxPerLabel = n; PrintState.settings.boxLabelTextOn = true; PrintState.settings.boxLabelText = 'Apparel';
      const codes = Array.from({ length: n }, (_, i) => 'RTO-TR-0012365-0' + (i + 1));
      const c = await createBoxLabel(codes, 'barcode', 'Apparel', n);
      const r = inkRows(c), ys = r.map((v, y) => v > 0 ? y : -1).filter(y => y >= 0);
      const blocks = []; let start = null; r.forEach((v, y) => { if (v > 0 && start === null) start = y; if (v === 0 && start !== null) { blocks.push([start, y - 1]); start = null; } });
      ok('box code: ' + n + ' barcode(s) with text fit inside the 4x6 canvas with margins', ys[0] >= 12 && c.height - 1 - ys[ys.length - 1] >= 12, ys[0] + ' / ' + (c.height - 1 - ys[ys.length - 1]));
      const tops = []; { let prevEnd = -999; r.forEach((v, y) => { if (v > 0 && y - prevEnd > 30) tops.push(y); if (v > 0) prevEnd = y; }); }
      const slotH = 1218 / n;
      const cl = cutLines(c); const groups = []; cl.forEach(y => { if (!groups.length || y - groups[groups.length - 1][1] > 3) groups.push([y, y]); else groups[groups.length - 1][1] = y; });
      ok('box code: ' + n + ' barcode(s): the cut lines sit exactly between the slots', groups.length === n - 1 && groups.every((g, i) => Math.abs((g[0] + g[1]) / 2 - slotH * (i + 1)) <= 2), JSON.stringify(groups));
      ok('box code: ' + n + ' barcode(s): one block per slot, same distance between blocks, ' + (n - 1) + ' cut line(s)', tops.length === n && tops.every((t, i) => i === 0 || Math.abs((t - tops[i - 1]) - slotH) <= 3), JSON.stringify(tops));
    }
    // 5. the setting and the limit for QR
    PrintState.settings.boxLabelTextOn = false; PrintState.settings.boxLabelText = '';
    PrintState.settings.boxOutputFormat = 'qrcode'; PrintState.settings.boxPerLabel = 4;
    ok('box code: QR codes are limited to 3 per label even if 4 was chosen', boxPerLabel() === 3);
    PrintState.settings.boxOutputFormat = 'barcode'; PrintState.settings.boxPerLabel = 9;
    ok('box code: barcodes are limited to 4 per label', boxPerLabel() === 4);
    PrintState.settings.boxPerLabel = 3; updateBoxDisplaySettings();
    ok('box code: the page tells how many codes go on a label and how many labels a quantity needs', document.getElementById('boxDisplayPerLabel').textContent === '3' && /3 sequential codes/.test(document.getElementById('boxLabelNote').textContent) && /Qty 10 = 4 physical labels/.test(document.getElementById('boxLabelNote').textContent), document.getElementById('boxLabelNote').textContent);
    // settings window
    openBoxSettings();
    ok('box code: Settings has the "per label" choice, with the saved value', document.getElementById('settingBoxPerLabel').value === '3');
    document.getElementById('settingBoxOutputFormat').value = 'qrcode'; document.getElementById('settingBoxOutputFormat').dispatchEvent(new Event('change'));
    document.getElementById('settingBoxPerLabel').value = '3';
    ok('box code: choosing QR disables "4 per label" in Settings', document.getElementById('settingBoxPerLabel').options[3].disabled && /1 to 3/.test(document.getElementById('boxPerLabelHint').textContent));
    document.getElementById('settingBoxOutputFormat').value = 'barcode'; document.getElementById('settingBoxOutputFormat').dispatchEvent(new Event('change'));
    document.getElementById('settingBoxPerLabel').value = '4'; saveBoxSettings();
    ok('box code: the choice is saved on this device', JSON.parse(localStorage.getItem('aku_print_settings')).boxPerLabel === 4 && boxPerLabel() === 4);
    prints = 0; document.getElementById('boxQtyInput').value = '9'; document.getElementById('trnInput').value = 'TR-1'; await printBoxLabels(); await sleep(900);
    ok('box code: 9 codes at 4 per label make 3 labels', prints === 1 && boxLabels().length === 3, boxLabels().length);

    // 6. Add text
    PrintState.settings.boxPerLabel = 2; PrintState.settings.boxOutputFormat = 'barcode';
    document.getElementById('trnInput').value = 'TR-1'; document.getElementById('boxQtyInput').value = '4';
    bt.checked = true; bt.dispatchEvent(new Event('change'));
    ok('box code: switching on shows the text box', getComputedStyle(bbox).display !== 'none' && PrintState.settings.boxLabelTextOn === true);
    prints = 0; await printBoxLabels(); await sleep(300);
    ok('box code: Add text on with no text stops with a clear message, nothing printed', prints === 0 && /Enter the text for the label/.test(document.getElementById('boxStatusText').textContent), document.getElementById('boxStatusText').textContent);
    bbox.value = 'Apparel'; bbox.dispatchEvent(new Event('input'));
    ok('box code: choice and text are remembered on this device', JSON.parse(localStorage.getItem('aku_print_settings')).boxLabelTextOn === true && JSON.parse(localStorage.getItem('aku_print_settings')).boxLabelText === 'Apparel');
    await sleep(700);
    const pv = document.getElementById('boxPreviewCanvas');
    const same = await createBoxLabel(['RTO-TR-1-01', 'RTO-TR-1-02'].map(c => c.replace('TR-1-', 'TR-1-')), 'barcode', 'Apparel', 2);
    ok('box code: the preview is the real first label (a 4x6 canvas, with the text) - what you see is what prints', !!pv && pv.width === 812 && pv.height === 1218 && pv.toDataURL() === same.toDataURL());
    prints = 0; await printBoxLabels(); await sleep(900);
    cv = document.querySelector('#printContainer canvas');
    const segs = (c) => { const r = inkRows(c); let n = 0, on = false; r.forEach(v => { if (v > 0 && !on) n++; on = v > 0; }); return n; };
    ok('box code: 4 codes with text print on 2 labels; each code has the black text bar, the bars and its own text (3 parts x 2)', prints === 1 && boxLabels().length === 2 && segs(cv) === 6, prints + ' / ' + boxLabels().length + ' / ' + segs(cv));
    const plain2 = await createBoxLabel(['A-1', 'A-2'], 'barcode', '', 2);
    ok('box code: without text each code has 2 parts (bars, own text) and no rule line under the bars', segs(plain2) === 4, segs(plain2));
    // the text is white on black: the bar is solid black with white letters inside
    const tagCv = await createBoxLabel(['RTO-TR-0012365-01'], 'barcode', 'Apparel', 1); const tagRows = inkRows(tagCv); const tagTop = tagRows.findIndex(v => v > 0);
    const tagPx = (x, y) => tagCv.getContext('2d').getImageData(x, y, 1, 1).data[0];
    ok('box code: the text sits on a solid black bar with white letters', tagPx(tagCv.width / 2 - 200, tagTop + 3) < 30 && (() => { const d = tagCv.getContext('2d').getImageData(0, tagTop + 14, tagCv.width, 40).data; let white = 0, black = 0; for (let x = 0; x < tagCv.width; x++) for (let y = 0; y < 40; y++) { const v = d[(y * tagCv.width + x) * 4]; if (v > 200) white++; } return white > 150; })());
    ok('box code: the bar is as wide as the barcode below it', (() => { const d = tagCv.getContext('2d').getImageData(0, tagTop + 2, tagCv.width, 1).data; let lo = -1, hi = -1; for (let x = 0; x < tagCv.width; x++) if (d[x * 4] < 60) { if (lo < 0) lo = x; hi = x; } const [bl, bh] = inkCols(tagCv); return lo >= bl - 1 && hi <= bh + 1 && hi - lo > 300; })());
        PrintState.settings.boxOutputFormat = 'qrcode'; document.getElementById('trnInput').value = 'TR-1'; document.getElementById('boxQtyInput').value = '3'; PrintState.settings.boxPerLabel = 3;
    prints = 0; await printBoxLabels(); await sleep(900);
    cv = document.querySelector('#printContainer canvas');
    ok('box code: QR labels (3 per label, with text) are 4x6 too and the content stays inside the label', prints === 1 && boxLabels().length === 1 && cv.width === 812 && cv.height === 1218 && inkCols(cv)[0] >= 29 && inkCols(cv)[1] <= 782);
    document.getElementById('trnInput').value = 'TR-1'; document.getElementById('boxQtyInput').value = '1';
    bbox.value = 'A very long line of text that has to shrink to fit the label width'; bbox.dispatchEvent(new Event('input'));
    PrintState.settings.boxOutputFormat = 'barcode';
    prints = 0; await printBoxLabels(); await sleep(900);
    cv = document.querySelector('#printContainer canvas');
    ok('box code: long text shrinks to the label width (stays inside the side margins)', prints === 1 && inkCols(cv)[0] >= 29 && inkCols(cv)[1] <= 782, JSON.stringify(inkCols(cv)));
    bt.checked = false; bt.dispatchEvent(new Event('change'));
    document.getElementById('trnInput').value = 'TR-1'; document.getElementById('boxQtyInput').value = '2'; PrintState.settings.boxPerLabel = 2;
    prints = 0; await printBoxLabels(); await sleep(700);
    ok('box code: switching Add text off goes back to plain labels (still 4x6)', prints === 1 && boxLabels().length === 1 && document.querySelector('#printContainer canvas').height === 1218);
    PrintState.settings.boxOutputFormat = 'barcode'; PrintState.settings.boxPerLabel = 2;
    return log;
  });
  const failures = report(log, errors.filter(e => !/Failed to load resource/.test(e)));
  await stop(ctx);
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('TEST CRASH', e); process.exit(1); });
