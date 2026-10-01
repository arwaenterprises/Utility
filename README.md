# Utility

Warehouse utility app for scanning and sorting boxes (Box Scanner, Box Segregate, Price Check,
Year/Season Sort, Item Barcode, Print Box Label). Hosted on Netlify (publishes the `Utility App/`
folder), backed by Supabase (`supabase/schema.sql`). See `ROADMAP.md` for decisions, status and
what is pending.

## Folders

| Folder | What it is |
|---|---|
| `Utility App/` | The website itself (this is the only folder Netlify publishes) |
| `supabase/schema.sql` | The whole database: tables, access rules, functions. Safe to re-run in the Supabase SQL editor |
| `supabase/usage_queries.sql` | Ready-made queries to see who used the app and how much (run in the Supabase SQL editor) |
| `tests/` | Automated tests (never published) |
| `legacy/` | Old files kept for reference (old Apps Script, backups); not published |

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

## Releasing a change

1. Change the app files in `Utility App/`.
2. **Bump the version** in two places: the `?v=` number on every `<script>` tag in `index.html`, and
   `CACHE_VERSION` in `sw.js` - otherwise devices keep running the old files. The tests check this.
3. If `supabase/schema.sql` changed, re-run it in the Supabase SQL editor.
4. Push to `saas-pilot`; Netlify deploys it automatically.
