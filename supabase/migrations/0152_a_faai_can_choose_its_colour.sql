-- 0152 — a ฝ่าย can be told what colour it is.
--
-- REQUESTED: "make admin can custom the color also".
--
-- Until now the colour identity of a ฝ่าย was DERIVED from its name, by a regex
-- table in the frontend (src/js/dept-tint.js). That works for the ten ฝ่าย the
-- SAMO 69 colour sheet named and for nothing else: the live tree has FIFTEEN
-- roots, so ฝ่าย รพ. ร่วมผลิต, อาจารย์, เจ้าหน้าที่คณะแพทย์ and any ฝ่าย a
-- future committee invents all fall back to the brand green, and nobody can do
-- anything about it from the admin. Worse, the identity moves when the name
-- does — renaming "ฝ่ายวิชาการ" loses its blue silently.
--
-- So the colour becomes DATA. `color` is null by default, which means "derive
-- it from the name as before" — the existing ten keep their identity with no
-- backfill, and the fallback chain stays the honest default rather than
-- something 296 rows now have to carry explicitly.
--
-- WHY A FREE TEXT COLUMN AND NOT A PALETTE KEY. A key would have to be
-- validated against a list that lives in CSS, and CSS is exactly where this
-- repo's silent failures come from (a `--dept-nosuchthing` paints nothing and
-- looks like a design choice). A CSS colour string is self-contained: the
-- browser either renders it or ignores it, and the admin picks from swatches
-- so the free-text path is only reachable deliberately. The CHECK below keeps
-- it to a hex literal, so nothing can smuggle a `url(...)` or a CSS expression
-- into a style attribute on the public page.
--
-- THREE PATHS, not one — the column is useless on any of them alone:
--   1. team_nodes.color                — where an admin's choice is stored
--   2. get_public_team_chart           — BOTH branches. The live branch and the
--                                        published-snapshot branch are separate
--                                        selects, and the current year reads the
--                                        SNAPSHOT once it has been published, so
--                                        publishing would otherwise silently
--                                        revert every colour on the public page.
--   3. publish_team_term               — carries it into the snapshot
--
-- The archive column is added FIRST and published SECOND, in that order, so a
-- publish that runs between the two statements inserts null rather than 42703.

alter table public.team_nodes
  add column if not exists color text;

alter table public.team_archive_nodes
  add column if not exists color text;

-- `#rgb`, `#rrggbb`, `#rrggbbaa` and nothing else. This value is interpolated
-- into a `style="--org-tint: …"` on an anonymous public page; a hex literal
-- cannot carry a function call, a semicolon, or a quote.
alter table public.team_nodes
  drop constraint if exists team_nodes_color_is_hex;
alter table public.team_nodes
  add constraint team_nodes_color_is_hex
  check (color is null or color ~ '^#[0-9A-Fa-f]{3}([0-9A-Fa-f]{3}([0-9A-Fa-f]{2})?)?$');

-- ---------------------------------------------------------------------------
-- get_public_team_chart — rebuilt from the LIVE body (pg_get_functiondef),
-- not from 0104. Since 0104 it grew a third branch: a PUBLISHED year is read
-- from the snapshot even when it is the CURRENT year. Rebuilding from the old
-- migration would have deleted that branch and quietly un-published every term.
-- The ONLY change below is `'color', …` in each of the two node projections.
-- ---------------------------------------------------------------------------
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
                 'is_board', n.is_board, 'color', n.color)
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
      select n.id, n.parent_id, n.name, n.kind, n.position, n.is_board, n.color
        from public.team_nodes n
       where n.parent_id is null and n.is_public
      union all
      select c.id, c.parent_id, c.name, c.kind, c.position, c.is_board, c.color
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
                 'is_board', v.is_board, 'color', v.color)
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

-- ---------------------------------------------------------------------------
-- publish_team_term — also rebuilt from the LIVE body. The only change is that
-- `color` rides along in the recursive CTE and the insert.
-- ---------------------------------------------------------------------------
create or replace function public.publish_team_term(p_year integer)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_nodes   integer;
  v_members integer;
  v_kept    integer;
begin
  -- coalesce(..., false) is load-bearing. current_user_role() is NULL for a
  -- caller with no public.users row, and `null = any(...)` is NULL, so a bare
  -- `if not (...)` would evaluate `not null` = null, skip the raise, and run the
  -- privileged body. mistakes.md: "null in (...) makes a raise-on-unauthorized
  -- guard fail OPEN".
  if not coalesce(
       public.current_user_role() = any (array['vp_admin', 'dev'])
       or public.current_user_has_permission('team_edit'), false) then
    raise exception 'publish_team_term: not authorized';
  end if;

  if p_year is null or p_year < 2500 or p_year > 2700 then
    raise exception 'publish_team_term: bad year %', p_year;
  end if;

  insert into public.team_terms (year) values (p_year)
    on conflict (year) do nothing;

  -- Stash the photos this year's archive already holds, keyed by the live member
  -- they came from. A temp table (not a CTE) because the delete below has to
  -- happen in between. ON COMMIT DROP so a re-run in the same session is clean.
  create temp table if not exists _pub_photos (
    src_member_id uuid primary key, photo_url text, photo_focus text
  ) on commit drop;
  delete from _pub_photos;
  insert into _pub_photos (src_member_id, photo_url, photo_focus)
  select distinct on (am.src_member_id) am.src_member_id, am.photo_url, am.photo_focus
    from public.team_archive_members am
   where am.year = p_year
     and am.src_member_id is not null
     and am.photo_url is not null
   order by am.src_member_id, am.id;

  -- Cascades to team_archive_members via node_id.
  delete from public.team_archive_nodes where year = p_year;

  -- `as materialized` is required, not stylistic: `mapped` is referenced twice
  -- and contains gen_random_uuid(). Inlined, each reference would generate a
  -- DIFFERENT uuid and every parent_id lookup would come back null, silently
  -- flattening the tree.
  with recursive live as (
    select n.id, n.parent_id, n.name, n.kind, n.position, n.is_board, n.color
      from public.team_nodes n
     where n.parent_id is null and n.is_public
    union all
    select c.id, c.parent_id, c.name, c.kind, c.position, c.is_board, c.color
      from public.team_nodes c
      join live l on c.parent_id = l.id
     where c.is_public
  ),
  mapped as materialized (
    select l.*, gen_random_uuid() as new_id from live l
  )
  insert into public.team_archive_nodes
        (id, year, src_id, parent_id, name, kind, position, is_board, color)
  select m.new_id, p_year, m.id,
         (select p.new_id from mapped p where p.id = m.parent_id),
         m.name, m.kind, m.position, m.is_board, m.color
    from mapped m;
  get diagnostics v_nodes = ROW_COUNT;

  -- Only members whose ตำแหน่ง made it into the archive, i.e. the public
  -- subtree. A member under a non-public node is not published live and must
  -- not become published by being archived.
  --
  -- Photo precedence: the live tree wins when it has one; otherwise fall back to
  -- whatever this year's archive already had for that same person.
  insert into public.team_archive_members
        (year, node_id, src_member_id, full_name, nickname, photo_url, photo_focus, position)
  select p_year, an.id, m.id, m.full_name, m.nickname,
         coalesce(m.photo_url,   p.photo_url),
         coalesce(m.photo_focus, p.photo_focus),
         m.position
    from public.team_members m
    join public.team_archive_nodes an on an.year = p_year and an.src_id = m.node_id
    left join _pub_photos p on p.src_member_id = m.id;
  get diagnostics v_members = ROW_COUNT;

  select count(*) into v_kept
    from public.team_archive_members am
    join _pub_photos p on p.src_member_id = am.src_member_id
    join public.team_members m on m.id = am.src_member_id
   where am.year = p_year and m.photo_url is null;

  update public.team_terms
     set published_at = now(), updated_at = now()
   where year = p_year;

  return jsonb_build_object('year', p_year, 'nodes', v_nodes,
                            'members', v_members, 'photos_kept', v_kept);
end;
$$;
