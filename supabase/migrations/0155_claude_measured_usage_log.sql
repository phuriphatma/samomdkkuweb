-- ============================================================
-- 0155 — จองโควตา Claude: what was MEASURED, and who was holding the block.
--
-- 0154 shipped the ledger (what people DECLARED they would use) and the strip
-- that shows the two live gauges. This adds the third thing, which is the one
-- that makes the board self-correcting: a LOG. Samples land every 15 minutes;
-- between two consecutive samples the weekly window moved by some amount; the
-- bookings that were open during that interval are who moved it.
--
-- THE ARITHMETIC, IN ONE PLACE, IN THE UNIT THE REST OF THE FEATURE USES
-- `claude_usage_samples.seven_day_pct` is 0–100 of the WEEKLY window. The unit
-- everywhere else here is SESSION PERCENT, and the week is worth
-- `week_pool_pct` of them (700 by default), so
--     session_pct = weekly_pct * week_pool_pct / 100
-- and nothing downstream converts anything. The JS renders these numbers.
--
-- FOUR RULES THIS FUNCTION IS BUILT ON, each learned from the live data
-- (37 samples, 2026-08-15 → 08-16, read before writing a line of it):
--
--   1. A DELTA IS ONLY MEANINGFUL INSIDE ONE WINDOW. Do NOT decide "same
--      window" by comparing `seven_day_resets_at`: the API jitters that
--      timestamp by ±1 minute between polls (15:59 / 16:00 / 15:59 …), so an
--      equality test marks half the intervals as a reset. Use MONOTONICITY —
--      utilization only rises inside a window, so a DROP is the reset. That is
--      a property of the quantity, not of the transport.
--
--   2. A SPAN IS ONLY PARTLY BOOKED. A booking overlapping 5 minutes of a
--      15-minute span gets a THIRD of that span's consumption, not all of it.
--      The remainder is genuinely unattributed — somebody used the shared login
--      outside their block, which is the single most useful thing this log can
--      tell anyone. Distributing 100% of a span onto whoever happens to clip it
--      would erase exactly that signal.
--
--   3. THE LOG IS NOT THE TOTAL. The authoritative "used this week" is the
--      latest sample's own reading, not the sum of the deltas: samples before
--      the reporter was switched on, and any gap while it was down, are usage
--      no delta can see. Both are returned, and the difference is named
--      (`unlogged_pct`) rather than silently folded into someone's row.
--
--   4. A 5-HOUR WINDOW IS OBSERVED, NOT CONFIGURED. `five_hour_pct` sawtooths:
--      it climbs and then drops to 0 when Anthropic opens a new window. Split
--      the series at every drop and each group IS one real 5-hour window, with
--      its peak the share of it that was actually burned. That is the number
--      the booked `pct` is a guess at, so the two can finally be put side by
--      side.
--
-- ALSO HERE: the identity projection becomes ONE function.
-- `get_claude_board()` resolved the signed-in person's name/ฝ่าย/ตำแหน่ง by
-- looking for a booking of theirs in the week on screen. Browse to next week,
-- where you have none, and the booking modal fell back to the raw account name
-- and "ยังไม่มีตำแหน่งในผังทีม" — an identity derived from an incidental row.
-- `claude_person()` now answers it directly, the board carries `me`, and both
-- the bookings and the reader go through the same projection.
-- ============================================================

-- ------------------------------------------------------------
-- §1 — The identity projection, extracted.
--
-- Exactly the columns 0154 §7 published, and no more: a display name, the ฝ่าย
-- path and the ตำแหน่ง titles. No email, no รหัสนักศึกษา, no role, no
-- permission array — since 0147 public.users is self-read only, so nothing in
-- this payload may be obtainable by asking the table directly.
--
-- SECURITY DEFINER because it reads users/team_members, and therefore REVOKED
-- from `authenticated`: it is internal, called only by the two gated RPCs
-- below. Granting it would publish the staff directory keyed by user id, which
-- is precisely what 0147 closed.
-- ------------------------------------------------------------
create or replace function public.claude_person(p_user_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_email text;
  v_name  text;
  v_nick  text;
  v_posts jsonb := '[]'::jsonb;
  v_path  text[] := '{}';
begin
  if p_user_id is null then
    return jsonb_build_object('name', null, 'nickname', null,
                              'path', '[]'::jsonb, 'postings', '[]'::jsonb);
  end if;

  select email into v_email from public.users where id = p_user_id;

  if v_email is not null and length(btrim(v_email)) > 0 then
    -- The ฝ่าย path of the FIRST posting. 82 people hold 2–4 ตำแหน่ง, so a
    -- single "their role" does not exist; the card shows all of them and the
    -- colour keys off this one.
    select public.team_node_path(m.node_id) into v_path
      from public.team_members m
     where lower(m.kkumail) = lower(btrim(v_email))
     order by m.created_at
     limit 1;

    select jsonb_agg(jsonb_build_object('node', n.name) order by m.created_at),
           min(nullif(btrim(coalesce(m.full_name, '')), '')),
           min(nullif(btrim(coalesce(m.nickname,  '')), ''))
      into v_posts, v_name, v_nick
      from public.team_members m
      join public.team_nodes  n on n.id = m.node_id
     where lower(m.kkumail) = lower(btrim(v_email));
  end if;

  return jsonb_build_object(
    'name',     v_name,
    'nickname', v_nick,
    'path',     to_jsonb(coalesce(v_path, '{}'::text[])),
    'postings', coalesce(v_posts, '[]'::jsonb)
  );
end $$;

revoke all on function public.claude_person(uuid) from public;
revoke all on function public.claude_person(uuid) from anon;
revoke all on function public.claude_person(uuid) from authenticated;

comment on function public.claude_person(uuid) is
  'Display-only identity for the Claude board: name, ฝ่าย path, ตำแหน่ง. '
  'Internal — the gate lives in the RPCs that call it.';

-- ------------------------------------------------------------
-- §1b — "ใช้ได้เลยตอนนี้เท่าไร ถึงเมื่อไร"
--
-- THE QUESTION THIS FEATURE IS ACTUALLY FOR. Everything 0154 shipped answers
-- "is this slot free"; nobody books before opening Claude for ten minutes, so
-- the question people really arrive with is the opposite one — *I want to use
-- it now. How much may I take, and until when, without stepping on anyone?*
--
-- The owner stated the rule as three worked examples. All three fall out of one
-- expression, `min(session_free, week_free)`:
--
--   week 660% left · someone booked 16:00–19:00 for 70% · now 11:00 → 100%
--     a session opened now runs 11:00–16:00 and ENDS as theirs begins, so it
--     shares with nobody; the week has far more than a session, so the session
--     is the binding constraint.
--   same, but now 12:00 → 30%, until 16:00
--     a session opened now runs 12:00–17:00 and their block is INSIDE it, so
--     the two share one 100% and 70 of it is spoken for.
--   week 100% left · same booking · now 11:00 → 30%
--     the session is free, but their 70% is a claim on the week and the week is
--     nearly gone. The week binds.
--
-- WHY BOOKINGS ARE SUBTRACTED FROM THE WEEK AND NOT ONLY FROM THE SESSION: a
-- future booking is a promise the pool will honour. Reporting the whole
-- remainder as usable would let the first person to open a laptop spend a block
-- somebody else is already counting on.
--
-- WHY THE 5-HOUR WINDOW COMES FROM THE MEASUREMENT AND NOT FROM THE CLOCK: if
-- a window is already open, its edge is Anthropic's `five_hour_resets_at`, and
-- what is left in it is 100 minus the utilization actually observed. Only when
-- no window is open does one begin at `now`. A grid anchored to the clock is
-- the fiction 0154 was built to avoid, and it would be the same fiction here.
--
-- ONE IMPLEMENTATION, TWO CALLERS: the board renders this every minute and the
-- log reconciles against it. Both read this function.
-- ------------------------------------------------------------
create or replace function public.claude_free_now(p_at timestamptz default now())
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  s            public.claude_settings%rowtype;
  v_f          numeric;
  v_span       interval;
  v_wk_start   timestamptz;
  v_wk_end     timestamptz;
  v_sample     public.claude_usage_samples%rowtype;
  v_win_start  timestamptz;
  v_win_end    timestamptz;
  v_win_open   boolean := false;
  v_win_used   numeric := 0;      -- session-% already burned in the open window
  v_sess_booked int;
  v_sess_free  numeric;
  v_wk_left    numeric;
  v_wk_reserved int;
  v_wk_free    numeric;
  v_free       numeric;
  v_until      timestamptz;
  v_reason     text;
  v_next       jsonb := null;
  v_live       jsonb := null;
  b            record;
begin
  select * into s from public.claude_settings where id;
  v_f        := s.week_pool_pct / 100.0;
  v_span     := make_interval(mins => s.session_minutes);
  v_wk_start := public.claude_week_start(p_at);
  v_wk_end   := v_wk_start + interval '7 days';

  select * into v_sample from public.claude_usage_samples
   order by sampled_at desc limit 1;

  -- (1) The 5-hour window in play.
  if v_sample.id is not null
     and v_sample.five_hour_resets_at is not null
     and v_sample.five_hour_resets_at > p_at
     and coalesce(v_sample.five_hour_pct, 0) > 0 then
    v_win_open  := true;
    v_win_end   := v_sample.five_hour_resets_at;
    v_win_start := v_sample.five_hour_resets_at - v_span;
    v_win_used  := v_sample.five_hour_pct;
  else
    v_win_start := p_at;
    v_win_end   := p_at + v_span;
  end if;
  -- Never past the weekly reset: a session that crosses it draws from two
  -- pools, which is exactly what the 0154 trigger refuses to let anyone book.
  if v_win_end > v_wk_end then
    v_win_end := v_wk_end;
  end if;

  -- (2) What is CLAIMED inside that window, from now forward.
  -- From NOW and not from the window start: whatever a booking earlier in this
  -- same window already spent is in `five_hour_pct` above, and counting it in
  -- both places would charge it twice.
  select coalesce(sum(pct), 0) into v_sess_booked
    from public.claude_bookings
   where starts_at < v_win_end and ends_at > p_at;

  v_sess_free := greatest(0, s.session_pool_pct - v_win_used - v_sess_booked);

  -- (3) The week. `left` is MEASURED (what Claude says is gone), `reserved` is
  -- every block not yet finished. What is left over is free to use unbooked.
  select coalesce(sum(pct), 0) into v_wk_reserved
    from public.claude_bookings
   where starts_at >= v_wk_start and starts_at < v_wk_end
     and ends_at > p_at;

  if v_sample.id is not null and v_sample.seven_day_pct is not null then
    v_wk_left := round((100 - v_sample.seven_day_pct) * v_f, 1);
    v_wk_free := greatest(0, v_wk_left - v_wk_reserved);
    v_free    := least(v_sess_free, v_wk_free);
  else
    -- No measurement: the honest bound is the session, and the caller is told
    -- the weekly half is unknown rather than shown a pool that may be spent.
    v_wk_left := null;
    v_wk_free := null;
    v_free    := v_sess_free;
  end if;

  -- (4) Until when. The number stops being true at whichever comes first: the
  -- window closing, or the next booked block opening.
  v_until  := v_win_end;
  v_reason := case when v_win_end = v_wk_end then 'week_reset' else 'session_reset' end;

  select jsonb_build_object(
           'id', x.id, 'starts_at', x.starts_at, 'ends_at', x.ends_at,
           'pct', x.pct, 'purpose', x.purpose, 'person', public.claude_person(x.user_id)
         ), x.starts_at
    into v_next, v_until
    from public.claude_bookings x
   where x.starts_at > p_at and x.starts_at < v_until
   order by x.starts_at limit 1;
  if v_next is not null then
    v_reason := 'booking';
  else
    v_until := v_win_end;
  end if;

  -- (5) Somebody's block is running RIGHT NOW. The number above is still
  -- correct, but "you may use 30%" is the wrong first sentence to read while
  -- another person is mid-session — name them and let the reader decide.
  select jsonb_build_object(
           'id', x.id, 'starts_at', x.starts_at, 'ends_at', x.ends_at,
           'pct', x.pct, 'purpose', x.purpose, 'person', public.claude_person(x.user_id)
         )
    into v_live
    from public.claude_bookings x
   where x.starts_at <= p_at and x.ends_at > p_at
   order by x.starts_at limit 1;

  return jsonb_build_object(
    'at',       p_at,
    'free_pct', v_free,
    'until',    v_until,
    'reason',   v_reason,
    'bound_by', case when v_wk_free is not null and v_wk_free < v_sess_free
                     then 'week' else 'session' end,
    'session', jsonb_build_object(
      'pool_pct',     s.session_pool_pct,
      'window_start', v_win_start,
      'window_end',   v_win_end,
      'is_open',      v_win_open,
      'used_pct',     v_win_used,
      'booked_pct',   v_sess_booked,
      'free_pct',     v_sess_free
    ),
    'week', jsonb_build_object(
      'pool_pct',     s.week_pool_pct,
      'used_pct',     case when v_wk_left is null then null
                           else round(s.week_pool_pct - v_wk_left, 1) end,
      'left_pct',     v_wk_left,
      'reserved_pct', v_wk_reserved,
      'free_pct',     v_wk_free,
      'resets_at',    v_wk_end
    ),
    'next_booking', v_next,
    'live_booking', v_live,
    'measured_at',  v_sample.sampled_at
  );
end $$;

revoke all on function public.claude_free_now(timestamptz) from public;
revoke all on function public.claude_free_now(timestamptz) from anon;
revoke all on function public.claude_free_now(timestamptz) from authenticated;

comment on function public.claude_free_now(timestamptz) is
  'How much Claude quota may be used right now without booking, and until when. '
  'min(what is left in the 5-hour window, what the week has left after reservations).';

-- ------------------------------------------------------------
-- §1c — The same answer, for every start time in the week.
--
-- The hero panel says what may be used RIGHT NOW. The calendar has to say it
-- for every hour on screen, because "can I start at 14:00 instead" is the next
-- question anyone asks and the only way to answer it today is to try.
--
-- IT IS PIECEWISE CONSTANT, and the boundaries are computable. `free_pct` for a
-- start at t changes only when the 5-hour window [t, t+5h) gains or loses a
-- booking, or when a booking ends. So the answer can only change at:
--
--   • a booking's start          — it enters the window you are already in
--   • a booking's end            — it stops being a reservation
--   • a booking's start MINUS 5h — the instant its block first falls inside a
--                                  window opened at t. This is the subtle one,
--                                  and it is exactly the owner's example: at
--                                  11:00 a window runs to 16:00 and their 16:00
--                                  block is outside it, so 100% is free; one
--                                  minute later the window reaches 16:01, the
--                                  block is inside, and 30% is free. Nothing
--                                  happens at 11:00 that any calendar shows.
--   • the open window's own reset
--
-- Between two of those the number cannot move, so one evaluation per segment is
-- not a sample — it is the whole answer for that stretch.
--
-- Evaluated by calling claude_free_now() at each boundary, so the calendar and
-- the hero panel cannot disagree: there is still exactly one implementation of
-- the rule and this walks it.
--
-- CURRENT WEEK ONLY. For a future week the weekly remainder would be read off
-- today's sample, which describes a pool that will have reset by then — a
-- number that looks measured and is fiction. The caller gets an empty list and
-- draws nothing, which is the honest rendering of "not known yet".
-- ------------------------------------------------------------
create or replace function public.claude_free_windows(p_at timestamptz default now())
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  s          public.claude_settings%rowtype;
  v_span     interval;
  v_wk_start timestamptz;
  v_wk_end   timestamptz;
  v_now      timestamptz := now();
  v_from     timestamptz;
  v_out      jsonb := '[]'::jsonb;
  v_prev     timestamptz;
  v_free     jsonb;
  b          timestamptz;
begin
  select * into s from public.claude_settings where id;
  v_span     := make_interval(mins => s.session_minutes);
  v_wk_start := public.claude_week_start(p_at);
  v_wk_end   := v_wk_start + interval '7 days';

  if v_now < v_wk_start or v_now >= v_wk_end then
    return '[]'::jsonb;                      -- not the week we are living in
  end if;
  v_from := greatest(v_now, v_wk_start);

  for b in
    select t from (
      select v_from as t
      union select starts_at          from public.claude_bookings
      union select ends_at            from public.claude_bookings
      union select starts_at - v_span from public.claude_bookings
      union select v_wk_end as t
    ) q
    where t >= v_from and t <= v_wk_end
    order by t
  loop
    if v_prev is not null and b > v_prev then
      v_free := public.claude_free_now(v_prev);
      v_out := v_out || jsonb_build_object(
        'starts_at', v_prev,
        'ends_at',   b,
        'free_pct',  v_free->'free_pct',
        'bound_by',  v_free->>'bound_by',
        'until',     v_free->>'until'
      );
    end if;
    v_prev := b;
  end loop;

  return v_out;
end $$;

revoke all on function public.claude_free_windows(timestamptz) from public;
revoke all on function public.claude_free_windows(timestamptz) from anon;
revoke all on function public.claude_free_windows(timestamptz) from authenticated;

comment on function public.claude_free_windows(timestamptz) is
  'Per-segment "how much may I take if I start here", for drawing on the '
  'calendar. Piecewise constant; boundaries include booking_start - 5h.';

-- ------------------------------------------------------------
-- §2 — The board, rebuilt on §1, and carrying `me`.
--
-- The only behavioural change is `me`: who the READER is, resolved the same way
-- everyone else on the board is. The booking modal used to infer this from a
-- booking of theirs in the week being viewed, so it was correct exactly when
-- you had already booked in that week and wrong every other time.
-- ------------------------------------------------------------
create or replace function public.get_claude_board(p_at timestamptz default now())
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_uid      uuid := auth.uid();
  s          public.claude_settings%rowtype;
  v_wk_start timestamptz;
  v_wk_end   timestamptz;
  v_books    jsonb := '[]'::jsonb;
  v_sess     jsonb := '[]'::jsonb;
  v_week_pct int;
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

  select * into v_sample from public.claude_usage_samples
   order by sampled_at desc limit 1;

  return jsonb_build_object(
    'week', jsonb_build_object(
      'starts_at', v_wk_start,
      'ends_at',   v_wk_end,
      'pool_pct',  s.week_pool_pct,
      'used_pct',  v_week_pct
    ),
    'settings', jsonb_build_object(
      'session_pool_pct', s.session_pool_pct,
      'session_minutes',  s.session_minutes,
      'week_pool_pct',    s.week_pool_pct,
      'reset_tz',         s.week_reset_tz,
      'plan_label',       s.plan_label
    ),
    -- WHO IS READING. Not derived from a booking they happen to hold in the
    -- week on screen; that made the identity a property of the calendar page.
    'me',       public.claude_person(v_uid),
    -- "ใช้ได้เลยตอนนี้เท่าไร ถึงเมื่อไร" — always about NOW, never about the
    -- week being browsed, so it is computed from now() and not from p_at.
    'right_now', public.claude_free_now(),
    -- The same answer for every start time on screen, so the calendar can show
    -- "start here, take this much" instead of making people guess and try.
    'free_windows', public.claude_free_windows(p_at),
    'bookings', v_books,
    'sessions', v_sess,
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

-- ------------------------------------------------------------
-- §3 — The two derivations, as functions rather than as repeated CTEs.
--
-- Both are needed more than once by §4 (a total AND a per-row join), and a CTE
-- copied into two queries is the drift class this repo pays for most. They are
-- SECURITY DEFINER over the whole samples/bookings tables and therefore
-- REVOKED from `authenticated`, on the same reasoning as claude_sessions() in
-- 0154: the gate belongs to the RPC that calls them, once.
-- ------------------------------------------------------------

/* Consecutive samples, and how far the weekly window moved between them.
   `week_delta` is NULL where the reading DROPPED — that is the window rolling
   over, not negative consumption (rule 1). */
create or replace function public.claude_usage_deltas(
  p_from timestamptz,
  p_to   timestamptz
)
returns table (
  span_start timestamptz,
  span_end   timestamptz,
  week_delta numeric,
  span_sec   numeric
)
language sql stable security definer set search_path = public as $$
  with sm as (
    select sampled_at, seven_day_pct,
           lag(sampled_at)    over (order by sampled_at) as prev_at,
           lag(seven_day_pct) over (order by sampled_at) as prev_sd
      from public.claude_usage_samples
     where sampled_at >= p_from and sampled_at < p_to
  )
  select prev_at,
         sampled_at,
         case when seven_day_pct >= prev_sd then seven_day_pct - prev_sd end,
         extract(epoch from (sampled_at - prev_at))::numeric
    from sm
   where prev_at is not null
     and prev_sd is not null
     and sampled_at > prev_at;
$$;

revoke all on function public.claude_usage_deltas(timestamptz, timestamptz) from public;
revoke all on function public.claude_usage_deltas(timestamptz, timestamptz) from anon;
revoke all on function public.claude_usage_deltas(timestamptz, timestamptz) from authenticated;

/* How each span's consumption divides between the blocks that were open in it.
   Proportional to the OVERLAPPED FRACTION OF THE SPAN (rule 2), so the part of
   a span nobody had booked stays unattributed instead of being handed to
   whoever clipped its edge. Bookings cannot overlap each other
   (claude_bookings_no_overlap), so these shares never double-count. */
create or replace function public.claude_usage_attribution(
  p_from timestamptz,
  p_to   timestamptz
)
returns table (
  booking_id uuid,
  week_pct   numeric
)
language sql stable security definer set search_path = public as $$
  select b.id,
         sum(d.week_delta * extract(epoch from (
               least(d.span_end, b.ends_at) - greatest(d.span_start, b.starts_at)
             ))::numeric / d.span_sec)
    from public.claude_usage_deltas(p_from, p_to) d
    join public.claude_bookings b
      on b.starts_at < d.span_end
     and b.ends_at   > d.span_start
   where d.week_delta is not null
     and d.week_delta > 0
     and d.span_sec   > 0
   group by b.id;
$$;

revoke all on function public.claude_usage_attribution(timestamptz, timestamptz) from public;
revoke all on function public.claude_usage_attribution(timestamptz, timestamptz) from anon;
revoke all on function public.claude_usage_attribution(timestamptz, timestamptz) from authenticated;

-- ------------------------------------------------------------
-- §4 — The measured log.
--
-- One call, one quota week, gated on `claude` exactly as the board is. It
-- returns four different views of the same samples because they answer four
-- different questions people actually ask at this board:
--
--   left     — "how much of the week is left?"          (the headline)
--   entries  — "did MY block cost what I said it would?" (booked vs measured)
--   windows  — "how full was each real 5-hour session?"  (the observed sawtooth)
--   events   — "what happened at 02:15?"                 (the poll log itself)
--
-- `series` is every sample in the week as [epoch_seconds, five_hour,
-- seven_day], for drawing. Compact on purpose: at 96 samples a day a week of
-- objects-with-keys is a payload the phone on the other end has to download
-- every time this section refreshes.
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
  -- weekly-% → session-%. 100 weekly-% IS the whole pool.
  v_f         numeric;
  v_first_at  timestamptz;
  v_last_at   timestamptz;
  v_n         int;
  v_gap_min   numeric;
  v_last_sd   numeric;
  v_logged    numeric;      -- weekly-% the deltas can account for
  v_attrib    numeric;      -- weekly-% landing inside some booking
  v_entries   jsonb := '[]'::jsonb;
  v_windows   jsonb := '[]'::jsonb;
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

  -- The real coverage question is not "how many samples" but "was the reporter
  -- ever DOWN". The widest gap between two polls answers it in one number.
  select count(*), min(span_end), max(span_end),
         coalesce(sum(week_delta), 0), max(span_sec) / 60.0
    into v_n, v_first_at, v_last_at, v_logged, v_gap_min
    from public.claude_usage_deltas(v_wk_start, v_wk_end);

  select coalesce(sum(week_pct), 0) into v_attrib
    from public.claude_usage_attribution(v_wk_start, v_wk_end);

  -- Authoritative "used so far", straight off the newest reading in the week —
  -- rule 3: the sum of deltas cannot see what happened before the first sample.
  select seven_day_pct into v_last_sd
    from public.claude_usage_samples
   where sampled_at >= v_wk_start and sampled_at < v_wk_end
   order by sampled_at desc limit 1;

  -- ── per booking: what was claimed, and what the samples say it cost ──
  -- Ordered by the COLUMN, never by the jsonb text of the timestamp: how a
  -- timestamptz renders into jsonb depends on the session TimeZone, so sorting
  -- the rendered string is sorting a formatting decision.
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
               -- past / live / future, so the UI never reports a block that has
               -- not happened yet as "used 0% of 30%".
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

  -- ── the observed 5-hour windows (rule 4) ──
  -- Split the series wherever five_hour_pct DROPS; each group is one real
  -- window and its peak is the share of that window that was actually burned.
  -- Windows that never left 0 are dropped: an idle stretch is not a session.
  select coalesce(jsonb_agg(w order by ord), '[]'::jsonb) into v_windows
    from (
      select min(sampled_at) as ord, jsonb_build_object(
               'from',     min(sampled_at),
               'to',       max(sampled_at),
               'peak_pct', max(five_hour_pct),
               'end_pct',  (array_agg(five_hour_pct order by sampled_at desc))[1],
               'resets_at', max(five_hour_resets_at)
             ) as w
        from (
          select sampled_at, five_hour_pct, five_hour_resets_at,
                 sum(brk) over (order by sampled_at) as grp
            from (
              select sampled_at, five_hour_pct, five_hour_resets_at,
                     case when five_hour_pct
                               < lag(five_hour_pct) over (order by sampled_at)
                          then 1 else 0 end as brk
                from public.claude_usage_samples
               where sampled_at >= v_wk_start and sampled_at < v_wk_end
                 and five_hour_pct is not null
            ) t
        ) g
       group by grp
      having max(five_hour_pct) > 0
    ) q;

  -- ── the poll log, minus the noise ──
  -- Only the intervals where something MOVED. A table with 700 rows saying "no
  -- change" is not a log, it is the raw poll cadence; the rows worth reading
  -- are the ones where the week went up, plus the resets, which are the other
  -- thing that explains a number changing.
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

  -- ── the raw series, compact, for the chart ──
  select coalesce(jsonb_agg(
           jsonb_build_array(extract(epoch from sampled_at)::bigint,
                             five_hour_pct, seven_day_pct)
           order by sampled_at), '[]'::jsonb)
    into v_series
    from public.claude_usage_samples
   where sampled_at >= v_wk_start and sampled_at < v_wk_end;

  -- ── what is CLAIMED, split by where it sits relative to now ──
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
    'now', v_now,
    -- The same object the board's hero panel renders, so the log and the board
    -- can never disagree about how much is usable right now.
    'right_now', public.claude_free_now(),
    -- Everything below is SESSION PERCENT out of week.pool_pct, except where a
    -- key says weekly_pct. One unit, converted once, here.
    'measured', jsonb_build_object(
      'used_pct',   case when v_last_sd is null then null else round(v_last_sd * v_f, 1) end,
      'left_pct',   case when v_last_sd is null then null
                         else round((100 - v_last_sd) * v_f, 1) end,
      'weekly_pct', v_last_sd,
      -- The reconciliation, and it must add up: logged = attributed +
      -- unattributed, and used = logged + unlogged. Naming the third term is
      -- how the log stays honest about the reporter's own downtime.
      'logged_pct',       round(v_logged * v_f, 1),
      'attributed_pct',   round(v_attrib * v_f, 1),
      'unattributed_pct', round((v_logged - v_attrib) * v_f, 1),
      'unlogged_pct',     case when v_last_sd is null then null
                               else round(greatest(0, v_last_sd - v_logged) * v_f, 1) end
    ),
    'booked', jsonb_build_object(
      'past_pct',   v_booked_past,
      'live_pct',   v_booked_live,
      'future_pct', v_booked_future,
      'total_pct',  v_booked_past + v_booked_live + v_booked_future
    ),
    'coverage', jsonb_build_object(
      'samples',        v_n,
      'first_at',       v_first_at,
      'last_at',        v_last_at,
      'max_gap_min',    round(coalesce(v_gap_min, 0), 1),
      'interval_min',   15
    ),
    'entries', v_entries,
    'windows', v_windows,
    'events',  v_events,
    'series',  v_series
  );
end $$;

revoke all on function public.get_claude_usage_log(timestamptz) from public;
revoke all on function public.get_claude_usage_log(timestamptz) from anon;
grant execute on function public.get_claude_usage_log(timestamptz) to authenticated;

comment on function public.get_claude_usage_log(timestamptz) is
  'Measured Claude usage for one quota week: remaining pool, per-booking '
  'booked-vs-measured, observed 5-hour windows, and the 15-minute poll log.';
