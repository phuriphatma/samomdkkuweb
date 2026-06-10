-- ============================================================
-- 0050 — Professor (sa_prof) signing workflow for หนังสือโครงการ
--
-- Adds a THIRD seat to the project-document workflow: a professor
-- (`saprof`, role `sa_prof`) who signs documents. uni_staff (sastaff)
-- selects a SUBSET of a หนังสือ's files and sends them to the professor
-- as a "signing request" (project_sign_requests). The professor sees
-- ONLY documents sent to him (not the whole inbox), accepts (uploading
-- an e-signed / externally-signed file) or rejects (back to sastaff).
-- vp_admin/uni_staff/dev see every request as workflow progress.
--
-- Design notes:
--   * sa_prof is intentionally NOT a project actor — it must NOT see
--     all docs. `current_user_is_project_actor()` is left unchanged;
--     prof visibility is layered on via per-recipient SECURITY DEFINER
--     helpers (so the prof's RLS predicates don't silently depend on
--     another table's RLS — see mistakes.md "RLS inline subqueries").
--   * File visibility for the prof is FILE-LEVEL (only the files he was
--     asked to sign + his own signed uploads) so the private docx drafts
--     vp_admin/uni_staff exchanged stay invisible to him.
--
-- Apply AFTER 0049. Run via the Supabase SQL editor (or db push).
-- Re-runnable: every create policy is preceded by drop policy if exists,
-- and column/table adds use IF NOT EXISTS.
-- ============================================================


-- ============================================================
-- ROLE: admit 'sa_prof'
-- ============================================================

alter table public.users
  drop constraint if exists users_role_check;
alter table public.users
  add  constraint users_role_check
       check (role in ('user', 'pr_staff', 'vs_staff', 'shop_admin',
                       'vp_admin', 'uni_staff', 'sa_prof', 'dev'));

-- Narrow helper: is the caller the professor seat?
create or replace function public.current_user_is_prof()
returns boolean language sql stable security definer set search_path = public as $$
  select public.current_user_role() = 'sa_prof'
$$;


-- ============================================================
-- SIGN REQUESTS — a bundle of selected files from one หนังสือ,
-- addressed to the professor, with an accept/reject decision.
-- ============================================================

create table if not exists public.project_sign_requests (
  id              text primary key,                -- 'SGN-XXXXX'
  document_id     text not null references public.project_documents(id) on delete cascade,
  prof_id         uuid references public.users(id) on delete set null,  -- recipient
  status          text not null default 'pending'
                  check (status in ('pending', 'accepted', 'rejected')),
  note            text,                            -- sastaff → prof message
  reject_reason   text,                            -- set on reject
  file_ids        bigint[] not null default '{}',  -- source project_files ids to sign
  timeline        jsonb not null default '[]',     -- request-scoped events
  requested_by    uuid references public.users(id) on delete set null,
  requested_at    timestamptz not null default now(),
  decided_at      timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists project_sign_requests_document_idx on public.project_sign_requests (document_id);
create index if not exists project_sign_requests_prof_idx     on public.project_sign_requests (prof_id);
create index if not exists project_sign_requests_status_idx   on public.project_sign_requests (status);

drop trigger if exists touch_project_sign_requests_updated_at on public.project_sign_requests;
create trigger touch_project_sign_requests_updated_at
  before update on public.project_sign_requests
  for each row execute function public.touch_updated_at();


-- ============================================================
-- PROJECT FILES — tag the signed output. The professor's signed
-- file is a normal project_files row (so it appears in the doc's
-- file list) flagged with is_signed + the request it answers.
-- ============================================================

alter table public.project_files
  add column if not exists sign_request_id text references public.project_sign_requests(id) on delete set null,
  add column if not exists is_signed       boolean not null default false;


-- ============================================================
-- VISIBILITY HELPERS for the professor (SECURITY DEFINER so they
-- bypass the caller's RLS and can't be undermined by a tightened
-- policy on a referenced table).
-- ============================================================

-- The professor can see a PROJECT if any of its documents has a
-- sign request addressed to him.
create or replace function public.prof_can_see_project(p_project_id text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
      from public.project_sign_requests r
      join public.project_documents d on d.id = r.document_id
     where d.project_id = p_project_id
       and r.prof_id = auth.uid()
  )
$$;

-- The professor can see a DOCUMENT if it has a sign request to him.
create or replace function public.prof_can_see_document(p_doc_id text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.project_sign_requests r
     where r.document_id = p_doc_id and r.prof_id = auth.uid()
  )
$$;

-- The professor can see a FILE only if (a) it's one of the files he
-- was asked to sign, or (b) it's his own signed upload answering one
-- of his requests. This keeps the private vp/uni drafts hidden.
create or replace function public.prof_can_see_file(p_file_id bigint)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.project_sign_requests r
     where r.prof_id = auth.uid()
       and p_file_id = any(r.file_ids)
  ) or exists (
    select 1
      from public.project_files f
      join public.project_sign_requests r on r.id = f.sign_request_id
     where f.id = p_file_id and r.prof_id = auth.uid()
  )
$$;

grant execute on function public.current_user_is_prof()            to anon, authenticated;
grant execute on function public.prof_can_see_project(text)        to anon, authenticated;
grant execute on function public.prof_can_see_document(text)       to anon, authenticated;
grant execute on function public.prof_can_see_file(bigint)         to anon, authenticated;


-- ============================================================
-- RLS — extend existing project policies with a professor branch.
--
-- NOTE: migration 0032 added `*_read_public` policies (`using (true)` for
-- anon + authenticated) that power the public customer mirror — so
-- projects/documents/files are ALREADY world-readable and these prof SELECT
-- branches are DEFENSIVE only (policies are OR'd; the public one always
-- wins). The professor's "sees only docs sent to him" boundary is therefore
-- enforced at the UI/query layer (src/js/projects/index.js
-- scopeProjectsForRole + inbox.js loadFilesForDoc), keyed off the fact that
-- `project_sign_requests` has NO public policy — its RLS returns the prof
-- only his OWN requests. The genuinely load-bearing prof RLS here is the
-- project_files INSERT branch (signed uploads) — there is no public INSERT.
-- ============================================================

-- PROJECTS / DOCUMENTS / FILES — SELECT now also admits the prof.
drop policy if exists "projects_read" on public.projects;
create policy "projects_read" on public.projects
  for select using (
    public.current_user_is_project_actor()
    or public.prof_can_see_project(id)
  );

drop policy if exists "project_documents_read" on public.project_documents;
create policy "project_documents_read" on public.project_documents
  for select using (
    public.current_user_is_project_actor()
    or public.prof_can_see_document(id)
  );

drop policy if exists "project_files_read" on public.project_files;
create policy "project_files_read" on public.project_files
  for select using (
    public.current_user_is_project_actor()
    or public.prof_can_see_file(id)
  );

-- FILES INSERT — actors as before, plus the prof uploading a signed
-- file onto a document that was sent to him.
drop policy if exists "project_files_insert" on public.project_files;
create policy "project_files_insert" on public.project_files
  for insert with check (
    (
      public.current_user_is_project_actor()
      and exists (select 1 from public.project_documents d where d.id = document_id)
    )
    or (
      public.current_user_is_prof()
      and public.prof_can_see_document(document_id)
    )
  );

-- FILES DELETE — widen to include uni_staff (sastaff file-op parity:
-- sastaff can now add/replace/remove files like vp_admin).
drop policy if exists "project_files_delete" on public.project_files;
create policy "project_files_delete" on public.project_files
  for delete using (public.current_user_role() in ('vp_admin', 'uni_staff', 'dev'));

-- DOC TYPES / SETTINGS — let the prof READ so his inbox can render
-- type labels + the prof_label. Writes stay actor-only.
drop policy if exists "project_doc_types_read" on public.project_doc_types;
create policy "project_doc_types_read" on public.project_doc_types
  for select using (
    public.current_user_is_project_actor()
    or public.current_user_is_prof()
  );

drop policy if exists "project_settings_read" on public.project_settings;
create policy "project_settings_read" on public.project_settings
  for select using (
    public.current_user_is_project_actor()
    or public.current_user_is_prof()
  );

-- NOTIFICATIONS INSERT — broaden so the prof can write the actor's
-- bell row on accept/reject (and actors can write the prof's bell).
-- user_id still targets the recipient; SELECT remains own-row only.
drop policy if exists "project_notifications_insert" on public.project_notifications;
create policy "project_notifications_insert" on public.project_notifications
  for insert with check (
    public.current_user_is_project_actor()
    or public.current_user_is_prof()
  );


-- ============================================================
-- RLS — project_sign_requests
-- ============================================================

alter table public.project_sign_requests enable row level security;

-- Actors see every request (workflow oversight); the prof sees only
-- requests addressed to him.
drop policy if exists "project_sign_requests_read" on public.project_sign_requests;
create policy "project_sign_requests_read" on public.project_sign_requests
  for select using (
    public.current_user_is_project_actor()
    or prof_id = auth.uid()
  );

-- Only uni_staff/dev create a request (sastaff sends to the prof).
drop policy if exists "project_sign_requests_insert" on public.project_sign_requests;
create policy "project_sign_requests_insert" on public.project_sign_requests
  for insert with check (public.current_user_role() in ('uni_staff', 'dev'));

-- The prof updates his own request (accept/reject); uni_staff/dev can
-- update (e.g. cancel / resend). A column guard (below) limits what
-- the prof may change.
drop policy if exists "project_sign_requests_update" on public.project_sign_requests;
create policy "project_sign_requests_update" on public.project_sign_requests
  for update using (
    prof_id = auth.uid()
    or public.current_user_role() in ('uni_staff', 'dev')
  );

drop policy if exists "project_sign_requests_delete" on public.project_sign_requests;
create policy "project_sign_requests_delete" on public.project_sign_requests
  for delete using (public.current_user_role() in ('uni_staff', 'dev'));

-- Column guard: a sa_prof caller may only set the decision columns
-- (status / reject_reason / decided_at / timeline). Blocks rewriting
-- document_id / prof_id / file_ids / note / requested_by. Mirrors the
-- users_self_update_guard pattern (0028/0041). RLS is row-level only;
-- this gives per-column control.
create or replace function public.sign_requests_prof_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.current_user_is_prof() then
    if new.document_id  is distinct from old.document_id
       or new.prof_id   is distinct from old.prof_id
       or new.file_ids  is distinct from old.file_ids
       or new.note      is distinct from old.note
       or new.requested_by is distinct from old.requested_by then
      raise exception 'sign_requests_prof_guard: professor may only set the decision';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists sign_requests_prof_guard on public.project_sign_requests;
create trigger sign_requests_prof_guard
  before update on public.project_sign_requests
  for each row execute function public.sign_requests_prof_guard();


-- ============================================================
-- SETTINGS — professor notification config
-- ============================================================

alter table public.project_settings
  add column if not exists prof_email          text    not null default '',
  add column if not exists prof_label          text    not null default 'อาจารย์',
  add column if not exists notify_prof_in_app  boolean not null default true,
  add column if not exists notify_prof_email   boolean not null default true;
