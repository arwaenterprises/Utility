# Utility — Roadmap

A running, numbered backlog of everything discussed for this app, so it isn't just living in chat history. Organized by section; item numbers are stable references, not priority order within a section.

## A. Already done

1. No Dup (duplicate-scan) toggle added to Box Scanner, locked while a box is open, friendly error on a duplicate
2. Nu/AlNu merged into a single toggle (default **Nu**), shows **ALNU** when switched
3. Keyboard-suppression behavior reviewed and confirmed correct (no change needed — `inputmode="none"` already does the job without breaking physical scanner input)
4. Admin Reset password removed from Box Scanner — the Reset button (which exports data first) is the only reset path now
5. Purpose field removed from Box Scanner and Year/Season Sort
6. Store/Staff text removed from Box Scanner's toggle bar, freeing space for more toggles
7. Service worker (`sw.js`) added for faster, automatic updates across devices, with offline fallback
8. Netlify deployment live at `utilityy.netlify.app`

## B. Known pending (security & cleanup)

10. Year/Season Sort's admin reset used a hardcoded password — **fixed**: the hardcoded admin code is gone (`CONFIG.ADMIN_CODE` removed); Reset now follows the real roles (individual clears device + server; enterprise member clears device only; admin resets from the Team console).
11. No security headers (CSP, X-Frame-Options, etc.) configured on Netlify
13. No automated tests exist for this app
14. No roadmap/backlog tracking file existed in the repo — **this file is the fix**

## C. Domain & deployment

15. Custom subdomain: `utility.arwaenterprises.com` — live; HTTPS cert status last noted as deferred, **not reconfirmed since** — verify this is actually issued, don't assume
16. Prove out the new architecture on a clone of the app before touching the live one — current Netlify app (`utilityy.netlify.app`, backed by Google Apps Script) stays untouched and operational as a safety net until the new version is fully proven, then gets retired

## D. SaaS / multi-tenancy — ✅ done (Box Scanner only; other tools still TBD)

17. Convert to multi-tenant SaaS — support ~100–200 users initially, scaling to ~500 — **built**, live on branch `saas-pilot`
18. Migrate database from Google Sheets to Supabase — **done for Box Scanner**: it now reads/writes Supabase directly, no more IndexedDB-then-sync-to-Sheets dual-write. Other tools (Item Barcode, Box Code, Photo Capture, Box Segregate, Price Check, Year/Season Sort) are unchanged, still on the old Apps Script backend — see Phase 3.
19. Two account tiers — **built**: self-serve at signup (Individual vs. Enterprise), enterprise admin invites sub-users by email (invitee clicks link, signs in with Google, auto-joins), admin can cancel a pending invite or remove an active member. An Individual can upgrade to Enterprise via the same "Create an Enterprise" flow.
20. Home screen — **all 7 tiles visible** (Box Scanner, Item Barcode, Print Box Label, Photo Capture, Box Segregate, Price Check, Year/Season Sort). Item Barcode, Box Code and Photo Capture run fully in the browser (settings on-device). Box Segregate, Price Check and Year/Season Sort are now **migrated to Supabase** (section I).
21. Data-isolation gap — **fixed**: `profiles`/`enterprises`/`enterprise_invites`/`scans` tables in `supabase/schema.sql`, with Row-Level Security scoping every table to the caller's own rows or their enterprise's rows. Verified against a local Postgres instance including simulated attacks (privilege escalation via direct column UPDATE, forged `enterprise_id` on insert, cross-tenant reads) — all correctly blocked.
22. Reset-deletes-data — **done**: an Individual's Box Scanner Reset performs a real `DELETE` on the server (not a soft-delete flag) plus clears the device. An Enterprise member's Reset clears the device only (see item 32); the admin's Team console per-member/per-box/bulk "Reset Selected" (item 29) is what deletes enterprise data, using the same download-then-delete pattern.
23. Everything on free tiers — **holding**: Supabase free tier, Netlify, Google OAuth all free as used so far
24. App functions as before through the migration — confirmed by the user in production (real Google sign-in, real scan, real box-close)
25. **Schema — shipped** (`supabase/schema.sql`), matches the originally decided shape plus what building it in practice required:
    - `profiles`, `enterprises`, `enterprise_invites`, `scans` tables as originally decided, RLS as originally decided
    - Plus, added during the build: `current_user_enterprise_id()`, `current_user_is_enterprise_admin()`, `current_user_email()` helper functions; `create_enterprise()`, `accept_enterprise_invite()`, `remove_enterprise_member()` RPCs; `scans.user_id` points at `public.profiles(id)` rather than `auth.users(id)` so PostgREST can auto-embed member names onto scan rows; `team_member_stats()` and `search_team_scans()` RPCs added for the Team console (item 26)
    - Column-level privilege lockdown added beyond the original plan: `tier`/`enterprise_id` on `profiles` can only change via the `SECURITY DEFINER` RPCs above, not by a user directly `UPDATE`-ing their own row

## D2. Team Management console — ✅ done

26. Unified admin console (single `#teamModal`, replacing earlier separate Account-modal team sections and a Team Scans popup): per-member stats (boxes closed, qty scanned) via `team_member_stats()`, members rendered as a spreadsheet-style table (sticky header, alternating rows) instead of a card list
27. Inline, nested expand/collapse (members → boxes → items) with no drill-down popups — the earlier `#boxDetailModal` was removed entirely
28. Server-side search (`search_team_scans()`) across box number, barcode, and user — scales to thousands of rows by computing stats and search in Postgres instead of loading the whole team's scan history into the browser
29. Download icon on every row that holds data (per member, per box, reached either via a member's drill-down or via search results) plus bulk "Download Selected" / "Reset Selected" (reset = download then delete) for checkbox-selected members. Team exports include the **Remark** column, matching the Box Scanner download (also in search results — requires re-running `supabase/schema.sql`, which recreates `search_team_scans()` with `remark`)
30. Single-overlay modal behavior: Account and Team modals no longer stack — opening Team closes Account, closing Team doesn't pop Account back up
31. Verified against a local Postgres instance (6,000 synthetic rows across 5 users: correct aggregates, correct search matches, non-admin callers rejected) and a headless-browser pass over the frontend with mocked data (expand/collapse, selection, per-row and bulk downloads, search grouping)

## D3. Offline support & admin gaps

32. **Real offline support with IndexedDB** — ✅ **completed**, same offline-first model as the `main` branch ("the crispness fix"). Every scan is written to a per-user IndexedDB database first (instant, works with no connection); closing a box marks its scans pending and a background sync pushes them to Supabase every 10s (and immediately on reconnect or box close). Sync is an `upsert` on `scans.scan_uid` (a UUID generated once at scan time), so a retried batch never duplicates rows; a Web Lock keeps a second tab/PWA from syncing at the same time. The "Last 5 Scans" header shows a sync badge (✓ or the number of closed-box scans still pending). On open, the user's own server rows missing on the device are pulled in (new device / pre-offline data). Reset downloads first, then clears. **Individual accounts:** clears the device *and* the server copy (needs a connection). **Enterprise members:** clears only their own device; their rows stay in Supabase until the enterprise admin resets them from the Team console. An enterprise member's Reset is blocked until every closed box has uploaded (sync badge ✓), so nothing the admin should see is lost. **Offline test confirmed working by the user.**
33. Five admin-management gaps, explicitly deferred by the user for a later round: multiple admins per enterprise, an audit trail, invite expiration handling, enterprise settings/rename, billing/seat-count hooks.

## E. Auth — ✅ done

34. Login via Google account (Google OAuth) — **built**, replaces Store ID login entirely on Box Scanner
35. Password reset via Google account OTP — **resolved as moot**: login is pure Google OAuth now, there's no separate app password to reset; Google handles its own account recovery. Nothing further to build here.

## F. Monetization — AdSense

36. Google AdSense account to be added across `arwaenterprises.com` and all its subdomains (this Utility app, plus an "attendance app" mentioned in passing — separate product, not in this repo)
37. App needs ad placements designed in; exact placement/timing strategy TBD beyond the two specifics below
38. Box Scanner: show an ad after a box is closed, during the natural ~5–10 second gap while the user tapes/places the box before scanning the next one — **not** a gate blocking the close-box action itself
39. Desktop layout: the app renders as a centered mobile-width card with empty space on both sides on wide screens — use that space for display ads
40. AdSense is not a near-term priority — explicitly deferred until after the Supabase migration is stable. The core migration (section D) and offline support (item 32) are now built; AdSense stays deferred until the user decides to start it and the migration has had a real-world soak.

## G. Domain compliance (outside this repo)

41. `arwaenterprises.com` is missing a Privacy Policy and Terms of Service page — needed for both AdSense approval and Google OAuth consent screen verification (blocks item 36 and Google OAuth consent screen verification). No About page either (minor). This is work on the main marketing site, not in the `Utility` repo, but flagged here so it isn't lost.

## H. Decisions & follow-ups agreed in review

47. **Phase 3 risks while tools were on the old backend** — ✅ **resolved by the migration (section I)**: no more Apps Script `doPost` / shared Google Sheets for these tools, no hardcoded admin code, and the data is isolated per enterprise / individual via Row-Level Security. The old Apps Script and sheets can be retired (Phase 5) once the lists have been re-uploaded.

42. **Open-box scans live only on the device until the box is closed** — decided: **accepted as normal**. Users must close their boxes; a lost/cleared device loses only the box in progress. Admins see a box in the Team console after it is closed and synced.
43. **Reset behavior** — decided: Individual Reset clears device + server; Enterprise-member Reset clears the device only, server data stays until the admin resets (item 32). Done.
44. **Pilot rollout & real-world testing** — *open.* Offline scanning was tested by the user and works. Still to do: decide the go-live date for `saas-pilot` to pilot users, and run a short real-device pass on the cases only tested with a mock so far — a box closed offline then reconnected, two devices on one account, a member removed from an enterprise while scans are still pending. Automated tests (item 13) would make this repeatable.
45. **Enterprise members can still delete their own rows directly** — *open, security/integrity.* The Reset button no longer deletes an enterprise member's server rows, but Row-Level Security (`scans_delete_own` in `supabase/schema.sql`) still lets any signed-in user delete their own rows by calling the API directly, bypassing the UI. If "data stays until the admin resets it" must be enforced (not just a UI convention), restrict that delete policy to non-enterprise users and let only the enterprise admin delete team rows.
46. **Google sign-in verification & policy pages before scaling** — *open.* Growing to ~100–500 users likely needs the Google OAuth consent screen to be verified/published (I am not certain of the exact current limits for unverified apps — check Google's current documentation). That depends on the Privacy Policy / Terms pages in item 41, so item 41 should be scheduled before the pilot grows, not after.

## I. Phase 3 migration — decisions agreed and ✅ BUILT (Box Segregate, Price Check, Year/Season Sort)

All three tools are off Google Sheets / Apps Script and on Supabase. **Built and tested headlessly (mocked server) and against a local Postgres for the SQL; not yet tested on real devices / live Supabase — the user will test everything together.** Before testing: re-run `supabase/schema.sql` in the Supabase SQL editor (adds `reference_chunks`, `ys_scans`, the upload functions and `team_ys_member_stats()`), then have each admin / individual **upload their lists** (the old Google Sheet data is not migrated automatically).

48. **Shared rules for all reference lists** (Box Segregate box list, Price Check price list, Year/Season item master and PTL config): each **enterprise** owns its own copy, uploaded by its **admin**; members only use it. An **individual** account uploads and uses its own. Isolation between customers via Row-Level Security. Every upload **replaces the whole list** and **deletes the old rows from the database** (done as one all-or-nothing step so a failed upload never leaves a half list). Upload accepts CSV and Excel with the same columns as today. The upload button sits inside each tool, visible to admins/individuals only. The Google Sheet links and `PC_SCRIPT_URL` / `YS_SCRIPT_URL` are dropped.
49. **Lookups run from a copy on the device** (IndexedDB), refreshed every 24 hours or when the user taps Sync — instant and works offline, same offline-first approach as Box Scanner. List sizes not given; build for tens of thousands of rows (Price Check may reach 100,000+) and revisit.
50. **Progress indicator** — wherever there is a Sync or Upload button (Box Segregate, Price Check, Year/Season Sort, and the Box Scanner sync badge) show a **percentage completion indicator** so users can see how long it will take.
51. **Box Segregate tool** — data columns: Box Number, TRN, Increff Order ID, Store Name, Region, Store Code, Brand. See item 53 for the new mode.
52. **Price Check tool** — data columns: Barcode, Current Price, Original Price, Style, Color, Size, Year, Season. Same rules as item 48/49.
53. **Box Segregate — new "Document / Pallet" mode (new feature).** A toggle (styled like No Dup / Nu-AlNu) switches Box Segregate into a second mode and turns the normal lookup off. In this mode alphanumeric box numbers are always accepted and duplicate scans are always blocked (no separate toggles for those). Its own upload list has three fields: **Document Number** (transfer number), **Box Number**, **Store Name** (e.g. Riyadh Park, Jeddah Mall of Arabia) — e.g. 100 boxes across 5 documents, ~20 each; same replace-everything upload rule as item 48. Scanning a box shows which store / document it belongs to so the user places it on that store's pallet; scanning the same box twice is blocked. After segregation a **download** lists which store / document number has which boxes. The user builds their own "error table" from that download — nothing extra is added to it unless requested. *Open: whether a download should also flag boxes never scanned or scanned but not on the list (the user's "error table" wording was unclear from a voice message).*
54. **Year/Season Sort** — two reference lists: **Item master** (Barcode, Year, Season, Brand) and **PTL config** (PTL Number, Season, Year, Year Logic), both under item 48/49. **Scans** work exactly like Box Scanner: saved on the device first, closed PTL boxes sync to Supabase in the background, each user sees their own, the enterprise admin sees the team's Year/Season scans in the Team console and can download / reset them. Enterprise-member Reset clears only their device; admin Reset deletes from the database; individuals clear both. The hardcoded admin code `AK@2026` (items 10, 47) is removed in favor of the real admin role.
55. **AdSense space** — keep layout space for Google AdSense ads on migrated screens (see items 37–39): an ad slot after a box closes, and the empty side space on desktop. Do not use that space for tool UI.
56. **Build summary** (all done): shared module `js/lists.js` (CSV/Excel parsing with loose headers, chunked atomic replace-upload, chunked download with %, per-user device cache, once-a-day auto check); `reference_chunks` table (lists stored as JSON chunks so a 100k-row list is ~50 rows) with RPCs `begin_list_upload` / `append_list_chunk` / `commit_list_upload` (swap in one transaction — a failed upload keeps the old list; only an individual or the enterprise admin may upload; members read only); Box Segregate normal + Pallet mode; Price Check; Year/Season Sort (item master, PTL config, scans → `ys_scans`, Team console section with per-member download and Reset Selected); % progress on Box Segregate, Price Check and Year/Season syncs/uploads and on the Box Scanner / Year-Season sync badges; Google Apps Script URLs and `ADMIN_CODE` removed from the app; cache version `v22`.
57. **Download for AWB generation** — the user's "error table" is **AWB Generation**. The Pallet-mode download is one sheet, one row per scanned box, sorted by document number then store: *Document Number, Store Name, Box Number, Scanned At*. (Which boxes were never scanned is not in the download; add if needed.)
58. **Bug fixed while here:** the Team console's Box Scanner downloads / Reset Selected fetched rows without paging, and Supabase returns at most ~1000 rows per request — a large Reset Selected could have deleted rows that were never exported. Both now page through all rows (`fetchAllPages`).
59. **Behavior notes to test:** (a) Pallet mode scans live on the device (per user) until Reset — they are not uploaded; (b) Year/Season: closed PTL boxes sync to Supabase, enterprise-member Reset clears the device only and is blocked until everything has synced; individual Reset clears device + server; (c) enterprise members cannot delete `ys_scans` rows (RLS), unlike Box Scanner's `scans` table whose `scans_delete_own` policy still allows it (item 45, still open); (d) the Year/Season Store ID / Store Name in exports now come from the signed-in Google account; (e) data in the old per-device Year/Season / Price Check databases is not carried over (new per-user databases).

## Phasing (agreed approach)

1. **Phase 1 — done:** Cloned the app on branch `saas-pilot`, hid every tool tile except Box Scanner, deployed that branch to a second Netlify site, pointed `utility.arwaenterprises.com` at it.
2. **Phase 2 — done:** Supabase migration for Box Scanner — accounts, Google OAuth, Row-Level Security multi-tenancy, data-reset-deletes-data behavior, enterprise invite/accept/remove, and the unified Team Management console (items 17–31). Verified live in production by the user. Offline support (item 32) is now built too. What's left from this phase: the deferred admin-management gaps (item 33).
3. **Phase 3 — built, awaiting user testing:** all six remaining tools are visible, and the three data-dependent tools (Box Segregate incl. new Pallet mode, Price Check, Year/Season Sort) now run on per-tenant Supabase tables with upload / replace-list, offline device copies and % progress (section I).
4. **Phase 4:** Add Google AdSense once the migration is fully stable (items 36–40).
5. **Phase 5:** Retire the old Netlify + Google Apps Script version once the new one is fully proven.

Independent of the phases above: item 41 (Privacy Policy/Terms on the main domain) can be done any time — it isn't blocking any phase.
