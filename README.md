# Utility

Warehouse utility app for scanning and sorting boxes (Box-Item Scan, Box Segregate, Price Check,
Year/Season Sort, Item Barcode Print, Box Code Print, Data Management). Hosted on Netlify (publishes the `Utility App/`
folder), backed by Supabase (`supabase/schema.sql`). See `ROADMAP.md` for decisions, status and
what is pending.

## Folders

| Folder | What it is |
|---|---|
| `Utility App/` | The website itself (this is the only folder Netlify publishes) |
| `supabase/schema.sql` | The whole database: tables, access rules, functions. Safe to re-run in the Supabase SQL editor |
| `supabase/usage_queries.sql` | Ready-made queries to see who used the app and how much (run in the Supabase SQL editor) |
| `tests/` | Automated tests (never published) |

## Tests

```
npm install                       # once
npx playwright install chromium   # once (a browser for the app tests)
npm test                          # everything
```

`npm test` runs: static checks (syntax, script / cache wiring, leftovers, secrets, security headers),
browser tests of the real app against an in-memory fake Supabase (list upload / replace / template, sync,
both Box Segregate modes, Price Check, Year/Season Sort, Box Scanner offline sync and Reset, Team console,
Content-Security-Policy enforced), and database tests on a throw-away Postgres (schema runs twice cleanly,
and 36 checks on who may read / write / delete what). The database tests are skipped when no Postgres is
reachable; run them with `PGHOST=... PGUSER=... npm run test:sql`.

GitHub runs the same tests on every push (`.github/workflows/test.yml`). A red check means something that
worked before no longer does - open the failed run to see which line failed.

## Installing the app on a device (PWA)

The site is an installable app: it opens full-screen with its own icon and works offline.
- **Android / Windows / Mac (Chrome or Edge):** open `https://utility.arwaenterprises.com`, sign in, then browser menu (three dots) -> **Install app** (or the install icon in the address bar).
- **iPhone / iPad (Safari):** Share button -> **Add to Home Screen**.
- Updates arrive by themselves the next time the app is opened with internet.
The logo is original artwork in `Utility App/icons/` (`icon.svg` is the master; PNG sizes are generated from it). To use a different logo, replace those files and keep the same file names and sizes (the tests check this).

## Getting a new version onto a device

The app tells the user when a newer version exists (banner at the bottom: **Update now**), and **Account -> Check for updates** does the same on demand. The running version is shown under Account -> App version.
Devices running a version older than v35 do not have that yet - refresh them once by hand:
1. **Make sure everything is uploaded first** (Box Scanner / Year-Season sync badge shows the green tick; the status line says "All uploaded") - clearing a device's storage also removes anything not yet uploaded.
2. **Android (Chrome / installed app):** close the app completely (swipe it away) and open it again with internet on; if still old: Chrome -> open the site in a normal tab -> menu -> Settings -> Site settings -> this site -> **Clear & reset**, or reinstall the app (uninstall, then Chrome menu -> Install app).
3. **iPhone / iPad (home-screen app):** swipe the app away, reopen with internet; if still old: delete the home-screen icon, open the site in Safari, Share -> Add to Home Screen again.
4. **Windows / Mac:** hard refresh (Ctrl+Shift+R / Cmd+Shift+R).

## Releasing a change

1. Change the app files in `Utility App/`.
2. **Bump the version** in two places: the `?v=` number on every `<script>` tag in `index.html`, and
   `CACHE_VERSION` in `sw.js` - otherwise devices keep running the old files. The tests check this.
3. If `supabase/schema.sql` changed, re-run it in the Supabase SQL editor.
4. Push to `saas-pilot`; Netlify deploys it automatically.
