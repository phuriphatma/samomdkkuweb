-- ============================================================
-- 0124 — ระบบบ้าน publishes อาจารย์, never students.
--
-- WHAT WENT AWAY. `get_house_roster(smallint)` returned every student in a
-- house — name, ชื่อเล่น, รุ่น, สาขา, สาย, photo — to any signed-in caller, gated
-- only by `house_settings.roster_visible` (default TRUE) and each student's own
-- `is_listed`. It backed a "เพื่อนร่วมบ้าน" button on บ้านของฉัน.
--
-- WHY. Nobody needed it. The question a student actually arrives with is "who
-- are the อาจารย์ in my house", and the card now answers exactly that from
-- `house_advisors`, which `get_my_student_record()` already returns: the
-- อาจารย์ที่ปรึกษา of every สาย whose last digit puts it in the caller's house.
-- อาจารย์ appear in their staff capacity; no student is named to another
-- student anywhere in ระบบบ้าน.
--
-- So this is a read path REMOVED, not narrowed. `students` holds ~1,800 people's
-- names and รหัสนักศึกษา, and this repo's standing rule is that such a table gets
-- no public read and only hand-built projections (0086 / 0103 / 0108). One fewer
-- projection is one fewer thing to keep correct — and dropping the function is
-- what makes that true for every caller at once, rather than for the one button
-- that happened to be removed from the UI.
--
-- COLUMNS KEPT, as in 0123: `house_settings.roster_visible` and
-- `students.is_listed` are now vestigial. Nothing reads them, no UI sets them,
-- and they are commented as such. Dropping a column is the one step a re-run
-- cannot undo, so it waits until the real data has landed.
-- ============================================================

drop function if exists public.get_house_roster(smallint);

-- get_my_student_record() carried `roster_visible` solely so the card could
-- decide whether to draw the เพื่อนร่วมบ้าน button. Rebuilt WITHOUT it, from
-- 0123's body — never from the migration that first defined it, which would
-- silently revert 0120's and 0123's changes.
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

    -- Every อาจารย์ of every สาย in this house. One row per (อาจารย์, สาย): the
    -- card shows which สาย each one looks after, and an อาจารย์ across three สาย
    -- is genuinely three facts, not a duplicate.
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
    'house_advisors', v_house_advisors
  );
end;
$$;

comment on column public.house_settings.roster_visible is
  'VESTIGIAL since 0124 — it gated get_house_roster(), which no longer exists. '
  'ระบบบ้าน publishes อาจารย์, never students.';
comment on column public.students.is_listed is
  'VESTIGIAL since 0124 — the student''s opt-out of a roster that no longer '
  'exists. No reader, no writer.';
