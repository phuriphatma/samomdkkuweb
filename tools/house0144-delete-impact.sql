-- ============================================================
-- house0144-delete-impact.sql — does student_delete_impact() PREDICT what an
-- actual delete does?
--
-- THIS IS A DIFFERENTIAL TEST, not a unit test. `student_delete_impact` restates
-- prune_orphan_person's conditions in a second place, which is this repo's
-- most-repeated bug class (two implementations of one rule drift). So every case
-- below asks the function what it thinks will happen, then DOES the delete and
-- compares — inside a transaction that is rolled back.
--
-- Both directions, because both are silent when wrong: predicting "the person
-- survives" when they are pruned lets an admin erase somebody believing they
-- did not, and predicting "the person is erased" when they survive makes the
-- dialog cry wolf until nobody reads it.
--
--   node tools/db-query.mjs tools/house0144-delete-impact.sql
-- ============================================================
begin;

create temporary table probe (step text, expected text, got text) on commit drop;

-- The RPC is gated on the SAME test as the delete, so the proof has to ask it as
-- somebody who could actually delete. Running as the Postgres owner has
-- auth.uid() = null and no grants, and the function (correctly) raises — which
-- is asserted as its own case in D2/D3 rather than worked around.
-- THE SUBJECT MUST MIRROR THE GATE, BOTH CHANNELS.
--
-- `student_delete_impact` (0144) admits
--     current_user_role() in ('vp_admin','dev')  OR  has_permission('house')
-- but this picker originally matched only the PERMISSION half. On 2026-08-15 it
-- selected NOBODY — zero accounts held `house` in either permission column,
-- while twelve held the role — so `sub` was null, the RPC correctly raised
-- 42501, and the whole proof ERRORED. An errored proof is silence, not a red
-- line (`docs/mistakes/tooling-proofs.md`), and it had been reporting green from
-- a subject that has since evaporated.
--
-- Permission FIRST so the proof keeps exercising that channel whenever anyone
-- holds it; the role branch is the fallback that stops it going subjectless.
create temporary table admin_uid on commit drop as
select uid from (
  select u.id as uid,
         case when 'house' = any(coalesce(u.managed_permissions,'{}'))
                or 'house' = any(coalesce(u.permissions,'{}')) then 0 else 1 end as rank
    from public.users u
   where 'house' = any(coalesce(u.managed_permissions,'{}'))
      or 'house' = any(coalesce(u.permissions,'{}'))
      or u.role = any (array['vp_admin', 'dev'])
) q
order by rank
limit 1;

create or replace function pg_temp.impact(p_id uuid) returns jsonb as $$
declare j jsonb;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub',(select uid::text from admin_uid),'role','authenticated')::text, true);
  execute 'set local role authenticated';
  j := public.student_delete_impact(p_id);
  execute 'reset role';
  return j;
end $$ language plpgsql;

-- ── CASE A: the person ALSO holds a ทีม SAMO posting ────────────────────────
create temporary table a_subj on commit drop as
select s.id as student_id, s.person_id
  from public.students s
 where s.person_id is not null
   and exists (select 1 from public.team_members m where m.person_id = s.person_id)
 limit 1;

create temporary table a_pred on commit drop as
select pg_temp.impact((select student_id from a_subj)) as j;

insert into probe select 'A0. a both-placements subject exists', '1',
  (select count(*)::text from a_subj);
insert into probe select 'A1. predicts the person keeps a posting', 'true',
  ((select (j->>'team_postings')::int from a_pred) > 0)::text;
insert into probe select 'A2. predicts the registry row SURVIVES', 'false',
  (select j->>'person_will_be_pruned' from a_pred);
insert into probe select 'A3. names the ฝ่าย so the admin can see why', 'true',
  ((select j->>'team_nodes' from a_pred) is not null)::text;

-- …now actually do it and compare.
create temporary table a_before on commit drop as
select (select count(*) from public.team_members where person_id=(select person_id from a_subj)) as postings;
delete from public.students where id = (select student_id from a_subj);

insert into probe select 'A4. REALITY: the registry row survived', '1',
  (select count(*)::text from public.people where id=(select person_id from a_subj));
insert into probe select 'A5. REALITY: every posting survived', (select postings::text from a_before),
  (select count(*)::text from public.team_members where person_id=(select person_id from a_subj));
insert into probe select 'A6. REALITY: the house placement is gone', '0',
  (select count(*)::text from public.students where id=(select student_id from a_subj));

-- ── CASE B: house-only, never signed in, never confirmed ────────────────────
create temporary table b_sid on commit drop as
with s as (
  insert into public.students (kkumail, first_name_th, last_name_th)
  values ('zz.probe.0144@kkumail.com', 'ทดสอบ', 'ลบบ้าน')
  returning id, person_id
) select * from s;

create temporary table b_pred on commit drop as
select pg_temp.impact((select id from b_sid)) as j;

insert into probe select 'B1. linked to the registry at birth (0133)', 'true',
  (select j->>'linked_to_registry' from b_pred);
insert into probe select 'B2. predicts NO posting', '0',
  (select j->>'team_postings' from b_pred);
insert into probe select 'B3. predicts the person WILL be pruned', 'true',
  (select j->>'person_will_be_pruned' from b_pred);

delete from public.students where id = (select id from b_sid);

insert into probe select 'B4. REALITY: the registry row was pruned', '0',
  (select count(*)::text from public.people where kkumail='zz.probe.0144@kkumail.com');

-- ── CASE C: house-only but the person HAS signed in → protected ─────────────
create temporary table c_sid on commit drop as
with s as (
  insert into public.students (kkumail, first_name_th, last_name_th)
  values ('zz.probe.0144c@kkumail.com', 'ทดสอบ', 'เคยเข้าระบบ')
  returning id, person_id
) select * from s;
-- Stand in for "has an account" using a real auth user, so the FK holds.
update public.people set user_id = (select id from auth.users limit 1)
 where id = (select person_id from c_sid);

create temporary table c_pred on commit drop as
select pg_temp.impact((select id from c_sid)) as j;

insert into probe select 'C1. predicts signed_in', 'true',
  (select j->>'signed_in' from c_pred);
insert into probe select 'C2. predicts the person is NOT pruned', 'false',
  (select j->>'person_will_be_pruned' from c_pred);

delete from public.students where id = (select id from c_sid);
insert into probe select 'C3. REALITY: the registry row survived', '1',
  (select count(*)::text from public.people where kkumail='zz.probe.0144c@kkumail.com');

-- ── CASE D: a row that does not exist, and the DENY half ────────────────────
insert into probe select 'D0. found a house-capable admin to ask as', '1',
  (select count(*)::text from admin_uid);
insert into probe select 'D1. a missing id answers found=false, never a guess', 'false',
  (pg_temp.impact('00000000-0000-0000-0000-000000000000'::uuid) ->> 'found');
-- The ALLOW/DENY pair: a caller with no house grant must be refused too.
--
-- ⚠️ THE CLAIMS MUST BE CLEARED FIRST. pg_temp.impact() sets request.jwt.claims
-- with `set_config(..., true)`, which is TRANSACTION-scoped, not statement-
-- scoped — and `reset role` does not touch it. Without the reset below this
-- case ran with the house admin's claims still in place, came back ALLOWED, and
-- looked exactly like a broken guard. Same trap as 0136.
do $$
declare v text;
begin
  perform set_config('request.jwt.claims', '', true);
  begin
    perform public.student_delete_impact('00000000-0000-0000-0000-000000000000'::uuid);
    v := 'ALLOWED';
  exception when others then v := 'denied(' || sqlstate || ')';
  end;
  insert into probe values ('D3. DENY: a caller with no house grant is refused', 'denied(42501)', v);
end $$;

do $$
declare v text;
begin
  perform set_config('request.jwt.claims', json_build_object('role','anon')::text, true);
  set local role anon;
  begin
    perform public.student_delete_impact('00000000-0000-0000-0000-000000000000'::uuid);
    v := 'ALLOWED';
  exception when others then v := 'denied(' || sqlstate || ')';
  end;
  reset role;
  insert into probe values ('D2. DENY: anon cannot ask', 'denied(42501)', v);
end $$;

select step, expected, got,
       case when expected = got then 'PASS' else 'FAIL' end as verdict
  from probe order by step;

rollback;
