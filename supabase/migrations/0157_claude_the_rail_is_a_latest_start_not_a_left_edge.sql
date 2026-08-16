-- ============================================================
-- 0157 — the capacity rail was wrong in two different ways at once.
--
-- Reported, with the state to reproduce it: now 16 Aug 11:00, the open 5-hour
-- window 52% spent and resetting at 14:39, the week 57% left (399%), and one
-- booking 17 Aug 08:00–13:00 for 50%. The rail drew a single orange band
-- "ว่าง 48%" from 11:00 all the way to 17 Aug 03:00.
--
-- ── BUG 1. A BOUNDARY THE COMMENT CLAIMED AND THE CODE NEVER HAD ───────────
-- 0155's header lists four instants where the answer can change and the fourth
-- is "the open window's own reset". The union below had three. So the 48% left
-- in the window open at 11:00 was carried across 14:39 — past the moment it
-- becomes a fresh 100% — for another twelve hours.
--
-- A comment describing a boundary set is not a boundary set. The proof caught
-- the other three because they came from the bookings table and were easy to
-- enumerate; this one comes from a MEASUREMENT, which is why it was the one
-- that got left out and why §E now pins all four with a scenario.
--
-- ── BUG 2. THE VALUE IS NOT CONSTANT AT THE LEFT EDGE ──────────────────────
-- This is the deeper one, and the owner stated it exactly:
--
--   *"if i had book for 100%, it would end show that you can begin using at
--    03.00 not after 03.00 … the line is showing when you start the latest,
--    and how much you can use"*
--
-- With a booking at 08:00, a session begun at exactly 03:00 runs 03:00–08:00
-- and ENDS as theirs opens, so it shares with nobody: 100%. Begun at 03:00:01
-- it runs to 08:00:01, their block is inside it, and you get what they left.
-- The function is therefore 100 at the single instant 03:00 and 50 across the
-- whole rest of [03:00, 08:00) — and the segment was being evaluated at its
-- LEFT EDGE, so the band was labelled 100% for five hours in which it is 50%.
--
-- Evaluating one second INSIDE each segment fixes it, and it also makes the
-- rail mean the right thing. A segment now answers "start anywhere in here and
-- you get this much", and its END is the LATEST START that still earns the
-- previous, larger number. 03:00 stops being a mislabelled boundary and becomes
-- the deadline it always was — which is what the owner asked to see.
--
-- The midpoint would work equally well while the boundary set is complete.
-- Start+1s is chosen because it degrades honestly if one is ever missing again:
-- it reports the value for the EARLIEST start in the range, so a band can only
-- ever be optimistic at its own edge, never across its middle.
-- ============================================================

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

  -- BUG 1's fix. The 5-hour window that is open RIGHT NOW ends at an instant
  -- only the measurement knows, and everything before it draws from what that
  -- window has left while everything after it starts a fresh 100%.
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
      union select v_wk_end as t
    ) q
    where t is not null and t >= v_from and t <= v_wk_end
    order by t
  loop
    if v_prev is not null and b > v_prev then
      -- BUG 2's fix: one second INSIDE, never at the edge. At the edge itself
      -- the answer can be the PREVIOUS band's — that instant is the last start
      -- that still earns it, not the first start of this one.
      v_free := public.claude_free_now(v_prev + interval '1 second');
      v_out := v_out || jsonb_build_object(
        'starts_at', v_prev,
        'ends_at',   b,
        'free_pct',  v_free->'free_pct',
        'bound_by',  v_free->>'bound_by',
        -- The weekly headroom for context: a band can read "100%" per session
        -- while the week behind it has only 349% left in total, and the owner
        -- asked to see that number too.
        'week_free_pct', v_free->'week'->'free_pct',
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
  'Per-segment "start anywhere in here and you may take this much". A segment''s '
  'END is the LATEST START that still earns the previous, larger number.';
