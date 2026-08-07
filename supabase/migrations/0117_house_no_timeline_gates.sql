-- ============================================================
-- 0117 — House: drop the timeline gates, derive ปีที่เข้า from รหัสนักศึกษา.
--
-- TWO DECISIONS FROM THE USER, BOTH SIMPLIFICATIONS.
--
-- 1. NOTHING IS GATED ON A DATE.
--    0116 made self-service สายรหัส correction depend on
--    `house_settings.sai_edit_until` being set to a future timestamp. That
--    defaulted to NULL, i.e. the feature shipped CLOSED and stayed closed until
--    somebody remembered to set a date — the worst possible default for a
--    system that has to work the moment it is switched on, with or without data.
--    Replaced by a plain boolean toggle, DEFAULT TRUE. The admin closes it when
--    they decide to, not when a calendar says so.
--
-- 2. ปีที่เข้าเรียน IS NOT IMPORTED.
--    รหัสนักศึกษา already carries it: 65 3070317-0 → เข้าปี 2565. So the CSV no
--    longer asks for cohort_year (nor สถานภาพ), and it is derived instead.
--    The column stays — it is still the thing ชั้นปี is computed from — but the
--    importer fills it from student_id rather than from a column nobody should
--    have to type.
--
--    Derivation is a FUNCTION, not a copy in the importer: ชั้นปี is displayed
--    from it in SQL (student_year) and the admin table shows it, so a second
--    implementation in JS would be the drift class this repo pays for most.
-- ============================================================

-- ------------------------------------------------------------
-- §1 — sai_edit_until (a date) → sai_self_edit_open (a switch)
-- ------------------------------------------------------------
alter table public.house_settings
  add column if not exists sai_self_edit_open boolean not null default true;

-- Carry over any intent that was already expressed, then drop the date.
--
-- Guarded: the UPDATE names a column this same migration drops two statements
-- later, so a straight re-run would 42703 on a database that already applied it.
-- "Postgres has no `create or replace policy` — partial-replay migrations 42710
-- out" is the entry in mistakes.md for exactly this shape.
do $$
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'house_settings'
                and column_name = 'sai_edit_until') then
    execute $q$
      update public.house_settings
         set sai_self_edit_open = (sai_edit_until is not null and sai_edit_until > now())
       where sai_edit_until is not null
    $q$;
  end if;
end $$;

alter table public.house_settings drop column if exists sai_edit_until;

comment on column public.house_settings.sai_self_edit_open is
  'While true, a student may correct their OWN สายรหัส once (students.sai_self_edits '
  'caps it, students.sai_locked overrides it). Deliberately a switch and not a '
  'deadline: shipping this closed-until-a-date meant shipping it broken.';

-- ------------------------------------------------------------
-- §2 — ปีที่เข้าเรียน, derived from รหัสนักศึกษา.
--
-- '659999999-9' → '65' → 2565. IMMUTABLE for real (it reads nothing), so it is
-- safe in an index or a generated column later if that is ever wanted.
--
-- Fails CLOSED to null rather than guessing: a รหัส whose first two characters
-- are not digits, or whose year lands outside a plausible window, returns null
-- and the row simply has no ชั้นปี. Inventing 2500 for a malformed id would put
-- a confidently wrong "ปี 69" on a real student's card.
-- ------------------------------------------------------------
create or replace function public.cohort_from_student_id(p_sid text)
returns smallint language sql immutable as $$
  select case
    when p_sid is null then null
    when substring(regexp_replace(p_sid, '\D', '', 'g') from 1 for 2) ~ '^\d{2}$'
     and (2500 + substring(regexp_replace(p_sid, '\D', '', 'g') from 1 for 2)::int)
         between 2540 and 2599
    then (2500 + substring(regexp_replace(p_sid, '\D', '', 'g') from 1 for 2)::int)::smallint
  end;
$$;

comment on function public.cohort_from_student_id(text) is
  'ปีการศึกษาที่เข้า (พ.ศ.) from the first two digits of รหัสนักศึกษา. The ONE '
  'implementation — never recompute this in JS. Returns null rather than '
  'guessing when the id is malformed.';

-- ------------------------------------------------------------
-- §3 — student_year() now falls back to the รหัส when cohort_year is blank.
--
-- Order: an explicit self-declared override wins (ลาพัก / เรียนซ้ำ / จบช้า),
-- then the stored cohort, then the one derived from รหัสนักศึกษา.
-- ------------------------------------------------------------
create or replace function public.student_year(
  p_cohort smallint, p_override smallint, p_sid text default null)
returns smallint language sql stable as $$
  select case
    when p_override is not null then p_override
    else (
      select case when c is null then null
                  else greatest(1, (select academic_year from public.house_settings where id) - c + 1)::smallint
             end
        from (select coalesce(p_cohort, public.cohort_from_student_id(p_sid)) as c) x
    )
  end;
$$;

-- ------------------------------------------------------------
-- §4 — Backfill cohort_year for anything already imported, and keep it filled.
-- ------------------------------------------------------------
update public.students
   set cohort_year = public.cohort_from_student_id(student_id)
 where cohort_year is null and student_id is not null;

-- A row arriving from the importer without cohort_year gets one here rather
-- than relying on every future writer to remember.
create or replace function public.students_fill_cohort()
returns trigger language plpgsql as $$
begin
  if new.cohort_year is null and new.student_id is not null then
    new.cohort_year := public.cohort_from_student_id(new.student_id);
  end if;
  return new;
end;
$$;

drop trigger if exists students_fill_cohort on public.students;
create trigger students_fill_cohort
  before insert or update of student_id, cohort_year on public.students
  for each row execute function public.students_fill_cohort();

-- ------------------------------------------------------------
-- §5 — Repoint the RPCs at the new switch + the new student_year signature.
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
    'year',        public.student_year(s.cohort_year, s.year_override, s.student_id),
    'year_override', s.year_override,
    'status',      s.status,
    'photo_url',   s.photo_url,
    'photo_focus', s.photo_focus,
    'bio',         s.bio,
    'is_listed',   s.is_listed,
    'verified_at', s.verified_at,
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
    year_override = case when p_patch ? 'year_override'
                         then nullif(p_patch->>'year_override','')::smallint
                         else year_override end,
    is_listed     = case when p_patch ? 'is_listed'
                         then coalesce((p_patch->>'is_listed')::boolean, is_listed)
                         else is_listed end,
    verified_at   = case when coalesce((p_patch->>'verify')::boolean, false)
                         then now() else verified_at end
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
             'year',     public.student_year(st.cohort_year, st.year_override, st.student_id),
             'major',    st.major,
             'sai',      st.sai_code,
             'photo_url', st.photo_url)
             order by st.sai_code, st.full_name)
      from public.students st
      join public.sais sx on sx.code = st.sai_code
     where sx.house_id = p_house
       and st.is_listed
       and st.status in ('active','leave')
  ), '[]'::jsonb);
end;
$$;

-- The 2-arg signature is now dead; drop it so no caller can bind to the old one
-- and silently lose the รหัส fallback.
drop function if exists public.student_year(smallint, smallint);

revoke all on function public.cohort_from_student_id(text) from public;
revoke all on function public.cohort_from_student_id(text) from anon;
grant execute on function public.cohort_from_student_id(text) to authenticated;
revoke all on function public.student_year(smallint, smallint, text) from public;
revoke all on function public.student_year(smallint, smallint, text) from anon;
grant execute on function public.student_year(smallint, smallint, text) to authenticated;
