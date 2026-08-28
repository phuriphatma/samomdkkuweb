-- 0172 — Apps Script is a SHARED budget; show all of its traffic, not just email
--
-- WHY. 0170/0171 measured the email path. The owner pointed out what that
-- misses: "there're many components like photo upload etc samoweb samopassport
-- ระบบจองห้องสโม also use the same gas".
--
-- That is the important correction, and it changes what the ceiling means.
-- **Apps Script quotas are PER GOOGLE ACCOUNT, not per script.** PR photo
-- uploads, หนังสือโครงการ files, shop slips, SAMO Passport and the notification
-- email all draw on ONE budget:
--
--   simultaneous executions per user   30
--   email recipients per day           100  (consumer) / 1,500 (Workspace)
--   email recipients per message       50
--   script runtime                     6 min / execution
--
-- So a quiet email month says nothing about whether uploads are near the edge,
-- and the email panel alone was answering a smaller question than the one that
-- matters.
--
-- WHAT IT FOUND. 262 countable calls, and one genuine spike: **25 in a single
-- minute** on 2026-05-22 11:07 — twenty-five DISTINCT timestamps, so
-- twenty-five separate calls, not one bulk insert. That is 83% of the
-- 30-simultaneous ceiling. Every other minute on record is 2 or fewer.
--
-- ⚠️ AND THE UPLOAD PATH IS NOT SERIALISED EITHER. Discord goes through
-- `queueDiscord` — one global chain, deliberately spaced. Uploads and email
-- call `callGAS` directly, right beside it. Nothing spaces them, which is how
-- 25 in a minute happened at all.
--
-- ⚠️ THE NUMBER IS A FLOOR, NOT A TOTAL. Only calls that leave a row can be
-- counted. Invisible: every delete, the folder/file READS, photo uploads that
-- overwrite a column with no per-upload timestamp, any component outside this
-- database, and every call that FAILED — which is exactly the traffic you would
-- most want to see. `is_floor` ships in the payload so the UI says so rather
-- than implying a complete count.
--
-- The all-time worst minute ships alongside the in-range one on purpose: the
-- spike above is outside a 30-day window, and a range that hides it would
-- report "nothing to see" about the one event proving the ceiling is reachable.
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

    -- ── ALL Apps Script traffic, not just email ─────────────────────────
    -- Every component shares ONE Google account: PR photo uploads,
    -- หนังสือโครงการ files, shop slips, SAMO Passport, and the email above.
    -- Apps Script's ceilings are PER USER, so they are a shared budget — a
    -- quiet email month says nothing about whether uploads are near the edge.
    --
    -- ⚠️ THIS IS A FLOOR, NOT A TOTAL, and the UI must say so. Only calls that
    -- LEAVE A ROW can be counted. Invisible here: every delete, the folder and
    -- file READS (getProjectFolderInfo / getProjectFileData), photo uploads
    -- that overwrite a column with no per-upload timestamp, anything from a
    -- component outside this database, and every call that FAILED — which is
    -- precisely the traffic you would most want to see.
    --
    -- Measured 2026-08-28: 262 countable calls, and one real spike of 25 in a
    -- single minute (2026-05-22 11:07, twenty-five DISTINCT timestamps, so
    -- twenty-five separate calls, not one bulk insert). Against a limit of 30
    -- simultaneous that is 83%. Everything else is 2 or fewer per minute. The
    -- shape is possible, which is the whole reason to show it.
    'gas', (
      with calls as (
        select created_at as t, 'อัปโหลด PR' as src
          from public.pr_tickets where file_url is not null
        union all
        select uploaded_at, 'ไฟล์หนังสือโครงการ' from public.project_files
        union all
        select slip_uploaded_at, 'สลิปร้านค้า'
          from public.shop_orders where slip_uploaded_at is not null
        union all
        select created_at, 'SAMO Passport'
          from passport.activities where badge_url is not null
        union all
        select created_at, 'SAMO Passport'
          from passport.certificates where background_url is not null
      ),
      inrange as (select * from calls where t > since),
      peaks as (
        select
          (select coalesce(max(c),0) from (select count(*) c from inrange group by t::date) a) as per_day,
          (select coalesce(max(c),0) from (select count(*) c from inrange group by date_trunc('hour',t)) b) as per_hour,
          (select coalesce(max(c),0) from (select count(*) c from inrange group by date_trunc('minute',t)) c1) as per_minute,
          -- ALL TIME, deliberately: the worst minute is usually outside a
          -- 30-day window, and a range that hides it reports "nothing to see"
          -- about the one event that proves the ceiling is reachable.
          (select coalesce(max(c),0) from (select count(*) c from calls group by date_trunc('minute',t)) d) as per_minute_ever,
          (select to_char(date_trunc('minute',t),'YYYY-MM-DD HH24:MI') from calls
            group by date_trunc('minute',t) order by count(*) desc, 1 desc limit 1) as busiest_minute_at
      )
      select jsonb_build_object(
        'simultaneous_limit', 30,
        'is_floor',           true,
        'total',              (select count(*) from inrange),
        'peak_per_day',       (select per_day from peaks),
        'peak_per_hour',      (select per_hour from peaks),
        'peak_per_minute',    (select per_minute from peaks),
        'peak_per_minute_ever', (select per_minute_ever from peaks),
        'busiest_minute_at',  (select busiest_minute_at from peaks),
        'by_source', (select coalesce(jsonb_agg(jsonb_build_object('label', src, 'n', n) order by n desc), '[]'::jsonb)
                      from (select src, count(*) n from inrange group by 1) s),
        'by_day', (select coalesce(jsonb_agg(jsonb_build_object(
                     'd', to_char(day,'YYYY-MM-DD'), 'n', coalesce(c.n,0)) order by day), '[]'::jsonb)
                   from generate_series((since)::date,(now())::date, interval '1 day') as day
                   left join (select t::date dd, count(*) n from inrange group by 1) c on c.dd = day::date)
      )
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
  'Admin สถิติ payload. `email` estimates mail use against the 100/day and burst ceilings (0170, 0171). `gas` counts ALL Apps Script traffic — uploads across samoweb and Passport plus email — because the quotas are per GOOGLE ACCOUNT and every component shares them (0172). Both are FLOORS: only calls that leave a row are visible, so deletes, reads and FAILURES are not counted. is_floor / in_app_enabled / staff_holders ship so the UI can say so.';
