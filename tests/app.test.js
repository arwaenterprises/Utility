// App behaviour tests: list uploads / templates / sync, Box Segregate (normal + Pallet mode),
// Price Check, Year/Season Sort, Team console, and the Content-Security-Policy (enforced).
const { start, openApp, report, stop } = require('./helpers/harness');

(async () => {
  const ctx = await start();
  const { page, errors } = await openApp(ctx);
  const log = await page.evaluate(async () => {
    const log = []; const ok = (name, cond, extra) => log.push({ pass: !!cond, name, extra: extra === undefined ? '' : String(extra) });
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    window.alert = m => (window.__alerts = window.__alerts || []).push(String(m)); window.confirm = () => true;
    const written = []; const realWrite = XLSX.writeFile; XLSX.writeFile = (wb, name) => written.push({ name, sheets: wb.SheetNames.slice(), rows: XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]), second: wb.SheetNames[1] ? XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[1]]) : null });
    AppState.user = { id: 'u1', email: 'a@b.c' }; AppState.profile = { display_name: 'Ann', enterprise_id: null, tier: 'individual' }; AppState.isOnline = true;
    const mkFile = (text, name) => new File([text], name || 'x.csv');

    // ---------- file parsing ----------
    let p = await refParseFile(mkFile('Box Number,TRN,Increff_OrderID,Store Name,Region,Store Code,Brand,Extra\n007,T1,O1,Riyadh Park,West,S1,Nike,zz\n008,T2,O2,Jeddah,West,S2,Adidas,zz\n,T3,,,,,,\n'), 'box_list');
    ok('parse keeps leading zeros + loose headers', p.rows.length === 2 && p.rows[0].box_number === '007' && p.rows[0].increff_order_id === 'O1', JSON.stringify(p.rows[0]));
    ok('parse skips rows missing required', p.skipped === 1);
    p = await refParseFile(mkFile('Foo,Bar\n1,2\n'), 'box_list');
    ok('parse rejects missing required column', /Missing required/.test(p.error), p.error.split('\n')[0]);
    // Excel file
    const wbx = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wbx, XLSX.utils.aoa_to_sheet([['Barcode','Current Price','Original Price','Style','Color','Size','Year','Season'],['0012345',99,120,'S','Red','M',2025,'SS']]), 'S');
    const xbuf = XLSX.write(wbx, { type: 'array', bookType: 'xlsx' });
    p = await refParseFile(new File([xbuf], 'p.xlsx'), 'price_list');
    ok('parse xlsx price list', p.rows.length === 1 && p.rows[0].current_price === '99' && p.rows[0].barcode === '0012345', JSON.stringify(p.rows[0]));

    // ---------- Box Segregate normal mode ----------
    await refOpenDB();
    const progress = []; 
    const parsed = await refParseFile(mkFile('Box Number,TRN,Store Name\nB1,T1,Riyadh Park\nB2,T2,Jeddah\n'), 'box_list');
    const total = await refUploadList('box_list', parsed.rows, p => progress.push(Math.round(p)));
    ok('upload returns total + reports progress up to 100', total === 2 && progress[progress.length - 1] === 100, progress.join(','));
    await initBoxSegregate();
    ok('auto sync on first open (never downloaded)', bsMap.size === 2);
    document.getElementById('bsBarcodeInput').value = 'b1'; lookupSegregateBox();
    ok('normal lookup shows store', /Riyadh Park/.test(document.getElementById('bsResultCard').textContent));
    document.getElementById('bsBarcodeInput').value = 'NOPE'; bsIsLooking = false; lookupSegregateBox();
    ok('normal lookup not found', document.getElementById('bsNotFound').style.display === 'block');
    // replace list
    await refUploadList('box_list', [{ box_number: 'ONLY' }]);
    await bsSyncList('box_list', false);
    ok('replace removes old boxes', bsMap.size === 1 && bsMap.has('only') && !bsMap.has('b1'));
    ok('server holds only the new list', __db.reference_chunks.filter(c => c.list_type === 'box_list').reduce((n, c) => n + c.row_count, 0) === 1);
    // unchanged -> up to date, no re-download
    const r2 = await refSync('box_list', {}); ok('second sync is up-to-date', r2 === 'uptodate');
    // large list: progress % and chunking
    const big = Array.from({ length: 5200 }, (_, i) => ({ box_number: 'X' + i, store_name: 'S' }));
    const c0 = window.__compactCalls || 0;
    const up = []; await refUploadList('box_list', big, p => up.push(Math.round(p)));
    ok('large upload chunked (3 chunks of 2000) w/ progress', __db.reference_chunks.filter(c => c.list_type === 'box_list').length === 3 && up.length >= 4 && up[up.length-1] === 100, up.join(','));
    const down = []; await refSync('box_list', { onProgress: p => down.push(Math.round(p)) });
    ok('large download w/ progress', down[down.length - 1] === 100 && down.some(x => x > 0 && x < 100), down.join(',') + ' / rows=' + (await refCacheGet('box_list')).length);
    const got = await refCacheGet('box_list');
    ok('uploaded in the smaller format, parallel chunks arrive complete and in order', window.__compactCalls - c0 === 3 && got.length === 5200 && got.every((r, k) => r.box_number === big[k].box_number && r.store_name === 'S'), 'compact calls=' + window.__compactCalls + ' rows=' + got.length);
    // database not updated with the newer function yet -> falls back to the older format, same result
    window.__noCompact = true;
    await refUploadList('box_list', big);
    await refSync('box_list', {});
    const got2 = await refCacheGet('box_list');
    ok('falls back to the older upload format when the database has no compact function', got2.length === 5200 && got2.every((r, k) => r.box_number === big[k].box_number), 'rows=' + got2.length);
    window.__noCompact = false;
    // a failing chunk stops the whole upload and the old list stays active
    const activeBefore = __db.reference_chunks.filter(c => c.list_type === 'box_list' && c.is_active).reduce((n, c) => n + c.row_count, 0);
    window.__failSeq = 1;
    let failed = false;
    try { await refUploadList('box_list', Array.from({ length: 4500 }, (_, i) => ({ box_number: 'F' + i }))); } catch (e) { failed = true; }
    window.__failSeq = null;
    ok('a failing chunk fails the upload and keeps the old list', failed && __db.reference_chunks.filter(c => c.list_type === 'box_list' && c.is_active).reduce((n, c) => n + c.row_count, 0) === activeBefore);

    // ---------- Pallet mode ----------
    const docs = await refParseFile(mkFile('Document Number,Box Number,Store Name\nD1,P1,Riyadh Park\nD1,P2,Riyadh Park\nD2,P3,Jeddah Mall of Arabia\n'), 'doc_boxes');
    await refUploadList('doc_boxes', docs.rows);
    bsSetPalletMode(true); await bsSyncList('doc_boxes', false);
    ok('pallet doc list loaded', bsDocMap.size === 3);
    const scan = (v) => { document.getElementById('bsBarcodeInput').value = v; bsIsLooking = false; lookupSegregateBox(); };
    scan('p1');
    let card = document.getElementById('bsDocResult');
    ok('pallet scan shows store/doc + progress', /Riyadh Park/.test(card.textContent) && /D1/.test(card.textContent) && /1 of 2/.test(card.textContent) && /PUT ON PALLET/.test(card.textContent), card.textContent.replace(/\s+/g,' '));
    scan('P1'); ok('duplicate blocked, not counted twice', /ALREADY SCANNED/.test(card.textContent) && bsDocScans.length === 1);
    scan('p3'); scan('ZZ'); ok('unknown box flagged', document.getElementById('bsNotFound').style.display === 'block' && bsDocScans.length === 2);
    ok('doc scans persisted per user', Storage.getJSON('bs_doc_scans_u1').length === 2);
    downloadPalletExcel(); const dl = written.pop();
    ok('AWB download grouped by doc/store', dl.rows.length === 2 && dl.rows[0]['TRN#'] === 'D1' && dl.rows[0]['Store Name'] === 'Riyadh Park' && dl.rows[1]['TRN#'] === 'D2' && Object.keys(dl.rows[0]).join() === 'TRN#,Store Name,Box Number,Scanned At', JSON.stringify(dl.rows));
    ok('Pallet download: second sheet "Not scanned" lists the boxes never scanned', dl.sheets.join() === 'Segregation,Not scanned' && dl.second.length === 1 && dl.second[0]['TRN#'] === 'D1' && dl.second[0]['Store Name'] === 'Riyadh Park' && dl.second[0]['Box Number'] === 'P2', JSON.stringify(dl.sheets) + JSON.stringify(dl.second));
    ok('Pallet download: the first sheet (for AWBs) is unchanged and has no unscanned boxes', dl.rows.length === 2 && !dl.rows.some(r => r['Box Number'] === 'P2'));
    resetPalletScans(); ok('pallet reset downloads then clears', written.length === 1 && bsDocScans.length === 0);
    { // nothing scanned: Reset neither asks nor downloads
      let asked2 = 0, alerted = 0; const oc = window.confirm, oa = window.alert, w0 = written.length;
      window.confirm = () => { asked2++; return true; }; window.alert = () => { alerted++; };
      bsDocScans = []; resetPalletScans();
      ok('pallet with zero scans: Reset asks nothing, shows no message, downloads nothing', asked2 === 0 && alerted === 0 && written.length === w0);
      window.confirm = oc; window.alert = oa;
    }
    bsDocScans = []; for (const v of ['p1', 'p2', 'p3']) { document.getElementById('bsBarcodeInput').value = v; bsIsLooking = false; lookupSegregateBox(); }
    downloadPalletExcel(); const full = written.pop();
    ok('Pallet download when everything was scanned: "Not scanned" sheet is present but empty', full.sheets.join() === 'Segregation,Not scanned' && full.second.length === 0 && full.rows.length === 3, JSON.stringify(full.second));
    bsDocScans = []; Storage.setJSON('bs_doc_scans_u1', []);
    bsSetPalletMode(false); ok('toggle back to normal hides pallet panel', document.getElementById('bsPalletWrap').style.display === 'none');

    // ---------- templates ----------
    const tplHeaders = (lt) => { const n = written.length; refDownloadTemplate(lt); const w = written[written.length - 1]; return w; };
    const grab = (lt) => { let cap; const old = XLSX.writeFile; XLSX.writeFile = (wb, name) => { cap = { name, headers: XLSX.utils.sheet_to_json(wb.Sheets['Data'], { header: 1 })[0], sheets: wb.SheetNames }; }; refDownloadTemplate(lt); XLSX.writeFile = old; return cap; };
    let t = grab('box_list'); ok('box list template headers', t.headers.join() === 'Box Number,TRN,Increff Order ID,Store Name,Region,Store Code,Brand' && t.sheets.join() === 'Data,Instructions', t.headers.join());
    t = grab('doc_boxes'); ok('doc template headers', t.headers.join() === 'TRN#,Box Number,Store Name', t.name);
    t = grab('ys_ptl_config'); ok('ptl template headers', t.headers.join() === 'PTL Number,Season,Year,Year Logic');
    t = grab('price_list'); ok('price template headers', t.headers.join() === 'Barcode,Current Price,Original Price,Style,Color,Size,Year,Season');
    t = grab('ys_item_master'); ok('item master template headers', t.headers.join() === 'Barcode,Year,Season,Brand');
    // a template filled in by the user round-trips through the parser
    const filled = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(filled, XLSX.utils.aoa_to_sheet([['TRN#','Box Number','Store Name'],['D9','Z1','Mall']]), 'Data');
    const fp = await refParseFile(new File([XLSX.write(filled, { type: 'array', bookType: 'xlsx' })], 't.xlsx'), 'doc_boxes'); ok('filled template parses', fp.rows.length === 1 && fp.rows[0].document_number === 'D9');
    ok('template buttons exist', ['bsTemplateBtn','pcTemplateBtn'].every(id => document.getElementById(id)));
    ok('no ad placeholder left in the app (ads are for the main domain only)', !document.getElementById('adSlotBottom') && ![...document.styleSheets].some(ss => [...ss.cssRules].some(r => /ad-slot/.test(r.cssText))));


    // ---------- Pallet list: hidden until expanded ----------
    bsSetPalletMode(true); await bsSyncList('doc_boxes', true);
    // (the pallet scans above were reset, so start from a known state)
    bsDocScans = []; Storage.setJSON('bs_doc_scans_u1', []); bsSummaryOpen = false; bsOpenGroups.clear(); bsRenderDocSummary();
    const sum = document.getElementById('bsDocSummary');
    ok('box list is hidden by default (only the total shows)', !sum.querySelector('table') && /0 of 3 boxes scanned/.test(sum.textContent), sum.textContent.trim());
    sum.querySelector('[data-bs-toggle-summary]').click();
    ok('tapping the total expands the list with TRN# / Store Name / Boxes', !!sum.querySelector('table') && [...sum.querySelectorAll('th')].map(t => t.textContent).join() === 'TRN#,Store Name,Boxes', [...sum.querySelectorAll('th')].map(t => t.textContent).join());
    scan('p1');
    sum.querySelector('[data-bs-group]').click();
    ok('tapping a TRN# row shows its box numbers, scanned ones ticked', /P1 ✓/.test(sum.textContent) && /P2/.test(sum.textContent) && !/P2 ✓/.test(sum.textContent), sum.textContent.replace(/\s+/g, ' '));
    sum.querySelector('[data-bs-toggle-summary]').click();
    ok('tapping the total again hides the list', !sum.querySelector('table'));
    scan('NOPE-32'); ok('box not found message sits right under the scan field', document.getElementById('bsNotFound').style.display === 'block' && document.getElementById('bsNotFound').previousElementSibling.id === 'bsCamOverlay');
    bsSetPalletMode(false);

    // ---------- upload checks: duplicates, mandatory fields, header aliases ----------
    let d = await refParseFile(mkFile('TRN#,Box Number,Store Name\nT1,B1,Riyadh\nT2,b1,Jeddah\nT3,B2,Dammam\nT4,B2,Dammam\n'), 'doc_boxes');
    ok('duplicate box numbers are detected (case-insensitive) with their row numbers', d.duplicates.length === 2 && d.duplicates[0].rows.join() === '2,3' && d.duplicates[1].rows.join() === '4,5', JSON.stringify(d.duplicates));
    d = await refParseFile(mkFile('TRN#,Box Number,Store Name\nT1,B1,Riyadh\nT2,B2,\n,B3,Jeddah\n'), 'doc_boxes');
    ok('pallet list: all 3 fields mandatory - incomplete rows stop the upload', /Upload stopped/.test(d.error) && /row 3 \(missing Store Name\)/.test(d.error) && /row 4 \(missing TRN#\)/.test(d.error), d.error);
    d = await refParseFile(mkFile('trn,box code,Store Name\nT1,B1,Riyadh\n'), 'doc_boxes');
    ok('headers: "TRN" and "Box Code" are accepted', d.rows.length === 1 && d.rows[0].document_number === 'T1' && d.rows[0].box_number === 'B1', JSON.stringify(d.rows));
    d = await refParseFile(mkFile('Document Number,Box Number,Store Name\nT1,B1,Riyadh\n'), 'doc_boxes');
    ok('headers: old name "Document Number" still accepted', d.rows.length === 1);
    d = await refParseFile(mkFile('Box Code\nB1\nB2\nB2\n'), 'box_list');
    ok('box list: only Box Code is needed (everything else optional) and duplicates are flagged', d.rows.length === 3 && d.duplicates.length === 1 && d.duplicates[0].value === 'B2', JSON.stringify(d.duplicates));
    d = await refParseFile(mkFile('Box Number,TRN\nB1,\nB2,T9\n'), 'box_list');
    ok('box list: empty optional cells are fine', d.rows.length === 2 && !d.error && !d.skipped);
    // the upload flow refuses a file with duplicates and changes nothing
    const before = JSON.stringify(__db.reference_chunks.filter(c => c.list_type === 'doc_boxes').map(c => c.rows));
    __alerts.length = 0;
    refStartUpload('doc_boxes', document.getElementById('bsUploadBtn'), null);   // creates the hidden file input and opens the chooser
    const input = document.getElementById('refFileInput');
    const dt = new DataTransfer(); dt.items.add(mkFile('TRN#,Box Number,Store Name\nT1,B1,X\nT2,B1,Y\n', 'dup.csv')); input.files = dt.files;
    await input.onchange();
    await sleep(50);
    ok('upload with duplicate box numbers is refused with an explanation, nothing changed', __alerts.some(a => /Upload stopped: 1 Box Number\(s\) appear more than once/.test(a) && /B1 \(rows 2, 3\)/.test(a)) && JSON.stringify(__db.reference_chunks.filter(c => c.list_type === 'doc_boxes').map(c => c.rows)) === before, __alerts.slice(-1).join());

    // ---------- member cannot upload ----------
    AppState.profile = { display_name: 'M', enterprise_id: 'E1', tier: 'enterprise_member' }; __me.id = 'u1'; __me.enterprise_id = 'E1';
    ok('member cannot upload', !refCanUpload());
    document.getElementById('bsUploadBtn').style.display = refCanUpload() ? '' : 'none';
    ok('upload button hidden for members', document.getElementById('bsUploadBtn').style.display === 'none');
    AppState.profile.tier = 'enterprise_admin'; ok('admin can upload', refCanUpload());
    AppState.profile = { display_name: 'Ann', enterprise_id: null, tier: 'individual' }; __me.enterprise_id = null;

    // ---------- Price Check ----------
    const prices = Array.from({ length: 6000 }, (_, i) => ({ barcode: 'PB' + i, current_price: String(i), original_price: '1', style: 'S', color: 'C', size: 'M', year: '2025', season: 'SS' }));
    await refUploadList('price_list', prices);
    await initPriceCheck(); for (let i = 0; i < 40 && !(await refMetaGet('price_list')); i++) await sleep(100); await sleep(100);
    const row = await pcDbGet('PB5999');
    ok('price check synced 6000 rows into lookup table', row && row.Current_Price === '5999', JSON.stringify(row));
    document.getElementById('pcBarcodeInput').value = 'PB42'; await lookupPriceCheck();
    ok('price lookup shows price', />42</.test(document.getElementById('pcResultCard').innerHTML), '');
    ok('price timestamp shows count', /6000 items/.test(document.getElementById('pcTimestamp').innerHTML));

    // ---------- Year/Season ----------
    await refUploadList('ys_item_master', [{ barcode: 'I1', year: '2024', season: 'SS', brand: 'Nike' }, { barcode: 'I2', year: '2025', season: 'FW', brand: 'Adidas' }]);
    await refUploadList('ys_ptl_config', [{ ptl_number: '1', season: 'SS', year: '2024', year_logic: 'lte' }, { ptl_number: '2', season: 'FW', year: '2025', year_logic: 'eq' }]);
    await initYearSegregate();
    ok('YS: opening the tool loads the item master + PTL config by itself (no Start Session)', YSState.huConfig.length === 2 && (await ysDbCount(YS_ITEMS_STORE)) === 2 && YSState.huStates.length === 2 && !document.getElementById('ysStartSessionBtn') && !document.getElementById('ysSessionScreen'), 'ptls=' + YSState.huConfig.length);
    ok('YS: it opens on the scan screen with an empty, editable Remark and no "Your name" box', document.getElementById('ysScanScreen').classList.contains('active') && document.getElementById('ysRemarkInput').value === '' && !document.getElementById('ysRemarkInput').readOnly && !document.getElementById('ysStaffInput'));
    ok('YS: the upload buttons sit on the scan screen', !!document.querySelector('#ysScanScreen #ysUploadItemsBtn') && !!document.querySelector('#ysScanScreen #ysUploadPtlBtn'));
    { // scanning without a Remark is refused
      let alerts2 = []; const oa = window.alert; window.alert = m => alerts2.push(String(m));
      document.getElementById('ysBarcodeInput').value = 'I1'; await handleYsScan({ key: 'Enter' });
      ok('YS: a scan without a Remark is refused and asks for it', alerts2.length === 1 && !YSState.staffName && !AppState.hasActiveSession, alerts2.join());
      document.getElementById('ysRemarkInput').value = '  '; document.getElementById('ysBarcodeInput').value = 'I1'; await handleYsScan({ key: 'Enter' });
      ok('YS: a Remark of only spaces does not count', alerts2.length === 2 && !YSState.staffName);
      window.alert = oa;
    }
    ok('YS: the scan field is switched off until a Remark is typed', document.getElementById('ysBarcodeInput').disabled && document.getElementById('ysKbdBtn').disabled);
    document.getElementById('ysRemarkInput').value = 'R'; document.getElementById('ysRemarkInput').dispatchEvent(new Event('input'));
    ok('YS: typing a Remark switches it on', !document.getElementById('ysBarcodeInput').disabled && !document.getElementById('ysKbdBtn').disabled);
    ok('YS: the Remark box is still visible before the first scan', document.getElementById('ysRemarkCard').style.display === '');
    document.getElementById('ysRemarkInput').value = 'R';
    document.getElementById('ysBarcodeInput').value = 'I1'; await handleYsScan({ key: 'Enter' });
    ok('YS: with a Remark the first scan begins the session (operator = the signed-in account) and locks the Remark', YSState.staffName === 'Ann' && YSState.remark === 'R' && AppState.hasActiveSession === true && document.getElementById('ysRemarkInput').readOnly, YSState.staffName);
    ok('YS: once the job started the Remark box is gone from the screen', document.getElementById('ysRemarkCard').style.display === 'none');
    YSState.scanStep = 'item'; YSState.pendingItem = null; YSState.pendingHuIdx = null;
    ok('YS storeId from google account', AppState.storeId === 'a@b.c');
    // scans
    const mk = (uid, st) => ({ scanUid: uid, scanIso: new Date().toISOString(), storeId: 'a@b.c', storeName: 'Ann', staffName: 'Sam', remark: 'R', ptlNumber: '01', season: 'SS', year: 2024, brand: 'Nike', barcode: 'I1', qty: 1, boxBarcode: 'BX1', boxStatus: st, scanTimestamp: ysNow(), synced: false });
    await ysDbAdd(YS_SCANS_STORE, mk(crypto.randomUUID(), 'Closed')); await ysDbAdd(YS_SCANS_STORE, mk(crypto.randomUUID(), 'Closed')); await ysDbAdd(YS_SCANS_STORE, mk(crypto.randomUUID(), 'Open'));
    await ysAutoSync();
    ok('YS closed scans synced to server, open stays local', __db.ys_scans.length === 2 && __db.ys_scans[0].ptl_number === '01' && __db.ys_scans[0].user_id === 'u1');
    await ysAutoSync(); ok('YS resync does not duplicate', __db.ys_scans.length === 2);
    // status line (Year/Season): offline -> stuck -> tap to retry
    const ysLine = () => document.getElementById('ysSyncStatusLine');
    await ysDbAdd(YS_SCANS_STORE, { ...mk(crypto.randomUUID(), 'Closed'), pendingSince: Date.now() - 11 * 60000 });
    AppState.isOnline = false; ysUpdateSyncBadge(); await sleep(100);
    ok('Year/Season status line offline', /Offline - 1 items waiting/.test(ysLine().textContent), ysLine().textContent);
    AppState.isOnline = true; window.__fail = true; await ysAutoSync(); await sleep(100);
    ok('Year/Season status line stuck: duration + reason + retry', /not uploaded for 11 min/.test(ysLine().textContent) && /network down/.test(ysLine().textContent) && /Tap to retry/.test(ysLine().textContent), ysLine().textContent);
    window.__fail = false; ysLine().click(); await sleep(200);
    ok('Year/Season: tapping the line retries and it turns green', /^✓ All uploaded/.test(ysLine().textContent) && __db.ys_scans.length === 3, ysLine().textContent + ' / ' + __db.ys_scans.length);
    // legacy scan without uid gets one
    await ysDbAdd(YS_SCANS_STORE, { ...mk(undefined, 'Closed'), scanUid: undefined }); await ysBackfillScanUids();
    ok('YS legacy scans get scan uid', (await ysDbGetAll(YS_SCANS_STORE)).every(s => s.scanUid));
    // individual reset
    YSState.huStates.forEach(h => h.status = 'Closed'); await ysAutoSync();
    await ysExecuteReset();
    ok('YS individual reset: downloaded, device + server cleared', written.length === 2 && (await ysDbGetAll(YS_SCANS_STORE)).length === 0 && __db.ys_scans.length === 0, 'rows exported=' + written[1]?.rows.length);
    { // Year/Season: a session with zero scans closes at once
      const w0 = written.length; YSState.huStates.forEach(h => h.status = 'Closed');
      await ysShowResetModal();
      await sleep(150);
      ok('YS zero scans: no "Are you sure?" pop-up, no download, session closed with the Remark free again', !document.getElementById('ysResetModal').classList.contains('active') && written.length === w0 && document.getElementById('ysScanScreen').classList.contains('active') && !YSState.staffName && !document.getElementById('ysRemarkInput').readOnly && document.getElementById('ysRemarkInput').value === '');
    }
    // team membership changed while the phone was open: the old profile is refused once, then refreshed
    window.__enforceTeamRule = true; window.__rlsRejects = 0;
    AppState.profile = { display_name: 'M', enterprise_id: 'E1', tier: 'enterprise_member' };   // stale on the phone
    window.__me = { id: 'u1', enterprise_id: null, tier: 'individual', email: 'a@b.c' };          // the server already knows the person left
    await ysDbAdd(YS_SCANS_STORE, mk(crypto.randomUUID(), 'Closed'));
    await ysAutoSync(); await sleep(100);
    ok('Year/Season: stale team is refused once, profile refreshed, box uploaded', window.__rlsRejects === 1 && __db.ys_scans.length === 1 && __db.ys_scans[0].enterprise_id == null && AppState.profile.enterprise_id == null, 'rejects=' + window.__rlsRejects + ' rows=' + __db.ys_scans.length);
    window.__enforceTeamRule = false; await ysDbClearStore(YS_SCANS_STORE); __db.ys_scans = [];
    // enterprise member reset blocked while pending, then allowed
    AppState.profile = { display_name: 'M', enterprise_id: 'E1', tier: 'enterprise_member' }; __me.enterprise_id = 'E1';
    await ysDbAdd(YS_SCANS_STORE, mk(crypto.randomUUID(), 'Closed')); AppState.isOnline = false;
    await ysExecuteReset(); ok('YS member reset blocked with unsynced boxes', (await ysDbGetAll(YS_SCANS_STORE)).length === 1);
    AppState.isOnline = true; await ysExecuteReset();
    ok('YS member reset clears device only, server keeps data', (await ysDbGetAll(YS_SCANS_STORE)).length === 0 && __db.ys_scans.length === 1);

    // ---------- Team YS ----------
    await refreshTeamYsStats(); ok('Team YS table renders member', /Ann/.test(document.getElementById('teamYsList').textContent));
    AppState.profile.enterprise_id = 'E1'; __db.ys_scans.forEach(s => s.enterprise_id = 'E1');
    await downloadTeamYs(['u1'], 'x'); ok('Team YS download exports rows w/ member name', written[written.length-1].rows.length === 1 && written[written.length-1].rows[0]['Scanned By'] === 'Ann');
    selectedYsMemberIds.add('u1'); await resetSelectedTeamYs(); ok('Team YS reset deletes from database', __db.ys_scans.length === 0);

    // ---------- Team: rename, member count, invite expiry ----------
    AppState.profile = { display_name: 'Admin', enterprise_id: 'E1', tier: 'enterprise_admin' };
    __db.enterprise_invites.push({ id: 'old', enterprise_id: 'E1', invited_email: 'old@x.com', status: 'pending', expires_at: new Date(Date.now() - 864e5).toISOString() }, { id: 'new', enterprise_id: 'E1', invited_email: 'new@x.com', status: 'pending', expires_at: new Date(Date.now() + 864e5).toISOString() });
    await loadPendingInvitesList();
    const html = document.getElementById('pendingInvitesList').innerHTML;
    ok('expired invite shown as expired with resend', /old@x.com — expired/.test(html) && /data-resend-invite="old"/.test(html));
    ok('active invite has no resend', /new@x.com — pending/.test(html) && !/data-resend-invite="new"/.test(html));
    await resendInvite('old', 'old@x.com'); await loadPendingInvitesList();
    ok('resend replaces expired invite with a fresh pending one', __db.enterprise_invites.filter(i => i.invited_email === 'old@x.com').length === 1 && /old@x.com — pending/.test(document.getElementById('pendingInvitesList').innerHTML));
    // removing a teammate also clears their old "accepted" invite; any invite row can be cleared by hand
    __db.enterprise_invites.push({ id: 'acc1', enterprise_id: 'E1', invited_email: 'gone@x.com', status: 'accepted', expires_at: new Date(Date.now() + 864e5).toISOString() },
                                 { id: 'acc2', enterprise_id: 'E1', invited_email: 'stays@x.com', status: 'accepted', expires_at: new Date(Date.now() + 864e5).toISOString() });
    await loadPendingInvitesList();
    ok('an accepted invite can be cleared by hand (has a remove button)', /gone@x.com — accepted/.test(document.getElementById('pendingInvitesList').innerHTML) && /data-cancel-invite="acc1"/.test(document.getElementById('pendingInvitesList').innerHTML));
    teamMemberStatsCache = [{ user_id: 'u-gone', email: 'Gone@X.com', display_name: 'Gone', boxes_closed: 0, total_qty: 0 }];
    window.confirm = () => true; AppState.profile.enterprise_id = 'E1';
    await removeMember('u-gone');
    ok('removing a teammate calls the server and clears their accepted invite', window.__removedMember === 'u-gone' && !/gone@x.com/.test(document.getElementById('pendingInvitesList').innerHTML) && /stays@x.com — accepted/.test(document.getElementById('pendingInvitesList').innerHTML), document.getElementById('pendingInvitesList').textContent);
    // ---------- User management window (user icon): account, rename, invite, members ----------
    AppState.profile = { ...AppState.profile, tier: 'enterprise_admin', enterprise_id: 'E1' };
    window.__me = { ...window.__me, tier: 'enterprise_admin', enterprise_id: 'E1' };
    const vis = id => document.getElementById(id).style.display !== 'none';
    await openAccountModal();
    ok('User management shows the admin section (rename, invite, members)', vis('enterpriseAdminSection') && !vis('createEnterpriseSection'));
    ok('invite form is folded away until asked for', !vis('teamInviteSection'));
    document.getElementById('inviteToggleBtn').click();
    ok('"Invite a teammate" opens the email field', vis('teamInviteSection') && document.activeElement.id === 'inviteEmailInput');
    document.getElementById('inviteToggleBtn').click();
    ok('... and folds it again', !vis('teamInviteSection'));
    ok('User management lists the members with a remove button for others but not for yourself', document.querySelectorAll('#umMemberList [data-remove-member]').length === 1 && /Ann/.test(document.getElementById('umMemberList').textContent) && /Bob/.test(document.getElementById('umMemberList').textContent));
    ok('team title shows name + member count', document.getElementById('umEnterprise').textContent === 'Acme (2 members)', document.getElementById('umEnterprise').textContent);
    window.prompt = () => '  Acme Corp  '; await renameEnterprise();
    ok('rename updates title', document.getElementById('umEnterprise').textContent === 'Acme Corp (2 members)', document.getElementById('umEnterprise').textContent);
    ok('User management has no data tables or Reset buttons any more', !document.querySelector('#accountModal .team-tabs, #accountModal #resetTeamSelectedBtn, #accountModal #resetTeamYsBtn'));
    document.getElementById('closeAccountBtn').click();
    ok('the ✕ closes User management', !document.getElementById('accountModal').classList.contains('active'));

    // ---------- Data Management window (7th tile): two tabs, one Download/Reset pair per tab, close ✕ ----------
    document.querySelector('.app-tile[data-app-id="dataManagement"]') || renderAppGrid();
    document.querySelector('.app-tile[data-app-id="dataManagement"]').click(); await new Promise(r => setTimeout(r, 120));
    ok('the Data Management tile opens the window', document.getElementById('teamModal').classList.contains('active'));
    ok('admin title says whose data: the whole team', /Data Management — Acme Corp \(all users\)/.test(document.getElementById('teamModalTitle').textContent), document.getElementById('teamModalTitle').textContent);
    document.getElementById('helpCloseBtn').click();
    ok('Data Management has no invite or rename controls', !document.querySelector('#teamModal #inviteToggleBtn, #teamModal #renameEnterpriseBtn, #teamModal [data-remove-member]'));
    ok('opens on the Box Scanner tab', vis('teamPanelBs') && !vis('teamPanelYs'));
    ok('admin sees everybody in the Box Scanner list', /Ann/.test(document.getElementById('teamMemberList').textContent) && /Bob/.test(document.getElementById('teamMemberList').textContent));
    document.getElementById('teamTabYs').click();
    ok('Year/Season tab shows its own list and hides the Box Scanner one', !vis('teamPanelBs') && vis('teamPanelYs') && document.getElementById('teamTabYs').classList.contains('active'));
    ok('each tab has exactly one Download and one Reset button', document.querySelectorAll('#teamPanelBs .team-actions .btn').length === 2 && document.querySelectorAll('#teamPanelYs .team-actions .btn').length === 2 && document.querySelectorAll('#teamModal [id*="Reset"], #teamModal [id*="reset"]').length === 2);
    document.getElementById('teamYsSelectAll').click();
    ok('Year/Season "Select All" ticks every member', selectedYsMemberIds.size === 2 && [...document.querySelectorAll('.team-ys-checkbox')].every(c => c.checked));
    document.getElementById('teamYsSelectAll').click();
    ok('... and un-ticks them', selectedYsMemberIds.size === 0);
    let asked = 0; window.confirm = () => { asked++; return false; }; window.alert = () => {};
    document.getElementById('teamYsList').querySelector('.team-ys-checkbox').click();
    document.getElementById('resetTeamYsBtn').click(); await new Promise(r => setTimeout(r, 30));
    selectedMemberIds.add('u1'); document.getElementById('resetTeamSelectedBtn').click(); await new Promise(r => setTimeout(r, 30));
    ok('both Reset buttons ask "Are you sure?" first', asked === 2, 'asked ' + asked);
    document.getElementById('closeTeamBtn').click();
    ok('the ✕ in the corner closes the window', !document.getElementById('teamModal').classList.contains('active') && document.getElementById('closeTeamBtn').textContent.trim() === '✕');

    // individual account: same window, only their own data, can download and reset
    AppState.profile = { display_name: 'Ann', enterprise_id: null, tier: 'individual' };
    window.__me = { ...window.__me, tier: 'individual', enterprise_id: null };
    __db.scans.push({ id: 'ind1', scan_uid: 'ind1', user_id: 'u1', enterprise_id: null, remark: 'R', box_number: 'IB1', barcode: '123', qty: 2, box_status: 'Closed', scanned_at: new Date().toISOString() },
                    { id: 'oth1', scan_uid: 'oth1', user_id: 'u2', enterprise_id: null, remark: 'R', box_number: 'OB1', barcode: '999', qty: 1, box_status: 'Closed', scanned_at: new Date().toISOString() });
    await openDataManagement(); document.getElementById('helpCloseBtn').click();
    ok('individual: title says "my data"', /Data Management — my data/.test(document.getElementById('teamModalTitle').textContent), document.getElementById('teamModalTitle').textContent);
    ok('individual: sees only their own row', document.querySelectorAll('#teamMemberList .team-member-checkbox').length === 1);
    ok('individual: Reset is available', document.getElementById('resetTeamSelectedBtn').style.display !== 'none' && document.getElementById('resetTeamYsBtn').style.display !== 'none');
    selectedMemberIds.clear(); selectedMemberIds.add('u1'); written.length = 0;
    await downloadSelectedTeamData();
    ok('individual: Download exports their own rows (and nobody else\'s)', written.length === 1 && written[0].rows.length === 1 && written[0].rows[0]['Box Number'] === 'IB1', JSON.stringify(written[0] && written[0].rows));
    window.confirm = () => true; await resetSelectedTeamData();
    ok('individual: Reset removes only their own scans', !__db.scans.some(r => r.id === 'ind1') && __db.scans.some(r => r.id === 'oth1'));
    document.getElementById('closeTeamBtn').click();

    // enterprise member: same window, own data only, download only (no Reset)
    AppState.profile = { display_name: 'Mia', enterprise_id: 'E1', tier: 'enterprise_member' };
    window.__me = { ...window.__me, tier: 'enterprise_member', enterprise_id: 'E1' };
    await openDataManagement(); document.getElementById('helpCloseBtn').click();
    ok('member: sees only their own row', document.querySelectorAll('#teamMemberList .team-member-checkbox').length === 1);
    ok('member: Download only - both Reset buttons are hidden', document.getElementById('resetTeamSelectedBtn').style.display === 'none' && document.getElementById('resetTeamYsBtn').style.display === 'none');
    ok('member: Download buttons are there', document.getElementById('downloadTeamSelectedBtn').style.display !== 'none' && document.getElementById('downloadTeamYsBtn').style.display !== 'none');
    document.getElementById('closeTeamBtn').click();
    AppState.profile = { display_name: 'Admin', enterprise_id: 'E1', tier: 'enterprise_admin' };
    window.__me = { ...window.__me, tier: 'enterprise_admin', enterprise_id: 'E1' };
    await openDataManagement(); document.getElementById('helpCloseBtn').click();
    ok('admin again: Reset buttons are back', document.getElementById('resetTeamSelectedBtn').style.display !== 'none');
    document.getElementById('closeTeamBtn').click();
    ok('photo capture is gone', !document.getElementById('photoCaptureApp') && !APPS.some(a => a.id === 'photoCapture') && typeof initPhotoCapture === 'undefined');
    ok('6 tools + the Data Management tile', APPS.length === 7 && APPS.filter(a => a.modal).map(a => a.id).join() === 'dataManagement', APPS.map(a => a.id).join());
    ok('NO content-security-policy violations during the whole run', window.__csp.length === 0, JSON.stringify(window.__csp));

    // ---------- usage statistics ----------
    AppState.profile = { display_name: 'Ann', enterprise_id: null, tier: 'individual' }; __me.enterprise_id = null; __me.id = 'u1'; AppState.user = { id: 'u1', email: 'a@b.c' };
    __db.usage_daily.length = 0; Storage.setJSON('usage_pending_u1', {}); window.__fail = false; AppState.isOnline = true;
    await bsSyncList('box_list', true);
    bsSetPalletMode(false);
    for (const v of ['x1', 'x2', 'nope']) { document.getElementById('bsBarcodeInput').value = v; bsIsLooking = false; lookupSegregateBox(); }
    await initPriceCheck(); for (let i = 0; i < 40 && !(await refMetaGet('price_list')); i++) await sleep(100);
    for (const v of ['PB1', 'PB2', 'PB3', 'zzz']) { document.getElementById('pcBarcodeInput').value = v; await lookupPriceCheck(); }
    bsDocScans = []; bsSetPalletMode(true);
    for (const v of ['p2', 'P2', 'q9']) { document.getElementById('bsBarcodeInput').value = v; bsIsLooking = false; lookupSegregateBox(); }
    window.__fail = true; await Usage.flush();
    ok('usage: nothing is lost when the server is unreachable', __db.usage_daily.length === 0 && Object.keys(Storage.getJSON('usage_pending_u1')).length === 7, Object.keys(Storage.getJSON('usage_pending_u1')).join());
    window.__fail = false; await Usage.flush();
    const u = (t, a) => __db.usage_daily.find(x => x.tool === t && x.action === a);
    ok('usage: Box Segregate lookups counted (2 found, 1 not found)', u('box_segregate', 'lookup_found')?.event_count === 2 && u('box_segregate', 'lookup_not_found')?.event_count === 1);
    ok('usage: Price Check lookups counted (3 found, 1 not found)', u('price_check', 'lookup_found')?.event_count === 3 && u('price_check', 'lookup_not_found')?.event_count === 1);
    ok('usage: Pallet scans counted (1 scanned, 1 duplicate, 1 unknown)', u('box_segregate_pallet', 'box_scanned')?.event_count === 1 && u('box_segregate_pallet', 'box_duplicate')?.event_count === 1 && u('box_segregate_pallet', 'box_not_found')?.event_count === 1);
    ok('usage: rows carry the user and a YYYY-MM-DD day', __db.usage_daily.every(x => x.user_id === 'u1' && /^\d{4}-\d{2}-\d{2}$/.test(x.day)));
    const sentRows = __db.usage_daily.length; await Usage.flush();
    ok('usage: flushing again sends nothing twice', __db.usage_daily.length === sentRows && __db.usage_daily.reduce((n, x) => n + x.event_count, 0) === 10);
    Usage.log('hacking', 'x', 1, 0); await Usage.flush();
    ok('usage: an event the server rejects is dropped, not retried forever', Object.keys(Storage.getJSON('usage_pending_u1') || {}).length === 0);
    bsSetPalletMode(false);

    // ---------- account deletion was rolled back ----------
    ok('no Delete-account button, modal or code in the app', !document.getElementById('openDeleteAccountBtn') && !document.getElementById('deleteAccountModal') && typeof openDeleteAccount === 'undefined' && typeof confirmDeleteAccount === 'undefined');

    // ---------- invitations: safer sending, clearer receiving ----------
    window.alert = m => { window.__lastAlert = String(m); };
    const inviteRows = e => __db.enterprise_invites.filter(i => i.invited_email === e).length;
    __db.enterprise_invites = [];
    AppState.user = { id: 'u1', email: 'a@b.c' }; AppState.profile = { display_name: 'Admin', enterprise_id: 'E1', tier: 'enterprise_admin' };
    window.__me = { id: 'u1', email: 'a@b.c', tier: 'enterprise_admin', enterprise_id: 'E1' };
    const sendTo = async (email) => { window.__lastAlert = ''; document.getElementById('inviteEmailInput').value = email; await sendInvite(); };
    await sendTo('Pat@X.com');
    ok('an invitation is sent', inviteRows('pat@x.com') === 1 && window.__lastAlert === '');
    await sendTo('pat@x.com');
    ok('a second invitation to the same email is ignored, with a friendly note', inviteRows('pat@x.com') === 1 && /already waiting/.test(window.__lastAlert), window.__lastAlert);
    window.__alreadyInCompany = ['busy@x.com']; await sendTo('busy@x.com');
    ok('inviting someone who already belongs to a company is refused at once', inviteRows('busy@x.com') === 0 && /already belongs to another company/.test(window.__lastAlert), window.__lastAlert);
    await sendTo('not-an-email');
    ok('a bad email is refused with a clear message', /valid email/.test(window.__lastAlert));
    // the person who received two invitations
    __db.enterprise_invites = [
      { id: 'iA', enterprise_id: 'EA', enterprise_name: 'Alpha Trading', invited_email: 'pat@x.com', status: 'pending', expires_at: new Date(Date.now() + 5 * 864e5).toISOString() },
      { id: 'iB', enterprise_id: 'EB', enterprise_name: 'Beta Stores', invited_email: 'pat@x.com', status: 'pending', expires_at: new Date(Date.now() + 5 * 864e5).toISOString() }];
    window.__me = { id: 'u9', email: 'Pat@X.com', tier: 'individual', enterprise_id: null };
    AppState.user = { id: 'u9', email: 'pat@x.com' }; AppState.profile = { display_name: 'Pat', enterprise_id: null, tier: 'individual' };
    await checkForMyPendingInvite();
    const banner = document.getElementById('inviteBanner');
    ok('two invitations: the banner says how many and offers Choose', banner.style.display === 'flex' && /You have 2 invitations/.test(document.getElementById('inviteBannerInfo').textContent) && document.getElementById('acceptInviteBtn').textContent === 'Choose');
    AppLang.set('ar');
    ok('... and the banner follows the Arabic language choice', /[\u0600-\u06FF]/.test(document.getElementById('inviteBannerInfo').textContent) && /2/.test(document.getElementById('inviteBannerInfo').textContent));
    AppLang.set('en');
    document.getElementById('acceptInviteBtn').click();
    ok('Choose opens a list with BOTH company names', document.getElementById('inviteModal').classList.contains('active') && /Alpha Trading/.test(document.getElementById('inviteModalList').textContent) && /Beta Stores/.test(document.getElementById('inviteModalList').textContent) && document.querySelectorAll('#inviteModalList [data-accept-invite]').length === 2);
    document.querySelector('#inviteModalList [data-accept-invite]').click(); await new Promise(r => setTimeout(r, 80));
    const stat = n => __db.enterprise_invites.find(i => i.id === n).status;
    ok('accepting one joins that company and closes the other invitation', [stat('iA'), stat('iB')].sort().join() === 'accepted,expired' && AppState.profile.tier === 'enterprise_member', [stat('iA'), stat('iB')].join());
    ok('the banner and the list close afterwards', !document.getElementById('inviteModal').classList.contains('active') && banner.style.display === 'none');
    // one invitation: the banner names the company and accepts directly
    __db.enterprise_invites = [{ id: 'iC', enterprise_id: 'EC', enterprise_name: 'Gamma Ltd', invited_email: 'lee@x.com', status: 'pending', expires_at: new Date(Date.now() + 5 * 864e5).toISOString() }];
    window.__me = { id: 'u8', email: 'lee@x.com', tier: 'individual', enterprise_id: null };
    AppState.user = { id: 'u8', email: 'lee@x.com' }; AppState.profile = { display_name: 'Lee', enterprise_id: null, tier: 'individual' };
    await checkForMyPendingInvite();
    ok('one invitation: the banner names the company and says Accept', /Gamma Ltd invited you to join/.test(document.getElementById('inviteBannerInfo').textContent) && document.getElementById('acceptInviteBtn').textContent === 'Accept');
    document.getElementById('acceptInviteBtn').click(); await new Promise(r => setTimeout(r, 80));
    ok('Accept joins the company directly', stat('iC') === 'accepted' && AppState.profile.tier === 'enterprise_member');
    // an enterprise member / admin never sees a banner
    __db.enterprise_invites = [{ id: 'iD', enterprise_id: 'ED', enterprise_name: 'Delta', invited_email: 'lee@x.com', status: 'pending', expires_at: new Date(Date.now() + 5 * 864e5).toISOString() }];
    await checkForMyPendingInvite();
    ok('someone who already belongs to a company sees no invitation banner', document.getElementById('inviteBanner').style.display === 'none');
    __db.enterprise_invites = []; window.__alreadyInCompany = [];
    window.__me = { id: 'u1', email: 'a@b.c', tier: 'individual', enterprise_id: null };
    AppState.user = { id: 'u1', email: 'a@b.c' }; AppState.profile = { display_name: 'Ann', enterprise_id: null, tier: 'individual' };

    // ---------- sync / upload / template buttons are pictures; the % display still works and the picture returns ----------
    const syncBtn = document.getElementById('bsRefreshBtn');
    ok('sync, upload and template buttons use the picture icons', !!syncBtn.querySelector('img[src="icons/ui-sync.png"]') && !!document.querySelector('#bsUploadBtn img[src="icons/ui-upload.png"]') && !!document.querySelector('#bsTemplateBtn img[src="icons/ui-download.png"]') && !!document.querySelector('#pcRefreshBtn img[src="icons/ui-sync.png"]') && !!document.querySelector('#ysImSyncBtn img[src="icons/ui-sync.png"]') && !!document.querySelector('#uploadCsvBtn img[src="icons/ui-upload.png"]') && !!document.querySelector('#downloadTemplateBtn img[src="icons/ui-download.png"]'));
    const prog = refProgress(syncBtn, 'Syncing'); prog.update(40, 'Syncing');
    ok('while syncing the button shows the percentage and is disabled', syncBtn.textContent === '40%' && syncBtn.disabled);
    prog.done();
    ok('... and the picture icon comes back afterwards', !!syncBtn.querySelector('img[src="icons/ui-sync.png"]') && !syncBtn.disabled && syncBtn.textContent.trim() === '');
    ok('no old text icons are left on those buttons', !/[↻⬆📄]/.test(['pcRefreshBtn','pcUploadBtn','pcTemplateBtn','bsRefreshBtn','bsUploadBtn','bsTemplateBtn','ysImSyncBtn','ysUploadItemsBtn','ysUploadPtlBtn'].map(id => document.getElementById(id).textContent).join('')));

    // ---------- app updates ----------
    AppState.isOnline = true;
    const realFetch = window.fetch;
    const swText = v => `const CACHE_VERSION = 'ak-utility-v${v}';`;
    const running = runningAppVersion();
    ok('the running version is read from the script tags', running > 0 && Number.isInteger(running), running);
    const popup = () => document.getElementById('updateModal').classList.contains('active');
    const dot = () => !document.getElementById('updateDot').hidden;
    document.querySelectorAll('.modal-overlay').forEach(m => m.classList.remove('active'));
    ok('against the real server file: up to date, no dot, no popup', (await checkForAppUpdate({ popup: true })) === 'current' && !dot() && !popup());
    window.fetch = async (u, o) => /sw\.js/.test(u) ? new Response(swText(running + 1)) : realFetch(u, o);
    ok('a newer version lights the red dot but a plain check does not open the popup', (await checkForAppUpdate()) === 'newer' && dot() && !popup());
    ok('an automatic check opens the CENTRED popup with the new number and an Update now button', (await checkForAppUpdate({ popup: true })) === 'newer' && popup() && document.getElementById('updateModalText').textContent.includes('v' + (running + 1)) && document.getElementById('updateNowBtn').style.display !== 'none');
    ok('the popup is centred on screen, not pinned to the bottom corner', (() => { const r = document.querySelector('#updateModal .modal').getBoundingClientRect(); return Math.abs((r.top + r.bottom) / 2 - innerHeight / 2) < 60 && Math.abs((r.left + r.right) / 2 - innerWidth / 2) < 30; })());
    document.getElementById('updateLaterBtn').click();
    ok('Later closes it, the dot stays until the app is updated', !popup() && dot());
    document.getElementById('updateBtn').click(); await sleep(30);
    ok('tapping the update icon with an update waiting opens the popup again', popup());
    document.getElementById('updateLaterBtn').click();
    document.getElementById('accountModal').classList.add('active');
    window.fetch = async (u, o) => /sw\.js/.test(u) ? new Response(swText(running + 1)) : realFetch(u, o);
    ok('an automatic check does not interrupt another open window (only the dot)', (await checkForAppUpdate({ popup: true })) === 'newer' && !popup());
    document.getElementById('accountModal').classList.remove('active');
    window.fetch = async (u, o) => /sw\.js/.test(u) ? new Response(swText(running)) : realFetch(u, o);
    ok('same version again clears the dot', (await checkForAppUpdate()) === 'current' && !dot());
    window.fetch = async () => { throw new TypeError('Failed to fetch'); };
    ok('a failed check is harmless ("unknown", no dot)', (await checkForAppUpdate()) === 'unknown' && !dot());
    window.fetch = realFetch; AppState.isOnline = false;
    ok('offline: no check is made', (await checkForAppUpdate()) === 'offline'); AppState.isOnline = true;
    window.fetch = async (u, o) => /sw\.js/.test(u) ? new Response(swText(running)) : realFetch(u, o);
    document.getElementById('updateBtn').click(); await sleep(150);
    ok('tapping the update icon when up to date says so and shows the running version', popup() && /latest version/.test(document.getElementById('updateModalText').textContent) && document.getElementById('appVersionDisp').textContent === 'v' + running && document.getElementById('updateNowBtn').style.display === 'none', document.getElementById('updateModalText').textContent);
    document.getElementById('updateLaterBtn').click(); window.fetch = realFetch;

    // ---------- Box Scanner badge % ----------
    ok('uids valid UUIDs', /^[0-9a-f-]{36}$/.test(newScanUid()));
    return log;
  });

  const failures = report(log, errors.filter(e => !/Failed to load resource/.test(e)));
  await stop(ctx);
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('TEST CRASH', e); process.exit(1); });
