-- Access-rule tests. Each check prints PASS; any failure raises an exception and stops the run.
\set ON_ERROR_STOP on
\set QUIET on
set client_min_messages = notice;

grant all on all tables in schema public to authenticated;   -- Supabase grants this by default; RLS is what restricts

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
select _t_eq('admin can delete team scans', _t_val('00000000-0000-0000-0000-0000000000e1', $$with d as (delete from scans where enterprise_id='11111111-1111-1111-1111-111111111111' returning 1) select count(*) from d$$), 2);

-- ============ Year/Season scans ============
select _t_do('00000000-0000-0000-0000-0000000000b1', $$insert into ys_scans(scan_uid,user_id,enterprise_id,barcode,box_barcode,box_status,ptl_number) values (gen_random_uuid(),'00000000-0000-0000-0000-0000000000b1','11111111-1111-1111-1111-111111111111','I1','BX','Closed','01'),(gen_random_uuid(),'00000000-0000-0000-0000-0000000000b1','11111111-1111-1111-1111-111111111111','I2','BX','Closed','01')$$);
select _t_do('00000000-0000-0000-0000-0000000000b1', $$insert into ys_scans(scan_uid,user_id,enterprise_id,barcode) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','00000000-0000-0000-0000-0000000000b1','11111111-1111-1111-1111-111111111111','UP') on conflict (scan_uid) do update set qty=excluded.qty; insert into ys_scans(scan_uid,user_id,enterprise_id,barcode) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','00000000-0000-0000-0000-0000000000b1','11111111-1111-1111-1111-111111111111','UP') on conflict (scan_uid) do update set qty=excluded.qty$$);
select _t_eq('re-sending a scan (same scan_uid) does not duplicate', _t_val('00000000-0000-0000-0000-0000000000b1', $$select count(*) from ys_scans where scan_uid='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'$$), 1);
select _t_err('member cannot plant Year/Season scans in another enterprise', '00000000-0000-0000-0000-0000000000b1', $$insert into ys_scans(scan_uid,user_id,enterprise_id,barcode) values (gen_random_uuid(),'00000000-0000-0000-0000-0000000000b1','22222222-2222-2222-2222-222222222222','x')$$, 'row-level security');
select _t_eq('member cannot delete own Year/Season scans', _t_val('00000000-0000-0000-0000-0000000000b1', $$with d as (delete from ys_scans where user_id='00000000-0000-0000-0000-0000000000b1' returning 1) select count(*) from d$$), 0);
select _t_eq('admin team stats: member qty', _t_val('00000000-0000-0000-0000-0000000000e1', $$select total_qty from team_ys_member_stats() where email='member1@x.com'$$), 3);
select _t_eq('admin team stats: closed boxes (distinct PTL+box)', _t_val('00000000-0000-0000-0000-0000000000e1', $$select boxes_closed from team_ys_member_stats() where email='member1@x.com'$$), 1);
select _t_eq('member gets no team stats', _t_val('00000000-0000-0000-0000-0000000000b1', $$select count(*) from team_ys_member_stats()$$), 0);
select _t_eq('other enterprise admin cannot delete these', _t_val('00000000-0000-0000-0000-0000000000e2', $$with d as (delete from ys_scans returning 1) select count(*) from d$$), 0);
select _t_eq('admin can delete team Year/Season scans', _t_val('00000000-0000-0000-0000-0000000000e1', $$with d as (delete from ys_scans where enterprise_id='11111111-1111-1111-1111-111111111111' returning 1) select count(*) from d$$), 3);

-- ============ enterprise rename & invites ============
select _t_err('member cannot rename the enterprise', '00000000-0000-0000-0000-0000000000b1', $$select rename_enterprise('Hacked')$$, 'Only the enterprise admin');
select _t_err('empty enterprise name rejected', '00000000-0000-0000-0000-0000000000e1', $$select rename_enterprise('   ')$$, 'cannot be empty');
select _t_do('00000000-0000-0000-0000-0000000000e1', $$select rename_enterprise('  New Name  ')$$);
select _t_eq('admin rename trims and saves', (select count(*) from enterprises where name='New Name'), 1);

insert into enterprise_invites(enterprise_id, invited_email, invited_by, token, expires_at) values
  ('11111111-1111-1111-1111-111111111111','indiv@x.com','00000000-0000-0000-0000-0000000000e1','cccccccc-cccc-4ccc-8ccc-cccccccccccc', now() - interval '1 day');
select _t_err('expired invite cannot be accepted', '00000000-0000-0000-0000-00000000000a', $$select accept_enterprise_invite('cccccccc-cccc-4ccc-8ccc-cccccccccccc')$$, 'expired');
insert into enterprise_invites(enterprise_id, invited_email, invited_by, token) values
  ('11111111-1111-1111-1111-111111111111','indiv@x.com','00000000-0000-0000-0000-0000000000e1','dddddddd-dddd-4ddd-8ddd-dddddddddddd');
select _t_err('invite for another email cannot be accepted', '00000000-0000-0000-0000-00000000000c', $$select accept_enterprise_invite('dddddddd-dddd-4ddd-8ddd-dddddddddddd')$$, 'not found');

select _t_err('someone already in an enterprise cannot accept another invite', '00000000-0000-0000-0000-0000000000e2', $$select accept_enterprise_invite('dddddddd-dddd-4ddd-8ddd-dddddddddddd')$$, 'already belong');
select _t_do('00000000-0000-0000-0000-00000000000a', $$select accept_enterprise_invite('dddddddd-dddd-4ddd-8ddd-dddddddddddd')$$);
select _t_eq('valid invite makes the person an enterprise member', (select count(*) from profiles where email='indiv@x.com' and tier='enterprise_member'), 1);

\echo All access-rule tests passed
