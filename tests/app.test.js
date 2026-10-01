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
    const written = []; const realWrite = XLSX.writeFile; XLSX.writeFile = (wb, name) => written.push({ name, rows: XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]) });
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
    const up = []; await refUploadList('box_list', big, p => up.push(Math.round(p)));
    ok('large upload chunked (3 chunks of 2000) w/ progress', __db.reference_chunks.filter(c => c.list_type === 'box_list').length === 3 && up.length >= 4 && up[up.length-1] === 100, up.join(','));
    const down = []; await refSync('box_list', { onProgress: p => down.push(Math.round(p)) });
    ok('large download w/ progress', down[down.length - 1] === 100 && down.some(x => x > 0 && x < 100), down.join(',') + ' / rows=' + (await refCacheGet('box_list')).length);

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
    ok('AWB download grouped by doc/store', dl.rows.length === 2 && dl.rows[0]['Document Number'] === 'D1' && dl.rows[0]['Store Name'] === 'Riyadh Park' && dl.rows[1]['Document Number'] === 'D2' && Object.keys(dl.rows[0]).join() === 'Document Number,Store Name,Box Number,Scanned At', JSON.stringify(dl.rows));
    resetPalletScans(); ok('pallet reset downloads then clears', written.length === 1 && bsDocScans.length === 0);
    bsSetPalletMode(false); ok('toggle back to normal hides pallet panel', document.getElementById('bsPalletWrap').style.display === 'none');

    // ---------- templates ----------
    const tplHeaders = (lt) => { const n = written.length; refDownloadTemplate(lt); const w = written[written.length - 1]; return w; };
    const grab = (lt) => { let cap; const old = XLSX.writeFile; XLSX.writeFile = (wb, name) => { cap = { name, headers: XLSX.utils.sheet_to_json(wb.Sheets['Data'], { header: 1 })[0], sheets: wb.SheetNames }; }; refDownloadTemplate(lt); XLSX.writeFile = old; return cap; };
    let t = grab('box_list'); ok('box list template headers', t.headers.join() === 'Box Number,TRN,Increff Order ID,Store Name,Region,Store Code,Brand' && t.sheets.join() === 'Data,Instructions', t.headers.join());
    t = grab('doc_boxes'); ok('doc template headers', t.headers.join() === 'Document Number,Box Number,Store Name', t.name);
    t = grab('ys_ptl_config'); ok('ptl template headers', t.headers.join() === 'PTL Number,Season,Year,Year Logic');
    t = grab('price_list'); ok('price template headers', t.headers.join() === 'Barcode,Current Price,Original Price,Style,Color,Size,Year,Season');
    t = grab('ys_item_master'); ok('item master template headers', t.headers.join() === 'Barcode,Year,Season,Brand');
    // a template filled in by the user round-trips through the parser
    const filled = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(filled, XLSX.utils.aoa_to_sheet([['Document Number','Box Number','Store Name'],['D9','Z1','Mall']]), 'Data');
    const fp = await refParseFile(new File([XLSX.write(filled, { type: 'array', bookType: 'xlsx' })], 't.xlsx'), 'doc_boxes'); ok('filled template parses', fp.rows.length === 1 && fp.rows[0].document_number === 'D9');
    ok('template buttons exist', ['bsTemplateBtn','pcTemplateBtn'].every(id => document.getElementById(id)));
    ok('ad slot exists and takes no space', getComputedStyle(document.getElementById('adSlotBottom')).display === 'none');

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
    document.getElementById('ysStaffInput').value = 'Sam'; document.getElementById('ysRemarkInput').value = 'R';
    await ysStartSession();
    ok('YS session start synced PTL config + item master', YSState.huConfig.length === 2 && (await ysDbCount(YS_ITEMS_STORE)) === 2 && YSState.huStates.length === 2, 'ptls=' + YSState.huConfig.length);
    ok('YS storeId from google account', AppState.storeId === 'a@b.c');
    // scans
    const mk = (uid, st) => ({ scanUid: uid, scanIso: new Date().toISOString(), storeId: 'a@b.c', storeName: 'Ann', staffName: 'Sam', remark: 'R', ptlNumber: '01', season: 'SS', year: 2024, brand: 'Nike', barcode: 'I1', qty: 1, boxBarcode: 'BX1', boxStatus: st, scanTimestamp: ysNow(), synced: false });
    await ysDbAdd(YS_SCANS_STORE, mk(crypto.randomUUID(), 'Closed')); await ysDbAdd(YS_SCANS_STORE, mk(crypto.randomUUID(), 'Closed')); await ysDbAdd(YS_SCANS_STORE, mk(crypto.randomUUID(), 'Open'));
    await ysAutoSync();
    ok('YS closed scans synced to server, open stays local', __db.ys_scans.length === 2 && __db.ys_scans[0].ptl_number === '01' && __db.ys_scans[0].user_id === 'u1');
    await ysAutoSync(); ok('YS resync does not duplicate', __db.ys_scans.length === 2);
    // legacy scan without uid gets one
    await ysDbAdd(YS_SCANS_STORE, { ...mk(undefined, 'Closed'), scanUid: undefined }); await ysBackfillScanUids();
    ok('YS legacy scans get scan uid', (await ysDbGetAll(YS_SCANS_STORE)).every(s => s.scanUid));
    // individual reset
    YSState.huStates.forEach(h => h.status = 'Closed'); await ysAutoSync();
    await ysExecuteReset();
    ok('YS individual reset: downloaded, device + server cleared', written.length === 2 && (await ysDbGetAll(YS_SCANS_STORE)).length === 0 && __db.ys_scans.length === 0, 'rows exported=' + written[1]?.rows.length);
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
    await refreshTeamMemberStats(); await refreshTeamTitle();
    ok('team title shows name + member count', document.getElementById('teamModalTitle').textContent === '👥 Acme (2 members)', document.getElementById('teamModalTitle').textContent);
    window.prompt = () => '  Acme Corp  '; await renameEnterprise();
    ok('rename updates title', document.getElementById('teamModalTitle').textContent === '👥 Acme Corp (2 members)', document.getElementById('teamModalTitle').textContent);
    ok('photo capture is gone', !document.getElementById('photoCaptureApp') && !APPS.some(a => a.id === 'photoCapture') && typeof initPhotoCapture === 'undefined');
    ok('6 tools + scanner tiles', APPS.length === 6, APPS.map(a => a.id).join());
    ok('NO content-security-policy violations during the whole run', window.__csp.length === 0, JSON.stringify(window.__csp));

    // ---------- Box Scanner badge % ----------
    ok('uids valid UUIDs', /^[0-9a-f-]{36}$/.test(newScanUid()));
    return log;
  });

  const failures = report(log, errors.filter(e => !/Failed to load resource/.test(e)));
  await stop(ctx);
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('TEST CRASH', e); process.exit(1); });
