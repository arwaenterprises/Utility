// Fast checks that need no browser: syntax, script / cache wiring, leftovers, secrets, headers,
// and "did you bump the cache version?" (pass BASE_SHA to compare against the previous commit).
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const APP = path.join(ROOT, 'Utility App');
let failures = 0;
const check = (name, cond, extra) => { if (!cond) failures++; console.log((cond ? 'PASS ' : 'FAIL ') + name + (!cond && extra ? '  -> ' + extra : '')); };

const jsFiles = fs.readdirSync(path.join(APP, 'js')).filter(f => f.endsWith('.js'));
const html = fs.readFileSync(path.join(APP, 'index.html'), 'utf8');
const sw = fs.readFileSync(path.join(APP, 'sw.js'), 'utf8');

// 1. Every JS file parses.
for (const f of [...jsFiles.map(f => path.join('js', f)), 'sw.js']) {
  let err = '';
  try { execSync(`node --check "${path.join(APP, f)}"`, { stdio: 'pipe' }); } catch (e) { err = String(e.stderr).split('\n').slice(0, 3).join(' '); }
  check('syntax: ' + f, !err, err);
}

// 2. index.html script tags: files exist, one shared ?v= number, and all are cached by the service worker.
const tags = [...html.matchAll(/<script src="(js\/[^"?]+)\?v=(\d+)"><\/script>/g)].map(m => ({ file: m[1], v: m[2] }));
check('index.html loads app scripts', tags.length >= 8, tags.length);
check('every script file exists', tags.every(t => fs.existsSync(path.join(APP, t.file))), tags.filter(t => !fs.existsSync(path.join(APP, t.file))).map(t => t.file).join());
check('all script tags use the same ?v= number', new Set(tags.map(t => t.v)).size === 1, [...new Set(tags.map(t => t.v))].join());
const swVersionNum = Number((sw.match(/CACHE_VERSION\s*=\s*'ak-utility-v(\d+)'/) || [])[1]);
check('sw.js CACHE_VERSION number equals the ?v= number on the script tags (the in-app "new version" check compares them)', tags.length > 0 && tags.every(t => Number(t.v) === swVersionNum), `sw=${swVersionNum} tags=${[...new Set(tags.map(t => t.v))].join()}`);
check('every js file is loaded by index.html', jsFiles.every(f => tags.some(t => t.file === 'js/' + f)), jsFiles.filter(f => !tags.some(t => t.file === 'js/' + f)).join());
const shell = [...sw.matchAll(/'\.\/(js\/[^']+)'/g)].map(m => m[1]);
check('service worker caches every script', tags.every(t => shell.includes(t.file)), tags.filter(t => !shell.includes(t.file)).map(t => t.file).join());
check('service worker lists no missing files', shell.every(f => fs.existsSync(path.join(APP, f))), shell.filter(f => !fs.existsSync(path.join(APP, f))).join());

// 2b. Installable app (PWA): manifest + icons exist, are valid, are linked from index.html and cached by the service worker.
let manifest = null;
try { manifest = JSON.parse(fs.readFileSync(path.join(APP, 'manifest.webmanifest'), 'utf8')); } catch (e) { /* reported below */ }
check('manifest.webmanifest exists and is valid JSON', !!manifest);
if (manifest) {
  check('manifest: name, short_name, start_url, standalone display', !!manifest.name && !!manifest.short_name && !!manifest.start_url && manifest.display === 'standalone');
  check('manifest: theme and background colours', /^#[0-9a-f]{6}$/i.test(manifest.theme_color || '') && /^#[0-9a-f]{6}$/i.test(manifest.background_color || ''));
  const pngSize = f => { const b = fs.readFileSync(path.join(APP, f)); return b.readUInt32BE(16) + 'x' + b.readUInt32BE(20); };
  for (const icon of manifest.icons || []) {
    const exists = fs.existsSync(path.join(APP, icon.src));
    check(`manifest icon ${icon.src} exists with the declared size (${icon.sizes}, ${icon.purpose})`, exists && pngSize(icon.src) === icon.sizes, exists ? pngSize(icon.src) : 'missing');
  }
  const has = (size, purpose) => (manifest.icons || []).some(i => i.sizes === size && i.purpose === purpose);
  check('manifest has 192 and 512 icons plus a maskable 512 icon', has('192x192', 'any') && has('512x512', 'any') && has('512x512', 'maskable'));
  check('service worker caches the manifest and every manifest icon', sw.includes('manifest.webmanifest') && (manifest.icons || []).every(i => sw.includes(i.src)));
}
check('index.html links the manifest, favicon, apple-touch-icon and theme colour', html.includes('rel="manifest"') && html.includes('rel="icon"') && html.includes('rel="apple-touch-icon"') && /name="theme-color"/.test(html));
for (const f of ['icons/apple-touch-icon.png', 'icons/favicon.svg', 'icons/icon-32.png']) check('icon file exists: ' + f, fs.existsSync(path.join(APP, f)));

// 3. Things that were removed must stay removed.
const appText = ['index.html', 'style.css', 'sw.js', ...jsFiles.map(f => 'js/' + f)].map(f => fs.readFileSync(path.join(APP, f), 'utf8')).join('\n');
for (const word of ['photoCapture', 'GOOGLE_SCRIPT_URL', 'PC_SCRIPT_URL', 'YS_SCRIPT_URL', 'ADMIN_CODE', 'script.google.com', 'ad-slot', 'adSlotBottom', 'delete_my_account', 'deleteAccount', 'wipeLocalDataForUser']) {
  check('no leftover: ' + word, !appText.includes(word));
}

// 3b. Usage statistics: every tracked action is still wired into its tool (a missing call would silently
//     leave a hole in the weekly report), and every pair is one the database accepts.
const usageWiring = {
  'boxScanner.js': ["Usage.log('box_scanner', 'box_closed'"],
  'yearSegregate.js': ["Usage.log('year_season', 'box_closed'"],
  'itemBarcode.js': ["Usage.log('item_barcode', 'print_job', 1, qty)", "Usage.log('item_barcode', 'print_job', 1, totalLabels)"],
  'boxCode.js': ["Usage.log('box_code', 'print_job'"],
  'boxSegregate.js': ["Usage.log('box_segregate', row ?", "Usage.log('box_segregate_pallet', 'box_scanned'", "Usage.log('box_segregate_pallet', 'box_duplicate'", "Usage.log('box_segregate_pallet', 'box_not_found'"],
  'priceCheck.js': ["Usage.log('price_check', row ?"],
};
for (const [file, needles] of Object.entries(usageWiring)) {
  const src = fs.readFileSync(path.join(APP, 'js', file), 'utf8');
  for (const n of needles) check(`usage logged in ${file}: ${n.slice(0, 48)}`, src.includes(n));
}
const schemaText = fs.readFileSync(path.join(ROOT, 'supabase', 'schema.sql'), 'utf8');
const allowed = new Set([...schemaText.matchAll(/'([a-z_]+\/[a-z_]+)'/g)].map(m => m[1]));
const used = new Set([...appText.matchAll(/Usage\.log\('([a-z_]+)',\s*(?:'([a-z_]+)'|[^,]*\?\s*'([a-z_]+)'\s*:\s*'([a-z_]+)')/g)].flatMap(m => m[2] ? [m[1] + '/' + m[2]] : [m[1] + '/' + m[3], m[1] + '/' + m[4]]));
check('every logged tool/action is accepted by log_usage() in schema.sql', used.size >= 9 && [...used].every(u => allowed.has(u)), [...used].filter(u => !allowed.has(u)).join());

// 4. Secrets: only the public anon key may ever be in the published site.
check('no service_role key in the published site', !/service_role/i.test(appText) && !/"role":"service_role"/.test(appText));
const keyMatch = appText.match(/SUPABASE_ANON_KEY:\s*'([^']+)'/);
if (keyMatch) {
  const payload = JSON.parse(Buffer.from(keyMatch[1].split('.')[1], 'base64').toString());
  check('Supabase key in config is the anon (public) key', payload.role === 'anon', payload.role);
}
check('internal files are not in the published folder', !fs.readdirSync(APP).some(f => /\.(bak|txt|xlsx)$/i.test(f)), fs.readdirSync(APP).join());

// 5. Security headers stay in place.
const toml = fs.readFileSync(path.join(ROOT, 'netlify.toml'), 'utf8');
check('netlify.toml: X-Frame-Options', /X-Frame-Options\s*=\s*"DENY"/.test(toml));
check('netlify.toml: manifest served as application/manifest+json', /for = "\/manifest\.webmanifest"[\s\S]*?application\/manifest\+json/.test(toml));
check('netlify.toml: nosniff', /X-Content-Type-Options\s*=\s*"nosniff"/.test(toml));
check('netlify.toml: Content-Security-Policy present', /Content-Security-Policy(-Report-Only)?\s*=/.test(toml));

// 6. Cache version bump: any change inside "Utility App/" (other than sw.js itself) needs a new CACHE_VERSION,
//    otherwise tablets keep running the old files.
const version = s => (s.match(/CACHE_VERSION\s*=\s*'([^']+)'/) || [])[1];
const base = process.env.BASE_SHA;
if (base && !/^0+$/.test(base)) {
  let changed = [];
  let baseSw = '';
  try {
    changed = execSync(`git diff --name-only ${base} HEAD -- "Utility App"`, { cwd: ROOT }).toString().split('\n').filter(f => f && !f.endsWith('/sw.js'));
    baseSw = execSync(`git show ${base}:"Utility App/sw.js"`, { cwd: ROOT }).toString();
  } catch (e) { console.log('NOTE could not compare with ' + base + ' (' + String(e.message).split('\n')[0] + ')'); }
  if (baseSw) check('cache version bumped when the app changed', changed.length === 0 || version(baseSw) !== version(sw), `${changed.length} app file(s) changed but CACHE_VERSION is still ${version(sw)}`);
} else {
  console.log('NOTE BASE_SHA not set - skipping the cache-version-bump check');
}

console.log(failures ? `\n${failures} static check(s) FAILED` : '\nAll static checks passed');
process.exit(failures ? 1 : 0);
