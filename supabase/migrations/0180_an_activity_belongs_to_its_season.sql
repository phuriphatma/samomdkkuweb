-- 0180 — a QR code stops working when its quarter ends
--
-- REPORTED (owner, relaying the ฝ่าย, 2026-09-04):
--   "ถ้าเกิน quater ก็คือสแกนไม่ได้ๆๆ"  — สายป่าน, confirmed by เอิง
--   "ตอนนี้ qr ที่ถูกเจนใน q1 ก็ยังถูกสแกนใน q3 ได้ แล้วมันจะเพิ่มแต้มใน q3"
--
-- WHAT WAS HAPPENING. passport.stamp_scan resolved the CURRENT open season at
-- scan time and stamped the scan with it, but never asked which season the
-- ACTIVITY belonged to — because an activity had no season. So a poster from a
-- finished Q2 event kept working for ever, and every scan of it landed in
-- whatever quarter happened to be open. Someone who never attended a Q2 event
-- could collect km toward the Q3 leaderboard from a poster still on a wall.
-- UNIQUE (user_id, activity_id) capped it at once per person, so this was never
-- farmable — it was a fairness problem, not an exploit.
--
-- It also blocked a cleanup the ฝ่าย wanted: there are old QR *versions* still
-- in circulation that have to be supported, and no moment at which any of them
-- could be declared finished. Tying a QR's life to its quarter creates that
-- moment, for every generation of poster at once.
--
-- THE SHAPE, and why this one.
--   * `season_id` on the activity, NOT a date window. A window would have to be
--     re-derived by every reader and would disagree with samo_seasons the
--     moment a season is renamed or restarted. The season is the fact; store it.
--   * Filled by a TRIGGER, not by the admin page. The admin UI is not the only
--     thing that can insert an activity, and this repo's most repeated bug is a
--     rule enforced on the one path somebody happened to be looking at.
--   * The scan check asks whether the activity's season is STILL OPEN
--     (`ended_at is null`), not whether it equals the current one. Those are the
--     same thing while exactly one season is open, and the open-ended form stays
--     correct if that ever changes.
--   * Fails CLOSED. A NULL season_id raises rather than being waved through —
--     class 2 in .claude/rules/mistakes.md is that an unresolvable reference
--     answers "allowed" unless you make it answer otherwise.
--
-- ⚠️ ACCEPTED CONSEQUENCE, stated because it will surprise someone. An event
-- spanning a rollover loses its QR the moment the quarter ends, and an activity
-- must be created IN the quarter it should count toward. The owner raised this
-- ("เพื่อนต้องสร้างกิจกรรมใน quarter ใหม่") and the ฝ่าย chose it anyway.
-- On 2026-09-04 the busiest activity, เปิดโลกกิจกรรม 2569, had 84 scans in 30
-- days; it will stop scanning when Q2 closes. That is the intent, not a bug.
--
-- BACKFILL is unambiguous: 38 activities, 1 season (Q2, opened 2026-06-17), and
-- zero activities created before it. Every existing row is Q2.

begin;

-- ── 1. the column ─────────────────────────────────────────────────────────
alter table passport.activities
  add column if not exists season_id uuid references passport.samo_seasons(id);

comment on column passport.activities.season_id is
  'The quarter this activity belongs to. Its QR scans only while this season is '
  'open (passport.stamp_scan). Filled automatically on insert by '
  'passport.activity_season_default(); do not set it from the client.';

-- ── 2. backfill: everything that exists today is Q2 ───────────────────────
update passport.activities a
   set season_id = (select id from passport.samo_seasons
                     order by started_at asc limit 1)
 where a.season_id is null;

-- ── 3. new rows get the CURRENTLY OPEN season, whoever inserts them ───────
create or replace function passport.activity_season_default()
returns trigger
language plpgsql
security definer
set search_path to 'passport'
as $fn$
declare
  v_season uuid;
begin
  if new.season_id is not null then
    return new;                     -- an explicit value wins (data repair)
  end if;

  select id into v_season
    from passport.samo_seasons
   where ended_at is null
   order by started_at desc
   limit 1;

  -- No open season means the rollover left a gap. Refusing here is deliberate:
  -- an activity with no season can never be scanned, so creating one would be
  -- handing somebody a poster that is dead on arrival. docs/INVARIANTS.md,
  -- "Never leave a GAP between two วาระ or two seasons".
  if v_season is null then
    raise exception 'NO_OPEN_SEASON';
  end if;

  new.season_id := v_season;
  return new;
end $fn$;

drop trigger if exists activities_set_season on passport.activities;
create trigger activities_set_season
  before insert on passport.activities
  for each row execute function passport.activity_season_default();

-- ── 4. now it can be required ─────────────────────────────────────────────
alter table passport.activities
  alter column season_id set not null;

-- ── 5. the enforcement: stamp_scan refuses a closed season ────────────────
--
-- Rebuilt from the LIVE body (pg_get_functiondef, md5 5d31e01b…, 2809 bytes,
-- re-read immediately before writing this) — never from the migration that
-- first defined it, because a later one has usually changed it since.
--
-- ONE new check, placed AFTER the token comparison on purpose: a wrong token
-- should still say INVALID_TOKEN rather than leaking whether an activity exists
-- and merely expired. Everything else is byte-for-byte what was already there.
--
-- ⚠️ This rejects NOTHING today. Every one of the 38 activities is in Q2 and Q2
-- is open, so behaviour is unchanged until the first rollover — which is what
-- makes it safe to ship now rather than in the same hurried hour as Q3.
create or replace function passport.stamp_scan(p_activity_id uuid, p_token text)
returns passport.scans
language plpgsql
security definer
set search_path to 'passport'
as $fn$
declare
  v_uid    uuid := auth.uid();
  v_email  text;
  v_moved  text;
  v_act    passport.activities;
  v_year   uuid;
  v_season uuid;
  v_open   boolean;
  v_row    passport.scans;
begin
  -- fail CLOSED on every missing input (samoweb mistakes.md: `null in (...)`
  -- makes a raise-guard fail OPEN, so each check is explicit)
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_activity_id is null or p_token is null or btrim(p_token) = '' then
    raise exception 'INVALID_TOKEN';
  end if;

  select lower(btrim(email)) into v_email from auth.users where id = v_uid;
  if v_email is null or v_email = '' then raise exception 'AUTH_REQUIRED'; end if;

  -- kkumail-only, mirroring js/auth.js getPassportAccess
  if not (v_email like '%@kkumail.com' or v_email = 'pmphuriphat@gmail.com') then
    raise exception 'NOT_KKUMAIL';
  end if;

  -- an account whose data was migrated AWAY may not stamp
  select to_email into v_moved
    from passport.account_migrations where lower(from_email) = v_email limit 1;
  if v_moved is not null then raise exception 'ACCOUNT_MOVED:%', v_moved; end if;

  select * into v_act from passport.activities where id = p_activity_id;
  if not found then raise exception 'ACTIVITY_NOT_FOUND'; end if;

  -- constant-time-ish compare is unnecessary here (the token is in the QR the
  -- user already holds) but the comparison MUST be `=`, never LIKE — samoweb
  -- 0101: an ILIKE lookup turns the secret into a pattern the caller controls.
  if v_act.static_token is null or v_act.static_token <> p_token then
    raise exception 'INVALID_TOKEN';
  end if;

  -- 0180: the quarter this activity belongs to must still be OPEN. Asking
  -- "is its season open" rather than "is its season the current one" keeps
  -- working if more than one is ever open at once. NULL season_id raises too —
  -- the column is NOT NULL, so reaching here means something bypassed the
  -- trigger, and a scan that cannot be attributed to a quarter must not count.
  select (ended_at is null) into v_open
    from passport.samo_seasons where id = v_act.season_id;
  if v_open is distinct from true then
    raise exception 'SEASON_CLOSED';
  end if;

  -- current วาระ / season (ended_at is null = current)
  select id into v_year   from passport.samo_years
    where ended_at is null order by started_at desc limit 1;
  select id into v_season from passport.samo_seasons
    where ended_at is null order by started_at desc limit 1;

  -- on_new_scan updates profiles by user_id; with no row its UPDATE hits 0 rows
  -- and the km is silently lost, so guarantee the row first.
  insert into passport.profiles (id, email, total_km)
       values (v_uid, v_email, 0)
    on conflict (id) do nothing;

  insert into passport.scans
    (user_id, activity_id, points_awarded, activity_name,
     department_id, sub_department_id, samo_year_id, season_id)
  values
    (v_uid, p_activity_id, v_act.base_points_km, v_act.name,
     v_act.department_id, v_act.sub_department_id, v_year, v_season)
  returning * into v_row;   -- on_new_scan doubles marketing-bonus km + adds total_km

  return v_row;
exception
  when unique_violation then raise exception 'ALREADY_STAMPED';
end $fn$;

commit;
