-- Minimal stand-ins for what Supabase provides, so supabase/schema.sql can run on plain Postgres.
-- roles are cluster-wide, so only create them if a previous test run has not already
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
end $$;
create schema auth;
create table auth.users (id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb default '{}');
-- auth.uid() reads the "current user" the tests set with set_config('request.uid', ...)
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.uid', true), '')::uuid $$;
grant usage on schema public, auth to anon, authenticated;
