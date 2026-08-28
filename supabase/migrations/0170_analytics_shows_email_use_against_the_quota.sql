-- 0170 — สถิติ shows email use against the Apps Script daily ceiling
--
-- WHY. The owner asked "is 100/day enough, and have we ever hit it?" and the
-- honest answer was that NOBODY COULD KNOW: the send is fire-and-forget
-- (`callGAS(...).catch(() => {})` in src/js/projects/notify.js), so a refusal
-- lands in a browser console nobody reads. A ceiling you cannot see yourself
-- approaching is the same shape as a guard that fails green.
--
-- Measured before writing this (2026-08-28): 95 emails in 72 days, busiest day
-- 7, zero duplicate sends. The ceiling is 100. So the answer is that 100 is
-- ~14x the worst day ever and Apps Script stays exactly as it is — but that was
-- an answer nobody could have given from the app, which is what this fixes.
--
-- HOW IT IS COUNTED, and why it is an ESTIMATE. Nothing logs a send, so the
-- number is derived from the shape of the fan-out: notifyUniStaff() creates one
-- in-app row PER staff-seat holder and sends exactly ONE email, in the same
-- call. So emails = rows-to-holders / holders. Today one person holds the seat,
-- which makes it exact.
--
-- ⚠️ The estimate has ONE failure mode and the payload names it. In notify.js
-- the in-app row and the email are gated SEPARATELY:
--
--     if (settings?.notify_uni_in_app !== false) { ...createNotification... }
--     if (settings?.notify_uni_email  !== false && to) { ...callGAS... }
--
-- Turn the in-app half off and no rows are written while mail keeps going out —
-- the count would read ZERO while sending, the most dangerous way to be wrong.
-- `in_app_enabled` therefore ships in the payload so the UI can say "this
-- number is not trustworthy right now" instead of showing a confident zero.
-- `analytics-email.test.js` pins that the UI actually honours it.
--
-- Recipients, not messages: the Apps Script quota counts RECIPIENTS, so two
-- addresses in uni_staff_email cost two per send. Both numbers ship.
--
-- 100 is the CONSUMER-account ceiling. A Google Workspace account is 1500 —
-- see docs/EMAIL.md. mdstuddata.beta@gmail.com is a consumer account.
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
  'Admin สถิติ payload. The `email` block ESTIMATES Apps Script mail use from the notification fan-out (one email per staff-seat holder row); it reads zero if notify_uni_in_app is off while notify_uni_email is on, which is why in_app_enabled ships alongside it. See 0170.';
