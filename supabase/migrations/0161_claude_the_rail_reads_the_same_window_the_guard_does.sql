-- ============================================================
-- 0161 — the capacity rail was deriving its own 5-hour window, and it
--        disagreed with the guard.
--
-- REPORTED: *"i book 16.00-19.00 for 75% … it shouldnt show the rail as 100% in
-- that 25%, it shouldnt show yellow, currently there's a bug"*.
--
-- ── REPRODUCED, exactly ───────────────────────────────────────────────────
-- One booking, 03:00–06:00 at 75%. It opens a window running 03:00–08:00.
--
--   claude_window_loads()  a 06:00–08:00 booking → load 175, REFUSED
--   claude_free_now(06:00) → free 100 (or 51 when the week binds), window
--                            06:00–11:00
--
-- The trigger and the rail were answering the same question with two different
-- windows. `claude_window_loads()` derives the window from the BOOKING CHAIN —
-- a booking opens a window and everything landing inside joins it, which is the
-- 0159 rule. `claude_free_now()` derived it from the CLOCK: if the measurement
-- reported no open window, it simply said `[p_at, p_at + 5h)`.
--
-- So for every instant in the TAIL of a window somebody had opened — the part
-- after their block ends but before the window resets — the rail invented a
-- fresh 100% pot that does not exist. That is the 25% the owner was looking at,
-- drawn as if it were a whole session.
--
-- It is class 6 in `.claude/rules/mistakes.md`: two implementations of one rule
-- drift. The 0154 header says "the arithmetic has exactly one home and it is
-- the database" — and then the database grew two.
--
-- ── THE FIX ───────────────────────────────────────────────────────────────
-- claude_free_now() stops deriving anything. It asks claude_window_loads() —
-- the SAME function the trigger refuses with and the form's slider is capped by
-- — which windows contain this instant, and takes the one with the heaviest
-- load, exactly as the guard does (`order by load_pct desc limit 1`).
--
-- Everything the old code did by hand is already in there and better:
--   • the live measured window as an anchor carrying five_hour_pct (0159 §3);
--   • "for the LIVE window count only from now forward", so a block that has
--     already run is not charged twice against the measurement (0158);
--   • for a chain window, count everything OVERLAPPING it, which is the half
--     that was missing and the whole bug.
--
-- ── WHAT DOES NOT CHANGE, and was checked instant by instant ──────────────
-- Every case in claude0155-free-now.sql lands identically, because for an
-- instant that is NOT inside somebody else's window claude_window_loads()
-- opens one at `p_at` itself and counts `starts_at < win_end and ends_at >
-- win_start` — which is character for character what the old step (2) did.
--   A1  11:00, booking at 16:00       → the 16:00 booking is not in the event
--                                       stream at all (starts_at < p_start+5h
--                                       is false at exactly 5h)      → 100%
--   A2  12:00, same booking           → it joins the fresh window     →  30%
--   B1  an open measured window       → the 'live' branch, base 60    →  40%
-- The "latest start" semantics 0157 was built on survive for the same reason:
-- at exactly `booking_start − 5h` the booking opens its own window, which fails
-- the overlap test and cannot constrain you; one second later it joins yours.
--
-- ── AND THE RAIL GAINS A BOUNDARY ─────────────────────────────────────────
-- With chain windows the answer now also changes at `booking_start + 5h` — the
-- instant a window resets and the next start gets a fresh pot. Nothing on a
-- calendar marks it and it was not in claude_free_windows()' union, so without
-- §2 below the rail would draw ONE band across it carrying the smaller number
-- for hours after it stopped being true. That is bug-shaped exactly like 0157's
-- BUG 1, which is why claude0157-rail-segments.sql asserts the PROPERTY (a band
-- is constant) rather than a list of instants: it goes red on a missing
-- boundary nobody predicted. It is the reason this migration has a §2.
-- ============================================================

-- ------------------------------------------------------------
-- §1 — claude_free_now() reads the guard's own windows.
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
  v_now        timestamptz := now();
  v_sample     public.claude_usage_samples%rowtype;
  v_win        record;
  v_win_start  timestamptz;
  v_win_end    timestamptz;
  v_win_open   boolean := false;
  v_win_used   numeric := 0;      -- session-% already burned in the open window
  v_sess_booked numeric := 0;
  v_sess_free  numeric;
  v_wk_left    numeric;
  v_wk_reserved int;
  v_wk_free    numeric;
  v_free       numeric;
  v_until      timestamptz;
  v_reason     text;
  v_next       jsonb := null;
  v_live       jsonb := null;
begin
  select * into s from public.claude_settings where id;
  v_f        := s.week_pool_pct / 100.0;
  v_span     := make_interval(mins => s.session_minutes);
  v_wk_start := public.claude_week_start(p_at);
  v_wk_end   := v_wk_start + interval '7 days';

  select * into v_sample from public.claude_usage_samples
   order by sampled_at desc limit 1;

  -- (1) The 5-hour window in play, AND what is already loaded into it — one
  -- question, one answer, from the function the trigger uses. The candidate is
  -- a zero-width, zero-percent probe: "if I opened Claude at this instant,
  -- which windows would I be inside?" Heaviest first, ties to the one that
  -- closes soonest, because that is the one whose end the number expires at.
  select w.win_start, w.win_end, w.kind, w.base_pct, w.booked_pct, w.load_pct
    into v_win
    from public.claude_window_loads(null, p_at, p_at + interval '1 microsecond', 0) w
   order by w.load_pct desc, w.win_end asc
   limit 1;

  if v_win.win_start is null then
    -- Unreachable in practice: the probe always injects itself as an opener.
    -- Kept because a null here would otherwise print as a free session, and
    -- this repo's rule is that an unresolvable reference must not fail open.
    v_win_start := p_at;
    v_win_end   := p_at + v_span;
  else
    v_win_start   := v_win.win_start;
    v_win_end     := v_win.win_end;
    v_win_open    := v_win.kind = 'live';
    v_win_used    := v_win.base_pct;
    v_sess_booked := v_win.booked_pct;
  end if;

  -- Never past the weekly reset: a session that crosses it draws from two
  -- pools, which is exactly what the trigger refuses to let anyone book.
  if v_win_end > v_wk_end then
    v_win_end := v_wk_end;
  end if;

  v_sess_free := greatest(0, s.session_pool_pct - v_win_used - v_sess_booked);

  -- (2) The week. `left` is measured AS OF NOW, so `reserved` must be as of now
  -- too (0158): a block that runs between now and p_at SPENDS its share rather
  -- than releasing it, so it stays subtracted. `least(p_at, v_now)` and not a
  -- bare `v_now` — asked about a PAST instant the reservation list is that
  -- instant's.
  --
  -- ⚠️ THIS LINE WAS REVERTED WHILE WRITING 0161 and claude0155 §C3/§C3b caught
  -- it, because the rewrite below was built from the 0155 TEXT instead of the
  -- LIVE function body — the exact mistake `.claude/rules/mistakes.md` class 7
  -- names ("read the LIVE function body, not the migration that first defined
  -- it"). `create or replace` over a function three migrations old silently
  -- undoes all three.
  select coalesce(sum(pct), 0) into v_wk_reserved
    from public.claude_bookings
   where starts_at >= v_wk_start and starts_at < v_wk_end
     and ends_at > least(p_at, v_now);

  if v_sample.id is not null and v_sample.seven_day_pct is not null then
    v_wk_left := round((100 - v_sample.seven_day_pct) * v_f, 1);
    v_wk_free := greatest(0, v_wk_left - v_wk_reserved);
    v_free    := least(v_sess_free, v_wk_free);
  else
    v_wk_left := null;
    v_wk_free := null;
    v_free    := v_sess_free;
  end if;

  -- (3) Until when. The number stops being true at whichever comes first: the
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

  -- (4) Somebody's block is running RIGHT NOW.
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

comment on function public.claude_free_now(timestamptz) is
  'How much Claude quota may be used right now without booking, and until when. '
  'min(what claude_window_loads() says is left in the window containing this '
  'instant, what the week has left after reservations).';

-- ------------------------------------------------------------
-- §2 — the rail's boundary set learns the window RESET.
--
-- A band may only be drawn where the answer is constant across it. With chain
-- windows the answer changes at `booking_start + 5h`, and that instant was in
-- no other boundary: not a start, not an end, not a start−5h.
--
-- `starts_at + v_span` is a SUPERSET — it names the reset of a window every
-- booking would open, including bookings that in fact joined an earlier one and
-- open nothing. That is deliberate. A boundary too many splits one band into
-- two carrying the same number, which is invisible once the client merges
-- equal neighbours; a boundary too few draws a number that is wrong for hours.
-- Superset is the safe direction, and it is the direction that survives a
-- future change to how the chain picks its openers.
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
  v_reset    timestamptz;
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

  select five_hour_resets_at into v_reset
    from public.claude_usage_samples
   order by sampled_at desc limit 1;

  for b in
    select t from (
      select v_from as t
      union select v_reset
      union select starts_at          from public.claude_bookings
      union select ends_at            from public.claude_bookings
      union select starts_at - v_span from public.claude_bookings
      -- 0161: the window a booking OPENS resets five hours after it starts, and
      -- the next start gets a fresh pot. Nothing else in this union names it.
      union select starts_at + v_span from public.claude_bookings
      union select v_wk_end as t
    ) q
    where t is not null and t >= v_from and t <= v_wk_end
    order by t
  loop
    if v_prev is not null and b > v_prev then
      -- One second INSIDE, never at the edge: at the edge itself the answer can
      -- still be the PREVIOUS band's — that instant is the last start that
      -- earns it, not the first start of this one (0157).
      v_free := public.claude_free_now(v_prev + interval '1 second');
      v_out := v_out || jsonb_build_object(
        'starts_at', v_prev,
        'ends_at',   b,
        'free_pct',  v_free->'free_pct',
        'bound_by',  v_free->>'bound_by',
        'week_free_pct', v_free->'week'->'free_pct',
        'until',     v_free->>'until'
      );
    end if;
    v_prev := b;
  end loop;

  return v_out;
end $$;

comment on function public.claude_free_windows(timestamptz) is
  'Per-segment "start anywhere in here and you may take this much". A segment''s '
  'END is the LATEST START that still earns the previous, larger number.';
