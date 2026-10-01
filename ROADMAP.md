# AK Utility — Roadmap

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

9. Google Apps Script backend (`doPost`) has no authentication — anyone with the script URL can write arbitrary data to the Google Sheet
10. Year/Season Sort's admin reset still uses the same hardcoded-password pattern Box Scanner used to have (not fixed — wasn't in scope when Box Scanner's was removed)
11. No security headers (CSP, X-Frame-Options, etc.) configured on Netlify
12. Store login has no password — by design, confirmed acceptable ("let it be")
13. No automated tests exist for this app
14. No roadmap/backlog tracking file existed in the repo — **this file is the fix**

## C. Domain & deployment

15. Custom subdomain: `utility.arwaenterprises.com`
16. Prove out the new architecture on a clone of the app before touching the live one — current Netlify app (`utilityy.netlify.app`, backed by Google Apps Script) stays untouched and operational as a safety net until the new version is fully proven, then gets retired

## D. SaaS / multi-tenancy

17. Convert to multi-tenant SaaS — support ~100–200 users initially, scaling to ~500
18. Migrate database from Google Sheets to Supabase (or similar free-tier DB), preserving all existing logic/behavior
19. Two account tiers:
    - **Single/individual user** — scans and sees only their own data
    - **Enterprise** — an enterprise admin oversees ~10–15 sub-users under their org, can view all their data, and can reset it
    - **Decided:** self-serve at signup (user picks Individual or Enterprise, no approval needed); enterprise admin adds sub-users via email invite (sub-user clicks link, signs in with Google, auto-joins the enterprise); an Individual user can later upgrade/join an Enterprise (not locked in forever)
20. All logged-in users (either tier) eventually see the same set of tools on the home screen (4–6 tools: Box Scanner, Item Barcode, Box Code, etc. — exact list TBD) — **but during the pilot phase, only Box Scanner is shown; other tiles stay hidden until each is migrated in turn**
21. Fix the current data-isolation gap: today anyone with Google Sheet access can see all users' scanned data mixed together with no separation — Supabase migration must enforce per-user/per-enterprise data scoping (Row-Level Security)
22. When a user or enterprise admin resets their data, it must be **actually deleted** from Supabase (not just hidden/flagged) to keep storage within free-tier limits while scaling toward 500 users
23. Everything must stay on free tiers across all tools/services used
24. App must keep functioning exactly as it does now through the migration
25. **Decided schema (final, ready to implement):**
    - `profiles` — one row per signed-in user: `id`, `email`, `display_name`, `tier` (`individual`/`enterprise_admin`/`enterprise_member`), `enterprise_id` (nullable)
    - `enterprises` — one row per org: `id`, `name`, `admin_user_id`
    - `enterprise_invites` — pending email invites: `id`, `enterprise_id`, `invited_email`, `status`, `token`, `expires_at`
    - `scans` — replaces both IndexedDB and the Google Sheet, same fields the app already uses (`store_id`, `store_name`, `staff_name`, `remark`, `box_number`, `barcode`, `qty`, `box_status`, `timestamp`, `scan_uid`), plus `user_id` and `enterprise_id` for ownership
    - RLS: individuals and enterprise members only see their own `scans`; enterprise admins see every `scans` row tagged with their `enterprise_id`; Reset performs a real `DELETE`, not a soft-delete flag
    - Net effect: replaces the current IndexedDB-then-sync-to-Sheets dual-write complexity with a single direct write to Supabase — simpler than what exists today, not more complex

## E. Auth

25. Login via Google account (Google OAuth)
26. Password reset via Google account OTP — **needs clarification**: if login is pure Google OAuth, there's no separate app password to reset; Google handles its own account recovery. What's actually wanted here needs to be pinned down before building it.

## F. Monetization — AdSense

27. Google AdSense account to be added across `arwaenterprises.com` and all its subdomains (this Utility app, plus an "attendance app" mentioned in passing — separate product, not in this repo)
28. App needs ad placements designed in; exact placement/timing strategy TBD beyond the two specifics below
29. Box Scanner: show an ad after a box is closed, during the natural ~5–10 second gap while the user tapes/places the box before scanning the next one — **not** a gate blocking the close-box action itself
30. Desktop layout: the app renders as a centered mobile-width card with empty space on both sides on wide screens — use that space for display ads
31. AdSense is not a near-term priority — explicitly deferred until after the Supabase migration is stable; flagged here so the policy nuances already discussed (forced-view policy, internal-tool traffic gray area) aren't lost when the time comes

## G. Domain compliance (outside this repo)

32. `arwaenterprises.com` is missing a Privacy Policy and Terms of Service page — needed for both AdSense approval and Google OAuth consent screen verification (blocks items 25 and 27). No About page either (minor). This is work on the main marketing site, not in the `Utility` repo, but flagged here so it isn't lost.

## Phasing (agreed approach)

1. **Phase 1 — done:** Cloned the app on branch `saas-pilot`, hid every tool tile except Box Scanner, deployed that branch to a second Netlify site, pointed `utility.arwaenterprises.com` at it. Live over HTTP; HTTPS cert issuance deferred (DNS now correct, just needs a retry in Netlify when convenient — not blocking). Still talks to the same Google Apps Script — no backend changes yet.
2. **Phase 2 — live and verified end-to-end:** `supabase/schema.sql` deployed to the real Supabase project. Google OAuth configured (Google Cloud client + consent screen, Supabase Auth provider enabled, redirect URLs allow-listed). Confirmed working live: signed in with Google, scanned a box and items, closed the box — all writing to Supabase correctly. Known, accepted tradeoff: scanning has a small, real network-latency delay per scan now (vs. the old instant local IndexedDB write) since writes are online-only with no local queue, per the earlier decision. An optimistic-UI fix (update the screen immediately, roll back on failure) was proposed and explicitly deferred — revisit later if it's still bothersome.
3. **Phase 3:** Once Box Scanner on Supabase is proven stable, decide on rolling the same pattern out to the remaining tools, revealing each tile as it's migrated.
4. **Phase 4:** Add Google AdSense once the Supabase migration is stable (items 27–31).
5. **Phase 5:** Retire the old Netlify + Google Apps Script version once the new one is fully proven.

Independent of the phases above: item 32 (Privacy Policy/Terms on the main domain) can be done any time — it isn't blocking Phase 1.
