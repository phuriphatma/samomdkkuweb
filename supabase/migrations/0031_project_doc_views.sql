-- ============================================================
-- 0031 — Per-user "I've seen this หนังสือ" marker, server-side
--
-- Until now, the projects inbox tracked the per-doc seenAt in
-- localStorage (`projects.commentsSeenAt`). Two problems with that:
--
--   1. Per device, not per user. Account A acks something on iPad
--      → Account B on the same iPad still sees the stale "อัปเดต"
--      flag because they share the same localStorage entry.
--   2. Per device, not synced. Account A acks on macOS → Account A
--      on iPad still sees the flag. Worse, opening the app on a
--      brand new device floods the user with "many notifications"
--      because the empty localStorage makes every prior event
--      look unseen.
--
-- Fix: a tiny per-(user, document) table with the canonical seenAt.
-- RLS lets each user read + upsert ONLY their own rows. The JS
-- layer still keeps localStorage as a write-through cache so the
-- inbox renders without a round-trip; the server value is the
-- source of truth on load.
-- ============================================================

create table if not exists public.project_doc_views (
  user_id     uuid        not null
              references public.users(id) on delete cascade,
  document_id text        not null
              references public.project_documents(id) on delete cascade,
  seen_at     timestamptz not null default now(),
  primary key (user_id, document_id)
);

comment on table public.project_doc_views is
  'Per-user "I have acknowledged this หนังสือ up to seen_at" marker. '
  'Powers the seenAt-based highlight clearing in src/js/projects/inbox.js. '
  'One row per (user, document). Upserted from the client every time '
  'markDocSeen() fires (expand, status change, file op, comment, etc.).';

create index if not exists project_doc_views_user_idx
  on public.project_doc_views (user_id, seen_at desc);

alter table public.project_doc_views enable row level security;

-- DROP-then-CREATE keeps the migration idempotent. Postgres has no
-- `create or replace policy`; without these drops, a partial-then-
-- replay run fails with "policy ... already exists" (42710) and the
-- whole script aborts before the grants below.
drop policy if exists "project_doc_views_select_own" on public.project_doc_views;
create policy "project_doc_views_select_own"
  on public.project_doc_views for select
  using (user_id = auth.uid());

drop policy if exists "project_doc_views_insert_own" on public.project_doc_views;
create policy "project_doc_views_insert_own"
  on public.project_doc_views for insert
  with check (user_id = auth.uid());

drop policy if exists "project_doc_views_update_own" on public.project_doc_views;
create policy "project_doc_views_update_own"
  on public.project_doc_views for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "project_doc_views_delete_own" on public.project_doc_views;
create policy "project_doc_views_delete_own"
  on public.project_doc_views for delete
  using (user_id = auth.uid());

grant select, insert, update, delete on public.project_doc_views to authenticated;
