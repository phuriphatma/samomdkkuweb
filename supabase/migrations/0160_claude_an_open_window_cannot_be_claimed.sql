-- ============================================================
-- 0160 — a 5-hour window that has already OPENED cannot be booked.
--
-- REPORTED, with the live numbers: *"but like i'm currently working ใช้ไป 82% ·
-- รีเซ็ต 16 ส.ค. 69 20:00 (อีก 3 ชม. 32 น.) current time is 16:28, someone could
-- just book 16.40-20.00 kick me out"*.
--
-- Reproduced exactly. 0159 stopped them taking 100% — the open window is an
-- anchor carrying `five_hour_pct` as its base load, so 82 + 100 > 100 was
-- refused. But 18% was ACCEPTED, and 5% was accepted, and that is enough to do
-- the damage: once somebody holds a booking over that stretch, the ข้อตกลง says
-- "รอบที่มีผู้จองไว้ เป็นของผู้จอง" and the person who has been working since
-- 15:00 is suddenly inside someone else's block.
--
-- ── WHY CLAMPING WAS THE WRONG SHAPE OF ANSWER ────────────────────────────
-- Capping the latecomer at the remainder looks fair and is not, because the
-- remainder is not a quantity anybody can promise. The person already in the
-- window may spend the other 18% in the next ten minutes — they are not doing
-- anything wrong, it is their session — so a booking for 18% inside it is a
-- reservation the system cannot honour. It is a hope wearing a booking's
-- clothes, and it hands its holder a claim over somebody else's work.
--
-- So: **an open window is not bookable at all.** Whoever sent the first message
-- opened it and holds it until it resets. The earliest a new block may start is
-- that reset instant.
--
-- This is not a restriction on the latecomer, and the error message says so:
-- they may still USE it right now, sharing, without booking anything — which is
-- exactly the thing the owner said they do not mind ("i don't care if who else
-- want to use with me"). What they may not do is acquire a claim.
--
-- ── WHAT THIS DOES NOT CHANGE ────────────────────────────────────────────
-- A window that has NOT opened yet still shares normally: 08:00–13:00 at 50%
-- still leaves 50% for whoever else books that window (0159 §1, the owner's own
-- case). This rule is only about a window that is already running, which is a
-- state only the MEASUREMENT can report.
--
-- ── THE FALSE POSITIVE, NAMED ────────────────────────────────────────────
-- Somebody uses 3% at 15:05 and stops. The window still reads open until 20:00,
-- so nobody may BOOK until then. That is a real cost and it is the right side
-- to err on: the alternative is handing out reservations that cannot be kept.
-- Anyone who wants that stretch can simply use it — it is unbooked — and the
-- message tells them so.
--
-- With no sample, or a sample whose window has already reset, nothing here
-- applies and booking behaves exactly as it did.
-- ============================================================

-- ------------------------------------------------------------
-- §1 — The open window, as one function, so the trigger and the form cannot
--      disagree about whether one is running.
--
-- Returns NULL when no window is open. `used_pct` is Claude's own reading, so
-- the message can say how much of it has gone.
-- ------------------------------------------------------------
create or replace function public.claude_open_window()
returns table (
  win_start timestamptz,
  win_end   timestamptz,
  used_pct  numeric
)
language plpgsql stable security definer set search_path = public as $$
declare
  s        public.claude_settings%rowtype;
  v_sample public.claude_usage_samples%rowtype;
begin
  select * into s from public.claude_settings where id;
  select * into v_sample from public.claude_usage_samples
   order by sampled_at desc limit 1;

  -- The same test claude_free_now() and claude_window_loads() use: a reset
  -- instant still ahead of us AND a non-zero reading. A window nobody has
  -- touched is not open — nothing has claimed it.
  if v_sample.id is null
     or v_sample.five_hour_resets_at is null
     or v_sample.five_hour_resets_at <= now()
     or coalesce(v_sample.five_hour_pct, 0) <= 0 then
    return;
  end if;

  win_end   := v_sample.five_hour_resets_at;
  win_start := win_end - make_interval(mins => s.session_minutes);
  used_pct  := v_sample.five_hour_pct;
  return next;
end $$;

revoke all on function public.claude_open_window() from public;
revoke all on function public.claude_open_window() from anon;
revoke all on function public.claude_open_window() from authenticated;

comment on function public.claude_open_window() is
  'The 5-hour window Claude reports as currently running, or no row. '
  'Internal — the gate lives in the trigger and the RPCs that call it.';

-- ------------------------------------------------------------
-- §2 — The guard learns the rule.
--
-- Placed BEFORE the capacity check so the message a person gets is the one that
-- explains their situation, rather than an arithmetic complaint about a window
-- they were never allowed to book in the first place.
--
-- AN UPDATE MAY STILL SHRINK OR MOVE OUT. The test is on the CLAIM, not on the
-- row: what matters is whether this write increases what the open window owes.
-- So someone who booked before the window opened can still cut their block
-- down, or cancel it; they simply cannot grow it once their neighbours are
-- already inside.
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
  v_open     record;
  v_prev     int;
begin
  select * into s from public.claude_settings where id;

  -- (1) one quota week.
  v_wk_start := public.claude_week_start(new.starts_at);
  v_wk_end   := v_wk_start + interval '7 days';
  if new.ends_at > v_wk_end then
    raise exception
      'ช่วงที่จองคร่อมเวลารีเซ็ตโควตาสัปดาห์ (%). แบ่งเป็นสองการจองคนละสัปดาห์',
      to_char(v_wk_end at time zone s.week_reset_tz, 'DD Mon HH24:MI');
  end if;

  -- (2) a window that has already opened belongs to whoever opened it.
  select * into v_open from public.claude_open_window();
  if v_open.win_start is not null
     and new.starts_at < v_open.win_end
     and new.ends_at   > v_open.win_start then

    -- What this row ALREADY claimed inside that window, so an edit that takes
    -- less (or cancels) is never refused.
    select coalesce(b.pct, 0) into v_prev
      from public.claude_bookings b
     where b.id = new.id
       and b.starts_at < v_open.win_end
       and b.ends_at   > v_open.win_start;

    if new.pct > coalesce(v_prev, 0) then
      raise exception
        'ช่วงนี้อยู่ในรอบ 5 ชั่วโมงที่มีคนเริ่มใช้ไปแล้ว (ใช้ไป %) — รอบนี้เป็นของคนที่เริ่มก่อน '
        'จองได้ตั้งแต่ % เป็นต้นไป หรือถ้าจะใช้ตอนนี้เลยก็ได้โดยไม่ต้องจอง (ใช้ร่วมกัน)',
        round(v_open.used_pct)::text || '%',
        to_char(v_open.win_end at time zone s.week_reset_tz, 'DD Mon HH24:MI');
    end if;
  end if;

  -- (3) the window rule (0159).
  select * into v_bad
    from public.claude_window_loads(new.id, new.starts_at, new.ends_at, new.pct)
   where load_pct > s.session_pool_pct
   order by load_pct desc
   limit 1;

  if v_bad.win_start is not null then
    select count(*) into v_others
      from public.claude_bookings b
     where b.id is distinct from new.id
       and b.starts_at < v_bad.win_end
       and b.ends_at   > v_bad.win_start;

    raise exception 'เกินโควตาเซสชัน — %. ช่วงนี้เหลือให้จอง % แต่ขอจอง %',
      case when v_bad.kind = 'live'
             then 'ขณะนี้มีผู้กำลังใช้งาน Claude อยู่ และรอบ 5 ชม. จะรีเซ็ตเวลา '
                  || to_char(v_bad.win_end at time zone s.week_reset_tz, 'HH24:MI')
           else 'ช่วง 5 ชม. ที่เริ่ม '
                || to_char(v_bad.win_start at time zone s.week_reset_tz, 'DD Mon HH24:MI')
                || ' เป็นโควตาก้อนเดียวกัน'
                || case when v_others > 0 then ' (ใช้ร่วมกับอีก ' || v_others || ' การจอง)' else '' end
                || ' — ถ้าเริ่มไม่เกิน '
                || to_char((v_bad.win_start - make_interval(mins => s.session_minutes))
                           at time zone s.week_reset_tz, 'DD Mon HH24:MI')
                || ' จะได้โควตาเต็มโดยไม่ต้องแบ่ง'
      end,
      greatest(0, s.session_pool_pct - (v_bad.load_pct - new.pct))::text || '%',
      new.pct::text || '%';
  end if;

  -- (4) the weekly pool.
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
-- §3 — The form must say it BEFORE the save, not after.
--
-- `max_pct` goes to 0 with `bound_by = 'open_window'`, and the window's reset
-- instant rides along so the modal can name the earliest bookable start and
-- offer the alternative (use it now, unbooked, sharing).
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
  v_open     record;
  v_prev     int;
  v_blocked  boolean := false;
begin
  if v_uid is null or not public.current_user_has_permission('claude') then
    raise exception 'claude_booking_limits: ไม่มีสิทธิ์เข้าถึงระบบจองโควตา Claude';
  end if;

  select * into s from public.claude_settings where id;
  v_span     := make_interval(mins => s.session_minutes);
  v_wk_start := public.claude_week_start(p_start);
  v_wk_end   := v_wk_start + interval '7 days';

  select win_start, win_end, used_pct into v_open from public.claude_open_window();
  if v_open.win_start is not null
     and p_start < v_open.win_end and p_end > v_open.win_start then
    select coalesce(b.pct, 0) into v_prev
      from public.claude_bookings b
     where b.id = p_id
       and b.starts_at < v_open.win_end
       and b.ends_at   > v_open.win_start;
    -- Already holding a claim in there? Then the cap is what you already have —
    -- you may keep or shrink it, not grow it.
    v_blocked := true;
  end if;

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
  if v_blocked then
    v_sess_max := coalesce(v_prev, 0);
    v_reason   := 'open_window';
  end if;

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
    -- Present ONLY when this range collides with a window that is already
    -- running. The form leads with this, because it is not a capacity problem
    -- and telling somebody "0% left" would send them to change the percentage.
    'open_window', case when v_blocked then jsonb_build_object(
      'starts_at', v_open.win_start,
      'ends_at',   v_open.win_end,
      'used_pct',  v_open.used_pct,
      'held_pct',  coalesce(v_prev, 0)
    ) else null end,
    'window', case when v_tight.win_start is null then null else jsonb_build_object(
      'starts_at', v_tight.win_start,
      'ends_at',   v_tight.win_end,
      'kind',      v_tight.kind,
      'load_pct',  v_max_load,
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
