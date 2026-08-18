-- ============================================================
-- proj0165-succession-and-prefs.sql — three questions, all of them in BOTH
-- directions.
--
-- 1. SUCCESSION. `sastaff` (role uni_staff) and `saprof` (role sa_prof) were
--    shared password logins, deleted 2026-08-18. Everything they did is now
--    done by a named person holding the equivalent ทีม SAMO seat ('staff' /
--    'prof'). Does the SEAT actually reach what the ROLE reached? Every
--    project_* policy asks a seat-aware helper, so it should — but "should"
--    is what the 0089→0102 cycle kept being wrong about, and a UI gate that
--    honours a new channel hides the gap until someone tries to save.
--
--    NOTE THE SUBJECTS ARE SEATS, NOT NAMES. The retired accounts are not
--    referenced anywhere below except in §D, which asserts their ABSENCE.
--    A proof that names a person rots the day the org chart moves
--    (docs/mistakes/tooling-proofs.md).
--
-- 2. THE ปีงบประมาณ OVERRIDE (0165). `projects.fiscal_year_be` lets a human
--    move a โครงการ to the budget year the faculty actually booked it under.
--    The audience asked for is ผู้ส่งหนังสือ + เจ้าหน้าที่คณะ, which is
--    exactly `current_user_is_project_actor()` — so this checks the UI's
--    audience and the policy's audience are the SAME set, from both sides.
--
-- 3. THE PER-PERSON DEFAULT FILTER (0165). `project_user_prefs` is own-row-
--    only. The deny direction is the interesting one: a per-row UPDATE policy
--    with USING but no WITH CHECK would let anyone move their row onto
--    somebody else's uid, which is class 1 in .claude/rules/mistakes.md.
--
-- Every ALLOW is paired with a DENY over the same operation. A deny-only probe
-- cannot tell a working guard from a broken service, and an allow-only probe
-- cannot see a gate that has stopped gating.
--
-- RLS does NOT raise on UPDATE — it matches zero rows — so every UPDATE
-- instrument COUNTS rather than catching, and undoes itself by raising inside
-- its own subtransaction.
--
--   node tools/db-query.mjs tools/proj0165-succession-and-prefs.sql
-- ============================================================
begin;

create temporary table probe (step text, expected text, got text) on commit drop;

-- ── Subjects, all resolved from the data ────────────────────────────────────

-- staff = เจ้าหน้าที่คณะ. The seat that replaced `sastaff`.
create temporary table subj_staff on commit drop as
select u.id as uid from public.users u
 where 'staff' = any (coalesce(u.managed_project_seats, '{}'))
   and not ('master' = any (coalesce(u.permissions, '{}')))
   and not ('master' = any (coalesce(u.managed_permissions, '{}')))
 order by u.id limit 1;

-- prof = อาจารย์. The seat that replaced `saprof`.
create temporary table subj_prof on commit drop as
select u.id as uid from public.users u
 where 'prof' = any (coalesce(u.managed_project_seats, '{}'))
   and not ('staff' = any (coalesce(u.managed_project_seats, '{}')))
   and not ('vpa'   = any (coalesce(u.managed_project_seats, '{}')))
   and not ('master' = any (coalesce(u.permissions, '{}')))
   and not ('master' = any (coalesce(u.managed_permissions, '{}')))
 order by u.id limit 1;

-- vpa = ผู้ส่งหนังสือ. The other half of the "may move a ปีงบ" audience.
create temporary table subj_vpa on commit drop as
select u.id as uid from public.users u
 where 'vpa' = any (coalesce(u.managed_project_seats, '{}'))
 order by u.id limit 1;

-- none = no หนังสือโครงการ access by ANY channel. The control. Without it,
-- "denied" proves nothing — a table with no GRANT denies everyone and reads
-- exactly like the policy working (0138).
create temporary table subj_none on commit drop as
select u.id as uid from public.users u
 where u.role = 'user'
   and coalesce(u.managed_project_seats, '{}') = '{}'
   and not ('projects' = any (coalesce(u.permissions, '{}')))
   and not ('master'   = any (coalesce(u.permissions, '{}')))
   and not ('master'   = any (coalesce(u.managed_permissions, '{}')))
 order by u.id limit 1;

create temporary table subj_project on commit drop as
select p.id, p.fiscal_year_be from public.projects p order by p.created_at desc limit 1;

create temporary table subj_doc on commit drop as
select d.id from public.project_documents d order by d.created_at desc limit 1;

-- A HIDDEN project + หนังสือ, created here and rolled back with everything
-- else. THIS IS THE DISCRIMINATOR, and the first draft of this proof did not
-- have it: `projects_read_public` is `using (is_public)` granted to anon AND
-- authenticated (0114), and 27 of the 28 live projects are public — so
-- "the staff seat reads every project" was ALSO true of a user with no grant
-- at all, and the check could not tell a working policy from no policy.
-- A probe whose subject cannot distinguish the two answers is not a probe
-- (docs/mistakes/tooling-proofs.md).
insert into public.projects (id, name, status, is_public, created_at)
values ('PRJ-PROOF-0165', 'proof 0165 — hidden', 'open', false, now());
insert into public.project_documents (id, project_id, type_id, title, status, is_public)
select 'DOC-PROOF-0165', 'PRJ-PROOF-0165', t.id, 'proof 0165 — hidden', 'sent', false
  from public.project_doc_types t order by t.id limit 1;

-- ── Instruments ─────────────────────────────────────────────────────────────

-- How many rows of a table this uid can SELECT. Used for the reach questions.
create or replace function pg_temp.can_read(p_uid uuid, p_sql text)
returns int as $$
declare n int;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_uid::text, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  execute p_sql into n;
  execute 'reset role';
  return n;
exception when others then
  execute 'reset role';
  return -1;
end $$ language plpgsql;

-- Can this uid set `fiscal_year_be` on that project? Counts the rows the
-- UPDATE actually touched (RLS is silent, not loud), then undoes itself.
create or replace function pg_temp.can_move_fy(p_uid uuid, p_project text)
returns text as $$
declare n int; msg text;
begin
  begin
    perform set_config('request.jwt.claims',
      json_build_object('sub', p_uid::text, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    with u as (update public.projects set fiscal_year_be = 2599
                where id = p_project returning 1)
      select count(*) into n from u;
    raise exception using errcode = '22000',
      message = 'UNDO:' || case when n > 0 then 'allow' else 'deny' end;
  exception
    when sqlstate '22000' then
      get stacked diagnostics msg = message_text;
      execute 'reset role';
      return replace(msg, 'UNDO:', '');
    when insufficient_privilege then execute 'reset role'; return 'deny';
    when others then execute 'reset role'; return 'ERROR ' || sqlstate;
  end;
end $$ language plpgsql;

-- Can this uid write a prefs row FOR p_target? p_target = p_uid is the own-row
-- case; p_target <> p_uid is the attempt the WITH CHECK has to stop.
create or replace function pg_temp.can_write_pref(p_uid uuid, p_target uuid, p_val text)
returns text as $$
declare msg text;
begin
  begin
    perform set_config('request.jwt.claims',
      json_build_object('sub', p_uid::text, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    insert into public.project_user_prefs (user_id, default_fiscal_year)
    values (p_target, p_val)
    on conflict (user_id) do update set default_fiscal_year = excluded.default_fiscal_year;
    raise exception using errcode = '22000', message = 'UNDO:allow';
  exception
    when sqlstate '22000' then
      get stacked diagnostics msg = message_text;
      execute 'reset role';
      return replace(msg, 'UNDO:', '');
    when insufficient_privilege then execute 'reset role'; return 'deny';
    when check_violation then execute 'reset role'; return 'rejected-by-check';
    when others then execute 'reset role'; return 'ERROR ' || sqlstate;
  end;
end $$ language plpgsql;

-- Can this uid move an EXISTING own row onto somebody else's uid? This is the
-- half a USING-only UPDATE policy leaves open.
create or replace function pg_temp.can_steal_pref(p_uid uuid, p_other uuid)
returns text as $$
declare n int; msg text;
begin
  begin
    insert into public.project_user_prefs (user_id, default_fiscal_year)
    values (p_uid, 'all') on conflict (user_id) do nothing;
    perform set_config('request.jwt.claims',
      json_build_object('sub', p_uid::text, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    with u as (update public.project_user_prefs set user_id = p_other
                where user_id = p_uid returning 1)
      select count(*) into n from u;
    raise exception using errcode = '22000',
      message = 'UNDO:' || case when n > 0 then 'allow' else 'deny' end;
  exception
    when sqlstate '22000' then
      get stacked diagnostics msg = message_text;
      execute 'reset role';
      return replace(msg, 'UNDO:', '');
    when insufficient_privilege then execute 'reset role'; return 'deny';
    when others then execute 'reset role'; return 'ERROR ' || sqlstate;
  end;
end $$ language plpgsql;

-- Can this uid open a signing request — the เจ้าหน้าที่คณะ job that `sastaff`
-- used to do? INSERT does raise on a WITH CHECK failure.
create or replace function pg_temp.can_request_sign(p_uid uuid, p_doc text, p_prof uuid)
returns text as $$
declare msg text;
begin
  begin
    perform set_config('request.jwt.claims',
      json_build_object('sub', p_uid::text, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    insert into public.project_sign_requests (id, document_id, prof_id, status, requested_by)
    values ('SGN-PROOF-0165', p_doc, p_prof, 'pending', p_uid);
    raise exception using errcode = '22000', message = 'UNDO:allow';
  exception
    when sqlstate '22000' then
      get stacked diagnostics msg = message_text;
      execute 'reset role';
      return replace(msg, 'UNDO:', '');
    when insufficient_privilege then execute 'reset role'; return 'deny';
    when others then execute 'reset role'; return 'ERROR ' || sqlstate;
  end;
end $$ language plpgsql;

-- ── §S preconditions — a vacuous case passes ────────────────────────────────
insert into probe select 'S1. someone holds the staff seat (เจ้าหน้าที่คณะ)', '1',
  (select count(*)::text from subj_staff);
insert into probe select 'S2. someone holds the prof seat (อาจารย์)', '1',
  (select count(*)::text from subj_prof);
insert into probe select 'S3. someone holds the vpa seat (ผู้ส่งหนังสือ)', '1',
  (select count(*)::text from subj_vpa);
insert into probe select 'S4. an ungranted control user exists', '1',
  (select count(*)::text from subj_none);
insert into probe select 'S5. a project exists to move', '1',
  (select count(*)::text from subj_project);
insert into probe select 'S6. a หนังสือ exists to send for signing', '1',
  (select count(*)::text from subj_doc);
insert into probe select 'S7. the staff subject carries NO staff role (seat only)', 'true',
  (select (role = 'user')::text from public.users where id = (select uid from subj_staff));
insert into probe select 'S8. the prof subject carries NO sa_prof role (seat only)', 'true',
  (select (role = 'user')::text from public.users where id = (select uid from subj_prof));

-- ── §A succession: the SEAT reaches what the ROLE reached ───────────────────
-- Every reach question is asked about the HIDDEN probe row, so the answer
-- separates "the actor policy let me in" from "the public-mirror policy did".
insert into probe select 'A1. the staff seat reads a project the PUBLIC cannot', '1',
  pg_temp.can_read((select uid from subj_staff),
    'select count(*)::int from public.projects where id = ''PRJ-PROOF-0165''')::text;
insert into probe select 'A2. the staff seat reads a หนังสือ the PUBLIC cannot', '1',
  pg_temp.can_read((select uid from subj_staff),
    'select count(*)::int from public.project_documents where id = ''DOC-PROOF-0165''')::text;
insert into probe select 'A3. the staff seat may open a signing request', 'allow',
  pg_temp.can_request_sign((select uid from subj_staff), (select id from subj_doc), (select uid from subj_prof));
insert into probe select 'A4. the prof seat reads the requests addressed to อาจารย์', 'true',
  (pg_temp.can_read((select uid from subj_prof),
     'select count(*)::int from public.project_sign_requests') > 0)::text;
insert into probe select 'A5. the ungranted control does NOT read the hidden project', '0',
  pg_temp.can_read((select uid from subj_none),
    'select count(*)::int from public.projects where id = ''PRJ-PROOF-0165''')::text;
insert into probe select 'A6. the ungranted control reads NO signing request at all', '0',
  pg_temp.can_read((select uid from subj_none),
    'select count(*)::int from public.project_sign_requests')::text;
insert into probe select 'A7. the prof seat may NOT open a signing request (seats stay distinct)', 'deny',
  pg_temp.can_request_sign((select uid from subj_prof), (select id from subj_doc), (select uid from subj_prof));
insert into probe select 'A8. the hidden probe row IS hidden (the discriminator works)', '1',
  (select count(*)::text from public.projects where id = 'PRJ-PROOF-0165' and not is_public);

-- ── §B the ปีงบประมาณ override ──────────────────────────────────────────────
insert into probe select 'B1. ผู้ส่งหนังสือ (vpa) may move a โครงการ ปีงบ', 'allow',
  pg_temp.can_move_fy((select uid from subj_vpa), (select id from subj_project));
insert into probe select 'B2. เจ้าหน้าที่คณะ (staff) may move a โครงการ ปีงบ', 'allow',
  pg_temp.can_move_fy((select uid from subj_staff), (select id from subj_project));
insert into probe select 'B3. อาจารย์ (prof) may NOT move a โครงการ ปีงบ', 'deny',
  pg_temp.can_move_fy((select uid from subj_prof), (select id from subj_project));
insert into probe select 'B4. an ungranted user may NOT move a โครงการ ปีงบ', 'deny',
  pg_temp.can_move_fy((select uid from subj_none), (select id from subj_project));
-- B5/B6: "nothing backfills fiscal_year_be" is a statement about the SCHEMA,
-- not about today's rows. The first version of this counted overrides that
-- happen to EQUAL their derived year and asserted 0 — wrong twice over:
--   · it passed only because there are currently no overrides at all (vacuous),
--     and it would have gone RED the first time somebody legitimately pinned a
--     project to the year its date already implied;
--   · its SQL copy of the rule used `extract(month …) >= 10` on a timestamptz
--     in a DB whose TimeZone is UTC, while the JS rule reads the VIEWER's
--     local calendar (ICT, +7). Anything created 17:00–24:00 UTC on 30 ก.ย.
--     is ปีงบ 2570 in the app and 2569 here. A SQL mirror of a JS rule is two
--     implementations of one rule (mistakes class 6); do not write one that
--     nothing needs.
-- What actually guarantees "no backfill" is that the column is nullable, has
-- no DEFAULT, and no trigger writes it. All three are catalog facts.
insert into probe select 'B5. fiscal_year_be is nullable with NO default (nothing fills it)', 'YES|',
  (select is_nullable || '|' || coalesce(column_default, '')
     from information_schema.columns
    where table_schema = 'public' and table_name = 'projects'
      and column_name = 'fiscal_year_be');
-- "No trigger EXISTS" was the wrong property too, and asserting it found two
-- that do (`projects_public_flag_guard`, which is the column guard that keeps
-- is_public sender-only even though projects_update has no WITH CHECK, and
-- `touch_updated_at`). Neither touches this column. Assert THAT.
insert into probe select 'B6. no trigger on public.projects assigns fiscal_year_be', '0',
  (select count(*)::text from pg_trigger t
     join pg_proc p on p.oid = t.tgfoid
    where t.tgrelid = 'public.projects'::regclass and not t.tgisinternal
      and pg_get_functiondef(p.oid) ~* 'fiscal_year_be');
insert into probe select 'B7. control — the trigger scan can SEE a column name', '2',
  (select count(*)::text from pg_trigger t
     join pg_proc p on p.oid = t.tgfoid
    where t.tgrelid = 'public.projects'::regclass and not t.tgisinternal
      and pg_get_functiondef(p.oid) ~* '(is_public|updated_at)');

-- ── §C the per-person default filter ────────────────────────────────────────
insert into probe select 'C1. a person may set their OWN default', 'allow',
  pg_temp.can_write_pref((select uid from subj_prof), (select uid from subj_prof), 'current');
insert into probe select 'C2. the ungranted control may set their own too (it is a view pref, not a grant)', 'allow',
  pg_temp.can_write_pref((select uid from subj_none), (select uid from subj_none), '2569');
insert into probe select 'C3. nobody may write ANOTHER person''s default', 'deny',
  pg_temp.can_write_pref((select uid from subj_prof), (select uid from subj_staff), 'all');
insert into probe select 'C4. nobody may MOVE their row onto another uid (the WITH CHECK half)', 'deny',
  pg_temp.can_steal_pref((select uid from subj_prof), (select uid from subj_staff));
insert into probe select 'C5. a shape the JS would never send is refused by the CHECK', 'rejected-by-check',
  pg_temp.can_write_pref((select uid from subj_prof), (select uid from subj_prof), 'newest');
insert into probe select 'C6. nobody READS another person''s prefs row', '0',
  pg_temp.can_read((select uid from subj_none),
    'select count(*)::int from public.project_user_prefs where user_id <> ''' ||
    (select uid from subj_none)::text || '''')::text;

-- ── §D the purge actually happened ──────────────────────────────────────────
insert into probe select 'D1. no account holds the uni_staff role any more', '0',
  (select count(*)::text from public.users where role = 'uni_staff');
insert into probe select 'D2. no account holds the sa_prof role any more', '0',
  (select count(*)::text from public.users where role = 'sa_prof');
insert into probe select 'D3. the shared project logins are gone from auth too', '0',
  (select count(*)::text from auth.users
    where email in ('sastaff@samomdkku.app', 'saprof@samomdkku.app'));
insert into probe select 'D4. no project_files row is left unattributed by the purge', '0',
  (select count(*)::text from public.project_files where uploaded_by is null);
insert into probe select 'D5. every pending sign request still names a real อาจารย์', '0',
  (select count(*)::text from public.project_sign_requests
    where status = 'pending' and prof_id is null);
insert into probe select 'D6. the notify audiences are not empty (staff + prof seats resolve)', 'true',
  ((select count(*) from public.users where 'staff' = any (coalesce(managed_project_seats,'{}'))) > 0
   and (select count(*) from public.users where 'prof' = any (coalesce(managed_project_seats,'{}'))) > 0)::text;

select step, expected, got,
       case when expected = got then 'PASS' else 'FAIL' end as result
from probe order by step;

rollback;
