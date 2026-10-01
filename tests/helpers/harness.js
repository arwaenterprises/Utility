// Shared test harness: serves the real app from "Utility App/" exactly as Netlify would
// (including the Content-Security-Policy from netlify.toml, ENFORCED so any code the policy
// would block fails the tests), blocks the internet, and injects an in-memory Supabase.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..', '..');
const APP = path.join(ROOT, 'Utility App');
const MOCK = fs.readFileSync(path.join(__dirname, 'mock-supabase.js'), 'utf8');
const XLSX_SRC = fs.readFileSync(require.resolve('xlsx/dist/xlsx.full.min.js'), 'utf8');

function readCsp() {
  const toml = fs.readFileSync(path.join(ROOT, 'netlify.toml'), 'utf8');
  const m = toml.match(/Content-Security-Policy(?:-Report-Only)? = "([^"]+)"/);
  if (!m) throw new Error('No Content-Security-Policy found in netlify.toml');
  return m[1];
}

async function start() {
  const csp = readCsp();
  const server = http.createServer((req, res) => {
    let f = path.join(APP, decodeURIComponent(req.url.split('?')[0]));
    if (f.endsWith(path.sep)) f += 'index.html';
    if (!f.startsWith(APP)) { res.writeHead(403); return res.end(); }
    fs.readFile(f, (err, data) => {
      if (err) { res.writeHead(404); return res.end(); }
      const types = { '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png',
                      '.webmanifest': 'application/manifest+json', '.json': 'application/json' };
      const type = types[path.extname(f)] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': type, 'Content-Security-Policy': csp });
      res.end(data);
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  return { server, browser, port };
}

// Opens the app with the mock backend. Returns { page, errors, close }.
async function openApp(ctx, viewport) {
  const page = await ctx.browser.newPage({ viewport: viewport || { width: 420, height: 800 } });
  const errors = [];
  page.on('pageerror', e => errors.push('JS error: ' + e.message));
  // Block the internet (CDN libraries fail to load here; SheetJS is served from node_modules instead).
  await page.route(/^(?!http:\/\/127\.0\.0\.1).*/, r => /xlsx/.test(r.request().url())
    ? r.fulfill({ contentType: 'text/javascript', body: XLSX_SRC })
    : r.abort());
  await page.addInitScript(MOCK);
  await page.addInitScript(() => {
    window.__csp = [];
    document.addEventListener('securitypolicyviolation', e => window.__csp.push(e.violatedDirective + ' ' + e.blockedURI));
  });
  await page.goto(`http://127.0.0.1:${ctx.port}/index.html`);
  await page.waitForTimeout(400);
  return { page, errors };
}

// Prints the PASS/FAIL lines a page-side test returned ([{pass, name, extra}]) and
// returns the number of failures. Page JS errors count as failures too.
function report(log, errors) {
  let failures = 0;
  for (const r of log) {
    if (!r.pass) failures++;
    console.log((r.pass ? 'PASS ' : 'FAIL ') + r.name + (r.extra ? '  -> ' + String(r.extra).slice(0, 220) : ''));
  }
  for (const e of errors || []) { failures++; console.log('FAIL ' + e); }
  console.log(`${log.length - (log.filter(r => !r.pass).length)} passed, ${failures} failed`);
  return failures;
}

async function stop(ctx) { await ctx.browser.close(); ctx.server.close(); }

module.exports = { start, openApp, report, stop };
