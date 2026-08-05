-- ============================================================
-- 0112 — tell a person when their รหัสนักศึกษา is shared with someone else
--
-- REPORTED: "i don't see error shown in my main page, even myself has an issue
-- in the admin samo like here รหัสนักศึกษาซ้ำกันระหว่างคนละคน".
--
-- 0110 shipped the ตำแหน่งของฉัน card with its own ตรวจสอบข้อมูล findings, and
-- I documented `sid_clash` as a known, accepted gap: the card runs the SAME
-- rule engine as the admin pane (src/js/team/identity.js) over the caller's own
-- postings, and a clash is by definition a fact about TWO people, so it cannot
-- be computed from a payload that carries only one. That reasoning was right
-- and the conclusion was wrong — it is the person's OWN รหัส, they are the one
-- who knows whether it is mistyped, and a card that stays silent about it is
-- the "nothing here yet and you have no access look identical" failure.
--
-- WHAT THIS DOES NOT DO: re-implement the grouping rule in SQL. That rule lives
-- once, in JS, and is already mirrored once (tools/team-identity-dryrun.mjs);
-- a third copy is the "two implementations of one rule drift" class. Instead
-- the function returns ONE fact the client structurally cannot derive — how
-- many OTHER identities hold the caller's รหัส — and the JS engine keeps
-- computing everything else.
--
-- PRIVACY: a COUNT, never a name or an address. Since 0110 a member can read
-- the whole roster anyway, so this is not the boundary it once was — but
-- get_my_team_seat is called from the PUBLIC bundle and its contract is "your
-- own record and nothing else". Keeping it a count means that stays true even
-- if the roster is narrowed again later.
--
-- Live at the time of writing: 653070317-0 is held by two identities
-- (phuriphat.ma@kkumail.com and phuriphat.hma@kkumail.com), which is exactly
-- the case reported.
-- ============================================================

-- BASED ON 0110's BODY — the latest definition (0109 defined it, 0110 redefined
-- it; verified with pg_get_functiondef before editing, per the "recreating a
-- function from the migration that FIRST defined it" entry). The ONLY change is
-- v_sid_shared and the key it adds.
create or replace function public.get_my_team_seat()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_uid        uuid := auth.uid();
  v_email      text;
  v_postings   jsonb := '[]'::jsonb;
  v_sid_shared int := 0;
  m            public.team_members%rowtype;
  v_node       public.team_nodes%rowtype;
  v_name       text;
  v_nick       text;
  v_empty      jsonb := jsonb_build_object(
                  'email', null, 'name', null, 'nickname', null,
                  'postings', '[]'::jsonb,
                  'permissions', '[]'::jsonb, 'vs_depts', '[]'::jsonb,
                  'project_seats', '[]'::jsonb, 'passport_scopes', '[]'::jsonb,
                  'can_view_team', false, 'can_edit_team', false,
                  'student_id_shared_with', 0);
begin
  if v_uid is null then return v_empty; end if;
  select email into v_email from public.users where id = v_uid;
  -- NOTE `is null or length(btrim()) = 0` rather than a bare null check: a
  -- blank email would match `lower(kkumail) = ''` on any member row whose
  -- kkumail is the empty string, which is 10 live rows.
  if v_email is null or length(btrim(v_email)) = 0 then return v_empty; end if;

  for m in
    select * from public.team_members
     where lower(kkumail) = lower(btrim(v_email))
     order by created_at
  loop
    select * into v_node from public.team_nodes where id = m.node_id;
    if not found then continue; end if;      -- posting on a deleted ตำแหน่ง
    v_name := coalesce(v_name, nullif(btrim(coalesce(m.full_name, '')), ''));
    v_nick := coalesce(v_nick, nullif(btrim(coalesce(m.nickname,  '')), ''));
    v_postings := v_postings || jsonb_build_object(
      'member_id', m.id,
      'node_id',  v_node.id,
      'node',     v_node.name,
      'path',     to_jsonb(public.team_node_path(v_node.id)),
      'is_board', coalesce(v_node.is_board, false),
      'prefix',     m.prefix,
      'full_name',  m.full_name,
      'nickname',   m.nickname,
      'student_id', m.student_id,
      'year',       m.year,
      'major',      m.major,
      'kkumail',    m.kkumail,
      'photo_url',  m.photo_url,
      'photo_focus', m.photo_focus,
      'permissions', to_jsonb((
        select coalesce(array_agg(distinct p), '{}') from unnest(
          coalesce(m.permissions, '{}') ||
          case when coalesce(m.inherit_permissions, true)
               then public.node_effective_permissions(v_node.id)
               else '{}'::text[] end
        ) as p)),
      'confirmed', coalesce(m.confirmed, false)
    );
  end loop;

  -- How many OTHER identities hold one of this person's รหัสนักศึกษา.
  -- An "identity" is the kkumail when it is a real address, else the row itself
  -- — a row with no address cannot be matched to anyone, so it counts as its
  -- own person. That mirrors the email-first grouping the JS rule uses, without
  -- restating the rule: this answers only "how many others", never "who".
  select count(*) into v_sid_shared from (
    select distinct case when kkumail like '%@%' then lower(btrim(kkumail))
                         else 'row:' || id::text end as who
      from public.team_members
     where student_id is not null and btrim(student_id) <> ''
       and student_id in (
             select student_id from public.team_members
              where lower(kkumail) = lower(btrim(v_email))
                and student_id is not null and btrim(student_id) <> '')
       and (kkumail is null or lower(btrim(kkumail)) <> lower(btrim(v_email)))
  ) s;

  return jsonb_build_object(
    'email',           v_email,
    'name',            v_name,
    'nickname',        v_nick,
    'postings',        v_postings,
    'permissions',     to_jsonb(public.effective_team_permissions_for_email(v_email)),
    'vs_depts',        to_jsonb(public.effective_team_vs_depts_for_email(v_email)),
    'project_seats',   to_jsonb(public.effective_team_project_seats_for_email(v_email)),
    'passport_scopes', to_jsonb(public.effective_team_passport_scopes_for_email(v_email)),
    'can_view_team',   public.current_user_has_permission('team')
                        or public.current_user_has_permission('team_edit')
                        or public.current_user_role() = any (array['vp_admin','dev']),
    'can_edit_team',   public.current_user_has_permission('team_edit')
                        or public.current_user_role() = any (array['vp_admin','dev']),
    'student_id_shared_with', v_sid_shared
  );
end;
$$;

revoke all on function public.get_my_team_seat() from public, anon;
grant execute on function public.get_my_team_seat() to authenticated;
