-- ============================================================
-- 0001 — Initial schema
--
-- Single source of truth for users, announcements, and tickets.
-- Mirrors the existing Google Sheets schemas as closely as practical
-- so the migration script can do a 1:1 mapping.
--
-- Run via Supabase SQL editor or `supabase db push`.
-- ============================================================

-- ============================================================
-- USERS
-- Mirrors auth.users for app-specific fields. Created via trigger
-- when a new auth user signs up.
-- ============================================================

create table if not exists public.users (
  id              uuid primary key references auth.users(id) on delete cascade,
  email           text unique,
  username        text unique,                          -- nullable: only set for password-method users
  display_name    text not null default '',
  method          text not null default 'password'      -- 'password' | 'google'
                  check (method in ('password', 'google')),
  role            text not null default 'user'
                  check (role in ('user', 'pr_staff', 'vs_staff', 'dev')),
  department      text,
  created_at      timestamptz not null default now(),
  last_seen_at    timestamptz
);

create index if not exists users_email_idx on public.users (email);
create index if not exists users_username_idx on public.users (username);
create index if not exists users_role_idx on public.users (role);

-- Auto-create users row whenever a new auth.users record appears.
-- Reads metadata the frontend supplied via supabase.auth.signUp's `options.data`.
create or replace function public.handle_new_auth_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.users (id, email, username, display_name, method)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'username', null),
    coalesce(
      new.raw_user_meta_data->>'display_name',
      new.raw_user_meta_data->>'name',
      new.raw_user_meta_data->>'username',
      split_part(new.email, '@', 1)
    ),
    coalesce(new.raw_user_meta_data->>'method', 'password')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();


-- ============================================================
-- ANNOUNCEMENTS
-- ============================================================

create table if not exists public.announcements (
  id              bigserial primary key,
  title           text not null,
  content         text not null,                        -- HTML from Quill
  department      text not null,
  thumbnail_url   text,
  status          text not null default 'approved'      -- legacy column from sheet
                  check (status in ('approved', 'draft', 'archived')),
  created_by      uuid references public.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists announcements_status_idx on public.announcements (status);
create index if not exists announcements_created_at_idx on public.announcements (created_at desc);


-- ============================================================
-- PR TICKETS
-- Column names match the sheet conceptually; types tightened.
-- ============================================================

create table if not exists public.pr_tickets (
  id                     text primary key,                -- e.g. "PR-XXXXXX"
  timestamp              timestamptz not null default now(),
  department             text not null,
  contact                text,
  content_name           text not null,
  job_type               text,                            -- 'New content' | 'Ready to post'
  platforms              text[] default '{}',
  posting_channel        text,
  publish_date           timestamptz,
  deadline_status        text default 'ปกติ',             -- 'ปกติ' | 'ด่วน (PR Review)'
  rush_reason            text,
  brief                  text,
  caption                text,
  file_url               text,                            -- newline-separated URLs (legacy format)
  silent_notify          boolean default false,
  project_account        text,
  copost_with            text,
  submitter_id           uuid references public.users(id) on delete set null,
  submitter_label        text,                            -- denormalized for guest-submitted rows
  status                 text not null default 'รอ PR รับเรื่อง',
  remarks                jsonb default '[]'::jsonb,
  assignees              text[] default '{}',
  other_platforms        text[] default '{}',
  other_platform_reason  text,
  created_at             timestamptz not null default now()
);

create index if not exists pr_tickets_status_idx on public.pr_tickets (status);
create index if not exists pr_tickets_dept_idx on public.pr_tickets (department);
create index if not exists pr_tickets_submitter_idx on public.pr_tickets (submitter_id);
create index if not exists pr_tickets_created_at_idx on public.pr_tickets (created_at desc);


-- ============================================================
-- VS TICKETS
-- ============================================================

create table if not exists public.vs_tickets (
  id                  text primary key,                   -- e.g. "VS-XXXXXX"
  timestamp           timestamptz not null default now(),
  display_name        text,                               -- "Anonymous" if not provided
  year                text,
  submitter_id        uuid references public.users(id) on delete set null,
  submitter_label     text,                               -- denormalized for guest-submitted rows
  problem             text not null,                      -- HTML from Quill
  target_dept         text not null default 'SE',         -- current responsible dept
  requested_dept      text,                               -- what user asked for (informational)
  status              text not null default 'รอ SE รับเรื่อง',
  is_emergency        boolean default false,
  remarks             jsonb default '[]'::jsonb,
  created_at          timestamptz not null default now()
);

create index if not exists vs_tickets_status_idx on public.vs_tickets (status);
create index if not exists vs_tickets_dept_idx on public.vs_tickets (target_dept);
create index if not exists vs_tickets_submitter_idx on public.vs_tickets (submitter_id);
create index if not exists vs_tickets_created_at_idx on public.vs_tickets (created_at desc);


-- ============================================================
-- PR AGENTS (replaces PropertiesService.PR_AGENTS)
-- Single-row config table with a JSONB list.
-- ============================================================

create table if not exists public.pr_agents (
  id              integer primary key default 1,
  agents          text[] not null default '{}',
  updated_at      timestamptz not null default now(),
  check (id = 1)
);

insert into public.pr_agents (id, agents) values (1, '{}'::text[])
  on conflict (id) do nothing;


-- ============================================================
-- HELPER: role check function
-- ============================================================

create or replace function public.current_user_role()
returns text language sql stable security definer set search_path = public as $$
  select role from public.users where id = auth.uid()
$$;

create or replace function public.current_user_is_staff()
returns boolean language sql stable security definer set search_path = public as $$
  select public.current_user_role() in ('pr_staff', 'vs_staff', 'dev')
$$;


-- ============================================================
-- ROW-LEVEL SECURITY
-- ============================================================

alter table public.users enable row level security;
alter table public.announcements enable row level security;
alter table public.pr_tickets enable row level security;
alter table public.vs_tickets enable row level security;
alter table public.pr_agents enable row level security;

-- USERS: anyone authenticated can read all users (needed for staff dashboards
-- to show submitter info). Users can update their own row; staff/dev can update any.
drop policy if exists "users_read_all" on public.users;
create policy "users_read_all" on public.users
  for select using (auth.role() = 'authenticated');

drop policy if exists "users_update_self" on public.users;
create policy "users_update_self" on public.users
  for update using (id = auth.uid());

drop policy if exists "users_update_staff" on public.users;
create policy "users_update_staff" on public.users
  for update using (public.current_user_is_staff());

-- ANNOUNCEMENTS: anyone (incl. anonymous) can read approved announcements;
-- only pr_staff or dev can write.
drop policy if exists "announcements_read" on public.announcements;
create policy "announcements_read" on public.announcements
  for select using (status = 'approved' or public.current_user_is_staff());

drop policy if exists "announcements_write" on public.announcements;
create policy "announcements_write" on public.announcements
  for all using (public.current_user_role() in ('pr_staff', 'dev'))
            with check (public.current_user_role() in ('pr_staff', 'dev'));

-- PR_TICKETS: submitters see their own; pr_staff/dev see everything.
-- Anonymous submission supported (Guest mode) via insert-anyone policy.
drop policy if exists "pr_tickets_read" on public.pr_tickets;
create policy "pr_tickets_read" on public.pr_tickets
  for select using (
    submitter_id = auth.uid()
    or public.current_user_role() in ('pr_staff', 'dev')
  );

drop policy if exists "pr_tickets_insert_anyone" on public.pr_tickets;
create policy "pr_tickets_insert_anyone" on public.pr_tickets
  for insert with check (true);

drop policy if exists "pr_tickets_update_staff" on public.pr_tickets;
create policy "pr_tickets_update_staff" on public.pr_tickets
  for update using (public.current_user_role() in ('pr_staff', 'dev'));

drop policy if exists "pr_tickets_delete_staff" on public.pr_tickets;
create policy "pr_tickets_delete_staff" on public.pr_tickets
  for delete using (public.current_user_role() in ('pr_staff', 'dev'));

-- VS_TICKETS: same pattern as PR (own + vs_staff/dev see all).
drop policy if exists "vs_tickets_read" on public.vs_tickets;
create policy "vs_tickets_read" on public.vs_tickets
  for select using (
    submitter_id = auth.uid()
    or public.current_user_role() in ('vs_staff', 'dev')
  );

drop policy if exists "vs_tickets_insert_anyone" on public.vs_tickets;
create policy "vs_tickets_insert_anyone" on public.vs_tickets
  for insert with check (true);

drop policy if exists "vs_tickets_update_staff" on public.vs_tickets;
create policy "vs_tickets_update_staff" on public.vs_tickets
  for update using (public.current_user_role() in ('vs_staff', 'dev'));

-- PR_AGENTS: any staff can read/write the global agent list.
drop policy if exists "pr_agents_read" on public.pr_agents;
create policy "pr_agents_read" on public.pr_agents
  for select using (public.current_user_is_staff());

drop policy if exists "pr_agents_write" on public.pr_agents;
create policy "pr_agents_write" on public.pr_agents
  for all using (public.current_user_role() in ('pr_staff', 'dev'))
            with check (public.current_user_role() in ('pr_staff', 'dev'));


-- ============================================================
-- UPDATED_AT triggers
-- ============================================================

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists touch_announcements_updated_at on public.announcements;
create trigger touch_announcements_updated_at
  before update on public.announcements
  for each row execute function public.touch_updated_at();
