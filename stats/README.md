# Weekly usage report

Every Monday morning (08:00 Riyadh) GitHub emails you a report: who used the app and how much -
boxes closed and items scanned (Box Scanner, Year/Season), labels printed (Item Barcode, Box Labels),
Box Segregate lookups, Pallet-mode scans and Price Check lookups - per user and per enterprise, with
last-week comparison and a CSV of the daily numbers (last 30 days) attached. **Counts only - no scan
contents are recorded.** Only you can read the numbers (nobody in the app can, not even enterprise admins).

Free: GitHub Actions (a few seconds per week) + your own mailbox to send it.

## One-time setup (about 5 minutes)

1. **Run `supabase/schema.sql`** in the Supabase SQL editor (adds the `usage_daily` table). Numbers start
   collecting once the new app version is live; nothing is back-filled.
2. **Get a mailbox password for sending.** With a Gmail account that has 2-Step Verification on:
   Google Account -> Security -> 2-Step Verification -> *App passwords* -> create one named "Utility stats".
   Copy the 16-character password. (Any other SMTP mailbox works too: also set `SMTP_HOST` / `SMTP_PORT`.)
   I could not verify Google's current menu names - look for "App passwords" in your Google account settings.
3. **Get the Supabase service-role key:** Supabase dashboard -> Project Settings -> API -> `service_role`
   (secret). **Never put this key in the app or in any file in the repo** - only in GitHub secrets.
4. **Add 5 GitHub secrets:** repo -> Settings -> Secrets and variables -> Actions -> *New repository secret*:

   | Name | Value |
   |---|---|
   | `SUPABASE_URL` | `https://<your-project>.supabase.co` (Project Settings -> API) |
   | `SUPABASE_SERVICE_ROLE_KEY` | the `service_role` key from step 3 |
   | `REPORT_TO` | the email address that should receive the report |
   | `SMTP_USER` | the Gmail address that sends it |
   | `SMTP_APP_PASSWORD` | the app password from step 2 |

5. **Test it:** repo -> Actions -> *Weekly usage report* -> *Run workflow* (tick "Dry run" first to see the
   report in the log, then run again without it to receive the real email).

## Why no email on Monday?

* GitHub runs **scheduled** workflows only from the repository's **default branch**. This repo's default
  branch is `main`, but the report code is on `saas-pilot`. Fix either way:
  (a) GitHub -> Settings -> Branches -> change the default branch to `saas-pilot`, or
  (b) add just `.github/workflows/weekly-stats.yml` to `main` (it already checks out `saas-pilot` for the code).
  Manual *Run workflow* works regardless.
* A secret is missing - the log says which ("Missing secret(s): ...").
* GitHub disables scheduled workflows in a repo with no activity for 60 days; pushing any commit or clicking
  *Enable workflow* turns it back on.

## Look at the numbers any time (no email)

Supabase -> SQL editor:

```sql
-- last 7 days, per user and tool
select email, display_name, enterprise, tool, action, sum(event_count) as events, sum(qty) as qty
from usage_report
where day >= current_date - 7
group by 1,2,3,4,5
order by events desc;
```

## Preview the layout on your computer

```
npm install
node stats/weekly-report.js --sample     # made-up data -> stats/out/report.html
node stats/weekly-report.js --dry        # real data, no email (needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY)
```

## What is counted

| Tool | Counted when | Events | Quantity |
|---|---|---|---|
| Box Scanner | a box is closed | boxes | items in them |
| Year/Season Sort | a PTL box is closed | boxes | items in them |
| Item Barcode / Box Labels | labels are sent to the printer | print jobs | labels / codes printed |
| Box Segregate | a box is looked up | found / not found | - |
| Pallet mode | a box is scanned | scanned / duplicate / not found | - |
| Price Check | a barcode is looked up | found / not found | - |

Counts are kept on the device while offline and sent later; each user's device-date is used for "day".
If a response is lost after the server already counted a batch, that batch can be counted twice - rare,
and only inflates a number slightly.
