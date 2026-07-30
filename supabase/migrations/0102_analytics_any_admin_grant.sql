-- 0102 — สถิติการใช้งาน is visible to every admin-dashboard user, not just staff.
--
-- Symptom: 'โหลดสถิติไม่สำเร็จ — {"code":"P0001",...,"message":"analytics_overview:
-- staff only"}' for a ทีม SAMO grantee (role='user'). The sidebar offers the
-- section to them (SIDE_FEATURE.analytics = null = no permission required) and the
-- RPC then rejected them.
--
-- This is the SAME class 0093 fixed for the analytics_events TABLE read and the
-- entry in mistakes.md warns about: a permission channel has to be threaded
-- through every surface — writes, reads, audience lookups AND definer RPCs. 0093
-- repointed the table policy to current_user_has_any_grant() and left this
-- function on current_user_is_staff(), so the two disagreed.
--
-- current_user_has_any_grant() = staff OR any non-empty permissions /
-- managed_permissions / managed_vs_depts / managed_project_seats /
-- managed_passport_scopes. Deliberately the SAME predicate as the table policy so
-- the two cannot drift again. Note it is marginally WIDER than the frontend's
-- canUseAdmin() (a passport-only grantee passes here but cannot reach the admin
-- shell, since 'passport' is not in ADMIN_FEATURES) — accepted, because matching
-- the table policy matters more than shaving that case, and the payload is
-- aggregate usage counts, not personal data.
--
-- NOT widening current_user_is_staff() itself: users_self_update_guard trusts it
-- for privileged-column writes, so widening it would let any grantee self-promote
-- to dev. Repoint callers individually — see STATE.md.
--
-- BASED ON THE LIVE BODY (pg_get_functiondef), not on 0065/0066/0067 — all three
-- define this function and the newest wins; copying an older file's body would
-- silently revert the later ones (mistakes.md).

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
    )
  ) into result;

  return result;
end;
$function$
;

grant execute on function public.analytics_overview(integer) to authenticated;
