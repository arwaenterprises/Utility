-- ============================================================
-- MAINTENANCE (run by hand in the Supabase SQL editor when you want to - nothing here runs by itself)
-- ============================================================
-- Every handheld that joins a job by QR is an anonymous sign-in. Supabase does NOT clean those up automatically
-- (see https://supabase.com/docs/guides/auth/auth-anonymous). A handheld that leaves a job or is Reset gets a
-- new anonymous identity next time, so old ones pile up.
--
-- Step 1 - LOOK FIRST: how many anonymous identities exist, and how many are safe to delete?
-- "Safe" = older than 30 days AND they never stored a scan. Deleting an anonymous user also deletes everything
-- stored under it (scans, Year/Season scans), so anyone with scans is never touched.
select
  count(*)                                                          as anonymous_users,
  count(*) filter (where u.created_at < now() - interval '30 days'
                   and not exists (select 1 from public.scans s where s.user_id = u.id)
                   and not exists (select 1 from public.ys_scans y where y.user_id = u.id)) as safe_to_delete
from auth.users u
where u.is_anonymous;

-- Step 2 - DELETE the safe ones (remove the leading "--" on the next 7 lines to run it).
-- delete from auth.users u
-- where u.is_anonymous
--   and u.created_at < now() - interval '30 days'
--   and not exists (select 1 from public.scans s where s.user_id = u.id)
--   and not exists (select 1 from public.ys_scans y where y.user_id = u.id);
