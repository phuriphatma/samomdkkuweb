-- ============================================================
-- 0005 — Project tracking schema
--
-- Workflow: SAMO VP-Administration sends "โครงการ" (projects)
-- containing one or more "หนังสือ" (documents); each document has
-- N attached files (Word/PDF/etc). University staff (p'nick) sees
-- an inbox, updates status (รับเรื่อง / กำลังดำเนินการ / เสร็จสิ้น),
-- can return a document for fixes, and leaves comments. Files are
-- stored in Drive under `Projects/<project-id>_<slug>/<doc-id>_<type>/`
-- via the new GAS `uploadProjectFile` action.
--
-- Adds two new roles: vp_admin (sender) and uni_staff (receiver).
-- Both are seat-style roles (one shared login each, matching the
-- existing pr_staff / vs_staff / shop_admin pattern).
--
-- Run via Supabase SQL editor or `supabase db push`. Apply BEFORE
-- 0006_seed_project_accounts.sql.
-- ============================================================


-- ============================================================
-- USERS: expand role constraint to admit 'vp_admin' and 'uni_staff'
-- ============================================================

alter table public.users
  drop constraint if exists users_role_check;
alter table public.users
  add  constraint users_role_check
       check (role in ('user', 'pr_staff', 'vs_staff', 'shop_admin', 'vp_admin', 'uni_staff', 'dev'));

-- Republish current_user_is_staff so these two roles also count as staff
-- for any generic "is this person an internal user?" guard. PR/VS/shop
-- RLS policies still gate on the specific role string, so this only
-- broadens guard helpers (e.g. announcements visibility to staff).
create or replace function public.current_user_is_staff()
returns boolean language sql stable security definer set search_path = public as $$
  select public.current_user_role() in ('pr_staff', 'vs_staff', 'shop_admin', 'vp_admin', 'uni_staff', 'dev')
$$;

-- Helper: project actor = vp_admin, uni_staff, or dev.
create or replace function public.current_user_is_project_actor()
returns boolean language sql stable security definer set search_path = public as $$
  select public.current_user_role() in ('vp_admin', 'uni_staff', 'dev')
$$;


-- ============================================================
-- PROJECT DOC TYPES — small editable lookup
--
-- Seeded with the four types the user named; admin can add more
-- in-app via the manage screen. id is a stable slug used in the
-- Drive folder name; label_th is what the UI shows.
-- ============================================================

create table if not exists public.project_doc_types (
  id           text primary key,
  label_th     text not null,
  sort_order   integer not null default 100,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now()
);

insert into public.project_doc_types (id, label_th, sort_order) values
  ('project',  'หนังสือโครงการ',                 10),
  ('invite',   'หนังสือเชิญอาจารย์',              20),
  ('sponsor',  'หนังสือขอความอนุเคราะห์ sponsor', 30),
  ('other',    'หนังสืออื่นๆ',                    90)
on conflict (id) do update set
  label_th = excluded.label_th,
  sort_order = excluded.sort_order;


-- ============================================================
-- PROJECTS — top-level container (โครงการ)
-- ============================================================

create table if not exists public.projects (
  id              text primary key,                -- e.g. 'PRJ-2605-0001'
  name            text not null,
  description     text,
  status          text not null default 'open'
                  check (status in ('open', 'in_progress', 'completed', 'cancelled')),
  created_by      uuid references public.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists projects_status_idx     on public.projects (status);
create index if not exists projects_created_at_idx on public.projects (created_at desc);


-- ============================================================
-- PROJECT DOCUMENTS (หนังสือ) — multiple per project, sent
-- independently. sequence_no is the display label ("หนังสือ 1",
-- "หนังสือ 2" …); auto-incremented per project at insert time
-- by the application.
-- ============================================================

create table if not exists public.project_documents (
  id              text primary key,                -- e.g. 'DOC-260526-1430-ABCD'
  project_id      text not null references public.projects(id) on delete cascade,
  type_id         text not null references public.project_doc_types(id) on delete restrict,
  title           text not null,
  note            text,                            -- sender's note to the receiver
  sequence_no     integer not null default 1,      -- 1 → "หนังสือ 1", 2 → "หนังสือ 2"
  status          text not null default 'sent'
                  check (status in ('draft', 'sent', 'received', 'in_progress', 'returned', 'completed', 'cancelled')),
  return_reason   text,                            -- populated when status='returned'
  sent_at         timestamptz,                     -- first time it left draft
  received_at     timestamptz,
  completed_at    timestamptz,
  timeline        jsonb not null default '[]',     -- [{at, by, role, action, note}]
  drive_folder    text,                            -- logical path under Projects/...
  created_by      uuid references public.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists project_documents_project_idx on public.project_documents (project_id);
create index if not exists project_documents_status_idx  on public.project_documents (status);
create index if not exists project_documents_type_idx    on public.project_documents (type_id);
create index if not exists project_documents_sent_at_idx on public.project_documents (sent_at desc);

-- Per-project sequence uniqueness (so two docs in the same project never
-- both claim "หนังสือ 2"). The application allocates with MAX+1.
create unique index if not exists project_documents_seq_unique
  on public.project_documents (project_id, sequence_no);


-- ============================================================
-- PROJECT FILES — N per document. "Replace" is non-destructive:
-- the old row stays with `superseded_by` set to the new file id,
-- so p'nick can still see what was originally sent.
-- ============================================================

create table if not exists public.project_files (
  id              bigserial primary key,
  document_id     text not null references public.project_documents(id) on delete cascade,
  file_name       text not null,                   -- original filename
  drive_file_id   text,                            -- Drive file ID (for reference)
  drive_view_url  text not null,                   -- viewable link (uc?id=… form)
  mime_type       text,
  size_bytes      bigint,
  uploaded_by     uuid references public.users(id) on delete set null,
  uploaded_at     timestamptz not null default now(),
  superseded_by   bigint references public.project_files(id) on delete set null
);

create index if not exists project_files_document_idx on public.project_files (document_id);
create index if not exists project_files_active_idx
  on public.project_files (document_id)
  where superseded_by is null;


-- ============================================================
-- PROJECT NOTIFICATIONS — per-user in-app inbox
--
-- Written by application logic on send / status change / new
-- comment / file replace. The recipient role is denormalised so
-- a future "delete user" doesn't orphan unread notifications:
-- they're cascaded with the user.
-- ============================================================

create table if not exists public.project_notifications (
  id              bigserial primary key,
  user_id         uuid not null references public.users(id) on delete cascade,
  project_id      text references public.projects(id) on delete cascade,
  document_id     text references public.project_documents(id) on delete cascade,
  kind            text not null,                   -- 'sent','received','status','returned','comment','file_replaced','completed'
  body            text not null,
  is_read         boolean not null default false,
  created_at      timestamptz not null default now()
);

create index if not exists project_notifications_user_unread_idx
  on public.project_notifications (user_id, is_read, created_at desc);


-- ============================================================
-- PROJECT SETTINGS — singleton config row
--
-- Stores the receiver's real email (for GAS MailApp notifications)
-- and the human-readable labels we display. Edited from the in-app
-- manage screen, not from this migration.
-- ============================================================

create table if not exists public.project_settings (
  id                  integer primary key default 1,
  uni_staff_email     text not null default '',     -- p'nick's real email
  uni_staff_label     text not null default 'พี่นิค',
  vp_admin_label      text not null default 'รองนายกฝ่ายบริหาร',
  notify_uni_in_app   boolean not null default true,
  notify_uni_email    boolean not null default true,
  notify_vp_in_app    boolean not null default true,
  notify_vp_discord   boolean not null default true,
  updated_at          timestamptz not null default now(),
  check (id = 1)
);

insert into public.project_settings (id) values (1)
  on conflict (id) do nothing;


-- ============================================================
-- UPDATED_AT triggers (reuse touch_updated_at from 0001)
-- ============================================================

drop trigger if exists touch_projects_updated_at on public.projects;
create trigger touch_projects_updated_at
  before update on public.projects
  for each row execute function public.touch_updated_at();

drop trigger if exists touch_project_documents_updated_at on public.project_documents;
create trigger touch_project_documents_updated_at
  before update on public.project_documents
  for each row execute function public.touch_updated_at();

drop trigger if exists touch_project_settings_updated_at on public.project_settings;
create trigger touch_project_settings_updated_at
  before update on public.project_settings
  for each row execute function public.touch_updated_at();


-- ============================================================
-- ROW-LEVEL SECURITY
--
-- Only project actors (vp_admin / uni_staff / dev) see anything.
-- Within that ring, both sides can update documents (status,
-- timeline, return_reason, etc.) — the workflow needs two-way
-- writes and the frontend gates which buttons each role sees.
-- Project DELETE stays vp_admin-only so p'nick can't drop a row
-- by mistake.
-- ============================================================

alter table public.projects               enable row level security;
alter table public.project_documents      enable row level security;
alter table public.project_files          enable row level security;
alter table public.project_notifications  enable row level security;
alter table public.project_doc_types      enable row level security;
alter table public.project_settings       enable row level security;

-- PROJECTS
drop policy if exists "projects_read"        on public.projects;
create policy "projects_read"        on public.projects
  for select using (public.current_user_is_project_actor());

drop policy if exists "projects_insert"      on public.projects;
create policy "projects_insert"      on public.projects
  for insert with check (public.current_user_role() in ('vp_admin', 'dev'));

drop policy if exists "projects_update"      on public.projects;
create policy "projects_update"      on public.projects
  for update using (public.current_user_is_project_actor());

drop policy if exists "projects_delete"      on public.projects;
create policy "projects_delete"      on public.projects
  for delete using (public.current_user_role() in ('vp_admin', 'dev'));

-- PROJECT DOCUMENTS
drop policy if exists "project_documents_read"   on public.project_documents;
create policy "project_documents_read"   on public.project_documents
  for select using (public.current_user_is_project_actor());

drop policy if exists "project_documents_insert" on public.project_documents;
create policy "project_documents_insert" on public.project_documents
  for insert with check (public.current_user_role() in ('vp_admin', 'dev'));

drop policy if exists "project_documents_update" on public.project_documents;
create policy "project_documents_update" on public.project_documents
  for update using (public.current_user_is_project_actor());

drop policy if exists "project_documents_delete" on public.project_documents;
create policy "project_documents_delete" on public.project_documents
  for delete using (public.current_user_role() in ('vp_admin', 'dev'));

-- PROJECT FILES — read/insert/update if you can read the parent document.
-- VP-Admin uploads; uni_staff may attach a "fix" file on a returned doc
-- when responding; both sides see everything.
drop policy if exists "project_files_read"   on public.project_files;
create policy "project_files_read"   on public.project_files
  for select using (
    exists (
      select 1 from public.project_documents d
      where d.id = document_id and public.current_user_is_project_actor()
    )
  );

drop policy if exists "project_files_insert" on public.project_files;
create policy "project_files_insert" on public.project_files
  for insert with check (
    public.current_user_is_project_actor()
    and exists (select 1 from public.project_documents d where d.id = document_id)
  );

drop policy if exists "project_files_update" on public.project_files;
create policy "project_files_update" on public.project_files
  for update using (public.current_user_is_project_actor());

drop policy if exists "project_files_delete" on public.project_files;
create policy "project_files_delete" on public.project_files
  for delete using (public.current_user_role() in ('vp_admin', 'dev'));

-- NOTIFICATIONS — only your own.
drop policy if exists "project_notifications_read"   on public.project_notifications;
create policy "project_notifications_read"   on public.project_notifications
  for select using (user_id = auth.uid());

-- Insert is allowed by any project actor so the application can write
-- "for the other party" (VP-Admin inserts a 'sent' notification for
-- uni_staff, and vice versa). The user_id column targets the recipient.
drop policy if exists "project_notifications_insert" on public.project_notifications;
create policy "project_notifications_insert" on public.project_notifications
  for insert with check (public.current_user_is_project_actor());

drop policy if exists "project_notifications_update" on public.project_notifications;
create policy "project_notifications_update" on public.project_notifications
  for update using (user_id = auth.uid());

drop policy if exists "project_notifications_delete" on public.project_notifications;
create policy "project_notifications_delete" on public.project_notifications
  for delete using (user_id = auth.uid());

-- DOC TYPES — readable + editable by either actor (admin lookup mgmt).
drop policy if exists "project_doc_types_read"  on public.project_doc_types;
create policy "project_doc_types_read"  on public.project_doc_types
  for select using (public.current_user_is_project_actor());

drop policy if exists "project_doc_types_write" on public.project_doc_types;
create policy "project_doc_types_write" on public.project_doc_types
  for all using (public.current_user_is_project_actor())
            with check (public.current_user_is_project_actor());

-- SETTINGS — both actors can read so the UI can render the right labels;
-- only vp_admin/dev can change them (so p'nick's email is curated, not
-- self-edited).
drop policy if exists "project_settings_read"  on public.project_settings;
create policy "project_settings_read"  on public.project_settings
  for select using (public.current_user_is_project_actor());

drop policy if exists "project_settings_write" on public.project_settings;
create policy "project_settings_write" on public.project_settings
  for all using (public.current_user_role() in ('vp_admin', 'dev'))
            with check (public.current_user_role() in ('vp_admin', 'dev'));
