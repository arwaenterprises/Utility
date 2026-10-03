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
    form: document.getElementById('joinForm').style.display, msg: document.getElementById('joinMsg').textContent, accounts: document.getElementById('accountBtn').classList.contains('show')
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
    back: getComputedStyle(document.getElementById('appBackBtn')).display, acct: getComputedStyle(document.getElementById('accountBtn')).display,
    bar: document.getElementById('opBarJob').textContent, who: document.getElementById('opBarWho').textContent,
    remarkCard: document.getElementById('scannerRemarkCard').style.display, header: document.getElementById('headerUser').textContent
  }));
  ok('joining signed in anonymously (once) and joined with the trimmed name', s.joined && s.joined.name.trim() === 'Ravi' && s.joined.user === 'anon1', JSON.stringify(s.joined));
  ok('the device now shows only the Box-Item Scan tool', s.screen === 'appScreen' && s.app === 'boxScanner', s.screen + ' ' + s.app);
  ok('no back button and no user-management button', s.back === 'none' && s.acct === 'none', s.back + ' ' + s.acct);
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

  ok('no content-security-policy violations', (await page.evaluate(() => window.__csp.length)) === 0);
  const fails = report(log, errors);
  await stop(ctx);
  process.exit(fails ? 1 : 0);
})();
