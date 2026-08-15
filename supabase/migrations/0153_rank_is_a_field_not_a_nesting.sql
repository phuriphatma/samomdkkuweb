-- 0153 — a ตำแหน่ง's RANK becomes a field, so the tree can go back to meaning
-- containment.
--
-- REQUESTED: "Currently ฝ่าย IT has Role หัวหน้าฝ่าย IT, Role สมาชิกฝ่าย IT
-- inside หัวหน้าฝ่าย IT, and role เลขานุการฝ่าย IT. I want in the main web to
-- show หัวหน้าฝ่าย IT and เลขานุการฝ่าย IT at the same level then next level be
-- สมาชิกฝ่าย IT **without having to put Role สมาชิกฝ่าย IT inside
-- หัวหน้าฝ่าย IT**."
--
-- THE TREE WAS DOING TWO JOBS. `parent_id` expressed CONTAINMENT (who is in
-- ฝ่าย IT) and RANK (who is drawn above whom) at the same time, and the only
-- way to say "สมาชิก sits a rank below หัวหน้า" was to make it a CHILD of
-- หัวหน้า. That is false about containment — สมาชิกฝ่าย IT belong to ฝ่าย IT,
-- not to a person — and it made the admin's cheapest edit (add a seat to a
-- ฝ่าย) into its most expensive one (long-press-drag onto one exact row).
--
-- So: the tree keeps CONTAINMENT, and `tier` carries RANK. Seats on the same
-- tier draw on one row; tier k+1 hangs off the FIRST seat of tier k, first
-- being `position` 0, which is the head — a fact the structure already carries,
-- so there is no list of Thai title prefixes here to rot.
--
-- `tier` is NULL by default and null means 1. Nothing needed backfilling: every
-- ฝ่าย that has never heard of tiers draws exactly as it did.
--
-- ── THE CONVERSION, and why it is safe to do here ──────────────────────────
--
-- Measured immediately before writing this: EIGHT ตำแหน่ง in the whole tree sit
-- under another ตำแหน่ง. Five at depth 2, three at depth 3:
--
--   2  สมาชิกฝ่าย IT                    under หัวหน้าฝ่าย IT
--   2  สมาชิกฝ่าย Media management      under หัวหน้าฝ่าย Media management
--   2  หัวหน้าฝ่าย Art/Graphic          under หัวหน้าฝ่าย ComArt
--   2  หัวหน้าฝ่าย Content creator      under หัวหน้าฝ่าย PR
--   2  หัวหน้าฝ่าย production           under หัวหน้าฝ่าย ComArt
--   3  สมาชิกฝ่าย Art/Graphic           under หัวหน้าฝ่าย Art/Graphic
--   3  สมาชิกฝ่าย Creative              under หัวหน้าฝ่าย Content creator
--   3  สมาชิกฝ่าย On-screen influencers under หัวหน้าฝ่าย Content creator
--
-- Each moves to its nearest ฝ่าย ancestor and takes its old depth as its tier,
-- so the admin has nothing to do and ฝ่าย IT is already right when they open
-- it. **The drawing must not change**, and that is not assumed:
-- `tools/team0153-tier-parity.mjs` computes the display parentage from a
-- snapshot of the tree BEFORE this migration and from the live tree after, with
-- the same `chartParentage()` the page uses, and fails on any difference.
--
-- The one case where the tier model could have differed is ฝ่าย ComArt, which
-- has TWO tier-2 heads: the model hangs tier 3 off the FIRST of them, while the
-- nesting named one explicitly. They coincide here because Art/Graphic is
-- position 0 — verified, not assumed, by that same parity check.
--
-- POSITIONS are renumbered inside every ฝ่าย that received a moved seat.
-- Without it a moved seat keeps a `position` from its old parent and can tie
-- with a sibling, and the projection orders by `position, name` — so ordering
-- within a tier would be decided by alphabet rather than by the admin.
--
-- Nesting still works. This does not forbid a seat under a seat; it gives the
-- admin a way not to need one. `chartParentage` reads both.

alter table public.team_nodes
  add column if not exists tier smallint;

alter table public.team_archive_nodes
  add column if not exists tier smallint;

-- A ceiling, because `tier` drives a loop that hangs each rung off the one
-- above: nine rungs inside a single ฝ่าย is already past anything the org has
-- ever had, and a typo of 900 should be refused rather than drawn.
alter table public.team_nodes
  drop constraint if exists team_nodes_tier_range;
alter table public.team_nodes
  add constraint team_nodes_tier_range
  check (tier is null or (tier >= 1 and tier <= 9));

-- ── the conversion ─────────────────────────────────────────────────────────

create temp table _flatten on commit drop as
with recursive seats as (
  -- depth 1: a ตำแหน่ง whose parent IS a ฝ่าย. Already where it belongs.
  select c.id, 1::smallint as tier, c.parent_id as faai
    from public.team_nodes c
    join public.team_nodes p on p.id = c.parent_id
   where c.kind = 'role' and p.kind = 'division'
  union all
  -- deeper: a ตำแหน่ง under a ตำแหน่ง. Same ฝ่าย, one rung down.
  select c.id, (s.tier + 1)::smallint, s.faai
    from public.team_nodes c
    join seats s on c.parent_id = s.id
   where c.kind = 'role'
)
select id, tier, faai from seats where tier > 1;

update public.team_nodes n
   set tier = f.tier,
       parent_id = f.faai
  from _flatten f
 where n.id = f.id;

-- Renumber every ฝ่าย that just received one, so `position` orders by rung
-- first and then by whatever order the admin already had.
with affected as (select distinct faai from _flatten),
renum as (
  select n.id,
         (row_number() over (
            partition by n.parent_id
            order by coalesce(n.tier, 1), n.position, n.name
          ) - 1)::integer as pos
    from public.team_nodes n
    join affected a on a.faai = n.parent_id
)
update public.team_nodes n
   set position = r.pos
  from renum r
 where n.id = r.id and n.position is distinct from r.pos;

-- ── both read paths, and the publisher ─────────────────────────────────────
-- Rebuilt from the LIVE bodies (pg_get_functiondef), as 0152 was. The only
-- change is `tier` riding along. The published-snapshot branch matters as much
-- as the live one: the CURRENT year reads the snapshot once published, so a
-- publish would otherwise flatten every ฝ่าย's ranks back to one row.

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
                 'is_board', n.is_board, 'color', n.color, 'tier', n.tier)
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
      select n.id, n.parent_id, n.name, n.kind, n.position, n.is_board,
             n.color, n.tier
        from public.team_nodes n
       where n.parent_id is null and n.is_public
      union all
      select c.id, c.parent_id, c.name, c.kind, c.position, c.is_board,
             c.color, c.tier
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
                 'is_board', v.is_board, 'color', v.color, 'tier', v.tier)
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
  -- privileged body.
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

  delete from public.team_archive_nodes where year = p_year;

  -- `as materialized` is required, not stylistic: `mapped` is referenced twice
  -- and contains gen_random_uuid(). Inlined, each reference would generate a
  -- DIFFERENT uuid and every parent_id lookup would come back null, silently
  -- flattening the tree.
  with recursive live as (
    select n.id, n.parent_id, n.name, n.kind, n.position, n.is_board,
           n.color, n.tier
      from public.team_nodes n
     where n.parent_id is null and n.is_public
    union all
    select c.id, c.parent_id, c.name, c.kind, c.position, c.is_board,
           c.color, c.tier
      from public.team_nodes c
      join live l on c.parent_id = l.id
     where c.is_public
  ),
  mapped as materialized (
    select l.*, gen_random_uuid() as new_id from live l
  )
  insert into public.team_archive_nodes
        (id, year, src_id, parent_id, name, kind, position, is_board, color, tier)
  select m.new_id, p_year, m.id,
         (select p.new_id from mapped p where p.id = m.parent_id),
         m.name, m.kind, m.position, m.is_board, m.color, m.tier
    from mapped m;
  get diagnostics v_nodes = ROW_COUNT;

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
