-- ============================================================
-- claude0162-usage-runs.sql — does the "ใช้จริง" overlay say WHEN Claude was
-- used, and does it use the window's own opening instant to say it?
--
-- THE SPEC IS THE OWNER'S WORKED EXAMPLE, VERBATIM:
--
--   "actual people use at 10.07, your last detect at 10.00 found nothing, 10.15
--    found 3% … it'll show reset session 5hr at 15.07, you can calculate back
--    and show it as 10.07-10.15 as 3% instead … if they continue 4% more,
--    you'll detect at 10.30, so you'll display 10.07-10.30 7% … then 10.23 till
--    10.45 they don't use any … then from 10.47 3%, you'll see change at 11.00,
--    so you'd display 10.07-10.30 7%, 10:45-11.00 3%"
--
-- §A is that example, sample for sample, asserted as the two runs it names.
--
-- WHY SYNTHETIC SAMPLES. Every case below is a state the live table does not
-- currently contain and cannot be made to contain on demand — a window first
-- polled ABOVE where the previous one ended, a reporter outage, a window
-- opening between two polls. A proof that waits for production to produce its
-- inputs is a proof that never runs. The rows go into a FUTURE quota week and
-- roll back, exactly as claude0154/0155 do.
--
-- ⚠️ THE JITTER IS PART OF THE SUBJECT. The API returns `now + seconds_left`,
-- so one window comes back as 15:06:59.6 on one poll and 15:07:00.4 on the
-- next. §A4 asserts the drawn edge is 10:07:00 flat — clamping to the RAW value
-- put a second of API noise on the calendar as a time.
--
--   node tools/db-query.mjs tools/claude0162-usage-runs.sql
-- ============================================================

begin;

create temp table probe (step text, expected text, got text) on commit drop;

-- A day inside a FUTURE quota week, clear of every real sample.
--
-- ⚠️ BUILT IN THE DISPLAY TIMEZONE, not the session's. `date + time` yields a
-- timestamp WITHOUT time zone, which Postgres then reads as UTC here while
-- every assertion below renders in Asia/Bangkok — so "10:07" was created at
-- 10:07 UTC and read back as 17:07, and four cases failed on the test's own
-- arithmetic rather than on anything the function did.
create temp table sc on commit drop as
  select ((((public.claude_week_start(now()) + interval '21 days')
             at time zone (select week_reset_tz from public.claude_settings where id))::date
           + time '00:00')
          at time zone (select week_reset_tz from public.claude_settings where id)) as d0;

/* One synthetic poll. `pct` is Claude's five-hour utilization; `reset` is the
   instant that window ends, or null for "no window open". The ±0.4s wobble is
   applied on purpose so the rounding is exercised rather than assumed. */
create or replace function pg_temp.poll(p_min interval, p_pct numeric, p_reset interval)
returns void language sql as $$
  insert into public.claude_usage_samples
    (sampled_at, five_hour_pct, five_hour_resets_at, seven_day_pct,
     seven_day_resets_at, raw)
  select (select d0 from sc) + p_min, p_pct,
         case when p_reset is null then null
              else (select d0 from sc) + p_reset
                   + (case when (extract(epoch from p_min)::int / 900) % 2 = 0
                           then interval '-0.4 seconds' else interval '0.4 seconds' end)
         end,
         50, (select d0 from sc) + interval '3 days',
         jsonb_build_object('proof', 'claude0162');
$$;

-- ── §A. The owner's example ────────────────────────────────────────────────
-- Window opens at 10:07 (reset 15:07). Polls every 15 minutes.
select pg_temp.poll(interval '9 hours 45 min',  0, null);              -- 09:45 —
select pg_temp.poll(interval '10 hours',        0, null);              -- 10:00 nothing
select pg_temp.poll(interval '10 hours 15 min', 3, interval '15 hours 7 min');
select pg_temp.poll(interval '10 hours 30 min', 7, interval '15 hours 7 min');
select pg_temp.poll(interval '10 hours 45 min', 7, interval '15 hours 7 min'); -- idle
select pg_temp.poll(interval '11 hours',       10, interval '15 hours 7 min');
select pg_temp.poll(interval '11 hours 15 min',10, interval '15 hours 7 min'); -- idle

-- ── §B. A SECOND window whose first reading is HIGHER than the first's last ─
-- 10 → 20 is a RISE, not a drop, so the old "split where the reading drops"
-- grouping merged these two windows into one and reported a single 10-hour
-- session. `resets_at` is the identity and it was always in the row.
select pg_temp.poll(interval '12 hours',       10, interval '15 hours 7 min'); -- old win, idle
select pg_temp.poll(interval '12 hours 15 min',20, interval '17 hours 10 min'); -- NEW win @12:10

-- ── §C. The reporter was DOWN, and the rise could be anywhere in the gap ───
-- 12:15 → 14:00 is 105 minutes. Attributing 30% to a time inside it would be a
-- statement nobody measured.
select pg_temp.poll(interval '14 hours',       50, interval '17 hours 10 min');
select pg_temp.poll(interval '14 hours 15 min',50, interval '17 hours 10 min'); -- idle

-- ── §F. THE ROUNDING BOUNDARY (0163) ──────────────────────────────────────
-- A window whose TRUE reset lands near :30 seconds comes back either side of
-- the rounding boundary from one poll to the next, so a key built as
-- `date_trunc('minute', resets_at + 30s)` changes MID-WINDOW. The new-window
-- branch attributes the whole CUMULATIVE reading as a rise, so a window sitting
-- at 90% emits a spurious 90% run out of nowhere — reported as *"the ใช้จริง
-- shows like all 90% up in short period of time"*.
--
-- Reset at 16:00:30 exactly: the polls report 16:00:29.8 and 16:00:30.3, which
-- truncate to 16:00 and 16:01. Proximity does not care.
insert into public.claude_usage_samples
  (sampled_at, five_hour_pct, five_hour_resets_at, seven_day_pct, seven_day_resets_at, raw)
select (select d0 from sc) + i.m, i.p,
       (select d0 from sc) + interval '16 hours 30 seconds' + i.j,
       50, (select d0 from sc) + interval '3 days',
       jsonb_build_object('proof', 'claude0162')
--
-- CONTIGUOUS with §C's last poll (14:15), on purpose. The first draft started
-- at 15:00, which is 45 minutes later — past the outage threshold — so the
-- first rise went into the UNKNOWN branch and §F was quietly testing §C's rule
-- instead of its own. It read 70 where it should read 90. A case must exercise
-- ONE mechanism; claude0159 learned the same thing when its §C poisoned its §D.
  from (values
    (interval '14 hours 30 min', 20, interval '-0.2 seconds'),
    (interval '14 hours 45 min', 40, interval '0.3 seconds'),
    (interval '15 hours',        90, interval '-0.4 seconds'),
    (interval '15 hours 15 min', 90, interval '0.2 seconds')
  ) as i(m, p, j);

create temp table r on commit drop as
  select * from public.claude_usage_runs(
    (select d0 from sc) + interval '9 hours 50 min',
    (select d0 from sc) + interval '20 hours');

create or replace function pg_temp.hm(t timestamptz) returns text language sql as $$
  select to_char(t at time zone (select week_reset_tz from public.claude_settings where id),
                 'HH24:MI:SS');
$$;

-- ── the control, first: an empty result makes every case below vacuous ─────
insert into probe select 'A0. control — the scenario produced runs at all', 'true',
  ((select count(*) from r) >= 4)::text;

-- ── §A assertions — the owner's two runs, exactly ─────────────────────────
insert into probe select 'A1. run 1 is 10:07 → 10:30 (NOT 10:00 → 10:30)',
  '10:07:00-10:30:00',
  (select pg_temp.hm(run_from) || '-' || pg_temp.hm(run_to) from r order by run_from limit 1);

insert into probe select 'A2. …carrying 7%, the two rises added', '7',
  (select round(pct)::text from r order by run_from limit 1);

insert into probe select 'A3. run 2 is 10:45 → 11:00 at 3%', '10:45:00-11:00:00/3',
  (select pg_temp.hm(run_from) || '-' || pg_temp.hm(run_to) || '/' || round(pct)
     from r order by run_from offset 1 limit 1);

-- The jitter, asserted rather than hoped for: A1 already pins :00 seconds, and
-- this says the window itself is reported on the minute too.
insert into probe select 'A4. the window start is the ROUNDED instant, not ±0.4s of API noise',
  '10:07:00',
  (select pg_temp.hm(win_start) from r order by run_from limit 1);

-- BOTH DIRECTIONS. Run 1's left edge is the window opening (exact); run 2's is
-- a poll boundary (inferred). If the flag were hardcoded either way, one of
-- these two fails.
insert into probe select 'A5. run 1''s edge is EXACT (it is the first message)', 'true',
  (select exact_start::text from r order by run_from limit 1);
insert into probe select 'A6. run 2''s edge is INFERRED (it is only a poll)', 'false',
  (select exact_start::text from r order by run_from offset 1 limit 1);

-- The idle stretch is the point of the whole feature.
insert into probe select 'A7. 10:30–10:45 produced NO run (nobody was using it)', '0',
  (select count(*)::text from r
    where run_from < (select d0 from sc) + interval '10 hours 45 min'
      and run_to   > (select d0 from sc) + interval '10 hours 30 min');

-- ── §B — two windows, no drop between them ────────────────────────────────
insert into probe select 'B1. the second window is its OWN run, 12:10 → 12:15 at 20%',
  '12:10:00-12:15:00/20',
  (select pg_temp.hm(run_from) || '-' || pg_temp.hm(run_to) || '/' || round(pct)
     from r where run_from >= (select d0 from sc) + interval '12 hours'
     order by run_from limit 1);

insert into probe select 'B2. …and no run spans the two windows', '0',
  (select count(*)::text from r
    where run_from < (select d0 from sc) + interval '12 hours 10 min'
      and run_to   > (select d0 from sc) + interval '12 hours 10 min');

-- `partial` must mean "we could not locate this window's first usage in time",
-- and BOTH directions have to be pinned: the first draft tested "the first
-- reading was above zero", which marks every window partial including the ones
-- polled six minutes in, and looked correct on a table where that was true of
-- all four.
insert into probe select 'B2b. a window polled 5 min after it opened is NOT partial', 'false',
  (public.claude_usage_windows(
     (select d0 from sc) + interval '9 hours',
     (select d0 from sc) + interval '20 hours') -> 1 ->> 'partial');

-- Scoped to §A+§B's own stretch: §F adds a third window later in the day, and
-- an assertion that silently counts it is an assertion about the wrong thing.
insert into probe select 'B3. the two windows are counted as TWO', '2',
  (select jsonb_array_length(public.claude_usage_windows(
     (select d0 from sc) + interval '9 hours',
     (select d0 from sc) + interval '14 hours 20 min'))::text);

-- ── §C — downtime is UNKNOWN, not used and not idle ───────────────────────
insert into probe select 'C1. the 105-minute outage is marked unknown', 'unknown',
  (select kind from r where run_from = (select d0 from sc) + interval '12 hours 15 min');

insert into probe select 'C2. …and it is NOT claimed as an exact start', 'false',
  (select exact_start::text from r
    where run_from = (select d0 from sc) + interval '12 hours 15 min');

insert into probe select 'C3. control — the outage still reports the 30% that appeared', '30',
  (select round(pct)::text from r where run_from = (select d0 from sc) + interval '12 hours 15 min');

-- ── §D — invariants that must hold whatever the shape of the data ─────────
-- Nothing invented, nothing lost: every run's percentage is a real rise, and
-- the runs together account for exactly the rises in the scenario
-- (3+4+3+20+30 = 60).
-- 3+4+3 (§A) + 20 (§B) + 30 (§C) + 90 (§F) = 150.
insert into probe select 'D1. the runs account for every rise, and only rises', '150',
  (select round(coalesce(sum(pct), 0))::text from r);

insert into probe select 'D2. no run is zero or negative', '0',
  (select count(*)::text from r where pct <= 0);

insert into probe select 'D3. no run ends before it starts', '0',
  (select count(*)::text from r where run_to <= run_from);

-- Runs may touch but never overlap — an overlap would draw the same minutes as
-- two different sessions.
insert into probe select 'D4. no two runs overlap', '0',
  (select count(*)::text from r a join r b
     on a.run_from < b.run_to and b.run_from < a.run_to and a.run_from <> b.run_from);

-- open_ended means "the newest sample we have", which in a closed historical
-- range is never true. It going true here would mean every past run is drawn as
-- still running.
insert into probe select 'D5. a run that ended before the last poll is not open-ended', '0',
  (select count(*)::text from r where open_ended
     and run_to < (select max(sampled_at) from public.claude_usage_samples
                    where raw->>'proof' = 'claude0162'));

insert into probe select 'F1. a reset on the :30 rounding boundary stays ONE window', '1',
  (select count(*)::text from r
    where run_from >= (select d0 from sc) + interval '14 hours'
      and run_from <  (select d0 from sc) + interval '16 hours');

-- The NUMBER is the assertion, not just the count. Under the rounding key the
-- mid-window split emitted a second run carrying the whole CUMULATIVE reading
-- (40, then 90) instead of the rise — which is the reported symptom, "all 90%
-- up in short period of time". 20 → 40 → 90 is a rise of 90 across one run.
--
-- AGGREGATED, not a bare subquery. Written as `select round(pct) ... where`, the
-- falsification did not FAIL — it ERRORED with 21000 "more than one row returned
-- by a subquery", because the bug's whole effect is to turn one run into two.
-- An errored proof is silence (this repo has paid for that once already), so the
-- assertion has to survive the very shape it is hunting and print it: under the
-- rounding key this reads "20+70", which names the bug on sight.
insert into probe select 'F2. …and reports the RISE (90) as ONE run, not a cumulative reading', '90',
  (select string_agg(round(pct)::text, '+' order by run_from) from r
    where run_from >= (select d0 from sc) + interval '14 hours'
      and run_from <  (select d0 from sc) + interval '16 hours');

insert into probe select 'F3. …and claude_usage_windows agrees it is ONE window there', '3',
  (select jsonb_array_length(public.claude_usage_windows(
     (select d0 from sc) + interval '9 hours',
     (select d0 from sc) + interval '20 hours'))::text);

-- ── §E — the gate ─────────────────────────────────────────────────────────
-- Both are SECURITY DEFINER over the whole samples table. A grant to
-- `authenticated` would publish the account's usage history to any signed-in
-- student. Read the ACL, not the revoke we hope we wrote.
insert into probe select 'E1. claude_usage_runs is NOT callable by authenticated', 'false',
  has_function_privilege('authenticated',
    'public.claude_usage_runs(timestamptz,timestamptz)', 'execute')::text;
insert into probe select 'E2. claude_usage_windows is NOT callable by authenticated', 'false',
  has_function_privilege('authenticated',
    'public.claude_usage_windows(timestamptz,timestamptz)', 'execute')::text;
insert into probe select 'E3. …but the gated log RPC still IS', 'true',
  has_function_privilege('authenticated',
    'public.get_claude_usage_log(timestamptz)', 'execute')::text;

-- ── verdict ────────────────────────────────────────────────────────────────
select step, expected, got,
       case when expected = got then 'PASS' else 'FAIL' end as result
from probe order by step;

rollback;
