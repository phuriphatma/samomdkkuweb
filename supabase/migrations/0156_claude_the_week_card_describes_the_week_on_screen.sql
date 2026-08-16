-- ============================================================
-- 0156 — the week card must describe the week ON SCREEN.
--
-- Reported: *"in next next week, it still show ใช้ไปแล้วจริง value, which it
-- would be reset by then"*. Browse two weeks ahead and the card still read
-- "287 / 700% ใช้ไปแล้วจริงสัปดาห์นี้" — a measurement of a pool that will have
-- reset twice before that week begins.
--
-- The cause is that 0155 gave the card `right_now`, which is a fact about NOW
-- and correct only when NOW is inside the week being drawn. Two different
-- scopes wearing one payload: the hero panel is about this instant, the card is
-- about whichever week the arrows landed on, and they were reading the same
-- numbers.
--
-- So the board's `week` object grows the three fields the card actually needs,
-- every one of them scoped to `[v_wk_start, v_wk_end)`:
--
--   measured_used_pct — the newest reading INSIDE that week. For the current
--                       week this is today's sample; for a past week it is
--                       where that week finished; for a future week there are
--                       no samples and it is NULL, which is the honest answer
--                       and the one the card falls back on.
--   reserved_pct      — bookings in that week not yet finished. A past week
--                       reserves nothing; a future week reserves all of it.
--   is_current        — so the panels that genuinely mean "now" can say so
--                       instead of being silently reinterpreted.
--
-- NULL IS THE POINT. A future week returning 0 would draw an empty bar and read
-- as "nothing used yet", which is indistinguishable from a real reading and is
-- exactly the bug being fixed. It returns nothing, and the card says what it
-- knows: what has been booked.
--
-- ADDITIVE ONLY — no column, no policy, no signature change. The served bundle
-- keeps working until the new one is deployed.
-- ============================================================

create or replace function public.get_claude_board(p_at timestamptz default now())
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_uid      uuid := auth.uid();
  s          public.claude_settings%rowtype;
  v_wk_start timestamptz;
  v_wk_end   timestamptz;
  v_now      timestamptz := now();
  v_books    jsonb := '[]'::jsonb;
  v_sess     jsonb := '[]'::jsonb;
  v_week_pct int;
  v_reserved int;
  v_meas     numeric;
  b          record;
  cs         record;
  v_sample   public.claude_usage_samples%rowtype;
begin
  if v_uid is null or not public.current_user_has_permission('claude') then
    raise exception 'get_claude_board: ไม่มีสิทธิ์เข้าถึงระบบจองโควตา Claude';
  end if;

  select * into s from public.claude_settings where id;
  v_wk_start := public.claude_week_start(p_at);
  v_wk_end   := v_wk_start + interval '7 days';

  for b in
    select * from public.claude_bookings
     where starts_at >= v_wk_start and starts_at < v_wk_end
     order by starts_at
  loop
    v_books := v_books || jsonb_build_object(
      'id',        b.id,
      'starts_at', b.starts_at,
      'ends_at',   b.ends_at,
      'pct',       b.pct,
      'purpose',   b.purpose,
      'is_mine',   (b.user_id = v_uid),
      'person',    public.claude_person(b.user_id)
    );
  end loop;

  for cs in select * from public.claude_sessions(v_wk_start, v_wk_end) loop
    v_sess := v_sess || jsonb_build_object(
      'starts_at',   cs.session_start,
      'ends_at',     cs.session_end,
      'used_pct',    cs.used_pct,
      'booking_ids', to_jsonb(cs.booking_ids)
    );
  end loop;

  select coalesce(sum(pct), 0) into v_week_pct
    from public.claude_bookings
   where starts_at >= v_wk_start and starts_at < v_wk_end;

  -- Still promised, in THIS week. A finished block is not a reservation — its
  -- consumption is in the measurement already, and counting it in both places
  -- charges the week twice.
  select coalesce(sum(pct), 0) into v_reserved
    from public.claude_bookings
   where starts_at >= v_wk_start and starts_at < v_wk_end
     and ends_at > v_now;

  -- The newest reading INSIDE the week being drawn. Not the newest reading full
  -- stop — that is what made a future week report today's usage.
  select seven_day_pct into v_meas
    from public.claude_usage_samples
   where sampled_at >= v_wk_start and sampled_at < v_wk_end
     and seven_day_pct is not null
   order by sampled_at desc limit 1;

  -- The live gauges stay global on purpose: they are the two real windows as
  -- they stand right now, with their real reset instants, and they belong to
  -- the panel that says "ตอนนี้".
  select * into v_sample from public.claude_usage_samples
   order by sampled_at desc limit 1;

  return jsonb_build_object(
    'week', jsonb_build_object(
      'starts_at',  v_wk_start,
      'ends_at',    v_wk_end,
      'pool_pct',   s.week_pool_pct,
      'used_pct',   v_week_pct,          -- BOOKED, as before
      'is_current', (v_now >= v_wk_start and v_now < v_wk_end),
      -- MEASURED, for this week only. NULL where nothing was measured, so a
      -- future week cannot draw a zero that reads as a reading.
      'measured_used_pct', case when v_meas is null then null
                                else round(v_meas * s.week_pool_pct / 100.0, 1) end,
      'measured_left_pct', case when v_meas is null then null
                                else round((100 - v_meas) * s.week_pool_pct / 100.0, 1) end,
      'reserved_pct', v_reserved
    ),
    'settings', jsonb_build_object(
      'session_pool_pct', s.session_pool_pct,
      'session_minutes',  s.session_minutes,
      'week_pool_pct',    s.week_pool_pct,
      'reset_tz',         s.week_reset_tz,
      'plan_label',       s.plan_label
    ),
    'me',          public.claude_person(v_uid),
    'right_now',   public.claude_free_now(),
    'free_windows', public.claude_free_windows(p_at),
    'bookings',    v_books,
    'sessions',    v_sess,
    'measured', case when v_sample.id is null then null else jsonb_build_object(
      'sampled_at',          v_sample.sampled_at,
      'five_hour_pct',       v_sample.five_hour_pct,
      'five_hour_resets_at', v_sample.five_hour_resets_at,
      'seven_day_pct',       v_sample.seven_day_pct,
      'seven_day_resets_at', v_sample.seven_day_resets_at
    ) end
  );
end $$;

revoke all on function public.get_claude_board(timestamptz) from public;
revoke all on function public.get_claude_board(timestamptz) from anon;
grant execute on function public.get_claude_board(timestamptz) to authenticated;
