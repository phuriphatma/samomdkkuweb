-- ============================================================
-- 0131 — ชั้นปี is DERIVED, and what a person edits is the DIFFERENCE
--
-- WHAT WAS ASKED
--   "i think you should persist both รุ่น MD… and ปี… … it's easier to
--    visualized by like ปี 4 than MDxx isn't it"
--   …and then, on the shape: "student-editable, but not bound to that value,
--    just up to them, and you store the difference as you said is a good idea".
--
-- THE TWO FACTS, AND WHY NEITHER REPLACES THE OTHER.
--   • รุ่น (MD50) — which cohort you entered with. Fixed at admission, readable
--     off the รหัสนักศึกษา, never changes. Identity: who your friends are, which
--     สาย and บ้าน you are in.
--   • ชั้นปี (ปี 4) — what you are studying right now. Schedule, rotation, exams.
--     Changes every August for everybody.
-- Someone who ลาพัก one year is STILL MD50 and is NOW in ปี 4 with the MD51s.
-- Both are true, so the app stores the first and computes the second.
--
-- WHY AN OFFSET AND NOT A YEAR. This is the whole point of the migration.
-- `year_override smallint` — a stored ชั้นปี — is what 0116 had and 0129 dropped,
-- and it is broken by construction: `year_override = 3` is right this year and
-- wrong next year, silently, for exactly the people whose situation is unusual
-- enough that nobody thinks to re-check it. That is the same fill-once failure
-- 0128 fixed on `cohort_year` three migrations ago: a value written once,
-- preferred by every reader, never re-derived.
--
-- `year_offset = -1` means "permanently one year behind their รุ่น". It is
-- correct in 2569, in 2570, and in 2575, with no maintenance ever. A person who
-- ลาพัก two years is -2. Someone who somehow moved ahead is +1.
--
-- DELIBERATELY UNBOUNDED — the user's call, and it is the right one. A CHECK of
-- -3..+1 would be a guess about how long a person can be delayed, and the cost
-- of guessing wrong is a student who cannot record something true about
-- themselves. `smallint` is the only bound, and ชั้นปี is rendered from the
-- result rather than trusting it (see studyYearLabel in src/js/house/fields.js:
-- > 6 reads as "จบแล้ว", < 1 reads as nothing).
--
-- WHERE ปีการศึกษา COMES FROM: the clock, in ONE place, in JS
-- (`academicYear()` in src/js/house/fields.js, rolling over in August). NOT a
-- settings row. A setting somebody must update every August is a thing that is
-- forgotten every August, and an override that pins the value is this same
-- fill-once bug in a third location. There is deliberately NO SQL
-- implementation of the derivation either — nothing server-side gates on ชั้นปี,
-- and a second implementation of one rule is what this repo pays for most
-- (class 6). SQL stores the ingredients; JS does the arithmetic, once.
-- ============================================================

alter table public.students
  add column if not exists year_offset smallint;

comment on column public.students.year_offset is
  'A DIFFERENCE, never a ชั้นปี. Rendered ชั้นปี = ปีการศึกษา - cohort_year + 1 '
  '+ coalesce(year_offset, 0). NULL means "exactly as computed" and is the '
  'normal case. -1 = ลาพัก/เรียนซ้ำ one year, permanently, with no yearly '
  'maintenance — which is the entire reason this is not a stored ชั้นปี (see '
  '0129, which dropped the stored one, and 0128, which fixed the same '
  'fill-once failure on cohort_year). Intentionally unbounded.';

-- ------------------------------------------------------------
-- The student writes their own.
--
-- ลาพัก / เรียนซ้ำ is the person's own fact and only they know it; routing it
-- through a คำขอแก้ไข would make an admin adjudicate information they do not
-- have. Unlike สายรหัส — which decides the house and is therefore the one field
-- with an incentive to abuse — there is nothing to gain by misreporting ชั้นปี.
--
-- Rebuilt from the LIVE body (pg_get_functiondef, 2026-08-08), never from the
-- migration that first defined it — 0126 is the current definition and this
-- adds one branch to it.
-- ------------------------------------------------------------
create or replace function public.update_my_student_record(p_patch jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid    uuid := auth.uid();
  v_email  text;
  s        public.students%rowtype;
  v_first  text;
  v_last   text;
  v_sid    text;
  v_major  text;
  v_offset smallint;
  v_edits  text[];
begin
  if v_uid is null then raise exception 'ต้องเข้าสู่ระบบก่อน'; end if;
  select email into v_email from public.users where id = v_uid;
  if v_email is null or length(btrim(v_email)) = 0 then
    raise exception 'บัญชีนี้ไม่มีอีเมล';
  end if;

  select * into s from public.students
   where lower(btrim(kkumail)) = lower(btrim(v_email));
  if not found then raise exception 'ไม่พบข้อมูลนักศึกษาของบัญชีนี้'; end if;

  v_edits := coalesce(s.self_edited, '{}');

  -- ---- ชื่อ ----
  -- A row may legitimately have none (0126). What is refused is CLEARING one
  -- that exists: sending the key with an empty value is a mistake, not an
  -- intention, and there is no reason a person would erase their own name.
  if p_patch ? 'first_name_th' then
    v_first := nullif(btrim(coalesce(p_patch->>'first_name_th','')), '');
    if v_first is null and s.first_name_th is not null then
      raise exception 'กรุณากรอกชื่อ';
    end if;
    if v_first is distinct from s.first_name_th then
      v_edits := array(select distinct unnest(v_edits || array['first_name_th']));
    end if;
  else
    v_first := s.first_name_th;
  end if;

  -- ---- นามสกุล ----
  if p_patch ? 'last_name_th' then
    v_last := nullif(btrim(coalesce(p_patch->>'last_name_th','')), '');
    if v_last is distinct from s.last_name_th then
      v_edits := array(select distinct unnest(v_edits || array['last_name_th']));
    end if;
  else
    v_last := s.last_name_th;
  end if;

  -- ---- รหัสนักศึกษา ----
  if p_patch ? 'student_id' then
    v_sid := nullif(btrim(coalesce(p_patch->>'student_id','')), '');
    if v_sid is not null and v_sid !~ '^[0-9]{9}-[0-9]$' then
      raise exception 'รหัสนักศึกษาต้องเป็น 10 หลัก มีขีดก่อนหลักสุดท้าย เช่น 659999999-9';
    end if;
    -- Checked BEFORE the update as well as caught after it. The pre-check gives
    -- the good message in the ordinary case; the exception handler below is what
    -- makes it true under a race, because two people can pass this check in the
    -- same instant and only the index can actually decide.
    if v_sid is not null and v_sid is distinct from s.student_id
       and exists (select 1 from public.students x
                    where x.student_id = v_sid and x.id <> s.id) then
      raise exception 'รหัสนักศึกษา % มีคนใช้อยู่แล้ว กรุณาตรวจสอบว่าพิมพ์ถูกต้อง '
                      'หากถูกต้องแล้วให้แจ้งผู้ดูแลระบบ', v_sid;
    end if;
    if v_sid is distinct from s.student_id then
      v_edits := array(select distinct unnest(v_edits || array['student_id']));
    end if;
  else
    v_sid := s.student_id;
  end if;

  -- ---- สาขา ----
  if p_patch ? 'major' then
    v_major := nullif(btrim(coalesce(p_patch->>'major','')), '');
    if v_major is not null then
      select t.code into v_major from public.team_majors t
       where lower(btrim(t.code)) = lower(btrim(v_major));
      if v_major is null then
        raise exception 'สาขานี้ไม่อยู่ในรายการที่ระบบรองรับ';
      end if;
    end if;
    if v_major is distinct from s.major then
      v_edits := array(select distinct unnest(v_edits || array['major']));
    end if;
  else
    v_major := s.major;
  end if;

  -- ---- ชั้นปี, stored as the DIFFERENCE (0131) ----
  -- The client sends the gap, not the year, because only the client knows what
  -- ปีการศึกษา it computed the displayed value against — and if it sent a ชั้นปี
  -- this function would have to derive the base itself, which is the second
  -- implementation this migration's header exists to refuse.
  --
  -- No range CHECK: unbounded is the deliberate choice. A cast failure on
  -- something absurd is a 22003 the caller sees, not a silent clamp.
  if p_patch ? 'year_offset' then
    v_offset := nullif(btrim(coalesce(p_patch->>'year_offset','')), '')::smallint;
    -- 0 and NULL both mean "exactly as computed"; storing 0 would make
    -- self_edited claim an edit that changes nothing a reader could see.
    if v_offset = 0 then v_offset := null; end if;
    if v_offset is distinct from s.year_offset then
      v_edits := array(select distinct unnest(v_edits || array['year_offset']));
    end if;
  else
    v_offset := s.year_offset;
  end if;

  begin
    update public.students set
      first_name_th = v_first,
      last_name_th  = v_last,
      student_id    = v_sid,
      major         = v_major,
      year_offset   = v_offset,
      self_edited   = v_edits,
      nickname_self = case when p_patch ? 'nickname_self'
                           then nullif(btrim(coalesce(p_patch->>'nickname_self','')), '')
                           else nickname_self end,
      photo_url     = case when p_patch ? 'photo_url'
                           then nullif(btrim(coalesce(p_patch->>'photo_url','')), '')
                           else photo_url end,
      photo_focus   = case when p_patch ? 'photo_focus'
                           then nullif(btrim(coalesce(p_patch->>'photo_focus','')), '')
                           else photo_focus end,
      bio           = case when p_patch ? 'bio'
                           then nullif(btrim(coalesce(p_patch->>'bio','')), '')
                           else bio end
    where id = s.id;
  exception when unique_violation then
    -- students_sid_uniq. A raw 23505 shows the caller an index name; this is
    -- the same sentence as the pre-check above, so the person sees one message
    -- whichever path caught it.
    raise exception 'รหัสนักศึกษา % มีคนใช้อยู่แล้ว กรุณาตรวจสอบว่าพิมพ์ถูกต้อง '
                    'หากถูกต้องแล้วให้แจ้งผู้ดูแลระบบ', v_sid;
  end;

  -- Still NO sai_code branch, deliberately (0125).
  return public.get_my_student_record();
end;
$$;

-- ------------------------------------------------------------
-- …and the card reads it back. One key added to the LIVE 0128 body.
-- ------------------------------------------------------------
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
    -- The DIFFERENCE, not a ชั้นปี. The client renders the year from it.
    'year_offset', s.year_offset,
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
