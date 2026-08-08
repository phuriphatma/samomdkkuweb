-- ============================================================
-- 0126 — a student row can exist with NO NAME, and a duplicate รหัส says so
--        in Thai.
--
-- WHY A NAMELESS ROW IS NOW LEGAL. The question was: can we ask Data Analytics
-- for less — just the สายรหัส and a key — and get ชื่อ/นามสกุล from somewhere
-- else? The answer is yes, and it is a better ask for a reason that has nothing
-- to do with speed: **the file stops carrying 1,800 people's names**. What
-- ระบบบ้าน genuinely cannot derive is only two things — the สายรหัส (the
-- university's own advisor assignment) and the address that identifies the
-- person. A name is not one of them: since 0125 the student can type their own,
-- and it is the one field they are guaranteed to know.
--
-- The minimum useful file is therefore three columns — `kkumail, student_id,
-- sai` — and the middle one only because รุ่น (MD50) is derived from it. Two
-- columns (`kkumail, sai`) also work; รุ่น is then blank until the person edits.
--
-- `first_name_th NOT NULL` was the only thing standing in the way. It was right
-- when every row came from a file that always had names; it is wrong now that
-- the file may deliberately not.
--
-- `full_name` is rebuilt to be NULL rather than '' when there is no name at
-- all. An empty string is a value: it renders as a blank where the UI has a
-- perfectly good "ยังไม่มีข้อมูล" branch, and it sorts ahead of every real name.
--
-- ALSO FIXED HERE: `students_sid_uniq` is a UNIQUE index, so a student who
-- self-edits their รหัสนักศึกษา to one somebody else already has gets a raw
-- 23505 with a constraint name in it. 0125 shipped a comment claiming
-- duplicates were tolerated and surfaced to the admin — they are not, and the
-- person doing the typing is the one who has to understand the error.
-- ============================================================

-- ------------------------------------------------------------
-- §1 — Names are optional.
-- ------------------------------------------------------------
alter table public.students alter column first_name_th drop not null;

alter table public.students drop column if exists full_name;
alter table public.students
  add column full_name text generated always as (
    nullif(btrim(coalesce(first_name_th, '') || ' ' || coalesce(last_name_th, '')), '')
  ) stored;

comment on column public.students.first_name_th is
  'Nullable since 0126: the import file may deliberately carry no names at all '
  '(kkumail + สายรหัส is the minimum useful row), and the student fills it in '
  'themselves. A row with no name is incomplete, never invalid.';

-- ------------------------------------------------------------
-- §2 — A duplicate รหัสนักศึกษา, said in a language the typist reads.
--      Everything else is 0125's body, unchanged.
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

  begin
    update public.students set
      first_name_th = v_first,
      last_name_th  = v_last,
      student_id    = v_sid,
      major         = v_major,
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
