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

create table if not exists public.enterprise_invites (
    id uuid primary key default gen_random_uuid(),
    enterprise_id uuid not null references public.enterprises(id) on delete cascade,
    invited_email text not null,
    status text not null default 'pending' check (status in ('pending', 'accepted', 'expired')),
    token uuid not null default gen_random_uuid(),
    invited_by uuid not null references auth.users(id) on delete cascade,
    created_at timestamptz not null default now(),
    expires_at timestamptz not null default (now() + interval '7 days')
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

create or replace function public.current_user_is_enterprise_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
    select coalesce((select tier = 'enterprise_admin' from public.profiles where id = auth.uid()), false);
$$;

create or replace function public.current_user_email()
returns text
language sql
security definer
set search_path = public
stable
as $$
    select email from auth.users where id = auth.uid();
$$;

grant execute on function public.current_user_email() to authenticated;

-- ============================================
-- CONTROLLED TIER/ENTERPRISE TRANSITIONS
-- ============================================
-- tier and enterprise_id can ONLY change through these two functions (table
-- UPDATE on those columns is revoked above). Each one does its own validation
-- before touching anything, so there's no path to attach yourself to an
-- enterprise you don't belong to.

create or replace function public.create_enterprise(enterprise_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
    new_enterprise_id uuid;
    caller_enterprise_id uuid;
begin
    select enterprise_id into caller_enterprise_id from public.profiles where id = auth.uid();
    if caller_enterprise_id is not null then
        raise exception 'You already belong to an enterprise.';
    end if;

    insert into public.enterprises (name, admin_user_id)
    values (enterprise_name, auth.uid())
    returning id into new_enterprise_id;

    update public.profiles
    set tier = 'enterprise_admin', enterprise_id = new_enterprise_id
    where id = auth.uid();

    return new_enterprise_id;
end;
$$;

create or replace function public.accept_enterprise_invite(invite_token uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
    matched_invite record;
    caller_email text;
    caller_enterprise_id uuid;
begin
    select email into caller_email from auth.users where id = auth.uid();
    select enterprise_id into caller_enterprise_id from public.profiles where id = auth.uid();

    if caller_enterprise_id is not null then
        raise exception 'You already belong to an enterprise.';
    end if;

    select * into matched_invite
    from public.enterprise_invites
    where token = invite_token
      and status = 'pending'
      and expires_at > now()
      and lower(invited_email) = lower(caller_email);

    if matched_invite is null then
        raise exception 'Invite not found, already used, or expired.';
    end if;

    update public.profiles
    set tier = 'enterprise_member', enterprise_id = matched_invite.enterprise_id
    where id = auth.uid();

    update public.enterprise_invites
    set status = 'accepted'
    where id = matched_invite.id;

    return true;
end;
$$;

create or replace function public.remove_enterprise_member(member_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
    target_enterprise_id uuid;
begin
    if not public.current_user_is_enterprise_admin() then
        raise exception 'Only an enterprise admin can remove a member.';
    end if;
    if member_user_id = auth.uid() then
        raise exception 'Cannot remove yourself.';
    end if;

    select enterprise_id into target_enterprise_id from public.profiles where id = member_user_id;
    if target_enterprise_id is null or target_enterprise_id != public.current_user_enterprise_id() then
        raise exception 'That user is not a member of your enterprise.';
    end if;

    update public.profiles
    set tier = 'individual', enterprise_id = null
    where id = member_user_id;

    return true;
end;
$$;

grant execute on function public.create_enterprise(text) to authenticated;
grant execute on function public.accept_enterprise_invite(uuid) to authenticated;
grant execute on function public.remove_enterprise_member(uuid) to authenticated;

-- ============================================
-- TEAM MANAGEMENT - READ-ONLY, ADMIN-ONLY RPCS
-- ============================================
-- Both scoped to the caller's own enterprise and gated on admin status inside
-- the function body (not just by who can call it) - also protects direct
-- PostgREST calls, not just UI buttons.

create or replace function public.team_member_stats()
returns table (
    user_id uuid,
    display_name text,
    email text,
    boxes_closed bigint,
    total_qty bigint
)
language sql
security definer
set search_path = public
stable
as $$
    with my_scans as (
        select * from public.scans
        where enterprise_id = public.current_user_enterprise_id()
    ),
    box_status_per_user as (
        select user_id, box_number, bool_and(box_status = 'Closed') as closed
        from my_scans
        group by user_id, box_number
    )
    select
        p.id as user_id,
        p.display_name,
        p.email,
        coalesce((select count(*) from box_status_per_user b where b.user_id = p.id and b.closed), 0) as boxes_closed,
        coalesce((select sum(qty) from my_scans s where s.user_id = p.id), 0) as total_qty
    from public.profiles p
    where p.enterprise_id = public.current_user_enterprise_id()
      and public.current_user_is_enterprise_admin();
$$;

-- Return type gained `remark`, and CREATE OR REPLACE cannot change a function's
-- return type, so drop the old version first.
drop function if exists public.search_team_scans(text, int);
create or replace function public.search_team_scans(search_term text, limit_count int default 100)
returns table (
    id uuid,
    remark text,
    barcode text,
    box_number text,
    box_status text,
    qty integer,
    scanned_at timestamptz,
    user_id uuid,
    display_name text,
    email text
)
language sql
security definer
set search_path = public
stable
as $$
    select s.id, s.remark, s.barcode, s.box_number, s.box_status, s.qty, s.scanned_at, s.user_id, p.display_name, p.email
    from public.scans s
    join public.profiles p on p.id = s.user_id
    where s.enterprise_id = public.current_user_enterprise_id()
      and public.current_user_is_enterprise_admin()
      and (
        s.barcode ilike '%' || search_term || '%'
        or s.box_number ilike '%' || search_term || '%'
        or p.display_name ilike '%' || search_term || '%'
        or p.email ilike '%' || search_term || '%'
      )
    order by s.scanned_at desc
    limit limit_count;
$$;

grant execute on function public.team_member_stats() to authenticated;
grant execute on function public.search_team_scans(text, int) to authenticated;

-- ============================================
-- ROW LEVEL SECURITY
-- ============================================

alter table public.profiles enable row level security;
alter table public.enterprises enable row level security;
alter table public.enterprise_invites enable row level security;
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
-- below (create_enterprise / accept_enterprise_invite), which contain their own checks.
revoke update on public.profiles from authenticated;
grant update (display_name) on public.profiles to authenticated;

-- enterprises
drop policy if exists "enterprises_select_member" on public.enterprises;
create policy "enterprises_select_member" on public.enterprises for select
    using (id = public.current_user_enterprise_id() or admin_user_id = auth.uid());

drop policy if exists "enterprises_insert_self" on public.enterprises;
create policy "enterprises_insert_self" on public.enterprises for insert
    with check (admin_user_id = auth.uid());

-- Direct insert is blocked in favor of create_enterprise() below, so creating the
-- enterprise row and promoting the caller to enterprise_admin happen atomically -
-- otherwise a crashed/partial request could leave an orphaned enterprise with no
-- admin profile pointing at it, or an admin profile pointing at nothing.
revoke insert on public.enterprises from authenticated;

drop policy if exists "enterprises_update_admin" on public.enterprises;
create policy "enterprises_update_admin" on public.enterprises for update
    using (admin_user_id = auth.uid());

-- enterprise_invites — only the enterprise's own admin can manage invites
drop policy if exists "invites_all_admin" on public.enterprise_invites;
create policy "invites_all_admin" on public.enterprise_invites for all
    using (
        enterprise_id = public.current_user_enterprise_id()
        and public.current_user_is_enterprise_admin()
    )
    with check (
        enterprise_id = public.current_user_enterprise_id()
        and public.current_user_is_enterprise_admin()
        and invited_by = auth.uid()
    );

-- An invited (not-yet-member) user needs to be able to see their own pending
-- invite to accept it - the policy above only covers the inviting admin.
drop policy if exists "invites_select_invitee" on public.enterprise_invites;
create policy "invites_select_invitee" on public.enterprise_invites for select
    using (lower(invited_email) = lower(public.current_user_email()));

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

-- Per-member summary for the Team console's Year/Season section.
create or replace function public.team_ys_member_stats()
returns table (
    user_id uuid,
    display_name text,
    email text,
    boxes_closed bigint,
    total_qty bigint
)
language sql
security definer
set search_path = public
stable
as $$
    with my_scans as (
        select * from public.ys_scans
        where enterprise_id = public.current_user_enterprise_id()
    ),
    box_status_per_user as (
        select user_id, ptl_number, box_barcode, bool_and(box_status = 'Closed') as closed
        from my_scans
        group by user_id, ptl_number, box_barcode
    )
    select
        p.id as user_id,
        p.display_name,
        p.email,
        coalesce((select count(*) from box_status_per_user b where b.user_id = p.id and b.closed), 0) as boxes_closed,
        coalesce((select sum(qty) from my_scans s where s.user_id = p.id), 0) as total_qty
    from public.profiles p
    where p.enterprise_id = public.current_user_enterprise_id()
      and public.current_user_is_enterprise_admin();
$$;

grant execute on function public.team_ys_member_stats() to authenticated;


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
-- ROLLED BACK: self-service account deletion
-- ============================================
-- delete_my_account() was added and then removed again (owner's decision). If an earlier version of this
-- file was run on your database, this line removes the function; it does nothing otherwise.
drop function if exists public.delete_my_account();
