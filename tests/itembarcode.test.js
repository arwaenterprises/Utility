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
    ok('toggle off: label height is the old one minus the 10px shorter bars', parseFloat(old.getAttribute('height')) - parseFloat(off.getAttribute('height')) === 10, parseFloat(old.getAttribute('height')) + ' vs ' + parseFloat(off.getAttribute('height')));

    // ---------- toggle on: text above the bars ----------
    const on = draw('on', 'Apparel');
    const t = on.querySelector('.item-label-text');
    ok('toggle on: the text is drawn above the barcode, bold, left-aligned with the bars', !!t && t.textContent === 'Apparel' && t.getAttribute('font-weight') === '700' && Number(t.getAttribute('x')) === 5, t && t.outerHTML);
    ok('toggle on: the number is still printed under the bars', /300100010265/.test(on.textContent));
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
    // CSV upload path
    toggle.checked = true; toggle.dispatchEvent(new Event('change')); box.value = 'Footwear'; box.dispatchEvent(new Event('input'));
    PrintState.csvData = [{ barcode: '111', qty: 2 }, { barcode: '222', qty: 1 }]; prints = 0;
    await printFromCSV(); await sleep(500);
    const csvLabels = [...document.querySelectorAll('#printContainer .print-label')];
    ok('CSV print: every label carries the same text', prints === 1 && csvLabels.length === 3 && csvLabels.every(l => l.querySelector('.item-label-text')?.textContent === 'Footwear'), csvLabels.length + ' labels');
    // QR labels get the text as a header above the code
    PrintState.settings.outputFormat = 'qr';
    window.createQRWithText = async () => { const c = document.createElement('canvas'); c.width = 10; c.height = 10; return c; };
    document.getElementById('itemBarcodeInput').value = '999'; prints = 0; await printItemLabel(); await sleep(400);
    const qrLabel = document.querySelector('#printContainer .print-label');
    ok('QR label: the text is a header above the code', !!qrLabel && qrLabel.firstElementChild.classList.contains('item-label-text') && qrLabel.firstElementChild.textContent === 'Footwear' && qrLabel.lastElementChild.tagName === 'CANVAS');
    PrintState.settings.outputFormat = 'barcode';
    return log;
  });
  const failures = report(log, errors.filter(e => !/Failed to load resource/.test(e)));
  await stop(ctx);
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('TEST CRASH', e); process.exit(1); });
