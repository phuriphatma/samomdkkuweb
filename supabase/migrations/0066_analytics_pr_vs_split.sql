-- ============================================================
-- 0066 — analytics: split PR vs VitalSound + add completed counts
--
-- The public strip + staff dashboard previously showed a single combined
-- "requests" number (pr + vs). Leadership wants them SEPARATED and wants
-- to see, per service, how many were requested vs how many are DONE.
--
-- "Completed" is status-derived:
--   * PR done  = status 'โพสต์เรียบร้อย (เสร็จสิ้น)'
--   * VS done  = status 'เสร็จสิ้น'
--   Both contain the substring 'เสร็จสิ้น' and no other status does, so
--   `status like '%เสร็จสิ้น%'` matches completion for either table.
-- Both tables soft-delete via `deleted_at` (0043); all counts filter
-- `deleted_at is null` so a deleted ticket never inflates the totals.
--
-- Replaces public_stats() and analytics_overview() from 0065 (create or
-- replace — same signatures / return type, grants unchanged).
-- ============================================================

create or replace function public.public_stats()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'users',         (select count(*) from public.users),

    -- PR
    'pr_total',      (select count(*) from public.pr_tickets where deleted_at is null),
    'pr_completed',  (select count(*) from public.pr_tickets
                        where deleted_at is null and status like '%เสร็จสิ้น%'),
    -- VitalSound
    'vs_total',      (select count(*) from public.vs_tickets where deleted_at is null),
    'vs_completed',  (select count(*) from public.vs_tickets
                        where deleted_at is null and status like '%เสร็จสิ้น%'),

    -- combined (kept for back-compat / overall volume)
    'requests',      (select count(*) from public.pr_tickets where deleted_at is null)
                     + (select count(*) from public.vs_tickets where deleted_at is null),

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
      'pr',           (select count(*) from public.pr_tickets where deleted_at is null),
      'pr_completed', (select count(*) from public.pr_tickets where deleted_at is null and status like '%เสร็จสิ้น%'),
      'vs',           (select count(*) from public.vs_tickets where deleted_at is null),
      'vs_completed', (select count(*) from public.vs_tickets where deleted_at is null and status like '%เสร็จสิ้น%'),
      'requests',     (select count(*) from public.pr_tickets where deleted_at is null)
                      + (select count(*) from public.vs_tickets where deleted_at is null),
      'projects',     (select count(*) from public.projects),
      'documents',    (select count(*) from public.project_documents),
      'orders',       (select count(*) from public.shop_orders),
      'events',       (select count(*) from public.analytics_events)
    ),

    'active', jsonb_build_object(
      'sessions_dau', (select count(distinct session_id) from public.analytics_events where at > now() - interval '1 day'),
      'sessions_wau', (select count(distinct session_id) from public.analytics_events where at > now() - interval '7 days'),
      'sessions_mau', (select count(distinct session_id) from public.analytics_events where at > now() - interval '30 days'),
      'users_dau',    (select count(distinct user_id) from public.analytics_events where user_id is not null and at > now() - interval '1 day'),
      'users_wau',    (select count(distinct user_id) from public.analytics_events where user_id is not null and at > now() - interval '7 days'),
      'users_mau',    (select count(distinct user_id) from public.analytics_events where user_id is not null and at > now() - interval '30 days')
    ),

    'signups_by_day', (
      select coalesce(jsonb_agg(jsonb_build_object('d', to_char(day, 'YYYY-MM-DD'), 'n', coalesce(c.n, 0)) order by day), '[]'::jsonb)
      from generate_series((since)::date, (now())::date, interval '1 day') as day
      left join (
        select created_at::date as d, count(*) n from public.users where created_at > since group by 1
      ) c on c.d = day::date
    ),

    -- PR + VS requests submitted per day, split by service.
    'requests_by_day', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'd', to_char(day, 'YYYY-MM-DD'),
               'pr', coalesce(c.pr, 0),
               'vs', coalesce(c.vs, 0),
               'n', coalesce(c.pr, 0) + coalesce(c.vs, 0)) order by day), '[]'::jsonb)
      from generate_series((since)::date, (now())::date, interval '1 day') as day
      left join (
        select dt::date as d,
               count(*) filter (where src = 'pr') pr,
               count(*) filter (where src = 'vs') vs
        from (
          select created_at dt, 'pr' src from public.pr_tickets where created_at > since and deleted_at is null
          union all
          select created_at dt, 'vs' src from public.vs_tickets where created_at > since and deleted_at is null
        ) u group by 1
      ) c on c.d = day::date
    ),

    'visitors_by_day', (
      select coalesce(jsonb_agg(jsonb_build_object('d', to_char(day, 'YYYY-MM-DD'), 'n', coalesce(c.n, 0)) order by day), '[]'::jsonb)
      from generate_series((since)::date, (now())::date, interval '1 day') as day
      left join (
        select at::date as d, count(distinct session_id) n from public.analytics_events where at > since group by 1
      ) c on c.d = day::date
    ),

    'top_paths', (
      select coalesce(jsonb_agg(jsonb_build_object('path', path, 'n', n) order by n desc), '[]'::jsonb)
      from (
        select coalesce(path, '(unknown)') path, count(*) n
        from public.analytics_events
        where at > since and event in ('pageview', 'tab')
        group by 1 order by n desc limit 10
      ) t
    ),

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
