-- ============================================================
-- 0125 — a student owns their own ชื่อ-สกุล / รหัสนักศึกษา / สาขา / ชื่อเล่น,
--        and owns their สายรหัส NOT AT ALL.
--
-- THE PROBLEM THIS HAS TO SOLVE FIRST. Until now the split was clean:
-- import-owned columns and self-owned columns were disjoint sets, which is what
-- made "a re-import can never destroy a self-edit" true by construction. Letting
-- a student fix their own name breaks that by definition — ชื่อ-สกุล is exactly
-- an import-owned column — and the October re-import would silently revert every
-- correction anyone made in September. A person who fixes their misspelt name
-- and finds it wrong again a month later does not report it twice.
--
-- THE FIX IS ON THE TABLE, NOT IN THE IMPORTER. `students.self_edited` records
-- WHICH columns this person has taken over, and a BEFORE UPDATE trigger
-- preserves those columns on any write that carries a new `last_import_batch`
-- — i.e. on an import, whichever code path runs it, today or in two years.
-- Putting this in the importer instead would be the third repeat of the shape
-- this repo has already paid for three times in one session (0119 / 0121 / 0122):
-- a rule enforced at one call site rather than at the thing every caller passes
-- through. `nickname` keeps its own older mechanism (two columns + a generated
-- coalesce) because it already works and rewriting it buys nothing.
--
-- An ADMIN edit is not an import write and therefore always wins — including
-- approving a คำขอแก้ไข. That is the intended order: admin > student > import.
--
-- สายรหัส GOES THE OTHER WAY. The student self-edit path for `sai_code` is
-- REMOVED, not merely hidden: a สาย is the university's own advisor assignment
-- and moving yourself between houses is the one edit with an incentive to abuse.
-- The route is now แจ้งข้อมูลไม่ถูกต้อง → an admin approves. Removing it here and
-- not just in the form is the whole point — a field the UI stopped sending is
-- still a field the RPC accepts.
--
-- Consequently VESTIGIAL, commented but not dropped:
--   house_settings.sai_self_edit_open, students.sai_locked,
--   students.sai_self_edits — all three existed only to bound an edit that can
--   no longer happen.
--
-- สาขา IS NOW VALIDATED against `team_majors`, the vocabulary ทีม SAMO already
-- has admin CRUD for. One list, two systems: a second สาขา table would be two
-- implementations of one rule, and this app has three spellings of `MD` in its
-- history to prove what that costs. It is a CHECK against the list, never a
-- foreign key — removing a สาขา from the picker must not blank or block a
-- student row (0113's reasoning, unchanged).
-- ============================================================

-- ------------------------------------------------------------
-- §1 — Which columns this person has taken over.
-- ------------------------------------------------------------
alter table public.students
  add column if not exists self_edited text[] not null default '{}';

comment on column public.students.self_edited is
  'Columns this student has edited themselves. An import must not overwrite '
  'them — enforced by students_keep_self_edits(), a BEFORE UPDATE trigger on '
  'this table, so no writer can forget.';

create or replace function public.students_keep_self_edits()
returns trigger language plpgsql as $$
declare
  v_col  text;
  v_keep jsonb := '{}'::jsonb;
begin
  -- Only an IMPORT is restrained. An import is the write that stamps a new
  -- batch id; admin edits and the student's own writes leave it alone.
  if new.last_import_batch is not distinct from old.last_import_batch then
    return new;
  end if;
  if old.self_edited is null or array_length(old.self_edited, 1) is null then
    return new;
  end if;

  foreach v_col in array old.self_edited loop
    -- Allow-list, not `format('new.%I := ...')`: self_edited is written by a
    -- definer RPC today, but a column name that reaches dynamic SQL is the kind
    -- of thing that becomes an injection the day someone adds a second writer.
    if v_col in ('first_name_th', 'last_name_th', 'student_id', 'major') then
      v_keep := v_keep || jsonb_build_object(v_col, to_jsonb(old) -> v_col);
    end if;
  end loop;

  if v_keep = '{}'::jsonb then return new; end if;
  return jsonb_populate_record(new, to_jsonb(new) || v_keep);
end;
$$;

drop trigger if exists students_keep_self_edits on public.students;
create trigger students_keep_self_edits
  before update on public.students
  for each row execute function public.students_keep_self_edits();

-- ------------------------------------------------------------
-- §2 — The self-edit RPC: four more fields, one fewer.
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
  if p_patch ? 'first_name_th' then
    v_first := nullif(btrim(coalesce(p_patch->>'first_name_th','')), '');
    if v_first is null then raise exception 'กรุณากรอกชื่อ'; end if;
    if v_first is distinct from s.first_name_th then
      v_edits := array(select distinct unnest(v_edits || array['first_name_th']));
    end if;
  else
    v_first := s.first_name_th;
  end if;

  -- ---- นามสกุล ---- (nullable: some people genuinely have none on file)
  if p_patch ? 'last_name_th' then
    v_last := nullif(btrim(coalesce(p_patch->>'last_name_th','')), '');
    if v_last is distinct from s.last_name_th then
      v_edits := array(select distinct unnest(v_edits || array['last_name_th']));
    end if;
  else
    v_last := s.last_name_th;
  end if;

  -- ---- รหัสนักศึกษา ----
  -- Shape only. A DUPLICATE is not refused here: two people sharing a รหัส is a
  -- real thing that happens by mistyping, and the person who is right must not
  -- be blocked by the person who is wrong. The admin pane surfaces the clash.
  if p_patch ? 'student_id' then
    v_sid := nullif(btrim(coalesce(p_patch->>'student_id','')), '');
    if v_sid is not null and v_sid !~ '^[0-9]{9}-[0-9]$' then
      raise exception 'รหัสนักศึกษาต้องเป็น 10 หลัก มีขีดก่อนหลักสุดท้าย เช่น 659999999-9';
    end if;
    if v_sid is distinct from s.student_id then
      v_edits := array(select distinct unnest(v_edits || array['student_id']));
    end if;
  else
    v_sid := s.student_id;
  end if;

  -- ---- สาขา ----
  -- Must be ON the managed list. A free-text สาขา is what produced `MD`, `md`
  -- and `M.D.` for one answer; the picker is only a real constraint if the
  -- server refuses what is not in it.
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

  -- NOTE: there is deliberately NO sai_code branch. A student cannot move
  -- themselves between houses; request_my_change('sai_code', …) is the route,
  -- and an admin decides. Do not add it back "just for the admin switch" —
  -- the switch is gone too.
  return public.get_my_student_record();
end;
$$;

-- ------------------------------------------------------------
-- §3 — The payload loses `sai_editable`: nothing is editable about a สาย.
--      Rebuilt from 0124's body.
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
             'title', a.title, 'name', a.full_name, 'email', a.email,
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
                 'title', a.title, 'name', a.full_name,
                 'dept', a.dept, 'photo_url', a.photo_url, 'sai', sa.sai_code) as x
          from public.sai_advisors sa
          join public.advisors a on a.id = sa.advisor_id
          join public.sais sx on sx.code = sa.sai_code
         where sx.house_id = v_sai.house_id and a.is_active
      ) d;
  end if;

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
    'house_advisors', v_house_advisors
  );
end;
$$;

-- ------------------------------------------------------------
-- §4 — The สาขา vocabulary is faculty-wide now, so the ระบบบ้าน admin can
--      maintain it too. Adding `house` to an OR list of permissions widens the
--      write gate deliberately; it does not create a "scope" beside a blanket
--      grant (the dead-branch class), because every branch here is full access
--      to the same three rows.
-- ------------------------------------------------------------
drop policy if exists "team_majors_write" on public.team_majors;
create policy "team_majors_write" on public.team_majors
  for all to authenticated
  using (
    public.current_user_role() = any (array['vp_admin', 'dev'])
    or public.current_user_has_permission('team_edit')
    or public.current_user_has_permission('house')
  )
  with check (
    public.current_user_role() = any (array['vp_admin', 'dev'])
    or public.current_user_has_permission('team_edit')
    or public.current_user_has_permission('house')
  );

comment on table public.team_majors is
  'Picker vocabulary for สาขา, faculty-wide since 0125: team_members.major AND '
  'students.major both come from this list (the house self-edit RPC refuses a '
  'value outside it). Named team_* for its origin in 0113 only. NOT a foreign '
  'key: both member columns stay free text so removing a สาขา from the list can '
  'never blank or block a person row.';

comment on column public.house_settings.sai_self_edit_open is
  'VESTIGIAL since 0125 — students cannot edit their own สายรหัส at all; the '
  'route is request_my_change(''sai_code'', …) and an admin decides.';
comment on column public.students.sai_locked is
  'VESTIGIAL since 0125 — there is no student self-edit of สายรหัส left to lock.';
comment on column public.students.sai_self_edits is
  'VESTIGIAL since 0125 — the one-change allowance for an edit that no longer exists.';
