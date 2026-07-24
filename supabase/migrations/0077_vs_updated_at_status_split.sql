-- ============================================================
-- 0077 — VS: updated_at on tickets + split "กำลังดำเนินการ" into SAMO/faculty
--
-- (a) `vs_tickets.updated_at` so the admin kanban can show BOTH times the
--     staff asked for: when the problem came in (timestamp/created_at) AND
--     how long since the last update. Backfilled from created_at (best
--     available proxy — remark times are unparseable display strings), then
--     maintained by the shared touch_updated_at() trigger on every UPDATE.
--
-- (b) Status vocabulary: "กำลังดำเนินการ" splits into
--       'สโมกำลังดำเนินการ'  (SAMO is working on it)
--       'คณะกำลังดำเนินการ'  (the faculty is working on it)
--     Existing in-progress rows become สโมกำลังดำเนินการ (SAMO is the actor
--     unless explicitly handed to the faculty; the pre-existing
--     "กำลังติดต่อคณะ" liaison status is unchanged). No enum/CHECK exists on
--     vs_tickets.status, and every phase mapping — client vsPhaseIndex and
--     DB vs_public_phase() — matches on the substring 'ดำเนินการ', so both
--     new values land in phase 2 with NO mapping change.
--
-- ORDER MATTERS: the rename runs BEFORE the touch trigger is created, so the
-- backfilled updated_at values are not clobbered to now() by the rename.
-- Idempotent (re-runnable).
-- ============================================================

-- (a1) column + backfill
alter table public.vs_tickets
  add column if not exists updated_at timestamptz;

update public.vs_tickets
   set updated_at = coalesce(created_at, "timestamp", now())
 where updated_at is null;

alter table public.vs_tickets
  alter column updated_at set default now(),
  alter column updated_at set not null;

comment on column public.vs_tickets.updated_at is
  'Last modification (any UPDATE, via touch_updated_at trigger). Backfilled = created_at for pre-0077 rows. See 0077.';

-- (b) status split — before the trigger exists, so updated_at is preserved.
update public.vs_tickets
   set status = 'สโมกำลังดำเนินการ'
 where status = 'กำลังดำเนินการ';

-- (a2) touch trigger (shared helper from 0072)
drop trigger if exists touch_vs_tickets_updated_at on public.vs_tickets;
create trigger touch_vs_tickets_updated_at
  before update on public.vs_tickets
  for each row execute function public.touch_updated_at();
