-- 0171 — the daily ceiling is not the only one: measure BURST too
--
-- WHY. 0170 answered "is 100 a day enough?" (yes — 95 sends in 72 days, peak 7).
-- The owner then asked the better question: what about sending many AT ONCE?
--
-- Apps Script has ceilings that a comfortable daily total says nothing about,
-- confirmed against Google's quota page rather than memory:
--
--   simultaneous executions per user     30      <- the concurrency ceiling
--   simultaneous executions per script   1,000
--   email recipients per MESSAGE         50      <- one over and the send fails
--   script runtime                       6 min / execution
--
-- There is NO documented per-minute or per-hour email rate limit; the daily
-- recipient quota and the concurrency cap are the real ones.
--
-- ⚠️ AND THE EMAIL PATH IS NOT SERIALISED. Discord notifications go through
-- `queueDiscord` — one global chain, spaced — precisely so a burst cannot
-- hammer the endpoint. Email calls `callGAS` DIRECTLY, right beside it, so
-- nothing spaces those. That asymmetry is invisible until traffic grows, which
-- is exactly why it should be on a dashboard rather than in someone's memory.
--
-- MEASURED on production before writing this (2026-08-28): busiest minute 2,
-- busiest hour 5, tightest gap between two sends 7.7 seconds. Against a limit
-- of 30 simultaneous that is not close — but "not close" is a fact with a date
-- on it, and the panel now keeps it current instead of it rotting here.
--
-- Same derivation and the same caveat as 0170: counted from the notification
-- fan-out, so it under-reads if nobody holds the staff seat or the in-app half
-- is switched off. Both are surfaced and the UI warns.
CREATE OR REPLACE FUNCTION public.analytics_overview(days integer DEFAULT 30)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  d integer := greatest(least(coalesce(days, 30), 365), 1);
  since timestamptz := now() - make_interval(days => d);
  result jsonb;
begin
  -- Anyone who can open the admin dashboard may see สถิติการใช้งาน. The section is
  -- offered with no permission requirement (admin-main.js SIDE_FEATURE.analytics =
  -- null), and analytics_events' own SELECT policy was repointed to
  -- current_user_has_any_grant() back in 0093 — this guard was the surface that
  -- pass missed, so the sidebar showed the section to every admin user and the RPC
  -- then refused them with 'staff only'.
  if public.current_user_has_any_grant() is not true then
    raise exception 'analytics_overview: requires an admin grant';
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
      'projects',        (select count(*) from public.projects),
      'documents',       (select count(*) from public.project_documents),
      'doc_completed',   (select count(*) from public.project_documents where status = 'completed'),
      'doc_signed',      (select count(*) from public.project_sign_requests where status = 'accepted'),
      'doc_transactions',(select coalesce(sum(jsonb_array_length(timeline)), 0)
                            from public.project_documents where jsonb_typeof(timeline) = 'array'),
      'doc_interactions',(select count(*) from public.project_notifications where kind = 'comment')
                         + (select count(*) from public.project_doc_views),
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

    'requests_by_day', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'd', to_char(day, 'YYYY-MM-DD'),
               'pr', coalesce(c.pr, 0), 'vs', coalesce(c.vs, 0),
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
    ),

    -- ── EMAIL USE vs the Apps Script daily ceiling ──────────────────────
    -- Nothing records a send: notify.js fires callGAS(...).catch(() => {}),
    -- so a failure reaches a browser console nobody reads. This DERIVES the
    -- count instead, and the derivation is only sound because of how the
    -- fan-out is written -- notifyUniStaff() creates one in-app row PER
    -- staff-seat holder and sends exactly ONE email, in the same call:
    --
    --     emails  =  rows to staff-seat holders / number of holders
    --
    -- ⚠️ It is an ESTIMATE, and `in_app_enabled` is what makes it one. The
    -- in-app row and the email are gated SEPARATELY in notify.js. Turn
    -- notify_uni_in_app off and no rows are written while mail keeps going
    -- out -- this would then read zero while sending. The UI must say so
    -- rather than present a confident number. `quota_per_day` is Apps
    -- Script's consumer-account ceiling; a Google Workspace account is 1500.
    'email', (
      with holders as (
        select id from public.users
         where role = 'uni_staff'
            or 'staff' = any (coalesce(managed_project_seats, '{}'))
      ),
      hn as (select greatest(count(*), 1)::numeric as c from holders),
      s as (select project_settings.* from public.project_settings limit 1),
      -- NOT `as d`: the enclosing plpgsql function already declares a
      -- variable `d` (the clamped range), and Postgres refuses the whole
      -- statement with "column reference d is ambiguous" at RUN time, not at
      -- CREATE time — so it deploys clean and fails on first call. Caught on
      -- samo-dev before production, which is what the dev database is for.
      by_day as (
        select day::date as sent_on,
               ceil(count(p.id) / (select c from hn))::int as n
          from generate_series((since)::date, (now())::date, interval '1 day') as day
          left join public.project_notifications p
                 on p.created_at::date = day::date
                and p.user_id in (select id from holders)
         group by 1
      ),
      -- BURST. The daily ceiling is not the only one that can be hit: Apps
      -- Script also caps SIMULTANEOUS executions per user at 30, and a single
      -- message at 50 recipients. A day well inside 100 can still fail if it
      -- arrives all at once -- and the email path, unlike the Discord path, is
      -- NOT serialised (notify.js calls callGAS directly, while Discord goes
      -- through queueDiscord). So measure the shape of the traffic, not only
      -- its volume.
      sends as (
        select p.created_at
          from public.project_notifications p
         where p.user_id in (select id from holders)
           and p.created_at > since
      ),
      burst as (
        select
          (select coalesce(max(c), 0) from (
             select ceil(count(*) / (select c from hn))::int c
               from sends group by date_trunc('minute', created_at)) a) as per_minute,
          (select coalesce(max(c), 0) from (
             select ceil(count(*) / (select c from hn))::int c
               from sends group by date_trunc('hour', created_at)) b) as per_hour,
          -- The tightest observed gap: how close two sends have ever come.
          (select round(min(gap)::numeric, 1) from (
             select extract(epoch from created_at
                    - lag(created_at) over (order by created_at)) as gap
               from sends) g where gap is not null and gap > 0) as min_gap_seconds
      )
      select jsonb_build_object(
        'quota_per_day',   100,
        'staff_holders',   (select count(*) from holders),
        -- The quota counts RECIPIENTS, not messages: two addresses in the box
        -- cost two. Empty/unset counts as zero, which correctly yields no use.
        'recipients',      (select coalesce(array_length(array_remove(string_to_array(
                              regexp_replace(coalesce(uni_staff_email, ''), '[;[:space:]]+', ',', 'g'),
                              ','), ''), 1), 0) from s),
        'enabled',         (select coalesce(notify_uni_email, true) from s),
        'in_app_enabled',  (select coalesce(notify_uni_in_app, true) from s),
        -- Apps Script's OTHER ceilings, so the UI never hardcodes a number
        -- that changes when the sending account changes tier.
        'simultaneous_limit',  30,
        'recipients_per_message_limit', 50,
        'peak_per_minute', (select per_minute from burst),
        'peak_per_hour',   (select per_hour from burst),
        'min_gap_seconds', (select min_gap_seconds from burst),
        'sent_total',      (select coalesce(sum(n), 0) from by_day),
        'peak_day',        (select coalesce(max(n), 0) from by_day),
        'sent_by_day',     (select coalesce(jsonb_agg(jsonb_build_object(
                              'd', to_char(sent_on, 'YYYY-MM-DD'), 'n', n) order by sent_on), '[]'::jsonb)
                            from by_day)
      )
    )
  ) into result;

  return result;
end;
$function$;


comment on function public.analytics_overview(integer) is
  'Admin สถิติ payload. The `email` block estimates Apps Script mail use from the notification fan-out — daily volume against the 100/day ceiling (0170) and BURST against the 30-simultaneous and 50-recipients-per-message ceilings (0171). Reads low if notify_uni_in_app is off or nobody holds the staff seat; in_app_enabled and staff_holders ship so the UI can say so.';
