-- ============================================================
-- 0162 — "ใช้จริง" stops drawing the READING and starts drawing the USE.
--
-- ASKED FOR, with worked examples: *"there's people book at 16.00-19.00. If
-- like actual people use at 10.07, your last detect at 10.00 found nothing,
-- 10.15 found 3% … you can see when it begins, when will it reset, so it'll
-- show reset session 5hr at 15.07, you can calculate back and show it as
-- 10.07-10.15 as 3% instead."*
--
-- ── WHY THE OLD DRAWING COULD NOT ANSWER THIS ────────────────────────────
-- The overlay drew one bar per 15-minute sample whose WIDTH was the CUMULATIVE
-- five-hour reading. Read top to bottom that is the integral: a staircase that
-- climbs to 97% and sawtooths back. It answers "what did the gauge say at
-- 12:15", which nobody asks, and it was already reported once as unreadable
-- ("i don't understand ใช้จริง overlay that shows 93% 97% etc").
--
-- What people ask is the DERIVATIVE: **when was it actually being used, and how
-- much went in then.** Which is what this computes.
--
-- ── THE INSIGHT, AND IT IS MEASURED, NOT ASSUMED ─────────────────────────
-- `five_hour.resets_at` comes back on every poll, so `resets_at − 5h` is the
-- instant the window OPENED — i.e. the first message. That is strictly better
-- than any sampling rate, because it is not a sample at all. Verified against
-- the live table:
--
--   sampled   five_hour_pct  resets_at   ⇒ window opened
--   09:35:46      0.00       (none)
--   09:50:46      0.00       14:40:00        09:40   ← open, 0% spent yet
--   10:05:47     14.00       14:39:59        09:40
--
-- Two things fall out of that row at 09:50, and both matter:
--   • `resets_at` appears BEFORE any percentage does, so a window's start is
--     known at least one poll before its first measurable use;
--   • the value wobbles ±1s between polls (14:39:59 / 14:40:00) because the API
--     returns `now + seconds_remaining`. So the window is identified by
--     `resets_at` ROUNDED TO THE MINUTE, never by equality.
--
-- ⚠️ **Precision honestly stated: four windows have been observed and their
-- starts were 23:30, 09:40, 15:00, 20:00 — every one a multiple of ten
-- minutes.** That is too few to tell a true first-message instant from a value
-- Anthropic buckets. Nothing here depends on which it is (the instant is used
-- as given), but do not promise the owner minute-accuracy in UI copy until more
-- windows have been seen.
--
-- ── THE RULE, IN ONE LINE ────────────────────────────────────────────────
-- For consecutive polls `prev → cur`, any rise in the reading was spent in
-- `(prev, cur]` — and if `cur` belongs to a window that opened AFTER `prev`, it
-- was spent in `(window_start, cur]`, because it could not have been spent
-- before the window existed. **That clamp is the whole feature**: it is what
-- turns "10:00–10:15" into "10:07–10:15", and it costs nothing.
--
-- Consecutive rises merge into a RUN. A poll with no rise ends the run. This
-- reproduces every case in the request:
--
--   10:00 —, 10:15 3%             → run 10:07–10:15  +3%   (start clamped)
--   10:30 7%                      → run 10:07–10:30  +7%   (merged)
--   10:45 7%, no change           → run closes at 10:30
--   11:00 10%                     → run 10:45–11:00  +3%   (second run)
--
-- ── THE THIRD STATE NOBODY ASKED FOR AND THE DRAWING NEEDS ───────────────
-- "used" and "idle" are not enough. When the reporter is DOWN, the next poll
-- shows a rise that could have happened anywhere in the gap. Measured: the
-- window of 15 Aug 23:30 was first polled at 16 Aug 01:04 and already read 75%.
-- Drawing 23:30→01:04 as a run at 75% states a time we do not know; drawing
-- nothing states it was idle, which is worse. So a gap wider than
-- `v_gap_limit` emits `kind = 'unknown'` and the UI hatches it.
--
-- ── WHAT ELSE THIS FIXES, UNASKED ────────────────────────────────────────
-- `windows` was grouped by "wherever five_hour_pct DROPS". Two adjacent windows
-- whose second first-reads HIGHER than the first last-read (previous ends 20%,
-- next is first polled at 35%) produce no drop and were silently merged into
-- one 10-hour "window". `resets_at` is the identity and it was already in the
-- row. Windows now carry their true `starts_at`/`resets_at` and a `partial`
-- flag for the ones we joined late.
-- ============================================================

-- ------------------------------------------------------------
-- §1 — The runs.
--
-- A LOOP and not a window-function chain, deliberately: the state that decides
-- a boundary is three-way (same window / new window / no data) and each branch
-- computes a different left edge. Expressed as `case` inside a `sum() over ()`
-- it is unreadable, and this is the arithmetic the whole overlay rests on.
-- A week is ~672 rows.
-- ------------------------------------------------------------
create or replace function public.claude_usage_runs(
  p_from timestamptz,
  p_to   timestamptz
)
returns table (
  run_from    timestamptz,
  run_to      timestamptz,
  pct         numeric,     -- session-% spent in this run
  kind        text,        -- 'used' | 'unknown'
  win_start   timestamptz, -- the 5-hour window it belongs to, or null
  win_reset   timestamptz,
  exact_start boolean,     -- is run_from the window's own opening instant?
  open_ended  boolean      -- still the newest sample, so it may be continuing
)
language plpgsql stable security definer set search_path = public as $$
declare
  -- 2.5× the nominal 15-minute cadence. Below this a gap is one missed poll and
  -- the rise is still attributable to a narrow span; above it, it is not.
  v_gap_limit constant interval := interval '40 minutes';
  r           record;
  v_prev_at   timestamptz;
  v_prev_pct  numeric;
  v_prev_key  timestamptz;
  v_last_at   timestamptz;
  -- the run being accumulated
  v_from      timestamptz;
  v_to        timestamptz;
  v_sum       numeric := 0;
  v_ws        timestamptz;
  v_wr        timestamptz;
  v_exact     boolean := false;   -- of the RUN
  v_span_from timestamptz;
  v_span_exact boolean;           -- of the SPAN being folded in
  v_delta     numeric;
  v_new_win   boolean;
  v_open      timestamptz;
begin
  select max(sampled_at) into v_last_at
    from public.claude_usage_samples
   where sampled_at >= p_from and sampled_at < p_to;

  for r in
    -- ONE SAMPLE BEFORE THE RANGE, on purpose. Without it the first poll of the
    -- week has no predecessor, so the first rise of the week is dropped and the
    -- week appears to start idle. The extra row is never emitted as a run of
    -- its own; it only supplies `prev`.
    (select sampled_at, coalesce(five_hour_pct, 0) as pct,
            date_trunc('minute', five_hour_resets_at + interval '30 seconds') as win_key,
            five_hour_resets_at
       from public.claude_usage_samples
      where sampled_at < p_from
      order by sampled_at desc limit 1)
    union all
    (select sampled_at, coalesce(five_hour_pct, 0),
            date_trunc('minute', five_hour_resets_at + interval '30 seconds'),
            five_hour_resets_at
       from public.claude_usage_samples
      where sampled_at >= p_from and sampled_at < p_to)
    order by 1
  loop
    if v_prev_at is null then
      v_prev_at := r.sampled_at; v_prev_pct := r.pct; v_prev_key := r.win_key;
      continue;
    end if;

    v_new_win := r.win_key is distinct from v_prev_key;
    -- Across a window boundary the new window's reading starts from zero, so
    -- the rise IS the reading. Within one window it is the difference. Never
    -- negative: an early reset by Anthropic changes `resets_at`, so it lands in
    -- the first branch, and anything else negative is a reading we do not
    -- believe and must not draw.
    v_delta := case when v_new_win then r.pct else greatest(0, r.pct - v_prev_pct) end;

    if r.sampled_at - v_prev_at > v_gap_limit then
      -- ── the reporter was down. Close whatever was open, then say so. ──
      if v_from is not null then
        run_from := v_from; run_to := v_to; pct := v_sum; kind := 'used';
        win_start := v_ws; win_reset := v_wr; exact_start := v_exact;
        open_ended := false;
        return next;
        v_from := null; v_sum := 0;
      end if;
      if v_delta > 0 then
        run_from := v_prev_at; run_to := r.sampled_at; pct := v_delta;
        kind := 'unknown';
        win_start := case when r.win_key is not null
                          then r.win_key - interval '5 hours' end;
        win_reset := r.win_key;
        exact_start := false; open_ended := false;
        return next;
      end if;

    elsif v_delta > 0 then
      -- ── THE CLAMP. It could not have been spent before the window opened. ──
      --
      -- `win_key` and NOT the raw `five_hour_resets_at`: the API returns
      -- `now + seconds_remaining`, so the same window comes back as 14:39:59 on
      -- one poll and 14:40:00 on the next. Clamping to the raw value drew the
      -- run starting at 14:59:59 — a second of jitter, rendered as a time.
      -- win_key is that value rounded to the minute, which is stable.
      v_span_from  := v_prev_at;
      v_span_exact := false;
      if v_new_win and r.win_key is not null then
        v_open := r.win_key - interval '5 hours';
        if v_open > v_span_from then
          v_span_from  := v_open;
          v_span_exact := true;   -- this edge is the first message, not a poll
        end if;
      end if;

      -- Contiguous with the run being accumulated? Only if it is the SAME
      -- window and starts exactly where that run stopped. A new window always
      -- begins a new run even when the polls are adjacent, because the two
      -- halves are drawn from different pots and one total would describe
      -- neither.
      if v_from is not null and not v_new_win and v_span_from <= v_to then
        v_to  := r.sampled_at;
        v_sum := v_sum + v_delta;
        -- v_exact belongs to the RUN's left edge, which was fixed when the run
        -- opened. Folding a later span in must not touch it — assigning the
        -- span's own exactness here cleared the flag on every run longer than
        -- one poll, i.e. on all of them.
      else
        if v_from is not null then
          run_from := v_from; run_to := v_to; pct := v_sum; kind := 'used';
          win_start := v_ws; win_reset := v_wr; exact_start := v_exact;
          open_ended := false;
          return next;
        end if;
        v_from  := v_span_from; v_to := r.sampled_at; v_sum := v_delta;
        v_exact := v_span_exact;
        v_ws    := case when r.win_key is not null
                        then r.win_key - interval '5 hours' end;
        v_wr    := r.win_key;
      end if;

    else
      -- ── no rise: the run, if any, ended at the previous poll. ──
      if v_from is not null then
        run_from := v_from; run_to := v_to; pct := v_sum; kind := 'used';
        win_start := v_ws; win_reset := v_wr; exact_start := v_exact;
        open_ended := false;
        return next;
        v_from := null; v_sum := 0;
      end if;
    end if;

    v_prev_at := r.sampled_at; v_prev_pct := r.pct; v_prev_key := r.win_key;
  end loop;

  -- A run still open at the newest sample may be continuing right now, and
  -- saying so is the difference between "they stopped at 16:51" and "16:51 is
  -- just when we last looked".
  if v_from is not null then
    run_from := v_from; run_to := v_to; pct := v_sum; kind := 'used';
    win_start := v_ws; win_reset := v_wr; exact_start := v_exact;
    open_ended := (v_to = v_last_at);
    return next;
  end if;
  return;
end $$;

revoke all on function public.claude_usage_runs(timestamptz, timestamptz) from public;
revoke all on function public.claude_usage_runs(timestamptz, timestamptz) from anon;
revoke all on function public.claude_usage_runs(timestamptz, timestamptz) from authenticated;

comment on function public.claude_usage_runs(timestamptz, timestamptz) is
  'When Claude was actually being used, and how much went in. A rise between '
  'two polls is spent in (prev, cur], clamped to the window opening instant '
  'derived from five_hour.resets_at − 5h. Gaps wider than 40 min are unknown.';

-- ------------------------------------------------------------
-- §2 — The observed windows, keyed on what actually identifies them.
--
-- `resets_at` rounded to the minute IS the window. Grouping on "the reading
-- dropped" merges two windows whenever the second is first polled above where
-- the first ended, which is an ordinary thing for it to do.
--
-- `partial` says we joined this window after it had already been used, so its
-- early history is unattributable — the 15 Aug 23:30 window, first polled at
-- 01:04 already at 75%.
-- ------------------------------------------------------------
create or replace function public.claude_usage_windows(
  p_from timestamptz,
  p_to   timestamptz
)
returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(w order by ord), '[]'::jsonb)
    from (
      select min(sampled_at) as ord, jsonb_build_object(
               'starts_at',  win_key - interval '5 hours',
               'resets_at',  win_key,
               'from',       min(sampled_at),
               'to',         max(sampled_at),
               'peak_pct',   max(pct),
               'end_pct',    (array_agg(pct order by sampled_at desc))[1],
               -- ── "we joined this window too late to say WHEN it was used" ──
               -- NOT "the first reading was above zero": every window is polled
               -- for the first time a few minutes after it opens and is already
               -- above zero by then, so that test marked all four live windows
               -- partial, including the two caught six minutes in.
               --
               -- The question is whether the first reading can be LOCATED. A
               -- first poll 6 minutes after the opening bounds its 7% to a
               -- 6-minute span; one 94 minutes after it (the 15 Aug 23:30
               -- window, first seen at 01:04 already at 75%) bounds nothing.
               -- Same 40-minute threshold the runs use for an outage, because
               -- it is the same judgement: below it a gap is one missed poll.
               'partial',    (min(sampled_at) - (win_key - interval '5 hours')
                                > interval '40 minutes')
             ) as w
        from (
          select sampled_at, coalesce(five_hour_pct, 0) as pct,
                 date_trunc('minute', five_hour_resets_at + interval '30 seconds') as win_key
            from public.claude_usage_samples
           where sampled_at >= p_from and sampled_at < p_to
             and five_hour_resets_at is not null
        ) q
       group by win_key
      having max(pct) > 0
    ) g;
$$;

revoke all on function public.claude_usage_windows(timestamptz, timestamptz) from public;
revoke all on function public.claude_usage_windows(timestamptz, timestamptz) from anon;
revoke all on function public.claude_usage_windows(timestamptz, timestamptz) from authenticated;

-- ------------------------------------------------------------
-- §3 — The log RPC carries both.
--
-- ⚠️ THIS BODY WAS TAKEN FROM `pg_get_functiondef`, NOT FROM 0155. Writing 0161
-- from the 0155 text silently reverted 0158 an hour ago; the two were verified
-- byte-identical here before this edit, and only `windows` and the returned
-- object are changed.
-- ------------------------------------------------------------
create or replace function public.get_claude_usage_log(p_at timestamptz default now())
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_uid       uuid := auth.uid();
  s           public.claude_settings%rowtype;
  v_wk_start  timestamptz;
  v_wk_end    timestamptz;
  v_now       timestamptz := now();
  v_f         numeric;
  v_first_at  timestamptz;
  v_last_at   timestamptz;
  v_n         int;
  v_gap_min   numeric;
  v_last_sd   numeric;
  v_logged    numeric;
  v_attrib    numeric;
  v_entries   jsonb := '[]'::jsonb;
  v_windows   jsonb := '[]'::jsonb;
  v_runs      jsonb := '[]'::jsonb;
  v_events    jsonb := '[]'::jsonb;
  v_series    jsonb := '[]'::jsonb;
  v_booked_past   int;
  v_booked_live   int;
  v_booked_future int;
begin
  if v_uid is null or not public.current_user_has_permission('claude') then
    raise exception 'get_claude_usage_log: ไม่มีสิทธิ์เข้าถึงระบบจองโควตา Claude';
  end if;

  select * into s from public.claude_settings where id;
  v_wk_start := public.claude_week_start(p_at);
  v_wk_end   := v_wk_start + interval '7 days';
  v_f        := s.week_pool_pct / 100.0;

  select count(*), min(span_end), max(span_end),
         coalesce(sum(week_delta), 0), max(span_sec) / 60.0
    into v_n, v_first_at, v_last_at, v_logged, v_gap_min
    from public.claude_usage_deltas(v_wk_start, v_wk_end);

  select coalesce(sum(week_pct), 0) into v_attrib
    from public.claude_usage_attribution(v_wk_start, v_wk_end);

  select seven_day_pct into v_last_sd
    from public.claude_usage_samples
   where sampled_at >= v_wk_start and sampled_at < v_wk_end
   order by sampled_at desc limit 1;

  select coalesce(jsonb_agg(e order by ord), '[]'::jsonb) into v_entries
    from (
      select b.starts_at as ord, jsonb_build_object(
               'id',           b.id,
               'starts_at',    b.starts_at,
               'ends_at',      b.ends_at,
               'pct',          b.pct,
               'purpose',      b.purpose,
               'is_mine',      (b.user_id = v_uid),
               'person',       public.claude_person(b.user_id),
               'state',        case when b.ends_at   <= v_now then 'past'
                                    when b.starts_at <= v_now then 'live'
                                    else 'future' end,
               'measured_pct', round(coalesce(sh.week_pct, 0) * v_f, 1)
             ) as e
        from public.claude_bookings b
        left join public.claude_usage_attribution(v_wk_start, v_wk_end) sh
               on sh.booking_id = b.id
       where b.starts_at >= v_wk_start and b.starts_at < v_wk_end
    ) q;

  v_windows := public.claude_usage_windows(v_wk_start, v_wk_end);

  -- WHEN it was used, and how much went in then (0162).
  select coalesce(jsonb_agg(jsonb_build_object(
           'from',        run_from,
           'to',          run_to,
           'pct',         pct,
           'kind',        kind,
           'win_start',   win_start,
           'win_reset',   win_reset,
           'exact_start', exact_start,
           'open_ended',  open_ended
         ) order by run_from), '[]'::jsonb)
    into v_runs
    from public.claude_usage_runs(v_wk_start, v_wk_end);

  select coalesce(jsonb_agg(ev order by ord), '[]'::jsonb) into v_events
    from (
      select d.span_end as ord, jsonb_build_object(
               'at',          d.span_end,
               'from',        d.span_start,
               'kind',        case when d.week_delta is null then 'reset' else 'use' end,
               'week_pct',    d.week_delta,
               'session_pct', round(coalesce(d.week_delta, 0) * v_f, 1),
               'booking_ids', coalesce((
                  select jsonb_agg(b.id)
                    from public.claude_bookings b
                   where b.starts_at < d.span_end and b.ends_at > d.span_start
                 ), '[]'::jsonb)
             ) as ev
        from public.claude_usage_deltas(v_wk_start, v_wk_end) d
       where d.week_delta is null or d.week_delta > 0
    ) q;

  select coalesce(jsonb_agg(
           jsonb_build_array(extract(epoch from sampled_at)::bigint,
                             five_hour_pct, seven_day_pct)
           order by sampled_at), '[]'::jsonb)
    into v_series
    from public.claude_usage_samples
   where sampled_at >= v_wk_start and sampled_at < v_wk_end;

  select coalesce(sum(pct) filter (where ends_at   <= v_now), 0),
         coalesce(sum(pct) filter (where starts_at <= v_now and ends_at > v_now), 0),
         coalesce(sum(pct) filter (where starts_at >  v_now), 0)
    into v_booked_past, v_booked_live, v_booked_future
    from public.claude_bookings
   where starts_at >= v_wk_start and starts_at < v_wk_end;

  return jsonb_build_object(
    'week', jsonb_build_object(
      'starts_at', v_wk_start,
      'ends_at',   v_wk_end,
      'pool_pct',  s.week_pool_pct,
      'is_current', (v_now >= v_wk_start and v_now < v_wk_end)
    ),
    'coverage', jsonb_build_object(
      'samples',      v_n,
      'first_at',     v_first_at,
      'last_at',      v_last_at,
      'max_gap_min',  round(coalesce(v_gap_min, 0), 1)
    ),
    'measured', jsonb_build_object(
      'used_pct',     case when v_last_sd is null then null
                           else round(v_last_sd * v_f, 1) end,
      'left_pct',     case when v_last_sd is null then null
                           else round((100 - v_last_sd) * v_f, 1) end,
      'logged_pct',   round(v_logged * v_f, 1),
      'attributed_pct', round(v_attrib * v_f, 1)
    ),
    'booked', jsonb_build_object(
      'past_pct',   v_booked_past,
      'live_pct',   v_booked_live,
      'future_pct', v_booked_future
    ),
    'session_pool_pct', s.session_pool_pct,
    'entries', v_entries,
    'windows', v_windows,
    'runs',    v_runs,
    'events',  v_events,
    'series',  v_series
  );
end $$;

revoke all on function public.get_claude_usage_log(timestamptz) from public;
revoke all on function public.get_claude_usage_log(timestamptz) from anon;
grant execute on function public.get_claude_usage_log(timestamptz) to authenticated;

comment on function public.get_claude_usage_log(timestamptz) is
  'Measured Claude usage for one quota week: remaining pool, per-booking '
  'booked-vs-measured, observed 5-hour windows, the USE RUNS (when it was '
  'actually being used), and the 15-minute poll log.';
