-- ============================================================
-- house0116-authz.sql — the ระบบบ้าน authorization proof.
--
--   node tools/db-query.mjs tools/house0116-authz.sql
--
-- Wrapped in begin/rollback: it INSERTS two students to have something to
-- observe, then throws the transaction away. Safe to run against prod.
--
-- IT TESTS BOTH DIRECTIONS ON PURPOSE. A probe that can only report "denied"
-- cannot distinguish a working guard from a broken service — the entry in
-- .claude/rules/mistakes.md #7. So the master row (which MUST see 2) is as
-- important as the anon row (which must see none).
--
-- EXPECTED:
--   1_anon               DENIED 42501     (revoke, not just RLS)
--   2_signed_in_no_grant 0                (RLS filtered)
--   3_master_sees        2                (the allow path works)
--   4_my_house           7                (สาย 017 → last digit)
--   4_my_year            5                (derived from รหัส 65, no cohort stored)
--   5_roster_leaks_pii   false            (projection names its columns)
--   6_status_still       active           (self-edit allow-list held)
--   6_sai_locked_still   false            (ditto)
--
-- NOTE the role switching is done with set_config inside a DO block, one
-- statement at a time — NOT in CTEs beside the query. A `set_config` in a CTE
-- is not ordered before a count in another CTE, so the first version of this
-- probe reported "anon sees 2" and looked like a catastrophic leak.
-- ============================================================
begin;
insert into public.students (kkumail, first_name_th, last_name_th, student_id, major, sai_code)
values ('manee.j@kkumail.com','มานี','ใจดี','659999999-9','MD','017'),
       ('someone.else@kkumail.com','สมชาย','ใจดี','669999998-8','MD','007');

do $$
declare v_owner uuid; v_plain uuid;
begin
  select id into v_owner from public.users where email='manee.j@kkumail.com';
  select id into v_plain from public.users where email='samomdkku.ai@gmail.com';

  -- (1) anon. A hard 42501 is a STRONGER result than "zero rows": the grant is
  -- gone, not merely filtered.
  begin
    perform set_config('role','anon',true);
    perform set_config('probe.anon',(select count(*) from public.students)::text,true);
  exception when insufficient_privilege then
    perform set_config('probe.anon','DENIED 42501',true);
  end;
  perform set_config('role','postgres',true);

  -- (2) signed in, no house permission
  begin
    perform set_config('role','authenticated',true);
    perform set_config('request.jwt.claims',
      json_build_object('sub',v_plain,'role','authenticated')::text,true);
    perform set_config('probe.nogrant',(select count(*) from public.students)::text,true);
  exception when insufficient_privilege then
    perform set_config('probe.nogrant','DENIED 42501',true);
  end;
  perform set_config('role','postgres',true);

  -- (3) THE ALLOW DIRECTION — without it the two denials prove nothing.
  perform set_config('role','authenticated',true);
  perform set_config('request.jwt.claims',
    json_build_object('sub',v_owner,'role','authenticated')::text,true);
  perform set_config('probe.master',(select count(*) from public.students)::text,true);
  perform set_config('probe.mine',  coalesce(public.get_my_student_record()::text,'null'),true);
  perform set_config('probe.roster',public.get_house_roster(7::smallint)::text,true);
  -- (4) self-edit allow-list: two forbidden columns smuggled beside a legal one
  perform set_config('probe.selfedit',
    public.update_my_student_record(
      '{"nickname_self":"เอิง","status":"graduated","sai_locked":true}'::jsonb)::text,true);
  perform set_config('role','postgres',true);
end $$;

select jsonb_pretty(jsonb_build_object(
  '1_anon',                current_setting('probe.anon'),
  '2_signed_in_no_grant',  current_setting('probe.nogrant'),
  '3_master_sees',         current_setting('probe.master'),
  '4_my_house',            (current_setting('probe.mine')::jsonb)->>'house_id',
  '4_my_sai',              (current_setting('probe.mine')::jsonb)->>'sai',
  '4_my_year',             (current_setting('probe.mine')::jsonb)->>'year',
  '5_roster_keys',         (select jsonb_agg(k order by k)
                              from jsonb_object_keys((current_setting('probe.roster')::jsonb)->0) k),
  '5_roster_leaks_pii',    ((current_setting('probe.roster')::jsonb->0) ? 'kkumail')
                           or ((current_setting('probe.roster')::jsonb->0) ? 'student_id'),
  '6_nickname_applied',    (current_setting('probe.selfedit')::jsonb)->>'nickname',
  '6_status_still',        (select status from public.students where kkumail='manee.j@kkumail.com'),
  '6_sai_locked_still',    (select sai_locked from public.students where kkumail='manee.j@kkumail.com')
)) as result;
rollback;
