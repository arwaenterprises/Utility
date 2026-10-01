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
check('every js file is loaded by index.html', jsFiles.every(f => tags.some(t => t.file === 'js/' + f)), jsFiles.filter(f => !tags.some(t => t.file === 'js/' + f)).join());
const shell = [...sw.matchAll(/'\.\/(js\/[^']+)'/g)].map(m => m[1]);
check('service worker caches every script', tags.every(t => shell.includes(t.file)), tags.filter(t => !shell.includes(t.file)).map(t => t.file).join());
check('service worker lists no missing files', shell.every(f => fs.existsSync(path.join(APP, f))), shell.filter(f => !fs.existsSync(path.join(APP, f))).join());

// 3. Things that were removed must stay removed.
const appText = ['index.html', 'style.css', 'sw.js', ...jsFiles.map(f => 'js/' + f)].map(f => fs.readFileSync(path.join(APP, f), 'utf8')).join('\n');
for (const word of ['photoCapture', 'GOOGLE_SCRIPT_URL', 'PC_SCRIPT_URL', 'YS_SCRIPT_URL', 'ADMIN_CODE', 'script.google.com']) {
  check('no leftover: ' + word, !appText.includes(word));
}

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
