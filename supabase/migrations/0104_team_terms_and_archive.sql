-- ============================================================
-- 0104 — ปีการศึกษา for ทีม SAMO: a frozen-but-editable archive, a board flag,
--        and a portrait focal point.
--
-- GOAL: the public ทีม SAMO page becomes a year-switchable board (คณะกรรมการ as
-- large portrait cards, full structure below), the way docchula presents its
-- คณะกรรมการสโมสรนิสิต.
--
-- ── WHY AN ARCHIVE AND NOT A `year` COLUMN ON THE LIVE TREE ──────────────────
-- team_nodes / team_members ARE the permission engine. They feed
-- managed_permissions (0081), managed_vs_depts (0082/0083), managed_project_seats
-- (0086/0092) and managed_passport_* (0087) through a statement-level recompute
-- trigger. Adding `term_year` to those tables means every resolver
-- (effective_team_*_for_email, node_effective_*, sync_my_team_permissions) has to
-- filter by year — and a 2565 row that still resolves is a live grant to someone
-- who left the org three years ago. That is precisely the class mistakes.md keeps
-- logging: "a new access channel must be threaded through EVERY gate the old
-- channel used". The blast radius is the whole authorization model.
--
-- So the live tree stays EXACTLY what it is: the current committee, no year
-- dimension, no resolver changes, no new way to grant anything. Past years live
-- in a separate pair of tables that:
--   * carry ONLY the columns the public projection already publishes
--     (name / nickname / photo / structure) — no kkumail, no student_id, no
--     permissions, no seats. An archived row cannot grant access because it has
--     no column that any resolver reads.
--   * are written by one RPC (publish_team_term) and are freely EDITABLE
--     afterwards, so a misspelled name or a missing photo in ปี 2567 can be
--     fixed without touching the live tree.
--
-- ── WHY A PROJECTION, STILL ─────────────────────────────────────────────────
-- The archive tables hold only public-safe columns, so a `using (true)` SELECT
-- policy would be harmless TODAY. It is still not added: the moment someone adds
-- a column to team_archive_members, that policy publishes it, and a permissive
-- `using (true)` can never be narrowed afterwards (policies are OR'd). Same rule
-- as 0086/0103 — get_public_team_chart() is the only publisher, its keys are an
-- explicit allow-list, and the archive tables keep NO public policy.
--
-- ── FUNCTION-REWRITE DISCIPLINE ─────────────────────────────────────────────
-- get_public_org_chart() was last defined in 0103 (verified against
-- pg_get_functiondef, not assumed from the first file that defined it — see
-- mistakes.md "Recreating a function from the migration that FIRST defined it").
-- Rather than copy its body a third time, it is redefined here as a one-line
-- delegate to get_public_team_chart(null), so there is exactly ONE body for the
-- live projection and the two can never drift.
-- ============================================================

-- ---------------------------------------------------------------------------
-- 1. New columns on the LIVE tree
-- ---------------------------------------------------------------------------

-- is_board — does this ตำแหน่ง belong in the big portrait grid at the top of the
-- public page? Explicit checkbox rather than a depth or name heuristic: the org
-- renames its ฝ่าย regularly and "depth <= 2" would silently start including
-- เลขานุการ the day someone reorganises a branch.
alter table public.team_nodes
  add column if not exists is_board boolean not null default false;

comment on column public.team_nodes.is_board is
  'Show this ตำแหน่ง in the คณะกรรมการ portrait grid on the public page. '
  'Published by get_public_team_chart(). Display-only — never read by any '
  'permission resolver.';

-- photo_focus — where the head is, for the 3:4 crop.
--
-- Portraits arrive as 3:2 landscape (the studio shoots them that way), so ~45%
-- of the frame is discarded to make a portrait card. 'center' is served as a
-- SERVER-SIDE crop by lh3 (`=w520-h694-c-rw`), which is half the bytes of
-- downloading the full frame and cropping in CSS. 'top'/'bottom' fall back to
-- the uncropped image + CSS object-position, because lh3 has no focal-point
-- option. Measured on a live Drive file: 520x694 cropped WebP = 37.6 KB vs
-- 77.6 KB for the 1040-wide source the CSS path needs.
--
-- CONSTRAINED TO AN ENUM ON PURPOSE: this value reaches a public page. A free
-- text column would end up interpolated into a style attribute; three fixed
-- tokens mapped to CSS in JS cannot inject anything.
alter table public.team_members
  add column if not exists photo_focus text;
alter table public.team_members
  drop constraint if exists team_members_photo_focus_chk;
alter table public.team_members
  add constraint team_members_photo_focus_chk
  check (photo_focus is null or photo_focus in ('top', 'center', 'bottom'));

comment on column public.team_members.photo_focus is
  'Crop anchor for the 3:4 portrait card: top | center | bottom (null = center). '
  'Enum, not free text — the value is published and would otherwise reach CSS.';

-- ---------------------------------------------------------------------------
-- 2. team_terms — the ปีการศึกษา registry
-- ---------------------------------------------------------------------------
create table if not exists public.team_terms (
  year         integer primary key,   -- พ.ศ. e.g. 2569
  label        text,                  -- optional display override
  -- Exactly one term is the LIVE one: the year the current tree represents.
  -- The public page renders that year from the live tree and every other year
  -- from the archive.
  is_current   boolean not null default false,
  published_at timestamptz,           -- set by publish_team_term()
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

alter table public.team_terms
  drop constraint if exists team_terms_year_range;
alter table public.team_terms
  add constraint team_terms_year_range check (year between 2500 and 2700);

alter table public.team_terms
  drop constraint if exists team_terms_label_len;
alter table public.team_terms
  add constraint team_terms_label_len
  check (label is null or char_length(label) <= 120);

-- At most one current term. A partial unique index is the only way to say this
-- declaratively; without it a second `is_current = true` row makes
-- get_public_team_chart(null) nondeterministic.
drop index if exists team_terms_one_current;
create unique index team_terms_one_current
  on public.team_terms ((is_current)) where is_current;

-- ---------------------------------------------------------------------------
-- 3. The archive — a frozen copy of the PUBLIC projection, one per year
-- ---------------------------------------------------------------------------
-- Mirrors the projection's shape (nodes + members) rather than the live tables'
-- shape, so get_public_team_chart() returns byte-identical jsonb whether it read
-- the live tree or an archive, and org-chart.js needs no branch.

create table if not exists public.team_archive_nodes (
  id        uuid primary key default gen_random_uuid(),
  year      integer not null references public.team_terms(year) on delete cascade,
  -- The live team_nodes.id this was copied from. Audit breadcrumb only — NO
  -- foreign key, because the whole point is to survive the live node's deletion.
  src_id    uuid,
  parent_id uuid references public.team_archive_nodes(id) on delete cascade,
  name      text not null,
  kind      text not null default 'role',
  position  integer not null default 0,
  is_board  boolean not null default false
);
create index if not exists team_archive_nodes_year_idx on public.team_archive_nodes(year);
create index if not exists team_archive_nodes_parent_idx on public.team_archive_nodes(parent_id);
create index if not exists team_archive_nodes_src_idx on public.team_archive_nodes(year, src_id);

create table if not exists public.team_archive_members (
  id          uuid primary key default gen_random_uuid(),
  year        integer not null references public.team_terms(year) on delete cascade,
  -- CASCADE, not SET NULL: node_id is NOT NULL, and `not null` + `on delete set
  -- null` is a latent contradiction that blocks the parent delete at runtime
  -- (mistakes.md). A member cannot exist without its ตำแหน่ง.
  node_id     uuid not null references public.team_archive_nodes(id) on delete cascade,
  full_name   text not null,
  nickname    text,
  photo_url   text,
  photo_focus text,
  position    integer not null default 0
);
create index if not exists team_archive_members_year_idx on public.team_archive_members(year);
create index if not exists team_archive_members_node_idx on public.team_archive_members(node_id);

alter table public.team_archive_members
  drop constraint if exists team_archive_members_photo_url_len;
alter table public.team_archive_members
  add constraint team_archive_members_photo_url_len
  check (photo_url is null or char_length(photo_url) <= 500);

alter table public.team_archive_members
  drop constraint if exists team_archive_members_photo_focus_chk;
alter table public.team_archive_members
  add constraint team_archive_members_photo_focus_chk
  check (photo_focus is null or photo_focus in ('top', 'center', 'bottom'));

comment on table public.team_archive_members is
  'Frozen-but-editable snapshot of a past ปีการศึกษา. Holds ONLY the columns '
  'get_public_team_chart() publishes — no kkumail / student_id / permissions / '
  'seats — so an archived row can never grant access. Never add a column here '
  'without deciding whether the projection should name it.';

-- ---------------------------------------------------------------------------
-- 4. RLS — same gate as the live team tables (0089)
-- ---------------------------------------------------------------------------
alter table public.team_terms           enable row level security;
alter table public.team_archive_nodes   enable row level security;
alter table public.team_archive_members enable row level security;

-- One predicate, three tables. Repeated inline rather than wrapped in a helper
-- because a helper here would be a fourth place to keep in step with 0089.
drop policy if exists "team_terms_all_manage" on public.team_terms;
create policy "team_terms_all_manage" on public.team_terms
  for all to authenticated
  using (
    public.current_user_role() = any (array['vp_admin', 'dev'])
    or public.current_user_has_permission('team')
  )
  with check (
    public.current_user_role() = any (array['vp_admin', 'dev'])
    or public.current_user_has_permission('team')
  );

drop policy if exists "team_archive_nodes_all_manage" on public.team_archive_nodes;
create policy "team_archive_nodes_all_manage" on public.team_archive_nodes
  for all to authenticated
  using (
    public.current_user_role() = any (array['vp_admin', 'dev'])
    or public.current_user_has_permission('team')
  )
  with check (
    public.current_user_role() = any (array['vp_admin', 'dev'])
    or public.current_user_has_permission('team')
  );

drop policy if exists "team_archive_members_all_manage" on public.team_archive_members;
create policy "team_archive_members_all_manage" on public.team_archive_members
  for all to authenticated
  using (
    public.current_user_role() = any (array['vp_admin', 'dev'])
    or public.current_user_has_permission('team')
  )
  with check (
    public.current_user_role() = any (array['vp_admin', 'dev'])
    or public.current_user_has_permission('team')
  );

-- No anon policy on any of the three. The public page reads the projection.

-- ---------------------------------------------------------------------------
-- 5. get_public_team_chart(year) — THE publisher
-- ---------------------------------------------------------------------------
-- null / the current term  -> the live tree (is_public subtree only)
-- any other year           -> that year's archive
--
-- Both branches build the object key by key. A column added to team_members or
-- team_archive_members is NOT published until it is named here — the entire
-- reason this is a hand-built jsonb and not `returns setof <table>` (which is
-- how vs_tickets.tags silently reached anon in 0079).
create or replace function public.get_public_team_chart(p_year integer default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_current integer;
  v_year    integer;
  v_result  jsonb;
begin
  select t.year into v_current from public.team_terms t where t.is_current limit 1;
  v_year := coalesce(p_year, v_current);

  -- LIVE branch. Also the fallback when no term row exists at all, so the page
  -- keeps working exactly as it did before this migration.
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

  -- ARCHIVE branch. Unpublished years return an empty chart rather than an
  -- error: the year picker only offers published years, so reaching this with a
  -- bad p_year means a hand-crafted request, and an empty result is the right
  -- answer for "that year was never published".
  select jsonb_build_object(
    'year', v_year,
    'is_current', false,
    'nodes', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', n.id, 'parent_id', n.parent_id,
               'name', n.name, 'kind', n.kind, 'position', n.position,
               'is_board', n.is_board)
             order by n.position, n.name)
        from public.team_archive_nodes n
        join public.team_terms t on t.year = n.year and t.published_at is not null
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
        join public.team_terms t on t.year = m.year and t.published_at is not null
       where m.year = v_year), '[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$$;

revoke all on function public.get_public_team_chart(integer) from public;
grant execute on function public.get_public_team_chart(integer) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. get_public_team_years() — what the year picker offers
-- ---------------------------------------------------------------------------
create or replace function public.get_public_team_years()
returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'year', y.year, 'label', y.label, 'is_current', y.is_current)
         order by y.year), '[]'::jsonb)
    from public.team_terms y
   where y.is_current or y.published_at is not null;
$$;

revoke all on function public.get_public_team_years() from public;
grant execute on function public.get_public_team_years() to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 7. get_public_org_chart() — now a delegate, so there is one live body
-- ---------------------------------------------------------------------------
-- Kept because it is the deployed bundle's entry point; a browser holding the
-- pre-0104 JS keeps working through the whole rollout.
create or replace function public.get_public_org_chart()
returns jsonb
language sql stable security definer set search_path = public as $$
  select public.get_public_team_chart(null)
$$;

revoke all on function public.get_public_org_chart() from public;
grant execute on function public.get_public_org_chart() to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 8. publish_team_term(year) — freeze the live tree into the archive
-- ---------------------------------------------------------------------------
-- Re-runnable: republishing a year replaces it wholesale. That is deliberate —
-- "publish" means "this year now looks like the live tree", and a merge would
-- leave rows behind for people who were removed.
create or replace function public.publish_team_term(p_year integer)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_nodes   integer;
  v_members integer;
begin
  -- coalesce(..., false) is load-bearing. current_user_role() is NULL for a
  -- caller with no public.users row, and `null = any(...)` is NULL, so a bare
  -- `if not (...)` would evaluate `not null` = null, skip the raise, and run the
  -- privileged body. mistakes.md: "null in (...) makes a raise-on-unauthorized
  -- guard fail OPEN".
  if not coalesce(
       public.current_user_role() = any (array['vp_admin', 'dev'])
       or public.current_user_has_permission('team'), false) then
    raise exception 'publish_team_term: not authorized';
  end if;

  if p_year is null or p_year < 2500 or p_year > 2700 then
    raise exception 'publish_team_term: bad year %', p_year;
  end if;

  insert into public.team_terms (year) values (p_year)
    on conflict (year) do nothing;

  -- Cascades to team_archive_members via node_id.
  delete from public.team_archive_nodes where year = p_year;

  -- `as materialized` is required, not stylistic: `mapped` is referenced twice
  -- and contains gen_random_uuid(). Inlined, each reference would generate a
  -- DIFFERENT uuid and every parent_id lookup would come back null, silently
  -- flattening the tree.
  with recursive live as (
    select n.id, n.parent_id, n.name, n.kind, n.position, n.is_board
      from public.team_nodes n
     where n.parent_id is null and n.is_public
    union all
    select c.id, c.parent_id, c.name, c.kind, c.position, c.is_board
      from public.team_nodes c
      join live l on c.parent_id = l.id
     where c.is_public
  ),
  mapped as materialized (
    select l.*, gen_random_uuid() as new_id from live l
  )
  insert into public.team_archive_nodes
        (id, year, src_id, parent_id, name, kind, position, is_board)
  select m.new_id, p_year, m.id,
         (select p.new_id from mapped p where p.id = m.parent_id),
         m.name, m.kind, m.position, m.is_board
    from mapped m;
  get diagnostics v_nodes = ROW_COUNT;

  -- Only members whose ตำแหน่ง made it into the archive, i.e. the public
  -- subtree. A member under a non-public node is not published live and must
  -- not become published by being archived.
  insert into public.team_archive_members
        (year, node_id, full_name, nickname, photo_url, photo_focus, position)
  select p_year, an.id, m.full_name, m.nickname, m.photo_url, m.photo_focus, m.position
    from public.team_members m
    join public.team_archive_nodes an on an.year = p_year and an.src_id = m.node_id;
  get diagnostics v_members = ROW_COUNT;

  update public.team_terms
     set published_at = now(), updated_at = now()
   where year = p_year;

  return jsonb_build_object('year', p_year, 'nodes', v_nodes, 'members', v_members);
end;
$$;

-- Functions are granted EXECUTE to PUBLIC by default — revoking from PUBLIC does
-- NOT remove an explicit anon grant, and this project's earlier resolvers were
-- found anon-callable for exactly this reason (0101). Revoke both by name.
revoke all on function public.publish_team_term(integer) from public;
revoke all on function public.publish_team_term(integer) from anon;
grant execute on function public.publish_team_term(integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 9. Seed — the current term, and the board flags
-- ---------------------------------------------------------------------------
-- 2569 is the term the live tree currently represents. Guarded so a re-apply
-- never steals `is_current` from a year the admin has since moved on to.
insert into public.team_terms (year, is_current)
select 2569, true
 where not exists (select 1 from public.team_terms where is_current);

-- Seed the คณะกรรมการ grid from the structure that is actually there:
-- สำนักนายกฯ › นายกฯ, and every child of สำนักนายกฯ › อุปนายกฯ (the 10 อุปนายกฝ่าย).
-- One-shot: skipped entirely once any node has been flagged, so an admin's later
-- curation is never overwritten by a re-apply.
update public.team_nodes n
   set is_board = true
 where not exists (select 1 from public.team_nodes where is_board)
   and n.is_public
   and (
     n.name = 'นายกฯ'
     or exists (
       select 1 from public.team_nodes p
        where p.id = n.parent_id and p.name = 'อุปนายกฯ'
     )
   );
