-- ============================================================
-- 0128 — รุ่น follows the รหัส · a คำขอ answers back · อาจารย์ lose คำนำหน้า
--        and gain an address
--
-- WHAT WAS REPORTED
--   1. "when i change student id like to 59xxxxxxxx or other like 64xxxxxxxx
--       it doesnt change the รุ่น"
--   2. "after user request สายรหัสไม่ถูกต้อง, the admin should be able to input
--       สายรหัส, not just accept / not accept, and the reason admin type
--       doesn't get shown for the user, also the status that admin reject or
--       accept doesn't get shown to the user"
--   3. "อาจารย์ i think it not necessary to collect คำนำหน้า, they'll just put
--       in the ชื่อจริง. it should show email, it should show the word ภาควิชา
--       for user on the web that has that อาจารย์"
--
-- Three sections, one per report. §1 is a genuine data bug and it is live —
-- 1 of the 3 rows currently in `students` carries a cohort_year that its own
-- รหัสนักศึกษา contradicts.
-- ============================================================

-- ------------------------------------------------------------
-- §1 — รุ่น is DERIVED, so it must be RE-derived
--
-- THE BUG. `students_fill_cohort` (0117) filled `cohort_year` only
-- `if new.cohort_year is null`. That condition is true exactly once in a row's
-- life. Edit the รหัสนักศึกษา afterwards — 65… → 59… — and the trigger declines
-- to touch a column that is no longer null, so the row keeps MD50 forever
-- while its own รหัส says MD44. Every reader then agrees with the stale value,
-- because they all read `coalesce(s.cohort_year, cohort_from_student_id(...))`
-- and the coalesce can only prefer the copy.
--
-- THE CLASS. This is "two implementations of one rule drift" wearing its
-- quietest clothes: the two implementations are a DERIVED column and the
-- expression it was derived from, and the drift is invisible because the
-- denormalised copy is the one every reader prefers. 0116 already refused to
-- denormalise the HOUSE onto `students` for exactly this reason ("a
-- denormalised house column is the drift class waiting to happen"); cohort_year
-- is the same shape and got in anyway, because filling it looked like a
-- convenience rather than a copy.
--
-- THE FIX, and why it is not simply "always recompute". An explicit write to
-- `cohort_year` in the SAME statement is still honoured — that is the escape
-- hatch for a transfer student whose รหัส does not encode their intake, and it
-- is the only reason the column is not a GENERATED one. What changes is that a
-- รหัส edit now RE-derives, instead of being outvoted by the answer to the
-- previous รหัส.
-- ------------------------------------------------------------
create or replace function public.students_fill_cohort()
returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    if new.cohort_year is null and new.student_id is not null then
      new.cohort_year := public.cohort_from_student_id(new.student_id);
    end if;
    return new;
  end if;

  -- The caller set cohort_year themselves in this statement: their value wins.
  -- (This is also what keeps a manual correction from being undone by the next
  -- unrelated update — the branch below only fires when the รหัส moved.)
  if new.cohort_year is distinct from old.cohort_year then
    return new;
  end if;

  if new.student_id is distinct from old.student_id then
    -- The รหัส changed, so the รุ่น it encodes changed with it. An unreadable
    -- รหัส gives NULL, which renders as no รุ่น — better than the รุ่น of a
    -- number the row no longer holds.
    new.cohort_year := public.cohort_from_student_id(new.student_id);
  elsif new.cohort_year is null and new.student_id is not null then
    new.cohort_year := public.cohort_from_student_id(new.student_id);
  end if;
  return new;
end;
$$;

comment on function public.students_fill_cohort() is
  'Keeps students.cohort_year in step with students.student_id. Re-derives on '
  'every รหัส change (0128); an explicit cohort_year in the same statement wins.';

-- Recreated rather than assumed: the trigger already lists both columns in its
-- `update of`, and a `create or replace function` does not touch it — but a
-- reader of this file should not have to go and check that.
drop trigger if exists students_fill_cohort on public.students;
create trigger students_fill_cohort
  before insert or update of student_id, cohort_year on public.students
  for each row execute function public.students_fill_cohort();

-- Repair the rows that already drifted. Restricted to rows whose รหัส actually
-- yields a รุ่น: a row with an unreadable รหัส and a hand-entered cohort_year is
-- the escape hatch above, and blanking it here would destroy the one case the
-- column exists for.
update public.students
   set cohort_year = public.cohort_from_student_id(student_id)
 where student_id is not null
   and public.cohort_from_student_id(student_id) is not null
   and cohort_year is distinct from public.cohort_from_student_id(student_id);

-- ------------------------------------------------------------
-- §2 — a คำขอแก้ไข has to answer back
--
-- The student filed a request, an admin approved or rejected it and typed a
-- reason, and the student's card said nothing at all — there was no read path
-- from `student_change_requests` back to the person who wrote the row. RLS on
-- that table is admin-only (0116 §9) and stays that way; the answer travels
-- inside `get_my_student_record()`, which is already the caller's own record
-- and already resolves the student from auth.uid().
--
-- `applied_value` is new. An admin may now approve a สายรหัส request with a
-- CORRECTED value rather than the one that was asked for (report 2), and a row
-- that records only `requested_value` would then tell the student their request
-- was approved while their card shows a different สาย. What was asked and what
-- was done are two facts; the table now holds both.
-- ------------------------------------------------------------
alter table public.student_change_requests
  add column if not exists applied_value text;

comment on column public.student_change_requests.applied_value is
  'What the admin ACTUALLY saved on approval, when it differs from '
  'requested_value. Null on rejection and on a request approved as asked.';

-- ------------------------------------------------------------
-- §3 — อาจารย์: no คำนำหน้า, and the address is published
--
-- คำนำหน้า goes the same way it went for ทีม SAMO in 0113, for the same reason:
-- one more field to type, no reader that treats it as anything but a prefix on
-- the name, and every writer spelling it differently. Existing titles are
-- FOLDED INTO the name rather than deleted — "ผศ.นพ. ก ข" is how the person is
-- addressed, and the field it lived in is what is unnecessary, not the words.
--
-- ⚠️ ORDER. `get_my_student_record()` names `a.title`, so it is rebuilt BEFORE
-- the column is dropped. A drop under a live function body is a runtime error
-- on the next call, not a migration failure — the worst kind, because it lands
-- on a student and not on the person running this.
-- ------------------------------------------------------------
update public.advisors
   set first_name_th = btrim(btrim(coalesce(title, '')) || ' ' || btrim(first_name_th))
 where title is not null and btrim(title) <> '';

-- Rebuilt from the LIVE body (pg_get_functiondef, 2026-08-08) — never from the
-- migration that first defined it, which would silently revert 0123's ชั้นปี
-- removal and 0125's sai_editable removal.
--
-- Three changes: `title` is gone from both advisor lists; `email` now travels
-- with the house-wide list as well as the student's own สาย (a student who
-- needs to reach an อาจารย์ of their house should not have to ask an admin for
-- the address); and `my_requests` carries the outcome of the caller's own
-- คำขอแก้ไข.
create or replace function public.get_my_student_record()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_uid      uuid := auth.uid();
  v_email    text;
  s          public.students%rowtype;
  v_house    public.houses%rowtype;
  v_sai      public.sais%rowtype;
  v_advisors jsonb := '[]'::jsonb;
  v_house_advisors jsonb := '[]'::jsonb;
  v_requests jsonb := '[]'::jsonb;
begin
  if v_uid is null then return null; end if;
  select email into v_email from public.users where id = v_uid;
  if v_email is null or length(btrim(v_email)) = 0 then return null; end if;

  select * into s from public.students
   where lower(btrim(kkumail)) = lower(btrim(v_email));
  if not found then return null; end if;

  if s.sai_code is not null then
    select * into v_sai from public.sais where code = s.sai_code;
    select * into v_house from public.houses where id = v_sai.house_id;

    select coalesce(jsonb_agg(jsonb_build_object(
             'name', a.full_name, 'email', a.email,
             'dept', a.dept, 'photo_url', a.photo_url, 'role', sa.role)
             order by sa.position, a.full_name), '[]'::jsonb)
      into v_advisors
      from public.sai_advisors sa
      join public.advisors a on a.id = sa.advisor_id
     where sa.sai_code = s.sai_code and a.is_active;

    -- Every อาจารย์ of every สาย in this house. One row per (อาจารย์, สาย): the
    -- card shows which สาย each one looks after, and an อาจารย์ across three สาย
    -- is genuinely three facts, not a duplicate.
    select coalesce(jsonb_agg(x order by x->>'sai', x->>'name'), '[]'::jsonb)
      into v_house_advisors
      from (
        select distinct jsonb_build_object(
                 'name', a.full_name, 'email', a.email,
                 'dept', a.dept, 'photo_url', a.photo_url, 'sai', sa.sai_code) as x
          from public.sai_advisors sa
          join public.advisors a on a.id = sa.advisor_id
          join public.sais sx on sx.code = sa.sai_code
         where sx.house_id = v_sai.house_id and a.is_active
      ) d;
  end if;

  -- The caller's OWN requests, newest first. Capped: the card shows a short
  -- history, not an audit log, and the cap is what stops one person with a
  -- habit of filing requests from making this RPC unbounded.
  select coalesce(jsonb_agg(jsonb_build_object(
           'id',              r.id,
           'field',           r.field,
           'current_value',   r.current_value,
           'requested_value', r.requested_value,
           'applied_value',   r.applied_value,
           'status',          r.status,
           'decision_note',   r.decision_note,
           'decided_at',      r.decided_at,
           'created_at',      r.created_at)
         order by r.created_at desc), '[]'::jsonb)
    into v_requests
    from (select * from public.student_change_requests
           where student_ref = s.id
           order by created_at desc
           limit 10) r;

  return jsonb_build_object(
    'kkumail',     s.kkumail,
    'student_id',  s.student_id,
    'full_name',   s.full_name,
    'first_name',  s.first_name_th,
    'last_name',   s.last_name_th,
    'nickname',    s.nickname,
    'nickname_self', s.nickname_self,
    'major',       s.major,
    'cohort_year', coalesce(s.cohort_year, public.cohort_from_student_id(s.student_id)),
    'photo_url',   s.photo_url,
    'photo_focus', s.photo_focus,
    'bio',         s.bio,
    'self_edited', to_jsonb(coalesce(s.self_edited, '{}')),
    'sai',         s.sai_code,
    'sai_label',   v_sai.label,
    'house_id',    case when s.sai_code is not null then v_sai.house_id end,
    'house_name',  v_house.name,
    'house_slogan',v_house.slogan,
    'house_color', v_house.color,
    'house_icon',  v_house.icon_url,
    'advisors',    v_advisors,
    'house_advisors', v_house_advisors,
    'my_requests', v_requests
  );
end;
$$;

-- Now, and only now.
alter table public.advisors drop column if exists title;

comment on column public.advisors.first_name_th is
  'ชื่อจริง, คำนำหน้า included if the person uses one. There is no separate '
  'title column since 0128 — see 0113 for the same decision on ทีม SAMO.';
comment on column public.advisors.email is
  'Published to the students of this อาจารย์''s house via '
  'get_my_student_record(). A staff contact address, in their capacity as '
  'อาจารย์ที่ปรึกษา — not a personal one.';
