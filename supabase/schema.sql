-- ============================================
-- AK Utility — Box Scanner Supabase Schema (Phase 2 pilot)
-- ============================================
-- Run this once in the Supabase SQL Editor: Database -> SQL Editor -> New query,
-- paste this whole file, Run. Safe to re-run after edits — tables/functions use
-- IF NOT EXISTS / OR REPLACE, and policies are dropped before being recreated.
--
-- Schema decided in ROADMAP.md section D item 25.

-- ============================================
-- TABLES
-- ============================================

create table if not exists public.enterprises (
    id uuid primary key default gen_random_uuid(),
    name text not null,
    admin_user_id uuid not null references auth.users(id) on delete cascade,
    created_at timestamptz not null default now()
);

create table if not exists public.profiles (
    id uuid primary key references auth.users(id) on delete cascade,
    email text not null,
    display_name text,
    tier text not null default 'individual' check (tier in ('individual', 'enterprise_admin', 'enterprise_member')),
    enterprise_id uuid references public.enterprises(id) on delete set null,
    created_at timestamptz not null default now()
);

create table if not exists public.scans (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references public.profiles(id) on delete cascade,
    enterprise_id uuid references public.enterprises(id) on delete set null,
    remark text,
    box_number text not null,
    barcode text not null,
    qty integer not null default 1,
    box_status text not null default 'Open' check (box_status in ('Open', 'Closed')),
    scan_uid uuid not null default gen_random_uuid() unique,
    scanned_at timestamptz not null default now()
);
-- (also added again in TEAM QR LINKS below; harmless) the functions further down read this column
alter table public.scans add column if not exists operator_name text;

-- Migration for an already-existing scans table (originally pointed at
-- auth.users directly): repoint user_id at public.profiles instead, so
-- PostgREST can auto-embed profiles when querying scans (needed for the
-- Team Scans view to show who scanned what). Safe - profiles.id is always
-- equal to the auth.users id it was created for, so no data is orphaned.
do $$
begin
    if exists (
        select 1 from pg_constraint
        where conrelid = 'public.scans'::regclass
          and confrelid = 'auth.users'::regclass
    ) then
        alter table public.scans drop constraint scans_user_id_fkey;
        alter table public.scans add constraint scans_user_id_fkey
            foreign key (user_id) references public.profiles(id) on delete cascade;
    end if;
end $$;

create index if not exists scans_user_id_idx on public.scans(user_id);
create index if not exists scans_enterprise_id_idx on public.scans(enterprise_id);
create index if not exists scans_box_number_idx on public.scans(box_number);

-- ============================================
-- AUTO-CREATE A PROFILE ROW ON SIGNUP
-- ============================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    insert into public.profiles (id, email, display_name)
    values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', new.email));
    return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
    after insert on auth.users
    for each row execute function public.handle_new_user();

-- ============================================
-- HELPER FUNCTIONS
-- ============================================
-- SECURITY DEFINER so RLS policies below can check the caller's own profile
-- without recursively re-triggering RLS on profiles (which would deadlock).
-- Both only ever read the caller's own row (auth.uid()), never anyone else's.

create or replace function public.current_user_enterprise_id()
returns uuid
language sql
security definer
set search_path = public
stable
as $$
    select enterprise_id from public.profiles where id = auth.uid();
$$;

-- Anonymous sign-in (labourers, see TEAM QR LINKS below) gives the API's "authenticated" role to ANYONE who
-- holds the public key. An anonymous identity that has not joined a team through a QR code (profile tier is not
-- 'operator') must not be able to store data or create anything: it is an unjoined device.
create or replace function public.is_unjoined_anon()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
    select coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)
           and not exists (select 1 from public.profiles where id = auth.uid() and tier = 'operator');
$$;
grant execute on function public.is_unjoined_anon() to authenticated;

create or replace function public.current_user_is_enterprise_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
    select coalesce((select tier = 'enterprise_admin' from public.profiles where id = auth.uid()), false);
$$;


-- ============================================
-- CONTROLLED TIER/ENTERPRISE TRANSITIONS
-- ============================================
-- tier and enterprise_id can ONLY change through these two functions (table
-- UPDATE on those columns is revoked above). Each one does its own validation
-- before touching anything, so there's no path to attach yourself to an
-- enterprise you don't belong to.

-- E-mail invitations were replaced by Team QR links. These three functions are removed (safe if they never existed).
-- (E-mail invitations were replaced by Team QR links; the old invitation table is removed at the end of this file.)
drop function if exists public.accept_enterprise_invite(uuid);
drop function if exists public.my_pending_invites();
drop function if exists public.send_enterprise_invite(text);




-- ============================================
-- ROW LEVEL SECURITY
-- ============================================

alter table public.profiles enable row level security;
alter table public.enterprises enable row level security;
alter table public.scans enable row level security;

-- profiles
drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles for select
    using (id = auth.uid());

drop policy if exists "profiles_select_team" on public.profiles;
create policy "profiles_select_team" on public.profiles for select
    using (
        public.current_user_is_enterprise_admin()
        and enterprise_id = public.current_user_enterprise_id()
    );

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles for update
    using (id = auth.uid());

-- RLS controls *which rows* a policy applies to, not *which columns* can change.
-- Without this, "profiles_update_own" above would let any signed-in user set their
-- own tier to 'enterprise_admin' and enterprise_id to ANY existing enterprise's id,
-- instantly gaining access to that enterprise's scan data. Column-level grants close
-- that: tier/enterprise_id can only ever change via the SECURITY DEFINER functions
-- below (make_own_team), which contains its own checks.
revoke update on public.profiles from authenticated;
grant update (display_name) on public.profiles to authenticated;

-- enterprises
drop policy if exists "enterprises_select_member" on public.enterprises;
create policy "enterprises_select_member" on public.enterprises for select
    using (id = public.current_user_enterprise_id() or admin_user_id = auth.uid());

drop policy if exists "enterprises_insert_self" on public.enterprises;
create policy "enterprises_insert_self" on public.enterprises for insert
    with check (admin_user_id = auth.uid());

-- Direct insert is blocked in favor of make_own_team() below, so creating the
-- enterprise row and promoting the caller to enterprise_admin happen atomically -
-- otherwise a crashed/partial request could leave an orphaned enterprise with no
-- admin profile pointing at it, or an admin profile pointing at nothing.
revoke insert on public.enterprises from authenticated;

drop policy if exists "enterprises_update_admin" on public.enterprises;
create policy "enterprises_update_admin" on public.enterprises for update
    using (admin_user_id = auth.uid());

drop function if exists public.current_user_email();

-- scans — own rows always visible/writable; enterprise admin also gets their team's rows
drop policy if exists "scans_select_own" on public.scans;
create policy "scans_select_own" on public.scans for select
    using (user_id = auth.uid());

drop policy if exists "scans_select_team" on public.scans;
create policy "scans_select_team" on public.scans for select
    using (
        public.current_user_is_enterprise_admin()
        and enterprise_id = public.current_user_enterprise_id()
    );

-- WITH CHECK matters as much as USING here: without it, a user editing their own
-- row (or an admin editing a team row) could forge enterprise_id to a DIFFERENT
-- enterprise (planting data in another company's view) or reassign user_id away
-- from themselves.
drop policy if exists "scans_insert_own" on public.scans;
create policy "scans_insert_own" on public.scans for insert
    with check (
        user_id = auth.uid()
        and (enterprise_id is null or enterprise_id = public.current_user_enterprise_id())
    );

drop policy if exists "scans_update_own" on public.scans;
create policy "scans_update_own" on public.scans for update
    using (user_id = auth.uid())
    with check (
        user_id = auth.uid()
        and (enterprise_id is null or enterprise_id = public.current_user_enterprise_id())
    );

drop policy if exists "scans_update_team" on public.scans;
create policy "scans_update_team" on public.scans for update
    using (
        public.current_user_is_enterprise_admin()
        and enterprise_id = public.current_user_enterprise_id()
    )
    with check (
        enterprise_id = public.current_user_enterprise_id()
    );

-- Delete: individuals (no enterprise) may delete their own rows (their Reset does).
-- Enterprise members may NOT - their Reset only clears their own device, and the data
-- stays until the enterprise admin deletes it from the Team console (scans_delete_team).
-- This is enforced here, not just in the UI, so calling the API directly cannot bypass it.
drop policy if exists "scans_delete_own" on public.scans;
create policy "scans_delete_own" on public.scans for delete
    using (user_id = auth.uid() and enterprise_id is null);

drop policy if exists "scans_delete_team" on public.scans;
create policy "scans_delete_team" on public.scans for delete
    using (
        public.current_user_is_enterprise_admin()
        and enterprise_id = public.current_user_enterprise_id()
    );


-- ============================================
-- REFERENCE LISTS (Box Segregate, Price Check, Year/Season Sort)
-- ============================================
-- Each enterprise (or individual account) owns its own copy of each list, uploaded
-- by the enterprise admin / the individual. An upload REPLACES the whole list and
-- the old rows are deleted. Lists are stored as chunks (a few thousand records per
-- row, as a JSON array) so a 100,000-row list is ~50 rows: fast to upload, fast to
-- download with a progress %, and replaced atomically.
--
--   list_type        columns (inside the JSON records)
--   box_list         box_number, trn, increff_order_id, store_name, region, store_code, brand
--   price_list       barcode, current_price, original_price, style, color, size, year, season
--   ys_item_master   barcode, year, season, brand
--   ys_ptl_config    ptl_number, season, year, year_logic
--   doc_boxes        document_number, box_number, store_name   (Box Segregate Document/Pallet mode)
--
-- Owner: enterprise lists have enterprise_id set (user_id = the admin who uploaded);
-- individual lists have enterprise_id null and user_id = the owner.

create table if not exists public.reference_chunks (
    id uuid primary key default gen_random_uuid(),
    list_type text not null check (list_type in ('box_list', 'price_list', 'ys_item_master', 'ys_ptl_config', 'doc_boxes')),
    user_id uuid not null references public.profiles(id) on delete cascade,
    enterprise_id uuid references public.enterprises(id) on delete cascade,
    seq integer not null,
    row_count integer not null,
    rows jsonb not null,
    is_active boolean not null default false,
    uploaded_at timestamptz not null default now()
);

create index if not exists reference_chunks_owner_idx
    on public.reference_chunks(list_type, enterprise_id, user_id, is_active);

alter table public.reference_chunks enable row level security;

-- Read: the active list of your enterprise, or your own individual list.
-- No insert/update/delete policies on purpose: the only way to change a list is
-- through the three upload functions below, which check who is allowed to.
drop policy if exists "reference_chunks_select" on public.reference_chunks;
create policy "reference_chunks_select" on public.reference_chunks for select
    using (
        is_active
        and (
            (enterprise_id is null and user_id = auth.uid())
            or enterprise_id = public.current_user_enterprise_id()
        )
    );

-- Who may upload: an individual (no enterprise) or the enterprise admin.
create or replace function public.can_upload_reference_list()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
    select case
        when auth.uid() is null then false
        when public.current_user_enterprise_id() is null then true
        else public.current_user_is_enterprise_admin()
    end;
$$;

-- Step 1: start an upload (clears any half-finished previous attempt).
create or replace function public.begin_list_upload(p_list_type text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_eid uuid := public.current_user_enterprise_id();
begin
    if public.is_unjoined_anon() then raise exception 'Join a team with its QR code first.'; end if;
    if not public.can_upload_reference_list() then
        raise exception 'Only an enterprise admin or an individual account can upload lists';
    end if;
    delete from public.reference_chunks
    where list_type = p_list_type and not is_active
      and ((v_eid is null and enterprise_id is null and user_id = auth.uid()) or enterprise_id = v_eid);
end;
$$;

-- Step 2 (repeat): add one chunk of records.
create or replace function public.append_list_chunk(p_list_type text, p_seq integer, p_rows jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_eid uuid := public.current_user_enterprise_id();
begin
    if public.is_unjoined_anon() then raise exception 'Join a team with its QR code first.'; end if;
    if not public.can_upload_reference_list() then
        raise exception 'Only an enterprise admin or an individual account can upload lists';
    end if;
    if jsonb_typeof(p_rows) <> 'array' then
        raise exception 'rows must be a JSON array';
    end if;
    if jsonb_array_length(p_rows) > 5000 then
        raise exception 'chunk too large (max 5000 records)';
    end if;
    insert into public.reference_chunks (list_type, user_id, enterprise_id, seq, row_count, rows, is_active)
    values (p_list_type, auth.uid(), v_eid, p_seq, jsonb_array_length(p_rows), p_rows, false);
end;
$$;

-- Step 2 (faster version): same as above, but the rows arrive as value arrays plus ONE list of
-- column names (about half the upload size). They are turned back into the usual records here,
-- so what is stored is identical. The app uses this when it exists, else append_list_chunk.
create or replace function public.append_list_chunk_compact(p_list_type text, p_seq integer, p_keys text[], p_rows jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_eid uuid := public.current_user_enterprise_id();
    v_objs jsonb;
begin
    if public.is_unjoined_anon() then raise exception 'Join a team with its QR code first.'; end if;
    if not public.can_upload_reference_list() then
        raise exception 'Only an enterprise admin or an individual account can upload lists';
    end if;
    if jsonb_typeof(p_rows) <> 'array' then
        raise exception 'rows must be a JSON array';
    end if;
    if jsonb_array_length(p_rows) > 5000 then
        raise exception 'chunk too large (max 5000 records)';
    end if;
    if p_keys is null or coalesce(array_length(p_keys, 1), 0) not between 1 and 30 then
        raise exception 'keys must list between 1 and 30 column names';
    end if;
    select coalesce(jsonb_agg(
               jsonb_object(p_keys, array(select x.t from jsonb_array_elements_text(e.value) with ordinality as x(t, o) order by x.o))
               order by e.ord), '[]'::jsonb)
      into v_objs
      from jsonb_array_elements(p_rows) with ordinality as e(value, ord);
    insert into public.reference_chunks (list_type, user_id, enterprise_id, seq, row_count, rows, is_active)
    values (p_list_type, auth.uid(), v_eid, p_seq, jsonb_array_length(v_objs), v_objs, false);
end;
$$;

-- Step 3: swap. In ONE transaction, delete the old active list and activate the
-- new chunks, so a failed upload never leaves a half list. Returns the record count.
create or replace function public.commit_list_upload(p_list_type text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
    v_eid uuid := public.current_user_enterprise_id();
    v_staged integer;
    v_total integer;
begin
    if public.is_unjoined_anon() then raise exception 'Join a team with its QR code first.'; end if;
    if not public.can_upload_reference_list() then
        raise exception 'Only an enterprise admin or an individual account can upload lists';
    end if;
    select count(*), coalesce(sum(row_count), 0) into v_staged, v_total
    from public.reference_chunks
    where list_type = p_list_type and not is_active
      and ((v_eid is null and enterprise_id is null and user_id = auth.uid()) or enterprise_id = v_eid);
    if v_staged = 0 then
        raise exception 'Nothing was uploaded';
    end if;

    delete from public.reference_chunks
    where list_type = p_list_type and is_active
      and ((v_eid is null and enterprise_id is null and user_id = auth.uid()) or enterprise_id = v_eid);

    update public.reference_chunks
    set is_active = true, uploaded_at = now()
    where list_type = p_list_type and not is_active
      and ((v_eid is null and enterprise_id is null and user_id = auth.uid()) or enterprise_id = v_eid);

    return v_total;
end;
$$;

grant execute on function public.can_upload_reference_list() to authenticated;
grant execute on function public.begin_list_upload(text) to authenticated;
grant execute on function public.append_list_chunk(text, integer, jsonb) to authenticated;
grant execute on function public.append_list_chunk_compact(text, integer, text[], jsonb) to authenticated;
grant execute on function public.commit_list_upload(text) to authenticated;


-- ============================================
-- YEAR/SEASON SORT SCANS
-- ============================================
-- Same shape and rules as `scans` (Box Scanner): own rows always, enterprise admin
-- sees and can delete the team's rows. scan_uid makes background-sync retries safe.

create table if not exists public.ys_scans (
    id uuid primary key default gen_random_uuid(),
    scan_uid uuid not null unique,
    user_id uuid not null references public.profiles(id) on delete cascade,
    enterprise_id uuid references public.enterprises(id) on delete set null,
    staff_name text,
    remark text,
    ptl_number text,
    season text,
    year integer,
    brand text,
    barcode text not null,
    qty integer not null default 1,
    box_barcode text,
    box_status text not null default 'Open' check (box_status in ('Open', 'Closed')),
    scan_timestamp text,
    scanned_at timestamptz not null default now()
);
alter table public.ys_scans add column if not exists operator_name text;

create index if not exists ys_scans_user_id_idx on public.ys_scans(user_id);
create index if not exists ys_scans_enterprise_id_idx on public.ys_scans(enterprise_id);

alter table public.ys_scans enable row level security;

drop policy if exists "ys_scans_select_own" on public.ys_scans;
create policy "ys_scans_select_own" on public.ys_scans for select
    using (user_id = auth.uid());

drop policy if exists "ys_scans_select_team" on public.ys_scans;
create policy "ys_scans_select_team" on public.ys_scans for select
    using (
        public.current_user_is_enterprise_admin()
        and enterprise_id = public.current_user_enterprise_id()
    );

drop policy if exists "ys_scans_insert_own" on public.ys_scans;
create policy "ys_scans_insert_own" on public.ys_scans for insert
    with check (
        user_id = auth.uid()
        and (enterprise_id is null or enterprise_id = public.current_user_enterprise_id())
    );

drop policy if exists "ys_scans_update_own" on public.ys_scans;
create policy "ys_scans_update_own" on public.ys_scans for update
    using (user_id = auth.uid())
    with check (
        user_id = auth.uid()
        and (enterprise_id is null or enterprise_id = public.current_user_enterprise_id())
    );

-- Delete: individuals (no enterprise) may delete their own rows; enterprise members
-- may NOT (their Reset only clears their device) - only the enterprise admin deletes
-- team rows, from the Team console.
drop policy if exists "ys_scans_delete_own" on public.ys_scans;
create policy "ys_scans_delete_own" on public.ys_scans for delete
    using (user_id = auth.uid() and enterprise_id is null);

drop policy if exists "ys_scans_delete_team" on public.ys_scans;
create policy "ys_scans_delete_team" on public.ys_scans for delete
    using (
        public.current_user_is_enterprise_admin()
        and enterprise_id = public.current_user_enterprise_id()
    );



-- ============================================
-- RENAME ENTERPRISE (admin only)
-- ============================================
create or replace function public.rename_enterprise(new_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    if not public.current_user_is_enterprise_admin() then
        raise exception 'Only the enterprise admin can rename the enterprise';
    end if;
    if new_name is null or length(trim(new_name)) = 0 then
        raise exception 'Name cannot be empty';
    end if;
    update public.enterprises
    set name = trim(new_name)
    where id = public.current_user_enterprise_id();
end;
$$;

grant execute on function public.rename_enterprise(text) to authenticated;


-- ============================================
-- USAGE STATISTICS (owner-only)
-- ============================================
-- Daily counters of what each user did - counts only, never scan contents:
--   tool                  action              event_count        qty
--   box_scanner           box_closed          boxes closed       items in those boxes
--   year_season           box_closed          boxes closed       items in those boxes
--   item_barcode          print_job           print jobs         labels printed
--   box_code              print_job           print jobs         box codes printed
--   box_segregate         lookup_found / lookup_not_found         lookups
--   box_segregate_pallet  box_scanned / box_duplicate / box_not_found   scans
--   price_check           lookup_found / lookup_not_found         lookups
-- Users can only ADD to their own counters through log_usage(); nobody (not even the
-- user themselves, not an enterprise admin) can read the table through the API. The
-- platform owner reads it with the service-role key (weekly report script) or in the
-- Supabase SQL editor (view usage_report).

create table if not exists public.usage_daily (
    user_id uuid not null references public.profiles(id) on delete cascade,
    day date not null,
    tool text not null,
    action text not null,
    enterprise_id uuid references public.enterprises(id) on delete set null,
    event_count bigint not null default 0,
    qty bigint not null default 0,
    primary key (user_id, day, tool, action)
);

create index if not exists usage_daily_day_idx on public.usage_daily(day);

alter table public.usage_daily enable row level security;   -- no policies: the API can never read or write it directly
revoke all on public.usage_daily from anon, authenticated;

create or replace function public.log_usage(p_tool text, p_action text, p_count integer, p_qty integer, p_day date default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_day date := coalesce(p_day, current_date);
begin
    if public.is_unjoined_anon() then raise exception 'Join a team with its QR code first.'; end if;
    if auth.uid() is null then
        raise exception 'Not signed in';
    end if;
    if not ((p_tool || '/' || p_action) = any (array[
        'box_scanner/box_closed', 'year_season/box_closed',
        'item_barcode/print_job', 'box_code/print_job',
        'box_segregate/lookup_found', 'box_segregate/lookup_not_found',
        'box_segregate_pallet/box_scanned', 'box_segregate_pallet/box_duplicate', 'box_segregate_pallet/box_not_found',
        'price_check/lookup_found', 'price_check/lookup_not_found'
    ])) then
        raise exception 'Invalid usage event: %/%', p_tool, p_action;
    end if;
    if p_count is null or p_count < 1 or p_count > 100000 or p_qty is null or p_qty < 0 or p_qty > 1000000 then
        raise exception 'Invalid usage amounts';
    end if;
    -- the device's date is trusted only within a sane window (a tablet with a wrong clock cannot write far-away days)
    if v_day > current_date + 1 or v_day < current_date - 60 then
        v_day := current_date;
    end if;

    insert into public.usage_daily (user_id, day, tool, action, enterprise_id, event_count, qty)
    values (auth.uid(), v_day, p_tool, p_action, public.current_user_enterprise_id(), p_count, p_qty)
    on conflict (user_id, day, tool, action) do update
        set event_count = public.usage_daily.event_count + excluded.event_count,
            qty = public.usage_daily.qty + excluded.qty,
            enterprise_id = excluded.enterprise_id;
end;
$$;

grant execute on function public.log_usage(text, text, integer, integer, date) to authenticated;

-- Readable report for the Supabase SQL editor (run as the project owner). Never exposed to the API.
create or replace view public.usage_report as
select u.day, p.email, p.display_name, e.name as enterprise, u.tool, u.action, u.event_count, u.qty
from public.usage_daily u
join public.profiles p on p.id = u.user_id
left join public.enterprises e on e.id = u.enterprise_id;

revoke all on public.usage_report from anon, authenticated;



-- ============================================
-- TEAM QR LINKS - labourers join a job with a QR code, no Google account (ROADMAP item 90, stage 1)
-- ============================================
-- An enterprise admin creates a LINK for one tool + one job name. A labourer scans the QR, the page signs them in
-- anonymously (Supabase "anonymous sign-in") and calls join_team_link(token, name). That attaches the anonymous
-- identity to the team as an 'operator' (profiles.tier = 'operator', profiles.enterprise_id = the team), so the
-- normal row-level-security rules already keep teams apart. Everything below is reached only through the
-- functions: the two tables are closed to the API.
--
--  * many teams can work on the same tool at the same time: each has its own link and job name. Creating a link
--    with the SAME tool and the SAME job name (ignoring capitals and spaces at the ends) replaces that one link
--    ("a fresh QR for this job"); links with other job names are left alone
--  * a link stops accepting NEW work only when the admin stops it (it never expires by itself; scans recorded
--    before the stop on an offline device are still accepted when they arrive)
--  * the job name becomes the Remark of every scan, and the operator's name is stamped on every scan
--  * an operator can only scan (insert) for the tool of their link; they cannot delete, and cannot upload lists

-- profiles: the new tier, and anonymous users have no e-mail
alter table public.profiles drop constraint if exists profiles_tier_check;
alter table public.profiles add constraint profiles_tier_check
    check (tier in ('individual', 'enterprise_admin', 'enterprise_member', 'operator'));

-- EVERY Google sign-in is its own team (enterprise level by default). A solo user is simply a team of one: they
-- are the admin, can create Team QR links, and see only their own team's data. Labourers (anonymous, no e-mail)
-- never get a team of their own - they join the admin's through a QR code.
-- make_own_team(): internal (not callable from the API). Safe to call again: it does nothing for someone who
-- already has a team. Rows the person stored before (scans, Year/Season scans, lists) carried no team; they are
-- moved into the new one so nothing disappears from view.
create or replace function public.make_own_team(p_user uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
    v_p public.profiles%rowtype;
    v_eid uuid;
begin
    select * into v_p from public.profiles where id = p_user for update;
    if not found then return null; end if;
    if v_p.enterprise_id is not null or v_p.tier <> 'individual' or coalesce(v_p.email, '') = '' then
        return v_p.enterprise_id;
    end if;
    insert into public.enterprises (name, admin_user_id)
    values (coalesce(nullif(btrim(v_p.display_name), ''), v_p.email), p_user)
    returning id into v_eid;
    update public.profiles set tier = 'enterprise_admin', enterprise_id = v_eid where id = p_user;
    update public.scans set enterprise_id = v_eid where user_id = p_user and enterprise_id is null;
    update public.ys_scans set enterprise_id = v_eid where user_id = p_user and enterprise_id is null;
    update public.reference_chunks set enterprise_id = v_eid where user_id = p_user and enterprise_id is null;
    return v_eid;
end;
$$;
revoke execute on function public.make_own_team(uuid) from public, anon, authenticated;

-- What the app calls right after a Google sign-in, for accounts created before this rule existed.
create or replace function public.ensure_own_team()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
begin
    if auth.uid() is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
        return null;
    end if;
    return public.make_own_team(auth.uid());
end;
$$;
revoke execute on function public.ensure_own_team() from public, anon;
grant execute on function public.ensure_own_team() to authenticated;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    insert into public.profiles (id, email, display_name)
    values (new.id, coalesce(new.email, ''), coalesce(new.raw_user_meta_data->>'full_name', new.email, ''));
    -- (the test suite switches this off with  set app.skip_auto_team = 'on'  to build accounts of every kind)
    if coalesce(new.email, '') <> '' and coalesce(current_setting('app.skip_auto_team', true), '') <> 'on' then
        perform public.make_own_team(new.id);
    end if;
    return new;
end;
$$;

create table if not exists public.team_links (
    id uuid primary key default gen_random_uuid(),
    enterprise_id uuid not null references public.enterprises(id) on delete cascade,
    tool text not null check (tool in ('boxScanner', 'itemBarcode', 'boxCode', 'boxSegregate', 'priceCheck', 'yearSegregate')),
    job_name text not null check (char_length(job_name) between 1 and 60),
    token text not null unique default replace(gen_random_uuid()::text, '-', ''),
    created_by uuid references auth.users(id) on delete set null,
    created_at timestamptz not null default now(),
    stopped_at timestamptz,
    last_scan_at timestamptz
);
create index if not exists team_links_enterprise_idx on public.team_links(enterprise_id);
-- the job name is the Remark of every scan, so two active links of one tool must never share it
create unique index if not exists team_links_one_active_job
    on public.team_links (enterprise_id, tool, lower(btrim(job_name))) where stopped_at is null;

create table if not exists public.team_operators (
    id uuid primary key default gen_random_uuid(),
    enterprise_id uuid not null references public.enterprises(id) on delete cascade,
    link_id uuid not null references public.team_links(id) on delete cascade,
    user_id uuid not null references auth.users(id) on delete cascade,
    name text not null check (char_length(name) between 1 and 40),
    joined_at timestamptz not null default now(),
    removed_at timestamptz,
    unique (link_id, user_id)
);
create index if not exists team_operators_user_idx on public.team_operators(user_id);

alter table public.team_links enable row level security;        -- no policies: the API can never read or write them directly
alter table public.team_operators enable row level security;
revoke all on public.team_links from anon, authenticated;
revoke all on public.team_operators from anon, authenticated;

-- who scanned, and under which job
alter table public.scans add column if not exists operator_name text;
alter table public.scans add column if not exists link_id uuid references public.team_links(id) on delete set null;
alter table public.ys_scans add column if not exists operator_name text;
alter table public.ys_scans add column if not exists link_id uuid references public.team_links(id) on delete set null;

-- A link's state as one word: 'stopped' (the admin stopped it) or 'active'. There is no expiry. ('inactive' is no longer produced.)
create or replace function public.team_link_state(p_stopped_at timestamptz, p_last_scan_at timestamptz, p_created_at timestamptz)
returns text
language sql
immutable
as $$
    select case
        when p_stopped_at is not null then 'stopped'
        else 'active'
    end;
$$;

-- ---- Automatic clean-up of idle jobs (Box-Item Scan and Year/Season only) ----
-- A job whose link has had NO SCAN for 30 days is deleted together with its data (QR link, labourers and scans).
-- Price Check, Box Segregate (and the print tools, which store nothing) are never touched: their links stay until
-- the admin stops them. "Activity" means scans only (looking at a job or downloading it does not count); stopping a
-- job also restarts its clock so a job stopped today is never deleted today.
-- The admin is warned 7 days before: the daily run marks a job as warned when it has been idle 23 days, and deletes it
-- only when it is idle 30 days AND has been marked for 7 days - so even a job that is already very old when this
-- is first switched on gets a full 7 days of warning. A new scan clears the mark. The daily run is started by
-- pg_cron (see the end of this file); what it deleted is written to job_purge_log.
alter table public.team_links add column if not exists purge_warned_at timestamptz;

create table if not exists public.job_purge_log (
    id uuid primary key default gen_random_uuid(),
    enterprise_id uuid references public.enterprises(id) on delete cascade,
    job_name text not null,
    tool text not null,
    units bigint not null default 0,
    boxes bigint not null default 0,
    last_activity timestamptz,
    purged_at timestamptz not null default now()
);
create index if not exists job_purge_log_ent_idx on public.job_purge_log(enterprise_id, purged_at desc);
alter table public.job_purge_log enable row level security;       -- no policies: only ws_purge_log (below) reads it reads it
revoke all on public.job_purge_log from anon, authenticated;

-- When a job goes away by itself (null = never):
--  * Box-Item Scan / Year/Season: 30 days after the last scan (or the stop), after a 7-day warning - the data goes too.
--  * Price Check, Box Segregate, Item Barcode, Box Code (they keep no scans): the link is switched off 10 days after its
--    last USE - a labourer joining it, or the usage count of one of its labourers for that tool.
drop function if exists public.team_link_purge_at(text, timestamptz, timestamptz, timestamptz, timestamptz);
create or replace function public.team_link_last_use(p_id uuid, p_tool text, p_created timestamptz)
returns timestamptz
language sql
stable
as $$
    select greatest(p_created,
        coalesce((select max(o.joined_at) from public.team_operators o where o.link_id = p_id), p_created),
        coalesce((select (max(u.day) + 1)::timestamptz
                  from public.usage_daily u join public.team_operators o on o.user_id = u.user_id
                  where o.link_id = p_id
                    and u.tool like case p_tool when 'itemBarcode' then 'item_barcode' when 'boxCode' then 'box_code'
                                                when 'boxSegregate' then 'box_segregate%' when 'priceCheck' then 'price_check' else '-' end), p_created));
$$;
drop function if exists public.team_link_purge_at(uuid, text, timestamptz, timestamptz, timestamptz, timestamptz);
create or replace function public.team_link_purge_at(p_id uuid, p_tool text, p_last_scan_at timestamptz, p_created_at timestamptz, p_stopped_at timestamptz, p_warned_at timestamptz)
returns timestamptz
language sql
stable
as $$
    select case
        when p_tool in ('boxScanner', 'yearSegregate') then
            case when now() >= la + interval '23 days' then greatest(la + interval '30 days', coalesce(p_warned_at, now()) + interval '7 days')
                 else la + interval '30 days' end
        when p_stopped_at is not null then null
        else public.team_link_last_use(p_id, p_tool, p_created_at) + interval '10 days'
    end
    from (select greatest(coalesce(p_last_scan_at, p_created_at), coalesce(p_stopped_at, p_created_at)) as la) x;
$$;

-- Every scan an operator sends is checked and stamped here; nobody can forge the job, the name or the team.
create or replace function public.stamp_operator_scan()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_tier text;
    op record;
    lk record;
    v_tool text := case TG_TABLE_NAME when 'scans' then 'boxScanner' else 'yearSegregate' end;
    v_at timestamptz;
begin
    select tier into v_tier from public.profiles where id = auth.uid();
    if v_tier is distinct from 'operator' then
        new.operator_name := null;       -- only the link mechanism may set these
        new.link_id := null;
        return new;
    end if;

    select * into op from public.team_operators where user_id = auth.uid() order by joined_at desc limit 1;
    if op.id is null or op.removed_at is not null then
        raise exception 'Your access to this job has ended. Ask your admin for the QR code.';
    end if;
    select * into lk from public.team_links where id = op.link_id;
    if lk.tool <> v_tool then
        raise exception 'This QR code is not for this tool.';
    end if;

    v_at := coalesce(new.scanned_at, now());
    if v_at > now() + interval '1 day' then v_at := now(); end if;       -- a wrong clock cannot keep a link alive

    if lk.stopped_at is not null and v_at > lk.stopped_at then
        raise exception 'This job has ended. Ask your admin for the new QR code.';
    end if;

    new.enterprise_id := lk.enterprise_id;
    new.operator_name := op.name;
    new.link_id := lk.id;
    new.remark := lk.job_name;

    update public.team_links
    set last_scan_at = greatest(coalesce(last_scan_at, v_at), v_at), purge_warned_at = null
    where id = lk.id;
    return new;
end;
$$;

-- An existing row keeps its job, name and team (a re-send of the same scan changes nothing here).
create or replace function public.keep_operator_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_tier text;
begin
    if current_setting('app.allow_operator_rename', true) = 'on' then
        return new;
    end if;
    select tier into v_tier from public.profiles where id = auth.uid();
    if v_tier = 'operator' then
        new.enterprise_id := old.enterprise_id;
        new.remark := old.remark;
    end if;
    new.operator_name := old.operator_name;
    new.link_id := old.link_id;
    return new;
end;
$$;

drop trigger if exists scans_stamp_operator on public.scans;
create trigger scans_stamp_operator before insert on public.scans
    for each row execute function public.stamp_operator_scan();
drop trigger if exists scans_keep_operator on public.scans;
create trigger scans_keep_operator before update on public.scans
    for each row execute function public.keep_operator_fields();
drop trigger if exists ys_scans_stamp_operator on public.ys_scans;
create trigger ys_scans_stamp_operator before insert on public.ys_scans
    for each row execute function public.stamp_operator_scan();
drop trigger if exists ys_scans_keep_operator on public.ys_scans;
create trigger ys_scans_keep_operator before update on public.ys_scans
    for each row execute function public.keep_operator_fields();

-- ---- the admin's functions ----

create or replace function public.create_team_link(p_tool text, p_job text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_eid uuid := public.current_user_enterprise_id();
    v_job text := btrim(coalesce(p_job, ''));
    new_link public.team_links;
begin
    if not public.current_user_is_enterprise_admin() then
        raise exception 'Only the enterprise admin can create QR links.';
    end if;
    if p_tool is null or p_tool not in ('boxScanner', 'itemBarcode', 'boxCode', 'boxSegregate', 'priceCheck', 'yearSegregate') then
        raise exception 'Please choose a tool.';
    end if;
    if char_length(v_job) < 1 or char_length(v_job) > 60 then
        raise exception 'Please type a job name (1 to 60 characters).';
    end if;

    -- Several teams can work on one tool at once, each on its own job name. Only a link with the same tool AND the
    -- same job name is replaced (a fresh QR for that job); every other active link is left alone.
    update public.team_links set stopped_at = now()
    where enterprise_id = v_eid and tool = p_tool and stopped_at is null
      and lower(btrim(job_name)) = lower(v_job);

    insert into public.team_links (enterprise_id, tool, job_name, created_by)
    values (v_eid, p_tool, v_job, auth.uid())
    returning * into new_link;

    return jsonb_build_object('id', new_link.id, 'token', new_link.token, 'tool', new_link.tool, 'job_name', new_link.job_name);
end;
$$;

create or replace function public.stop_team_link(p_link_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    if not public.current_user_is_enterprise_admin() then
        raise exception 'Only the enterprise admin can stop QR links.';
    end if;
    update public.team_links set stopped_at = now()
    where id = p_link_id and enterprise_id = public.current_user_enterprise_id() and stopped_at is null;
end;
$$;

-- fixes a typo in a name everywhere (also on the scans already sent)
create or replace function public.rename_team_operator(p_operator_id uuid, p_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_name text := btrim(coalesce(p_name, ''));
    op public.team_operators;
begin
    if not public.current_user_is_enterprise_admin() then
        raise exception 'Only the enterprise admin can rename people.';
    end if;
    if char_length(v_name) < 1 or char_length(v_name) > 40 then
        raise exception 'Please type a name (1 to 40 characters).';
    end if;
    select * into op from public.team_operators where id = p_operator_id and enterprise_id = public.current_user_enterprise_id();
    if op.id is null then raise exception 'That person was not found in your team.'; end if;

    update public.team_operators set name = v_name where id = op.id;
    perform set_config('app.allow_operator_rename', 'on', true);
    update public.scans set operator_name = v_name where link_id = op.link_id and user_id = op.user_id;
    update public.ys_scans set operator_name = v_name where link_id = op.link_id and user_id = op.user_id;
    perform set_config('app.allow_operator_rename', 'off', true);
end;
$$;

-- stops one person from scanning on that job (their earlier scans stay)
create or replace function public.remove_team_operator(p_operator_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    if not public.current_user_is_enterprise_admin() then
        raise exception 'Only the enterprise admin can remove people.';
    end if;
    update public.team_operators set removed_at = now()
    where id = p_operator_id and enterprise_id = public.current_user_enterprise_id() and removed_at is null;
end;
$$;

-- ---- the labourer's functions ----

-- Who does this link belong to? Names only, so the join page can show them BEFORE anybody signs in.
create or replace function public.get_team_link_info(p_token text)
returns table (enterprise_name text, admin_name text, tool text, job_name text, state text)
language sql
security definer
set search_path = public
stable
as $$
    select e.name, coalesce(nullif(p.display_name, ''), p.email), l.tool, l.job_name,
           public.team_link_state(l.stopped_at, l.last_scan_at, l.created_at)
    from public.team_links l
    join public.enterprises e on e.id = l.enterprise_id
    left join public.profiles p on p.id = e.admin_user_id
    where l.token = p_token;
$$;

create or replace function public.join_team_link(p_token text, p_name text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_name text := btrim(coalesce(p_name, ''));
    lk public.team_links;
    op public.team_operators;
begin
    if coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) is not true then
        raise exception 'Only a labourer who scanned the QR can join like this. Admins sign in with Google.';
    end if;
    if char_length(v_name) < 1 or char_length(v_name) > 40 then
        raise exception 'Please type your name (1 to 40 characters).';
    end if;

    select * into lk from public.team_links where token = p_token;
    if lk.id is null then
        raise exception 'This QR code is not valid. Ask your admin for a new one.';
    end if;
    if public.team_link_state(lk.stopped_at, lk.last_scan_at, lk.created_at) = 'stopped' then
        raise exception 'This job has ended. Ask your admin for the new QR code.';
    end if;

    select * into op from public.team_operators where link_id = lk.id and user_id = auth.uid();
    if op.id is not null and op.removed_at is not null then
        raise exception 'You were removed from this job. Ask your admin.';
    end if;

    insert into public.team_operators (enterprise_id, link_id, user_id, name)
    values (lk.enterprise_id, lk.id, auth.uid(), v_name)
    on conflict (link_id, user_id) do update set name = excluded.name, joined_at = now()
    returning * into op;

    update public.profiles
    set tier = 'operator', enterprise_id = lk.enterprise_id, display_name = v_name
    where id = auth.uid();

    return jsonb_build_object('operator_id', op.id, 'link_id', lk.id, 'enterprise_id', lk.enterprise_id,
                              'tool', lk.tool, 'job_name', lk.job_name, 'name', v_name);
end;
$$;

-- The device asks: is my job still open? (state: active | stopped | inactive | removed)
create or replace function public.my_team_link()
returns table (link_id uuid, tool text, job_name text, enterprise_name text, admin_name text, operator_name text, state text)
language sql
security definer
set search_path = public
stable
as $$
    select l.id, l.tool, l.job_name, e.name, coalesce(nullif(p.display_name, ''), p.email), o.name,
           case when o.removed_at is not null then 'removed'
                else public.team_link_state(l.stopped_at, l.last_scan_at, l.created_at) end
    from public.team_operators o
    join public.team_links l on l.id = o.link_id
    join public.enterprises e on e.id = l.enterprise_id
    left join public.profiles p on p.id = e.admin_user_id
    where o.user_id = auth.uid()
    order by o.joined_at desc
    limit 1;
$$;

-- A labourer who leaves a job on their handheld ("Leave this job") is taken off the link: they stop counting as
-- someone who joined and drop out of the admin's list. What they scanned stays. Only their own place.
create or replace function public.leave_team_link()
returns void
language sql
security definer
set search_path = public
as $$
    update public.team_operators set removed_at = now()
    where user_id = auth.uid() and removed_at is null;
$$;
revoke execute on function public.leave_team_link() from public, anon;
grant execute on function public.leave_team_link() to authenticated;

revoke execute on function public.create_team_link(text, text) from public, anon;
revoke execute on function public.stop_team_link(uuid) from public, anon;
revoke execute on function public.rename_team_operator(uuid, text) from public, anon;
revoke execute on function public.remove_team_operator(uuid) from public, anon;
revoke execute on function public.join_team_link(text, text) from public, anon;
revoke execute on function public.my_team_link() from public, anon;
grant execute on function public.create_team_link(text, text) to authenticated;
grant execute on function public.stop_team_link(uuid) to authenticated;
grant execute on function public.rename_team_operator(uuid, text) to authenticated;
grant execute on function public.remove_team_operator(uuid) to authenticated;
grant execute on function public.join_team_link(text, text) to authenticated;
grant execute on function public.my_team_link() to authenticated;
grant execute on function public.get_team_link_info(text) to anon, authenticated;


-- Restrictive policies (they are ANDed with the permissive ones above): an unjoined anonymous device can
-- neither read nor write these tables.
drop policy if exists "block_unjoined_anon" on public.scans;
create policy "block_unjoined_anon" on public.scans as restrictive for all to authenticated
    using (not (select public.is_unjoined_anon())) with check (not (select public.is_unjoined_anon()));
drop policy if exists "block_unjoined_anon" on public.ys_scans;
create policy "block_unjoined_anon" on public.ys_scans as restrictive for all to authenticated
    using (not (select public.is_unjoined_anon())) with check (not (select public.is_unjoined_anon()));
drop policy if exists "block_unjoined_anon" on public.enterprises;
create policy "block_unjoined_anon" on public.enterprises as restrictive for all to authenticated
    using (not (select public.is_unjoined_anon())) with check (not (select public.is_unjoined_anon()));
drop policy if exists "block_unjoined_anon" on public.reference_chunks;
create policy "block_unjoined_anon" on public.reference_chunks as restrictive for all to authenticated
    using (not (select public.is_unjoined_anon())) with check (not (select public.is_unjoined_anon()));


-- Existing individual accounts become their own team (runs every time; does nothing once everybody has one).
select public.make_own_team(id) from public.profiles
where tier = 'individual' and enterprise_id is null and coalesce(email, '') <> '';

-- ============================================
-- ROLLED BACK: self-service account deletion
-- ============================================
-- delete_my_account() was added and then removed again (owner's decision). If an earlier version of this
-- file was run on your database, this line removes the function; it does nothing otherwise.
drop function if exists public.delete_my_account();


-- ============================================
-- TEAM & DATA WORKSPACE (admin screens: Overview, Jobs, People, Data)
-- ============================================
-- Everything here is for the enterprise ADMIN and works on summaries computed in the database, one page at a
-- time, so the screens stay fast with many jobs, people and scans. Nothing here changes or removes the older
-- functions (the older Data Management window still uses them for members and individuals).
--  * "job" = one Team QR link. A scan's job name is its Remark, so unlinked (older) scans can be found by Remark too.
--  * lists return at most 100 rows a page (the API itself returns at most about 1000 rows per request)
--  * deletes are by filter, and only rows scanned up to the moment the download started are removed
create index if not exists scans_link_id_idx on public.scans(link_id) where link_id is not null;
create index if not exists ys_scans_link_id_idx on public.ys_scans(link_id) where link_id is not null;
create index if not exists scans_ent_time_idx on public.scans(enterprise_id, scanned_at desc);
create index if not exists ys_scans_ent_time_idx on public.ys_scans(enterprise_id, scanned_at desc);
create index if not exists scans_ent_remark_idx on public.scans(enterprise_id, remark);
create index if not exists ys_scans_ent_remark_idx on public.ys_scans(enterprise_id, remark);

-- ---- Jobs ----

drop function if exists public.ws_jobs(text, text, text, text, integer, integer);
create or replace function public.ws_jobs(
    p_search text default '', p_tool text default '', p_status text default 'active', p_sort text default 'last_scan',
    p_limit integer default 25, p_offset integer default 0)
returns table (id uuid, tool text, job_name text, token text, created_at timestamptz, stopped_at timestamptz,
               last_scan_at timestamptz, state text, people bigint, boxes bigint, units bigint, total_count bigint,
               purge_at timestamptz)
language sql
security definer
set search_path = public
stable
as $$
    with page as (
        select l.*, count(*) over () as total
        from public.team_links l
        where public.current_user_is_enterprise_admin()
          and l.enterprise_id = public.current_user_enterprise_id()
          and (coalesce(p_tool, '') = '' or l.tool = p_tool)
          and (coalesce(p_status, 'active') = 'all'
               or (coalesce(p_status, 'active') = 'active' and l.stopped_at is null)
               or (p_status = 'stopped' and l.stopped_at is not null))
          and (btrim(coalesce(p_search, '')) = '' or l.job_name ilike '%' || btrim(p_search) || '%'
               or exists (select 1 from public.team_operators o where o.link_id = l.id and o.removed_at is null and o.name ilike '%' || btrim(p_search) || '%'))
        order by (case when p_sort = 'name' then lower(l.job_name) end) asc,
                 (case when p_sort = 'created' then l.created_at end) desc,
                 coalesce(l.last_scan_at, l.created_at) desc, l.id
        limit least(greatest(coalesce(p_limit, 25), 1), 100) offset greatest(coalesce(p_offset, 0), 0)
    )
    select pg.id, pg.tool, pg.job_name, pg.token, pg.created_at, pg.stopped_at, pg.last_scan_at,
           public.team_link_state(pg.stopped_at, pg.last_scan_at, pg.created_at),
           (select count(*) from public.team_operators o
             where o.link_id = pg.id and o.removed_at is null
               and o.joined_at = (select max(x.joined_at) from public.team_operators x where x.user_id = o.user_id and x.removed_at is null)),
           coalesce(a.boxes, 0), coalesce(a.units, 0), pg.total,
           public.team_link_purge_at(pg.id, pg.tool, pg.last_scan_at, pg.created_at, pg.stopped_at, pg.purge_warned_at)
    from page pg
    left join lateral (
        select count(distinct t.box) filter (where t.st = 'Closed') as boxes, sum(t.qty)::bigint as units
        from (select s.box_number as box, s.box_status as st, s.qty from public.scans s where s.link_id = pg.id and pg.tool <> 'yearSegregate'
              union all
              select y.box_barcode, y.box_status, y.qty from public.ys_scans y where y.link_id = pg.id and pg.tool = 'yearSegregate') t
    ) a on true
    order by (case when p_sort = 'name' then lower(pg.job_name) end) asc,
             (case when p_sort = 'created' then pg.created_at end) desc,
             coalesce(pg.last_scan_at, pg.created_at) desc, pg.id;
$$;

-- the boxes of one job (paged), newest first
drop function if exists public.ws_job_boxes(uuid, text, integer, integer);
create or replace function public.ws_job_boxes(p_link_id uuid, p_search text default '', p_limit integer default 25, p_offset integer default 0)
returns table (box text, status text, items bigint, scanned_by text, last_at timestamptz, total_count bigint)
language sql
security definer
set search_path = public
stable
as $$
    with lk as (
        select * from public.team_links
        where id = p_link_id and public.current_user_is_enterprise_admin() and enterprise_id = public.current_user_enterprise_id()
    ),
    r as (
        select s.box_number as box, s.box_status as st, s.qty, s.operator_name as who, s.scanned_at, s.barcode
        from public.scans s join lk on lk.id = s.link_id where lk.tool <> 'yearSegregate'
        union all
        select y.box_barcode, y.box_status, y.qty, y.operator_name, y.scanned_at, y.barcode
        from public.ys_scans y join lk on lk.id = y.link_id where lk.tool = 'yearSegregate'
    ),
    f as (
        select * from r
        where btrim(coalesce(p_search, '')) = ''
           or box ilike '%' || btrim(p_search) || '%' or barcode ilike '%' || btrim(p_search) || '%' or who ilike '%' || btrim(p_search) || '%'
    ),
    g as (
        select box, case when bool_and(st = 'Closed') then 'Closed' else 'Open' end as status, sum(qty)::bigint as items,
               (array_agg(who order by scanned_at desc))[1] as who, max(scanned_at) as last_at
        from f group by box
    )
    select g.box, g.status, g.items, g.who, g.last_at, count(*) over ()
    from g order by g.last_at desc, g.box
    limit least(greatest(coalesce(p_limit, 25), 1), 100) offset greatest(coalesce(p_offset, 0), 0);
$$;

-- the people of one job with their own totals
drop function if exists public.ws_job_people(uuid);
create or replace function public.ws_job_people(p_link_id uuid)
returns table (operator_id uuid, name text, joined_at timestamptz, removed_at timestamptz, boxes bigint, units bigint, last_at timestamptz)
language sql
security definer
set search_path = public
stable
as $$
    select o.id, o.name, o.joined_at, o.removed_at, coalesce(a.boxes, 0), coalesce(a.units, 0), a.last_at
    from public.team_operators o
    join public.team_links l on l.id = o.link_id
    left join lateral (
        select count(distinct t.box) filter (where t.st = 'Closed') as boxes, sum(t.qty)::bigint as units, max(t.at) as last_at
        from (select s.box_number as box, s.box_status as st, s.qty, s.scanned_at as at from public.scans s
               where s.link_id = o.link_id and s.user_id = o.user_id and l.tool <> 'yearSegregate'
              union all
              select y.box_barcode, y.box_status, y.qty, y.scanned_at from public.ys_scans y
               where y.link_id = o.link_id and y.user_id = o.user_id and l.tool = 'yearSegregate') t
    ) a on true
    where o.link_id = p_link_id
      and public.current_user_is_enterprise_admin() and l.enterprise_id = public.current_user_enterprise_id()
    order by (o.removed_at is not null), lower(o.name);
$$;

-- units per hour for the last p_hours hours (zero-filled), for the Activity tab
drop function if exists public.ws_job_activity(uuid, integer);
create or replace function public.ws_job_activity(p_link_id uuid, p_hours integer default 24)
returns table (hour timestamptz, units bigint)
language sql
security definer
set search_path = public
stable
as $$
    with lk as (
        select * from public.team_links
        where id = p_link_id and public.current_user_is_enterprise_admin() and enterprise_id = public.current_user_enterprise_id()
    ),
    h as (
        select generate_series(date_trunc('hour', now()) - make_interval(hours => least(greatest(coalesce(p_hours, 24), 1), 168) - 1),
                               date_trunc('hour', now()), interval '1 hour') as hr
    ),
    s as (
        select date_trunc('hour', x.at) as hr, sum(x.qty) as q
        from (select sc.scanned_at as at, sc.qty from public.scans sc join lk on lk.id = sc.link_id where lk.tool <> 'yearSegregate'
              union all
              select ys.scanned_at, ys.qty from public.ys_scans ys join lk on lk.id = ys.link_id where lk.tool = 'yearSegregate') x
        where x.at >= date_trunc('hour', now()) - make_interval(hours => least(greatest(coalesce(p_hours, 24), 1), 168) - 1)
        group by 1
    )
    select h.hr, coalesce(s.q, 0)::bigint from h left join s on s.hr = h.hr
    where exists (select 1 from lk)
    order by h.hr;
$$;

-- ---- Data explorer: one filter, used by the list, the export and the delete ----
-- Internal helper (not callable from the API): the scans of one enterprise that match the filters, from the table of
-- the chosen tool. p_jobs holds Remarks (job names); capitals and end spaces do not matter.
drop function if exists public.ws_filtered_scans(uuid, text, text[], text, timestamptz, timestamptz, text, text);
create or replace function public.ws_filtered_scans(
    p_ent uuid, p_tool text, p_jobs text[], p_person text, p_from timestamptz, p_to timestamptz, p_status text, p_search text,
    p_boxes text[] default null)
returns table (id uuid, scanned_at timestamptz, user_id uuid, remark text, person text, box text, barcode text,
               qty integer, status text, extra jsonb)
language sql
stable
as $$
    select s.id, s.scanned_at, s.user_id, s.remark, coalesce(nullif(s.operator_name, ''), nullif(p.display_name, ''), p.email, ''),
           s.box_number, s.barcode, s.qty, s.box_status, null::jsonb
    from public.scans s join public.profiles p on p.id = s.user_id
    where p_tool = 'boxScanner' and s.enterprise_id = p_ent
      and (p_jobs is null or lower(btrim(coalesce(s.remark, ''))) = any (array(select lower(btrim(j)) from unnest(p_jobs) j)))
      and (coalesce(p_person, '') = '' or lower(coalesce(nullif(s.operator_name, ''), nullif(p.display_name, ''), p.email, '')) = lower(btrim(p_person)))
      and (p_from is null or s.scanned_at >= p_from) and (p_to is null or s.scanned_at < p_to)
      and (coalesce(p_status, '') = '' or s.box_status = p_status)
      and (p_boxes is null or (lower(btrim(coalesce(s.remark, ''))) || chr(1) || s.box_number) = any (p_boxes))
      and (btrim(coalesce(p_search, '')) = '' or s.box_number ilike '%' || btrim(p_search) || '%' or s.barcode ilike '%' || btrim(p_search) || '%'
           or s.remark ilike '%' || btrim(p_search) || '%' or s.operator_name ilike '%' || btrim(p_search) || '%' or p.display_name ilike '%' || btrim(p_search) || '%')
    union all
    select y.id, y.scanned_at, y.user_id, y.remark, coalesce(nullif(y.operator_name, ''), nullif(p.display_name, ''), p.email, ''),
           y.box_barcode, y.barcode, y.qty, y.box_status,
           jsonb_build_object('ptl', y.ptl_number, 'season', y.season, 'year', y.year, 'brand', y.brand, 'staff', y.staff_name, 'ts', y.scan_timestamp)
    from public.ys_scans y join public.profiles p on p.id = y.user_id
    where p_tool = 'yearSegregate' and y.enterprise_id = p_ent
      and (p_jobs is null or lower(btrim(coalesce(y.remark, ''))) = any (array(select lower(btrim(j)) from unnest(p_jobs) j)))
      and (coalesce(p_person, '') = '' or lower(coalesce(nullif(y.operator_name, ''), nullif(p.display_name, ''), p.email, '')) = lower(btrim(p_person)))
      and (p_from is null or y.scanned_at >= p_from) and (p_to is null or y.scanned_at < p_to)
      and (coalesce(p_status, '') = '' or y.box_status = p_status)
      and (p_boxes is null or (lower(btrim(coalesce(y.remark, ''))) || chr(1) || y.box_barcode) = any (p_boxes))
      and (btrim(coalesce(p_search, '')) = '' or y.box_barcode ilike '%' || btrim(p_search) || '%' or y.barcode ilike '%' || btrim(p_search) || '%'
           or y.remark ilike '%' || btrim(p_search) || '%' or y.operator_name ilike '%' || btrim(p_search) || '%' or p.display_name ilike '%' || btrim(p_search) || '%');
$$;
revoke execute on function public.ws_filtered_scans(uuid, text, text[], text, timestamptz, timestamptz, text, text, text[]) from public, anon, authenticated;

-- a page of boxes that match, plus the totals of everything that matches
drop function if exists public.ws_data_boxes(text, text[], text, timestamptz, timestamptz, text, text, integer, integer);
create or replace function public.ws_data_boxes(
    p_tool text, p_jobs text[], p_person text, p_from timestamptz, p_to timestamptz, p_status text, p_search text,
    p_limit integer default 50, p_offset integer default 0)
returns table (box text, job text, person text, status text, items bigint, last_at timestamptz, total_boxes bigint, total_units bigint, total_rows bigint)
language sql
security definer
set search_path = public
stable
as $$
    with f as (
        select * from public.ws_filtered_scans(public.current_user_enterprise_id(), p_tool, p_jobs, p_person, p_from, p_to, p_status, p_search)
        where public.current_user_is_enterprise_admin()
    ),
    g as (
        select f.box, f.remark as job, (array_agg(f.person order by f.scanned_at desc))[1] as person,
               case when bool_and(f.status = 'Closed') then 'Closed' else 'Open' end as status,
               sum(f.qty)::bigint as items, max(f.scanned_at) as last_at, count(*)::bigint as n
        from f group by f.box, f.remark
    )
    select g.box, g.job, g.person, g.status, g.items, g.last_at, count(*) over (), sum(g.items) over ()::bigint, sum(g.n) over ()::bigint
    from g order by g.last_at desc, g.box, g.job
    limit least(greatest(coalesce(p_limit, 50), 1), 100) offset greatest(coalesce(p_offset, 0), 0);
$$;

-- the scan rows behind a filter, for downloads: keyset-paged, at most 1000 per call
drop function if exists public.ws_data_rows(text, text[], text, timestamptz, timestamptz, text, text, timestamptz, uuid, timestamptz, integer);
drop function if exists public.ws_data_rows(text, text[], text, timestamptz, timestamptz, text, text, timestamptz, uuid, timestamptz, integer, text[]);
create or replace function public.ws_data_rows(
    p_tool text, p_jobs text[], p_person text, p_from timestamptz, p_to timestamptz, p_status text, p_search text,
    p_after_at timestamptz default null, p_after_id uuid default null, p_until timestamptz default null, p_limit integer default 1000,
    p_boxes text[] default null)
returns table (id uuid, scanned_at timestamptz, person text, job text, box text, barcode text, qty integer, status text, extra jsonb)
language sql
security definer
set search_path = public
stable
as $$
    select f.id, f.scanned_at, f.person, f.remark, f.box, f.barcode, f.qty, f.status, f.extra
    from public.ws_filtered_scans(public.current_user_enterprise_id(), p_tool, p_jobs, p_person, p_from, p_to, p_status, p_search, p_boxes) f
    where public.current_user_is_enterprise_admin()
      and (p_until is null or f.scanned_at <= p_until)
      and (p_after_at is null or (f.scanned_at, f.id) > (p_after_at, coalesce(p_after_id, '00000000-0000-0000-0000-000000000000'::uuid)))
    order by f.scanned_at, f.id
    limit least(greatest(coalesce(p_limit, 1000), 1), 1000);
$$;

-- deletes everything that matches the filter and was scanned up to p_until (the moment the download started)
drop function if exists public.ws_data_delete(text, text[], text, timestamptz, timestamptz, text, text, timestamptz);
drop function if exists public.ws_data_delete(text, text[], text, timestamptz, timestamptz, text, text, timestamptz, text[]);
create or replace function public.ws_data_delete(
    p_tool text, p_jobs text[], p_person text, p_from timestamptz, p_to timestamptz, p_status text, p_search text, p_until timestamptz,
    p_boxes text[] default null)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
    v_eid uuid := public.current_user_enterprise_id();
    n bigint := 0;
begin
    if not public.current_user_is_enterprise_admin() then
        raise exception 'Only the enterprise admin can delete team data.';
    end if;
    if p_until is null then
        raise exception 'Delete needs the time the download started.';
    end if;
    if p_tool = 'boxScanner' then
        with d as (
            delete from public.scans where id in (
                select f.id from public.ws_filtered_scans(v_eid, p_tool, p_jobs, p_person, p_from, p_to, p_status, p_search, p_boxes) f where f.scanned_at <= p_until)
            returning 1)
        select count(*) into n from d;
    elsif p_tool = 'yearSegregate' then
        with d as (
            delete from public.ys_scans where id in (
                select f.id from public.ws_filtered_scans(v_eid, p_tool, p_jobs, p_person, p_from, p_to, p_status, p_search, p_boxes) f where f.scanned_at <= p_until)
            returning 1)
        select count(*) into n from d;
    else
        raise exception 'Please choose a tool.';
    end if;
    return n;
end;
$$;

-- values for the Job and Person pickers (searchable, at most 50)
drop function if exists public.ws_facets(text, text, text, integer);
create or replace function public.ws_facets(p_kind text, p_tool text, p_search text default '', p_limit integer default 50)
returns table (value text, units bigint)
language sql
security definer
set search_path = public
stable
as $$
    select v, sum(q)::bigint from (
        select case when p_kind = 'job' then coalesce(s.remark, '') else coalesce(nullif(s.operator_name, ''), nullif(p.display_name, ''), p.email, '') end as v, s.qty as q
        from public.scans s join public.profiles p on p.id = s.user_id
        where p_tool = 'boxScanner' and s.enterprise_id = public.current_user_enterprise_id()
        union all
        select case when p_kind = 'job' then coalesce(y.remark, '') else coalesce(nullif(y.operator_name, ''), nullif(p.display_name, ''), p.email, '') end, y.qty
        from public.ys_scans y join public.profiles p on p.id = y.user_id
        where p_tool = 'yearSegregate' and y.enterprise_id = public.current_user_enterprise_id()
    ) t
    where public.current_user_is_enterprise_admin() and p_kind in ('job', 'person') and v <> ''
      and (btrim(coalesce(p_search, '')) = '' or v ilike '%' || btrim(p_search) || '%')
    group by v order by sum(q) desc, v
    limit least(greatest(coalesce(p_limit, 50), 1), 50);
$$;

-- ---- People ----
-- Labourers (joined by QR) are one person per name, whatever handheld or job; Google accounts are one person each.
-- Sorted by name, so only the people on the page need their scan totals worked out.
create index if not exists scans_ent_op_idx on public.scans(enterprise_id, lower(btrim(operator_name))) where operator_name is not null;
create index if not exists ys_scans_ent_op_idx on public.ys_scans(enterprise_id, lower(btrim(operator_name))) where operator_name is not null;


revoke execute on function public.ws_jobs(text, text, text, text, integer, integer) from public, anon;
revoke execute on function public.ws_job_boxes(uuid, text, integer, integer) from public, anon;
revoke execute on function public.ws_job_people(uuid) from public, anon;
revoke execute on function public.ws_job_activity(uuid, integer) from public, anon;
revoke execute on function public.ws_data_boxes(text, text[], text, timestamptz, timestamptz, text, text, integer, integer) from public, anon;
revoke execute on function public.ws_data_rows(text, text[], text, timestamptz, timestamptz, text, text, timestamptz, uuid, timestamptz, integer, text[]) from public, anon;
revoke execute on function public.ws_data_delete(text, text[], text, timestamptz, timestamptz, text, text, timestamptz, text[]) from public, anon;
revoke execute on function public.ws_facets(text, text, text, integer) from public, anon;
grant execute on function public.ws_jobs(text, text, text, text, integer, integer) to authenticated;
grant execute on function public.ws_job_boxes(uuid, text, integer, integer) to authenticated;
grant execute on function public.ws_job_people(uuid) to authenticated;
grant execute on function public.ws_job_activity(uuid, integer) to authenticated;
grant execute on function public.ws_data_boxes(text, text[], text, timestamptz, timestamptz, text, text, integer, integer) to authenticated;
grant execute on function public.ws_data_rows(text, text[], text, timestamptz, timestamptz, text, text, timestamptz, uuid, timestamptz, integer, text[]) to authenticated;
grant execute on function public.ws_data_delete(text, text[], text, timestamptz, timestamptz, text, text, timestamptz, text[]) to authenticated;
grant execute on function public.ws_facets(text, text, text, integer) to authenticated;

-- ============================================
-- AUTOMATIC CLEAN-UP OF IDLE JOBS: the daily run
-- ============================================
-- purge_inactive_jobs(true)  = look only: lists what would be marked and what would be deleted, changes nothing
-- purge_inactive_jobs(false) = does it (this is what the daily schedule runs)
drop function if exists public.purge_inactive_jobs(boolean);
create or replace function public.purge_inactive_jobs(p_dry_run boolean default false)
returns table (job_name text, tool text, enterprise_id uuid, units bigint, last_activity timestamptz, action text)
language plpgsql
security definer
set search_path = public
as $$
declare
    lk record;
    v_units bigint;
    v_boxes bigint;
begin
    -- a job that is active again (new scan, or stopped later) is no longer marked
    if not p_dry_run then
        update public.team_links l set purge_warned_at = null
        where l.purge_warned_at is not null
          and (l.tool not in ('boxScanner', 'yearSegregate')
               or now() < greatest(coalesce(l.last_scan_at, l.created_at), coalesce(l.stopped_at, l.created_at)) + interval '23 days');
    end if;

    -- 0. links of tools that keep no data (Price Check, Box Segregate, Item Barcode, Box Code): switched off after 10 days without use
    for lk in
        select l.* from public.team_links l
        where l.tool not in ('boxScanner', 'yearSegregate') and l.stopped_at is null
          and now() >= public.team_link_last_use(l.id, l.tool, l.created_at) + interval '10 days'
    loop
        if not p_dry_run then update public.team_links set stopped_at = now() where id = lk.id; end if;
        job_name := lk.job_name; tool := lk.tool; enterprise_id := lk.enterprise_id; units := null;
        last_activity := public.team_link_last_use(lk.id, lk.tool, lk.created_at); action := 'expire';
        return next;
    end loop;

    -- 1. idle 23 days: mark it (the admin sees the date in Team & Data)
    for lk in
        select l.* from public.team_links l
        where l.tool in ('boxScanner', 'yearSegregate') and l.purge_warned_at is null
          and now() >= greatest(coalesce(l.last_scan_at, l.created_at), coalesce(l.stopped_at, l.created_at)) + interval '23 days'
    loop
        if not p_dry_run then update public.team_links set purge_warned_at = now() where id = lk.id; end if;
        job_name := lk.job_name; tool := lk.tool; enterprise_id := lk.enterprise_id; units := null;
        last_activity := greatest(coalesce(lk.last_scan_at, lk.created_at), coalesce(lk.stopped_at, lk.created_at)); action := 'warn';
        return next;
    end loop;

    -- 2. idle 30 days and marked for at least 7 days: delete the data, the labourers and the link
    for lk in
        select l.* from public.team_links l
        where l.tool in ('boxScanner', 'yearSegregate') and l.purge_warned_at is not null
          and l.purge_warned_at <= now() - interval '7 days'
          and now() >= greatest(coalesce(l.last_scan_at, l.created_at), coalesce(l.stopped_at, l.created_at)) + interval '30 days'
    loop
        if lk.tool = 'yearSegregate' then
            select coalesce(sum(y.qty), 0), count(distinct y.box_barcode) filter (where y.box_status = 'Closed') into v_units, v_boxes from public.ys_scans y where y.link_id = lk.id;
        else
            select coalesce(sum(s.qty), 0), count(distinct s.box_number) filter (where s.box_status = 'Closed') into v_units, v_boxes from public.scans s where s.link_id = lk.id;
        end if;
        if not p_dry_run then
            if lk.tool = 'yearSegregate' then delete from public.ys_scans where link_id = lk.id; else delete from public.scans where link_id = lk.id; end if;
            insert into public.job_purge_log (enterprise_id, job_name, tool, units, boxes, last_activity)
            values (lk.enterprise_id, lk.job_name, lk.tool, v_units, v_boxes,
                    greatest(coalesce(lk.last_scan_at, lk.created_at), coalesce(lk.stopped_at, lk.created_at)));
            delete from public.team_links where id = lk.id;            -- its labourers (team_operators) go with it
        end if;
        job_name := lk.job_name; tool := lk.tool; enterprise_id := lk.enterprise_id; units := v_units;
        last_activity := greatest(coalesce(lk.last_scan_at, lk.created_at), coalesce(lk.stopped_at, lk.created_at)); action := 'delete';
        return next;
    end loop;
end;
$$;
revoke execute on function public.purge_inactive_jobs(boolean) from public, anon, authenticated;

-- The daily schedule (03:15 UTC) needs the pg_cron extension: enable it once in the Supabase dashboard
-- (Database > Extensions > pg_cron). This block does nothing - and never fails - when pg_cron is not enabled yet;
-- run this file again after enabling it. To check:  select jobid, jobname, schedule, active from cron.job;
-- To look at what it would do right now:           select * from public.purge_inactive_jobs(true);
-- To switch the automatic clean-up off:             select cron.unschedule('purge-inactive-jobs');
do $cron$
begin
    if exists (select 1 from pg_extension where extname = 'pg_cron') then
        begin
            perform cron.unschedule('purge-inactive-jobs');
        exception when others then null;                    -- it was not scheduled yet
        end;
        perform cron.schedule('purge-inactive-jobs', '15 3 * * *', 'select count(*) from public.purge_inactive_jobs(false)');
    else
        raise notice 'pg_cron is not enabled: idle jobs will NOT be cleaned up automatically until you enable it and run this file again.';
    end if;
end
$cron$;

-- what the daily run deleted in the last 30 days, for the admin's own team
drop function if exists public.ws_purge_log();
create or replace function public.ws_purge_log()
returns table (job text, tool text, units bigint, purged_at timestamptz)
language sql
security definer
set search_path = public
stable
as $$
    select l.job_name, l.tool, l.units, l.purged_at from public.job_purge_log l
    where public.current_user_is_enterprise_admin() and l.enterprise_id = public.current_user_enterprise_id()
      and l.purged_at >= now() - interval '30 days'
    order by l.purged_at desc limit 10;
$$;
revoke execute on function public.ws_purge_log() from public, anon;
grant execute on function public.ws_purge_log() to authenticated;

-- ============================================
-- REMOVED OBJECTS (cleaned out of an existing database each time this file is run; nothing here is used any more)
-- ============================================
-- E-mail invitations (replaced by Team QR links) and the old Data Management window (replaced by Team & Data).
drop function if exists public.create_enterprise(text);
drop function if exists public.team_member_stats();
drop function if exists public.team_ys_member_stats();
drop function if exists public.search_team_scans(text, int);
drop function if exists public.list_team_links();
drop function if exists public.list_team_operators();
drop table if exists public.enterprise_invites;
-- the Overview and People screens were folded into Jobs & People / Data
drop function if exists public.ws_overview(timestamptz, integer);
drop function if exists public.ws_people(text, text, integer, integer);
drop function if exists public.remove_enterprise_member(uuid);

-- Make the API (PostgREST) notice new or changed functions straight away (harmless if nothing changed).
notify pgrst, 'reload schema';
