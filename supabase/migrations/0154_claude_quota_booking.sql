-- ============================================================
-- 0154 — จองโควตา Claude: booking a share of one Claude Pro subscription.
--
-- WHAT THIS IS
-- SAMO holds ONE Claude Pro subscription. Pro meters two windows at once:
--   • a 5-hour SESSION window, worth 100% of session quota
--   • a 7-day WEEKLY window
-- The owner's conversion, which is the whole arithmetic of this feature:
--   1% weekly = 7% session  ⇒  one full session (100%) = 14.3% weekly
--   ⇒ one week = 700% of session quota = seven full sessions.
-- So the unit stored everywhere here is SESSION PERCENT. The weekly pool is
-- 700 of them. There is no second unit and nothing converts at read time.
--
-- THE ONE IDEA THIS SCHEMA IS BUILT AROUND
-- A session is NOT a fixed slot on a wall-clock grid. Claude opens the 5-hour
-- window at the FIRST message, so a grid anchored to midnight (or to anything
-- else) would be a fiction that reports "both bookings fine" right up until the
-- account caps out. Here a session is DERIVED: the earliest booking in an area
-- opens one, it runs exactly 5 hours from that booking's start, and it carries
-- 100%. Any later booking that fits entirely inside that span JOINS it and
-- draws from the same 100%. That reproduces the owner's example exactly —
-- 30% over 3 hours leaves 70% over the remaining 2 — while staying true to the
-- rolling window. See claude_sessions() in §4.
--
-- WHAT THIS IS NOT
-- It is not enforcement. Everyone shares one login; anyone can open Claude
-- outside their block and this schema will never know. It is the same kind of
-- object as ระบบจองห้องสโม — a public, attributable claim on a shared thing.
-- The reconciliation against reality is claude_usage_samples (§6), fed by a
-- reporter running where the credentials actually are. Nothing here pretends
-- a declared percentage is a measured one.
--
-- PRIVACY POSTURE
-- The calendar has to show WHO holds a block and which ฝ่าย they are from.
-- Since 0147, public.users is self-read only — a full read maps who holds
-- `master` — so this does NOT add a read policy to get names. Identity comes
-- out of list_claude_bookings() (§7) as a hand-built PROJECTION: display name,
-- ฝ่าย path, ตำแหน่ง titles. No email, no รหัสนักศึกษา, no permission array.
-- A column added to team_members by a later migration is not published by
-- accident, because the projection names its columns.
-- ============================================================

-- ------------------------------------------------------------
-- §1 — Settings (exactly one row).
--
-- The reset moment is CONFIGURABLE and not a constant, because it is an
-- account fact nothing in this system can observe: the owner reports Wed 16:00
-- ICT, and also that Anthropic sometimes resets EARLY after an incident. A
-- hardcoded Monday-midnight would read "full pool" while the pool was spent.
-- When the reporter (§6) is running it can correct this from the real
-- `resets_at` the API returns; until then these values are the truth.
-- ------------------------------------------------------------
create table if not exists public.claude_settings (
  id                boolean primary key default true check (id),
  -- 0 = Sunday … 6 = Saturday, matching extract(dow). 3 = Wednesday.
  week_reset_dow    smallint    not null default 3 check (week_reset_dow between 0 and 6),
  week_reset_time   time        not null default '16:00',
  -- Asia/Bangkok, spelled out. A reset time without a zone is not a time.
  week_reset_tz     text        not null default 'Asia/Bangkok',
  -- The two caps, as session-percent. Named so a plan change is a settings
  -- edit, not a migration: Team/Max move both of these, nothing else.
  week_pool_pct     smallint    not null default 700 check (week_pool_pct > 0),
  session_pool_pct  smallint    not null default 100 check (session_pool_pct > 0),
  session_minutes   smallint    not null default 300 check (session_minutes > 0),
  plan_label        text        not null default 'Claude Pro',
  updated_at        timestamptz not null default now()
);
insert into public.claude_settings (id) values (true) on conflict (id) do nothing;

-- ------------------------------------------------------------
-- §2 — The bookings.
--
-- user_id, not a free-text name: the booking is a claim BY an account, and the
-- identity shown beside it is resolved server-side at read time. Storing the
-- name would be a second copy of a fact team_members already owns, which is
-- the drift class this repo pays for most.
-- ------------------------------------------------------------
create table if not exists public.claude_bookings (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid        not null references public.users(id) on delete cascade,
  starts_at   timestamptz not null,
  ends_at     timestamptz not null,
  -- Session percent. A guess by construction — nobody knows in advance that
  -- they will use 30% — which is exactly why §6 exists.
  pct         smallint    not null check (pct between 1 and 100),
  purpose     text        not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint claude_bookings_span_forward check (ends_at > starts_at),
  -- The 5-hour ceiling, in the DATABASE. The modal caps the picker at five
  -- hours too, but a cap that lives only in a form is a suggestion.
  constraint claude_bookings_span_max
    check (ends_at <= starts_at + interval '5 hours'),
  constraint claude_bookings_purpose_len
    check (length(btrim(purpose)) between 3 and 500)
);

create index if not exists claude_bookings_starts_idx
  on public.claude_bookings (starts_at);
create index if not exists claude_bookings_user_idx
  on public.claude_bookings (user_id);

-- ONE account, so ONE person at a time. Two overlapping blocks are not two
-- bookings, they are two people about to collide inside one chat history.
-- '[)' so a block that ENDS at 12:00 and one that STARTS at 12:00 are fine.
--
-- This is an EXCLUSION CONSTRAINT and not a check in the UI on purpose: two
-- people pressing ยืนยัน at the same second both pass a client-side "is it
-- free?" read. Postgres is the only thing here that can serialise them.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'claude_bookings_no_overlap'
  ) then
    alter table public.claude_bookings
      add constraint claude_bookings_no_overlap
      exclude using gist (tstzrange(starts_at, ends_at, '[)') with &&);
  end if;
end $$;

drop trigger if exists touch_claude_bookings_updated_at on public.claude_bookings;
create trigger touch_claude_bookings_updated_at
  before update on public.claude_bookings
  for each row execute function public.touch_updated_at();

-- ------------------------------------------------------------
-- §3 — Which quota week does an instant belong to?
--
-- "Most recent <reset dow> at <reset time> in <tz>, at or before p_at."
-- Computed in LOCAL wall-clock and converted back, so it survives the two
-- times a year a naive interval arithmetic would drift.
-- ------------------------------------------------------------
create or replace function public.claude_week_start(p_at timestamptz default now())
returns timestamptz
language plpgsql stable security definer set search_path = public as $$
declare
  s        public.claude_settings%rowtype;
  v_local  timestamp;
  v_cand   timestamp;
  v_delta  int;
begin
  select * into s from public.claude_settings where id;
  if not found then
    -- Fail LOUD. A missing settings row must not silently anchor the week to
    -- the epoch and report an empty pool as a full one.
    raise exception 'claude_week_start: claude_settings has no row';
  end if;

  v_local := p_at at time zone s.week_reset_tz;
  v_cand  := date_trunc('day', v_local) + s.week_reset_time;
  v_delta := (extract(dow from v_cand)::int - s.week_reset_dow + 7) % 7;
  v_cand  := v_cand - (v_delta * interval '1 day');
  -- Today IS the reset day but the reset has not happened yet.
  if v_cand > v_local then
    v_cand := v_cand - interval '7 days';
  end if;
  return v_cand at time zone s.week_reset_tz;
end $$;

comment on function public.claude_week_start(timestamptz) is
  'Start of the Claude quota week containing p_at, per claude_settings.';

-- ------------------------------------------------------------
-- §4 — Session derivation. The heart of the feature.
--
-- Greedy, in start order: each booking joins the session it fits entirely
-- inside, otherwise it opens a new one beginning at its own start.
--
-- Why checking only the LAST open session is correct, and not a shortcut:
-- bookings are processed in ascending starts_at, so every earlier session
-- starts no later than the last one; if a booking does not fit the last
-- session's 5-hour span it cannot fit any earlier one either. Proved by
-- monotonicity, not by testing a few rows.
-- ------------------------------------------------------------
create or replace function public.claude_sessions(
  p_from timestamptz,
  p_to   timestamptz
)
returns table (
  session_start timestamptz,
  session_end   timestamptz,
  used_pct      int,
  booking_ids   uuid[]
)
language plpgsql stable security definer set search_path = public as $$
declare
  s        public.claude_settings%rowtype;
  v_span   interval;
  b        record;
begin
  select * into s from public.claude_settings where id;
  v_span := make_interval(mins => s.session_minutes);

  for b in
    select id, starts_at, ends_at, pct
      from public.claude_bookings
     where starts_at >= p_from and starts_at < p_to
     order by starts_at, created_at
  loop
    if session_start is not null
       and b.starts_at >= session_start
       and b.ends_at   <= session_start + v_span then
      used_pct    := used_pct + b.pct;
      booking_ids := booking_ids || b.id;
    else
      if session_start is not null then
        return next;
      end if;
      session_start := b.starts_at;
      session_end   := b.starts_at + v_span;
      used_pct      := b.pct;
      booking_ids   := array[b.id];
    end if;
  end loop;

  if session_start is not null then
    return next;
  end if;
  return;
end $$;

-- ------------------------------------------------------------
-- §5 — The guard. Every write path, one mechanism.
--
-- A trigger on the TABLE rather than a check inside one booking RPC: this
-- repo's most repeated bug is a rule implemented on the writers somebody
-- happened to be looking at. An import, a psql session, a future admin
-- "move this block" feature and the modal all pass through here.
--
-- Three rules, in the order a person hits them:
--   1. a booking may not straddle the weekly reset — it would draw from two
--      pools and neither total would mean anything;
--   2. a booking may not straddle an existing session's edge — it belongs to
--      exactly one 5-hour window or the arithmetic is undefined;
--   3. the session it lands in may not exceed 100%, and the week may not
--      exceed 700%.
-- ------------------------------------------------------------
create or replace function public.claude_booking_guard()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  s          public.claude_settings%rowtype;
  v_span     interval;
  v_wk_start timestamptz;
  v_wk_end   timestamptz;
  v_week_pct int;
  v_host     record;
  v_prior    record;
begin
  select * into s from public.claude_settings where id;
  v_span := make_interval(mins => s.session_minutes);

  -- (1) one quota week.
  v_wk_start := public.claude_week_start(new.starts_at);
  v_wk_end   := v_wk_start + interval '7 days';
  if new.ends_at > v_wk_end then
    raise exception
      'ช่วงที่จองคร่อมเวลารีเซ็ตโควตาสัปดาห์ (%). แบ่งเป็นสองการจองคนละสัปดาห์',
      to_char(v_wk_end at time zone s.week_reset_tz, 'DD Mon HH24:MI');
  end if;

  -- The session this booking would land in, computed over its own week and
  -- ignoring the row being edited so an UPDATE does not fight itself.
  select * into v_host
    from public.claude_sessions(v_wk_start, v_wk_end) cs
   where new.starts_at >= cs.session_start
     and new.ends_at   <= cs.session_start + v_span
   limit 1;

  -- (2) straddling an existing session edge.
  if v_host is null then
    select * into v_prior
      from public.claude_sessions(v_wk_start, v_wk_end) cs
     where new.starts_at < cs.session_end
       and new.ends_at   > cs.session_start
       and not (new.id = any (cs.booking_ids))
     limit 1;
    if v_prior is not null then
      raise exception
        'ช่วงนี้คร่อมขอบเซสชันที่เริ่ม % — หนึ่งการจองต้องอยู่ในเซสชัน 5 ชั่วโมงเดียว',
        to_char(v_prior.session_start at time zone s.week_reset_tz, 'DD Mon HH24:MI');
    end if;
  end if;

  -- (3a) session cap. v_host already INCLUDES new on an UPDATE-in-place, so
  -- subtract the old value rather than double-counting it.
  if v_host is not null then
    declare v_used int := v_host.used_pct;
    begin
      if new.id = any (v_host.booking_ids) then
        v_used := v_used - coalesce((select pct from public.claude_bookings where id = new.id), 0);
      end if;
      if v_used + new.pct > s.session_pool_pct then
        -- The percent sign is appended to the ARGUMENT, never written in the
        -- format string: in RAISE, `%` is the placeholder and `%%` the literal,
        -- so "%%%" is read left-to-right as literal-then-placeholder and prints
        -- the sign on the wrong side of the number.
        raise exception 'เกินโควตาเซสชัน — เซสชันนี้เหลือ %, ขอจอง %',
          (s.session_pool_pct - v_used)::text || '%', new.pct::text || '%';
      end if;
    end;
  end if;

  -- (3b) weekly pool.
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

drop trigger if exists claude_bookings_guard on public.claude_bookings;
create trigger claude_bookings_guard
  before insert or update of starts_at, ends_at, pct on public.claude_bookings
  for each row execute function public.claude_booking_guard();

-- ------------------------------------------------------------
-- §6 — Measured usage, so the ledger can be checked against reality.
--
-- A declared percentage is a guess. Without a measured counterpart the whole
-- board drifts within one week and people stop believing it. The measurement
-- exists — GET https://api.anthropic.com/api/oauth/usage returns `five_hour`
-- and `seven_day` utilization with their reset timestamps — but the OAuth
-- token lives in ~/.claude/.credentials.json on a MACHINE, so the browser can
-- never fetch it and no amount of frontend work will change that.
--
-- Hence: tools/claude-usage-report.mjs runs where the credentials are and
-- POSTs samples here. Everything else works with this table empty; a sample
-- that never arrives degrades the board to a plain ledger, which is what it
-- would have been anyway.
-- ------------------------------------------------------------
create table if not exists public.claude_usage_samples (
  id                  uuid primary key default gen_random_uuid(),
  sampled_at          timestamptz not null default now(),
  five_hour_pct       numeric(5,2),
  five_hour_resets_at timestamptz,
  seven_day_pct       numeric(5,2),
  seven_day_resets_at timestamptz,
  -- The untouched response. Anthropic has added windows before (per-model
  -- weekly caps); keeping the body means a new field is a read-side change,
  -- not a re-collection of data nobody kept.
  raw                 jsonb,
  reported_by         uuid references public.users(id) on delete set null,
  created_at          timestamptz not null default now()
);
create index if not exists claude_usage_samples_at_idx
  on public.claude_usage_samples (sampled_at desc);

-- ------------------------------------------------------------
-- §7 — The read path: ONE call returns the whole board.
--
-- Why one payload and not "fetch bookings, derive sessions in JS": the session
-- rule would then exist twice, in SQL for the guard and in JavaScript for the
-- drawing, and the two would answer differently the first time either is
-- edited. That is this repo's single most expensive bug class. The guard and
-- the calendar now read the SAME claude_sessions() rows, so a change to the
-- rule cannot land on only one of them.
--
-- The identity here is a hand-built PROJECTION, named column by column. Since
-- 0147 public.users is self-read only, so nothing in this payload may be
-- obtainable by asking the table directly — and nothing here is: no email, no
-- รหัสนักศึกษา, no role, no permission array. A name and a ฝ่าย, which is what
-- a shared calendar needs to be legible, and no more.
-- ------------------------------------------------------------
create or replace function public.get_claude_board(p_at timestamptz default now())
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_uid      uuid := auth.uid();
  s          public.claude_settings%rowtype;
  v_wk_start timestamptz;
  v_wk_end   timestamptz;
  v_books    jsonb := '[]'::jsonb;
  v_sess     jsonb := '[]'::jsonb;
  v_week_pct int;
  b          record;
  cs         record;
  v_email    text;
  v_name     text;
  v_nick     text;
  v_posts    jsonb;
  v_path     text[];
  v_sample   public.claude_usage_samples%rowtype;
begin
  if v_uid is null or not public.current_user_has_permission('claude') then
    raise exception 'get_claude_board: ไม่มีสิทธิ์เข้าถึงระบบจองโควตา Claude';
  end if;

  select * into s from public.claude_settings where id;
  v_wk_start := public.claude_week_start(p_at);
  v_wk_end   := v_wk_start + interval '7 days';

  for b in
    select * from public.claude_bookings
     where starts_at >= v_wk_start and starts_at < v_wk_end
     order by starts_at
  loop
    select email into v_email from public.users where id = b.user_id;

    v_name := null; v_nick := null; v_posts := '[]'::jsonb; v_path := '{}';
    if v_email is not null and length(btrim(v_email)) > 0 then
      -- The ฝ่าย path of the FIRST posting. 82 people hold 2–4 ตำแหน่ง, so a
      -- single "their role" does not exist; the card shows all of them and
      -- the colour keys off this one.
      select public.team_node_path(m.node_id) into v_path
        from public.team_members m
       where lower(m.kkumail) = lower(btrim(v_email))
       order by m.created_at
       limit 1;

      select jsonb_agg(jsonb_build_object('node', n.name) order by m.created_at),
             min(nullif(btrim(coalesce(m.full_name, '')), '')),
             min(nullif(btrim(coalesce(m.nickname,  '')), ''))
        into v_posts, v_name, v_nick
        from public.team_members m
        join public.team_nodes  n on n.id = m.node_id
       where lower(m.kkumail) = lower(btrim(v_email));
    end if;

    v_books := v_books || jsonb_build_object(
      'id',        b.id,
      'starts_at', b.starts_at,
      'ends_at',   b.ends_at,
      'pct',       b.pct,
      'purpose',   b.purpose,
      'is_mine',   (b.user_id = v_uid),
      'person', jsonb_build_object(
        'name',     v_name,
        'nickname', v_nick,
        'path',     to_jsonb(coalesce(v_path, '{}'::text[])),
        'postings', coalesce(v_posts, '[]'::jsonb)
      )
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

  select * into v_sample from public.claude_usage_samples
   order by sampled_at desc limit 1;

  return jsonb_build_object(
    'week', jsonb_build_object(
      'starts_at', v_wk_start,
      'ends_at',   v_wk_end,
      'pool_pct',  s.week_pool_pct,
      'used_pct',  v_week_pct
    ),
    'settings', jsonb_build_object(
      'session_pool_pct', s.session_pool_pct,
      'session_minutes',  s.session_minutes,
      'week_pool_pct',    s.week_pool_pct,
      'reset_tz',         s.week_reset_tz,
      'plan_label',       s.plan_label
    ),
    'bookings', v_books,
    'sessions', v_sess,
    -- null until the reporter runs. The board renders a plain ledger without
    -- it and says so, rather than showing a zero that looks like a reading.
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

-- claude_sessions() and claude_week_start() are SECURITY DEFINER and read
-- claude_bookings with the owner's rights, so a grant to `authenticated` would
-- hand every signed-in account the whole board — times, percentages and all —
-- with no `claude` grant anywhere in the path. They are INTERNAL: the trigger
-- and get_claude_board() call them, and both of those apply the gate first.
revoke all on function public.claude_week_start(timestamptz) from public;
revoke all on function public.claude_week_start(timestamptz) from anon;
revoke all on function public.claude_week_start(timestamptz) from authenticated;

revoke all on function public.claude_sessions(timestamptz, timestamptz) from public;
revoke all on function public.claude_sessions(timestamptz, timestamptz) from anon;
revoke all on function public.claude_sessions(timestamptz, timestamptz) from authenticated;

-- ------------------------------------------------------------
-- §8 — RLS. One new permission key: `claude`.
--
-- `master` (0111) already answers true for any key through
-- current_user_has_permission(), so nothing extra is needed for it.
--
-- The split is deliberate and is NOT the house one-rung model:
--   • SELECT — anyone holding `claude`. A shared calendar that hides other
--     people's blocks cannot do its only job.
--   • INSERT — anyone holding `claude`, for THEMSELVES only (user_id must be
--     auth.uid()). Booking on someone else's behalf is impersonation on a
--     board whose entire value is attribution.
--   • UPDATE / DELETE — your own row, or `master`. Note this is a ROW filter
--     and NOT a column policy (the class this repo has been bitten by on
--     users/vs_tickets/shop_orders): user_id is pinned by the WITH CHECK on
--     both sides, so a self-update cannot hand the booking to someone else.
--
-- `revoke all from anon` explicitly on every table: RLS with no anon policy
-- already returns nothing, but Supabase's default privileges hand `anon` a
-- SELECT grant on new public tables, and a revoke you can SEE beats a denial
-- you have to reason about.
-- ------------------------------------------------------------
alter table public.claude_settings       enable row level security;
alter table public.claude_bookings       enable row level security;
alter table public.claude_usage_samples  enable row level security;

revoke all on public.claude_settings      from anon;
revoke all on public.claude_bookings      from anon;
revoke all on public.claude_usage_samples from anon;

drop policy if exists claude_settings_read  on public.claude_settings;
drop policy if exists claude_settings_write on public.claude_settings;
create policy claude_settings_read on public.claude_settings
  for select to authenticated
  using (public.current_user_has_permission('claude'));
create policy claude_settings_write on public.claude_settings
  for update to authenticated
  using  (public.current_user_role() = any (array['vp_admin','dev'])
          or public.current_user_has_permission('master'))
  with check (public.current_user_role() = any (array['vp_admin','dev'])
          or public.current_user_has_permission('master'));
-- Exactly one row, seeded above, forever.
revoke insert, delete on public.claude_settings from authenticated;

drop policy if exists claude_bookings_read       on public.claude_bookings;
drop policy if exists claude_bookings_insert_own on public.claude_bookings;
drop policy if exists claude_bookings_update_own on public.claude_bookings;
drop policy if exists claude_bookings_delete_own on public.claude_bookings;

create policy claude_bookings_read on public.claude_bookings
  for select to authenticated
  using (public.current_user_has_permission('claude'));

create policy claude_bookings_insert_own on public.claude_bookings
  for insert to authenticated
  with check (user_id = auth.uid()
              and public.current_user_has_permission('claude'));

create policy claude_bookings_update_own on public.claude_bookings
  for update to authenticated
  using  ((user_id = auth.uid() or public.current_user_has_permission('master'))
          and public.current_user_has_permission('claude'))
  with check ((user_id = auth.uid() or public.current_user_has_permission('master'))
          and public.current_user_has_permission('claude'));

create policy claude_bookings_delete_own on public.claude_bookings
  for delete to authenticated
  using ((user_id = auth.uid() or public.current_user_has_permission('master'))
         and public.current_user_has_permission('claude'));

drop policy if exists claude_usage_read   on public.claude_usage_samples;
drop policy if exists claude_usage_insert on public.claude_usage_samples;
create policy claude_usage_read on public.claude_usage_samples
  for select to authenticated
  using (public.current_user_has_permission('claude'));
create policy claude_usage_insert on public.claude_usage_samples
  for insert to authenticated
  with check (public.current_user_has_permission('claude')
              and reported_by = auth.uid());
revoke update, delete on public.claude_usage_samples from authenticated;

-- A policy with no table GRANT denies everyone and reads exactly like the
-- policy working (0138). Say the grants out loud.
grant select                       on public.claude_settings      to authenticated;
grant update                       on public.claude_settings      to authenticated;
grant select, insert, update, delete on public.claude_bookings    to authenticated;
grant select, insert               on public.claude_usage_samples to authenticated;
