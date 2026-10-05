// Team QR links, labourer side: the join page, the single-tool screen, offline and a switched-off job.
const { start, openApp, report, stop } = require('./helpers/harness');

const LINK = { id: 'L1', token: 'abcdef0123456789abcdef0123456789', tool: 'boxScanner', job_name: 'Inbound 7', state: 'active' };

(async () => {
  const ctx = await start();
  const log = [];
  const ok = (name, cond, extra) => log.push({ pass: !!cond, name, extra: extra === undefined || cond ? '' : String(extra) });
  const errors = [];

  // --- 1. opening the QR address ---
  const a = await openApp(ctx, null, '?join=' + LINK.token);
  errors.push(...a.errors);
  let page = a.page;
  // the link has to exist before the app asks; reload with it set
  await page.addInitScript((l) => { window.__teamLink = l; }, LINK);
  await page.goto(`http://127.0.0.1:${ctx.port}/?join=${LINK.token}`);
  await page.waitForTimeout(500);
  const joinShown = () => page.evaluate(() => ({
    screen: AppState.currentScreen, ent: document.getElementById('joinEnterprise').textContent, adm: document.getElementById('joinAdmin').textContent,
    tool: document.getElementById('joinTool').textContent, job: document.getElementById('joinJob').textContent,
    form: document.getElementById('joinForm').style.display, msg: document.getElementById('joinMsg').textContent
  }));
  let j = await joinShown();
  ok('QR address opens the join page', j.screen === 'joinScreen', j.screen);
  ok('it shows enterprise, admin, tool and job from the server', j.ent === 'Acme' && j.adm === 'Akhtar' && j.tool === 'Box-Item Scan' && j.job === 'Inbound 7', JSON.stringify(j));
  ok('it asks for a name only', j.form !== 'none');

  // empty name refused
  await page.click('#joinBtn');
  ok('empty name is refused', /name/i.test(await page.textContent('#joinMsg')) && (await page.evaluate(() => window.__anonSignIns || 0)) === 0);

  // --- 2. join ---
  await page.fill('#joinNameInput', '  Ravi ');
  await page.click('#joinBtn');
  await page.waitForTimeout(700);
  const s = await page.evaluate(() => ({
    screen: AppState.currentScreen, app: AppState.currentApp, op: AppState.operator && AppState.operator.name, remark: document.getElementById('scannerRemarkInput').value,
    body: document.body.classList.contains('operator-mode'), url: location.search, joined: window.__joined,
    back: getComputedStyle(document.getElementById('appBackBtn')).display,
    bar: document.getElementById('opBarJob').textContent, who: document.getElementById('opBarWho').textContent,
    remarkCard: document.getElementById('scannerRemarkCard').style.display, header: document.getElementById('headerUser').textContent
  }));
  ok('joining signed in anonymously (once) and joined with the trimmed name', s.joined && s.joined.name.trim() === 'Ravi' && s.joined.user === 'anon1', JSON.stringify(s.joined));
  ok('the device now shows only the Box-Item Scan tool', s.screen === 'appScreen' && s.app === 'boxScanner', s.screen + ' ' + s.app);
  ok('no back button and no user icon in the top bar (the icon is gone for everybody)', s.back === 'none' && (await page.evaluate(() => !document.getElementById('accountBtn'))), s.back);
  ok('the token is removed from the address', s.url === '', s.url);
  ok('the job name is the Remark and the Remark card is hidden', s.remark === 'Inbound 7' && s.remarkCard === 'none', s.remark + ' ' + s.remarkCard);
  ok('the top bar shows job, name, enterprise and admin', s.bar === 'Inbound 7' && /Ravi/.test(s.who) && /Acme/.test(s.who) && /Akhtar/.test(s.who), s.who);
  ok('the header shows the operator name', s.header === 'Ravi', s.header);

  // --- 3. scanning works without typing a remark ---
  await page.evaluate(() => { window.alert = (m) => { window.__alerts = (window.__alerts || []).concat(m); }; });
  await page.fill('#boxIdInput', 'BX1'); await page.press('#boxIdInput', 'Enter'); await page.waitForTimeout(200);
  const afterBox = await page.evaluate(() => ({ remark: ScannerState.remark, boxScanning: ScannerState.boxScanning, alerts: window.__alerts || [] }));
  ok('first scan starts the job with the link\'s job name', afterBox.remark === 'Inbound 7' && afterBox.boxScanning && afterBox.alerts.length === 0, JSON.stringify(afterBox));

  // --- 4. reload (offline) keeps the device in the same tool ---
  await page.goto(`http://127.0.0.1:${ctx.port}/index.html`);
  await page.waitForTimeout(600);
  const r = await page.evaluate(() => ({ screen: AppState.currentScreen, app: AppState.currentApp, op: AppState.operator && AppState.operator.name, ent: AppState.profile && AppState.profile.enterprise_id, tier: AppState.profile && AppState.profile.tier }));
  ok('after a reload the device goes straight back to its tool', r.screen === 'appScreen' && r.app === 'boxScanner' && r.op === 'Ravi', JSON.stringify(r));
  ok('the device counts as a team member (Reset is device-only)', r.ent === 'E1' && r.tier === 'operator', JSON.stringify(r));

  await page.evaluate(() => { window.alert = (m) => { window.__alerts = (window.__alerts || []).concat(m); }; window.confirm = () => true; });

  // --- 5. the admin stops the job: new scanning is switched off ---
  await page.evaluate(() => { window.__teamLink.state = 'stopped'; });
  await page.evaluate(() => refreshOperatorState());
  await page.waitForTimeout(200);
  const st = await page.evaluate(() => ({ notice: document.getElementById('opBarNotice').textContent, disabled: document.getElementById('barcodeInput').disabled && document.getElementById('boxIdInput').disabled, blocked: operatorBlocked() }));
  ok('a stopped job shows a notice and switches scan fields off', st.blocked && st.disabled && /stopped/i.test(st.notice), JSON.stringify(st));
  await page.evaluate(() => { window.__alerts = []; document.getElementById('barcodeInput').disabled = false; });
  await page.fill('#barcodeInput', '12345'); await page.press('#barcodeInput', 'Enter');
  ok('a scan that still slips in is refused', (await page.evaluate(() => (window.__alerts || []).length)) === 1);
  await page.evaluate(() => { window.__teamLink.state = 'inactive'; });
  await page.evaluate(() => refreshOperatorState());
  ok('3 quiet days message', /3 days/.test(await page.textContent('#opBarNotice')));
  await page.evaluate(() => { window.__teamLink.state = 'active'; });
  await page.evaluate(() => refreshOperatorState());
  ok('...and it comes back when the job is switched on again', (await page.evaluate(() => operatorBlocked())) === false);

  // --- 6. leaving needs the scans handled first ---
  await page.evaluate(() => { window.__alerts = []; });
  await page.click('#signOutBtn');
  ok('leaving with scans on the device is refused', (await page.evaluate(() => (window.__alerts || []).length)) === 1 && (await page.evaluate(() => !!AppState.operator)));

  // leaving: online it tells the server, then the device forgets the job and the sign-in
  await page.evaluate(() => { AppState.hasActiveSession = false; AppState.isOnline = false; window.__alerts = []; });
  await page.click('#signOutBtn');
  ok('leaving while offline is refused (the admin must see it)', (await page.evaluate(() => window.__alerts.length)) === 1 && (await page.evaluate(() => !!AppState.operator)) && !(await page.evaluate(() => window.__left)));
  await page.evaluate(() => { AppState.isOnline = true; });
  await page.click('#signOutBtn'); await page.waitForTimeout(400);
  const lv = await page.evaluate(() => ({ left: window.__left, op: AppState.operator, sess: localStorage.getItem('mock_session'), saved: localStorage.getItem('aku_operator'), screen: AppState.currentScreen }));
  ok('leaving removes the labourer from the link, then signs the handheld out', lv.left === true && lv.op === null && lv.sess === null && lv.saved === null && lv.screen === 'loginScreen', JSON.stringify(lv));

  // --- 7. Arabic and stopped links on the join page ---
  const b = await openApp(ctx, null, 'index.html');
  errors.push(...b.errors);
  page = b.page;
  await page.addInitScript((l) => { window.__teamLink = { ...l, state: 'stopped' }; }, LINK);
  await page.goto(`http://127.0.0.1:${ctx.port}/?join=${LINK.token}`);
  await page.waitForTimeout(500);
  j = await joinShown();
  ok('a stopped QR cannot be joined (message, no form)', /stopped/i.test(j.msg) && j.form === 'none', JSON.stringify(j));
  await page.goto(`http://127.0.0.1:${ctx.port}/?join=0000000000000000ffff`);
  await page.waitForTimeout(500);
  j = await joinShown();
  ok('a made-up QR says it is not valid', /not valid/i.test(j.msg) && j.form === 'none', JSON.stringify(j));

  // Google user opening a labourer QR
  await page.evaluate(() => localStorage.setItem('mock_session', JSON.stringify({ user: { id: 'g1', email: 'x@y.z' } })));
  await page.goto(`http://127.0.0.1:${ctx.port}/?join=${LINK.token}`);
  await page.waitForTimeout(500);
  j = await joinShown();
  ok('a device signed in with Google is asked to sign out first', /Google/.test(j.msg) && j.form === 'none', JSON.stringify(j));

  // --- 8. the admin side: Team & Data workspace - Jobs (create, several teams per tool, show QR, stop) ---
  const c = await openApp(ctx, null, 'index.html');
  errors.push(...c.errors);
  page = c.page;
  await page.evaluate(() => {
    window.__me = { id: 'u1', enterprise_id: 'E1', tier: 'enterprise_admin', email: 'akhtar@x.y' };
    window.alert = (m) => { window.__alerts = (window.__alerts || []).concat(m); }; window.confirm = () => true;
    AppState.user = { id: 'u1', email: 'akhtar@x.y' }; AppState.profile = { id: 'u1', display_name: 'Akhtar', enterprise_id: 'E1', tier: 'enterprise_admin' };
    window.__files = []; XLSX.writeFile = (wb, name) => { window.__files.push(name); };
  });
  const wait = (ms) => page.waitForTimeout(ms);
  await page.evaluate(() => openWorkspace('jobs'));
  await wait(300);
  ok('the workspace opens on Jobs with an empty list', /No jobs match/.test(await page.textContent('#wsJobsList')));
  await page.click('[data-ws="newjob"]');
  ok('the tool menu lists the six tools (not Team & Data itself)', (await page.$$eval('#wsNewTool option', o => o.map(x => x.value).filter(Boolean))).join() === 'boxScanner,itemBarcode,boxCode,boxSegregate,priceCheck,yearSegregate');
  await page.click('[data-ws="create"]');
  ok('a tool is required', (await page.evaluate(() => (window.__alerts || []).length)) === 1);
  await page.selectOption('#wsNewTool', 'boxScanner');
  await page.click('[data-ws="create"]');
  ok('a job name is required', (await page.evaluate(() => (window.__alerts || []).length)) === 2);
  await page.fill('#wsNewName', 'Inbound 7');
  await page.click('[data-ws="create"]');
  await wait(500);
  const q = await page.evaluate(() => ({
    open: document.getElementById('qrSheetModal').classList.contains('active'), ent: qsEnterprise.textContent, adm: qsAdmin.textContent, tool: qsTool.textContent, job: qsJob.textContent,
    url: qsUrl.textContent, qr: !!document.querySelector('#qsQr img, #qsQr canvas'), list: document.getElementById('wsJobsList').textContent
  }));
  ok('creating a job opens the QR sheet with enterprise, admin, tool, job and the address', q.open && q.ent === 'Acme' && q.adm === 'Akhtar' && q.tool === 'Box-Item Scan' && q.job === 'Inbound 7' && /\/j\/f{31}1$/.test(q.url), JSON.stringify(q));
  ok('the sheet draws a QR code', q.qr);
  ok('the new job appears in the list as Active', /Inbound 7/.test(q.list) && /Active/.test(q.list), q.list);
  await page.click('#qsCloseBtn');
  await page.click('[data-ws="newjob"]'); await page.selectOption('#wsNewTool', 'boxScanner'); await page.fill('#wsNewName', 'Inbound 8'); await page.click('[data-ws="create"]'); await wait(500);
  await page.click('#qsCloseBtn');
  const list2 = await page.textContent('#wsJobsList');
  ok('a second team on the same tool gets its own job: both stay in the list', /Inbound 8/.test(list2) && /Inbound 7/.test(list2), list2);
  ok('...and both are active', (await page.$$('#wsJobsList .ws-pill.ok')).length === 2);
  await page.click('[data-ws="newjob"]'); await page.selectOption('#wsNewTool', 'boxScanner'); await page.fill('#wsNewName', ' inbound 8 '); await page.click('[data-ws="create"]'); await wait(300);
  ok('same tool + same job name (any capitals) asks first in a dialog', await page.evaluate(() => document.getElementById('wsDialog').classList.contains('active') && /already active/.test(document.getElementById('wsDialogBody').textContent)));
  await page.click('#wsDialogOk'); await wait(500);
  await page.click('#qsCloseBtn');
  const list3 = await page.textContent('#wsJobsList');
  ok('...and replaces only that job (Inbound 7 is untouched)', /Inbound 7/.test(list3) && (list3.match(/inbound 8/gi) || []).length === 1, list3);
  ok('"Show QR" reopens the sheet for a job', await (async () => { await page.click('[data-ws-qr]'); return /Inbound/i.test(await page.textContent('#qsJob')); })());
  await page.click('#qsCloseBtn');
  // search, filters, sorting, paging
  await page.fill('#wsJobSearch', '7'); await wait(500);
  ok('searching by name narrows the list', (await page.$$('#wsJobsList tbody tr')).length === 1 && /Inbound 7/.test(await page.textContent('#wsJobsList')));
  await page.fill('#wsJobSearch', ''); await wait(500);
  await page.evaluate(() => { const t = Date.now(); for (let i = 1; i <= 30; i++) window.__links.push({ id: 'X' + i, token: 'x'.repeat(31) + i, tool: i % 2 ? 'yearSegregate' : 'boxScanner', job_name: 'Job ' + String(i).padStart(2, '0'), state: 'active', operators: i, boxes: i * 2, units: i * 10 }); });
  await page.selectOption('#wsJobSort', 'name'); await wait(400);
  ok('a long list shows one page (25) with a pager', (await page.$$('#wsJobsList tbody tr')).length === 25 && /1-25 of 32/.test(await page.textContent('#wsJobsPager')), await page.textContent('#wsJobsPager'));
  await page.click('[data-ws-page="jobs:next"]'); await wait(400);
  ok('Next shows the rest', (await page.$$('#wsJobsList tbody tr')).length === 7 && /26-32 of 32/.test(await page.textContent('#wsJobsPager')));
  await page.click('[data-ws-page="jobs:prev"]'); await wait(300);
  await page.selectOption('#wsJobTool', 'yearSegregate'); await wait(400);
  ok('filtering by tool works', (await page.$$('#wsJobsList tbody tr')).length === 15 && /Year\/Season/.test(await page.textContent('#wsJobsList')));
  await page.selectOption('#wsJobTool', '');
  // stop one job, and several at once
  await page.fill('#wsJobSearch', 'Job 0'); await wait(500);
  await page.evaluate(() => document.querySelectorAll('[data-ws-sel]').forEach(c => c.click()));
  ok('selecting jobs shows the bulk bar with their count', /9 selected/.test(await page.textContent('#wsJobsBulk')), await page.textContent('#wsJobsBulk'));
  await page.click('[data-ws="bulk-stop"]'); await wait(200);
  ok('stopping several asks first, naming how many', await page.evaluate(() => /Stop 9 links/.test(document.getElementById('wsDialogBody').textContent)));
  await page.click('#wsDialogOk'); await wait(500);
  ok('...and they leave the Active list', /No jobs match/.test(await page.textContent('#wsJobsList')));
  await page.click('[data-ws-status="stopped"]'); await wait(400);
  ok('the Stopped filter shows them', (await page.$$('#wsJobsList tbody tr')).length === 9 && /Stopped/.test(await page.textContent('#wsJobsList')));
  await page.click('[data-ws-status="all"]'); await page.fill('#wsJobSearch', ''); await wait(500);
  ok('All shows active and stopped together', /1-25 of 3[0-9]/.test(await page.textContent('#wsJobsPager')), await page.textContent('#wsJobsPager'));
  await page.evaluate(() => AppLang.set('ar'));
  await wait(300);
  ok('the workspace is in Arabic when the app is Arabic', /[؀-ۿ]/.test(await page.textContent('#wsNav')) && /[؀-ۿ]/.test(await page.getAttribute('#wsJobSearch', 'placeholder')));
  await page.evaluate(() => AppLang.set('en'));
  await wait(300);

  // --- 8b. job detail: boxes, people, activity, download, delete ---
  await page.evaluate(() => {
    const l = window.__links.find(x => x.job_name === 'Inbound 7') || window.__links[0];
    Object.assign(l, { operators: 2, boxes: 2, units: 5, id: 'LD', last_scan_at: new Date(Date.now() - 3 * 86400000).toISOString() });
    window.__wsBoxes = { LD: [{ box: 'B1', status: 'Closed', items: 3, scanned_by: 'Ravi', last_at: new Date().toISOString() }, { box: 'B2', status: 'Open', items: 2, scanned_by: 'Sana', last_at: new Date().toISOString() }] };
    window.__wsJobPeople = { LD: [{ operator_id: 'op1', name: 'Ravi', joined_at: new Date().toISOString(), removed_at: null, boxes: 1, units: 3, last_at: new Date().toISOString() }, { operator_id: 'op2', name: 'Sana', joined_at: new Date().toISOString(), removed_at: null, boxes: 0, units: 2, last_at: new Date().toISOString() }] };
    __db.scans = [{ id: 'd1', enterprise_id: 'E1', link_id: 'LD', user_id: 'u9', operator_name: 'Ravi', remark: 'Inbound 7', box_number: 'B1', barcode: '111', qty: 1, box_status: 'Closed', scanned_at: new Date().toISOString() },
                  { id: 'd2', enterprise_id: 'E1', link_id: 'LD', user_id: 'u9', operator_name: 'Ravi', remark: 'Inbound 7', box_number: 'B1', barcode: '222', qty: 2, box_status: 'Closed', scanned_at: new Date().toISOString() }];
    window.__wsRows = Array.from({ length: 2500 }, (_, i) => ({ id: 'r' + String(i).padStart(5, '0'), scanned_at: new Date(Date.now() - (3000 - i) * 1000).toISOString(), person: 'Ravi', job: 'Inbound 7', box: 'B' + (i % 7), barcode: 'bc' + i, qty: 1, status: 'Closed', extra: null }));
  });
  await page.fill('#wsJobSearch', 'Inbound 7'); await page.selectOption('#wsJobSort', 'last_scan'); await page.click('[data-ws-status="all"]'); await wait(500);
  await page.click('[data-ws-open="LD"]'); await wait(500);
  const jd = await page.evaluate(() => ({ h: document.querySelector('.ws-head h3').textContent, tiles: [...document.querySelectorAll('.ws-tile b')].map(x => x.textContent).join('|'), idle: /Idle/.test(document.querySelector('.ws-head h3').textContent) }));
  ok('opening a job shows its name, status and four totals', /Inbound 7/.test(jd.h) && jd.tiles.startsWith('5|2|2|'), JSON.stringify(jd));
  ok('a job with no scan for 3 days is labelled Idle (it stays active)', jd.idle);
  ok('the Boxes tab lists its boxes with who scanned', /B1/.test(await page.textContent('#wsJobBoxes')) && /Ravi/.test(await page.textContent('#wsJobBoxes')) && /Open/.test(await page.textContent('#wsJobBoxes')));
  await page.click('[data-ws-exp^="job:"]'); await wait(300);
  ok('a box expands to its items, loaded only when opened', /111/.test(await page.textContent('#wsJobBoxes')) && /222/.test(await page.textContent('#wsJobBoxes')));
  await page.click('[data-ws-boxdl^="job:"]'); await wait(300);
  ok('a box can be downloaded on its own', (await page.evaluate(() => window.__files)).some(f => /^box_B1_/.test(f)));
  await page.click('[data-ws-tab="people"]'); await wait(300);
  ok('the People tab lists who joined with their totals', /Ravi/.test(await page.textContent('#wsJobPeople')) && /Sana/.test(await page.textContent('#wsJobPeople')));
  await page.evaluate(() => { window.__labourers = [{ id: 'op1', name: 'Ravi' }, { id: 'op2', name: 'Sana' }]; window.prompt = () => 'Ravi Kumar'; });
  await page.click('[data-ws-rename="op1"]'); await wait(300);
  ok('the admin can correct a name from the job', await page.evaluate(() => window.__labourers[0].name === 'Ravi Kumar'));
  await page.click('[data-ws-remove="op2"]'); await wait(300);
  ok('...or remove a person', await page.evaluate(() => !!window.__labourers[1].removed_at));
  await page.click('[data-ws-tab="activity"]'); await wait(300);
  ok('the Activity tab draws 24 hourly bars', (await page.$$('#wsJobActivity .ws-spark i')).length === 24);
  // download everything of the job: 2500 rows come in pages of 1000
  await page.evaluate(() => { window.__files.length = 0; window.__rpcLog = []; });
  await page.click('[data-ws="job-download"]'); await wait(800);
  const dlj = await page.evaluate(() => ({ files: window.__files.slice(), pages: window.__rpcLog.filter(x => x.name === 'ws_data_rows').length, args: window.__rpcLog.find(x => x.name === 'ws_data_rows').args, status: document.getElementById('wsStatus').textContent }));
  ok('Download all pages through the rows 1000 at a time and writes one Excel file', dlj.files.length === 1 && /^job_Inbound_7_/.test(dlj.files[0]) && dlj.pages === 3, JSON.stringify(dlj));
  ok('...asking for exactly this job, with a cut-off time', JSON.stringify(dlj.args.p_jobs) === '["Inbound 7"]' && dlj.args.p_tool === 'boxScanner' && !!dlj.args.p_until, JSON.stringify(dlj.args));
  ok('...and says how many scans were downloaded', /2,500/.test(dlj.status), dlj.status);
  // delete: one confirmation, downloads first, then deletes up to the cut-off
  await page.evaluate(() => { window.__files.length = 0; window.__rpcLog = []; });
  await page.click('[data-ws="job-delete"]'); await wait(200);
  ok('Download and delete opens a dialog that names the job and the counts', await page.evaluate(() => /Inbound 7/.test(document.getElementById('wsDialogBody').textContent) && /permanently/.test(document.getElementById('wsDialogBody').textContent) && !/Type DELETE/.test(document.getElementById('wsDialogBody').textContent)));
  ok('...there is nothing to type: the red button confirms', await page.evaluate(() => document.getElementById('wsDialogInput').hidden && !document.getElementById('wsDialogOk').disabled && document.getElementById('wsDialogOk').classList.contains('btn-danger')));
  await page.click('#wsDialogCancel'); await wait(200);
  ok('cancelling downloads and deletes nothing', (await page.evaluate(() => window.__files.length)) === 0 && !(await page.evaluate(() => window.__rpcLog.some(x => x.name === 'ws_data_delete'))));
  await page.click('[data-ws="job-delete"]'); await page.click('#wsDialogOk'); await wait(900);
  const del = await page.evaluate(() => { const log = window.__rpcLog; const iDl = log.findIndex(x => x.name === 'ws_data_rows'), iDel = log.findIndex(x => x.name === 'ws_data_delete'); return { files: window.__files.length, order: iDl >= 0 && iDel > iDl, args: window.__wsDeleteArgs, status: document.getElementById('wsStatus').textContent }; });
  ok('the file is downloaded BEFORE the delete runs', del.files === 1 && del.order, JSON.stringify(del));
  ok('the delete is for this job only and only up to the moment the download started', JSON.stringify(del.args.p_jobs) === '["Inbound 7"]' && !!del.args.p_until && /Deleted 2,500/.test(del.status), JSON.stringify(del));
  await page.evaluate(() => { window.__wsRows = Array.from({ length: 50001 }, (_, i) => ({ id: 'q' + String(i).padStart(6, '0'), scanned_at: new Date(Date.now() - (60000 - i) * 1000).toISOString(), person: 'Ravi', job: 'Inbound 7', box: 'B1', barcode: 'x' + i, qty: 1, status: 'Closed', extra: null })); window.__files.length = 0; });
  await page.click('[data-ws="job-download"]'); await page.waitForFunction(() => window.__files.length >= 2, null, { timeout: 60000 });
  ok('a download over 50,000 rows is split into several files', await page.evaluate(() => window.__files.length === 2 && /_part1\.xlsx$/.test(window.__files[0]) && /_part2\.xlsx$/.test(window.__files[1])), JSON.stringify(await page.evaluate(() => window.__files)));
  await page.click('[data-ws="job-back"]'); await wait(300);
  ok('Back returns to the Jobs list', /Inbound/.test(await page.textContent('#wsJobsList')));

  // --- 9. Data explorer, People, Overview ---
  await page.evaluate(() => {
    const at = (m) => new Date(Date.now() - m * 60000).toISOString();
    window.__wsData = [{ box: 'B2', job: 'Inbound 9', person: 'Ravi', status: 'Closed', items: 5, last_at: at(4) }, { box: 'B1', job: 'Inbound 8', person: 'Sana', status: 'Open', items: 3, last_at: at(9) }];
    window.__wsRows = [{ id: 'a1', scanned_at: at(9), person: 'Sana', job: 'Inbound 8', box: 'B1', barcode: '1', qty: 3, status: 'Open', extra: null }, { id: 'a2', scanned_at: at(4), person: 'Ravi', job: 'Inbound 9', box: 'B2', barcode: '2', qty: 5, status: 'Closed', extra: null }];
    window.__wsFacets = { job: [{ value: 'Inbound 9', units: 5 }, { value: 'Inbound 8', units: 3 }], person: [{ value: 'Ravi', units: 5 }] };
    window.__wsPeople = [{ person_key: 'o:ravi', name: 'Ravi', kind: 'labourer', jobs: 'Inbound 9', boxes: 1, units: 5, last_at: at(4), operator_ids: ['op1', 'op1b'], user_id: null }, { person_key: 'u:u1', name: 'Akhtar', kind: 'google', jobs: 'Own', boxes: 0, units: 0, last_at: null, operator_ids: null, user_id: 'u1' }, { person_key: 'u:u7', name: 'Priya', kind: 'google', jobs: '', boxes: 2, units: 9, last_at: at(60), operator_ids: null, user_id: 'u7' }];
    window.__rpcLog = []; window.__files.length = 0;
  });
  await page.evaluate(() => openDataManagement());
  await wait(500);
  ok('the Team & Data tile for an admin opens the Data section', await page.evaluate(() => WS.section === 'data'));
  ok('Data shows the matching boxes with their job, person, status and totals', /Inbound 9/.test(await page.textContent('#wsDataList')) && /Sana/.test(await page.textContent('#wsDataList')) && /2 boxes, 8 units match/.test(await page.textContent('#wsDataTotals')), await page.textContent('#wsDataTotals'));
  ok('it opens on the last 7 days of Box-Item Scan', await page.evaluate(() => { const a = window.__rpcLog.find(x => x.name === 'ws_data_boxes').args; return a.p_tool === 'boxScanner' && !!a.p_from && !a.p_to && a.p_jobs === null; }));
  await page.fill('#wsDataJobIn', 'Inbound 9'); await page.dispatchEvent('#wsDataJobIn', 'change'); await wait(400);
  ok('adding a job filter adds a chip and asks the server for that job', /Inbound 9/.test(await page.textContent('#wsDataChips')) && await page.evaluate(() => JSON.stringify(window.__rpcLog.filter(x => x.name === 'ws_data_boxes').pop().args.p_jobs) === '["Inbound 9"]'));
  await page.fill('#wsDataPersonIn', 'Ravi'); await page.dispatchEvent('#wsDataPersonIn', 'change'); await wait(300);
  await page.selectOption('#wsDataRange', 'all'); await page.selectOption('#wsDataStatus', 'Closed'); await wait(300);
  ok('person, date range and box status are sent too', await page.evaluate(() => { const a = window.__rpcLog.filter(x => x.name === 'ws_data_boxes').pop().args; return a.p_person === 'Ravi' && a.p_from === null && a.p_status === 'Closed'; }));
  await page.selectOption('#wsDataRange', 'custom'); await page.fill('#wsDataFrom', '2026-01-01'); await page.fill('#wsDataTo', '2026-01-31'); await wait(300);
  ok('custom dates include the last day', await page.evaluate(() => { const a = window.__rpcLog.filter(x => x.name === 'ws_data_boxes').pop().args; return new Date(a.p_to) - new Date(a.p_from) === 31 * 86400000; }));
  await page.click('[data-ws="data-clear"]'); await wait(300);
  await page.selectOption('#wsDataRange', 'all'); await page.selectOption('#wsDataStatus', ''); await wait(400);
  // selecting boxes with check boxes
  ok('Data has a check box on every box and a "Select all on this page" box above the list', (await page.$$('#wsDataList [data-ws-bsel]')).length === 2 && !!(await page.$('#wsDataSelAll')));
  ok('nothing is ticked at first, so no selection buttons', !/selected/.test(await page.textContent('#wsDataSel')) && !(await page.$('[data-ws="sel-download"]')));
  await page.click('#wsDataList [data-ws-bsel]'); await wait(200);
  ok('ticking a box shows how many boxes and units are selected', /1 boxes selected \(5 units\)/.test(await page.textContent('#wsDataSel')), await page.textContent('#wsDataSel'));
  ok('...and highlights the row', (await page.$$('#wsDataList tr.sel')).length === 1);
  await page.click('#wsDataSelAll'); await wait(200);
  ok('the header check box selects every box on the page', /2 boxes selected \(8 units\)/.test(await page.textContent('#wsDataSel')) && (await page.$$('#wsDataList [data-ws-bsel]:checked')).length === 2);
  await page.click('#wsDataSelAll'); await wait(200);
  ok('...and un-ticks them again', !/selected/.test(await page.textContent('#wsDataSel')));
  await page.click('#wsDataList [data-ws-bsel]'); await wait(200);
  await page.evaluate(() => { window.__files.length = 0; window.__rpcLog = []; });
  await page.click('[data-ws="sel-download"]'); await wait(600);
  const selDl = await page.evaluate(() => ({ files: window.__files.slice(), args: window.__rpcLog.find(x => x.name === 'ws_data_rows').args }));
  ok('Download selected asks only for the ticked box (job + box) and writes the file', selDl.files.length === 1 && /^team_data_selected_/.test(selDl.files[0]) && JSON.stringify(selDl.args.p_boxes) === JSON.stringify(['inbound 9\u0001B2']), JSON.stringify(selDl));
  await page.selectOption('#wsDataStatus', 'Closed'); await wait(400);
  ok('changing a filter clears the selection (it is a different set of boxes)', !/selected/.test(await page.textContent('#wsDataSel')));
  await page.selectOption('#wsDataStatus', ''); await wait(300);
  await page.click('#wsDataList [data-ws-bsel]'); await wait(200);
  await page.click('[data-ws-page="data:next"]').catch(() => {});
  await page.click('[data-ws="sel-clear"]'); await wait(200);
  ok('Clear selection empties it', !/selected/.test(await page.textContent('#wsDataSel')) && (await page.$$('#wsDataList [data-ws-bsel]:checked')).length === 0);
  await page.click('#wsDataList [data-ws-bsel]'); await wait(200);
  await page.evaluate(() => { window.__rpcLog = []; });
  await page.click('[data-ws="sel-delete"]'); await wait(200);
  ok('Delete selected names the selected boxes and asks for one confirmation', await page.evaluate(() => /1 selected boxes/.test(document.getElementById('wsDialogBody').textContent) && /Inbound 9 \/ B2/.test(document.getElementById('wsDialogBody').textContent) && !document.getElementById('wsDialogOk').disabled));
  await page.click('#wsDialogOk'); await wait(800);
  const selDel = await page.evaluate(() => ({ args: window.__wsDeleteArgs, order: (() => { const l = window.__rpcLog; return l.findIndex(x => x.name === 'ws_data_rows') < l.findIndex(x => x.name === 'ws_data_delete'); })(), left: (window.__wsData || []).length }));
  ok('...it downloads first, then deletes only that box (the other stays)', selDel.order && JSON.stringify(selDel.args.p_boxes) === JSON.stringify(['inbound 9\u0001B2']) && selDel.left === 1, JSON.stringify(selDel));
  ok('...and the list shows the remaining box with nothing selected', /Inbound 8/.test(await page.textContent('#wsDataList')) && !/Inbound 9/.test(await page.textContent('#wsDataList')) && !/selected/.test(await page.textContent('#wsDataSel')));
  await page.evaluate(() => {
    const at = (m) => new Date(Date.now() - m * 60000).toISOString();
    window.__wsData = [{ box: 'B2', job: 'Inbound 9', person: 'Ravi', status: 'Closed', items: 5, last_at: at(4) }, { box: 'B1', job: 'Inbound 8', person: 'Sana', status: 'Open', items: 3, last_at: at(9) }];
    window.__wsRows = [{ id: 'a1', scanned_at: at(9), person: 'Sana', job: 'Inbound 8', box: 'B1', barcode: '1', qty: 3, status: 'Open', extra: null }, { id: 'a2', scanned_at: at(4), person: 'Ravi', job: 'Inbound 9', box: 'B2', barcode: '2', qty: 5, status: 'Closed', extra: null }];
  });
  await page.selectOption('#wsDataRange', '30d'); await page.selectOption('#wsDataRange', 'all'); await wait(400);
  await page.selectOption('#wsDataRange', 'all'); await wait(300);
  await page.evaluate(() => { window.__files.length = 0; });
  await page.click('[data-ws="data-download"]'); await wait(600);
  ok('Download everything that matches uses the same filters and writes the file', await page.evaluate(() => window.__files.length === 1 && /^team_data_/.test(window.__files[0])));
  await page.click('[data-ws="data-delete"]'); await wait(200);
  ok('Delete from Data names what will go, with the counts', await page.evaluate(() => /Box-Item Scan/.test(document.getElementById('wsDialogBody').textContent) && /2 boxes, 8 units/.test(document.getElementById('wsDialogBody').textContent)));
  await page.click('#wsDialogOk'); await wait(700);
  ok('...then it deletes and the list is empty', /Deleted 2/.test(await page.textContent('#wsStatus')) && /No data matches/.test(await page.textContent('#wsDataList')));
  // People
  await page.click('[data-ws-go="people"]:visible'); await wait(400);
  ok('People lists labourers and Google members together with jobs and totals', /Ravi/.test(await page.textContent('#wsPeopleList')) && /Priya/.test(await page.textContent('#wsPeopleList')) && /Inbound 9/.test(await page.textContent('#wsPeopleList')));
  ok('a Google member can be removed, yourself cannot', (await page.$$('[data-ws-pmember]')).length === 1);
  await page.click('[data-ws-ptype="labourer"]'); await wait(300);
  ok('the type filter works', !/Priya/.test(await page.textContent('#wsPeopleList')) && /Ravi/.test(await page.textContent('#wsPeopleList')));
  await page.evaluate(() => { window.__renamed = []; const rpc = supabaseClient.rpc.bind(supabaseClient); });
  await page.evaluate(() => { window.prompt = () => 'Ravi K'; window.__labourers = [{ id: 'op1', name: 'Ravi' }, { id: 'op1b', name: 'ravi' }]; });
  await page.click('[data-ws-prename="0"]'); await wait(300);
  ok('renaming a labourer renames every handheld of that person', await page.evaluate(() => window.__labourers.every(o => o.name === 'Ravi K')));
  await page.click('[data-ws-pdata="0"]'); await wait(500);
  ok('View data jumps to Data filtered to that person', await page.evaluate(() => WS.section === 'data' && WS.data.person === 'Ravi') && /Ravi/.test(await page.textContent('#wsDataChips')));
  // Overview
  await page.evaluate(() => { window.__wsOverview = { active_jobs: 14, stopped_jobs: 52, people_now: 22, units_today: 18420, boxes_today: 312, top_jobs: [{ job: 'Team A', units: 9640 }, { job: 'Team B', units: 7310 }], idle_jobs: [{ id: 'LD', job: 'Inbound 7', tool: 'boxScanner', last_scan_at: new Date(Date.now() - 50 * 3600000).toISOString(), created_at: new Date(Date.now() - 80 * 3600000).toISOString() }], idle_total: 3, quiet_people: 2 }; });
  await page.click('[data-ws-go="overview"]:visible'); await wait(500);
  const ov = await page.textContent('#wsOv');
  ok('Overview shows today\'s totals', /14/.test(ov) && /22/.test(ov) && /18,420/.test(ov) && /312/.test(ov) && /Team A/.test(ov) && /9,640/.test(ov), ov.slice(0, 200));
  ok('...and what needs attention: idle jobs (with how long), more idle jobs, quiet people, stopped jobs', /Inbound 7 has had no scans for 2 days/.test(ov) && /2 more idle jobs/.test(ov) && /2 labourer/.test(ov) && /52 stopped/.test(ov), ov);
  await page.click('.ws-alert [data-ws-open]'); await wait(500);
  ok('an idle job in the alerts opens that job', /Inbound 7/.test(await page.textContent('.ws-head h3')));
  ok('the Jobs count shows in the navigation', /14/.test(await page.textContent('#wsNav')));
  await page.click('#wsCloseBtn');
  ok('the ✕ closes the workspace', await page.evaluate(() => !document.getElementById('wsRoot').classList.contains('active') && !document.body.classList.contains('ws-open')));

  // --- 10. guide ---
  await page.evaluate(() => openWorkspace('jobs')); await wait(300);
  await page.click('#wsHelpBtn');
  const g = await page.evaluate(() => ({ open: document.getElementById('helpModal').classList.contains('active'), title: document.getElementById('helpTitle').textContent, steps: document.querySelectorAll('#helpBody ol li').length }));
  ok('the "?" in the workspace opens its guide (English)', g.open && /Team & Data/.test(g.title) && g.steps === 7, JSON.stringify(g));
  await page.evaluate(() => { AppLang.set('ar'); helpShow('workspace'); });
  const ga = await page.evaluate(() => ({ title: document.getElementById('helpTitle').textContent, rtl: document.getElementById('helpBody').dir, steps: document.querySelectorAll('#helpBody ol li').length }));
  ok('...and in Arabic, right-to-left, with the same seven steps', /[؀-ۿ]/.test(ga.title) && ga.rtl === 'rtl' && ga.steps === 7, JSON.stringify(ga));
  await page.evaluate(() => { document.getElementById('helpCloseBtn').click(); });
  ok('Arabic: tool names in the workspace are Arabic', await page.evaluate(() => /[؀-ۿ]/.test(opToolName('boxScanner')) && [...document.querySelectorAll('#wsJobTool option')].slice(1).every(o => /[؀-ۿ]/.test(o.textContent))));
  await page.evaluate(() => { AppLang.set('en'); document.getElementById('wsCloseBtn').click(); helpShow('boxScanner'); });
  ok('the guide title names the tool in the guide language', /Box-Item Scan/.test(await page.textContent('#helpTitle')));
  await page.evaluate(() => { document.getElementById('helpCloseBtn').click(); });
  ok('both tool guides tell labourers the Remark is the job name', await page.evaluate(() => ['boxScanner', 'yearSegregate'].every(id => ['en', 'ar'].every(l => HELP[id][l].tips.some(x => /QR/.test(x))))));
  await page.evaluate(() => { document.getElementById('helpCloseBtn').click(); AppLang.set('en'); });

  ok('no content-security-policy violations', (await page.evaluate(() => window.__csp.length)) === 0);
  const fails = report(log, errors);
  await stop(ctx);
  process.exit(fails ? 1 : 0);
})();
