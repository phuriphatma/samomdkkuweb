-- 0173 — "are there really 25 PR uploads in 60 seconds?" — no, and here is why
--
-- The owner asked that about 0172's headline number. They were right to. It was
-- wrong on TWO independent counts, and the corrected answer is the opposite of
-- alarming.
--
-- ERROR 1 — `file_url is not null` is not "has an upload". That column also
-- holds sentinels and pasted links:
--
--     REAL uploaded file (drive.../file/d/)   98
--     (null)                                  61
--     'ลิงก์เสริม: <url>'  pasted, no upload   50
--     'ไม่มีไฟล์แนบ'       no attachment        9
--
-- 157 counted where 98 were real. This is the repo's own recurring shape: a
-- SENTINEL treated as a value. `null` was handled; 'ไม่มีไฟล์แนบ' was not.
--
-- ERROR 2 — the spike was a data import, not traffic. Those rows landed within
-- 2.86 SECONDS at ~65 ms apart: the Sheets→Supabase migration writing straight
-- to Postgres, for files that were ALREADY in Drive. Not one Apps Script call
-- occurred. A timestamp records when a ROW was written, which is not when work
-- was done — and nothing in a count distinguishes them.
--
-- THE FIX. Count only real uploaded files, and drop rows arriving < 1 s after
-- the previous one — no human submits two forms 65 ms apart, and that spacing
-- is the signature of a bulk write. What was dropped ships as `excluded_bulk`,
-- because an exclusion nobody can see is how a number quietly becomes a lie.
--
-- CORRECTED: 194 real calls, busiest minute **2**, against a limit of 30
-- simultaneous — 7%. 0172 reported 83% and would have had someone re-architect
-- a system that is nowhere near its ceiling.
--
-- THE GENERAL RULE: a derived metric is a claim about the world, and it must be
-- checked against the ROWS before anyone is shown it. Both errors survived
-- writing, review and a green test suite; neither survived `select … limit 26`.
--
-- ⚠️ KNOWN LIMITATION, recorded now rather than discovered later. The `gas`
-- block reads `passport.activities` and `passport.certificates` directly,
-- because Passport shares the same Google account and therefore the same quota.
-- A plpgsql body is NOT resolved at CREATE time, so this migration applies
-- cleanly on a database with NO `passport` schema and then fails AT RUNTIME the
-- first time สถิติ is opened — the worst shape, because the break is far from
-- the change. Production and samo-dev both have the schema, so this affects
-- only a NEW environment (a scratch project, a partial restore). If it ever
-- bites, wrap the two passport arms in a
-- `to_regclass('passport.activities') is not null` guard rather than deleting
-- them: Passport traffic is real, and counting it is the whole point of 0172.
--
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
    -- Every component shares ONE Google account — PR uploads, หนังสือโครงการ
    -- files, shop slips, SAMO Passport, the email above — and Apps Script's
    -- ceilings are PER USER, so it is one budget.
    --
    -- ⚠️ TWO CORRECTIONS, both prompted by the owner asking "are there really
    -- 25 PR uploads in 60 seconds?". There were not:
    --
    --  1. `file_url is not null` IS NOT "has an upload". The column also holds
    --     the sentinel 'ไม่มีไฟล์แนบ' (no attachment, 9 rows) and
    --     'ลิงก์เสริม: <url>' — a link the submitter PASTED, where no upload
    --     happened (50 rows). That inflated 98 real uploads to 157. Only
    --     'https://drive.google.com/file/d/%' is an uploaded file.
    --
    --  2. THE SPIKE WAS AN IMPORT. Those rows landed within 2.86 SECONDS at
    --     ~65 ms apart — the Sheets→Supabase migration writing straight to
    --     Postgres for files ALREADY in Drive. No Apps Script call happened.
    --
    -- So rows arriving < 1 s after the previous are dropped: no human submits
    -- two forms 65 ms apart, and that spacing is the signature of a bulk write.
    -- What was dropped ships as `excluded_bulk` — an exclusion nobody can see
    -- is how a number quietly becomes a lie.
    --
    -- CORRECTED: 194 real calls, busiest minute 2, against 30 simultaneous —
    -- 7%. The previous version reported 83%.
    --
    -- ⚠️ STILL A FLOOR: deletes, folder/file READS, photo overwrites with no
    -- per-upload timestamp, components outside this database, and every FAILED
    -- call leave no row. `is_floor` ships so the UI says so. The full action
    -- list lives in GAS_ACTIONS in analytics-dashboard.js, mirrored against
    -- appscript/prform.gs by a test.
    'gas', (
      with calls as (
        select created_at as t, 'อัปโหลด PR' as src
          from public.pr_tickets
         where file_url like 'https://drive.google.com/file/d/%'
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
      paced as (
        select t, src, extract(epoch from (t - lag(t) over (order by t))) as gap
          from calls
      ),
      human as (select t, src from paced where gap is null or gap >= 1),
      inrange as (select * from human where t > since),
      peaks as (
        select
          (select coalesce(max(c),0) from (select count(*) c from inrange group by t::date) a) as per_day,
          (select coalesce(max(c),0) from (select count(*) c from inrange group by date_trunc('hour',t)) b) as per_hour,
          (select coalesce(max(c),0) from (select count(*) c from inrange group by date_trunc('minute',t)) c1) as per_minute,
          (select coalesce(max(c),0) from (select count(*) c from human group by date_trunc('minute',t)) d) as per_minute_ever,
          (select to_char(date_trunc('minute',t),'YYYY-MM-DD HH24:MI') from human
            group by date_trunc('minute',t) order by count(*) desc, 1 desc limit 1) as busiest_minute_at
      )
      select jsonb_build_object(
        'simultaneous_limit', 30,
        'is_floor',           true,
        'total',              (select count(*) from inrange),
        'excluded_bulk',      (select count(*) from paced where gap < 1),
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
  'Admin สถิติ payload. `email` estimates mail against the daily and burst ceilings (0170, 0171). `gas` counts ALL Apps Script traffic — quotas are per GOOGLE ACCOUNT and every component shares them (0172) — counting only REAL uploaded files and dropping bulk-import writes (0173). Both are FLOORS: deletes, reads and FAILURES leave no row.';
