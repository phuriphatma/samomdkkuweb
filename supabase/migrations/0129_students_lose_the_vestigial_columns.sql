-- ============================================================
-- 0129 — the five columns nothing reads finally leave the table
--
-- WHAT WAS REPORTED
--   "i don't understand why when i export csv … i don't know why there're
--    cohort_year, year_override, shouldn't that not exist because we change to
--    use รุ่น like MD50, and why are there is_listed, why are there sai_locked,
--    verified_at shouldn't that be gone"
--
-- Yes. Every one of them is dead, and each was left behind by a feature that
-- was removed on purpose:
--
--   year_override  — the ชั้นปี escape hatch. ชั้นปี itself went in 0123; รุ่น is
--                    fixed at admission and has nothing to override.
--   is_listed      — a student's opt-out of the เพื่อนร่วมบ้าน roster, which was
--                    dropped outright in 0124. No roster, no opt-out.
--   sai_locked     — the admin's lock on a สายรหัส a student could edit. 0125
--                    took the self-edit away entirely, so the lock locks nothing.
--   sai_self_edits — the counter that lock consumed. Same fate.
--   verified_at    — the "ข้อมูลถูกต้อง" timestamp, removed from the card in 0123
--                    because nobody was ever going to act on it.
--
-- Each was commented VESTIGIAL when its feature went, on the reasoning that
-- dropping a column is the one step a re-run cannot undo and the real data had
-- not landed yet. That was right at the time. What it did not account for is
-- that the CSV export is a hand-built column list (io.js EXPORT_COLUMNS) whose
-- documented safe default is "when in doubt, include it" — so five dead fields
-- were being handed to a human as if they were data, and the first person to
-- read the file asked what they were. A column nobody reads is not inert: it
-- gets exported, re-imported, and eventually believed.
--
-- WHY THIS IS SAFE TO DROP NOW, checked rather than assumed (2026-08-08, live):
--   • no function body in `public` mentions any of the five
--     (pg_get_functiondef over prokind='f');
--   • no trigger on `students` fires `of <column>`;
--   • the stored values are all defaults — 0 rows with year_override, 0 with
--     is_listed off, 0 locked, 0 with a self-edit counted. One row carries a
--     verified_at from before 0123, and that timestamp records a button that
--     no longer exists.
--   • `students` holds 3 rows. The ~1,800-row import has not landed, which
--     makes this the cheapest moment this decision will ever have.
--
-- `cohort_year` STAYS, and it is the one the report names that is not dead. It
-- is what 0128 keeps in step with the รหัสนักศึกษา, and it is what a manual
-- correction writes for the transfer student whose รหัส does not encode their
-- intake. What leaves is its presence in the EXPORT: a person reading the file
-- wants รุ่น MD50, not ปีที่เข้า 2565, and io.js now writes the label.
--
-- ⚠️ DESTRUCTIVE, and the user asked for it in those words. Not archived
-- anywhere: the whole point is that these fields are not worth carrying, and a
-- dormant copy is the thing that rots.
-- ============================================================

alter table public.students drop column if exists year_override;
alter table public.students drop column if exists is_listed;
alter table public.students drop column if exists sai_locked;
alter table public.students drop column if exists sai_self_edits;
alter table public.students drop column if exists verified_at;

comment on column public.students.cohort_year is
  'ปีที่เข้า (พ.ศ.). Derived from student_id and kept in step with it by '
  'students_fill_cohort (0128); an explicit value in the same statement wins, '
  'which is the transfer-student escape hatch. Displayed as รุ่น MDnn '
  '(cohort - 2515) — never as a year, and never as ชั้นปี.';

-- NOT dropped here: `house_settings`. Every column on it is vestigial too and
-- nothing reads the row, but it is a TABLE, and this repo asks before dropping
-- one. It is the obvious next cleanup.
