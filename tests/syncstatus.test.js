// Wording rules of the sync status line (pure function - no browser needed).
const SyncStatus = require('../Utility App/js/syncstatus.js');

let failures = 0, passed = 0;
const ok = (name, cond, extra) => { if (cond) passed++; else failures++; console.log((cond ? 'PASS ' : 'FAIL ') + name + (!cond && extra !== undefined ? '  -> ' + extra : '')); };
const MIN = 60000, now = 1_800_000_000_000;
const d = (s) => SyncStatus.describe({ now, noun: 'items', online: true, pending: 0, oldestMs: 0, lastOkMs: 0, lastError: '', ...s });

ok('nothing waiting, never uploaded', d({}).text === '✓ Nothing waiting to upload' && d({}).level === 'ok');
ok('nothing waiting, last upload 5 min ago', d({ lastOkMs: now - 5 * MIN }).text === '✓ All uploaded · last upload 5 min ago', d({ lastOkMs: now - 5 * MIN }).text);
ok('"just now" under a minute', /last upload just now/.test(d({ lastOkMs: now - 20000 }).text));
ok('hours and days are spelled out', /2 h ago/.test(d({ lastOkMs: now - 150 * MIN }).text) && /3 d ago/.test(d({ lastOkMs: now - 3 * 24 * 60 * MIN }).text));

const off = d({ pending: 4, online: false, oldestMs: now - 2 * MIN });
ok('offline: says offline, how many wait, and that it is automatic', off.level === 'warn' && /Offline - 4 items waiting/.test(off.text) && /by themselves/.test(off.text) && !off.retry, off.text);
const offLong = d({ pending: 4, online: false, oldestMs: now - 3 * 60 * MIN });
ok('offline for hours is still "offline", not "stuck" (nothing the user can fix)', /Offline/.test(offLong.text) && !/not uploaded for/.test(offLong.text));

const fresh = d({ pending: 3, oldestMs: now - 2 * MIN, lastOkMs: now - 8 * MIN });
ok('online, waiting a short while: "Uploading" (not an alarm)', fresh.level === 'working' && /Uploading 3 items/.test(fresh.text) && /last upload 8 min ago/.test(fresh.text) && fresh.retry, fresh.text);

const stuck = d({ pending: 3, oldestMs: now - 25 * MIN, lastError: 'TypeError: Failed to fetch' });
ok('online but waiting 25 min: stuck warning with duration, reason and retry hint', stuck.level === 'warn' && /3 items not uploaded for 25 min/.test(stuck.text) && /cannot reach the server/.test(stuck.text) && /Tap to retry/.test(stuck.text) && /Nothing is lost/.test(stuck.text) && stuck.retry, stuck.text);
ok('the stuck threshold is 10 minutes', d({ pending: 1, oldestMs: now - 9 * MIN }).level === 'working' && d({ pending: 1, oldestMs: now - 10 * MIN }).level === 'warn');
ok('stuck without a known reason still reads well', !/\(\)/.test(d({ pending: 1, oldestMs: now - 30 * MIN }).text) && /not uploaded for 30 min\./.test(d({ pending: 1, oldestMs: now - 30 * MIN }).text));
ok('long waits are shown in hours', /not uploaded for 3 h/.test(d({ pending: 2, oldestMs: now - 190 * MIN }).text));

ok('error: network problem -> "cannot reach the server"', SyncStatus.friendlyError('Failed to fetch') === 'cannot reach the server' && SyncStatus.friendlyError('NetworkError when attempting to fetch resource.') === 'cannot reach the server');
ok('error: expired login -> sign in again', /sign out and sign in again/.test(SyncStatus.friendlyError('JWT expired')));
ok('error: permission problem -> says the team may have changed', /team may have changed/.test(SyncStatus.friendlyError('new row violates row-level security policy')));
ok('error: unknown messages are kept but shortened', SyncStatus.friendlyError('x'.repeat(100)).length === 60 && SyncStatus.friendlyError('') === '');

const el = { textContent: '', className: '', title: '' };
SyncStatus.render(el, { now, noun: 'scans', online: true, pending: 2, oldestMs: now - 30 * MIN, lastError: '' });
ok('render sets text, a warn class, tappable and a tooltip', /2 scans not uploaded/.test(el.textContent) && /warn/.test(el.className) && /tappable/.test(el.className) && /Tap to retry/.test(el.title), el.className);

console.log(`${passed} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
