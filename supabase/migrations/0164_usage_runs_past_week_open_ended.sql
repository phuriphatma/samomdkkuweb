-- ============================================================
-- 0164 — claude_usage_runs: a PAST week is never “still running”
--
-- BUG (found by /scrutinize 2026-08-17): open_ended was (v_to = v_last_at) and
-- v_last_at is scoped to the REQUESTED range (not to now), so browsing any
-- historical week marked its final run “may still be running” — the UI faded the
-- bottom edge and the tooltip said “อาจยังใช้อยู่” about a week that ended days ago.
--
-- FIX: a run is open-ended only when it reaches the newest sample AND the
-- requested window extends into the future. One added conjunct: p_to > now().
--
-- Body pulled from the LIVE function (pg_get_functiondef), not 0163’s migration
-- text — a create-or-replace rebuilt from an original migration silently reverts
-- every later edit (the 0158/0161 lesson). Only the one line below changed.
-- ============================================================

CREATE OR REPLACE FUNCTION public.claude_usage_runs(p_from timestamp with time zone, p_to timestamp with time zone)
 RETURNS TABLE(run_from timestamp with time zone, run_to timestamp with time zone, pct numeric, kind text, win_start timestamp with time zone, win_reset timestamp with time zone, exact_start boolean, open_ended boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    -- 0164: a CLOSED (past) range can never contain a still-running window.
    -- v_last_at is the max sample WITHIN the requested range, so without the
    -- p_to>now() guard every historical week marked its final run open_ended
    -- and the UI said “อาจยังใช้อยู่” about a week that ended days ago.
    open_ended := (v_to = v_last_at and p_to > now());
    return next;
  end if;
  return;
end $function$
