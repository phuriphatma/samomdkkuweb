-- ============================================================
-- 0105 — every ปีการศึกษา behaves the same: published snapshot wins, for the
--        CURRENT year too.
--
-- WHY (reported): "for the ปีการศึกษา i want to be able to see picture of every
-- ปี, edit every ปี on team samo, the web can see every ปี".
--
-- 0104 made the current year a special case: it always rendered from the LIVE
-- tree, so its snapshot — even once published — was unreachable, which meant the
-- current year could not be edited as a year and any photo fixed in its archive
-- was invisible. That asymmetry is the whole complaint. 0104's own header called
-- it out as "the one confusing bit"; this removes it.
--
-- NEW RESOLUTION ORDER for get_public_team_chart(year):
--   1. the year has a PUBLISHED archive  -> serve the archive   (any year, incl. current)
--   2. else the year is the current term -> serve the live tree (bootstrap:
--                                            nothing has been published yet)
--   3. else                              -> empty
--
-- So a year becomes "real" the moment it is published, and from then on the
-- public page shows exactly what the admin can edit. Rule 2 keeps a fresh
-- install — and this project right now, with 0 snapshots — working unchanged.
--
-- ── THE TRADE-OFF, STATED ───────────────────────────────────────────────────
-- Once the current year IS published, editing the live tree in จัดการทีม no
-- longer changes the public page until someone re-publishes. That is inherent to
-- "what you see is the snapshot you edited" and is the price of rule 1. It is
-- mitigated in the UI, not here: the ปีการศึกษา pane compares the live tree's
-- newest updated_at against published_at and shows a "ผังสดเปลี่ยนหลังเผยแพร่"
-- warning with a re-publish button. Do NOT try to fix it by auto-publishing on
-- every tree edit — that would silently overwrite hand-corrected archive rows,
-- which is the thing the archive exists to preserve.
--
-- BASED ON THE LIVE BODY of get_public_team_chart (0104 is the only definition —
-- checked with pg_get_functiondef before editing, per the "recreating a function
-- from the migration that FIRST defined it" rule).
-- ============================================================

create or replace function public.get_public_team_chart(p_year integer default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_current   integer;
  v_year      integer;
  v_published boolean;
  v_result    jsonb;
begin
  select t.year into v_current from public.team_terms t where t.is_current limit 1;
  v_year := coalesce(p_year, v_current);

  -- coalesce: a year with no team_terms row at all selects NULL, and `if NULL`
  -- does not take the branch — fine here, but spell it out so the intent is not
  -- mistaken for a fail-open.
  select (t.published_at is not null) into v_published
    from public.team_terms t where t.year = v_year;
  v_published := coalesce(v_published, false);

  -- ── 1. published snapshot (ANY year, including the current one) ──────────
  if v_published then
    select jsonb_build_object(
      'year', v_year,
      'is_current', (v_year is not distinct from v_current),
      'source', 'archive',
      'nodes', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'id', n.id, 'parent_id', n.parent_id,
                 'name', n.name, 'kind', n.kind, 'position', n.position,
                 'is_board', n.is_board)
               order by n.position, n.name)
          from public.team_archive_nodes n
         where n.year = v_year), '[]'::jsonb),
      'members', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'node_id', m.node_id,
                 'name', m.full_name,
                 'nickname', m.nickname,
                 'photo_url', m.photo_url,
                 'photo_focus', m.photo_focus,
                 'position', m.position)
               order by m.position, m.full_name)
          from public.team_archive_members m
         where m.year = v_year), '[]'::jsonb)
    ) into v_result;
    return v_result;
  end if;

  -- ── 2. the current term with nothing published yet -> the live tree ──────
  if v_current is null or v_year is not distinct from v_current then
    with recursive visible as (
      select n.id, n.parent_id, n.name, n.kind, n.position, n.is_board
        from public.team_nodes n
       where n.parent_id is null and n.is_public
      union all
      select c.id, c.parent_id, c.name, c.kind, c.position, c.is_board
        from public.team_nodes c
        join visible v on c.parent_id = v.id
       where c.is_public
    )
    select jsonb_build_object(
      'year', v_current,
      'is_current', true,
      'source', 'live',
      'nodes', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'id', v.id, 'parent_id', v.parent_id,
                 'name', v.name, 'kind', v.kind, 'position', v.position,
                 'is_board', v.is_board)
               order by v.position, v.name)
          from visible v), '[]'::jsonb),
      -- name + nickname + photo + focus + order ONLY. Never kkumail /
      -- student_id / year / major / permissions / vs_dept / project_seat /
      -- passport_* / shop_source / user_id / confirmed.
      'members', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'node_id', m.node_id,
                 'name', m.full_name,
                 'nickname', m.nickname,
                 'photo_url', m.photo_url,
                 'photo_focus', m.photo_focus,
                 'position', m.position)
               order by m.position, m.full_name)
          from public.team_members m
          join visible v on v.id = m.node_id), '[]'::jsonb)
    ) into v_result;
    return v_result;
  end if;

  -- ── 3. an unpublished, non-current year publishes nothing ────────────────
  return jsonb_build_object('year', v_year, 'is_current', false,
                            'source', 'none',
                            'nodes', '[]'::jsonb, 'members', '[]'::jsonb);
end;
$$;

revoke all on function public.get_public_team_chart(integer) from public;
grant execute on function public.get_public_team_chart(integer) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- team_term_status() — is a published snapshot behind the live tree?
-- ---------------------------------------------------------------------------
-- Admin-only. Powers the "ผังสดเปลี่ยนหลังเผยแพร่ครั้งล่าสุด" warning, which is
-- the whole mitigation for the trade-off described in the header. Computed
-- server-side because it needs max(updated_at) across BOTH team tables, and the
-- client would otherwise need two more round trips per repaint.
create or replace function public.team_term_status()
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_live timestamptz;
begin
  if not coalesce(
       public.current_user_role() = any (array['vp_admin', 'dev'])
       or public.current_user_has_permission('team'), false) then
    raise exception 'team_term_status: not authorized';
  end if;

  select greatest(
           coalesce((select max(updated_at) from public.team_nodes),   'epoch'::timestamptz),
           coalesce((select max(updated_at) from public.team_members), 'epoch'::timestamptz))
    into v_live;

  return jsonb_build_object(
    'live_updated_at', v_live,
    'terms', coalesce((
      select jsonb_agg(jsonb_build_object(
               'year', t.year,
               'published_at', t.published_at,
               -- Only meaningful for the CURRENT year: an archived past year is
               -- supposed to diverge from the live tree, that is what it is for.
               'stale', (t.is_current and t.published_at is not null
                         and v_live > t.published_at))
             order by t.year desc)
        from public.team_terms t), '[]'::jsonb));
end;
$$;

revoke all on function public.team_term_status() from public;
revoke all on function public.team_term_status() from anon;
grant execute on function public.team_term_status() to authenticated;
