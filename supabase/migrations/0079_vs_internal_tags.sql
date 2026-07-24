-- 0079_vs_internal_tags.sql
-- =====================================================================
-- VS internal, PER-DEPARTMENT triage tags.
--
-- Distinct from vs_categories (0072): categories are the ONE shared, public
-- taxonomy that drives the public board + confidentiality. Tags are the
-- opposite axis — INTERNAL-only, staff-facing, and OWNED BY A DEPARTMENT so
-- each dept can classify its own workload however it likes (different depts
-- categorize differently; SE triage != อุปนายกวิชาการ triage). They never
-- appear on the public board and are never returned by the public/guest RPCs.
--
-- Model:
--   * vs_tags        — the per-dept vocabulary (dept + label + colour).
--   * vs_tickets.tags text[] — the tag ids applied to a ticket. LOOSE (no FK),
--     same choice as vs_tickets.category (0072): retiring a tag must not break
--     a ticket; the UI just stops offering it. A ticket can carry tags from
--     more than one dept across its lifecycle (SE triages, then transfers to a
--     VP) — each dept's editor only touches its OWN tags, so cross-dept tags
--     are preserved untouched.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) vs_tags — per-department internal tag vocabulary
-- ---------------------------------------------------------------------
create table if not exists public.vs_tags (
  id          text primary key,
  dept        text not null,              -- owning dept (a target_dept value: 'SE', 'อุปนายก…', 'นายกสโม')
  label       text not null check (char_length(label) between 1 and 40),
  color       text not null default 'slate' check (char_length(color) <= 20),
  sort_order  integer not null default 100,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists vs_tags_dept_active_idx
  on public.vs_tags (dept, is_active, sort_order);

drop trigger if exists touch_vs_tags_updated_at on public.vs_tags;
create trigger touch_vs_tags_updated_at
  before update on public.vs_tags
  for each row execute function public.touch_updated_at();

alter table public.vs_tags enable row level security;

-- Read: any staff may READ every dept's tags. A ticket surfaces cross-dept
-- (SE tags on a ticket now owned by a VP), and SE's all-depts board needs the
-- full vocabulary to render chips. Tags are non-sensitive label strings, so a
-- staff-wide read is fine. current_user_is_staff() includes vp_admin (0005).
drop policy if exists vs_tags_read_staff on public.vs_tags;
create policy vs_tags_read_staff on public.vs_tags
  for select to authenticated
  using (public.current_user_is_staff());

-- Write (manage the vocabulary): a department manages its OWN tags only.
-- Super users (vs_staff / dev / perm 'vs') manage any dept's tags (they run
-- the cross-dept triage board and can seed a dept's list). A vp_admin may
-- write only rows whose dept is THEIR dept.
drop policy if exists vs_tags_write_scoped on public.vs_tags;
create policy vs_tags_write_scoped on public.vs_tags
  for all to authenticated
  using (
    public.current_user_role() in ('vs_staff', 'dev')
    or public.current_user_has_permission('vs')
    or (public.current_user_role() = 'vp_admin' and dept = public.current_user_dept())
  )
  with check (
    public.current_user_role() in ('vs_staff', 'dev')
    or public.current_user_has_permission('vs')
    or (public.current_user_role() = 'vp_admin' and dept = public.current_user_dept())
  );

comment on table public.vs_tags is
  'Internal, per-department VS triage tags (0079). NEVER public — not returned by any public/guest board RPC. Owned by dept; vp_admin manages only their own dept, vs_staff/dev/perm(vs) manage any.';

-- ---------------------------------------------------------------------
-- 2) vs_tickets.tags — applied tag ids (loose, no FK; cf. category 0072)
-- ---------------------------------------------------------------------
alter table public.vs_tickets
  add column if not exists tags text[] not null default '{}';

comment on column public.vs_tickets.tags is
  'Internal per-dept tag ids applied to this ticket (0079). Loose refs to vs_tags.id; staff-only, never published. Written via the same staff UPDATE path as category.';

-- GIN index so a future server-side "tickets with tag X" filter is cheap
-- (today the staff board filters client-side over the already-loaded cache).
create index if not exists vs_tickets_tags_idx
  on public.vs_tickets using gin (tags);
