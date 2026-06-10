-- ============================================================
-- 0051 — Let the professor (sa_prof) comment on หนังสือโครงการ
--
-- Comments live in project_documents.timeline (a jsonb column patched via
-- the app's appendDocTimeline). The professor is NOT a project actor, so the
-- 0005 project_documents UPDATE policy (current_user_is_project_actor())
-- blocks him — his comment PATCH fails RLS. This migration lets him UPDATE a
-- document that was sent to him, but a BEFORE-UPDATE column guard restricts
-- a sa_prof caller to changing ONLY `timeline` (so he can add/edit/delete his
-- own comments) — he can't flip status / title / etc. via a crafted PATCH.
--
-- Same pattern as the users_self_update_guard (0028/0041) and the
-- sign_requests_prof_guard (0050): RLS is row-level, the trigger gives the
-- per-column control.
--
-- Apply AFTER 0050. Re-runnable.
-- ============================================================

-- UPDATE policy: actors as before, plus the prof on a doc sent to him.
drop policy if exists "project_documents_update" on public.project_documents;
create policy "project_documents_update" on public.project_documents
  for update using (
    public.current_user_is_project_actor()
    or (public.current_user_is_prof() and public.prof_can_see_document(id))
  );

-- Column guard: a sa_prof caller may change ONLY `timeline` (+ the
-- server-managed updated_at). Everything else is immutable to him.
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
       or new.created_by    is distinct from old.created_by
       or new.created_at    is distinct from old.created_at then
      raise exception 'project_documents_prof_guard: professor may only add comments';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists project_documents_prof_guard on public.project_documents;
create trigger project_documents_prof_guard
  before update on public.project_documents
  for each row execute function public.project_documents_prof_guard();
