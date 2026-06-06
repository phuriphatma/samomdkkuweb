-- 0046_team_management.sql
-- SAMO Team management: an org tree (divisions → departments → roles → subroles,
-- arbitrary depth) plus the people attached to each role node.
--
-- Access model: read + write for vp_admin and dev ONLY (the feature is the VP
-- org directory). RLS USING/WITH CHECK fail CLOSED on a null role — a caller
-- with no public.users row evaluates `null = any(...)` → null → not granted.
-- (See .claude/rules/mistakes.md "null in (...)" — that fail-open trap only
-- bites `raise`-guarded DEFINER functions; ordinary RLS policies only grant on
-- an explicit TRUE, so null denies. We keep all team logic in RLS, no DEFINER
-- RPCs, so there is nothing to fail open here.)
--
-- Reorder / move are plain PATCHes (parent_id + position) through these
-- policies; the frontend prevents moving a node into its own subtree.

-- ---------------------------------------------------------------------------
-- team_nodes — the role tree
-- ---------------------------------------------------------------------------
create table if not exists public.team_nodes (
  id                  uuid primary key default gen_random_uuid(),
  parent_id           uuid references public.team_nodes(id) on delete cascade,
  name                text not null,
  -- 'division' | 'department' | 'role' — advisory only (drives the UI icon);
  -- the tree itself is defined purely by parent_id, so depth is unlimited.
  kind                text not null default 'role',
  position            integer not null default 0,         -- order among siblings
  permissions         text[] not null default '{}',       -- app permission keys on this node
  inherit_permissions boolean not null default true,      -- also inherit parent's perms
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index if not exists team_nodes_parent_idx on public.team_nodes(parent_id);

-- ---------------------------------------------------------------------------
-- team_members — people attached to a node
-- ---------------------------------------------------------------------------
create table if not exists public.team_members (
  id          uuid primary key default gen_random_uuid(),
  node_id     uuid not null references public.team_nodes(id) on delete cascade,
  position    integer not null default 0,                 -- order within the node
  kkumail     text,
  prefix      text,                                       -- นาย / นางสาว / นาง
  full_name   text not null,
  nickname    text,
  student_id  text,
  year        text,
  major       text,                                       -- สาขา (MD / RT / MDI)
  confirmed   boolean not null default false,             -- ยืนยันตำแหน่ง
  -- Optional link to a real login account. Most members are NOT app users, so
  -- this stays null; on delete of the user we just null it (member row stays).
  user_id     uuid references public.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists team_members_node_idx on public.team_members(node_id);

-- ---------------------------------------------------------------------------
-- updated_at triggers (reuse public.touch_updated_at from 0001)
-- ---------------------------------------------------------------------------
drop trigger if exists touch_team_nodes_updated_at on public.team_nodes;
create trigger touch_team_nodes_updated_at
  before update on public.team_nodes
  for each row execute function public.touch_updated_at();

drop trigger if exists touch_team_members_updated_at on public.team_members;
create trigger touch_team_members_updated_at
  before update on public.team_members
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- RLS — vp_admin + dev only, for every operation
-- ---------------------------------------------------------------------------
alter table public.team_nodes   enable row level security;
alter table public.team_members enable row level security;

drop policy if exists "team_nodes_all_vp_dev" on public.team_nodes;
create policy "team_nodes_all_vp_dev" on public.team_nodes
  for all
  using      (public.current_user_role() = any (array['vp_admin','dev']))
  with check (public.current_user_role() = any (array['vp_admin','dev']));

drop policy if exists "team_members_all_vp_dev" on public.team_members;
create policy "team_members_all_vp_dev" on public.team_members
  for all
  using      (public.current_user_role() = any (array['vp_admin','dev']))
  with check (public.current_user_role() = any (array['vp_admin','dev']));
