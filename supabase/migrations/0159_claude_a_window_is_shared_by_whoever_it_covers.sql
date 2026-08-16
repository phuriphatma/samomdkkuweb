-- ============================================================
-- 0159 — a 5-hour window is shared by EVERYONE it covers, and the guard has to
--        say so from both directions.
--
-- REPORTED: *"when someone book at 17 august 08.00-13.00 for 100%, another
-- people shouldn't can book after 03.00 … currently i can even book at 06.00
-- which shouldn't be"* — and the other half of the same rule: *"if someone book
-- 08.00-13.00 for 50%, another people should can book after 03.00 only max 50%,
-- but if start before 03.00 can for 100%"*.
--
-- ── THE BUG ────────────────────────────────────────────────────────────────
-- 0154 §5 checks the incoming row against `claude_sessions()` derived from the
-- OTHER rows. But claude_sessions() is greedy IN STARTS_AT ORDER: a row
-- inserted with an EARLIER start re-derives everybody else's session, and
-- nothing re-validates them. Measured on the live database, A = 08:00–13:00
-- @100%:
--
--     B starts 03:00  allow   ← correct (its window ends exactly as A opens)
--     B starts 03:01  ALLOW   ← wrong
--     B starts 06:00  ALLOW   ← wrong, the report
--     B starts 05:00 @1%   ALLOW   ← wrong
--     A 06:00 first, then B 08:00–13:00   DENY   ← wrong the OTHER way
--
-- The derived sessions after the third one are `07:00→12:00 @100` AND
-- `08:00→13:00 @100`: two windows overlapping four hours, each claiming a full
-- 100%, which one account cannot serve. And the last line is the mirror — the
-- straddle rule refused a pair that is perfectly legal (50 + 50) purely because
-- of the ORDER they were written in.
--
-- So the old guard was asymmetric by construction. Which of two bookings is
-- legal depended on which was typed first.
--
-- ── THE RULE THAT REPLACES IT ─────────────────────────────────────────────
-- One sentence, and it is a property of the SET of bookings, so it cannot
-- depend on insert order:
--
--     For every booking B, the bookings whose time overlaps
--     [B.starts_at, B.starts_at + 5h) must not claim more than 100% together.
--
-- That window is real: Claude opens its 5-hour window at the FIRST message, so
-- whoever starts first opens it and everyone landing inside shares its 100%.
-- Every one of the owner's cases falls out of it with nothing added:
--
--   A 08:00–13:00 @100  ·  B at 03:00 → window [03:00,08:00) holds only B ✔
--                       ·  B at 03:01 → window reaches 08:01, A is inside ✘
--                       ·  B at 06:00 → A is inside, 100+anything > 100 ✘
--   A 08:00–13:00 @50   ·  B at 06:00 @50 → 50+50 = 100 ✔
--                       ·  B at 06:00 @60 → 110 ✘
--                       ·  B at 02:00 @100 → window clears A entirely ✔
--
-- THE STRADDLE RULE IS GONE, and deliberately. It existed because a block
-- crossing a session edge had "undefined" arithmetic. Under the window rule it
-- is defined: every window the block touches is checked to have room for it, so
-- it does not matter which of them actually serves it. Dropping it is what
-- makes the 50 + 50 pair legal in BOTH orders.
--
-- ── THE THIRD ANCHOR: THE WINDOW THAT IS ALREADY OPEN ─────────────────────
-- Also reported: *"i'm using at 16.00, i see no one booking, so i use as free
-- session, then suddenly someone book so i have to stop my work?"*
--
-- Same rule, one more anchor. If the MEASUREMENT says a 5-hour window is open
-- right now, that window is an anchor like any booking's — its base load is the
-- utilization Claude itself reports. So a booking that lands inside a window
-- somebody already opened can only claim what that window has left. Nobody has
-- to stop working, nobody has to declare a session, and the person who started
-- first keeps what they are already using. First into the window wins, which is
-- exactly how Claude meters it.
--
-- The one honest limit: the sample is up to 15 minutes old, so a window opened
-- in the last few minutes is not visible yet. That is why the board grows a
-- manual refresh, and why the ข้อตกลง asks people to start on time.
--
-- ── ONE IMPLEMENTATION, THREE CALLERS ─────────────────────────────────────
-- claude_window_loads() enumerates the windows a candidate booking touches and
-- what each of them would then carry. The TRIGGER refuses when one goes over;
-- the MODAL reads the same function through claude_booking_limits() to cap its
-- slider before anyone presses save; the BOARD reads it per booking to draw how
-- much of each window is still free. Three readers, one piece of arithmetic —
-- the drift this repo pays for most.
-- ============================================================

-- ------------------------------------------------------------
-- §1 — Which 5-hour windows does a candidate booking touch, and what would
--      each of them carry?
--
-- The candidate is passed in rather than read from the table because the
-- trigger needs the answer BEFORE the row exists. `p_id` is excluded from the
-- existing set so an UPDATE does not fight its own old values.
--
-- WHICH INSTANTS CAN OPEN A WINDOW. Not every booking start — a booking that
-- falls INSIDE a window an earlier booking already opened does not open a
-- second one, it joins the first. So the openers are a chain, walked in start
-- order: the first booking opens a window, everything inside it joins, the
-- first booking past its end opens the next.
--
-- Getting this wrong in the obvious direction is expensive and was measured:
-- treating every start as an opener refuses a perfectly ordinary booking that
-- begins exactly when the previous window closes (claude0154 §A4 went red).
--
-- The window the MEASUREMENT says is open right now overrides the chain while
-- it lasts — it is the one window that is not a prediction.
--
-- WHAT THIS ASSUMES, said out loud: that people who book turn up. If the 08:00
-- holder never opens Claude, the 10:00 holder's first message opens the window
-- instead and it runs to 15:00, not 13:00. No arithmetic can see that in
-- advance, which is why "จองแล้วกรุณาเข้ามาใช้ และเริ่มให้ตรงเวลา" is a rule in
-- the ข้อตกลง and not a nicety.
--
-- Scanned from one span before the quota week's start: a booking may not
-- straddle the weekly reset, so nothing earlier than that can open a window
-- reaching into this one.
-- ------------------------------------------------------------
create or replace function public.claude_window_loads(
  p_id    uuid,
  p_start timestamptz,
  p_end   timestamptz,
  p_pct   int
)
returns table (
  win_start  timestamptz,
  win_end    timestamptz,
  kind       text,
  base_pct   numeric,
  booked_pct numeric,
  load_pct   numeric
)
language plpgsql stable security definer set search_path = public as $$
declare
  s           public.claude_settings%rowtype;
  v_span      interval;
  v_now       timestamptz := now();
  v_sample    public.claude_usage_samples%rowtype;
  v_live_s    timestamptz;
  v_live_e    timestamptz;
  v_live_used numeric := 0;
  v_scan_from timestamptz;
  v_open_end  timestamptz;          -- end of the window currently open in the chain
  ev          record;
begin
  select * into s from public.claude_settings where id;
  v_span      := make_interval(mins => s.session_minutes);
  v_scan_from := public.claude_week_start(p_start) - v_span;

  -- The window Claude says is open. Same test as claude_free_now(): a reset
  -- instant still ahead of us AND a non-zero reading, because a window nobody
  -- has used is not open.
  select * into v_sample from public.claude_usage_samples
   order by sampled_at desc limit 1;
  if v_sample.id is not null
     and v_sample.five_hour_resets_at is not null
     and v_sample.five_hour_resets_at > v_now
     and coalesce(v_sample.five_hour_pct, 0) > 0 then
    v_live_e    := v_sample.five_hour_resets_at;
    v_live_s    := v_live_e - v_span;
    v_live_used := v_sample.five_hour_pct;
  end if;

  -- The event stream: every booking that could open a window, the CANDIDATE
  -- itself (it can open one, and it can stop a later booking from opening one),
  -- and the live window injected at its own start so the chain has to obey it.
  for ev in
    -- rank 0 = the measurement, so at an equal instant it wins the tie: it is
    -- the one window here that is observed rather than predicted.
    select b.starts_at as at, 'booking'::text as k, 1 as rank
      from public.claude_bookings b
     where b.id is distinct from p_id
       and b.starts_at >= v_scan_from
       and b.starts_at <  p_start + v_span
    union all
    select p_start, 'new', 1
    union all
    select v_live_s, 'live', 0
     where v_live_s is not null and v_live_s >= v_scan_from
    order by 1, 3
  loop
    if ev.k = 'live' then
      win_start  := v_live_s;
      win_end    := v_live_e;
      kind       := 'live';
      base_pct   := v_live_used;
      v_open_end := v_live_e;                 -- overrides whatever the chain had
    elsif v_open_end is null or ev.at >= v_open_end then
      win_start  := ev.at;
      win_end    := ev.at + v_span;
      kind       := ev.k;
      base_pct   := 0;
      v_open_end := win_end;
    else
      continue;                               -- joins the window already open
    end if;

    -- Only the windows this candidate is actually inside can constrain it.
    if not (win_start < p_end and win_end > p_start) then
      continue;
    end if;

    -- What is already claimed inside it. For the LIVE window, only from now
    -- forward: whatever was spent earlier in it is already inside base_pct, and
    -- counting it twice would refuse a booking the account can actually serve.
    select coalesce(sum(b.pct), 0) into booked_pct
      from public.claude_bookings b
     where b.id is distinct from p_id
       and b.starts_at < win_end
       and b.ends_at   > (case when kind = 'live' then greatest(win_start, v_now)
                               else win_start end);

    -- …plus the candidate, which is inside by the test above.
    if kind <> 'live' or p_end > v_now then
      booked_pct := booked_pct + coalesce(p_pct, 0);
    end if;

    load_pct := base_pct + booked_pct;
    return next;
  end loop;
  return;
end $$;

revoke all on function public.claude_window_loads(uuid, timestamptz, timestamptz, int) from public;
revoke all on function public.claude_window_loads(uuid, timestamptz, timestamptz, int) from anon;
revoke all on function public.claude_window_loads(uuid, timestamptz, timestamptz, int) from authenticated;

comment on function public.claude_window_loads(uuid, timestamptz, timestamptz, int) is
  'Every 5-hour window a candidate booking touches, and what each would carry. '
  'Internal — the gate lives in the trigger and the RPCs that call it.';

-- ------------------------------------------------------------
-- §2 — The guard, rebuilt on §1.
--
-- Two rules survive from 0154 unchanged (one quota week; the weekly pool) and
-- the two session rules collapse into one call.
-- ------------------------------------------------------------
create or replace function public.claude_booking_guard()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  s          public.claude_settings%rowtype;
  v_wk_start timestamptz;
  v_wk_end   timestamptz;
  v_week_pct int;
  v_bad      record;
  v_others   int;
begin
  select * into s from public.claude_settings where id;

  -- (1) one quota week. Unchanged from 0154: a block spanning the reset draws
  -- from two pools and neither total would mean anything.
  v_wk_start := public.claude_week_start(new.starts_at);
  v_wk_end   := v_wk_start + interval '7 days';
  if new.ends_at > v_wk_end then
    raise exception
      'ช่วงที่จองคร่อมเวลารีเซ็ตโควตาสัปดาห์ (%). แบ่งเป็นสองการจองคนละสัปดาห์',
      to_char(v_wk_end at time zone s.week_reset_tz, 'DD Mon HH24:MI');
  end if;

  -- (2) the window rule. The TIGHTEST window is the one worth naming: telling
  -- somebody the third of four windows is full is not an answer they can act
  -- on.
  select * into v_bad
    from public.claude_window_loads(new.id, new.starts_at, new.ends_at, new.pct)
   where load_pct > s.session_pool_pct
   order by load_pct desc
   limit 1;

  -- `v_bad is null` on a record is true only when EVERY field is null, which is
  -- what a no-row SELECT leaves — but say it on a column that cannot be null in
  -- a real row, so the test cannot be read two ways.
  if v_bad.win_start is not null then
    select count(*) into v_others
      from public.claude_bookings b
     where b.id is distinct from new.id
       and b.starts_at < v_bad.win_end
       and b.ends_at   > v_bad.win_start;

    -- The percent sign is appended to the ARGUMENT, never written in the format
    -- string: in RAISE `%` is the placeholder and `%%` the literal, so "%%%"
    -- prints the sign on the wrong side of the number.
    raise exception 'เกินโควตาเซสชัน — %. ช่วงนี้เหลือให้จอง % แต่ขอจอง %',
      case when v_bad.kind = 'live'
             then 'ตอนนี้มีคนกำลังใช้ Claude อยู่ และรอบ 5 ชม. ของเขาจะรีเซ็ต '
                  || to_char(v_bad.win_end at time zone s.week_reset_tz, 'HH24:MI')
           else 'ช่วง 5 ชม. ที่เริ่ม '
                || to_char(v_bad.win_start at time zone s.week_reset_tz, 'DD Mon HH24:MI')
                || ' เป็นโควตาก้อนเดียวกัน'
                || case when v_others > 0 then ' (ใช้ร่วมกับอีก ' || v_others || ' การจอง)' else '' end
                || ' — ถ้าเริ่มไม่เกิน '
                || to_char((v_bad.win_start - make_interval(mins => s.session_minutes))
                           at time zone s.week_reset_tz, 'DD Mon HH24:MI')
                || ' จะไม่ต้องแบ่งกับใคร'
      end,
      greatest(0, s.session_pool_pct - (v_bad.load_pct - new.pct))::text || '%',
      new.pct::text || '%';
  end if;

  -- (3) the weekly pool. Unchanged.
  select coalesce(sum(pct), 0) into v_week_pct
    from public.claude_bookings
   where starts_at >= v_wk_start and starts_at < v_wk_end
     and id is distinct from new.id;
  if v_week_pct + new.pct > s.week_pool_pct then
    raise exception 'เกินโควตาสัปดาห์ — สัปดาห์นี้เหลือ %, ขอจอง %',
      (s.week_pool_pct - v_week_pct)::text || '%', new.pct::text || '%';
  end if;

  return new;
end $$;

-- ------------------------------------------------------------
-- §3 — The same arithmetic, offered to the FORM before anyone presses save.
--
-- WHY AN RPC AND NOT EIGHT LINES OF JAVASCRIPT. The modal has to cap its
-- slider, and a second implementation of the window rule in the browser is the
-- exact drift this file exists to remove. It is called when the DATE or the
-- TIMES change, never on the slider — `max_pct` does not depend on the pct
-- being asked for, so dragging the slider costs nothing.
--
-- `share_with` is the part people actually need: a cap with no name beside it
-- reads as the system being difficult. Naming who is in the window turns it
-- into "you and พู่กัน are in the same 5-hour pot", which is a fact anyone can
-- act on.
--
-- `next_up` is the START-ON-TIME half. If somebody's block sits within five
-- hours after yours ENDS, your lateness is their lateness — a session begun at
-- 16:15 resets at 21:15, not 21:00. The form says so, and so does Discord.
-- ------------------------------------------------------------
create or replace function public.claude_booking_limits(
  p_start  timestamptz,
  p_end    timestamptz,
  p_id     uuid default null
)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_uid      uuid := auth.uid();
  s          public.claude_settings%rowtype;
  v_span     interval;
  v_wk_start timestamptz;
  v_wk_end   timestamptz;
  v_max_load numeric;
  v_tight    record;
  v_week_pct int;
  v_week_max int;
  v_sess_max int;
  v_share    jsonb;
  v_next     jsonb;
  v_wall     timestamptz;
  v_reason   text := 'session';
begin
  if v_uid is null or not public.current_user_has_permission('claude') then
    raise exception 'claude_booking_limits: ไม่มีสิทธิ์เข้าถึงระบบจองโควตา Claude';
  end if;

  select * into s from public.claude_settings where id;
  v_span     := make_interval(mins => s.session_minutes);
  v_wk_start := public.claude_week_start(p_start);
  v_wk_end   := v_wk_start + interval '7 days';

  -- The tightest window this range touches, asked with the candidate at 0% so
  -- what comes back is the room that is left rather than the room after.
  select win_start, win_end, kind, load_pct into v_tight
    from public.claude_window_loads(p_id, p_start, p_end, 0)
   order by load_pct desc, win_start
   limit 1;
  v_max_load := coalesce(v_tight.load_pct, 0);
  v_sess_max := greatest(0, s.session_pool_pct - v_max_load)::int;

  select coalesce(sum(pct), 0) into v_week_pct
    from public.claude_bookings
   where starts_at >= v_wk_start and starts_at < v_wk_end
     and id is distinct from p_id;
  v_week_max := greatest(0, s.week_pool_pct - v_week_pct)::int;
  if v_week_max < v_sess_max then v_reason := 'week'; end if;
  if v_tight.kind = 'live' and v_sess_max <= v_week_max then v_reason := 'live'; end if;

  -- Who else is in the tightest window.
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', b.id, 'starts_at', b.starts_at, 'ends_at', b.ends_at,
           'pct', b.pct, 'person', public.claude_person(b.user_id)
         ) order by b.starts_at), '[]'::jsonb)
    into v_share
    from public.claude_bookings b
   where b.id is distinct from p_id
     and v_tight.win_start is not null
     and b.starts_at < v_tight.win_end
     and b.ends_at   > v_tight.win_start;

  -- The next block that would be pushed back by a late start. Within one span
  -- of this booking's END, because that is exactly the reach of the window this
  -- booking opens.
  select jsonb_build_object(
           'id', b.id, 'starts_at', b.starts_at, 'ends_at', b.ends_at,
           'pct', b.pct, 'person', public.claude_person(b.user_id)
         )
    into v_next
    from public.claude_bookings b
   where b.id is distinct from p_id
     and b.starts_at >= p_end
     and b.starts_at <  p_start + v_span
   order by b.starts_at limit 1;

  -- How far may this block run? The 5-hour ceiling, the next block, the weekly
  -- reset. The session EDGE is deliberately NOT a wall any more — §2 dropped
  -- the straddle rule, so a block may cross one as long as every window it
  -- touches has room.
  v_wall := least(p_start + v_span, v_wk_end);
  select least(v_wall, min(b.starts_at)) into v_wall
    from public.claude_bookings b
   where b.id is distinct from p_id
     and b.starts_at > p_start and b.starts_at < v_wall;

  return jsonb_build_object(
    'max_pct',     least(v_sess_max, v_week_max),
    'session_max_pct', v_sess_max,
    'week_max_pct',    v_week_max,
    'bound_by',    v_reason,
    'max_end',     v_wall,
    'window', case when v_tight.win_start is null then null else jsonb_build_object(
      'starts_at', v_tight.win_start,
      'ends_at',   v_tight.win_end,
      'kind',      v_tight.kind,
      'load_pct',  v_max_load,
      -- The instant after which you would start sharing this window. Nothing on
      -- a calendar marks it, and it is the single most useful thing here.
      'clear_before', v_tight.win_start - v_span
    ) end,
    'share_with', coalesce(v_share, '[]'::jsonb),
    'next_up',    v_next,
    'session_pool_pct', s.session_pool_pct,
    'week_pool_pct',    s.week_pool_pct
  );
end $$;

revoke all on function public.claude_booking_limits(timestamptz, timestamptz, uuid) from public;
revoke all on function public.claude_booking_limits(timestamptz, timestamptz, uuid) from anon;
grant execute on function public.claude_booking_limits(timestamptz, timestamptz, uuid) to authenticated;

comment on function public.claude_booking_limits(timestamptz, timestamptz, uuid) is
  'How much may this range claim, until when may it run, and who shares its '
  '5-hour window. The form reads this so the slider cannot offer an illegal value.';

-- ------------------------------------------------------------
-- §4 — The board carries each booking's own window.
--
-- The green session FRAMES came from claude_sessions(), a greedy partition —
-- and a partition is the wrong shape for this rule, because two bookings can
-- legitimately share one window while a third shares only part of it. Under
-- §1 every booking simply HAS a window: [starts_at, starts_at + 5h). Drawing
-- that, per block, is the rule itself rather than a summary of it.
--
-- `window_free_pct` is what is left in a block's own window — the number the
-- owner asked to be able to read off the rectangle: *"หากจอง session token ไว้
-- ไม่ถึง 100% เช่น จองไว้ 50% เป็นเวลา 3 ชม. คนอื่นสามารถจองต่อได้อีก 50% ใน 2
-- ชม.หลัง ดูได้จากสี่เหลี่ยมที่โชว์บนเว็บ"*.
--
-- `sessions` stays in the payload untouched. Deploy first, drop second — the
-- SERVED bundle still reads it until the new one is live.
-- ------------------------------------------------------------
create or replace function public.get_claude_board(p_at timestamptz default now())
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_uid      uuid := auth.uid();
  s          public.claude_settings%rowtype;
  v_span     interval;
  v_wk_start timestamptz;
  v_wk_end   timestamptz;
  v_now      timestamptz := now();
  v_books    jsonb := '[]'::jsonb;
  v_sess     jsonb := '[]'::jsonb;
  v_week_pct int;
  v_reserved int;
  v_meas     numeric;
  v_load     numeric;
  b          record;
  cs         record;
  v_sample   public.claude_usage_samples%rowtype;
begin
  if v_uid is null or not public.current_user_has_permission('claude') then
    raise exception 'get_claude_board: ไม่มีสิทธิ์เข้าถึงระบบจองโควตา Claude';
  end if;

  select * into s from public.claude_settings where id;
  v_span     := make_interval(mins => s.session_minutes);
  v_wk_start := public.claude_week_start(p_at);
  v_wk_end   := v_wk_start + interval '7 days';

  for b in
    select * from public.claude_bookings
     where starts_at >= v_wk_start and starts_at < v_wk_end
     order by starts_at
  loop
    -- Everything claimed inside THIS booking's own 5-hour window, itself
    -- included. One read of the same rule §1 enforces.
    select coalesce(sum(x.pct), 0) into v_load
      from public.claude_bookings x
     where x.starts_at < b.starts_at + v_span
       and x.ends_at   > b.starts_at;

    v_books := v_books || jsonb_build_object(
      'id',        b.id,
      'starts_at', b.starts_at,
      'ends_at',   b.ends_at,
      'pct',       b.pct,
      'purpose',   b.purpose,
      'is_mine',   (b.user_id = v_uid),
      'person',    public.claude_person(b.user_id),
      -- The block's own window, and what is left in it for anyone else.
      'window_ends_at',  b.starts_at + v_span,
      'window_load_pct', v_load,
      'window_free_pct', greatest(0, s.session_pool_pct - v_load)
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

  select coalesce(sum(pct), 0) into v_reserved
    from public.claude_bookings
   where starts_at >= v_wk_start and starts_at < v_wk_end
     and ends_at > v_now;

  select seven_day_pct into v_meas
    from public.claude_usage_samples
   where sampled_at >= v_wk_start and sampled_at < v_wk_end
     and seven_day_pct is not null
   order by sampled_at desc limit 1;

  select * into v_sample from public.claude_usage_samples
   order by sampled_at desc limit 1;

  return jsonb_build_object(
    'week', jsonb_build_object(
      'starts_at',  v_wk_start,
      'ends_at',    v_wk_end,
      'pool_pct',   s.week_pool_pct,
      'used_pct',   v_week_pct,
      'is_current', (v_now >= v_wk_start and v_now < v_wk_end),
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
    'me',           public.claude_person(v_uid),
    'right_now',    public.claude_free_now(),
    'free_windows', public.claude_free_windows(p_at),
    'bookings',     v_books,
    'sessions',     v_sess,
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
-- §5 — claude_sessions(), brought into step with the rule that now governs.
--
-- The green frames on the calendar are drawn from this, and after §1 they were
-- describing a slightly different rule from the one being enforced. Two
-- differences, both of which would have shown up as a frame whose "เหลือ N%"
-- did not match what the form would let anyone book:
--
--   • A booking OPENED a new session unless it fitted ENTIRELY inside the last
--     one. Under §1 it opens one unless it STARTS inside — a block that begins
--     inside somebody's window and runs past its end joins that window and does
--     not get one of its own. (It is why 0154 drew two overlapping frames each
--     claiming a full 100%, which is what one account cannot serve.)
--   • `used_pct` summed only the bookings that had joined. The load on a window
--     is everything that OVERLAPS it, which includes a block that started
--     before the window opened and is still running when it does.
--
-- Same signature, same four columns — `create or replace` cannot change a
-- return type and does not need to here. The SERVED bundle keeps rendering.
-- ------------------------------------------------------------
create or replace function public.claude_sessions(
  p_from timestamptz,
  p_to   timestamptz
)
returns table (
  session_start timestamptz,
  session_end   timestamptz,
  used_pct      int,
  booking_ids   uuid[]
)
language plpgsql stable security definer set search_path = public as $$
declare
  s          public.claude_settings%rowtype;
  v_span     interval;
  v_open_end timestamptz;
  b          record;
begin
  select * into s from public.claude_settings where id;
  v_span := make_interval(mins => s.session_minutes);

  for b in
    select id, starts_at from public.claude_bookings
     where starts_at >= p_from and starts_at < p_to
     order by starts_at, created_at
  loop
    -- Opens a window only if the previous one has already closed.
    if v_open_end is null or b.starts_at >= v_open_end then
      if v_open_end is not null then
        return next;
      end if;
      session_start := b.starts_at;
      session_end   := b.starts_at + v_span;
      v_open_end    := session_end;

      -- Everything that overlaps it, not only what began inside it.
      select coalesce(sum(x.pct), 0),
             coalesce(array_agg(x.id order by x.starts_at), '{}'::uuid[])
        into used_pct, booking_ids
        from public.claude_bookings x
       where x.starts_at < session_end
         and x.ends_at   > session_start;
    end if;
  end loop;

  if v_open_end is not null then
    return next;
  end if;
  return;
end $$;

revoke all on function public.claude_sessions(timestamptz, timestamptz) from public;
revoke all on function public.claude_sessions(timestamptz, timestamptz) from anon;
revoke all on function public.claude_sessions(timestamptz, timestamptz) from authenticated;
