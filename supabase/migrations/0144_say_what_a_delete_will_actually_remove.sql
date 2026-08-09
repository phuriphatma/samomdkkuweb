-- ============================================================
-- 0144 — student_delete_impact(): tell the admin what ลบ will ACTUALLY remove.
--
-- THE PROBLEM. Deleting a นักศึกษา from ระบบบ้าน does one of two very different
-- things and the dialog said the same sentence for both:
--
--   • the person also holds a ทีม SAMO posting → only the house PLACEMENT goes.
--     Their identity, ตำแหน่ง and สิทธิ์ are untouched, because
--     team_members.person_id is ON DELETE SET NULL and prune_orphan_person only
--     removes a registry row when NO placement of any kind remains.
--
--   • the person is house-only, has never signed in and has never confirmed
--     their identity → prune_orphan_person deletes their public.people row too.
--     They disappear from the registry entirely. After the 1,800-row import
--     that is nearly everyone.
--
-- WHY THIS IS AN RPC AND NOT A CLIENT QUERY. The admin who deletes a student
-- holds `house`; `team_members` is readable with `team`. RLS does not raise for
-- a caller without it — it RETURNS ZERO ROWS. So a client-side "do they have a
-- posting?" check would answer "no" for exactly the person doing the delete,
-- and the dialog would promise total erasure for someone whose ตำแหน่ง is about
-- to survive. That is the same fail-open that made the portrait refcount delete
-- files in use (0143), and the fix is the same: count it server-side.
--
-- AUTHORIZATION is the SAME TEST as the delete it describes — the
-- `students_admin_all` policy — so a caller who could not delete the row cannot
-- use this to ask questions about it either.
--
-- IT RETURNS COUNTS AND FLAGS, never another person's data. `team_nodes` is the
-- list of ฝ่าย names the person is posted in, which the admin is entitled to see
-- (it is the reason not to delete) and which the public org chart already
-- publishes.
-- ============================================================

create or replace function public.student_delete_impact(p_student_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_person       uuid;
  v_exists       boolean;
  v_postings     int  := 0;
  v_nodes        text := null;
  v_other_house  int  := 0;
  v_requests     int  := 0;
  v_signed_in    boolean := false;
  v_confirmed    boolean := false;
begin
  if not coalesce(
       public.current_user_role() = any (array['vp_admin', 'dev'])
       or public.current_user_has_permission('house'), false) then
    raise exception 'student_delete_impact: not authorized' using errcode = '42501';
  end if;

  select true, s.person_id into v_exists, v_person
    from public.students s where s.id = p_student_id;
  if not coalesce(v_exists, false) then
    return jsonb_build_object('found', false);
  end if;

  -- How many คำขอแก้ไข die with the row. student_change_requests.student_ref is
  -- ON DELETE CASCADE, so the decision notes go too — worth saying out loud.
  select count(*) into v_requests
    from public.student_change_requests r where r.student_ref = p_student_id;

  if v_person is not null then
    select count(*),
           nullif(string_agg(distinct n.name, ' · ' order by n.name), '')
      into v_postings, v_nodes
      from public.team_members m
      left join public.team_nodes n on n.id = m.node_id
     where m.person_id = v_person;

    -- Another ระบบบ้าน placement for the same human. Rare, but it is one of the
    -- conditions prune_orphan_person tests, so it has to be one of ours.
    select count(*) into v_other_house
      from public.students s
     where s.person_id = v_person and s.id <> p_student_id;

    select p.user_id is not null, p.identity_confirmed_at is not null
      into v_signed_in, v_confirmed
      from public.people p where p.id = v_person;
  end if;

  return jsonb_build_object(
    'found', true,
    'linked_to_registry', v_person is not null,
    'team_postings', v_postings,
    'team_nodes', v_nodes,
    'other_house_rows', v_other_house,
    'pending_requests', v_requests,
    'signed_in', coalesce(v_signed_in, false),
    'identity_confirmed', coalesce(v_confirmed, false),
    -- ⚠️ THIS RESTATES prune_orphan_person's CONDITIONS. Two implementations of
    -- one rule drift, so `tools/house0144-delete-impact.mjs` asserts this
    -- prediction against what an actual (rolled-back) delete does. If you edit
    -- prune_orphan_person, that proof is what tells you this went stale.
    'person_will_be_pruned',
      v_person is not null
      and not coalesce(v_signed_in, false)
      and not coalesce(v_confirmed, false)
      and v_postings = 0
      and v_other_house = 0
  );
end;
$$;

revoke all on function public.student_delete_impact(uuid) from public;
revoke all on function public.student_delete_impact(uuid) from anon;
grant execute on function public.student_delete_impact(uuid) to authenticated;

comment on function public.student_delete_impact(uuid) is
  'What deleting this ระบบบ้าน row will actually remove: whether the person keeps '
  'a ทีม SAMO posting (and which ฝ่าย), whether their public.people identity will '
  'be pruned with it, and how many คำขอแก้ไข cascade. Same authorization as the '
  'delete itself. Counts server-side because the deleting admin holds `house` '
  'and cannot read team_members — RLS would answer "no posting" rather than '
  'raise (0143).';
