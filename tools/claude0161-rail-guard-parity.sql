-- ============================================================
-- claude0161-rail-guard-parity.sql — the calendar rail and the booking guard
-- must derive the SAME 5-hour window.
--
-- THE BUG THIS RATCHETS. Reported as *"i book 16.00-19.00 for 75% … it
-- shouldnt show the rail as 100% in that 25%"*. `claude_window_loads()` — the
-- authority the INSERT trigger refuses with — derives the window from the
-- booking chain: a booking opens one and everything landing inside joins it.
-- `claude_free_now()` derived its own from the CLOCK, so for every instant in
-- the TAIL of a window somebody had opened it invented a fresh 100% pot. The
-- guard said 175 and refused; the rail beside it said "start here, take 100%".
--
-- WHY A DIFFERENTIAL AND NOT A LIST OF EXPECTED NUMBERS. This is class 6 —
-- two implementations of one rule drift — and the class's own remedy is a
-- differential test, not a comment saying "keep in step". A proof asserting
-- "the tail reads 25" would be written from the same understanding the code
-- was, and would pass the day somebody changes the chain rule in ONE of the
-- two functions. §B instead asserts the RELATION over a whole week of
-- instants: whatever claude_window_loads() says is loaded into the window
-- containing t, claude_free_now(t) must report exactly that much left.
--
-- ⚠️ 0161 ALSO REVERTED 0158 while being written, because it rebuilt
-- claude_free_now() from the 0155 TEXT rather than from the live body.
-- claude0155 §C3 caught it. That is why §D here re-asserts the 0158 property
-- from this file too: a rewrite of this function is exactly the event that
-- silently undoes every earlier one, and it has now happened once.
--
-- BOTH DIRECTIONS. §A is the owner's scenario with the numbers named. §B is
-- the differential. §C is the CONTROL — the differential must be comparing a
-- non-empty, non-constant set, or "0 mismatches" means "0 comparisons".
--
--   node tools/db-query.mjs tools/claude0161-rail-guard-parity.sql
-- ============================================================

begin;

create temp table probe (step text, expected text, got text) on commit drop;

create temp table subj on commit drop as
  select id as uid from public.users order by created_at limit 1;

create temp table pool on commit drop as
  select session_pool_pct as p from public.claude_settings where id;

-- The slot is FOUND, not hardcoded: a proof naming a constant instant rots the
-- moment a real booking lands on it. Six hours clear on both sides so the
-- scenario cannot straddle a real window's edge.
create temp table sc on commit drop as
  select t as b_start
    from (select generate_series(
            date_trunc('hour', now()) + interval '7 hours',
            public.claude_week_start(now()) + interval '7 days' - interval '11 hours',
            interval '1 hour') as t) c
   where not exists (
     select 1 from public.claude_bookings b
      where b.starts_at < c.t + interval '6 hours'
        and b.ends_at   > c.t - interval '6 hours')
   order by t
   limit 1;

-- The owner's shape: a block SHORTER than the window it opens, so the window
-- has a tail. The tail is the whole bug — a block filling its window has none
-- and the old code was accidentally right there.
insert into public.claude_bookings (user_id, starts_at, ends_at, pct, purpose)
select uid, (select b_start from sc), (select b_start from sc) + interval '3 hours',
       75, 'proof row 0161'
  from subj;

-- The rail's own answer at an instant, in session percent.
create or replace function pg_temp.rail(t timestamptz) returns numeric
language sql stable as $$
  select (public.claude_free_now(t)->'session'->>'free_pct')::numeric;
$$;

-- The GUARD's answer at the same instant, computed the way the trigger does:
-- the heaviest window containing it.
create or replace function pg_temp.guard(t timestamptz) returns numeric
language sql stable as $$
  select greatest(0, (select p from pool) - coalesce(max(w.load_pct), 0))
    from public.claude_window_loads(null, t, t + interval '1 microsecond', 0) w;
$$;

-- ── §A. The owner's scenario, with the numbers named ───────────────────────
insert into probe select 'A0. control — a clear slot was found', 'true',
  ((select count(*) from sc) = 1)::text;

-- Inside their own block: 75 of the 100 is theirs.
insert into probe select 'A1. inside the block                → 25', '25',
  pg_temp.rail((select b_start from sc) + interval '1 hour')::text;

-- THE BUG. The block has ended; the window it opened has not. Before 0161 this
-- printed the whole pool.
insert into probe select 'A2. the TAIL, after the block ends  → 25, not a fresh pool', '25',
  pg_temp.rail((select b_start from sc) + interval '3 hours' + interval '30 minutes')::text;

insert into probe select 'A3. …and the window it reports is the one the BOOKING opened',
  to_char((select b_start from sc) at time zone 'UTC', 'YYYY-MM-DD HH24:MI'),
  to_char((public.claude_free_now((select b_start from sc) + interval '3.5 hours')
            ->'session'->>'window_start')::timestamptz at time zone 'UTC', 'YYYY-MM-DD HH24:MI');

-- The other direction: at the reset the pot really is fresh again. Without
-- this, a function stuck at "25 forever" would pass A1 and A2.
insert into probe select 'A4. at the window RESET             → the whole pool again',
  (select p from pool)::text,
  pg_temp.rail((select b_start from sc) + interval '5 hours')::text;

-- NO CASE HERE FOR `booking_start − 5h`, deliberately. The first draft asserted
-- "the whole pool" there and went red at 93, because a real 5-hour window was
-- open at that instant and carrying 7% — the assertion's SUBJECT was polluted
-- by live state, not the rule. claude0157 §C2 already ratchets that boundary
-- and does it properly, by injecting a sample of its own so the branch is
-- forced rather than hoped for. Restating it here from an uncontrolled instant
-- would be a second, weaker copy of a guard that exists — which is the very
-- class this file is about.

-- ── §B. THE DIFFERENTIAL ───────────────────────────────────────────────────
-- Every quarter-hour of the quota week, both functions asked the same question.
-- Any instant where they disagree is a drift, whatever the number.
create temp table grid on commit drop as
  select t, pg_temp.rail(t) as rail, pg_temp.guard(t) as guard
    from generate_series(
           greatest(now(), public.claude_week_start(now())) + interval '1 minute',
           public.claude_week_start(now()) + interval '7 days' - interval '1 minute',
           interval '15 minutes') as t;

insert into probe select 'B1. rail and guard agree at EVERY instant of the week', '0',
  (select count(*)::text from grid where rail is distinct from guard);

-- ── §C. THE CONTROL ────────────────────────────────────────────────────────
-- "0 mismatches" is also what an empty grid and a pair of constant functions
-- print. Both halves are asserted, so neither failure can wear a pass.
-- The grid is the REMAINDER of the quota week, so its size shrinks to zero as
-- the weekly reset approaches. `> 100` assumed the proof runs early in the
-- week: on 2026-08-18, ~21 h before the Wed 16:00 reset, only 86 quarter-hours
-- were left and this control went red — for a completely correct reason, which
-- is how a proof gets ignored. 20 points is 5 hours, one full Claude window,
-- which is the shortest span over which the differential says anything; C2
-- (the answer VARIES) is what actually stops "0 mismatches" being vacuous.
insert into probe select 'C1. control — the grid has at least a 5-hour window of points', 'true',
  ((select count(*) from grid) > 20)::text;

insert into probe select 'C2. control — the answer actually VARIES across the week', 'true',
  ((select count(distinct rail) from grid) > 1)::text;

-- ── §D. The band edge 0161 had to add, and the 0158 property a rewrite drops ─
create temp table seg on commit drop as
  select (e->>'starts_at')::timestamptz as a,
         (e->>'ends_at')::timestamptz   as b,
         (e->>'free_pct')::numeric      as free
    from jsonb_array_elements(public.claude_free_windows()) as e;

-- The window a booking opens RESETS at start+5h, and nothing else in
-- claude_free_windows()' union names that instant. Without it the rail draws
-- ONE band across the reset carrying the smaller number for hours.
insert into probe select 'D1. booking_start PLUS 5h is a band edge', 'true',
  (exists (select 1 from seg
            where a between (select b_start from sc) + interval '5 hours' - interval '2 seconds'
                        and (select b_start from sc) + interval '5 hours' + interval '2 seconds'))::text;

-- 0158: `left` is measured as of NOW, so `reserved` must be as of now too. The
-- weekly remainder for unbooked use must never RISE just because you asked
-- about a later instant. This is re-asserted here because rewriting
-- claude_free_now() is precisely what undid it once.
insert into probe select 'D2. the weekly free remainder never RISES with time (0158)', '0',
  (select count(*)::text
     from (select t,
                  (public.claude_free_now(t)->'week'->>'free_pct')::numeric as wf,
                  lag((public.claude_free_now(t)->'week'->>'free_pct')::numeric)
                    over (order by t) as prev
             from generate_series(
                    greatest(now(), public.claude_week_start(now())) + interval '1 minute',
                    public.claude_week_start(now()) + interval '7 days' - interval '1 minute',
                    interval '2 hours') as t) q
    where prev is not null and wf > prev + 0.05);

-- ── verdict ────────────────────────────────────────────────────────────────
select step, expected, got,
       case when expected = got then 'PASS' else 'FAIL' end as result
from probe order by step;

rollback;
