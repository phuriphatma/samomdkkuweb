-- ============================================================
-- 0163 — a 5-hour window is identified by PROXIMITY, not by a rounded key.
--
-- REPORTED against 0162: *"the ใช้จริง shows like all 90% up in short period of
-- time, thats weird"* and *"it also show like 96 with 55% thats weird"*.
--
-- ── WHAT WAS ACTUALLY WRONG ──────────────────────────────────────────────
-- The numbers were right. Checked against the raw samples: the window that
-- opened 15:00 read 7% at 15:06 and 96% at 16:51, so 96% of a 5-hour session
-- really was burned in 1h51m, and the next window really did reach 55% in 51
-- minutes. Nothing here changes an arithmetic result.
--
-- What was wrong is that the overlay printed the SAME NUMBER TWICE and then
-- printed two numbers with DIFFERENT DENOMINATORS at the same minute:
--
--   20:00  ┤ 96%   ← total of the window that just closed  (15:00–20:00)
--   20:00  ┤ ใช้ 55%  ← the run inside the window that just opened
--
-- Both clay pills, both percentages, one minute apart, meaning different
-- things. And for a window with exactly one run the run total IS the window
-- total, so "96" appeared twice for one fact. That is the ambiguity, and the
-- fix for it is in the renderer.
--
-- ── THE LATENT BUG THAT WOULD HAVE PRODUCED IT FOR REAL ──────────────────
-- 0162 identified a window as `date_trunc('minute', resets_at + 30 seconds)`.
-- The API returns `now + seconds_remaining`, so the value wobbles ±1s around
-- the true reset. That key is stable only while the true reset is NOT near the
-- rounding boundary — and the boundary is at :30 seconds. A window whose real
-- reset lands at, say, 17:04:29.8 comes back as 17:04:29.8 on one poll and
-- 17:04:30.3 on the next, which truncate to DIFFERENT minutes.
--
-- Mid-window that flips `v_new_win` to true, and the new-window branch is
-- `v_delta := r.pct` — the whole CUMULATIVE reading, not the rise. A window
-- sitting at 90% would have emitted a spurious run of 90% out of nowhere:
-- *"shows like all 90% up in short period of time"*, exactly.
--
-- Today's four windows all reset on the minute (:59.5 / :00.2), so the key is
-- stable for them and the report above is the rendering one. This is the same
-- fault waiting for a window that opens at a different second, and a rounding
-- key cannot be made safe by choosing a better offset — every offset has a
-- boundary somewhere.
--
-- ── THE FIX ──────────────────────────────────────────────────────────────
-- Compare the RAW instants with a TOLERANCE: two readings belong to the same
-- window when their `resets_at` are within 2 minutes of each other. There is no
-- boundary to land on. 2 minutes is far above the observed ±1s wobble and far
-- below the 5-hour spacing of real windows, so it cannot merge two windows
-- either.
-- ============================================================

-- ------------------------------------------------------------
-- §1 — The runs, with proximity-based window identity.
-- ------------------------------------------------------------
create or replace function public.claude_usage_runs(
  p_from timestamptz,
  p_to   timestamptz
)
returns table (
  run_from    timestamptz,
  run_to      timestamptz,
  pct         numeric,
  kind        text,
  win_start   timestamptz,
  win_reset   timestamptz,
  exact_start boolean,
  open_ended  boolean
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_gap_limit constant interval := interval '40 minutes';
  -- Two readings are the same window when their resets_at agree to within this.
  -- NOT a rounding key: every rounding key has a boundary, and a window whose
  -- true reset lands on it splits mid-window (see the header).
  v_same_win  constant interval := interval '2 minutes';
  r           record;
  v_prev_at   timestamptz;
  v_prev_pct  numeric;
  v_prev_res  timestamptz;      -- RAW resets_at of the previous reading
  v_last_at   timestamptz;
  v_from      timestamptz;
  v_to        timestamptz;
  v_sum       numeric := 0;
  v_ws        timestamptz;
  v_wr        timestamptz;
  v_exact     boolean := false;
  v_span_from timestamptz;
  v_span_exact boolean;
  v_delta     numeric;
  v_new_win   boolean;
  v_open      timestamptz;
  v_reset     timestamptz;      -- this reading's reset, rounded FOR DISPLAY
begin
  select max(sampled_at) into v_last_at
    from public.claude_usage_samples
   where sampled_at >= p_from and sampled_at < p_to;

  for r in
    (select sampled_at, coalesce(five_hour_pct, 0) as pct, five_hour_resets_at
       from public.claude_usage_samples
      where sampled_at < p_from
      order by sampled_at desc limit 1)
    union all
    (select sampled_at, coalesce(five_hour_pct, 0), five_hour_resets_at
       from public.claude_usage_samples
      where sampled_at >= p_from and sampled_at < p_to)
    order by 1
  loop
    -- Rounded to the minute for DISPLAY only. The identity test below never
    -- touches this value — that separation is the whole point.
    v_reset := date_trunc('minute', r.five_hour_resets_at + interval '30 seconds');

    if v_prev_at is null then
      v_prev_at := r.sampled_at; v_prev_pct := r.pct;
      v_prev_res := r.five_hour_resets_at;
      continue;
    end if;

    -- SAME window when both resets exist and agree within the tolerance. A
    -- null on either side is a real change of state (a window opened, or the
    -- last one closed with nothing running).
    v_new_win := not (r.five_hour_resets_at is not null
                      and v_prev_res is not null
                      and abs(extract(epoch from (r.five_hour_resets_at - v_prev_res)))
                          <= extract(epoch from v_same_win));

    v_delta := case when v_new_win then r.pct else greatest(0, r.pct - v_prev_pct) end;

    if r.sampled_at - v_prev_at > v_gap_limit then
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
        win_start := case when v_reset is not null
                          then v_reset - interval '5 hours' end;
        win_reset := v_reset;
        exact_start := false; open_ended := false;
        return next;
      end if;

    elsif v_delta > 0 then
      v_span_from  := v_prev_at;
      v_span_exact := false;
      if v_new_win and v_reset is not null then
        v_open := v_reset - interval '5 hours';
        if v_open > v_span_from then
          v_span_from  := v_open;
          v_span_exact := true;
        end if;
      end if;

      if v_from is not null and not v_new_win and v_span_from <= v_to then
        v_to  := r.sampled_at;
        v_sum := v_sum + v_delta;
      else
        if v_from is not null then
          run_from := v_from; run_to := v_to; pct := v_sum; kind := 'used';
          win_start := v_ws; win_reset := v_wr; exact_start := v_exact;
          open_ended := false;
          return next;
        end if;
        v_from  := v_span_from; v_to := r.sampled_at; v_sum := v_delta;
        v_exact := v_span_exact;
        v_ws    := case when v_reset is not null
                        then v_reset - interval '5 hours' end;
        v_wr    := v_reset;
      end if;

    else
      if v_from is not null then
        run_from := v_from; run_to := v_to; pct := v_sum; kind := 'used';
        win_start := v_ws; win_reset := v_wr; exact_start := v_exact;
        open_ended := false;
        return next;
        v_from := null; v_sum := 0;
      end if;
    end if;

    v_prev_at := r.sampled_at; v_prev_pct := r.pct;
    v_prev_res := r.five_hour_resets_at;
  end loop;

  if v_from is not null then
    run_from := v_from; run_to := v_to; pct := v_sum; kind := 'used';
    win_start := v_ws; win_reset := v_wr; exact_start := v_exact;
    open_ended := (v_to = v_last_at);
    return next;
  end if;
  return;
end $$;

comment on function public.claude_usage_runs(timestamptz, timestamptz) is
  'When Claude was actually being used, and how much went in. A rise between '
  'two polls is spent in (prev, cur], clamped to the window opening instant. '
  'Windows are identified by resets_at PROXIMITY (±2 min), never by rounding.';

-- ------------------------------------------------------------
-- §2 — The windows, grouped the same way.
--
-- Gaps-and-islands over the raw instant rather than `group by <rounded key>`,
-- for the same reason: the grouping must not have a boundary to land on.
-- ------------------------------------------------------------
create or replace function public.claude_usage_windows(
  p_from timestamptz,
  p_to   timestamptz
)
returns jsonb
language sql stable security definer set search_path = public as $$
  with s as (
    select sampled_at, coalesce(five_hour_pct, 0) as pct, five_hour_resets_at as res
      from public.claude_usage_samples
     where sampled_at >= p_from and sampled_at < p_to
       and five_hour_resets_at is not null
  ), b as (
    select *,
           case when lag(res) over (order by sampled_at) is null
                     or abs(extract(epoch from
                          (res - lag(res) over (order by sampled_at)))) > 120
                then 1 else 0 end as brk
      from s
  ), g as (
    select *, sum(brk) over (order by sampled_at) as grp from b
  )
  select coalesce(jsonb_agg(w order by ord), '[]'::jsonb)
    from (
      select min(sampled_at) as ord, jsonb_build_object(
               -- The DISPLAY instant is the rounded one; a window reported as
               -- 19:59:59.5 is a window that ends at 20:00, and rendering the
               -- half-second puts API noise on a calendar as a time.
               'starts_at',  date_trunc('minute', max(res) + interval '30 seconds')
                               - interval '5 hours',
               'resets_at',  date_trunc('minute', max(res) + interval '30 seconds'),
               'from',       min(sampled_at),
               'to',         max(sampled_at),
               'peak_pct',   max(pct),
               'end_pct',    (array_agg(pct order by sampled_at desc))[1],
               'runs',       0,
               -- "we joined too late to say WHEN the first reading was spent" —
               -- the first poll is more than one missed-poll interval after the
               -- window opened. NOT "the first reading was above zero", which is
               -- true of every window that is ever used.
               'partial',    (min(sampled_at)
                              - (date_trunc('minute', max(res) + interval '30 seconds')
                                 - interval '5 hours') > interval '40 minutes')
             ) as w
        from g
       group by grp
      having max(pct) > 0
    ) q;
$$;
