-- ============================================================
-- claude0159-window-share.sql — does the booking guard hold the rule that a
-- 5-hour window is shared by EVERYONE it covers, from BOTH directions?
--
-- THE RULE (0159): for every window opened in the chain, the bookings whose
-- time overlaps [open, open + 5h) may not claim more than 100% together. The
-- window the MEASUREMENT says is open right now is an anchor too, carrying the
-- utilization Claude itself reports as its base load.
--
-- WHY THIS FILE EXISTS. 0154's guard checked the incoming row against sessions
-- derived from the OTHER rows, and that derivation is greedy in starts_at
-- order — so a row inserted with an EARLIER start silently re-derived everyone
-- else's session and nothing re-validated them. Measured live: with
-- 08:00–13:00 @100% standing, a booking at 06:00 was ACCEPTED, and the pair
-- 06:00@50 + 08:00@50 was REFUSED. Same physical situation, opposite answers,
-- decided by typing order.
--
-- BOTH DIRECTIONS ON EVERY RULE. A deny-only probe cannot tell a working guard
-- from a broken service: if the trigger raised on everything, a deny-only run
-- would print all-green. So every DENY below sits beside an ALLOW over the same
-- shape of rows, and §D is nothing but allows — the cases a guard that is
-- merely too strict would fail.
--
-- ISOLATION. Each case runs alone: pg_temp.solo() inserts booking A, tries
-- booking B, and rolls BOTH back. The first draft of this probe was cumulative
-- and an earlier ALLOWED row made a later case deny FOR THE WRONG REASON —
-- three greens that were measuring nothing. Isolation is the assertion here.
--
-- SUBJECT AND WEEK. The account is resolved from the data, never named. The
-- scenario runs in a FUTURE, EMPTY quota week (Mon 2027-08-16, inside the week
-- that resets Wed 2027-08-11 16:00 ICT), so no live row is read or touched and
-- no DELETE is needed anywhere. §C0 is the control that says the week really is
-- empty — without it every allow below could be an accident of real data.
--
--   node tools/db-query.mjs tools/claude0159-window-share.sql
-- ============================================================

begin;

create temp table probe (step text, expected text, got text) on commit drop;

-- ── the instrument ─────────────────────────────────────────────────────────
-- Insert A, try B, undo both, report B's verdict. The `raise exception 'undo'`
-- unwinds the whole subtransaction, so A never survives into the next case.
create function pg_temp.solo(
  a_start timestamptz, a_mins int, a_pct int,
  b_start timestamptz, b_mins int, b_pct int)
returns text language plpgsql as $$
declare v text; u uuid;
begin
  select id into u from public.users order by created_at limit 1;
  begin
    insert into public.claude_bookings (user_id, starts_at, ends_at, pct, purpose)
    values (u, a_start, a_start + make_interval(mins => a_mins), a_pct, 'proof A');
    begin
      insert into public.claude_bookings (user_id, starts_at, ends_at, pct, purpose)
      values (u, b_start, b_start + make_interval(mins => b_mins), b_pct, 'proof B');
      v := 'allow';
    exception when others then
      v := 'deny';
    end;
    raise exception 'undo';
  exception when others then
    -- Anything other than our own unwind means A itself was refused, which
    -- would make B's verdict meaningless. Say so rather than scoring it.
    if sqlerrm <> 'undo' then v := 'A-REFUSED:' || left(sqlerrm, 60); end if;
  end;
  return v;
end $$;

-- One booking alone, no A. Used by §C, where the other party is a MEASUREMENT.
create function pg_temp.only(b_start timestamptz, b_mins int, b_pct int)
returns text language plpgsql as $$
declare v text; u uuid;
begin
  select id into u from public.users order by created_at limit 1;
  begin
    insert into public.claude_bookings (user_id, starts_at, ends_at, pct, purpose)
    values (u, b_start, b_start + make_interval(mins => b_mins), b_pct, 'proof solo');
    v := 'allow';
    raise exception 'undo';
  exception when others then
    if sqlerrm <> 'undo' then v := 'deny'; end if;
  end;
  return v;
end $$;

insert into probe select 'C0. the probe week is empty (a proof over real rows proves nothing)', '0',
  (select count(*) from public.claude_bookings
    where starts_at >= '2027-08-11 16:00+07' and starts_at < '2027-08-18 16:00+07')::text;

insert into probe select 'C0b. a subject account exists', '1',
  (select count(*) from (select id from public.users order by created_at limit 1) q)::text;

-- ══ §A. THE REPORT — A holds 08:00–13:00 at 100%. Where may B start? ═══════
-- "another people shouldn't can book after 03.00 … currently i can even book
--  at 06.00 which shouldn't be"
insert into probe values
 ('A1. B at 01:00 — its window ends 06:00, clear of A', 'allow',
   pg_temp.solo('2027-08-16 08:00+07',300,100, '2027-08-16 01:00+07',60,100)),
 ('A2. B at 03:00 — window ends EXACTLY as A opens (the deadline is inclusive)', 'allow',
   pg_temp.solo('2027-08-16 08:00+07',300,100, '2027-08-16 03:00+07',120,100)),
 ('A3. B at 03:01 — window reaches 08:01, so A is inside it', 'deny',
   pg_temp.solo('2027-08-16 08:00+07',300,100, '2027-08-16 03:01+07',60,100)),
 ('A4. B at 06:00 — THE REPORTED CASE', 'deny',
   pg_temp.solo('2027-08-16 08:00+07',300,100, '2027-08-16 06:00+07',60,100)),
 ('A5. B at 07:00–08:00 — abuts A but shares A''s window', 'deny',
   pg_temp.solo('2027-08-16 08:00+07',300,100, '2027-08-16 07:00+07',60,100)),
 ('A6. B at 05:00 for ONE percent — a full window leaves room for nothing', 'deny',
   pg_temp.solo('2027-08-16 08:00+07',300,100, '2027-08-16 05:00+07',60,1));

-- ══ §B. THE OTHER HALF — A holds 08:00–13:00 at 50%. ══════════════════════
-- "another people should can book after 03.00 only max 50%, but if start
--  before 03.00 can for 100%"
insert into probe values
 ('B1. B at 06:00 for 50 — the two share one 100%', 'allow',
   pg_temp.solo('2027-08-16 08:00+07',300,50, '2027-08-16 06:00+07',60,50)),
 ('B2. B at 06:00 for 60 — 110 does not fit in one window', 'deny',
   pg_temp.solo('2027-08-16 08:00+07',300,50, '2027-08-16 06:00+07',60,60)),
 ('B3. B at 02:00 for 100 — before the deadline, so the pool is whole', 'allow',
   pg_temp.solo('2027-08-16 08:00+07',300,50, '2027-08-16 02:00+07',60,100)),
 -- The SYMMETRY case, and the one 0154 got backwards: written in the other
 -- order this identical pair used to be refused as "straddling a session edge".
 ('B4. the same pair typed in the OTHER order is still legal', 'allow',
   pg_temp.solo('2027-08-16 06:00+07',60,50,  '2027-08-16 08:00+07',300,50)),
 ('B5. …and still illegal at 100 + 100 in that order too', 'deny',
   pg_temp.solo('2027-08-16 06:00+07',60,100, '2027-08-16 08:00+07',300,100));

-- ══ §D. NOTHING ELSE MOVED — the allows a too-strict guard would lose ══════
insert into probe values
 ('D1. a block starting exactly when the previous window closes opens a new one', 'allow',
   pg_temp.solo('2027-08-16 08:00+07',120,100, '2027-08-16 13:00+07',120,100)),
 ('D2. two blocks inside one window, 30 + 70', 'allow',
   pg_temp.solo('2027-08-16 08:00+07',120,30,  '2027-08-16 10:00+07',60,70)),
 ('D3. …but not 30 + 71', 'deny',
   pg_temp.solo('2027-08-16 08:00+07',120,30,  '2027-08-16 10:00+07',60,71)),
 ('D4. overlapping in TIME is still refused (the exclusion constraint)', 'deny',
   pg_temp.solo('2027-08-16 08:00+07',120,10,  '2027-08-16 09:00+07',60,10)),
 ('D5. longer than 5 hours is still refused (the check constraint)', 'deny',
   pg_temp.solo('2027-08-16 08:00+07',60,10,   '2027-08-17 08:00+07',301,10)),
 ('D6. exactly 5 hours is still allowed (the boundary is inclusive)', 'allow',
   pg_temp.solo('2027-08-16 08:00+07',60,10,   '2027-08-17 08:00+07',300,10)),
 ('D7. a block crossing the weekly reset is still refused', 'deny',
   pg_temp.solo('2027-08-16 08:00+07',60,10,   '2027-08-18 14:00+07',180,10));

-- ══ §C. THE WINDOW SOMEBODY ALREADY OPENED ════════════════════════════════
-- "i'm using at 16.00, i see no one booking, so i use as free session, then
--  suddenly someone book so i have to stop my work?"
--
-- A measurement saying a window is open makes that window an anchor with a base
-- load. Injected here rather than waited for: sampled_at = now() makes it the
-- newest sample, and the reset instant is placed inside the empty probe week so
-- the arithmetic is entirely controlled.
--
-- C1 is the CONTROL and it is the important half: before the sample exists the
-- same booking must be accepted. Without it, C2/C3 are also passed by a guard
-- that refuses everything.
insert into probe values
 ('C1. control — no live window yet, 100 at 07:00 is fine', 'allow',
   pg_temp.only('2027-08-16 07:00+07', 120, 100));

insert into public.claude_usage_samples
  (sampled_at, five_hour_pct, five_hour_resets_at, seven_day_pct, reported_by)
values (now(), 60, '2027-08-16 11:00+07', null,
        (select id from public.users order by created_at limit 1));

insert into probe values
 ('C2. a window open to 11:00 at 60%% leaves 40 — 100 at 07:00 is refused', 'deny',
   pg_temp.only('2027-08-16 07:00+07', 120, 100)),
 ('C3. …and 40 at 07:00 is accepted', 'allow',
   pg_temp.only('2027-08-16 07:00+07', 120, 40)),
 ('C4. a block starting AFTER that window closes gets a fresh 100', 'allow',
   pg_temp.only('2027-08-16 11:00+07', 120, 100)),
 ('C5. claude_window_loads reports the live window with the measured base', '60',
   coalesce((select max(base_pct)::int::text from public.claude_window_loads(
      null, '2027-08-16 07:00+07', '2027-08-16 09:00+07', 0)
     where kind = 'live'), 'none'));

-- ══ §E. PRIVILEGES, read from the authority and not from the revoke line ═══
-- claude_window_loads() is SECURITY DEFINER over the whole bookings table, so a
-- grant to `authenticated` would publish every block's timing and percentage to
-- any signed-in account with no `claude` grant in the path — exactly what 0154
-- §B4 exists to stop happening to claude_sessions().
insert into probe values
 ('E1. claude_window_loads is NOT executable by authenticated', 'false',
   has_function_privilege('authenticated',
     'public.claude_window_loads(uuid,timestamptz,timestamptz,integer)', 'execute')::text),
 ('E2. claude_window_loads is NOT executable by anon', 'false',
   has_function_privilege('anon',
     'public.claude_window_loads(uuid,timestamptz,timestamptz,integer)', 'execute')::text),
 ('E3. claude_booking_limits IS executable by authenticated (its own gate)', 'true',
   has_function_privilege('authenticated',
     'public.claude_booking_limits(timestamptz,timestamptz,uuid)', 'execute')::text),
 ('E4. claude_booking_limits is NOT executable by anon', 'false',
   has_function_privilege('anon',
     'public.claude_booking_limits(timestamptz,timestamptz,uuid)', 'execute')::text),
 ('E5. …and it gates on the `claude` permission, not on being signed in', 'true',
   (pg_get_functiondef('public.claude_booking_limits(timestamptz,timestamptz,uuid)'::regprocedure)
     like '%current_user_has_permission(''claude'')%')::text);

select step, expected, got,
       case when expected = got then 'PASS' else 'FAIL' end as result
from probe order by step;

rollback;
