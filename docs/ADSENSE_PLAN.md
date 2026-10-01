# Google AdSense for arwaenterprises.com — briefing and plan

Written 2026-10-01 for a **new working session** on the main website. Everything here is my understanding;
items marked **(verify)** are things I am not certain about or that Google may have changed — check them in the
AdSense Help Center / your AdSense account before relying on them. I have not invented sources or numbers.

---

## 1. The situation in one page

| | |
|---|---|
| **Main domain** | `arwaenterprises.com` — the company / marketing website. **Not in the `Utility` repo.** Its platform, hosting and code location are **unknown to me** (first job of the new session: find out). |
| **Utility app** | `utility.arwaenterprises.com` — the warehouse tools (Box Scanner, Box Segregate, Price Check, Year/Season, labels). Repo `arwaenterprises/Utility`, branch `saas-pilot`, hosted on Netlify, data in Supabase. A logged-in tool for ~100 operators. |
| **Decision already taken** | **No ads inside the Utility app.** Ads go on **public content pages of the main domain only**, never next to scan/tap controls. (A hidden, empty `.ad-slot` placeholder exists in the app's `style.css`/`index.html`; it can be deleted once this is settled.) |
| **Why the app is a poor fit** | Behind a Google login, so Google's reviewer only ever sees a login screen (no public content); operators tap fast, so ads beside controls would cause accidental clicks, which AdSense treats as a violation **(verify)**. |
| **Why do this at all** | Revenue from a content site. Side benefit: the Privacy Policy / Terms / homepage the main site needs are also what Google asks for when verifying the app's Google sign-in (roadmap items 41, 46). |
| **Honest expectation** | AdSense pays per impression/click on **public traffic**. A site with little organic traffic earns very little. Approval is also not guaranteed. Plan the content as something useful in its own right. |

---

## 2. What AdSense will look at (my understanding — verify each)

1. **Account basics.** A Google account; the applicant must be of legal age (18+ **(verify)**); one account per person **(verify)**; a payment/tax profile and a postal-address verification step before first payment **(verify)**; payments to a bank account in a supported country **(verify that Saudi Arabia is supported for bank payments)**.
2. **You must own the site.** Google asks you to prove ownership by placing a snippet/meta tag on the site's pages (and/or the `ads.txt` file). So someone must be able to edit the site's `<head>` and its root files.
3. **Real, original, useful public content** — this is the thing most often cited when sites are refused ("low value content", "site under construction", "insufficient content"). There is **no official minimum number of pages or words that I can cite**; commonly shared rules of thumb (e.g. "15–30 articles") are folklore, not Google policy.
4. **Trust pages:** About, Contact (a real way to reach you), **Privacy Policy** (must disclose the use of cookies / third-party advertising **(verify exact wording requirements)**), Terms. Clear navigation. No "coming soon" pages.
5. **Site is live and crawlable:** public (no login/VPN), HTTPS, works on mobile, loads reasonably fast, not blocked by `robots.txt`, no broken pages.
6. **Content/ad policies** (read the full current list in the AdSense Program Policies): no prohibited or copyrighted/scraped content; no ads on pages with little or no content (login, thank-you, error pages); no clicking your own ads or asking others to; no layouts that encourage accidental clicks; limits on how many ads / how they are placed.
7. **Consent (cookie banner).** Visitors in the EEA/UK/Switzerland need consent before personalised ads **(verify the current requirement and whether a Google-certified consent tool is needed — AdSense offers a "Privacy & messaging" tool, verify its current name and rules)**. For visitors in Saudi Arabia the Personal Data Protection Law (PDPL) may apply **(I am not certain what it requires — take legal advice)**.
8. **Subdomains.** Whether adding `arwaenterprises.com` also covers `utility.arwaenterprises.com` in AdSense is something I am **not sure of (verify in the account's Sites settings)**. It is moot while the app stays ad-free.
9. **Review time.** The review can take from days to weeks **(verify)**; rejections come with a reason — fix it and re-apply.

---

## 3. Work plan for the new session (in this order)

### Phase 0 — Discovery (do first, before any writing)
Ask the user and look at the site:
- What is `arwaenterprises.com` built on? (WordPress / Wix / Squarespace / static files on Netlify or GitHub Pages / custom code) Where is the code (a GitHub repo → attach it to the session with `add_repo`) and who controls hosting + DNS (registrar)?
- What pages exist today? Is there real content, or just a landing page? In which languages (English / Arabic)? What does the company actually do (to write honest About text)?
- Business details for the legal pages: legal/trade name, country of registration, contact email, postal address (optional), phone (optional).
- Is Google Analytics / any tracking already on the site? (changes the Privacy Policy and consent needs)
- Who will write articles, and how often? Are there images/photos the company owns?

### Phase 1 — Trust and legal pages (cheapest, unblocks Google sign-in verification too)
Create: **Home** (what the company is), **About**, **Contact**, **Privacy Policy**, **Terms of Service**, optionally **Cookie Policy**. Drafts only — **have a lawyer review the Privacy Policy and Terms before publishing.**
Facts about the Utility app to feed into the Privacy Policy (all true as of today, from the codebase):
- Sign-in is with **Google** (via Supabase Auth); we receive the user's **name and email** (and Google account id).
- Stored in Supabase (cloud database): scan records (box numbers, barcodes, remarks, quantities, timestamps), uploaded lists (box lists, price lists, item master, PTL config, TRN#/box lists), enterprise membership and invites, and **usage counts** (per user per day: boxes closed, labels printed, lookups — counts only, readable only by the owner).
- Stored **on the user's device**: an offline copy of scans and lists (IndexedDB), settings and session state (localStorage), and a service-worker cache of the app files.
- Hosting: Netlify (site) and Supabase (database/auth). The camera is used only for barcode scanning on the device. **No advertising or third-party tracking inside the app today.**
- Data deletion: individuals can reset (delete) their own data; enterprise admins can delete their team's data; account deletion is not self-service yet (a gap to mention or fix).
Also publish the **homepage URL and Privacy Policy URL** where Google's OAuth consent screen asks for them (see roadmap items 41, 46).

### Phase 2 — Real content (the part that decides approval)
- Decide a **topic the site can be genuinely helpful about**, tied to the business: e.g. warehouse and retail logistics in Saudi Arabia/GCC, barcode and label basics, how to organise boxes and pallets, inventory/receiving workflows, how to use each Utility tool (the planned "Help" pages: Box Scanner, Box Segregate incl. Pallet mode and the TRN# list format, Price Check, Year/Season Sort, label printing, upload templates).
- Original writing (not copied or machine-spun filler), with real detail and screenshots; each page should stand on its own. English and/or Arabic **(verify AdSense's supported-language list for the chosen language)**.
- Publish a reasonable body of pages **before** applying rather than applying with a thin site; plan a steady schedule after launch.
- Do **not** put ads on: login, search results, thank-you, error or near-empty pages.

### Phase 3 — Technical readiness
- HTTPS everywhere; one canonical address (`www` vs non-`www` redirect); mobile-friendly; fast (compressed images, no heavy scripts).
- `sitemap.xml` and `robots.txt` (do not block Google's AdSense crawler — **verify the crawler name Google currently documents**); a real 404 page; working navigation and footer links (Privacy, Terms, Contact, About on every page).
- Optional but useful: Google Search Console verification for the domain.
- Prepare the page layout so ads can be added **without layout jumps**: reserve fixed heights for ad slots (this also protects the page-speed/"layout shift" scores).
- If the site uses a Content-Security-Policy or similar headers, the ad domains must be allowed — **take the exact list from Google's documentation at that time, not from memory.**

### Phase 4 — Apply
1. Sign in to AdSense with the company Google account → add `arwaenterprises.com`.
2. Place Google's **verification snippet** in the site's `<head>` on every page (or use the method AdSense offers).
3. Add the **`ads.txt`** file at `https://arwaenterprises.com/ads.txt` exactly as shown in the AdSense account (it contains your publisher id — **copy it from the dashboard**; do not type it from memory).
4. Set up the **consent / "Privacy & messaging"** tool for EEA/UK visitors **(verify)** and make sure the Privacy Policy matches what is actually enabled.
5. Submit for review; wait. If refused, read the stated reason, fix, re-apply.

### Phase 5 — After approval
- Create ad units (or Auto ads) and place **responsive** units inside the article layout: between paragraphs and in the sidebar, **never** adjacent to buttons, menus, download links or form fields; keep ad density modest.
- Never click your own ads or ask others to; watch the **Policy center** in AdSense for warnings.
- Add payment details / tax information, and the postal PIN verification when asked **(verify the flow)**.
- Check page speed and layout shift after ads go on; adjust.
- Re-use the same account if ads are ever considered elsewhere; the Utility app stays ad-free unless the owner decides otherwise.

---

## 4. Risks and things not to do
- Applying with a thin site, "coming soon" pages, or copied content → likely refusal and a slower retry.
- Ads near scanning/tapping controls (relevant only if ads ever returned to the app) → accidental clicks → policy risk.
- Buying traffic, auto-refreshing ads, hiding ads, or incentivising clicks → account disabling risk.
- Publishing a Privacy Policy that does not match reality (e.g. says "no cookies" while ads set cookies) → trust and compliance problem.
- Putting the AdSense snippet on pages that are not public/not meant to show ads.
- Revenue expectation: low until the site has real, steady visitors.

---

## 5. What the new session needs from the user (checklist)
1. Where the main site's code lives (GitHub repo → attach with `add_repo`) or which website builder it uses; who manages DNS/hosting.
2. Legal/trade name, country, contact email (and optionally address/phone) for the legal pages.
3. Languages, topics and who writes the content; whether to use Google Analytics.
4. The Google account to use for AdSense, and confirmation that the person is eligible (age, bank/tax details).
5. Who reviews the Privacy Policy and Terms legally.

## 6. Kickoff prompt (paste into the new session)

> I want to prepare **arwaenterprises.com** (our main company website) for a Google AdSense application. Please read the briefing in `docs/ADSENSE_PLAN.md` of the repo `arwaenterprises/Utility` (branch `saas-pilot`) first. The main site is **not** in that repo — the site's repo is `<owner/repo — add it>` / it is built with `<platform>`. Start with **Phase 0 (discovery)**: look at what the site contains today and ask me for the missing details (business name, country, contact email, languages, who writes content). Then work through Phase 1 (About, Contact, Privacy Policy, Terms — drafts I will have a lawyer review), Phase 2 (real content pages) and Phase 3 (technical readiness) one step at a time, asking me before anything that publishes or changes the live site. Do not put ads in the Utility app (`utility.arwaenterprises.com`); ads are for the public content pages of the main domain only. Anything about AdSense policy you are not sure of, tell me to verify in the AdSense Help Center instead of guessing.
