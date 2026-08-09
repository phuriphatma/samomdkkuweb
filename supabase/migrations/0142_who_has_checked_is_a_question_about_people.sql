-- ============================================================
-- 0142 — "who has checked" is a question about PEOPLE, not about house
--        placements
--
-- WHAT WAS ASKED
--   "if you want to show how much people has ยืนยัน, admin should also see who
--    has ยืนยัน and who is still left not ยืนยัน, like each person"
--   "i only see 3 test data people in ระบบบ้าน, so you haven't answer my question
--    would there be people populated in ระบบบ้าน from teamsamo"
--
-- BOTH ARE THE SAME BUG, AND IT IS MINE. 0141 shipped a counts strip that reads
-- `identity_check_summary()` — which counts `public.people`, ~304 humans — and a
-- per-row "ยังไม่ได้ตรวจ" filter on the นักศึกษา list, which reads
-- `public.students`, currently THREE rows. Two populations, one screen,
-- presented as if they were the same thing. The owner spotted it immediately
-- and by the shortest possible route: the number said hundreds and the list
-- showed three.
--
-- AND IT ANSWERS THE POPULATE QUESTION PROPERLY THIS TIME. The earlier answer —
-- "no, a `students` row is a house placement and ทีม SAMO has no สายรหัส to give
-- it" — is architecturally true and operationally useless, because it left the
-- ยืนยัน tracking measuring three test rows during the exact week it exists for.
-- The right answer is not to fabricate ~380 placements with an empty สาย. It is
-- that WHO-HAS-CHECKED was never a question about ระบบบ้าน at all:
--
--   • `identity_confirmed_at` lives on `people` (0138), because confirming your
--     name is a fact about you, not about where you live;
--   • every ทีม SAMO member already HAS a `people` row (0132/0133 link at
--     birth), which is why the count was right and only the list was wrong;
--   • so the ~300 people who can be chased this week are already in the
--     registry, and the list simply has to read the same table the count does.
--
-- When the faculty file lands, those same people acquire a `students` row by
-- kkumail (0139) and this list grows to 1,800 without anything changing here.
--
-- THE PROJECTION, and why it is allowed to be this wide. This publishes a name,
-- a kkumail, a ทีม SAMO posting and a timestamp for every person in the
-- registry, to admins holding `house` or `team_edit` — who can already see the
-- ทีม SAMO roster and the นักศึกษา list. It carries NO สายรหัส, NO บ้าน, no bio,
-- no photo and no request history. It is a hand-built column list, never
-- `returns setof public.people` (the 0079/0080 trap), it is paged, and it is not
-- granted to anon. Written down here so the next widening is a decision.
-- ============================================================

create or replace function public.list_identity_check(
  p_status text default 'all',
  p_q      text default '',
  p_limit  int  default 100,
  p_offset int  default 0)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_q     text;
  v_pat   text;
  v_limit int;
  v_rows  jsonb;
  v_total int;
begin
  if not (public.current_user_role() = any (array['vp_admin','dev'])
          or public.current_user_has_permission('house')
          or public.current_user_has_permission('team_edit')) then
    raise exception 'ไม่มีสิทธิ์ดูรายชื่อนี้';
  end if;

  -- Wildcards escaped, exactly as search_people does (0137). This one is a
  -- LISTING, so an unescaped `%` would not merely widen a search — it would be
  -- indistinguishable from the empty filter, which is fine here, but the habit
  -- is what keeps 0101 from happening a third time.
  v_q := btrim(coalesce(p_q, ''));
  v_q := replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_');
  v_pat := '%' || v_q || '%';
  v_limit := least(greatest(coalesce(p_limit, 100), 1), 500);

  with base as (
    select p.id, p.full_name, p.first_name_th, p.last_name_th, p.nickname,
           p.kkumail, p.student_id, p.major, p.identity_confirmed_at,
           -- CHECKED means confirmed OR edited. Someone who corrected their
           -- สาขา has plainly looked, and making them also press a button would
           -- turn this list into a measure of button-pressing (0138).
           (p.identity_confirmed_at is not null
            or exists (select 1 from public.students s
                        where s.person_id = p.id
                          and coalesce(array_length(s.self_edited, 1), 0) > 0)) as checked,
           exists (select 1 from public.students s where s.person_id = p.id) as in_house,
           coalesce((select string_agg(distinct n.name, ' · ')
                       from public.team_members m
                       join public.team_nodes n on n.id = m.node_id
                      where m.person_id = p.id), '') as team_nodes,
           (select count(*) from public.identity_conflicts c
             where c.person_id = p.id and c.status = 'open') as open_conflicts
      from public.people p
     where v_q = ''
        or coalesce(p.full_name, '')     ilike v_pat
        or coalesce(p.first_name_th, '') ilike v_pat
        or coalesce(p.last_name_th, '')  ilike v_pat
        or coalesce(p.nickname, '')      ilike v_pat
        or coalesce(p.kkumail, '')       ilike v_pat
        or coalesce(p.student_id, '')    ilike v_pat
  ), filtered as (
    select * from base
     where p_status = 'all'
        or (p_status = 'checked'   and checked)
        or (p_status = 'unchecked' and not checked)
        or (p_status = 'conflict'  and open_conflicts > 0)
  )
  select coalesce(jsonb_agg(to_jsonb(f) order by f.checked, f.full_name), '[]'::jsonb),
         (select count(*)::int from filtered)
    into v_rows, v_total
    from (select * from filtered order by checked, full_name
           limit v_limit offset greatest(coalesce(p_offset, 0), 0)) f;

  return jsonb_build_object('rows', v_rows, 'total', v_total);
end;
$$;

revoke all on function public.list_identity_check(text, text, int, int) from public;
revoke all on function public.list_identity_check(text, text, int, int) from anon;
grant execute on function public.list_identity_check(text, text, int, int) to authenticated;

comment on function public.list_identity_check(text, text, int, int) is
  'WHO has checked their own record and who has not (0142), over public.people '
  '— the same population identity_check_summary() counts. The per-row view used '
  'to read `students`, which is a different and much smaller set, so the number '
  'and the list disagreed. Hand-built columns, paged, no สายรหัส or บ้าน, gated '
  'on house/team_edit/vp_admin/dev, never anon.';

-- ------------------------------------------------------------
-- …and the summary counts the SAME thing the list does.
--
-- 0138's version counted `students.self_edited` separately from
-- `people.identity_confirmed_at`, so "confirmed + self_edited" could exceed the
-- number of humans and neither number matched what a list would show. One
-- definition of `checked`, used by both.
-- ------------------------------------------------------------
create or replace function public.identity_check_summary()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.current_user_role() = any (array['vp_admin','dev'])
          or public.current_user_has_permission('house')
          or public.current_user_has_permission('team_edit')) then
    raise exception 'ไม่มีสิทธิ์ดูสรุปนี้';
  end if;
  return (
    with base as (
      select p.id,
             (p.identity_confirmed_at is not null
              or exists (select 1 from public.students s
                          where s.person_id = p.id
                            and coalesce(array_length(s.self_edited, 1), 0) > 0)) as checked,
             p.identity_confirmed_at is not null as confirmed
        from public.people p
    )
    select jsonb_build_object(
      'people',    (select count(*) from base),
      -- CHECKED is the headline: confirmed OR edited. `confirmed` is kept
      -- beside it because the two answer different follow-ups — one is "they
      -- told us it is right", the other is "they touched it".
      'checked',   (select count(*) from base where checked),
      'confirmed', (select count(*) from base where confirmed),
      'unchecked', (select count(*) from base where not checked),
      'open_conflicts', (select count(*) from public.identity_conflicts where status = 'open'),
      'resolved',  (select count(*) from public.identity_conflicts where status = 'resolved'))
  );
end;
$$;

revoke all on function public.identity_check_summary() from public;
revoke all on function public.identity_check_summary() from anon;
grant execute on function public.identity_check_summary() to authenticated;
