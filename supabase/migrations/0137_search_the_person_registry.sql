-- ============================================================
-- 0137 — search the registry to add someone, instead of retyping them
--
-- WHAT WAS ASKED
--   "when adding people to the teamsamo, they should can be like search name and
--    it'll show people to add, or search other like all informations nickname
--    surname, studentid, สาขา kkumail and it'll show all suggestion to add"
--
-- 0130 gave the member form an EXACT kkumail lookup, which is the right shape
-- for "I already know the address" and useless for "I know a person". Nobody
-- adding ปิติ to ฝ่าย IT knows ปิติ's kkumail; they know ปิติ. So the form asked
-- for the one field a human does not have, and the answer was to retype the
-- other five — which is precisely where two copies of one person diverge.
--
-- `public.people` (0132) is what makes this answerable at all: one row per
-- human, ~1,800 of them once the roster lands, already carrying every field the
-- form has a box for.
--
-- ---------------------------------------------------------------
-- WHY THIS IS AN ILIKE AND 0101 IS NOT A REASON NOT TO
--
-- 0101 is the entry where an ILIKE lookup turned an id into a PATTERN and
-- `{"p_id":"%"}` walked the whole table. The lesson there is not "never ILIKE"
-- — it is that a lookup whose argument is a CAPABILITY must be exact, because
-- pattern-matching a capability means anyone holding `%` holds all of them.
-- Here matching is the entire purpose and the caller already has a real grant.
--
-- What the 0101 shape needs instead is BOUNDS, and these are them:
--   • the wildcards are ESCAPED. `%`, `_` and `\` in the query are literal, so
--     a caller cannot widen their own pattern — `%` searches for a percent
--     sign and matches nobody.
--   • a MINIMUM of 2 characters. One character is a prefix of most of the
--     faculty and is not a search anyone means.
--   • a hard LIMIT, clamped server-side to 50 regardless of what is asked for.
--     A directory is a thing you can page through; this is a thing you can
--     find someone in.
--   • a HAND-BUILT column list, never `returns setof public.people` — that
--     auto-publishes every column a future ALTER TABLE adds (0079/0080).
--   • NO placement facts. สายรหัส and บ้าน are not in the projection and never
--     will be: ทีม SAMO has no business with where a person lives, and 0132
--     keeps sai_code out of the mirrors for the same reason.
--   • GATED on a real grant, and NOT granted to anon. An anonymous "is this
--     person a student here" oracle over 1,800 names is exactly what 0101
--     revoked.
--
-- It is still a widening — a `team` admin can now enumerate parts of the roster
-- rather than confirm one address at a time — and it is written down here so
-- the next one is a decision rather than a drift. It is the price of not
-- retyping 1,800 people, and the alternative on offer was retyping them.
-- ============================================================

create or replace function public.search_people(p_q text, p_limit int default 20)
returns jsonb language plpgsql stable security definer set search_path = public as $$
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
  -- Under two characters is not a search. Returning [] rather than raising:
  -- the caller is a box someone is still typing into, and an error per
  -- keystroke is noise, not information.
  if length(v_q) < 2 then return '[]'::jsonb; end if;

  -- ESCAPE FIRST. Without this the argument is a pattern the caller controls,
  -- which is 0101 exactly. Backslash first, or it re-escapes the escapes.
  v_q := replace(v_q, '\', '\\');
  v_q := replace(v_q, '%', '\%');
  v_q := replace(v_q, '_', '\_');
  v_pat := '%' || v_q || '%';
  v_pre := v_q || '%';

  -- รหัสนักศึกษา is typed with or without its dash and stored with one, so
  -- compare digits to digits. Empty when the query has no digits at all, and
  -- an empty needle would match every row — hence the null.
  v_digits := nullif(regexp_replace(coalesce(p_q, ''), '\D', '', 'g'), '');

  v_limit := least(greatest(coalesce(p_limit, 20), 1), 50);

  select coalesce(jsonb_agg(r order by r.rank, r.full_name), '[]'::jsonb)
    into v_out
    from (
      select p.id, p.kkumail, p.full_name, p.first_name_th, p.last_name_th,
             p.nickname, p.student_id, p.major,
             coalesce(p.cohort_year, public.cohort_from_student_id(p.student_id))
               as cohort_year,
             -- Does this person already hold a ทีม SAMO posting, and where?
             -- Without it the picker offers somebody who is already in the
             -- tree with no hint, and the admin finds out by creating the
             -- duplicate posting this whole registry exists to prevent.
             exists (select 1 from public.team_members m where m.person_id = p.id)
               as in_team,
             coalesce((select string_agg(distinct n.name, ' · ')
                         from public.team_members m
                         join public.team_nodes n on n.id = m.node_id
                        where m.person_id = p.id), '') as team_nodes,
             exists (select 1 from public.students s where s.person_id = p.id)
               as in_house,
             -- A prefix beats a substring: someone typing "สม" means the
             -- people whose name STARTS with it, and ranking by anything else
             -- buries them under everyone with สม in the middle.
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
       order by rank, p.full_name
       limit v_limit
    ) r;

  return v_out;
end;
$$;

revoke all on function public.search_people(text, int) from public;
revoke all on function public.search_people(text, int) from anon;
grant execute on function public.search_people(text, int) to authenticated;

comment on function public.search_people(text, int) is
  'Find a person in the registry by name, นามสกุล, ชื่อเล่น, รหัสนักศึกษา, สาขา '
  'or kkumail, for the ทีม SAMO member form (0137). Wildcards in the query are '
  'ESCAPED, minimum 2 characters, limit clamped to 50, hand-built column list, '
  'gated on team/team_edit/house/vp_admin/dev, never granted to anon. Publishes '
  'NO placement facts — no สายรหัส, no บ้าน (see 0132).';
