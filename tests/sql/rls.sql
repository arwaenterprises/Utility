-- Access-rule tests. Each check prints PASS; any failure raises an exception and stops the run.
\set ON_ERROR_STOP on
\set QUIET on
set client_min_messages = notice;


create function pg_temp.pass(name text) returns void language plpgsql as $$ begin raise notice 'PASS %', name; end $$;
create function public._t_eq(name text, actual bigint, expected bigint) returns void language plpgsql as $$
begin
  if actual is distinct from expected then raise exception 'FAIL %: got %, expected %', name, actual, expected; end if;
  raise notice 'PASS %', name;
end $$;
-- run sql as a user and require it to fail with a message containing `needle`
create function public._t_err(name text, uid uuid, stmt text, needle text) returns void language plpgsql as $$
declare msg text := null;
begin
  perform set_config('request.uid', uid::text, true);
  set local role authenticated;
  begin execute stmt; exception when others then msg := sqlerrm; end;
  reset role;
  if msg is null then raise exception 'FAIL %: expected an error but it succeeded', name; end if;
  if position(lower(needle) in lower(msg)) = 0 then raise exception 'FAIL %: error was "%", expected to contain "%"', name, msg, needle; end if;
  raise notice 'PASS %', name;
end $$;
-- run sql as a user and return the first column of the single result as bigint
create function public._t_val(uid uuid, stmt text) returns bigint language plpgsql as $$
declare v bigint;
begin
  perform set_config('request.uid', uid::text, true);
  set local role authenticated;
  execute stmt into v;
  reset role;
  return v;
end $$;
create function public._t_do(uid uuid, stmt text) returns void language plpgsql as $$
begin
  perform set_config('request.uid', uid::text, true);
  set local role authenticated;
  execute stmt;
  reset role;
end $$;

-- the app gives every Google sign-in its own team; these tests build accounts of every kind by hand, so it is switched off here
set app.skip_auto_team = 'on';

-- people: A = individual, E1 = admin of enterprise 1, B1 = member of enterprise 1, E2 = admin of enterprise 2
insert into auth.users(id,email) values
  ('00000000-0000-0000-0000-00000000000a','indiv@x.com'),
  ('00000000-0000-0000-0000-0000000000e1','admin1@x.com'),
  ('00000000-0000-0000-0000-0000000000b1','member1@x.com'),
  ('00000000-0000-0000-0000-0000000000e2','admin2@x.com'),
  ('00000000-0000-0000-0000-00000000000c','other@x.com');
insert into enterprises(id,name,admin_user_id) values
  ('11111111-1111-1111-1111-111111111111','E1','00000000-0000-0000-0000-0000000000e1'),
  ('22222222-2222-2222-2222-222222222222','E2','00000000-0000-0000-0000-0000000000e2');
update profiles set tier='enterprise_admin',  enterprise_id='11111111-1111-1111-1111-111111111111' where email='admin1@x.com';
update profiles set tier='enterprise_member', enterprise_id='11111111-1111-1111-1111-111111111111' where email='member1@x.com';
update profiles set tier='enterprise_admin',  enterprise_id='22222222-2222-2222-2222-222222222222' where email='admin2@x.com';

-- ============ reference lists ============
select _t_do('00000000-0000-0000-0000-00000000000a', $$
  select begin_list_upload('box_list');
  select append_list_chunk('box_list',0,'[{"box_number":"B1"},{"box_number":"B2"}]');
  select append_list_chunk('box_list',1,'[{"box_number":"B3"}]')$$);
select _t_eq('staged (uncommitted) list is invisible', _t_val('00000000-0000-0000-0000-00000000000a', $$select count(*) from reference_chunks$$), 0);
select _t_eq('commit returns the record count', _t_val('00000000-0000-0000-0000-00000000000a', $$select commit_list_upload('box_list')$$), 3);
select _t_eq('committed list is visible (2 chunks)', _t_val('00000000-0000-0000-0000-00000000000a', $$select count(*) from reference_chunks$$), 2);

select _t_do('00000000-0000-0000-0000-00000000000a', $$
  select begin_list_upload('box_list');
  select append_list_chunk('box_list',0,'[{"box_number":"NEW"}]')$$);
select _t_eq('old list stays active until the new one is committed', _t_val('00000000-0000-0000-0000-00000000000a', $$select sum(row_count) from reference_chunks$$), 3);
select _t_eq('replace: commit swaps the list', _t_val('00000000-0000-0000-0000-00000000000a', $$select commit_list_upload('box_list')$$), 1);
select _t_eq('replace: old rows are gone', _t_val('00000000-0000-0000-0000-00000000000a', $$select sum(row_count) from reference_chunks$$), 1);

select _t_do('00000000-0000-0000-0000-00000000000a', $$select begin_list_upload('box_list'); select append_list_chunk('box_list',0,'[{"box_number":"HALF"}]')$$);
select _t_eq('abandoned upload leaves the old list untouched', _t_val('00000000-0000-0000-0000-00000000000a', $$select count(*) from reference_chunks where rows->0->>'box_number'='NEW'$$), 1);
select _t_err('empty commit is rejected', '00000000-0000-0000-0000-00000000000a', $$select begin_list_upload('price_list'); select commit_list_upload('price_list')$$, 'Nothing was uploaded');
select _t_err('enterprise member cannot upload', '00000000-0000-0000-0000-0000000000b1', $$select begin_list_upload('box_list')$$, 'Only an enterprise admin');
-- the faster upload format: value arrays + one list of column names become the same records, in order
select _t_do('00000000-0000-0000-0000-00000000000a', $$select begin_list_upload('box_list'); select append_list_chunk_compact('box_list',0,array['box_number','store_name'],'[["C1","S1"],["C2","S2"],["C3",""]]'); select commit_list_upload('box_list')$$);
select _t_eq('compact chunk: stored as normal records, same order', _t_val('00000000-0000-0000-0000-00000000000a', $$select count(*) from reference_chunks where is_active and rows = '[{"box_number":"C1","store_name":"S1"},{"box_number":"C2","store_name":"S2"},{"box_number":"C3","store_name":""}]'::jsonb and row_count = 3$$), 1);
select _t_err('compact chunk: a row with the wrong number of values is rejected', '00000000-0000-0000-0000-00000000000a', $$select append_list_chunk_compact('box_list',1,array['a','b'],'[["only one"]]')$$, 'mismatched');
select _t_err('compact chunk: oversized chunk rejected', '00000000-0000-0000-0000-00000000000a', $$select append_list_chunk_compact('box_list',9,array['box_number'],(select jsonb_agg(jsonb_build_array(g::text)) from generate_series(1,5001) g))$$, 'chunk too large');
select _t_err('compact chunk: enterprise member cannot upload', '00000000-0000-0000-0000-0000000000b1', $$select append_list_chunk_compact('box_list',0,array['box_number'],'[["X"]]')$$, 'Only an enterprise admin');
select _t_err('unknown list type rejected', '00000000-0000-0000-0000-00000000000a', $$select append_list_chunk('evil',0,'[]')$$, 'check constraint');
select _t_err('oversized chunk rejected', '00000000-0000-0000-0000-00000000000a', $$select append_list_chunk('box_list',9,(select jsonb_agg(jsonb_build_object('box_number',g)) from generate_series(1,5001) g))$$, 'chunk too large');
select _t_err('direct insert into reference_chunks blocked', '00000000-0000-0000-0000-00000000000a', $$insert into reference_chunks(list_type,user_id,seq,row_count,rows,is_active) values ('box_list','00000000-0000-0000-0000-00000000000a',9,1,'[]',true)$$, 'row-level security');

select _t_do('00000000-0000-0000-0000-0000000000e1', $$select begin_list_upload('box_list'); select append_list_chunk('box_list',0,'[{"box_number":"E1BOX"}]'); select commit_list_upload('box_list')$$);
select _t_eq('member reads the enterprise list', _t_val('00000000-0000-0000-0000-0000000000b1', $$select count(*) from reference_chunks where list_type='box_list'$$), 1);
select _t_eq('other enterprise sees nothing', _t_val('00000000-0000-0000-0000-0000000000e2', $$select count(*) from reference_chunks$$), 0);
select _t_eq('individual does not see the enterprise list', _t_val('00000000-0000-0000-0000-00000000000a', $$select count(*) from reference_chunks where rows->0->>'box_number'='E1BOX'$$), 0);

-- ============ Box Scanner scans ============
select _t_do('00000000-0000-0000-0000-0000000000b1', $$insert into scans(user_id,enterprise_id,box_number,barcode) values ('00000000-0000-0000-0000-0000000000b1','11111111-1111-1111-1111-111111111111','B','1'),('00000000-0000-0000-0000-0000000000b1','11111111-1111-1111-1111-111111111111','B','2')$$);
select _t_do('00000000-0000-0000-0000-00000000000a', $$insert into scans(user_id,box_number,barcode) values ('00000000-0000-0000-0000-00000000000a','B','9')$$);
select _t_err('member cannot plant a scan in another enterprise', '00000000-0000-0000-0000-0000000000b1', $$insert into scans(user_id,enterprise_id,box_number,barcode) values ('00000000-0000-0000-0000-0000000000b1','22222222-2222-2222-2222-222222222222','B','x')$$, 'row-level security');
select _t_eq('member cannot delete own scans through the API', _t_val('00000000-0000-0000-0000-0000000000b1', $$with d as (delete from scans where user_id='00000000-0000-0000-0000-0000000000b1' returning 1) select count(*) from d$$), 0);
select _t_eq('admin sees the team''s scans', _t_val('00000000-0000-0000-0000-0000000000e1', $$select count(*) from scans$$), 2);
select _t_eq('other enterprise admin sees none', _t_val('00000000-0000-0000-0000-0000000000e2', $$select count(*) from scans$$), 0);
select _t_eq('individual can delete own scans', _t_val('00000000-0000-0000-0000-00000000000a', $$with d as (delete from scans where user_id='00000000-0000-0000-0000-00000000000a' returning 1) select count(*) from d$$), 1);
-- Box Scanner data screen: same functions, own rows only for non-admins
select _t_do('00000000-0000-0000-0000-00000000000a', $$insert into scans(user_id,box_number,barcode,qty) values ('00000000-0000-0000-0000-00000000000a','IB','5',2)$$);
select _t_eq('individual: stats show their own total', _t_val('00000000-0000-0000-0000-00000000000a', $$select total_qty from team_member_stats() where email='indiv@x.com'$$), 2);
select _t_eq('individual: stats show only themselves', _t_val('00000000-0000-0000-0000-00000000000a', $$select count(*) from team_member_stats()$$), 1);
select _t_eq('member: stats show only themselves', _t_val('00000000-0000-0000-0000-0000000000b1', $$select count(*) from team_member_stats()$$), 1);
select _t_eq('member: stats total is their own scans only', _t_val('00000000-0000-0000-0000-0000000000b1', $$select total_qty from team_member_stats()$$), 2);
select _t_eq('member: search finds their own box', _t_val('00000000-0000-0000-0000-0000000000b1', $$select count(*) from search_team_scans('B',50)$$), 2);
select _t_eq('individual: search never returns other people''s scans', _t_val('00000000-0000-0000-0000-00000000000a', $$select count(*) from search_team_scans('B',50) where user_id <> '00000000-0000-0000-0000-00000000000a'$$), 0);
select _t_eq('admin: search covers the whole team', _t_val('00000000-0000-0000-0000-0000000000e1', $$select count(distinct user_id) from search_team_scans('B',50)$$), 1);
select _t_eq('admin can delete team scans', _t_val('00000000-0000-0000-0000-0000000000e1', $$with d as (delete from scans where enterprise_id='11111111-1111-1111-1111-111111111111' returning 1) select count(*) from d$$), 2);

-- ============ Year/Season scans ============
select _t_do('00000000-0000-0000-0000-0000000000b1', $$insert into ys_scans(scan_uid,user_id,enterprise_id,barcode,box_barcode,box_status,ptl_number) values (gen_random_uuid(),'00000000-0000-0000-0000-0000000000b1','11111111-1111-1111-1111-111111111111','I1','BX','Closed','01'),(gen_random_uuid(),'00000000-0000-0000-0000-0000000000b1','11111111-1111-1111-1111-111111111111','I2','BX','Closed','01')$$);
select _t_do('00000000-0000-0000-0000-0000000000b1', $$insert into ys_scans(scan_uid,user_id,enterprise_id,barcode) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','00000000-0000-0000-0000-0000000000b1','11111111-1111-1111-1111-111111111111','UP') on conflict (scan_uid) do update set qty=excluded.qty; insert into ys_scans(scan_uid,user_id,enterprise_id,barcode) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','00000000-0000-0000-0000-0000000000b1','11111111-1111-1111-1111-111111111111','UP') on conflict (scan_uid) do update set qty=excluded.qty$$);
select _t_eq('re-sending a scan (same scan_uid) does not duplicate', _t_val('00000000-0000-0000-0000-0000000000b1', $$select count(*) from ys_scans where scan_uid='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'$$), 1);
select _t_err('member cannot plant Year/Season scans in another enterprise', '00000000-0000-0000-0000-0000000000b1', $$insert into ys_scans(scan_uid,user_id,enterprise_id,barcode) values (gen_random_uuid(),'00000000-0000-0000-0000-0000000000b1','22222222-2222-2222-2222-222222222222','x')$$, 'row-level security');
select _t_eq('member cannot delete own Year/Season scans', _t_val('00000000-0000-0000-0000-0000000000b1', $$with d as (delete from ys_scans where user_id='00000000-0000-0000-0000-0000000000b1' returning 1) select count(*) from d$$), 0);
select _t_eq('admin team stats: member qty', _t_val('00000000-0000-0000-0000-0000000000e1', $$select total_qty from team_ys_member_stats() where email='member1@x.com'$$), 3);
select _t_eq('admin team stats: closed boxes (distinct PTL+box)', _t_val('00000000-0000-0000-0000-0000000000e1', $$select boxes_closed from team_ys_member_stats() where email='member1@x.com'$$), 1);
select _t_eq('member sees only their own row in the stats (not the team)', _t_val('00000000-0000-0000-0000-0000000000b1', $$select count(*) from team_ys_member_stats()$$), 1);
select _t_eq('... and that row is their own', _t_val('00000000-0000-0000-0000-0000000000b1', $$select count(*) from team_ys_member_stats() where email='member1@x.com'$$), 1);
select _t_eq('member cannot see the admin in the stats', _t_val('00000000-0000-0000-0000-0000000000b1', $$select count(*) from team_ys_member_stats() where email='admin1@x.com'$$), 0);
select _t_eq('individual sees only their own row in the stats', _t_val('00000000-0000-0000-0000-00000000000a', $$select count(*) from team_ys_member_stats()$$), 1);
select _t_eq('admin still sees the whole enterprise (admin + member)', _t_val('00000000-0000-0000-0000-0000000000e1', $$select count(*) from team_ys_member_stats()$$), 2);
select _t_eq('another enterprise admin never sees this enterprise', _t_val('00000000-0000-0000-0000-0000000000e2', $$select count(*) from team_ys_member_stats() where email in ('member1@x.com','admin1@x.com')$$), 0);
select _t_eq('other enterprise admin cannot delete these', _t_val('00000000-0000-0000-0000-0000000000e2', $$with d as (delete from ys_scans returning 1) select count(*) from d$$), 0);
select _t_eq('admin can delete team Year/Season scans', _t_val('00000000-0000-0000-0000-0000000000e1', $$with d as (delete from ys_scans where enterprise_id='11111111-1111-1111-1111-111111111111' returning 1) select count(*) from d$$), 3);

-- ============ enterprise rename ============
select _t_err('member cannot rename the enterprise', '00000000-0000-0000-0000-0000000000b1', $$select rename_enterprise('Hacked')$$, 'Only the enterprise admin');
select _t_err('empty enterprise name rejected', '00000000-0000-0000-0000-0000000000e1', $$select rename_enterprise('   ')$$, 'cannot be empty');
select _t_do('00000000-0000-0000-0000-0000000000e1', $$select rename_enterprise('  New Name  ')$$);
select _t_eq('admin rename trims and saves', (select count(*) from enterprises where name='New Name'), 1);

-- the later checks need this person to be a member of enterprise 1 (they used to join by e-mail invitation)
update profiles set tier='enterprise_member', enterprise_id='11111111-1111-1111-1111-111111111111' where email='indiv@x.com';
select _t_eq('the person is a member of enterprise 1', (select count(*) from profiles where email='indiv@x.com' and tier='enterprise_member'), 1);

-- ============ usage statistics ============
select _t_do('00000000-0000-0000-0000-0000000000b1', $$select log_usage('box_scanner','box_closed',1,40); select log_usage('box_scanner','box_closed',2,25)$$);
select _t_eq('log_usage adds up: event count', (select event_count from usage_daily where tool='box_scanner' and user_id='00000000-0000-0000-0000-0000000000b1'), 3);
select _t_eq('log_usage adds up: quantity', (select qty from usage_daily where tool='box_scanner' and user_id='00000000-0000-0000-0000-0000000000b1'), 65);
select _t_eq('log_usage records the enterprise', (select count(*) from usage_daily where enterprise_id='11111111-1111-1111-1111-111111111111'), 1);
select _t_do('00000000-0000-0000-0000-0000000000b1', $$select log_usage('price_check','lookup_found',5,0,(current_date - 3))$$);
select _t_eq('log_usage keeps an explicit recent day', (select count(*) from usage_daily where tool='price_check' and day = current_date - 3), 1);
select _t_do('00000000-0000-0000-0000-0000000000b1', $$select log_usage('price_check','lookup_found',1,0,date '2001-01-01')$$);
select _t_eq('a far-away day (wrong tablet clock) is replaced by today', (select count(*) from usage_daily where day = date '2001-01-01'), 0);
select _t_err('unknown tool/action rejected', '00000000-0000-0000-0000-0000000000b1', $$select log_usage('hacking','box_closed',1,0)$$, 'Invalid usage event');
select _t_err('wrong action for a tool rejected', '00000000-0000-0000-0000-0000000000b1', $$select log_usage('price_check','box_closed',1,0)$$, 'Invalid usage event');
select _t_err('zero count rejected', '00000000-0000-0000-0000-0000000000b1', $$select log_usage('box_scanner','box_closed',0,0)$$, 'Invalid usage amounts');
select _t_err('absurd count rejected', '00000000-0000-0000-0000-0000000000b1', $$select log_usage('box_scanner','box_closed',1000000,0)$$, 'Invalid usage amounts');
select _t_err('signed-out caller rejected', null::uuid, $$select log_usage('box_scanner','box_closed',1,0)$$, 'Not signed in');
select _t_err('users cannot read the usage table (not even their own)', '00000000-0000-0000-0000-0000000000b1', $$select count(*) from usage_daily$$, 'permission denied');
select _t_err('enterprise admins cannot read the usage table', '00000000-0000-0000-0000-0000000000e1', $$select count(*) from usage_daily$$, 'permission denied');
select _t_err('users cannot read the usage report view', '00000000-0000-0000-0000-0000000000b1', $$select count(*) from usage_report$$, 'permission denied');
select _t_err('users cannot write usage rows directly', '00000000-0000-0000-0000-0000000000b1', $$insert into usage_daily(user_id,day,tool,action,event_count) values ('00000000-0000-0000-0000-0000000000b1', current_date, 'box_scanner','box_closed',999999)$$, 'permission denied');
select _t_eq('owner view shows names and enterprise', (select count(*) from usage_report where email='member1@x.com' and enterprise='New Name'), 3);

-- ============ account deletion was rolled back ============
select _t_eq('delete_my_account() does not exist (feature rolled back)', (select count(*) from pg_proc where proname = 'delete_my_account'), 0);

\echo All access-rule tests passed

-- ============ e-mail invitations are gone (replaced by Team QR links) ============
select _t_eq('the invitation functions no longer exist', (select count(*) from pg_proc where proname in ('send_enterprise_invite','accept_enterprise_invite','my_pending_invites','current_user_email')), 0);
select _t_err('nobody can read the old invitation table through the API', '00000000-0000-0000-0000-0000000000e1', $$select count(*) from enterprise_invites$$, 'permission denied');

-- ============ Team QR links (labourers without accounts) ============
-- helpers that behave like an ANONYMOUS sign-in (the JWT says is_anonymous = true) or like the API's anon role
create function public._ta_do(uid uuid, stmt text) returns void language plpgsql as $$
begin
  perform set_config('request.uid', uid::text, true); perform set_config('request.anon', 'true', true);
  set local role authenticated; execute stmt; reset role;
  perform set_config('request.anon', 'false', true);
end $$;
create function public._ta_err(name text, uid uuid, stmt text, needle text) returns void language plpgsql as $$
declare msg text := null;
begin
  perform set_config('request.uid', uid::text, true); perform set_config('request.anon', 'true', true);
  set local role authenticated;
  begin execute stmt; exception when others then msg := sqlerrm; end;
  reset role; perform set_config('request.anon', 'false', true);
  if msg is null then raise exception 'FAIL %: expected an error but it succeeded', name; end if;
  if position(lower(needle) in lower(msg)) = 0 then raise exception 'FAIL %: error was "%", expected to contain "%"', name, msg, needle; end if;
  raise notice 'PASS %', name;
end $$;
create function public._ta_val(uid uuid, stmt text) returns bigint language plpgsql as $$
declare v bigint;
begin
  perform set_config('request.uid', uid::text, true); perform set_config('request.anon', 'true', true);
  set local role authenticated; execute stmt into v; reset role; perform set_config('request.anon', 'false', true);
  return v;
end $$;
-- as the API's signed-out "anon" role (no user at all)
create function public._tn_val(stmt text) returns bigint language plpgsql as $$
declare v bigint;
begin
  perform set_config('request.uid', '', true); set local role anon; execute stmt into v; reset role;
  return v;
end $$;

insert into auth.users(id,email) values
  ('00000000-0000-0000-0000-0000000000f1', null),     -- anonymous labourer 1
  ('00000000-0000-0000-0000-0000000000f2', null);     -- anonymous labourer 2

-- creating links: admin only, one active link per tool
select _t_do('00000000-0000-0000-0000-0000000000e1', $$select create_team_link('boxScanner','Inbound 7')$$);
select token as tok1 from team_links where job_name = 'Inbound 7' \gset
select _t_do('00000000-0000-0000-0000-0000000000e1', $$select create_team_link('boxScanner','Inbound 8')$$);
select token as tok2 from team_links where job_name = 'Inbound 8' \gset
select _t_eq('a second team on the same tool gets its own link: the first stays active', (select count(*) from team_links where tool='boxScanner' and stopped_at is null), 2);
select _t_do('00000000-0000-0000-0000-0000000000e1', $$select create_team_link('boxScanner',' inbound 7 ')$$);
select _t_eq('same tool + same job name (any capitals, end spaces) replaces only that one link', (select count(*) from team_links where lower(btrim(job_name))='inbound 7' and stopped_at is not null), 1);
select _t_eq('...it has a fresh active link, and Inbound 8 was not touched', (select count(*) from team_links where tool='boxScanner' and stopped_at is null and lower(btrim(job_name)) in ('inbound 7','inbound 8')), 2);
select _t_do('00000000-0000-0000-0000-0000000000e1', $$select create_team_link('priceCheck','Counter 1')$$);
select _t_eq('a link for another tool does not touch the Box Scanner links', (select count(*) from team_links where tool='boxScanner' and stopped_at is null), 2);
select _t_err('an enterprise member cannot create links', '00000000-0000-0000-0000-0000000000b1', $$select create_team_link('boxScanner','x')$$, 'Only the enterprise admin');
select _t_err('an individual cannot create links', '00000000-0000-0000-0000-00000000000a', $$select create_team_link('boxScanner','x')$$, 'Only the enterprise admin');
select _t_err('a made-up tool is refused', '00000000-0000-0000-0000-0000000000e1', $$select create_team_link('hackTool','x')$$, 'choose a tool');
select _t_err('an empty job name is refused', '00000000-0000-0000-0000-0000000000e1', $$select create_team_link('boxScanner','   ')$$, 'job name');
select _t_eq('the API cannot read the link table directly', _t_val('00000000-0000-0000-0000-0000000000e1', $$select count(*) from (select 1) q where exists (select 1 from information_schema.role_table_grants where table_name='team_links' and grantee='authenticated')$$), 0);

-- the join page can read WHO a link belongs to before anybody signs in
select _t_eq('signed out: the link info (names only) can be read with the token', _tn_val(format($$select count(*) from get_team_link_info(%L) where job_name='Inbound 8' and tool='boxScanner' and state='active' and enterprise_name is not null and admin_name is not null$$, :'tok2')), 1);
select _t_eq('an old (replaced) link reports state "stopped"', _tn_val(format($$select count(*) from get_team_link_info(%L) where state='stopped'$$, :'tok1')), 1);
select _t_eq('a made-up token gives nothing', _tn_val($$select count(*) from get_team_link_info('nope')$$), 0);
select _t_eq('signed out: the link tables themselves are closed', _tn_val($$select count(*) from pg_catalog.pg_tables where tablename='team_links' and has_table_privilege('anon', 'public.team_links', 'select')$$), 0);

-- joining
select _t_err('a Google (non-anonymous) user cannot use the labourer join', '00000000-0000-0000-0000-00000000000a', format($$select join_team_link(%L,'Ann')$$, :'tok2'), 'labourer who scanned');
select _t_err('...and a plain (not anonymous) sign-in is refused too', '00000000-0000-0000-0000-0000000000f1', format($$select join_team_link(%L,'Ann')$$, :'tok2'), 'labourer who scanned');
select _ta_err('a made-up QR is refused', '00000000-0000-0000-0000-0000000000f1', $$select join_team_link('nope','Ravi')$$, 'not valid');
select _ta_err('a replaced (stopped) link cannot be joined', '00000000-0000-0000-0000-0000000000f1', format($$select join_team_link(%L,'Ravi')$$, :'tok1'), 'has ended');
select _ta_err('a name is required', '00000000-0000-0000-0000-0000000000f1', format($$select join_team_link(%L,'  ')$$, :'tok2'), 'type your name');
select _ta_err('a name over 40 characters is refused', '00000000-0000-0000-0000-0000000000f1', format($$select join_team_link(%L,%L)$$, :'tok2', repeat('x',41)), 'type your name');
select _ta_do('00000000-0000-0000-0000-0000000000f1', format($$select join_team_link(%L,'Ravi')$$, :'tok2'));
select _ta_do('00000000-0000-0000-0000-0000000000f2', format($$select join_team_link(%L,'Sana')$$, :'tok2'));
select _t_eq('joining makes an operator in the admin''s team', (select count(*) from profiles where id in ('00000000-0000-0000-0000-0000000000f1','00000000-0000-0000-0000-0000000000f2') and tier='operator' and enterprise_id='11111111-1111-1111-1111-111111111111'), 2);
select _ta_do('00000000-0000-0000-0000-0000000000f1', format($$select join_team_link(%L,'Ravi K')$$, :'tok2'));
select _t_eq('joining again with the same identity only changes the name', (select count(*) from team_operators where user_id='00000000-0000-0000-0000-0000000000f1' and name='Ravi K'), 1);
select _ta_do('00000000-0000-0000-0000-0000000000f1', format($$select join_team_link(%L,'Ravi')$$, :'tok2'));

-- what an operator can and cannot do
select _t_eq('operator: the device can ask for its job and it is active', _ta_val('00000000-0000-0000-0000-0000000000f1', $$select count(*) from my_team_link() where state='active' and job_name='Inbound 8' and operator_name='Ravi' and enterprise_name is not null and admin_name is not null$$), 1);
select _ta_do('00000000-0000-0000-0000-0000000000f1', $$insert into scans(user_id,box_number,barcode,qty,enterprise_id,remark,operator_name,link_id) values ('00000000-0000-0000-0000-0000000000f1','OB1','111',2,'22222222-2222-2222-2222-222222222222','forged remark','Somebody Else',gen_random_uuid())$$);
select _t_eq('operator scan: the team, the job (Remark) and the name come from the link - forged values are ignored', (select count(*) from scans where box_number='OB1' and enterprise_id='11111111-1111-1111-1111-111111111111' and remark='Inbound 8' and operator_name='Ravi' and link_id=(select id from team_links where job_name='Inbound 8')), 1);
select _ta_err('operator cannot scan into a tool their link is not for', '00000000-0000-0000-0000-0000000000f1', $$insert into ys_scans(user_id,scan_uid,barcode,ptl_number) values ('00000000-0000-0000-0000-0000000000f1',gen_random_uuid(),'5','01')$$, 'not for this tool');
select _t_eq('operator cannot delete scans', _ta_val('00000000-0000-0000-0000-0000000000f1', $$with d as (delete from scans where user_id='00000000-0000-0000-0000-0000000000f1' returning 1) select count(*) from d$$), 0);
select _ta_do('00000000-0000-0000-0000-0000000000f1', $$update scans set remark='changed', operator_name='Mallory', enterprise_id='22222222-2222-2222-2222-222222222222', qty=3 where box_number='OB1'$$);
select _t_eq('operator cannot change the job, name or team of a scan afterwards (a re-send keeps them)', (select count(*) from scans where box_number='OB1' and remark='Inbound 8' and operator_name='Ravi' and enterprise_id='11111111-1111-1111-1111-111111111111'), 1);
select _ta_do('00000000-0000-0000-0000-0000000000f2', $$insert into scans(user_id,box_number,barcode) values ('00000000-0000-0000-0000-0000000000f2','OB2','222')$$);
select _t_eq('operator sees only their own scans, not the other operator''s', _ta_val('00000000-0000-0000-0000-0000000000f1', $$select count(*) from scans$$), 1);
select _ta_err('operator cannot upload lists', '00000000-0000-0000-0000-0000000000f1', $$select begin_list_upload('box_list')$$, 'Only an enterprise admin');
select _ta_err('operator cannot create an enterprise', '00000000-0000-0000-0000-0000000000f1', $$select create_enterprise('My own')$$, 'already belong');
select _ta_err('operator cannot create links', '00000000-0000-0000-0000-0000000000f1', $$select create_team_link('boxScanner','x')$$, 'Only the enterprise admin');
select _t_eq('operator cannot see the other team''s data', _ta_val('00000000-0000-0000-0000-0000000000f1', $$select count(*) from scans where enterprise_id='22222222-2222-2222-2222-222222222222'$$), 0);
select _t_eq('the team admin sees the operators'' scans, with their names', (select count(*) from scans where box_number in ('OB1','OB2') and operator_name in ('Ravi','Sana')), 2);
select _t_eq('a normal (Google) user cannot fake an operator name on their own scans', (select count(*) from (select 1) q where _t_val('00000000-0000-0000-0000-0000000000b1', $$with i as (insert into scans(user_id,enterprise_id,box_number,barcode,operator_name) values ('00000000-0000-0000-0000-0000000000b1','11111111-1111-1111-1111-111111111111','FB','9','Fake Name') returning operator_name) select count(*) from i where operator_name is null$$) = 1), 1);

-- the admin's views and tools
select _t_eq('admin: list of links shows state and the number of people who joined', _t_val('00000000-0000-0000-0000-0000000000e1', $$select operators from list_team_links() where job_name='Inbound 8' and state='active'$$), 2);
select _t_eq('admin: list of people', _t_val('00000000-0000-0000-0000-0000000000e1', $$select count(*) from list_team_operators() where name in ('Ravi','Sana')$$), 2);
select _t_eq('a member cannot list links', _t_val('00000000-0000-0000-0000-0000000000b1', $$select count(*) from list_team_links()$$), 0);
select _t_eq('another team''s admin sees none of these links', _t_val('00000000-0000-0000-0000-0000000000e2', $$select count(*) from list_team_links()$$), 0);
select _t_eq('another team''s admin sees none of these people', _t_val('00000000-0000-0000-0000-0000000000e2', $$select count(*) from list_team_operators()$$), 0);
select id as op_ravi from team_operators where name = 'Ravi' \gset
select _t_do('00000000-0000-0000-0000-0000000000e2', format($$select stop_team_link(%L)$$, (select id from team_links where job_name='Inbound 8')));
select _t_eq('another team''s admin cannot stop this link', (select count(*) from team_links where job_name='Inbound 8' and stopped_at is null), 1);
select _t_err('another team''s admin cannot rename these people', '00000000-0000-0000-0000-0000000000e2', format($$select rename_team_operator(%L,'Hacked')$$, :'op_ravi'), 'not found');
select _t_err('an operator cannot rename', '00000000-0000-0000-0000-0000000000f1', format($$select rename_team_operator(%L,'Hacked')$$, :'op_ravi'), 'Only the enterprise admin');
select _t_do('00000000-0000-0000-0000-0000000000e1', format($$select rename_team_operator(%L,'Ravi Kumar')$$, :'op_ravi'));
select _t_eq('admin renames a person: also on the scans already sent', (select count(*) from scans where box_number='OB1' and operator_name='Ravi Kumar'), 1);
select _t_eq('...and the next scan carries the new name', (select count(*) from (select 1) q where _ta_val('00000000-0000-0000-0000-0000000000f1', $$with i as (insert into scans(user_id,box_number,barcode) values ('00000000-0000-0000-0000-0000000000f1','OB3','333') returning operator_name) select count(*) from i where operator_name='Ravi Kumar'$$) = 1), 1);

-- stopping a link: NEW work is refused, work recorded earlier (offline devices) is still accepted
select _t_do('00000000-0000-0000-0000-0000000000e1', format($$select stop_team_link(%L)$$, (select id from team_links where token=:'tok2')));
select _t_eq('a stopped link reports "stopped" to the device', _ta_val('00000000-0000-0000-0000-0000000000f1', $$select count(*) from my_team_link() where state='stopped'$$), 1);
select _ta_err('after Stop: a NEW scan is refused', '00000000-0000-0000-0000-0000000000f1', $$insert into scans(user_id,box_number,barcode,scanned_at) values ('00000000-0000-0000-0000-0000000000f1','OB4','444',now())$$, 'has ended');
select _ta_do('00000000-0000-0000-0000-0000000000f1', $$insert into scans(user_id,box_number,barcode,scanned_at) values ('00000000-0000-0000-0000-0000000000f1','OB5','555',now() - interval '1 hour')$$);
select _t_eq('...but a scan made BEFORE the stop (unsent on an offline device) is still accepted', (select count(*) from scans where box_number='OB5'), 1);
select _ta_err('a stopped link cannot be joined', '00000000-0000-0000-0000-0000000000f2', format($$select join_team_link(%L,'Sana')$$, :'tok2'), 'has ended');

-- links never expire: a long quiet time does NOT switch a link off
select _t_do('00000000-0000-0000-0000-0000000000e1', $$select create_team_link('yearSegregate','Sort run A')$$);
select token as tok3 from team_links where job_name = 'Sort run A' \gset
select _ta_do('00000000-0000-0000-0000-0000000000f2', format($$select join_team_link(%L,'Sana')$$, :'tok3'));
select _ta_do('00000000-0000-0000-0000-0000000000f2', $$insert into ys_scans(user_id,scan_uid,barcode,ptl_number) values ('00000000-0000-0000-0000-0000000000f2',gen_random_uuid(),'7','01')$$);
select _t_eq('a Year/Season operator''s scan carries the job and name too', (select count(*) from ys_scans where barcode='7' and remark='Sort run A' and operator_name='Sana' and enterprise_id='11111111-1111-1111-1111-111111111111'), 1);
update team_links set last_scan_at = now() - interval '4 days', created_at = now() - interval '5 days' where job_name = 'Sort run A';
select _t_eq('after 4 quiet days the link still reads "active"', _tn_val(format($$select count(*) from get_team_link_info(%L) where state='active'$$, :'tok3')), 1);
select _t_eq('...and the device still sees its screen as active', _ta_val('00000000-0000-0000-0000-0000000000f2', $$select count(*) from my_team_link() where state='active'$$), 1);
select _ta_do('00000000-0000-0000-0000-0000000000f2', $$insert into ys_scans(user_id,scan_uid,barcode,ptl_number) values ('00000000-0000-0000-0000-0000000000f2',gen_random_uuid(),'8','01')$$);
select _t_eq('...and a NEW scan on it is still accepted', (select count(*) from ys_scans where barcode='8'), 1);
select _ta_do('00000000-0000-0000-0000-0000000000f1', format($$select join_team_link(%L,'Ravi')$$, :'tok3'));
select _t_eq('a quiet link can still be joined', (select count(*) from team_operators o join team_links l on l.id=o.link_id where l.job_name='Sort run A' and o.name='Ravi'), 1);
select _t_eq('all scans of the quiet link are kept', (select count(*) from ys_scans where barcode in ('7','8')), 2);

-- removing a person
select id as op_sana from team_operators where name = 'Sana' and link_id = (select id from team_links where job_name='Sort run A') \gset
update team_links set last_scan_at = now(), created_at = now() where job_name = 'Sort run A';
select _t_do('00000000-0000-0000-0000-0000000000e1', format($$select remove_team_operator(%L)$$, :'op_sana'));
select _t_eq('a removed person''s device is told so', _ta_val('00000000-0000-0000-0000-0000000000f2', $$select count(*) from my_team_link() where state='removed'$$), 1);
select _ta_err('a removed person cannot scan', '00000000-0000-0000-0000-0000000000f2', $$insert into ys_scans(user_id,scan_uid,barcode,ptl_number) values ('00000000-0000-0000-0000-0000000000f2',gen_random_uuid(),'10','01')$$, 'has ended');
select _ta_err('a removed person cannot rejoin the same job', '00000000-0000-0000-0000-0000000000f2', format($$select join_team_link(%L,'Sana')$$, :'tok3'), 'removed');

-- an anonymous device that has NOT joined a team (anyone with the public key can create one) can do nothing
insert into auth.users(id,email) values ('00000000-0000-0000-0000-0000000000f3', null);
select _ta_err('unjoined anonymous device cannot create an enterprise', '00000000-0000-0000-0000-0000000000f3', $$select create_enterprise('Free storage Ltd')$$, 'Join a team');
select _ta_err('...cannot start a list upload', '00000000-0000-0000-0000-0000000000f3', $$select begin_list_upload('box_list')$$, 'Join a team');
select _ta_err('...cannot log usage', '00000000-0000-0000-0000-0000000000f3', $$select log_usage('box_scanner','box_closed',1,1,current_date)$$, 'Join a team');
select _ta_err('...cannot store scans', '00000000-0000-0000-0000-0000000000f3', $$insert into scans(user_id,box_number,barcode) values ('00000000-0000-0000-0000-0000000000f3','U1','1')$$, 'row-level security');
select _ta_err('...cannot store Year/Season scans', '00000000-0000-0000-0000-0000000000f3', $$insert into ys_scans(user_id,scan_uid,barcode,ptl_number) values ('00000000-0000-0000-0000-0000000000f3',gen_random_uuid(),'1','01')$$, 'row-level security');
select _ta_do('00000000-0000-0000-0000-0000000000f3', format($$select join_team_link(%L,'Zed')$$, :'tok3'));
select _ta_do('00000000-0000-0000-0000-0000000000f3', $$insert into ys_scans(user_id,scan_uid,barcode,ptl_number) values ('00000000-0000-0000-0000-0000000000f3',gen_random_uuid(),'11','01')$$);
select _t_eq('after joining by QR the same device can scan', (select count(*) from ys_scans where barcode='11' and operator_name='Zed'), 1);

-- people list for the admin: labourers grouped by name (capitals and end spaces ignored), without e-mail
insert into auth.users(id,email) values ('00000000-0000-0000-0000-0000000000f4', null), ('00000000-0000-0000-0000-0000000000f5', null);
select _t_do('00000000-0000-0000-0000-0000000000e1', $$select create_team_link('boxScanner','Inbound 9')$$);
select token as tok9 from team_links where job_name = 'Inbound 9' \gset
select _ta_do('00000000-0000-0000-0000-0000000000f4', format($$select join_team_link(%L,'Ravi')$$, :'tok9'));
select _ta_do('00000000-0000-0000-0000-0000000000f5', format($$select join_team_link(%L,'  ravi')$$, :'tok9'));
select _ta_do('00000000-0000-0000-0000-0000000000f4', $$insert into scans(user_id,box_number,barcode,qty,box_status) values ('00000000-0000-0000-0000-0000000000f4','PB1','1',2,'Closed')$$);
select _ta_do('00000000-0000-0000-0000-0000000000f5', $$insert into scans(user_id,box_number,barcode,qty,box_status) values ('00000000-0000-0000-0000-0000000000f5','PB2','2',3,'Closed')$$);
select _t_eq('admin people list: the same labourer on two handhelds is ONE person', _t_val('00000000-0000-0000-0000-0000000000e1', $$select count(*) from team_member_stats() where is_operator and person_key = 'o:ravi'$$), 1);
select _t_eq('...with both boxes and all the quantity', _t_val('00000000-0000-0000-0000-0000000000e1', $$select boxes_closed * 100 + total_qty from team_member_stats() where person_key = 'o:ravi'$$), 205);
select _t_eq('...knowing both handhelds and the job', _t_val('00000000-0000-0000-0000-0000000000e1', $$select cardinality(member_ids) * 10 + cardinality(operator_names) from team_member_stats() where person_key = 'o:ravi' and jobs = 'Inbound 9'$$), 22);
select _t_eq('...and no labourer shows up as an ordinary account row', _t_val('00000000-0000-0000-0000-0000000000e1', $$select count(*) from team_member_stats() where not is_operator and user_id in ('00000000-0000-0000-0000-0000000000f4','00000000-0000-0000-0000-0000000000f5')$$), 0);
select _t_eq('a team member does not see labourers in the people list', _t_val('00000000-0000-0000-0000-0000000000b1', $$select count(*) from team_member_stats() where is_operator$$), 0);
select _t_eq('another team''s admin does not see them either', _t_val('00000000-0000-0000-0000-0000000000e2', $$select count(*) from team_member_stats() where is_operator$$), 0);
select _t_eq('search finds a labourer by name and shows the name', _t_val('00000000-0000-0000-0000-0000000000e1', $$select count(*) from search_team_scans('rav', 50) where operator_name ilike 'ravi'$$), 2);
select _t_eq('search finds scans by job name', _t_val('00000000-0000-0000-0000-0000000000e1', $$select count(*) from search_team_scans('Inbound 9', 50)$$), 2);
delete from scans where box_number in ('PB1','PB2');

-- ============ every Google sign-in is its own team ============
reset app.skip_auto_team;
insert into auth.users(id,email) values ('00000000-0000-0000-0000-0000000000a1','newbie@x.com');
select _t_eq('a brand-new Google sign-in gets its own team and is its admin', (select count(*) from profiles p join enterprises e on e.id = p.enterprise_id where p.email='newbie@x.com' and p.tier='enterprise_admin' and e.admin_user_id = p.id), 1);
select _t_do('00000000-0000-0000-0000-0000000000a1', $$select create_team_link('boxScanner','Solo job')$$);
select _t_eq('...so a solo user can make Team QR links straight away', (select count(*) from team_links l join profiles p on p.enterprise_id = l.enterprise_id where p.email='newbie@x.com'), 1);
select _t_eq('...and still sees none of the other teams', _t_val('00000000-0000-0000-0000-0000000000a1', $$select count(*) from list_team_operators()$$), 0);
-- a labourer (anonymous, no e-mail) never gets a team of its own
insert into auth.users(id,email) values ('00000000-0000-0000-0000-0000000000a2', null);
select _t_eq('an anonymous labourer does not get a team', (select count(*) from profiles where id='00000000-0000-0000-0000-0000000000a2' and enterprise_id is null and tier='individual'), 1);
-- an account from before this rule: its old rows move into the new team
set app.skip_auto_team = 'on';
insert into auth.users(id,email) values ('00000000-0000-0000-0000-0000000000a3','oldtimer@x.com');
reset app.skip_auto_team;
insert into scans(user_id,box_number,barcode) values ('00000000-0000-0000-0000-0000000000a3','OLD1','9');
insert into ys_scans(user_id,scan_uid,barcode,ptl_number) values ('00000000-0000-0000-0000-0000000000a3',gen_random_uuid(),'8','01');
select _t_eq('an old individual account has no team yet', (select count(*) from profiles where email='oldtimer@x.com' and enterprise_id is null), 1);
select _t_do('00000000-0000-0000-0000-0000000000a3', $$select ensure_own_team()$$);
select _t_eq('ensure_own_team() gives it a team', (select count(*) from profiles where email='oldtimer@x.com' and tier='enterprise_admin' and enterprise_id is not null), 1);
select _t_eq('...and moves its old scans and Year/Season scans into that team', (select (select count(*) from scans where box_number='OLD1' and enterprise_id = p.enterprise_id) + (select count(*) from ys_scans where barcode='8' and enterprise_id = p.enterprise_id) from profiles p where p.email='oldtimer@x.com'), 2);
select _t_do('00000000-0000-0000-0000-0000000000a3', $$select ensure_own_team()$$);
select _t_eq('asking again does not make a second team', (select count(*) from enterprises e join profiles p on p.id = e.admin_user_id where p.email='oldtimer@x.com'), 1);
select _t_eq('an anonymous device cannot ask for a team', _ta_val('00000000-0000-0000-0000-0000000000a2', $$select count(*) from (select ensure_own_team()) q where ensure_own_team is not null$$), 0);
select _t_err('make_own_team() is not callable from the API', '00000000-0000-0000-0000-0000000000a3', $$select make_own_team('00000000-0000-0000-0000-0000000000a3')$$, 'permission denied');
-- tidy up
delete from team_links where job_name = 'Solo job';
delete from scans where box_number = 'OLD1';
delete from ys_scans where barcode = '8';
delete from auth.users where id in ('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000a2','00000000-0000-0000-0000-0000000000a3');
delete from enterprises where name in ('newbie@x.com','oldtimer@x.com');
set app.skip_auto_team = 'on';

-- leaving a job takes the labourer off the link (their scans stay)
insert into auth.users(id,email) values ('00000000-0000-0000-0000-0000000000a6', null);
select _t_do('00000000-0000-0000-0000-0000000000e1', $$select create_team_link('boxScanner','Leave test')$$);
select token as tokl from team_links where job_name = 'Leave test' \gset
select _ta_do('00000000-0000-0000-0000-0000000000a6', format($$select join_team_link(%L,'Lea')$$, :'tokl'));
select _ta_do('00000000-0000-0000-0000-0000000000a6', $$insert into scans(user_id,box_number,barcode) values ('00000000-0000-0000-0000-0000000000a6','LV1','1')$$);
select _t_eq('before leaving the admin counts the labourer on the link', _t_val('00000000-0000-0000-0000-0000000000e1', $$select operators from list_team_links() where job_name='Leave test'$$), 1);
select _ta_do('00000000-0000-0000-0000-0000000000a6', $$select leave_team_link()$$);
select _t_eq('after leaving the link no longer counts them', _t_val('00000000-0000-0000-0000-0000000000e1', $$select operators from list_team_links() where job_name='Leave test'$$), 0);
select _t_eq('...and the admin''s labourers list drops them', _t_val('00000000-0000-0000-0000-0000000000e1', $$select count(*) from list_team_operators() where name='Lea' and removed_at is null$$), 0);
select _t_eq('...but what they scanned stays', (select count(*) from scans where box_number='LV1' and operator_name='Lea'), 1);
select _t_err('...and that old identity can no longer add scans', '00000000-0000-0000-0000-0000000000a6', $$insert into scans(user_id,box_number,barcode) values ('00000000-0000-0000-0000-0000000000a6','LV2','2')$$, 'has ended');
delete from scans where box_number = 'LV1';
delete from auth.users where id = '00000000-0000-0000-0000-0000000000a6';

-- tidy up the people and links created here, so later checks see the same data as before
delete from auth.users where id in ('00000000-0000-0000-0000-0000000000f1','00000000-0000-0000-0000-0000000000f2','00000000-0000-0000-0000-0000000000f3','00000000-0000-0000-0000-0000000000f4','00000000-0000-0000-0000-0000000000f5');
delete from scans where box_number = 'FB';
delete from team_links;
