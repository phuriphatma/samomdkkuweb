-- ============================================================
-- 0123 — ระบบบ้าน drops ชั้นปี and ยืนยันข้อมูล.
--
-- TWO PIECES OF DATA WE DECIDED NOT TO KEEP.
--
-- 1. ชั้นปี. It was computed as `house_settings.academic_year - ปีที่เข้า + 1`
--    with a per-student override for ลาพัก / เรียนซ้ำ / จบช้า. Three problems,
--    all structural: it needs a clock (a setting somebody has to move every
--    August, and every record silently reads wrong until they do); it is wrong
--    for anyone off the standard track, which is what the override existed to
--    patch; and it is ambiguous the moment old and new records sit in one list
--    — "ปี 1" means a different human depending on when the row was written.
--
--    รุ่น has none of those properties. It is fixed at admission and readable
--    off the first two digits of the รหัสนักศึกษา: 65… is MD50, 64… is MD49.
--    No clock, no override, no maintenance. So ระบบบ้าน now speaks only รุ่น,
--    and `student_year()` — the SQL half of a rule that also had a JS mirror in
--    src/js/house/fields.js — is DROPPED rather than left lying around for a
--    future caller to pick up. Removing a rule means removing BOTH
--    implementations in the same commit (mistakes.md class 6).
--
-- 2. ยืนยันข้อมูล. `verified_at` recorded that a student had pressed
--    "ข้อมูลถูกต้อง". Nothing ever read it except a counter on the admin
--    overview, no workflow branched on it, and it asked ~1,800 people for a
--    click that bought nothing. It is no longer collected.
--
-- WHAT THIS MIGRATION DOES NOT DO: it does not drop `students.year_override` or
-- `students.verified_at`. Nothing reads or writes them after this, so they cost
-- nothing, and dropping columns is the one step that cannot be undone by
-- re-running a migration. They still ride along in the admin CSV backup, which
-- mirrors the table. Drop them in a later migration if they are still empty
-- when the real data has landed.
--
-- ORDER MATTERS: both readers are rebuilt FIRST, so `student_year()` has no
-- callers left by the time it is dropped (same shape as 0120 dropping `status`).
-- ============================================================

-- ------------------------------------------------------------
-- §1 — เพื่อนร่วมบ้าน publishes รุ่น, not ชั้นปี.
--
-- Same granularity as before: both are derived from ปีที่เข้า, and neither
-- exposes the รหัสนักศึกษา it can come from. The projection is otherwise
-- untouched — it stays an allow-list, never `select *`.
-- ------------------------------------------------------------
create or replace function public.get_house_roster(p_house smallint)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_settings public.house_settings%rowtype;
begin
  if auth.uid() is null then raise exception 'ต้องเข้าสู่ระบบก่อน'; end if;
  select * into v_settings from public.house_settings where id;
  if not v_settings.roster_visible then return '[]'::jsonb; end if;
  if p_house is null or p_house < 0 or p_house > 9 then return '[]'::jsonb; end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'name',     st.full_name,
             'nickname', st.nickname,
             'cohort_year', coalesce(st.cohort_year,
                                     public.cohort_from_student_id(st.student_id)),
             'major',    st.major,
             'sai',      st.sai_code,
             'photo_url', st.photo_url)
             order by st.sai_code, st.full_name)
      from public.students st
      join public.sais sx on sx.code = st.sai_code
     where sx.house_id = p_house
       and st.is_listed
  ), '[]'::jsonb);
end;
$$;

-- ------------------------------------------------------------
-- §2 — The student's own record: no `year`, no `year_override`, no
--      `verified_at`. `cohort_year` stays and is what the card labels as รุ่น.
--      Everything else is unchanged from 0120.
-- ------------------------------------------------------------
create or replace function public.get_my_student_record()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_uid      uuid := auth.uid();
  v_email    text;
  s          public.students%rowtype;
  v_house    public.houses%rowtype;
  v_sai      public.sais%rowtype;
  v_settings public.house_settings%rowtype;
  v_advisors jsonb := '[]'::jsonb;
  v_house_advisors jsonb := '[]'::jsonb;
begin
  if v_uid is null then return null; end if;
  select email into v_email from public.users where id = v_uid;
  if v_email is null or length(btrim(v_email)) = 0 then return null; end if;

  select * into s from public.students
   where lower(btrim(kkumail)) = lower(btrim(v_email));
  if not found then return null; end if;

  select * into v_settings from public.house_settings where id;

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

    select coalesce(jsonb_agg(x order by x->>'name'), '[]'::jsonb)
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
    'is_listed',   s.is_listed,
    'sai',         s.sai_code,
    'sai_label',   v_sai.label,
    'sai_locked',  s.sai_locked,
    -- One switch, one cap, one lock — no clock.
    'sai_editable', (not s.sai_locked)
                    and v_settings.sai_self_edit_open
                    and s.sai_self_edits < 1,
    'house_id',    case when s.sai_code is not null then v_sai.house_id end,
    'house_name',  v_house.name,
    'house_slogan',v_house.slogan,
    'house_color', v_house.color,
    'house_icon',  v_house.icon_url,
    'advisors',    v_advisors,
    'house_advisors', v_house_advisors,
    'roster_visible', v_settings.roster_visible
  );
end;
$$;

-- ------------------------------------------------------------
-- §3 — The self-write drops `year_override` and `verify`.
--
-- Removed HERE and not only in the form. A field the UI stopped sending is
-- still a field the RPC accepts, and this repo has paid three times in one
-- session for putting a rule in the caller instead of in the thing every caller
-- goes through (0119 / 0121 / 0122). After this, no request can set either one.
--
-- The "ไม่พบสายรหัส … ในระบบ" check stays, deliberately — see 0122's header for
-- why the self-edit path is the one place a missing สาย must be refused rather
-- than created on demand.
-- ------------------------------------------------------------
create or replace function public.update_my_student_record(p_patch jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid      uuid := auth.uid();
  v_email    text;
  s          public.students%rowtype;
  v_settings public.house_settings%rowtype;
  v_new_sai  text;
begin
  if v_uid is null then raise exception 'ต้องเข้าสู่ระบบก่อน'; end if;
  select email into v_email from public.users where id = v_uid;
  if v_email is null or length(btrim(v_email)) = 0 then
    raise exception 'บัญชีนี้ไม่มีอีเมล';
  end if;

  select * into s from public.students
   where lower(btrim(kkumail)) = lower(btrim(v_email));
  if not found then raise exception 'ไม่พบข้อมูลนักศึกษาของบัญชีนี้'; end if;

  select * into v_settings from public.house_settings where id;

  update public.students set
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
                         else bio end,
    is_listed     = case when p_patch ? 'is_listed'
                         then coalesce((p_patch->>'is_listed')::boolean, is_listed)
                         else is_listed end
  where id = s.id;

  if p_patch ? 'sai_code' then
    v_new_sai := nullif(btrim(coalesce(p_patch->>'sai_code','')), '');
    if v_new_sai is distinct from s.sai_code then
      if s.sai_locked then
        raise exception 'สายรหัสของคุณถูกล็อกไว้ กรุณาติดต่อผู้ดูแลระบบ';
      end if;
      if not v_settings.sai_self_edit_open then
        raise exception 'ขณะนี้ปิดการแก้ไขสายรหัสด้วยตนเอง กรุณาส่งคำขอแก้ไขแทน';
      end if;
      if s.sai_self_edits >= 1 then
        raise exception 'คุณแก้ไขสายรหัสด้วยตนเองไปแล้ว หากยังไม่ถูกต้องกรุณาส่งคำขอแก้ไข';
      end if;
      if v_new_sai is not null and not exists (select 1 from public.sais where code = v_new_sai) then
        raise exception 'ไม่พบสายรหัส % ในระบบ', v_new_sai;
      end if;
      update public.students
         set sai_code = v_new_sai,
             sai_self_edits = sai_self_edits + 1
       where id = s.id;
    end if;
  end if;

  return public.get_my_student_record();
end;
$$;

-- ------------------------------------------------------------
-- §4 — Now that nothing calls it, the ชั้นปี rule leaves SQL for good.
--      Its JS mirror (`studentYear` in src/js/house/fields.js) is deleted in
--      the same commit; `cohortLabel` replaces both.
-- ------------------------------------------------------------
drop function if exists public.student_year(smallint, smallint, text);

comment on column public.house_settings.academic_year is
  'VESTIGIAL since 0123. It existed only to compute ชั้นปี, which ระบบบ้าน no '
  'longer has (รุ่น is fixed at admission). Nothing reads it; the admin setting '
  'is gone. Kept because dropping it is not reversible by re-running a migration.';
comment on column public.students.year_override is
  'VESTIGIAL since 0123 — the ชั้นปี escape hatch, and there is no ชั้นปี. '
  'update_my_student_record() no longer accepts it.';
comment on column public.students.verified_at is
  'VESTIGIAL since 0123 — ยืนยันข้อมูล was removed as data nothing acted on. '
  'update_my_student_record() no longer sets it.';
