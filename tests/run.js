// One command for everything:  npm test
// Runs the static checks, the browser tests and (when a Postgres is reachable) the database tests.
const { spawnSync } = require('child_process');
const path = require('path');

const root = path.join(__dirname, '..');
const steps = [
  ['Static checks', 'node', ['tests/static-checks.js']],
  ['App: lists, Box Segregate, Price Check, Year/Season, Team, security policy', 'node', ['tests/app.test.js']],
  ['App: Box Scanner offline sync and Reset', 'node', ['tests/scanner.test.js']],
  ['App: every tool opens', 'node', ['tests/smoke.test.js']],
  ['App: Item Barcode (shorter bars, Add text)', 'node', ['tests/itembarcode.test.js']],
  ['App: Team QR links (labourer join, single tool, switched-off job)', 'node', ['tests/operator.test.js']],
  ['App: camera scanner (stays open, torch, vibration)', 'node', ['tests/camera.test.js']],
  ['Sync status wording', 'node', ['tests/syncstatus.test.js']],
];

const hasPsql = spawnSync('psql', ['--version'], { stdio: 'ignore' }).status === 0;
const dbUp = hasPsql && spawnSync('psql', ['-d', 'postgres', '-Atc', 'select 1'], { stdio: 'ignore' }).status === 0;
if (dbUp) steps.push(['Database: schema + access rules', 'bash', ['tests/sql/run.sh']]);

const failed = [];
for (const [name, cmd, args] of steps) {
  console.log(`\n=== ${name} ===`);
  const r = spawnSync(cmd, args, { cwd: root, stdio: 'inherit' });
  if (r.status !== 0) failed.push(name);
}
if (!dbUp) console.log('\nNOTE: database tests skipped (no reachable Postgres). Set PGHOST/PGPORT/PGUSER to run them: npm run test:sql');
console.log(failed.length ? `\nFAILED: ${failed.join('; ')}` : '\nALL TESTS PASSED');
process.exit(failed.length ? 1 : 0);
