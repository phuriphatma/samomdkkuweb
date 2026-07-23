-- ============================================================
-- 0065 — analytics: cookieless usage tracking + metrics RPCs
--
-- Goal: prove "people are using the portal" with real numbers —
--   * how MANY people (registered users, unique visitors),
--   * how OFTEN (DAU / WAU / MAU, sessions, return visits),
--   * WHAT they do (top tabs, requests/documents/orders over time).
--
-- Two data sources feed the metrics:
--   1. The EXISTING engagement tables (users, pr_tickets, vs_tickets,
--      projects, project_documents, shop_orders) — these already prove
--      volume the moment this ships, no tracking needed.
--   2. A NEW analytics_events table — cookieless, anonymous page/tab
--      hits sent by the frontend (src/js/analytics.js). Adds the
--      "how often / return visits / top tabs" dimension the tables
--      alone can't show. Empty until the tracker deploys; the RPCs
--      degrade gracefully to 0 / empty arrays until then.
--
-- Privacy: session_id is an EPHEMERAL random id kept in sessionStorage
-- (dies when the tab closes) — not a persistent cookie, no PII, no
-- cross-site identifier. user_id is filled only for signed-in staff/
-- students (their own uuid), used to separate authed vs anonymous use.
--
-- Access model (same public-but-RLS-gated pattern as notify_log 0055):
--   * anon + authenticated may INSERT events (the frontend posts with
--     the bundled anon key). No SELECT for the public — write-only.
--   * staff (current_user_is_staff()) may SELECT raw events + call the
--     staff dashboard RPC.
--   * public_stats() is a curated, SECURITY DEFINER read granted to
--     everyone — it returns only aggregate COUNTS (never rows), so the
--     public landing page can show social-proof numbers safely.
-- ============================================================

-- ------------------------------------------------------------
-- analytics_events — one row per page/tab hit. Per-column length CHECKs
-- cap how much a single crafted insert can store (the table is publicly
-- INSERTable via the anon key — same threat model as pr_tickets /
-- notify_log). Unbounded ROW COUNT is bounded by prune_analytics() below.
-- ------------------------------------------------------------
create table if not exists public.analytics_events (
  id         bigint generated always as identity primary key,
  at         timestamptz not null default now(),
  session_id text    check (session_id is null or char_length(session_id) <= 64),  -- ephemeral sessionStorage id
  event      text    not null default 'pageview'
                     check (char_length(event) <= 32),                              -- 'pageview' | 'tab' | 'login'
  path       text    check (path     is null or char_length(path)     <= 200),      -- app path / tab id
  is_authed  boolean not null default false,
  user_id    uuid,                                                                  -- signed-in user's uuid (nullable)
  referrer   text    check (referrer is null or char_length(referrer) <= 300),
  app        text    check (app      is null or char_length(app)      <= 16)        -- 'public' | 'admin'
);

comment on table public.analytics_events is
  'Cookieless, anonymous usage events (page/tab hits) from the frontend. Best-effort, publicly INSERTable via the anon key, staff-readable. See migration 0065.';

-- "Everything since <date>" scans (DAU/WAU/MAU, series) hit at-desc.
create index if not exists analytics_events_at_idx     on public.analytics_events (at desc);
-- Distinct-session counts group by session within a window.
create index if not exists analytics_events_sess_idx   on public.analytics_events (session_id, at desc);
-- Top-tabs / event breakdown.
create index if not exists analytics_events_event_idx  on public.analytics_events (event, at desc);

alter table public.analytics_events enable row level security;

-- Append-only: anyone may INSERT; nobody but staff may read (no anon USING).
drop policy if exists analytics_events_insert_any on public.analytics_events;
create policy analytics_events_insert_any
  on public.analytics_events
  for insert to anon, authenticated
  with check (true);

drop policy if exists analytics_events_select_staff on public.analytics_events;
create policy analytics_events_select_staff
  on public.analytics_events
  for select to authenticated
  using (public.current_user_is_staff());

grant insert on public.analytics_events to anon, authenticated;
grant select on public.analytics_events to authenticated;

-- ------------------------------------------------------------
-- public_stats() — curated social-proof numbers for the PUBLIC landing
-- page. Returns aggregate COUNTS only (never any row/PII), so it is safe
-- to expose to anon. SECURITY DEFINER so the counts don't depend on the
-- caller's RLS. Cheap (indexed counts on small tables); the client
-- caches the result, so this runs at most a few times per visitor.
-- ------------------------------------------------------------
create or replace function public.public_stats()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'users',         (select count(*) from public.users),
    'pr',            (select count(*) from public.pr_tickets),
    'vs',            (select count(*) from public.vs_tickets),
    'requests',      (select count(*) from public.pr_tickets)
                     + (select count(*) from public.vs_tickets),
    'projects',      (select count(*) from public.projects),
    'documents',     (select count(*) from public.project_documents),
    'orders',        (select count(*) from public.shop_orders),
    'departments',   (select count(distinct department)
                        from public.users where department is not null),
    'new_users_7d',  (select count(*) from public.users
                        where created_at > now() - interval '7 days'),
    'new_users_30d', (select count(*) from public.users
                        where created_at > now() - interval '30 days'),
    'generated_at',  now()
  );
$$;

revoke all on function public.public_stats() from public;
grant execute on function public.public_stats() to anon, authenticated;

comment on function public.public_stats() is
  'Curated aggregate counts for the public landing page (no rows/PII). Safe for anon. See migration 0065.';

-- ------------------------------------------------------------
-- analytics_overview(days) — the STAFF dashboard payload. Combines the
-- engagement tables with analytics_events into one jsonb blob:
--   totals, signups-by-day, requests-by-day, visitors-by-day,
--   active users (DAU/WAU/MAU by session and by authed user), top tabs.
-- Staff-only. Guard uses `is not true` so a NULL current_user_is_staff()
-- (no users row / service role) fails CLOSED, not open (see mistakes.md
-- "null in (...) fails open").
-- ------------------------------------------------------------
create or replace function public.analytics_overview(days integer default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  d integer := greatest(least(coalesce(days, 30), 365), 1);
  since timestamptz := now() - make_interval(days => d);
  result jsonb;
begin
  if public.current_user_is_staff() is not true then
    raise exception 'analytics_overview: staff only';
  end if;

  select jsonb_build_object(
    'range_days', d,
    'generated_at', now(),

    'totals', jsonb_build_object(
      'users',        (select count(*) from public.users),
      'pr',           (select count(*) from public.pr_tickets),
      'vs',           (select count(*) from public.vs_tickets),
      'requests',     (select count(*) from public.pr_tickets)
                      + (select count(*) from public.vs_tickets),
      'projects',     (select count(*) from public.projects),
      'documents',    (select count(*) from public.project_documents),
      'orders',       (select count(*) from public.shop_orders),
      'events',       (select count(*) from public.analytics_events)
    ),

    -- Active users measured two ways: unique BROWSER SESSIONS (includes
    -- anonymous visitors) and unique SIGNED-IN users.
    'active', jsonb_build_object(
      'sessions_dau', (select count(distinct session_id) from public.analytics_events where at > now() - interval '1 day'),
      'sessions_wau', (select count(distinct session_id) from public.analytics_events where at > now() - interval '7 days'),
      'sessions_mau', (select count(distinct session_id) from public.analytics_events where at > now() - interval '30 days'),
      'users_dau',    (select count(distinct user_id) from public.analytics_events where user_id is not null and at > now() - interval '1 day'),
      'users_wau',    (select count(distinct user_id) from public.analytics_events where user_id is not null and at > now() - interval '7 days'),
      'users_mau',    (select count(distinct user_id) from public.analytics_events where user_id is not null and at > now() - interval '30 days')
    ),

    -- New signups per day over the window (fills gaps with 0).
    'signups_by_day', (
      select coalesce(jsonb_agg(jsonb_build_object('d', to_char(day, 'YYYY-MM-DD'), 'n', coalesce(c.n, 0)) order by day), '[]'::jsonb)
      from generate_series((since)::date, (now())::date, interval '1 day') as day
      left join (
        select created_at::date as d, count(*) n from public.users where created_at > since group by 1
      ) c on c.d = day::date
    ),

    -- PR+VS requests submitted per day.
    'requests_by_day', (
      select coalesce(jsonb_agg(jsonb_build_object('d', to_char(day, 'YYYY-MM-DD'), 'n', coalesce(c.n, 0)) order by day), '[]'::jsonb)
      from generate_series((since)::date, (now())::date, interval '1 day') as day
      left join (
        select dt::date as d, count(*) n from (
          select created_at dt from public.pr_tickets where created_at > since
          union all
          select created_at dt from public.vs_tickets where created_at > since
        ) u group by 1
      ) c on c.d = day::date
    ),

    -- Unique visitor sessions per day (from analytics_events).
    'visitors_by_day', (
      select coalesce(jsonb_agg(jsonb_build_object('d', to_char(day, 'YYYY-MM-DD'), 'n', coalesce(c.n, 0)) order by day), '[]'::jsonb)
      from generate_series((since)::date, (now())::date, interval '1 day') as day
      left join (
        select at::date as d, count(distinct session_id) n from public.analytics_events where at > since group by 1
      ) c on c.d = day::date
    ),

    -- Most-visited tabs/paths over the window.
    'top_paths', (
      select coalesce(jsonb_agg(jsonb_build_object('path', path, 'n', n) order by n desc), '[]'::jsonb)
      from (
        select coalesce(path, '(unknown)') path, count(*) n
        from public.analytics_events
        where at > since and event in ('pageview', 'tab')
        group by 1 order by n desc limit 10
      ) t
    ),

    -- Role split of registered users (proof of the whole org onboarding).
    'roles', (
      select coalesce(jsonb_agg(jsonb_build_object('role', coalesce(role, 'user'), 'n', n) order by n desc), '[]'::jsonb)
      from (select role, count(*) n from public.users group by 1) r
    )
  ) into result;

  return result;
end;
$$;

revoke all on function public.analytics_overview(integer) from public, anon;
grant execute on function public.analytics_overview(integer) to authenticated;

comment on function public.analytics_overview(integer) is
  'Staff-only usage dashboard payload (totals, time-series, active users, top tabs). See migration 0065.';

-- ------------------------------------------------------------
-- Retention: analytics_events is a publicly-INSERTable firehose, so cap
-- its growth. prune_analytics() drops rows older than retain_days
-- (default 90 — longer than notify_log since these power MoM trends).
-- NOT granted to anon/authenticated — SQL editor / service_role / pg_cron
-- only. Schedule with pg_cron once enabled:
--   select cron.schedule('prune-analytics','0 4 * * *',
--     $$ select public.prune_analytics(90) $$);
-- ------------------------------------------------------------
create or replace function public.prune_analytics(retain_days integer default 90)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare removed integer;
begin
  delete from public.analytics_events
   where at < now() - make_interval(days => greatest(retain_days, 1));
  get diagnostics removed = row_count;
  return removed;
end;
$$;

revoke all on function public.prune_analytics(integer) from public, anon, authenticated;

comment on function public.prune_analytics(integer) is
  'Delete analytics_events older than retain_days (default 90). SQL editor / pg_cron only. See migration 0065.';
