-- ============================================================
-- claude0157-rail-segments.sql — is the capacity rail actually piecewise
-- constant, and does a segment's END mean "the latest start that still earns
-- this much"?
--
-- WHY THIS SHAPE, AND NOT A LIST OF THE BOUNDARIES I KNOW ABOUT
--
-- 0157 fixed two bugs. The first was a boundary the 0155 header LISTED and the
-- code never had — the open 5-hour window's reset — so the rail carried "48%"
-- across the instant it became a fresh 100% and drew one band for twelve hours
-- that should have been two. A proof enumerating "these four instants must be
-- in the union" would have been written from the same list that was already
-- wrong, and would have passed.
--
-- So this asserts the PROPERTY instead: **the answer does not change inside a
-- band.** Sample each band at three interior points and compare them to the
-- number the band is labelled with. Any missing boundary — the one that was
-- missing, or one nobody has thought of yet — makes some band non-constant and
-- turns this red without anyone having to predict it.
--
-- §B is the second bug, which is the subtler one. The owner stated it exactly:
--
--   "if i had book for 100%, it would end show that you can begin using at
--    03.00 not after 03.00 … the line is showing when you start the latest,
--    and how much you can use"
--
-- A session begun at exactly 03:00 ends as an 08:00 booking opens and shares
-- with nobody; begun a second later it overlaps and gets what they left. So a
-- band's END instant still earns the BAND'S OWN number, and the instant after
-- it earns the next band's. That is the definition of "latest start", and it is
-- what makes the rail readable rather than merely correct.
--
--   node tools/db-query.mjs tools/claude0157-rail-segments.sql
-- ============================================================

begin;

create temp table probe (step text, expected text, got text) on commit drop;

create temp table subj on commit drop as
  select id as uid from public.users order by created_at limit 1;

-- ── the scenario ───────────────────────────────────────────────────────────
-- Built RELATIVE TO NOW, because claude_free_windows() is about the week we are
-- living in and reads now() itself — there is no p_at to move. A booking ~20h
-- out puts every boundary kind in play at once: its start, its end, its
-- start-minus-5h, and the reset of the window open right now.
--
-- The slot is FOUND, not hardcoded. A fixed "+20 hours" collided with a real
-- booking on the first run and the trigger refused it — a proof whose subject
-- is a constant rots the moment the data moves (tools/proofs, 0092). This takes
-- the earliest hour that is clear of every existing booking by six hours on
-- both sides, which is enough that the scenario cannot straddle a real
-- session's edge.
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

-- A sample whose 5-hour window is OPEN and closes in the future — the branch
-- that was broken. Without forcing it, a run that happens to start when no
-- window is open would not exercise it and would pass on the old code.
--
-- Its WEEKLY figure is DERIVED, not chosen. A hardcoded 43% left the weekly
-- remainder below the live reservations, so the week bound every band to the
-- same number, no band stepped down, and B3/B4 — the controls — went red
-- exactly as they are meant to. This subject has to leave the SESSION as the
-- binding constraint or §B is testing nothing, and how much headroom that
-- needs depends on what is really booked this week.
insert into public.claude_usage_samples (
  sampled_at, five_hour_pct, five_hour_resets_at,
  seven_day_pct, seven_day_resets_at, raw)
select now(), 52, now() + interval '3 hours',
       greatest(0, 100 - ((reserved + 300.0) / (pool / 100.0))),
       now() + interval '3 days', jsonb_build_object('proof', 'claude0157')
  from (select (select week_pool_pct from public.claude_settings where id) as pool,
               (select coalesce(sum(pct), 0) + 50 from public.claude_bookings
                 where ends_at > now()) as reserved) q;

insert into public.claude_bookings (user_id, starts_at, ends_at, pct, purpose)
select uid, (select b_start from sc), (select b_start from sc) + interval '5 hours',
       50, 'proof row 0157'
  from subj;

create temp table seg on commit drop as
  select ordinality as n,
         (e->>'starts_at')::timestamptz as a,
         (e->>'ends_at')::timestamptz   as b,
         (e->>'free_pct')::numeric      as free
    from jsonb_array_elements(public.claude_free_windows()) with ordinality as t(e, ordinality);

-- A0 is the control. Everything below iterates over `seg`, and an empty `seg`
-- would make every one of them vacuously true — the "its control finds nothing
-- either" failure in skills/write-a-guard.md.
-- Both halves: a slot was FOUND (else the booking insert is a no-op and every
-- case below is vacuously true), and it produced enough bands to compare.
insert into probe select 'A0. control — a clear slot was found and it produced bands', 'true',
  ((select count(*) from sc) = 1 and (select count(*) from seg) >= 4)::text;

-- ── §A. Constant inside every band ─────────────────────────────────────────
-- Three interior points per band: just after the start, the middle, and just
-- before the end. If a boundary is missing, the answer moves somewhere in here.
insert into probe select
  'A1. every band is CONSTANT across its interior (a missing boundary breaks this)',
  '0',
  (select count(*)::text from seg,
     lateral (select unnest(array[
       a + interval '1 second',
       a + (b - a) / 2,
       b - interval '1 second'
     ]) as t) pts
   where b - a > interval '2 seconds'
     and round((public.claude_free_now(pts.t)->>'free_pct')::numeric) <> round(seg.free));

-- ── §B. "Start by X" — but only where X is a DEADLINE ─────────────────────
--
-- The first draft of this section asserted that EVERY band's end instant still
-- earns that band's number, and three bands failed. The assertion was wrong,
-- not the code, and the difference is worth writing down because it is the
-- whole semantics of the rail:
--
--   booking_start − 5h   the instant itself earns the EARLIER band. A session
--                        begun exactly then ends exactly as the booking opens,
--                        so it shares with nobody. This is the deadline.
--   the window's reset   the instant itself earns the LATER band — the new
--                        window has already begun.
--   a booking's start    later band: you are inside it.
--   a booking's end      later band: it has stopped reserving anything.
--
-- So only deadline boundaries carry "you may still start AT this moment", and
-- that is what B1 checks. Checking it everywhere made a true statement about
-- one boundary kind into a false one about four.
create temp table deadline on commit drop as
  select distinct starts_at - make_interval(mins => (select session_minutes
                                                       from public.claude_settings where id))
         as t
    from public.claude_bookings;

create temp table steps on commit drop as
  select s1.n, s1.b as edge, s1.free as before_free, s2.free as after_free
    from seg s1
    join seg s2 on s2.n = s1.n + 1
   where exists (select 1 from deadline d
                  where s1.b between d.t - interval '2 seconds' and d.t + interval '2 seconds')
     and round(s1.free) <> round(s2.free);

insert into probe select
  'B1. at a DEADLINE, the instant itself still earns the LARGER number',
  '0',
  (select count(*)::text from steps
    where round((public.claude_free_now(edge)->>'free_pct')::numeric) <> round(before_free));

insert into probe select
  'B2. one second past ANY band edge earns the next band''s number',
  '0',
  (select count(*)::text from seg s1
     join seg s2 on s2.n = s1.n + 1
    where round((public.claude_free_now(s1.b + interval '1 second')->>'free_pct')::numeric)
          <> round(s2.free));

-- B3/B4 are B1's controls, and B4 is the one that matters: B1 counts
-- violations among stepping deadlines, so it passes trivially if there are
-- none. A deadline can legitimately be inert — while a window is already open
-- and closing EARLIER than the deadline, nothing changes there — so the
-- scenario has to produce at least one that is not.
insert into probe select 'B3. control — the bands are not all the same number', 'true',
  ((select count(distinct round(free)) from seg) > 1)::text;

insert into probe select 'B4. control — at least one deadline is a real STEP DOWN', 'true',
  ((select count(*) from steps where before_free > after_free) >= 1)::text;

-- ── §B5. What is left for UNBOOKED use cannot improve by waiting ──────────
--
-- 0158. `week_free` climbed across the week — 10 → 60 → 160 → 260 → 360 —
-- because `left` was measured as of NOW while `reserved` was recomputed at each
-- future instant, so every booking that finished in between handed its quota
-- back. It does not: a block that runs SPENDS.
--
-- With the reservation set pinned to now, the weekly remainder is the same
-- number at every instant until the reset, and that is the shape to assert.
-- Stated as "never rises" rather than "is constant" so it survives a future
-- change that legitimately makes it fall (a booking added mid-week would).
insert into probe select
  'B5. weekly free-for-unbooked-use never RISES as time advances',
  '0',
  (select count(*)::text from seg s1
     join seg s2 on s2.n = s1.n + 1
    where (public.claude_free_now(s2.a + interval '1 second')->'week'->>'free_pct')::numeric
        > (public.claude_free_now(s1.a + interval '1 second')->'week'->>'free_pct')::numeric
          + 0.01);

-- B6 is B5's control: with no measurement there is no weekly number at all and
-- B5 passes on nulls. The scenario forces a sample, so this must be non-null.
insert into probe select 'B6. control — a weekly remainder is actually being computed', 'true',
  ((select public.claude_free_now(now())->'week'->>'free_pct') is not null)::text;

-- ── §C. The two boundaries the bugs were about, named ──────────────────────
-- §A covers the boundary set generally. These two are pinned because each was
-- a bug, and a named case reads in a failure report.
insert into probe select 'C1. the open window''s RESET is a band edge', 'true',
  (exists (select 1 from seg
            where a between (select five_hour_resets_at from public.claude_usage_samples
                              where raw->>'proof' = 'claude0157') - interval '2 seconds'
                        and (select five_hour_resets_at from public.claude_usage_samples
                              where raw->>'proof' = 'claude0157') + interval '2 seconds'))::text;

insert into probe select 'C2. booking_start MINUS 5h is a band edge', 'true',
  (exists (select 1 from seg
            where a between (select b_start from sc) - interval '5 hours' - interval '2 seconds'
                        and (select b_start from sc) - interval '5 hours' + interval '2 seconds'))::text;

select step, expected, got,
       case when expected = got then 'PASS' else 'FAIL' end as result
from probe order by step;

rollback;
