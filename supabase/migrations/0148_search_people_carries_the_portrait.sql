-- ============================================================================
-- 0148 — `search_people()` returns the person's PORTRAIT, so picking a person
--        cannot leave somebody else's face attached to them.
--
-- SYMPTOM, as reported: "in teamsamo, when i press at myself แก้ไขสมาชิก then i
-- ค้นหาคนจากระบบ พู่กัน then click พุธิตา สร้อยสุข … it fills this information,
-- and พู่กัน picture become myself."
--
-- Exactly right, and the picture is the worst part of it.
--
-- THE MECHANISM. `pickPerson()` fills the member form from a search hit. It sets
-- the names, ชื่อเล่น, รหัส, สาขา and kkumail — and it does NOT touch the photo,
-- because `search_people` had no portrait to give it. So after picking, the form
-- describes พู่กัน while still holding the EDITED ROW's photo. Then:
--
--   1. saving writes `kkumail = putita.s@…` onto the edited posting;
--   2. `team_members_link_person` repoints that posting's `person_id` at
--      พู่กัน's `public.people` row (the registry matches on kkumail);
--   3. `team_member_mirror_up` UPDATEs that people row from the posting —
--      including `photo_url` and `photo_focus`;
--   4. `person_mirror_down` pushes the result to every OTHER posting พู่กัน
--      holds and to her `students` row.
--
-- One misclick therefore rewrites a second person's identity across ทีม SAMO,
-- the person registry and ระบบบ้าน, portrait included, with no error anywhere.
-- The mirrors are behaving exactly as designed; what was wrong is that the form
-- was allowed to become a different person while keeping the first one's face.
--
-- WHY THE FIX IS HERE AND NOT ONLY IN THE CLIENT. The client half (confirm
-- before swapping the identity of an existing posting) ships in the same commit,
-- but on its own it would still hand the mirror a mismatched photo the moment
-- the admin legitimately confirms. The photo has to TRAVEL WITH THE PERSON, and
-- the only way the picker can know a person's portrait is for the search to
-- return it. Then step 3 above writes พู่กัน's own photo back onto พู่กัน — a
-- no-op — instead of overwriting it.
--
-- CLEARING IT WOULD HAVE BEEN WORSE. `photo_url = null` in the payload is not
-- "leave it alone": `team_member_mirror_up` assigns unconditionally, so a null
-- would wipe the portrait from the registry and from every other posting the
-- person holds. There is no third option — the picker either knows the real
-- portrait or it corrupts one.
--
-- NOT A PRIVACY WIDENING. `search_people` already raises unless the caller is
-- vp_admin/dev or holds `team` / `team_edit` / `house`, and it already returns
-- the person's kkumail, รหัสนักศึกษา and สาขา. A portrait those same admins can
-- see on the org chart and in every member card is strictly less sensitive than
-- what this function already hands over. Two columns, same audience.
--
-- The body is otherwise IDENTICAL to the live 0137 version — reproduced in full
-- rather than patched, because `create or replace` replaces the whole thing and
-- recreating a function from the migration that FIRST defined it silently
-- reverts every later change (mistakes.md, postgres-schema). This is 0137 plus
-- two columns in the projection, and nothing else moved.
-- ============================================================================

create or replace function public.search_people(p_q text, p_limit integer default 20)
returns jsonb
language plpgsql stable security definer set search_path to 'public'
as $function$
declare
  v_q     text;
  v_pat   text;
  v_pre   text;
  v_digits text;
  v_limit int;
  v_out   jsonb;
begin
  if auth.uid() is null then raise exception 'ต้องเข้าสู่ระบบก่อน'; end if;
  if not (public.current_user_role() = any (array['vp_admin','dev'])
          or public.current_user_has_permission('team')
          or public.current_user_has_permission('team_edit')
          or public.current_user_has_permission('house')) then
    raise exception 'ไม่มีสิทธิ์ค้นข้อมูลบุคคล';
  end if;

  v_q := btrim(coalesce(p_q, ''));
  if length(v_q) < 2 then return '[]'::jsonb; end if;

  -- ESCAPE FIRST. Without this the argument is a pattern the caller controls,
  -- which is 0101 exactly. Backslash first, or it re-escapes the escapes.
  v_q := replace(v_q, '\', '\\');
  v_q := replace(v_q, '%', '\%');
  v_q := replace(v_q, '_', '\_');
  v_pat := '%' || v_q || '%';
  v_pre := v_q || '%';
  v_digits := nullif(regexp_replace(coalesce(p_q, ''), '\D', '', 'g'), '');
  v_limit := least(greatest(coalesce(p_limit, 20), 1), 50);

  -- ⚠️ `rank` BEFORE `stale`, and the 0137 proof is why. Ordering on staleness
  -- first buried an EXACT kkumail match — the strongest signal there is, since
  -- the admin typed the whole address — underneath every ordinary substring hit
  -- that happened to hold a placement. Staleness breaks ties WITHIN a relevance
  -- band; it does not outrank relevance.
  select coalesce(jsonb_agg(r order by r.rank, r.stale, r.full_name), '[]'::jsonb)
    into v_out
    from (
      select p.id, p.kkumail, p.full_name, p.first_name_th, p.last_name_th,
             p.nickname, p.student_id, p.major,
             -- NEW in 0148. The portrait travels with the person so the picker
             -- cannot leave one human's face on another's record.
             p.photo_url, p.photo_focus,
             coalesce(p.cohort_year, public.cohort_from_student_id(p.student_id))
               as cohort_year,
             exists (select 1 from public.team_members m where m.person_id = p.id)
               as in_team,
             coalesce((select string_agg(distinct n.name, ' · ')
                         from public.team_members m
                         join public.team_nodes n on n.id = m.node_id
                        where m.person_id = p.id), '') as team_nodes,
             exists (select 1 from public.students s where s.person_id = p.id)
               as in_house,
             -- Nothing in either system knows this person. §3 stops new ones
             -- appearing; this keeps any survivor at the bottom of the list
             -- instead of beside the real candidates.
             case when exists (select 1 from public.team_members m where m.person_id = p.id)
                    or exists (select 1 from public.students s where s.person_id = p.id)
                  then 0 else 1 end as stale,
             case
               when lower(btrim(coalesce(p.kkumail, ''))) = lower(btrim(p_q)) then 0
               when p.student_id is not null and v_digits is not null
                    and regexp_replace(p.student_id, '\D', '', 'g') = v_digits then 0
               when coalesce(p.first_name_th, '') ilike v_pre
                 or coalesce(p.full_name, '')     ilike v_pre
                 or coalesce(p.nickname, '')      ilike v_pre then 1
               else 2
             end as rank
        from public.people p
       where coalesce(p.full_name, '')     ilike v_pat
          or coalesce(p.first_name_th, '') ilike v_pat
          or coalesce(p.last_name_th, '')  ilike v_pat
          or coalesce(p.nickname, '')      ilike v_pat
          or coalesce(p.kkumail, '')       ilike v_pat
          or coalesce(p.major, '')         ilike v_pat
          or (v_digits is not null and p.student_id is not null
              and regexp_replace(p.student_id, '\D', '', 'g') like '%' || v_digits || '%')
       order by rank, stale, p.full_name
       limit v_limit
    ) r;

  return v_out;
end;
$function$;

revoke all on function public.search_people(text, integer) from public, anon;
grant execute on function public.search_people(text, integer) to authenticated;
