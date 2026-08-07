-- ============================================================
-- 0114 — หนังสือโครงการ: per-โครงการ / per-หนังสือ public visibility
--
-- Asked for: "admin can mark what หนังสือ, what โครงการ will be shown and
-- not shown in the public main web."
--
-- Until now the customer mirror at /projects-view was all-or-nothing:
-- 0032 opened `projects` / `project_documents` / `project_files` to anon
-- with `using (true)`. This adds one boolean per row and makes the PUBLIC
-- policies read it. The staff policies (projects_read,
-- project_documents_read, project_files_read) are untouched, and because
-- permissive policies are OR'd, every actor — vp_admin, uni_staff, the
-- `vpa`/`staff` seats, and the prof on his own documents — keeps seeing
-- everything regardless of the flag.
--
-- DEFAULT = true (opt-out), decided with the user: every existing row is
-- public today, so a default of false would empty the public page on
-- deploy. Note this is the OPPOSITE of the safe default for a NEW public
-- projection — it is chosen here only because the projection already
-- exists and is already total.
--
-- CASCADE: hiding a โครงการ hides every หนังสือ and file under it, whatever
-- their own flag says. The flag on the หนังสือ is a further narrowing, never
-- a widening — so un-hiding a หนังสือ inside a hidden โครงการ does nothing
-- until the โครงการ itself is shown again.
--
-- WHO MAY FLIP IT: the sender side only — role vp_admin/dev or the `vpa`
-- seat (the same predicate that gates creating a project). uni_staff, the
-- `staff` seat and the professor can all UPDATE these rows for the
-- workflow (status, timeline, comments), and a row-level UPDATE policy
-- grants every column in the row — the recurring class-1 bug in
-- .claude/rules/mistakes.md. Two BEFORE UPDATE triggers give the column
-- the guard the policy cannot.
--
-- NOT changed, deliberately:
--   * public_stats() (0067) still counts hidden projects/documents in its
--     anon-visible totals. It exposes counts only, never a title, and the
--     workload really did happen.
--   * project_sign_requests has no public policy at all (0050) — nothing
--     to gate.
--   * project_doc_types / project_settings stay fully public: labels only.
--
-- Apply AFTER 0113. Re-runnable.
-- ============================================================

-- ------------------------------------------------------------
-- 1. The columns
-- ------------------------------------------------------------
alter table public.projects
  add column if not exists is_public boolean not null default true;

alter table public.project_documents
  add column if not exists is_public boolean not null default true;

comment on column public.projects.is_public is
  'Show this โครงการ on the public /projects-view mirror (0114). false hides '
  'the project AND every หนังสือ + file under it from anon/non-actor readers.';

comment on column public.project_documents.is_public is
  'Show this หนังสือ on the public /projects-view mirror (0114). Effective '
  'only while its parent project is also public — see project_doc_is_public().';

-- ------------------------------------------------------------
-- 2. Resolver helpers — SECURITY DEFINER so the policy does not
--    depend on the CALLER's ability to read the parent row (an RLS
--    inline subquery is evaluated under the caller's own policies —
--    docs/mistakes/authz-rls.md, first entry).
--
--    Both fail CLOSED on an id that does not resolve: coalesce(…, false),
--    not coalesce(…, true). An inner join to a missing project answers
--    "not public", which is the safe direction for a public projection.
-- ------------------------------------------------------------
create or replace function public.project_is_public(p_project_id text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(
    (select p.is_public from public.projects p where p.id = p_project_id),
    false)
$$;

create or replace function public.project_doc_is_public(p_document_id text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(
    (select d.is_public and p.is_public
       from public.project_documents d
       join public.projects p on p.id = d.project_id
      where d.id = p_document_id),
    false)
$$;

comment on function public.project_is_public(text) is
  'Is this โครงการ published to the public mirror? Fails closed on an '
  'unknown id (0114).';
comment on function public.project_doc_is_public(text) is
  'Is this หนังสือ published to the public mirror? Requires BOTH its own '
  'flag and its parent project''s. Fails closed on an unknown id (0114).';

revoke all on function public.project_is_public(text)     from public;
revoke all on function public.project_doc_is_public(text) from public;
grant execute on function public.project_is_public(text)     to anon, authenticated;
grant execute on function public.project_doc_is_public(text) to anon, authenticated;

-- ------------------------------------------------------------
-- 3. The public read policies now honour the flag
-- ------------------------------------------------------------
drop policy if exists "projects_read_public" on public.projects;
create policy "projects_read_public" on public.projects
  for select to anon, authenticated using (is_public);

drop policy if exists "project_documents_read_public" on public.project_documents;
create policy "project_documents_read_public" on public.project_documents
  for select to anon, authenticated
  using (is_public and public.project_is_public(project_id));

drop policy if exists "project_files_read_public" on public.project_files;
create policy "project_files_read_public" on public.project_files
  for select to anon, authenticated
  using (public.project_doc_is_public(document_id));

comment on policy "projects_read_public" on public.projects is
  'Anon/public mirror: published โครงการ only (0114). Actors read through '
  'projects_read, which is OR''d with this and ignores the flag.';
comment on policy "project_documents_read_public" on public.project_documents is
  'Anon/public mirror: published หนังสือ inside a published โครงการ (0114).';
comment on policy "project_files_read_public" on public.project_files is
  'Anon/public mirror: files of a published หนังสือ. A Drive view URL is a '
  'bearer link, so hiding the หนังสือ must also stop serving its URLs (0114).';

-- ------------------------------------------------------------
-- 4. Column guard — only the sender side may publish/unpublish
--
--    Mirrors the projects_insert / project_documents_insert predicate
--    exactly; named so there is ONE authority for "may publish", and the
--    four existing sender-only policies are republished below to call it
--    rather than restating the array (class 6: two spellings of one rule
--    drift).
-- ------------------------------------------------------------
create or replace function public.current_user_can_publish_project()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.current_user_role() = any (array['vp_admin', 'dev']), false)
      or coalesce('vpa' = any (public.current_user_project_seats()), false)
$$;

comment on function public.current_user_can_publish_project() is
  'The sender side of หนังสือโครงการ: role vp_admin/dev, or the ทีม SAMO `vpa` '
  'seat. Gates create/delete of a โครงการ or หนังสือ, and (0114) flipping '
  'is_public. uni_staff receive, they do not publish.';

revoke all on function public.current_user_can_publish_project() from public;
grant execute on function public.current_user_can_publish_project() to anon, authenticated;

-- Same predicate these four already carried, now stated once.
drop policy if exists "projects_insert" on public.projects;
create policy "projects_insert" on public.projects
  for insert with check (public.current_user_can_publish_project());

drop policy if exists "projects_delete" on public.projects;
create policy "projects_delete" on public.projects
  for delete using (public.current_user_can_publish_project());

drop policy if exists "project_documents_insert" on public.project_documents;
create policy "project_documents_insert" on public.project_documents
  for insert with check (public.current_user_can_publish_project());

drop policy if exists "project_documents_delete" on public.project_documents;
create policy "project_documents_delete" on public.project_documents
  for delete using (public.current_user_can_publish_project());

/** Shared BEFORE UPDATE guard for projects + project_documents: the
 *  is_public column may only be changed by the sender side. A server /
 *  migration context (no auth.uid()) is exempt so seeds and backfills
 *  still work — the same carve-out the other column guards use. */
create or replace function public.project_public_flag_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.is_public is distinct from old.is_public
     and auth.uid() is not null
     and not public.current_user_can_publish_project() then
    raise exception
      'project_public_flag_guard: only the sender side may show/hide this on the public site';
  end if;
  return new;
end;
$$;

drop trigger if exists projects_public_flag_guard on public.projects;
create trigger projects_public_flag_guard
  before update on public.projects
  for each row execute function public.project_public_flag_guard();

drop trigger if exists project_documents_public_flag_guard on public.project_documents;
create trigger project_documents_public_flag_guard
  before update on public.project_documents
  for each row execute function public.project_public_flag_guard();

-- The professor's own column guard enumerates every immutable column by
-- name, so a NEW column is writable by him until it is listed. Live body
-- verified identical to 0051's before this republish (the "recreating a
-- function from the migration that first defined it silently reverts
-- every later one" lesson) — the only change is `is_public`.
create or replace function public.project_documents_prof_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.current_user_is_prof() then
    if new.id            is distinct from old.id
       or new.project_id    is distinct from old.project_id
       or new.type_id       is distinct from old.type_id
       or new.title         is distinct from old.title
       or new.note          is distinct from old.note
       or new.sequence_no   is distinct from old.sequence_no
       or new.status        is distinct from old.status
       or new.return_reason is distinct from old.return_reason
       or new.sent_at       is distinct from old.sent_at
       or new.received_at   is distinct from old.received_at
       or new.completed_at  is distinct from old.completed_at
       or new.drive_folder  is distinct from old.drive_folder
       or new.is_public     is distinct from old.is_public
       or new.created_by    is distinct from old.created_by
       or new.created_at    is distinct from old.created_at then
      raise exception 'project_documents_prof_guard: professor may only add comments';
    end if;
  end if;
  return new;
end;
$$;
