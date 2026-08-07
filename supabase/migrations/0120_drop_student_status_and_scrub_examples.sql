-- ============================================================
-- 0120 — drop students.status, and stop using a real person's รหัสนักศึกษา
--        as the example everywhere.
--
-- 1. สถานภาพ IS NOT NEEDED. 0116 added `students.status`
--    (active/leave/withdrawn/graduated) on the theory that someone พ้นสภาพ
--    should not appear in a house roster. The data was never requested from the
--    Data Analytics dept (the CSV spec asks for 7 columns and status is not one
--    of them), so the column could only ever hold its default — a filter on a
--    value nobody supplies is decoration that still costs a reader the effort of
--    working out what it does. Dropped, and the two RPCs that filtered on it no
--    longer do.
--
--    If "hide people who left" is ever wanted, the honest input is the import
--    itself: a person absent from the newest file already gets `missing_since`
--    stamped (0119), which is real information rather than an unfilled enum.
--
-- 2. THE EXAMPLE รหัสนักศึกษา WAS A REAL ONE. `653070317-0` belongs to an actual
--    student — the repo owner — and it had spread into the CSV template, the
--    handover spec that goes to another department, migration comments, tests
--    and two form placeholders rendered on the live site. THIS REPO IS PUBLIC.
--    Replaced everywhere with `659999999-9`: same shape, same 65 cohort prefix
--    so the ชั้นปี examples still work, but a faculty code of 9999 that cannot
--    belong to anyone.
-- ============================================================

-- ------------------------------------------------------------
-- §1 — The two readers first, so the column is never referenced by a live
--      function while it is being dropped.
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
             'year',     public.student_year(st.cohort_year, st.year_override, st.student_id),
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

create or replace function public.get_house_summary()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'ต้องเข้าสู่ระบบก่อน'; end if;

  return jsonb_build_object(
    'houses', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', h.id,
               'name',   h.name,
               'slogan', h.slogan,
               'color',  h.color,
               'icon',   h.icon_url,
               'members', (select count(*) from public.students st
                            join public.sais sx on sx.code = st.sai_code
                           where sx.house_id = h.id),
               'sais',    (select count(*) from public.sais sx where sx.house_id = h.id))
               order by h.id)
        from public.houses h), '[]'::jsonb));
end;
$$;

-- get_my_student_record() returned `status` in its payload. Rebuilt without it;
-- everything else is unchanged from 0117.
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
    'photo_url',   s.photo_url,
    'photo_focus', s.photo_focus,
    'bio',         s.bio,
    'is_listed',   s.is_listed,
    'verified_at', s.verified_at,
    'sai',         s.sai_code,
    'sai_label',   v_sai.label,
    'sai_locked',  s.sai_locked,
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
-- §2 — Now the column itself.
-- ------------------------------------------------------------
alter table public.students drop column if exists status;
