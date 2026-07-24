-- ============================================================
-- 0073 — VS resolution reason on close (service-desk slice 2)
--
-- When a ticket is completed (status = เสร็จสิ้น) the staffer records WHY it
-- closed, so the submitter sees a real outcome instead of a bare "เสร็จสิ้น".
-- Four reasons (mirrors the roadmap in STATE.md):
--   fixed     — แก้ไข/ดำเนินการเรียบร้อย
--   forwarded — ส่งต่อให้คณะ/หน่วยงานที่เกี่ยวข้อง
--   wont_do   — ไม่สามารถดำเนินการได้ (เหตุผลอยู่ใน resolution_note)
--   duplicate — เป็นเรื่องซ้ำ (ปกติมาจากการรวมเรื่อง 0068–0071)
--
-- Both columns live directly on vs_tickets, so they surface with NO RPC change
-- to:
--   * the submitter's own logged-in read  (RLS `select=*`)
--   * the guest by-id lookup get_vs_ticket_by_id() (returns `setof vs_tickets`;
--     0071 sanitizes duplicate_of + internal remarks but returns the whole row)
-- Writes go through the same staff UPDATE path as `status` (submitStaffAction).
-- No new RLS: the existing vs_tickets write policies already gate who may set
-- them, exactly as they gate `status`.
--
-- Confidentiality: resolution_note is submitter-visible by design (staff write
-- it FOR the student). It is no more sensitive than `problem`, which the same
-- guest lookup already returns for anyone holding the ticket id — so there is
-- no confidentiality regression. The public board (0072) is untouched; it has
-- its own SE-written `public_note` and never reads these columns.
--
-- Purely additive: two nullable columns + two CHECKs. No existing function,
-- trigger, or policy is modified, so the 0068–0072 dedup/board behavior and
-- their isolation proofs are unaffected. Idempotent (re-runnable).
-- ============================================================

alter table public.vs_tickets
  add column if not exists resolution text,
  add column if not exists resolution_note text;

-- Constrain to the known reason set. drop-if-exists first so a re-run is clean
-- (Postgres `add constraint` is not idempotent). All existing rows are null →
-- the ADD never fails on legacy data.
alter table public.vs_tickets
  drop constraint if exists vs_tickets_resolution_check;
alter table public.vs_tickets
  add constraint vs_tickets_resolution_check
  check (resolution is null or resolution in ('fixed', 'forwarded', 'wont_do', 'duplicate'));

-- Cap the note (submitter-visible free text; keep it from being unbounded even
-- if a crafted staff PATCH tried to store a huge value).
alter table public.vs_tickets
  drop constraint if exists vs_tickets_resolution_note_len;
alter table public.vs_tickets
  add constraint vs_tickets_resolution_note_len
  check (resolution_note is null or char_length(resolution_note) <= 1000);

comment on column public.vs_tickets.resolution is
  'Close reason (fixed/forwarded/wont_do/duplicate), set by staff when status→เสร็จสิ้น. Submitter-visible. See 0073.';
comment on column public.vs_tickets.resolution_note is
  'Submitter-visible detail for the resolution (required in UI when resolution=wont_do). See 0073.';
