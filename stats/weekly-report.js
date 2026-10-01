// ============================================================================
// Weekly usage report - emails the platform owner who did how much last week.
//
//   node stats/weekly-report.js            fetch from Supabase and email the report
//   node stats/weekly-report.js --dry      fetch, print the report and save stats/out/report.html (no email)
//   node stats/weekly-report.js --sample   use made-up data (no Supabase needed) - to preview the layout
//
// Needs these environment variables (GitHub Actions secrets, see stats/README.md):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   read access to usage_daily (the key never goes in the app)
//   REPORT_TO                                  where to send the report
//   SMTP_USER, SMTP_APP_PASSWORD               mailbox that sends it (Gmail app password works, free)
//   SMTP_HOST, SMTP_PORT                       optional, default smtp.gmail.com / 465
// ============================================================================
const fs = require('fs');
const path = require('path');

// ---- what each tracked action means ----------------------------------------------------------
// group: column in the per-user table. main: which number is the headline ('events' | 'qty').
const METRICS = {
  'box_scanner/box_closed':            { label: 'Box Scanner - boxes closed',             group: 'bs',   main: 'events', detail: 'items' },
  'year_season/box_closed':            { label: 'Year/Season - boxes closed',             group: 'ys',   main: 'events', detail: 'items' },
  'item_barcode/print_job':            { label: 'Item Barcode - labels printed',          group: 'prn',  main: 'qty',    detail: 'print jobs' },
  'box_code/print_job':                { label: 'Box Labels - codes printed',             group: 'prn',  main: 'qty',    detail: 'print jobs' },
  'box_segregate/lookup_found':        { label: 'Box Segregate - boxes looked up',        group: 'seg',  main: 'events' },
  'box_segregate/lookup_not_found':    { label: 'Box Segregate - not found',              group: null,   main: 'events' },
  'box_segregate_pallet/box_scanned':  { label: 'Pallet mode - boxes scanned onto pallets', group: 'pal', main: 'events' },
  'box_segregate_pallet/box_duplicate':{ label: 'Pallet mode - duplicate scans',          group: null,   main: 'events' },
  'box_segregate_pallet/box_not_found':{ label: 'Pallet mode - box not found',            group: null,   main: 'events' },
  'price_check/lookup_found':          { label: 'Price Check - lookups',                  group: 'pc',   main: 'events' },
  'price_check/lookup_not_found':      { label: 'Price Check - not found',                group: null,   main: 'events' },
};
const GROUPS = [
  ['bs', 'Box Scanner boxes'], ['bsq', 'Box Scanner items'], ['ys', 'Year/Season boxes'],
  ['prn', 'Labels printed'], ['seg', 'Segregate lookups'], ['pal', 'Pallet scans'], ['pc', 'Price lookups'],
];

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = n => Number(n || 0).toLocaleString('en-US');

// ---- dates -----------------------------------------------------------------------------------
function addDays(ymd, n) { const d = new Date(ymd + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
function riyadhToday() { return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Riyadh' }); }
// The report covers the 7 complete days before today, compared with the 7 days before those.
function windows(today) {
  const end = addDays(today, -1);
  return { thisFrom: addDays(end, -6), thisTo: end, prevFrom: addDays(end, -13), prevTo: addDays(end, -7), csvFrom: addDays(end, -29) };
}

// ---- pure report builder (unit-tested) -------------------------------------------------------
function buildReport({ usage, profiles, enterprises, win }) {
  const byId = new Map(profiles.map(p => [p.id, p]));
  const entName = id => (id && (enterprises.find(e => e.id === id) || {}).name) || 'Individual';
  const inRange = (r, from, to) => r.day >= from && r.day <= to;
  const thisWeek = usage.filter(r => inRange(r, win.thisFrom, win.thisTo));
  const prevWeek = usage.filter(r => inRange(r, win.prevFrom, win.prevTo));

  const tally = rows => {
    const t = {};
    for (const r of rows) {
      const k = r.tool + '/' + r.action;
      t[k] = t[k] || { events: 0, qty: 0 };
      t[k].events += Number(r.event_count); t[k].qty += Number(r.qty);
    }
    return t;
  };
  const tw = tally(thisWeek), tp = tally(prevWeek);
  const main = (t, k) => { const m = METRICS[k]; return t[k] ? t[k][m.main] : 0; };
  const change = (a, b) => (b === 0 ? (a === 0 ? '-' : 'new') : (a >= b ? '+' : '') + Math.round((a - b) / b * 100) + '%');

  const activity = Object.keys(METRICS).map(k => {
    const m = METRICS[k];
    const a = main(tw, k), b = main(tp, k);
    const detail = m.detail && tw[k] ? (m.main === 'events' ? `${num(tw[k].qty)} ${m.detail}` : `${num(tw[k].events)} ${m.detail}`) : '';
    return { key: k, label: m.label, now: a, before: b, change: change(a, b), detail };
  });

  // per user
  const perUser = new Map();
  for (const r of thisWeek) {
    const k = r.tool + '/' + r.action; const m = METRICS[k]; if (!m) continue;
    const u = perUser.get(r.user_id) || { id: r.user_id, g: {}, total: 0 };
    if (m.group) u.g[m.group] = (u.g[m.group] || 0) + Number(r[m.main === 'qty' ? 'qty' : 'event_count']);
    if (k === 'box_scanner/box_closed') u.g.bsq = (u.g.bsq || 0) + Number(r.qty);
    u.total += Number(r.event_count);
    perUser.set(r.user_id, u);
  }
  const users = [...perUser.values()].map(u => {
    const p = byId.get(u.id) || {};
    return { ...u, name: p.display_name || p.email || u.id, email: p.email || '', enterprise: entName(p.enterprise_id) };
  }).sort((a, b) => b.total - a.total);

  // per enterprise
  const perEnt = new Map();
  for (const u of users) {
    const e = perEnt.get(u.enterprise) || { name: u.enterprise, users: 0, g: {} };
    e.users++;
    for (const [g, v] of Object.entries(u.g)) e.g[g] = (e.g[g] || 0) + v;
    perEnt.set(u.enterprise, e);
  }
  const enterprisesOut = [...perEnt.values()].sort((a, b) => b.users - a.users);

  const activeThis = new Set(thisWeek.map(r => r.user_id)).size;
  const activePrev = new Set(prevWeek.map(r => r.user_id)).size;
  const newUsers = profiles.filter(p => p.created_at && p.created_at.slice(0, 10) >= win.thisFrom && p.created_at.slice(0, 10) <= win.thisTo).length;
  const head = {
    registered: profiles.length, activeThis, activePrev, newUsers,
    boxesClosed: main(tw, 'box_scanner/box_closed') + main(tw, 'year_season/box_closed'),
    labels: main(tw, 'item_barcode/print_job') + main(tw, 'box_code/print_job'),
    lookups: main(tw, 'box_segregate/lookup_found') + main(tw, 'price_check/lookup_found'),
    pallet: main(tw, 'box_segregate_pallet/box_scanned'),
  };

  const range = `${win.thisFrom} to ${win.thisTo}`;
  const subject = `Utility weekly stats (${range}): ${head.activeThis} active user${head.activeThis === 1 ? '' : 's'}, ${num(head.boxesClosed)} boxes closed`;

  // CSV of daily rows (last 30 days)
  const csvRows = usage.filter(r => r.day >= win.csvFrom && r.day <= win.thisTo).sort((a, b) => a.day < b.day ? -1 : a.day > b.day ? 1 : 0).map(r => {
    const p = byId.get(r.user_id) || {};
    return [r.day, p.email || r.user_id, p.display_name || '', entName(p.enterprise_id), r.tool, r.action, r.event_count, r.qty];
  });
  const q = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
  const csv = ['day,user_email,user_name,enterprise,tool,action,events,quantity'].concat(csvRows.map(r => r.map(q).join(','))).join('\n') + '\n';

  // text version
  const text = [
    `Utility weekly stats - ${range} (compared with ${win.prevFrom} to ${win.prevTo})`,
    '',
    `Active users: ${head.activeThis} (last week ${head.activePrev}) of ${head.registered} registered; ${head.newUsers} new this week`,
    '',
    ...activity.filter(a => a.now || a.before).map(a => `${a.label}: ${num(a.now)} (last week ${num(a.before)}, ${a.change})${a.detail ? ' - ' + a.detail : ''}`),
    '',
    'By user:',
    ...users.map(u => `  ${u.name} [${u.enterprise}]: ` + GROUPS.filter(([g]) => u.g[g]).map(([g, l]) => `${l} ${num(u.g[g])}`).join(', ')),
  ].join('\n');

  // html
  const th = t => `<th style="text-align:left;padding:6px 8px;background:#8b1a2f;color:#fff;font-size:12px">${esc(t)}</th>`;
  const td = (t, right) => `<td style="padding:6px 8px;border-bottom:1px solid #eee;font-size:13px${right ? ';text-align:right' : ''}">${t}</td>`;
  const table = (heads, rows) => `<table style="border-collapse:collapse;width:100%;margin:6px 0 18px"><tr>${heads.map(th).join('')}</tr>${rows.join('')}</table>`;
  const html = `<div style="font-family:Arial,sans-serif;max-width:760px;color:#222">
    <h2 style="color:#8b1a2f;margin-bottom:2px">Utility - weekly stats</h2>
    <div style="color:#666;font-size:13px">${esc(range)} &nbsp;(compared with ${esc(win.prevFrom)} to ${esc(win.prevTo)})</div>
    <p style="font-size:14px"><b>${head.activeThis}</b> active users (last week ${head.activePrev}) of ${head.registered} registered &middot; ${head.newUsers} new this week<br>
    <b>${num(head.boxesClosed)}</b> boxes closed &middot; <b>${num(head.labels)}</b> labels printed &middot; <b>${num(head.lookups)}</b> lookups &middot; <b>${num(head.pallet)}</b> pallet scans</p>
    <h3>What was done</h3>
    ${table(['Activity', 'This week', 'Last week', 'Change', 'Detail'], activity.filter(a => a.now || a.before).map(a => `<tr>${td(esc(a.label))}${td(num(a.now), true)}${td(num(a.before), true)}${td(esc(a.change), true)}${td(esc(a.detail))}</tr>`))}
    <h3>By user</h3>
    ${users.length ? table(['User', 'Enterprise'].concat(GROUPS.map(g => g[1])), users.map(u => `<tr>${td(esc(u.name) + (u.email && u.email !== u.name ? `<br><span style="color:#888;font-size:11px">${esc(u.email)}</span>` : ''))}${td(esc(u.enterprise))}${GROUPS.map(([g]) => td(u.g[g] ? num(u.g[g]) : '', true)).join('')}</tr>`)) : '<p style="color:#888">No activity this week.</p>'}
    <h3>By enterprise</h3>
    ${enterprisesOut.length ? table(['Enterprise', 'Active users'].concat(GROUPS.map(g => g[1])), enterprisesOut.map(e => `<tr>${td(esc(e.name))}${td(num(e.users), true)}${GROUPS.map(([g]) => td(e.g[g] ? num(e.g[g]) : '', true)).join('')}</tr>`)) : ''}
    <p style="color:#888;font-size:12px">Counts only - no scan contents are recorded. "Labels printed" counts barcodes/codes (not print jobs). The attached CSV has the daily rows for the last 30 days.</p>
  </div>`;

  return { subject, html, text, csv, head, activity, users, enterprises: enterprisesOut, win };
}

// ---- Supabase (service role) -----------------------------------------------------------------
async function fetchAll(base, key, pathAndQuery) {
  const rows = [];
  for (let offset = 0; ; offset += 1000) {
    const url = `${base}/rest/v1/${pathAndQuery}${pathAndQuery.includes('?') ? '&' : '?'}limit=1000&offset=${offset}`;
    const res = await fetch(url, { headers: { apikey: key, Authorization: 'Bearer ' + key } });
    if (!res.ok) throw new Error(`Supabase ${res.status} for ${pathAndQuery.split('?')[0]}: ${(await res.text()).slice(0, 200)}`);
    const page = await res.json();
    rows.push(...page);
    if (page.length < 1000) break;
  }
  return rows;
}

async function loadData(env, win) {
  const base = env.SUPABASE_URL.replace(/\/+$/, ''), key = env.SUPABASE_SERVICE_ROLE_KEY;
  const [usage, profiles, enterprises] = await Promise.all([
    fetchAll(base, key, `usage_daily?select=*&day=gte.${win.csvFrom}&day=lte.${win.thisTo}&order=day.asc,user_id.asc`),
    fetchAll(base, key, 'profiles?select=id,email,display_name,enterprise_id,tier,created_at&order=created_at.asc'),
    fetchAll(base, key, 'enterprises?select=id,name&order=created_at.asc'),
  ]);
  return { usage, profiles, enterprises };
}

// ---- email ------------------------------------------------------------------------------------
async function sendReport(report, env, transport) {
  const t = transport || require('nodemailer').createTransport({
    host: env.SMTP_HOST || 'smtp.gmail.com', port: Number(env.SMTP_PORT || 465), secure: Number(env.SMTP_PORT || 465) === 465,
    auth: { user: env.SMTP_USER, pass: env.SMTP_APP_PASSWORD },
  });
  return t.sendMail({
    from: `"Utility stats" <${env.SMTP_USER}>`, to: env.REPORT_TO, subject: report.subject,
    text: report.text, html: report.html,
    attachments: [{ filename: `utility-usage-${report.win.thisTo}.csv`, content: report.csv, contentType: 'text/csv' }],
  });
}

// ---- sample data (for --sample and tests) ----------------------------------------------------
function sampleData(win) {
  const mk = (user, day, tool, action, c, q) => ({ user_id: user, day, tool, action, event_count: c, qty: q });
  const d = i => addDays(win.thisTo, -i), p = i => addDays(win.prevTo, -i);
  return {
    profiles: [
      { id: 'u1', email: 'asha@acme.com', display_name: 'Asha K', enterprise_id: 'e1', created_at: '2026-01-02T00:00:00Z' },
      { id: 'u2', email: 'omar@acme.com', display_name: 'Omar S', enterprise_id: 'e1', created_at: '2026-01-02T00:00:00Z' },
      { id: 'u3', email: 'solo@mail.com', display_name: 'Solo User', enterprise_id: null, created_at: win.thisFrom + 'T08:00:00Z' },
      { id: 'u4', email: 'idle@acme.com', display_name: 'Idle', enterprise_id: 'e1', created_at: '2026-01-02T00:00:00Z' },
    ],
    enterprises: [{ id: 'e1', name: 'Acme Logistics' }],
    usage: [
      mk('u1', d(0), 'box_scanner', 'box_closed', 12, 340), mk('u1', d(1), 'box_scanner', 'box_closed', 9, 260),
      mk('u1', d(1), 'item_barcode', 'print_job', 3, 120), mk('u1', d(2), 'box_segregate_pallet', 'box_scanned', 44, 44),
      mk('u1', d(2), 'box_segregate_pallet', 'box_duplicate', 2, 0), mk('u1', d(2), 'box_segregate_pallet', 'box_not_found', 1, 0),
      mk('u2', d(0), 'year_season', 'box_closed', 7, 210), mk('u2', d(3), 'box_segregate', 'lookup_found', 80, 0),
      mk('u2', d(3), 'box_segregate', 'lookup_not_found', 4, 0), mk('u2', d(4), 'price_check', 'lookup_found', 55, 0),
      mk('u3', d(5), 'box_code', 'print_job', 2, 60), mk('u3', d(5), 'box_scanner', 'box_closed', 3, 75),
      mk('u1', p(1), 'box_scanner', 'box_closed', 10, 300), mk('u2', p(2), 'box_segregate', 'lookup_found', 60, 0),
      mk('u1', addDays(win.thisTo, -20), 'box_scanner', 'box_closed', 5, 100),
    ],
  };
}

async function main() {
  const args = process.argv.slice(2);
  const win = windows(riyadhToday());
  let data;
  if (args.includes('--sample')) data = sampleData(win);
  else {
    const need = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'].concat(args.includes('--dry') ? [] : ['REPORT_TO', 'SMTP_USER', 'SMTP_APP_PASSWORD']);
    const missing = need.filter(n => !process.env[n]);
    if (missing.length) { console.error('Missing secret(s): ' + missing.join(', ') + '\nSee stats/README.md to set them up.'); process.exit(2); }
    data = await loadData(process.env, win);
  }
  const report = buildReport({ ...data, win });
  console.log(report.text);
  if (args.includes('--dry') || args.includes('--sample')) {
    const out = path.join(__dirname, 'out'); fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(path.join(out, 'report.html'), report.html); fs.writeFileSync(path.join(out, 'usage.csv'), report.csv);
    console.log('\nSaved stats/out/report.html and stats/out/usage.csv (no email sent).');
    return;
  }
  const info = await sendReport(report, process.env);
  console.log('\nEmail sent: ' + (info.messageId || 'ok'));
}

module.exports = { buildReport, windows, sendReport, sampleData, METRICS, addDays };
if (require.main === module) main().catch(e => { console.error('Weekly report failed: ' + e.message); process.exit(1); });
