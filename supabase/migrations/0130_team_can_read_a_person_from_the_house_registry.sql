-- ============================================================
-- 0130 — ทีม SAMO can fill a member from ระบบบ้าน, one exact address at a time
--
-- WHAT WAS ASKED
--   "I think House and teamsamo should be integrated to use the same data, like
--    many fields are similar, like the house system will hold more people than
--    teamsamo, but when adding people in teamsamo, or add to roles, department
--    they should can use the data from house system, like there should be one
--    big system that hold account management"
--
-- Right, and the full answer is a schema change this migration deliberately
-- does NOT make. `students` (~1,800 rows) and `team_people` (~380) describe the
-- same humans with the same fields — ชื่อ, ชื่อเล่น, รหัสนักศึกษา, สาขา, kkumail —
-- and both key on kkumail because 0108 established that kkumail identifies a
-- person and รหัสนักศึกษา is a field somebody typed. Two tables holding one
-- fact about one human is the drift class this repo pays for most, and 0108 is
-- the entry describing what it cost last time. Merging them is worth doing and
-- is worth doing carefully: the plan is in docs/PERSON-REGISTRY.md.
--
-- What this migration ships is the half of the request that needs no merge and
-- no new writer: when an admin types a kkumail into the ทีม SAMO member form,
-- the app can ASK ระบบบ้าน who that is instead of making them retype what the
-- university already sent. That removes the retyping — which is where the two
-- copies diverge in the first place — while the tables are still separate.
--
-- THE SHAPE, and why it is this shape.
--   • EXACT match on kkumail, `lower(btrim(...)) = lower(btrim(...))`. Not
--     ILIKE. 0101 is the entry where an ILIKE lookup turned an id into a
--     PATTERN and `{"p_id":"%"}` walked the whole table — an exact comparison
--     is what makes "you must already know the address" true.
--   • ONE row, or none. There is no listing, no prefix search, no count.
--   • A HAND-BUILT allow-list of columns, never `returns setof
--     public.students` — the latter auto-publishes every column a future
--     ALTER TABLE adds (the 0079/0080 trap). สายรหัส, บ้าน, bio, photo and
--     the request history are NOT in it: ทีม SAMO has no business with a
--     person's house placement.
--   • GATED on a real grant. `team` or `house` or vp_admin/dev — the same set
--     that can already edit the ทีม SAMO roster. Note this is a DELIBERATE
--     widening: an admin holding only `team` could not read `students` at all
--     before, and now can resolve one address at a time. That is the price of
--     not retyping 380 people's names, it is bounded to exact addresses the
--     caller already has, and it is stated here rather than discovered later.
--   • NOT granted to anon. An anonymous oracle over "is this address a student
--     here, and what is their name" is exactly what 0101 revoked.
-- ============================================================

create or replace function public.lookup_student_by_kkumail(p_kkumail text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  s public.students%rowtype;
begin
  if auth.uid() is null then raise exception 'ต้องเข้าสู่ระบบก่อน'; end if;
  if not (public.current_user_role() = any (array['vp_admin','dev'])
          or public.current_user_has_permission('team')
          or public.current_user_has_permission('house')) then
    raise exception 'ไม่มีสิทธิ์ค้นข้อมูลนักศึกษา';
  end if;

  -- A blank address must not match a blank column. `lower(btrim())=''` would
  -- otherwise resolve to whatever row happens to have an empty kkumail, and
  -- `students.kkumail` being NOT NULL is not the same as being non-empty.
  if p_kkumail is null or length(btrim(p_kkumail)) = 0 then return null; end if;

  select * into s from public.students
   where lower(btrim(kkumail)) = lower(btrim(p_kkumail));
  if not found then return null; end if;

  -- Named columns only. Everything ทีม SAMO's member form has a box for, and
  -- nothing else: no สายรหัส, no house, no bio, no photo, no request history.
  return jsonb_build_object(
    'kkumail',    s.kkumail,
    'full_name',  s.full_name,
    'first_name', s.first_name_th,
    'last_name',  s.last_name_th,
    'nickname',   s.nickname,
    'student_id', s.student_id,
    'major',      s.major,
    'cohort_year', coalesce(s.cohort_year, public.cohort_from_student_id(s.student_id))
  );
end;
$$;

revoke all on function public.lookup_student_by_kkumail(text) from public;
revoke all on function public.lookup_student_by_kkumail(text) from anon;
grant execute on function public.lookup_student_by_kkumail(text) to authenticated;

comment on function public.lookup_student_by_kkumail(text) is
  'Resolve ONE exact kkumail against ระบบบ้าน, for the ทีม SAMO member form. '
  'Exact match only (never ILIKE — see 0101), hand-built column allow-list, '
  'gated on team/house/vp_admin/dev, never granted to anon. The interim step '
  'toward the shared person registry in docs/PERSON-REGISTRY.md.';
