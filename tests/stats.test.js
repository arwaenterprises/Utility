// Weekly report: the numbers, the windows, the CSV, and the email (sent to a fake in-memory mailbox).
const { buildReport, windows, sendReport, sampleData, addDays } = require('../stats/weekly-report');
const nodemailer = require('nodemailer');

let failures = 0, passed = 0;
const ok = (name, cond, extra) => { if (cond) passed++; else failures++; console.log((cond ? 'PASS ' : 'FAIL ') + name + (!cond && extra !== undefined ? '  -> ' + extra : '')); };

(async () => {
  const win = windows('2026-10-01');
  ok('window: the 7 complete days before today', win.thisFrom === '2026-09-24' && win.thisTo === '2026-09-30', JSON.stringify(win));
  ok('window: compared with the 7 days before', win.prevFrom === '2026-09-17' && win.prevTo === '2026-09-23');
  ok('addDays crosses month ends', addDays('2026-03-01', -1) === '2026-02-28' && addDays('2026-12-31', 1) === '2027-01-01');

  const r = buildReport({ ...sampleData(win), win });
  const act = k => r.activity.find(a => a.key === k);
  ok('boxes closed adds up across days and users (12+9+3)', act('box_scanner/box_closed').now === 24, act('box_scanner/box_closed').now);
  ok('... with the items inside them (340+260+75)', act('box_scanner/box_closed').detail === '675 items', act('box_scanner/box_closed').detail);
  ok('last week is compared (10 -> +140%)', act('box_scanner/box_closed').before === 10 && act('box_scanner/box_closed').change === '+140%', act('box_scanner/box_closed').change);
  ok('labels printed counts labels, not print jobs', act('item_barcode/print_job').now === 120 && act('item_barcode/print_job').detail === '3 print jobs');
  ok('a metric with no history shows "new"', act('year_season/box_closed').change === 'new');
  ok('rows from 20 days ago are not in this week', act('box_scanner/box_closed').now === 24);
  ok('active users: 3 this week, 2 last week', r.head.activeThis === 3 && r.head.activePrev === 2, JSON.stringify(r.head));
  ok('registered / new users', r.head.registered === 4 && r.head.newUsers === 1);
  ok('headline totals', r.head.boxesClosed === 31 && r.head.labels === 180 && r.head.lookups === 135 && r.head.pallet === 44, JSON.stringify(r.head));

  const asha = r.users.find(u => u.email === 'asha@acme.com');
  ok('per user: Asha 21 boxes, 600 items, 120 labels, 44 pallet scans', asha.g.bs === 21 && asha.g.bsq === 600 && asha.g.prn === 120 && asha.g.pal === 44, JSON.stringify(asha.g));
  ok('per user: sorted by activity, idle users left out', r.users.length === 3 && r.users[0].total >= r.users[1].total && !r.users.some(u => u.email === 'idle@acme.com'));
  const acme = r.enterprises.find(e => e.name === 'Acme Logistics');
  ok('per enterprise: Acme has 2 active users and 21 Box Scanner boxes', acme.users === 2 && acme.g.bs === 21);
  ok('individuals are grouped as "Individual"', r.enterprises.some(e => e.name === 'Individual' && e.users === 1));

  const lines = r.csv.trim().split('\n');
  ok('CSV has a header and the 30-day daily rows', lines[0] === 'day,user_email,user_name,enterprise,tool,action,events,quantity' && lines.length === 1 + 15, lines.length);
  ok('CSV quotes every field', /^"2026-/.test(lines[1]) && lines[1].includes('"box_scanner"'));
  ok('subject says who/what/when', /2026-09-24 to 2026-09-30/.test(r.subject) && /3 active users/.test(r.subject) && /31 boxes closed/.test(r.subject), r.subject);
  ok('html contains the table and the privacy note', /By user/.test(r.html) && /No scan contents|no scan contents/.test(r.html));

  // names with HTML in them cannot break the email
  const evil = buildReport({ usage: [{ user_id: 'x', day: win.thisTo, tool: 'price_check', action: 'lookup_found', event_count: 1, qty: 0 }], profiles: [{ id: 'x', email: 'e@x.com', display_name: '<script>alert(1)</script>', enterprise_id: null }], enterprises: [], win });
  ok('user names are HTML-escaped', !evil.html.includes('<script>') && evil.html.includes('&lt;script&gt;'));

  // empty week
  const empty = buildReport({ usage: [], profiles: [], enterprises: [], win });
  ok('an empty week still produces a report', /0 active users/.test(empty.subject) && /No activity this week/.test(empty.html));

  // email goes to the right place with the CSV attached (fake transport: nothing leaves this machine)
  const transport = nodemailer.createTransport({ jsonTransport: true });
  const info = await sendReport(r, { SMTP_USER: 'sender@example.com', REPORT_TO: 'owner@example.com' }, transport);
  const mail = JSON.parse(info.message);
  ok('email: recipient, sender and subject', mail.to[0].address === 'owner@example.com' && mail.from.address === 'sender@example.com' && mail.subject === r.subject, JSON.stringify(mail.to));
  ok('email: html + text bodies and the CSV attachment', !!mail.html && !!mail.text && mail.attachments.length === 1 && /usage-2026-09-30\.csv$/.test(mail.attachments[0].filename));

  console.log(`${passed} passed, ${failures} failed`);
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('TEST CRASH', e); process.exit(1); });
