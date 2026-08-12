-- ============================================================
-- pr0149-delete-permission.sql — does soft_delete_pr_ticket() honour the SAME
-- authorization as the DELETE policy it says it mirrors?
--
-- THIS IS A DIFFERENTIAL TEST. `soft_delete_pr_ticket` restates
-- `pr_tickets_delete_staff` in a second place (0043 chose an RPC precisely so
-- the soft-delete would not inherit the broader UPDATE policy), and two
-- implementations of one rule drift — which is exactly what happened: 0014 had
-- already added `current_user_has_permission('pr')` to the policy, 0043 was
-- written from 0001's pr_staff/dev-only version, and the RPC never learned the
-- permission channel. So every case below asks what the POLICY decides, then
-- asks what the RPC decides, and compares.
--
-- Both directions, because both are silent when wrong: a DENY-only probe cannot
-- tell a working guard from a broken service, and an ALLOW-only probe cannot see
-- a gate that has stopped gating.
--
-- Every subject is RESOLVED FROM THE DATA, never hardcoded — a proof whose
-- subject is a person's name rots the moment the org chart moves.
--
-- Each instrument UNDOES ITSELF by raising inside its own subtransaction, so
-- nothing here depends on the outer rollback and no probe row is lost to a
-- `rollback to savepoint` (which discards the temp-table insert as well).
--
--   node tools/db-query.mjs tools/pr0149-delete-permission.sql
-- ============================================================
begin;

create temporary table probe (step text, expected text, got text) on commit drop;
create temporary table verdict (subj text, gate text, got text) on commit drop;

-- ── Subjects ────────────────────────────────────────────────────────────────
-- perm: holds 'pr' ONLY through the permission channel (permissions[] or
--       managed_permissions[]) and has NO staff role. This is the shape a
--       ทีม SAMO node grant produces, and the one that was refused.
create temporary table subj_perm on commit drop as
select u.id as uid, u.role from public.users u
 where u.role not in ('pr_staff', 'dev')
   and not ('master' = any(coalesce(u.permissions, '{}')))
   and not ('master' = any(coalesce(u.managed_permissions, '{}')))
   and ('pr' = any(coalesce(u.permissions, '{}'))
     or 'pr' = any(coalesce(u.managed_permissions, '{}')))
 order by u.id limit 1;

-- role: holds the staff ROLE. The control that must stay ALLOWED.
create temporary table subj_role on commit drop as
select u.id as uid, u.role from public.users u
 where u.role in ('pr_staff', 'dev') order by u.id limit 1;

-- none: no PR access by any channel. The control that must stay DENIED —
--       without it, "denied" proves nothing, because a broken service denies
--       everyone.
create temporary table subj_none on commit drop as
select u.id as uid, u.role from public.users u
 where u.role not in ('pr_staff', 'dev')
   and not ('pr' = any(coalesce(u.permissions, '{}')))
   and not ('pr' = any(coalesce(u.managed_permissions, '{}')))
   and not ('master' = any(coalesce(u.permissions, '{}')))
   and not ('master' = any(coalesce(u.managed_permissions, '{}')))
 order by u.id limit 1;

create temporary table subj_ticket on commit drop as
select t.id from public.pr_tickets t
 where t.deleted_at is null order by t.id limit 1;

-- ── Instruments ─────────────────────────────────────────────────────────────
-- What the RLS DELETE POLICY decides. RLS does NOT raise on DELETE — it removes
-- zero rows — so the instrument counts rather than catching. The raise at the
-- end aborts the inner subtransaction, undoing the delete and carrying the
-- answer out in the message.
create or replace function pg_temp.policy_allows(p_uid uuid, p_id text)
returns text as $$
declare n int; msg text;
begin
  begin
    perform set_config('request.jwt.claims',
      json_build_object('sub', p_uid::text, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    with d as (delete from public.pr_tickets where id = p_id returning 1)
      select count(*) into n from d;
    raise exception using errcode = '22000',
      message = 'UNDO:' || case when n > 0 then 'allow' else 'deny' end;
  exception when sqlstate '22000' then
    get stacked diagnostics msg = message_text;
    execute 'reset role';
    return replace(msg, 'UNDO:', '');
  end;
end $$ language plpgsql;

-- What the RPC decides. 'allow' is only reported when the soft delete actually
-- STAMPED deleted_at — passing the gate and doing nothing is a different bug,
-- and this proof must not score it as success.
create or replace function pg_temp.rpc_allows(p_uid uuid, p_id text)
returns text as $$
declare stamped boolean; msg text;
begin
  begin
    perform set_config('request.jwt.claims',
      json_build_object('sub', p_uid::text, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    perform public.soft_delete_pr_ticket(p_id);
    execute 'reset role';
    select (t.deleted_at is not null) into stamped
      from public.pr_tickets t where t.id = p_id;
    raise exception using errcode = '22000',
      message = 'UNDO:' || case when stamped then 'allow' else 'allow-but-no-stamp' end;
  exception
    when sqlstate '22000' then
      get stacked diagnostics msg = message_text;
      execute 'reset role';
      return replace(msg, 'UNDO:', '');
    when insufficient_privilege then
      execute 'reset role';
      return 'deny';
    when others then
      execute 'reset role';
      return 'ERROR ' || sqlstate;
  end;
end $$ language plpgsql;

-- ── Preconditions — a vacuous case passes, so assert the subjects exist ──────
insert into probe select 'S1. a permission-only PR user exists', '1',
  (select count(*)::text from subj_perm);
insert into probe select 'S2. a staff-role PR user exists', '1',
  (select count(*)::text from subj_role);
insert into probe select 'S3. an ungranted user exists', '1',
  (select count(*)::text from subj_none);
insert into probe select 'S4. a live PR ticket exists', '1',
  (select count(*)::text from subj_ticket);
insert into probe select 'S5. the permission-only subject carries no staff role',
  'true', (select (role not in ('pr_staff', 'dev'))::text from subj_perm);

-- ── Both gates, all three subjects ──────────────────────────────────────────
insert into verdict select 'perm', 'policy',
  pg_temp.policy_allows((select uid from subj_perm), (select id from subj_ticket));
insert into verdict select 'role', 'policy',
  pg_temp.policy_allows((select uid from subj_role), (select id from subj_ticket));
insert into verdict select 'none', 'policy',
  pg_temp.policy_allows((select uid from subj_none), (select id from subj_ticket));
insert into verdict select 'perm', 'rpc',
  pg_temp.rpc_allows((select uid from subj_perm), (select id from subj_ticket));
insert into verdict select 'role', 'rpc',
  pg_temp.rpc_allows((select uid from subj_role), (select id from subj_ticket));
insert into verdict select 'none', 'rpc',
  pg_temp.rpc_allows((select uid from subj_none), (select id from subj_ticket));

insert into probe select 'A1. POLICY allows the permission-only user', 'allow',
  (select got from verdict where subj = 'perm' and gate = 'policy');
insert into probe select 'A2. POLICY allows the staff-role user', 'allow',
  (select got from verdict where subj = 'role' and gate = 'policy');
insert into probe select 'A3. POLICY denies the ungranted user', 'deny',
  (select got from verdict where subj = 'none' and gate = 'policy');
insert into probe select 'B1. RPC allows the permission-only user', 'allow',
  (select got from verdict where subj = 'perm' and gate = 'rpc');
insert into probe select 'B2. RPC allows the staff-role user', 'allow',
  (select got from verdict where subj = 'role' and gate = 'rpc');
insert into probe select 'B3. RPC denies the ungranted user', 'deny',
  (select got from verdict where subj = 'none' and gate = 'rpc');

-- ── The differential itself ─────────────────────────────────────────────────
insert into probe select 'C1. RPC and POLICY agree on all three subjects', '3',
  (select count(*)::text from verdict p join verdict r
     on r.subj = p.subj and r.gate = 'rpc' and p.gate = 'policy'
   where p.got = r.got);

select step, expected, got,
       case when expected = got then 'PASS' else 'FAIL' end as result
from probe order by step;

rollback;
