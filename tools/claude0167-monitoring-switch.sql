-- ============================================================
-- claude0167-monitoring-switch.sql — a measurement that means "right now" is
-- only usable while it is FRESH, and an admin can stop it being taken at all.
--
-- WHAT IS ACTUALLY BEING PROVED, and why it is not "the switch works"
--
-- The switch is the easy half; a boolean either reads back or it does not.
-- The half that would have shipped a wrong number is §A: BEFORE 0167,
-- claude_free_now() took the newest sample with no bound whatsoever, so the
-- hero panel's weekly remainder was frozen at whatever the last successful poll
-- said — across the Wed 16:00 reset, for ever. Pausing the reporter does not
-- CREATE that bug, it makes it permanent; a dead timer or an expired credential
-- freezes the same number with nobody having chosen anything.
--
-- So §A tests the AGE rule with the switch left ON, and only then §B tests the
-- switch. If §A ever goes green while §B is red, the fix has degenerated into a
-- special case for the switch, which is exactly what it must not be.
--
-- BOTH DIRECTIONS, EVERYWHERE. Every refusal here is paired with a permission
-- over the same rows one line away (A1 beside A2, B1 beside B2, C1 beside C2).
-- A deny-only probe cannot tell a working guard from a broken service — this
-- repo has paid for that twice — and "the number went null" is the single
-- easiest thing to achieve by accident.
--
-- THE INSTRUMENT'S OWN CONTROL. Every case reads `left_pct` out of
-- claude_free_now(). If that function errored, or if the probe's sample were
-- never visible to it, every case would report null and the whole thing would
-- score green while proving nothing. A1 and A4 exist to make that impossible:
-- they demand a NON-null number from the same call, over the same rows, with
-- only the sample's AGE changed.
--
-- Scenario sits in a FUTURE quota week, clear of real bookings, like every
-- other claude proof here. Everything runs inside one transaction and rolls
-- back; the settings row is restored by the rollback, not by hand.
--
--   node tools/db-query.mjs tools/claude0167-monitoring-switch.sql
-- ============================================================

begin;

create temp table probe (step text, expected text, got text) on commit drop;

-- ── the instrument ─────────────────────────────────────────────────────────
-- Put exactly one sample in play, at a chosen AGE, and ask claude_free_now()
-- what the week has left. `p_age` is minutes BEFORE now(): 0 is a sample taken
-- this instant, 999 is one nobody has refreshed in sixteen hours.
--
-- The sample is deleted first, so the probe's row is the newest by construction
-- rather than by hoping — the real table holds four days of rows whose
-- sampled_at would otherwise be compared against.
create function pg_temp.week_left(p_age int) returns text
language plpgsql as $$
declare v jsonb;
begin
  delete from public.claude_usage_samples where raw->>'proof' = 'claude0167';
  insert into public.claude_usage_samples (
    sampled_at, five_hour_pct, five_hour_resets_at,
    seven_day_pct, seven_day_resets_at, raw)
  values (now() - make_interval(mins => p_age), 0, null,
          50, now() + interval '3 days', jsonb_build_object('proof', 'claude0167'));
  v := public.claude_free_now();
  return coalesce(v->'week'->>'left_pct', 'NULL');
end $$;

-- ── §A — the AGE rule, with the switch left ON ─────────────────────────────
-- This is the pre-existing defect. `sample_stale_minutes` is 45 by default, so
-- 5 minutes is believable and 600 is not. Nothing about monitoring_enabled is
-- touched in this section.
insert into probe
select 'A1 · fresh sample (5 min) → the week has a measured remainder',
       'a number', case when pg_temp.week_left(5) = 'NULL' then 'NULL' else 'a number' end;

insert into probe
select 'A2 · stale sample (600 min) → NO weekly remainder is claimed',
       'NULL', pg_temp.week_left(600);

-- The boundary, from both sides, derived from the SETTING rather than from the
-- literal 45 — a control that hardcodes the number cannot notice the setting
-- being changed underneath it.
insert into probe
select 'A3 · one minute inside sample_stale_minutes → still believed',
       'a number',
       case when pg_temp.week_left((select sample_stale_minutes - 1
                                      from public.claude_settings where id)) = 'NULL'
            then 'NULL' else 'a number' end;

insert into probe
select 'A4 · one minute outside sample_stale_minutes → dropped',
       'NULL',
       pg_temp.week_left((select sample_stale_minutes + 1
                            from public.claude_settings where id));

-- ── §B — the switch ────────────────────────────────────────────────────────
-- Same fresh sample throughout. The ONLY thing that changes between B1 and B2
-- is monitoring_enabled, so a difference here cannot be about staleness.
update public.claude_settings set monitoring_enabled = true where id;
insert into probe
select 'B1 · monitoring ON, fresh sample → the remainder is published',
       'a number',
       case when pg_temp.week_left(5) = 'NULL' then 'NULL' else 'a number' end;

update public.claude_settings
   set monitoring_enabled = false, monitoring_note = 'ยังไม่ได้ต่ออายุ Claude'
 where id;
insert into probe
select 'B2 · monitoring OFF, SAME fresh sample → nothing is claimed',
       'NULL', pg_temp.week_left(5);

insert into probe
select 'B3 · claude_monitoring_enabled() reports OFF',
       'false', public.claude_monitoring_enabled()::text;

update public.claude_settings set monitoring_enabled = true where id;
insert into probe
select 'B4 · claude_monitoring_enabled() reports ON again',
       'true', public.claude_monitoring_enabled()::text;

-- The rail is the fourth reader of the sample and must not disagree with the
-- hero it is drawn beside — 0161 exists because those two once did.
update public.claude_settings
   set monitoring_enabled = false, monitoring_note = 'proof' where id;
insert into probe
select 'B5 · the rail agrees: no band claims a weekly remainder while paused',
       'none',
       case when exists (
              select 1 from jsonb_array_elements(public.claude_free_windows(now())) w
               where w->'week_free_pct' is not null
                 and jsonb_typeof(w->'week_free_pct') <> 'null')
            then 'some' else 'none' end;
update public.claude_settings set monitoring_enabled = true where id;

-- ── §C — OFF must carry a reason, ON need not ──────────────────────────────
-- The reason is the only thing on a paused board that answers "is this broken,
-- or did someone do this on purpose?", so the constraint is the feature.
do $$
begin
  begin
    update public.claude_settings
       set monitoring_enabled = false, monitoring_note = null where id;
    insert into probe values ('C1 · pausing with NO reason is refused', 'refused', 'accepted');
  exception when check_violation then
    insert into probe values ('C1 · pausing with NO reason is refused', 'refused', 'refused');
  end;
end $$;

do $$
begin
  begin
    update public.claude_settings
       set monitoring_enabled = false, monitoring_note = 'รอต่ออายุ subscription' where id;
    insert into probe values ('C2 · pausing WITH a reason is accepted', 'accepted', 'accepted');
  exception when others then
    insert into probe values ('C2 · pausing WITH a reason is accepted', 'accepted', 'refused: ' || sqlerrm);
  end;
end $$;

-- ── §D — WHO paused it is the database's answer, not the caller's ──────────
-- claude_settings_write is a row policy with no column guard, so a PATCH can
-- name anybody. The trigger overwrites it. This proof runs as superuser, where
-- auth.uid() is null — so the assertion is that the caller's uuid did NOT
-- survive, which is the property, rather than that some particular uid did.
update public.claude_settings
   set monitoring_enabled = false,
       monitoring_note = 'stamp test',
       monitoring_changed_by = (select id from public.users order by created_at limit 1)
 where id;

insert into probe
select 'D1 · a client-supplied monitoring_changed_by is overwritten',
       'overwritten',
       case when monitoring_changed_by is null then 'overwritten' else 'survived' end
  from public.claude_settings where id;

insert into probe
select 'D2 · the pause is stamped with a time',
       'stamped',
       case when monitoring_changed_at is null then 'not stamped' else 'stamped' end
  from public.claude_settings where id;

-- An unrelated settings edit must NOT move the stamp, or a fortnight-old pause
-- starts reading as "paused just now" every time somebody saves the reset time.
create temp table stamp_before on commit drop as
  select monitoring_changed_at as at from public.claude_settings where id;

update public.claude_settings set plan_label = plan_label where id;

insert into probe
select 'D3 · saving an unrelated setting leaves the pause stamp alone',
       'unchanged',
       case when (select at from stamp_before)
                 is not distinct from (select monitoring_changed_at
                                         from public.claude_settings where id)
            then 'unchanged' else 'moved' end;

-- ── §E — the board publishes the switch to the people who read it ──────────
-- Through the real RPC, as a real granted account, because the payload is what
-- the pane renders. The subject is picked by the SAME predicate the function
-- gates on: a picker that does not mirror the gate selects nobody and the proof
-- errors instead of failing.
-- Picked by the SAME union the gate tests with (0081: current_user_has_permission
-- reads permissions AND managed_permissions, and `master` answers yes to every
-- key). A picker that does not mirror the gate selects nobody, and the proof
-- then ERRORS instead of failing — the shape house0144 sat green on for days.
create temp table granted on commit drop as
  select id as uid from public.users
   where 'claude' = any(permissions) or 'claude' = any(managed_permissions)
      or 'master' = any(permissions) or 'master' = any(managed_permissions)
   order by created_at limit 1;

insert into probe
select 'E0 · a subject holding `claude` exists (a proof with no subject proves nothing)',
       '1', (select count(*) from granted)::text;

create function pg_temp.board_monitoring(p_uid uuid) returns jsonb
language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  return public.get_claude_board(now())->'settings'->'monitoring';
end $$;

insert into probe
select 'E1 · the board says OFF, and carries the reason a booker needs',
       'off + reason',
       case when (pg_temp.board_monitoring((select uid from granted))->>'enabled') = 'false'
             and length(coalesce(
                   pg_temp.board_monitoring((select uid from granted))->>'note', '')) > 0
            then 'off + reason' else 'incomplete' end;

update public.claude_settings set monitoring_enabled = true where id;

insert into probe
select 'E2 · the board says ON again',
       'on',
       case when (pg_temp.board_monitoring((select uid from granted))->>'enabled') = 'true'
            then 'on' else 'off' end;

-- The frontend printed "ข้อมูลค้าง" off its own hardcoded 35 minutes until
-- 0167. If this stops being published the JS silently falls back to a literal
-- and the two thresholds drift apart again.
insert into probe
select 'E3 · sample_stale_minutes is published to the frontend',
       'published',
       case when (public.get_claude_board(now())->'settings'->>'sample_stale_minutes')
                 is null then 'missing' else 'published' end;

-- ── verdict ────────────────────────────────────────────────────────────────
select step,
       case when got = expected then 'PASS' else 'FAIL' end as verdict,
       expected, got
  from probe
 order by step;

rollback;
