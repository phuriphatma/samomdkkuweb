-- ============================================================
-- 0167 — the Claude usage reporter gets an OFF switch, and a stale reading
--        stops counting as a reading.
--
-- WHY
-- SAMO's Claude subscription lapsed. The reporter on the VM kept polling
-- `oauth/usage` every 15 minutes, kept getting HTTP 403, and kept posting
-- "สิทธิ์เข้าถึงหมดอายุ" into Discord — four times a day, about a condition
-- nobody could fix until the subscription is renewed. The only way to stop it
-- was `systemctl disable` over ssh on the VM, behind the VPN, which:
--   • no admin without ssh can do,
--   • leaves the board showing the last sample with no explanation, and
--   • is invisible — nothing in the app knows measurement has stopped.
--
-- So the switch moves into the product: an admin turns measurement off, says
-- why, and everyone with the `claude` grant sees that on the board. BOOKING IS
-- UNAFFECTED. The board's whole job is coordinating a shared login; that job
-- does not depend on the measurement, and taking bookings away would punish
-- everyone for an account problem.
--
-- THE SECOND HALF, WHICH IS THE ONE THAT WOULD HAVE BITTEN
-- Turning the reporter off freezes `claude_usage_samples`. Three functions read
-- "the newest sample" with no bound at all:
--
--   claude_free_now()      → v_wk_left := (100 - seven_day_pct) * week_pool/100
--   get_claude_board()     → the `measured` strip
--   claude_open_window()   → the 5-hour window the booking guard honours
--
-- The 5-hour readers are self-healing: every one of them tests
-- `five_hour_resets_at > now()`, so a frozen 5-hour window falls out of play
-- within five hours on its own. THE SEVEN-DAY READER IS NOT. Freeze sampling,
-- let the quota week roll over at Wed 16:00, and claude_free_now() goes on
-- reporting the previous week as 61% spent — for ever. That is the same defect
-- 0156 fixed for the week CARD ("in next next week, it still show ใช้ไปแล้วจริง
-- value", docs/mistakes/app-state.md), still live on the hero panel because the
-- hero means *now* and nobody had made "now" expire.
--
-- Which is the real rule, and it is not about the switch at all:
--
--     A MEASUREMENT THAT MEANS "RIGHT NOW" IS ONLY USABLE WHILE IT IS FRESH.
--
-- The switch merely makes staleness permanent instead of momentary. A dead
-- timer, a crashed VM or a revoked credential produce exactly the same frozen
-- number — silently, with no admin having chosen anything. So the fix is a
-- freshness bound on the READ, not a special case for the switch, and
-- `monitoring_enabled = false` is simply one more way for the newest sample to
-- be unusable.
--
-- §4 gives that rule ONE HOME — `claude_latest_sample()` — because this repo's
-- most expensive bug class is two implementations of one rule drifting, and
-- 0161 already paid for it once inside this very feature ("one home means one
-- FUNCTION, not one tier").
--
-- WHAT IS DELIBERATELY *NOT* GATED
--   • `get_claude_usage_log()` / `claude_usage_runs()` — history is honestly
--     history. A sample from last Tuesday is a true fact about last Tuesday; a
--     pause must not erase the record of what was measured before it.
--   • `week.measured_used_pct` in get_claude_board() — already scoped to the
--     week on screen by 0156, so it goes NULL by itself at the next rollover.
--   • `claude_open_window()` / `claude_window_loads()` — self-expiring, above.
--     Gating them would refuse a window that really is open during the first
--     five hours of a pause, which would be a WORSE answer, not a safer one.
-- ============================================================

-- ------------------------------------------------------------
-- §1 — the switch, on the settings row that already exists.
--
-- claude_settings is one row (`id boolean primary key default true check (id)`),
-- seeded by 0154, and its UPDATE policy is already the admin gate:
-- vp_admin | dev | master. Nothing about access changes here.
--
-- THE REASON IS REQUIRED WHEN OFF, and required in the DATABASE. It is the only
-- thing on the paused board that answers the question a booker actually has —
-- "is this broken, or did somebody do this on purpose?" — and a rule enforced
-- only in the form is a suggestion (the same argument 0154 makes for the
-- 5-hour ceiling living in a CHECK).
-- ------------------------------------------------------------
alter table public.claude_settings
  add column if not exists monitoring_enabled    boolean not null default true,
  add column if not exists monitoring_note       text,
  add column if not exists monitoring_changed_at timestamptz,
  add column if not exists monitoring_changed_by uuid
    references public.users(id) on delete set null;

-- How old a sample may be and still describe "right now". The reporter's timer
-- is 15 minutes, so 45 is three consecutive missed ticks — long enough that a
-- single rate-limited tick (which the reporter treats as a normal skip) never
-- blanks the board, short enough that a dead timer is caught within the hour.
--
-- It lives in settings rather than as a constant because the frontend needs the
-- SAME number to decide when to print "ข้อมูลค้าง", and it had its own
-- hardcoded 35 minutes until now — two authors of one threshold, which is the
-- drift this repo pays for most. Published in get_claude_board().settings; the
-- JS reads it instead of its own literal.
alter table public.claude_settings
  add column if not exists sample_stale_minutes smallint not null default 45;

do $$
begin
  if not exists (select 1 from pg_constraint
                  where conname = 'claude_settings_stale_minutes_sane') then
    alter table public.claude_settings
      add constraint claude_settings_stale_minutes_sane
      check (sample_stale_minutes between 15 and 1440);
  end if;

  -- OFF requires a reason. ON may carry one or not: the note is kept after a
  -- resume so the "กลับมาติดตามแล้ว" announcement can say what it had been off
  -- for, and clearing it would destroy that at exactly the moment it is read.
  if not exists (select 1 from pg_constraint
                  where conname = 'claude_settings_off_needs_a_reason') then
    alter table public.claude_settings
      add constraint claude_settings_off_needs_a_reason
      check (monitoring_enabled
             or length(btrim(coalesce(monitoring_note, ''))) between 3 and 300);
  end if;

  if not exists (select 1 from pg_constraint
                  where conname = 'claude_settings_note_len') then
    alter table public.claude_settings
      add constraint claude_settings_note_len
      check (monitoring_note is null or length(btrim(monitoring_note)) <= 300);
  end if;
end $$;

-- ------------------------------------------------------------
-- §2 — WHO flipped it is stamped by the database, not claimed by the client.
--
-- claude_settings_write is a ROW-level UPDATE policy with no column guard —
-- correct here, because every column on this row is an admin setting by design
-- — but that means an admin's PATCH could name anybody as the person who
-- paused measurement. The stamp is the one fact on the row that is about a
-- PERSON rather than a setting, so the trigger owns it and overwrites whatever
-- arrived.
--
-- `is distinct from` on both fields, so re-saving an unrelated setting (the
-- week reset time, say) does not rewrite the pause stamp and make a two-week-old
-- pause look like it happened just now.
-- ------------------------------------------------------------
create or replace function public.claude_settings_stamp_monitoring()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.monitoring_enabled is distinct from old.monitoring_enabled
     or btrim(coalesce(new.monitoring_note, ''))
        is distinct from btrim(coalesce(old.monitoring_note, '')) then
    new.monitoring_changed_at := now();
    new.monitoring_changed_by := auth.uid();
  else
    new.monitoring_changed_at := old.monitoring_changed_at;
    new.monitoring_changed_by := old.monitoring_changed_by;
  end if;
  return new;
end $$;

drop trigger if exists stamp_claude_monitoring on public.claude_settings;
create trigger stamp_claude_monitoring
  before update on public.claude_settings
  for each row execute function public.claude_settings_stamp_monitoring();

-- ------------------------------------------------------------
-- §3 — reading the switch does NOT need the `claude` grant.
--
-- claude_settings_read is gated on `current_user_has_permission('claude')`, and
-- that is right for the pool sizes and the reset schedule. But the reporter on
-- the VM has to ask "am I switched off?" before it does anything else, and the
-- honest smallest answer to that question is a boolean — not the settings row.
--
-- It is exposed as its own function returning exactly that boolean, so the
-- reporter account keeps working even if its `claude` grant is ever narrowed,
-- and so nothing about the pool or the schedule rides along on a read whose
-- only job is "should I poll?".
-- ------------------------------------------------------------
create or replace function public.claude_monitoring_enabled()
returns boolean
language sql stable security definer set search_path = public as $$
  select monitoring_enabled from public.claude_settings where id;
$$;

revoke all on function public.claude_monitoring_enabled() from public;
revoke all on function public.claude_monitoring_enabled() from anon;
grant execute on function public.claude_monitoring_enabled() to authenticated;

comment on function public.claude_monitoring_enabled() is
  'Is the Claude usage reporter switched on? The reporter asks this BEFORE it '
  'touches Anthropic, so a pause costs zero calls to their API.';

-- ------------------------------------------------------------
-- §4 — ONE home for "the newest sample, if it can still be believed".
--
-- Every caller that means *right now* reads through this. Two ways it returns
-- nothing, and they are the same condition wearing different clothes:
--   • an admin switched measurement off, so no sample is being taken;
--   • the newest sample is older than sample_stale_minutes, so whatever is
--     taking them has stopped without anyone deciding that.
--
-- NO ROW, never a zero row. A zero reads as a reading — the rule the board has
-- followed since 0154 ("deliberately blank rather than zero") — and every
-- caller already has a null-sample branch built for "the reporter never ran".
-- Returning nothing routes a pause straight down a path that was designed,
-- tested and shipped, instead of down a new one.
--
-- `setof` rather than a composite so callers keep their existing
-- `select * into v_sample from …` shape verbatim; the only edit at each call
-- site is the FROM.
-- ------------------------------------------------------------
create or replace function public.claude_latest_sample()
returns setof public.claude_usage_samples
language sql stable security definer set search_path = public as $$
  select s.*
    from public.claude_usage_samples s
   where (select cs.monitoring_enabled from public.claude_settings cs where cs.id)
     and s.sampled_at > now() - make_interval(
           mins => (select cs.sample_stale_minutes
                      from public.claude_settings cs where cs.id))
   order by s.sampled_at desc
   limit 1;
$$;

-- Internal. It reads claude_usage_samples with the owner's rights, so granting
-- it to `authenticated` would publish the measurement to every signed-in
-- account with no `claude` grant anywhere in the path — the same reasoning
-- 0154 gives for claude_sessions() and claude_week_start().
revoke all on function public.claude_latest_sample() from public;
revoke all on function public.claude_latest_sample() from anon;
revoke all on function public.claude_latest_sample() from authenticated;

comment on function public.claude_latest_sample() is
  'The newest usage sample, but only while it can still describe RIGHT NOW: '
  'no row when measurement is switched off, and no row once the newest sample '
  'is older than claude_settings.sample_stale_minutes.';

-- ------------------------------------------------------------
-- §5 — claude_free_now(): the frozen weekly reading, fixed.
--
-- Body taken from `pg_get_functiondef` on the LIVE database and diffed, NOT
-- from 0161's text — 0161's own header records what happened the last time
-- someone rebuilt this function from an older migration (it silently reverted
-- 0158, and claude0155 §C3 caught it). Exactly two lines differ from live:
-- the sample read below, and nothing else.
--
-- What changes for a reader: when the sample cannot be believed, `v_wk_left`
-- is null, `v_free` falls back to the session's own free percent, and
-- `bound_by` says 'session'. That branch is the one that has shipped since
-- 0155 for "the reporter has never run".
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
  v_win_used   numeric := 0;
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

  -- ⚠️ THE ONLY LINE THAT DIFFERS FROM THE 0161 BODY. Was an unbounded
  -- `select * into v_sample from public.claude_usage_samples order by
  -- sampled_at desc limit 1`, which never stopped believing its last reading.
  select * into v_sample from public.claude_latest_sample();

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

  -- `left` is measured AS OF NOW, so `reserved` must be as of now too (0158):
  -- a block that runs between now and p_at SPENDS its share rather than
  -- releasing it, so it stays subtracted. `least(p_at, v_now)` and not a bare
  -- `v_now` — asked about a PAST instant the reservation list is that
  -- instant's. DO NOT rewrite this line from an older migration; that is
  -- precisely what reverted 0158 once already.
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
  'instant, what the week has left after reservations). The weekly half is '
  'omitted entirely when no BELIEVABLE sample exists (claude_latest_sample).';

-- ------------------------------------------------------------
-- §6 — get_claude_board(): publish the switch, and stop the `measured` strip
--      drawing a reading nobody took.
--
-- Body taken from the LIVE database (identical to 0159's, comments aside) with
-- three edits, all named here so the next reader does not have to diff 120
-- lines to find them:
--   1. the `measured` sample now comes from claude_latest_sample();
--   2. `settings` carries `sample_stale_minutes`, so the frontend stops
--      carrying its own 35-minute copy of that threshold;
--   3. `settings.monitoring` carries the switch, the reason, when, and WHO —
--      resolved through claude_person(), the projection this feature already
--      uses for every other name it shows. Storing the name on the row would be
--      a second copy of a fact team_members owns, which 0154 refuses by name.
--
-- `week.measured_used_pct` is untouched: it is already scoped to the week on
-- screen (0156), so it goes null by itself at the next rollover.
-- ------------------------------------------------------------
create or replace function public.get_claude_board(p_at timestamptz default now())
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_uid      uuid := auth.uid();
  s          public.claude_settings%rowtype;
  v_span     interval;
  v_now      timestamptz := now();
  v_wk_start timestamptz;
  v_wk_end   timestamptz;
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

  -- Week-scoped by 0156 and deliberately NOT routed through
  -- claude_latest_sample(): "what did we measure during the week on screen" is
  -- a question about that week, and it answers null for a week with no samples
  -- in it — including every week after a pause begins.
  select seven_day_pct into v_meas
    from public.claude_usage_samples
   where sampled_at >= v_wk_start and sampled_at < v_wk_end
     and seven_day_pct is not null
   order by sampled_at desc limit 1;

  select * into v_sample from public.claude_latest_sample();

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
      'plan_label',       s.plan_label,
      'sample_stale_minutes', s.sample_stale_minutes,
      'monitoring', jsonb_build_object(
        'enabled',    s.monitoring_enabled,
        'note',       s.monitoring_note,
        'changed_at', s.monitoring_changed_at,
        'changed_by', case when s.monitoring_changed_by is null then null
                           else public.claude_person(s.monitoring_changed_by) end
      )
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
-- §7 — claude_free_windows(): the fourth reader, routed through the one home.
--
-- This one is a CONSISTENCY change, not a bug fix, and saying which is which
-- matters: the rail uses the newest sample's `five_hour_resets_at` only as a
-- candidate BOUNDARY, and the union that collects it already drops nulls and
-- anything before `v_from` — so a stale reset instant, being in the past, was
-- inert. Behaviour is unchanged.
--
-- It is changed anyway because leaving it is how the drift starts. After §4
-- there is exactly ONE expression in this schema for "the newest sample, as a
-- statement about now", and the next person to touch the rule must not find a
-- second copy sitting one function away that happens not to matter today.
--
-- Body from the LIVE database; the sample read is the only edit.
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

  select five_hour_resets_at into v_reset from public.claude_latest_sample();

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
