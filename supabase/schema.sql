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

create or replace function public.search_team_scans(search_term text, limit_count int default 100)
returns table (
    id uuid,
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
    select s.id, s.barcode, s.box_number, s.box_status, s.qty, s.scanned_at, s.user_id, p.display_name, p.email
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

drop policy if exists "scans_delete_own" on public.scans;
create policy "scans_delete_own" on public.scans for delete
    using (user_id = auth.uid());

drop policy if exists "scans_delete_team" on public.scans;
create policy "scans_delete_team" on public.scans for delete
    using (
        public.current_user_is_enterprise_admin()
        and enterprise_id = public.current_user_enterprise_id()
    );
