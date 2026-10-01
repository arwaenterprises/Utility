-- ============================================================================
-- USAGE QUERIES - who used the app and how much
-- ============================================================================
-- Run these in the Supabase dashboard: SQL Editor -> New query.
-- Only you (the project owner) can see this data; nobody in the app can read it.
--
-- HOW TO RUN ONE QUERY
--   The SQL editor shows only the LAST result when several queries run together.
--   So: paste this whole file, then HIGHLIGHT one query (from its "-- Q" line down to
--   its semicolon) and click "Run" (it runs the selected text only).
--   To change the period, edit the two dates in the first lines of the query
--   (current_date - 7 means "the last 7 days"; use date '2026-10-01' for a fixed day).
--
-- FOR A WHOLE YEAR (2026, 2027, ...): use Q12 at the bottom - change the year in its first line.
--
-- IF YOU SEE:  relation "usage_report" does not exist
--   The usage tables are not in your database yet. Run supabase/schema.sql once in the SQL editor
--   (paste the whole file, Run; it is safe to re-run), then come back here.
--   If a query runs but returns no rows: nobody has used the new app version yet - counting starts
--   the day the version with usage tracking went live.
--
-- WHAT THE NUMBERS MEAN                      events                    qty
--   box_scanner / year_season  box_closed    boxes closed              items in those boxes
--   item_barcode / box_code    print_job     print jobs                labels / codes printed
--   box_segregate              lookup_found / lookup_not_found          (events = lookups)
--   box_segregate_pallet       box_scanned / box_duplicate / box_not_found
--   price_check                lookup_found / lookup_not_found          (events = lookups)
-- Only counts are stored - never barcodes, box numbers or other scan contents.
-- "day" is the date on the user's device. Counting started the day this version went live.
-- ============================================================================


-- Q1. THE BIG PICTURE: what was done in the period, all users together ---------
select tool, action,
       sum(event_count) as events,
       sum(qty)         as qty
from usage_report
where day >= current_date - 7          -- from
  and day <= current_date              -- to
group by tool, action
order by tool, action;


-- Q2. PER USER: one row per person, one column per task --------------------------
--     (boxes closed + items for Box Scanner, Year/Season boxes, labels printed,
--      Box Segregate lookups, Pallet scans, Price lookups)
select coalesce(display_name, email)                                                            as user_name,
       email,
       coalesce(enterprise, 'Individual')                                                       as enterprise,
       sum(event_count) filter (where tool = 'box_scanner'  and action = 'box_closed')          as box_scanner_boxes,
       sum(qty)         filter (where tool = 'box_scanner'  and action = 'box_closed')          as box_scanner_items,
       sum(event_count) filter (where tool = 'year_season'  and action = 'box_closed')          as year_season_boxes,
       sum(qty)         filter (where tool = 'year_season'  and action = 'box_closed')          as year_season_items,
       sum(qty)         filter (where tool in ('item_barcode', 'box_code') and action = 'print_job') as labels_printed,
       sum(event_count) filter (where tool = 'box_segregate' and action = 'lookup_found')        as segregate_lookups,
       sum(event_count) filter (where tool = 'box_segregate_pallet' and action = 'box_scanned')  as pallet_boxes_scanned,
       sum(event_count) filter (where tool = 'price_check'  and action = 'lookup_found')         as price_lookups
from usage_report
where day >= current_date - 7
  and day <= current_date
group by 1, 2, 3
order by coalesce(sum(event_count) filter (where tool = 'box_scanner' and action = 'box_closed'), 0) desc, 1;


-- Q3. PER ENTERPRISE (individual accounts are grouped as 'Individual') -----------
select coalesce(enterprise, 'Individual')                                                       as enterprise,
       count(distinct email)                                                                    as active_users,
       sum(event_count) filter (where tool = 'box_scanner'  and action = 'box_closed')          as box_scanner_boxes,
       sum(qty)         filter (where tool = 'box_scanner'  and action = 'box_closed')          as box_scanner_items,
       sum(event_count) filter (where tool = 'year_season'  and action = 'box_closed')          as year_season_boxes,
       sum(qty)         filter (where tool in ('item_barcode', 'box_code') and action = 'print_job') as labels_printed,
       sum(event_count) filter (where tool = 'box_segregate' and action = 'lookup_found')        as segregate_lookups,
       sum(event_count) filter (where tool = 'box_segregate_pallet' and action = 'box_scanned')  as pallet_boxes_scanned,
       sum(event_count) filter (where tool = 'price_check'  and action = 'lookup_found')         as price_lookups
from usage_report
where day >= current_date - 7
  and day <= current_date
group by 1
order by active_users desc;


-- Q4. DAY BY DAY: is usage growing? (all users) -----------------------------------
select day,
       count(distinct email)                                                                    as active_users,
       sum(event_count) filter (where action = 'box_closed')                                    as boxes_closed,
       sum(qty)         filter (where action = 'box_closed')                                    as items_in_closed_boxes,
       sum(qty)         filter (where action = 'print_job')                                     as labels_printed,
       sum(event_count) filter (where action in ('lookup_found', 'lookup_not_found', 'box_scanned')) as lookups_and_scans
from usage_report
where day >= current_date - 30
group by day
order by day;


-- Q5. THIS WEEK vs LAST WEEK per task (the 7 days up to today vs the 7 before) ---
select tool, action,
       sum(event_count) filter (where day >  current_date - 7)                                  as this_week,
       sum(event_count) filter (where day <= current_date - 7 and day > current_date - 14)      as last_week
from usage_report
where day > current_date - 14
group by tool, action
order by tool, action;


-- Q6. ONE PERSON: everything a user did, day by day (change the email) -----------
select day, tool, action, event_count as events, qty
from usage_report
where email = 'someone@example.com'
order by day desc, tool, action;


-- Q7. WHO IS NOT USING IT: registered people with no activity in the period -------
select coalesce(p.display_name, p.email) as user_name, p.email,
       coalesce(e.name, 'Individual')    as enterprise,
       p.created_at::date                as signed_up
from profiles p
left join enterprises e on e.id = p.enterprise_id
where not exists (
        select 1 from usage_daily u
        where u.user_id = p.id
          and u.day >= current_date - 14          -- inactive for the last 14 days
      )
order by p.created_at;


-- Q8. ALL-TIME TOTALS per user since counting started -----------------------------
select coalesce(display_name, email) as user_name, email, coalesce(enterprise, 'Individual') as enterprise,
       min(day) as first_seen, max(day) as last_seen,
       sum(event_count) filter (where action = 'box_closed') as boxes_closed,
       sum(qty)         filter (where action = 'box_closed') as items_in_closed_boxes,
       sum(qty)         filter (where action = 'print_job')  as labels_printed
from usage_report
group by 1, 2, 3
order by boxes_closed desc nulls last;


-- Q9. QUALITY CHECK: how often do scans/lookups fail? -----------------------------
--     A high "not found" share means wrong or outdated uploaded lists.
select tool,
       sum(event_count) filter (where action in ('lookup_found', 'box_scanned'))          as ok,
       sum(event_count) filter (where action in ('lookup_not_found', 'box_not_found'))    as not_found,
       sum(event_count) filter (where action = 'box_duplicate')                           as duplicates,
       round(100.0 * sum(event_count) filter (where action in ('lookup_not_found', 'box_not_found'))
             / nullif(sum(event_count) filter (where action in ('lookup_found', 'lookup_not_found', 'box_scanned', 'box_not_found')), 0), 1) as not_found_percent
from usage_report
where tool in ('box_segregate', 'box_segregate_pallet', 'price_check')
  and day >= current_date - 7
group by tool
order by tool;


-- Q10. HOW MANY ACCOUNTS: totals right now ---------------------------------------
select count(*)                                                    as registered_users,
       count(*) filter (where tier = 'individual')                 as individuals,
       count(*) filter (where tier = 'enterprise_admin')           as enterprise_admins,
       count(*) filter (where tier = 'enterprise_member')          as enterprise_members,
       (select count(*) from enterprises)                          as enterprises,
       count(*) filter (where created_at >= now() - interval '7 days') as new_in_last_7_days
from profiles;


-- Q11. EXPORT EVERYTHING as one flat table (use "Download CSV" in the results) ----
select day, email, display_name, coalesce(enterprise, 'Individual') as enterprise, tool, action, event_count as events, qty
from usage_report
where day >= current_date - 30
order by day, email, tool, action;


-- Q12. YEARLY REPORT - one query for a whole calendar year -------------------------
--      Change the year on the next line (2026, 2027, ...) and run. One result with:
--        * first row: GRAND TOTAL for everyone
--        * then each enterprise: its people, followed by a "Subtotal" row
--      Columns: how many people / days were active, then every task counted for the year
--      (BS = Box Scanner, YS = Year/Season; "labels" = barcodes/codes printed).
with params as (select 2026 as yr)                                  -- <<< CHANGE THE YEAR HERE
select
    case when grouping(u.enterprise) = 1 then 'GRAND TOTAL (everyone)'
         when grouping(u.email) = 1      then 'Subtotal - ' || u.enterprise
         else u.user_name end                                                   as who,
    case when grouping(u.enterprise) = 1 then null else u.enterprise end        as enterprise,
    case when grouping(u.email) = 1 then null else u.email end                  as email,
    count(distinct u.email)                                                     as active_users,
    count(distinct u.day)                                                       as active_days,
    sum(u.event_count) filter (where u.tool = 'box_scanner' and u.action = 'box_closed')                     as bs_boxes_closed,
    sum(u.qty)         filter (where u.tool = 'box_scanner' and u.action = 'box_closed')                     as bs_items,
    sum(u.event_count) filter (where u.tool = 'year_season' and u.action = 'box_closed')                     as ys_boxes_closed,
    sum(u.qty)         filter (where u.tool = 'year_season' and u.action = 'box_closed')                     as ys_items,
    sum(u.qty)         filter (where u.tool in ('item_barcode', 'box_code') and u.action = 'print_job')      as labels_printed,
    sum(u.event_count) filter (where u.tool = 'box_segregate' and u.action = 'lookup_found')                 as segregate_found,
    sum(u.event_count) filter (where u.tool = 'box_segregate' and u.action = 'lookup_not_found')             as segregate_not_found,
    sum(u.event_count) filter (where u.tool = 'box_segregate_pallet' and u.action = 'box_scanned')           as pallet_scanned,
    sum(u.event_count) filter (where u.tool = 'box_segregate_pallet' and u.action = 'box_duplicate')         as pallet_duplicates,
    sum(u.event_count) filter (where u.tool = 'box_segregate_pallet' and u.action = 'box_not_found')         as pallet_not_found,
    sum(u.event_count) filter (where u.tool = 'price_check' and u.action = 'lookup_found')                   as price_found,
    sum(u.event_count) filter (where u.tool = 'price_check' and u.action = 'lookup_not_found')               as price_not_found
from (
    select r.day, r.email, coalesce(r.display_name, r.email) as user_name,
           coalesce(r.enterprise, 'Individual') as enterprise, r.tool, r.action, r.event_count, r.qty
    from usage_report r, params
    where r.day >= make_date(params.yr, 1, 1)
      and r.day <  make_date(params.yr + 1, 1, 1)
) u
group by rollup (u.enterprise, (u.email, u.user_name))
order by grouping(u.enterprise) desc,            -- grand total first
         u.enterprise,
         grouping(u.email) desc,                  -- then the enterprise subtotal, then its people
         bs_boxes_closed desc nulls last, u.user_name;
