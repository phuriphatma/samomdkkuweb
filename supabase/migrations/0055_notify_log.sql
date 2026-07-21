-- ============================================================
-- 0055 — notify_log: durable record of every Discord-notify outcome
--
-- Why this exists:
--   PR / VS / projects Discord notifications drop "sometimes" and the
--   drops leave NO trace anywhere:
--     * Cloudflare Pages Function `console.warn`/`console.info` are only
--       visible in a live `wrangler pages deployment tail` (or the
--       dashboard real-time logs) — nothing is retained. A drop that
--       happened yesterday is unrecoverable.
--     * The client-side `console.warn` in discord-queue.js `callGAS`
--       lives only in that one browser tab's console and dies with it.
--   So there is currently no way to answer "did ticket PR-1234's notify
--   actually reach Discord?" after the fact. This table is that record.
--
-- The `/notify` Cloudflare Function writes one row per delivery attempt
-- outcome (best-effort — a failed log write must never affect notify
-- delivery). Query it to see exactly which notifies failed, with the
-- Discord status code and retry count:
--
--   select at, system, action, ticket_id, ok, discord_status, attempts
--     from public.notify_log
--    where not ok
--    order by at desc;
--
-- Access model (append-only log):
--   * anon + authenticated may INSERT (the Function posts with the anon
--     key — same public-but-RLS-gated pattern as the rest of the app;
--     see .claude/rules/security.md). There is deliberately NO select
--     policy for anon, so the public can write but never read the log.
--   * staff (current_user_is_staff()) may SELECT for debugging.
--
-- Env the Function needs (Cloudflare Pages → Settings → env vars):
--   SUPABASE_URL         — same value as VITE_SUPABASE_URL
--   SUPABASE_ANON_KEY    — same value as VITE_SUPABASE_ANON_KEY
--   If either is unset the Function silently skips logging (so this
--   migration is safe to apply before the env vars are added, and older
--   deploys keep working unchanged).
-- ============================================================

-- NOTE: the INSERT policy below is `with check (true)` — this table is
-- publicly writable via the bundled anon key (same threat model as
-- pr_tickets/vs_tickets). The per-column length CHECKs here are the
-- hard cap on how much a single crafted insert can store, so a direct
-- POST to /rest/v1/notify_log can't stuff megabytes per row. Unbounded
-- ROW COUNT is bounded instead by retention — see prune_notify_log()
-- at the bottom of this file. The app already truncates `error` to 500;
-- the DB CHECK is the backstop for callers that bypass the app.
create table if not exists public.notify_log (
  id             bigint generated always as identity primary key,
  at             timestamptz not null default now(),
  system         text check (system    is null or char_length(system)    <= 32),   -- 'pr' | 'vs' | 'projects'
  action         text check (action    is null or char_length(action)    <= 64),   -- notifyPROnly | notifyVSOnly | notifyVSConsult | notifyProjectDiscord
  ticket_id      text check (ticket_id is null or char_length(ticket_id) <= 64),    -- PR/VS ticket id (null for projects)
  dept           text check (dept      is null or char_length(dept)      <= 128),   -- department / notifyTo, when relevant
  ok             boolean not null,     -- did Discord accept the message?
  discord_status integer,              -- final HTTP status from Discord (or 0 on transport throw)
  first_status   integer,              -- status on the FIRST attempt (differs from final iff retried)
  attempts       integer,              -- how many POSTs it took
  retried        boolean,              -- was more than one attempt made?
  error          text check (error     is null or char_length(error)     <= 1000)  -- short body/exception snippet on failure
);

comment on table public.notify_log is
  'Append-only outcome log for /notify Discord deliveries. Written best-effort by the Cloudflare Pages Function; query the not-ok rows to diagnose dropped notifications. See migration 0055.';

-- Fast "show me recent failures" scan.
create index if not exists notify_log_failures_idx
  on public.notify_log (at desc)
  where ok = false;

-- Look up a specific ticket's notify history.
create index if not exists notify_log_ticket_idx
  on public.notify_log (ticket_id)
  where ticket_id is not null;

alter table public.notify_log enable row level security;

-- Append-only: anyone (anon/authenticated) may INSERT. No USING policy is
-- defined for these roles, so they cannot SELECT what they wrote — the log
-- is write-only to the public and readable only by staff (below).
drop policy if exists notify_log_insert_any on public.notify_log;
create policy notify_log_insert_any
  on public.notify_log
  for insert
  to anon, authenticated
  with check (true);

-- Staff can read the log for debugging.
drop policy if exists notify_log_select_staff on public.notify_log;
create policy notify_log_select_staff
  on public.notify_log
  for select
  to authenticated
  using (public.current_user_is_staff());

grant insert on public.notify_log to anon, authenticated;
grant select on public.notify_log to authenticated;

-- ------------------------------------------------------------
-- Retention: this is a debug/triage log, not a system of record. The
-- table is publicly INSERTable, so without pruning its row count grows
-- unbounded (normal traffic + any anon abuse). prune_notify_log() drops
-- rows older than `retain_days` (default 30) and returns how many it
-- removed. NOT granted to anon/authenticated — only the table owner /
-- service_role / pg_cron / the SQL editor can run it, so it can't be
-- called (or abused) from the public anon key. Security-definer so it
-- runs as owner regardless of who the scheduler is.
-- ------------------------------------------------------------
create or replace function public.prune_notify_log(retain_days integer default 30)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  removed integer;
begin
  delete from public.notify_log
   where at < now() - make_interval(days => greatest(retain_days, 1));
  get diagnostics removed = row_count;
  return removed;
end;
$$;

revoke all on function public.prune_notify_log(integer) from public, anon, authenticated;

comment on function public.prune_notify_log(integer) is
  'Delete notify_log rows older than retain_days (default 30). Run from the SQL editor, or schedule with pg_cron (see migration 0055).';

-- Optional automatic retention. Requires the pg_cron extension
-- (Supabase → Database → Extensions → enable "pg_cron"). Once enabled,
-- run ONCE to schedule a nightly 03:00 UTC prune keeping 30 days:
--
--   select cron.schedule(
--     'prune-notify-log', '0 3 * * *',
--     $$ select public.prune_notify_log(30) $$
--   );
--
-- Until pg_cron is scheduled, run `select public.prune_notify_log(30);`
-- manually whenever the table needs trimming.
