-- ============================================================
-- 0158 — a booking that has finished SPENT its share; it did not hand it back.
--
-- Reported: *"why 18 august has rail show green 100% shouldn't it be 10%"*,
-- with the legend one card above reading "ว่างให้ใช้โดยไม่ต้องจอง 10%".
--
-- Both numbers came from claude_free_now(). Walking the segments makes the bug
-- obvious the moment they are put in a column — `week_free_pct` CLIMBS as the
-- instant being asked about moves forward:
--
--     11:33 → 14:39   week_free  10
--     17 Aug 13:00    week_free  60
--     18 Aug 05:45    week_free 160
--     19 Aug 06:00    week_free 260
--     19 Aug 11:45    week_free 360
--
-- THE PAIR IT USED WAS INCONSISTENT. `v_wk_left` is today's measurement (385
-- left of 700). `v_wk_reserved` was `ends_at > p_at` — the blocks still
-- outstanding AT THAT FUTURE INSTANT. So for a Tuesday question it subtracted
-- Tuesday's shrunken reservation list from Saturday's remaining pool, and every
-- booking that finished in between silently gave its quota back.
--
-- It does not come back. A block that runs is a block that SPENDS. Work it
-- through with the live numbers: 315 used, 375 still booked. If everyone uses
-- what they booked, the week ends at 690 of 700 and **10** is the unbooked
-- remainder — at every moment between now and the reset, not only right now.
-- The old code said 160 on Tuesday by counting the same 150% twice: once as
-- "no longer reserved" and never as "spent".
--
-- THE FIX is to pin the reservation set to NOW rather than to p_at. A booking
-- between now and p_at is still subtracted, because it is going to consume its
-- share before p_at arrives — which is exactly what makes the answer constant
-- across the rest of the week, and constant is the correct shape: how much is
-- left for unbooked use does not improve just by waiting.
--
-- `least(p_at, v_now)` and not a bare `v_now`: asked about a PAST instant the
-- honest reservation set is the one that was outstanding then, and that branch
-- stays right for anyone who calls it that way later.
--
-- This is the same class as the bug 0156 fixed one layer up — two quantities
-- from two different moments used in one subtraction — and it is worth noticing
-- that the first one was caught by the owner too. A mixed-scope arithmetic
-- error is invisible while you are looking at the present, because that is the
-- one instant where both scopes agree.
-- ============================================================

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
  v_win_start  timestamptz;
  v_win_end    timestamptz;
  v_win_open   boolean := false;
  v_win_used   numeric := 0;
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
  if v_win_end > v_wk_end then
    v_win_end := v_wk_end;
  end if;

  -- (2) What is claimed inside that window, from p_at forward. THIS one is
  -- correctly relative to p_at: it is about a single 5-hour window that opens
  -- at p_at, so only the blocks overlapping that window matter.
  select coalesce(sum(pct), 0) into v_sess_booked
    from public.claude_bookings
   where starts_at < v_win_end and ends_at > p_at;

  v_sess_free := greatest(0, s.session_pool_pct - v_win_used - v_sess_booked);

  -- (3) The week. `left` is measured AS OF NOW, so `reserved` must be as of now
  -- too — see the header. A block that runs between now and p_at spends its
  -- share rather than releasing it, so it stays subtracted.
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

  -- (4) Until when.
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

  -- (5) Somebody's block is running at p_at.
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
