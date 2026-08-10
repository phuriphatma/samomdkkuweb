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
-- .claude/rules/mistakes.md #7. So the admin row (which MUST see every student)
-- is as important as the anon row (which must see none).
--
-- EXPECTED:
--   1_anon               DENIED 42501     (revoke, not just RLS)
--   2_signed_in_no_grant 0                (RLS filtered)
--   3_admin_sees_all     true             (the allow path works — compared
--                                          against the REAL row count, not a
--                                          magic number that would rot)
--   4_my_house           7                (สาย 017 → last digit)
--   4_my_sai             017
--   5_roster_fn_gone     true             (0124's privacy decision still holds)
--   6_nickname_applied   เอิง             (the legal key landed)
--   6_sai_code_still     017              (the smuggled key did NOT)
--
-- ⚠️ THIS SCRIPT WAS DEAD FROM 0124 UNTIL 2026-08-10 and nobody noticed, which
-- is the most useful thing in it. It called `get_house_roster(7)`, which 0124
-- DROPPED on purpose (ระบบบ้าน publishes อาจารย์, never students), so the whole
-- DO block aborted with 42883 on that line and every OTHER assertion here — the
-- anon denial, the RLS filter, the allow path, the self-edit guard — silently
-- stopped running. It also still asserted `status` and `sai_locked`, columns
-- dropped by 0120. A proof that ERRORS is not a proof that fails; it is a proof
-- that is absent, and it reports nothing at all while looking like a file that
-- exists. Rule: when a migration drops a function or a column, grep `tools/`
-- for it in the SAME commit.
--
-- The roster probe is now INVERTED: instead of calling the function, the script
-- asserts the function is GONE. The privacy decision 0124 made is a standing
-- invariant, so it deserves a guard that fails if anyone re-adds it.
--
-- NOTE the role switching is done with set_config inside a DO block, one
-- statement at a time — NOT in CTEs beside the query. A `set_config` in a CTE
-- is not ordered before a count in another CTE, so the first version of this
-- probe reported "anon sees 2" and looked like a catastrophic leak.
-- ============================================================
begin;

-- SUBJECTS ARE RESOLVED, NEVER NAMED. The previous version hardcoded
-- `manee.j@kkumail.com` as the signed-in subject — an address that has never
-- existed in public.users — so `auth.uid()` was NULL for the whole ALLOW half
-- and sections 3-4 could not have worked even before 0124 broke the file
-- outright. A named fixture is a bet that the data will not move. It always
-- moves. (Same repair as tools/proj0092-seat-parity.mjs, same week.)
create temporary table subj on commit drop as
select
  -- an admin who is SUPPOSED to see every student
  (select u.id from public.users u
    where 'house'  = any(coalesce(u.permissions,'{}'))
       or 'house'  = any(coalesce(u.managed_permissions,'{}'))
       or 'master' = any(coalesce(u.permissions,'{}'))
       or 'master' = any(coalesce(u.managed_permissions,'{}'))
       or u.role = 'dev'
    order by u.id limit 1) as admin_id,
  -- an ordinary account: no grants by EITHER column (0081 — the union is what
  -- current_user_has_permission reads), and no ระบบบ้าน row yet, so this script
  -- can give them one without colliding with students_kkumail_key.
  (select u.id from public.users u
    where coalesce(array_length(u.permissions,1),0) = 0
      and coalesce(array_length(u.managed_permissions,1),0) = 0
      and u.role = 'user'
      and nullif(btrim(coalesce(u.email,'')),'') is not null
      and not exists (select 1 from public.students s
                       where lower(btrim(s.kkumail)) = lower(btrim(u.email)))
    order by u.id limit 1) as plain_id;

-- Two students to observe: one belonging to the ordinary subject (so
-- get_my_student_record / update_my_student_record have something to act on),
-- and one stranger, so "sees 2" is distinguishable from "sees only my own".
insert into public.students (kkumail, first_name_th, last_name_th, student_id, major, sai_code)
select lower(btrim(u.email)),'มานี','ใจดี','659999999-9','MD','017'
  from public.users u join subj on u.id = subj.plain_id;
insert into public.students (kkumail, first_name_th, last_name_th, student_id, major, sai_code)
values ('someone.else@kkumail.com','สมชาย','ใจดี','669999998-8','MD','007');

do $$
declare v_owner uuid; v_plain uuid;
begin
  select admin_id, plain_id into v_owner, v_plain from subj;
  if v_owner is null then raise exception 'no house/master-granted account found'; end if;
  if v_plain is null then raise exception 'no ungranted account without a students row found'; end if;

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
  -- The admin must see EVERY student, so the assertion is against the true row
  -- count rather than a magic number: this database holds real students, and a
  -- hardcoded "2" would have been another fixture waiting to rot.
  perform set_config('role','authenticated',true);
  perform set_config('request.jwt.claims',
    json_build_object('sub',v_owner,'role','authenticated')::text,true);
  perform set_config('probe.master',(select count(*) from public.students)::text,true);
  perform set_config('role','postgres',true);
  perform set_config('probe.total',(select count(*) from public.students)::text,true);

  -- (4) THE PERSON'S OWN CARD — runs as the ordinary account, which is whose
  -- ระบบบ้าน row this script created. Reading it must go through the definer
  -- RPC; there is no direct SELECT path (that is what probe.nogrant asserts).
  perform set_config('role','authenticated',true);
  perform set_config('request.jwt.claims',
    json_build_object('sub',v_plain,'role','authenticated')::text,true);
  perform set_config('probe.mine',  coalesce(public.get_my_student_record()::text,'null'),true);
  -- (5) self-edit allow-list: a FORBIDDEN column smuggled beside a legal one.
  -- `sai_code` decides which บ้าน a person belongs to and is deliberately not
  -- self-editable — a wrong สาย is reported via request_my_change() so a human
  -- approves it. The RPC builds an explicit column list rather than applying the
  -- patch, so the smuggled key is ignored rather than raising; asserting the
  -- STORED VALUE afterwards is therefore the only check that means anything.
  perform set_config('probe.selfedit',
    public.update_my_student_record(
      '{"nickname_self":"เอิง","sai_code":"999"}'::jsonb)::text,true);
  perform set_config('role','postgres',true);
end $$;

select jsonb_pretty(jsonb_build_object(
  '1_anon',                current_setting('probe.anon'),
  '2_signed_in_no_grant',  current_setting('probe.nogrant'),
  '3_admin_sees_all',      current_setting('probe.master') = current_setting('probe.total'),
  '3_admin_saw',           current_setting('probe.master'),
  '4_my_house',            (current_setting('probe.mine')::jsonb)->>'house_id',
  '4_my_sai',              (current_setting('probe.mine')::jsonb)->>'sai',
  -- 0124 dropped get_house_roster on purpose. Guard the ABSENCE, so re-adding a
  -- student-roster reader fails here instead of quietly shipping.
  '5_roster_fn_gone',      not exists (select 1 from pg_proc p
                                         join pg_namespace n on n.oid = p.pronamespace
                                        where n.nspname = 'public'
                                          and p.proname = 'get_house_roster'),
  '6_nickname_applied',    (current_setting('probe.selfedit')::jsonb)->>'nickname',
  '6_sai_code_still',      (select s.sai_code from public.students s join subj on true join public.users u on u.id = subj.plain_id where lower(btrim(s.kkumail)) = lower(btrim(u.email)))
)) as result;
rollback;
