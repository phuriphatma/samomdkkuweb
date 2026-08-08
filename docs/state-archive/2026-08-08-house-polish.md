# 2026-08-08 — ระบบบ้าน polish: the student card, รุ่น, สาย-first อาจารย์, CSV

Archived out of STATE.md the day it shipped. Migrations **0123** and **0124**,
both applied and proved live. Commits: `git log --oneline` around `c8949d1`.

## SHIPPED 2026-08-08 — ระบบบ้าน: the card, รุ่น, อาจารย์-per-สาย, CSV hardening

**The import bug worth remembering: an upsert that sends every column wipes the
ones the file did not have.** A corrected name-list omitting `sai` would have
cleared ~1,800 สายรหัส and every house placement, while the preview said
"แก้ไข 1,800" — both halves computed from the same wrong column set, so they
agreed. `parseStudentsCsv` now returns `presentColumns` and both the payload and
the diff are scoped to it. Write-up + 3 tests in `docs/mistakes/app-state.md`.

**Import and export now share ONE vocabulary — the table's column names**, with
the spreadsheet spellings (`sai`, `nickname_th`, ชื่อ, อีเมล) as aliases. The
generated `nickname` left the export: the importer read it back as
`nickname_imported`, so a round trip promoted a student's own ชื่อเล่น into the
university's column. The handover spec (`docs/house-data-spec-th.md`) was
rewritten around "3 things must be right, we normalise the rest": kkumail,
split name columns, UTF-8. **Leading-zero สาย is no longer fatal** — Excel strips
leading zeros only, so left-padding is lossless and the house (last digit) is
invariant; it is a loud warning now, not a refusal. New fatals: non-UTF-8 (with
an .xlsx-specific message), and a single combined "ชื่อ-สกุล" column.

**Admin: click a สาย to manage its อาจารย์** — search by สาย or อาจารย์, filter to
the ones with none. Same `sai_advisors` rows as the อาจารย์-first editor.

**`sai_locked` explained in the UI** — it bars ONE student from self-editing
their สาย even while the global switch is open; they can still file a request.

## Earlier the same day — the card, รุ่น instead of ชั้นปี (0123–0124)

- **"ต้องกดหลายครั้งถึงจะขึ้น" is fixed.** `renderMyHouse()` added a delegated
  listener to `#homeMyHouse` — a node that survives every re-paint — and the
  handler `toggle`d `d-none`. Every auth event added one more listener, so the
  panel opened only on odd-numbered paints. Listeners now go on the nodes each
  paint creates, and panel state is ONE variable. Write-up +
  `src/js/house/my-house.test.js` pin both shapes.
- **The card now reads like ตำแหน่งของฉันในทีม SAMO** — same shell, same
  label→value list (ชื่อ-สกุล · ชื่อเล่น · รหัสนักศึกษา · รุ่น · สาขา · สายรหัส ·
  บ้าน · KKU Mail). It REUSES `my-seat.css` on purpose; `my-house.css` holds only
  the crest, accent, advisors and roster. แจ้งข้อมูลไม่ถูกต้อง is an in-card form
  now, not two `prompt()`s (which Chrome can suppress silently).
- **ชั้นปี is gone from ระบบบ้าน; รุ่น (MD50) replaces it.** `cohort − 2515`, off
  the รหัสนักศึกษา. No clock, no `year_override`, no `academic_year` setting.
  `student_year()` dropped in SQL *and* its JS mirror, same commit.
- **ยืนยันข้อมูล removed** — a timestamp nothing branched on.
- **เพื่อนร่วมบ้าน removed, อาจารย์ในบ้าน added (0124).** Students do not need a
  list of classmates; they need to know who the อาจารย์ are. The card now shows
  their own สาย's อาจารย์ and then every other อาจารย์ in the house tagged with
  their สาย (from `house_advisors`, already in the payload). `get_house_roster()`
  is **DROPPED**, not just unlinked — a read path that publishes 1,800 students
  to any signed-in caller is removed at the database, not in the one button that
  called it. **ระบบบ้าน names no student to any other student.**
- **0123 APPLIED.** Live proofs, both directions: payload keys carry
  `cohort_year` and no `year`/`verified_at`; a patch sending
  `{"year_override":3,"verify":true,"nickname_self":"…"}` wrote the nickname and
  ignored the other two (probe rolled back via `raise`).
- `students.year_override`, `students.verified_at`, `students.is_listed`,
  `house_settings.academic_year`, `house_settings.roster_visible`
  are **vestigial, not dropped** — nothing reads or writes them, and they carry
  `comment on column` saying so. Drop when the real data has landed if still empty.


## SHIPPED 2026-08-08 — ระบบบ้าน polish (0123 + 0124)

Applied and proved live. Full detail + every proof:
**`docs/state-archive/2026-08-08-house-polish.md`**. Headlines:

- **บ้านของฉัน reads like ตำแหน่งของฉัน** — one label→value list, same stylesheet.
  The "must click many times" bug was one delegated listener added to the
  surviving host per re-render, plus a `toggle` that read its own class.
- **รุ่น (MD50 = cohort − 2515), never ชั้นปี.** No clock, no override; SQL's
  `student_year()` and its JS mirror both deleted. **No ยืนยันข้อมูล.**
- **ระบบบ้าน publishes อาจารย์, never students.** `get_house_roster()` DROPPED;
  the card lists the อาจารย์ of every สาย in the house instead.
- **An import now writes only the columns its file carried.** Sending every
  column would have cleared ~1,800 สายรหัส from a file that merely omitted them.
- **One CSV vocabulary (the table's), spreadsheet spellings as aliases.**
  Leading-zero สาย is recoverable, so it warns instead of refusing; non-UTF-8 and
  a combined "ชื่อ-สกุล" column are the new fatals.
- **Admin: click a สาย to manage its อาจารย์.**
- **0125 — a student owns their identity, and not their สาย.** They self-edit
  ชื่อ · นามสกุล · ชื่อเล่น · รหัสนักศึกษา · สาขา (a chooser over `team_majors`,
  refused server-side if off-list). สายรหัส is NOT self-editable at any level —
  it decides the house, so the route is a request an admin approves. Four of
  those are import-owned columns, so `students.self_edited text[]` + a BEFORE
  UPDATE trigger preserve them on any write stamping a new `last_import_batch`:
  **admin > student > import**, enforced on the TABLE. Proved live both ways
  (self-edit sticks through a simulated import; `cohort_year` still updates;
  an off-list สาขา raises). `sai_self_edit_open` / `sai_locked` /
  `sai_self_edits` are now vestigial — ระบบบ้าน has **no admin settings left**.
- **0126 — a student row can arrive with NO NAME.** `first_name_th` is nullable
  and `full_name` is NULL (not `''`) when empty, so the ask to Data Analytics is
  now **4 columns: `kkumail, student_id, sai, major`** — 1,800 names never leave
  their department. The student types their own (0125). A COMBINED "ชื่อ-สกุล"
  column is still refused: no name column names nobody, one combined column
  renames everybody whose surname has a space. Also fixed: a self-edited
  duplicate รหัสนักศึกษา hit `students_sid_uniq` and surfaced a raw 23505 — now a
  Thai sentence, pre-checked AND caught in an exception handler for the race.
- **KKU SSO probed live (UAT) — it CAN supply the identity.** One real student
  login: `user.profile` returns `studentId` + **`studentCode` (`653070317-0`,
  already our canonical form)**, `type: STUDENT`, Thai + English names and
  `facultyName` — **none of `studentId`/`studentCode` is in the vendor manual**,
  which also documents an `immutableId` the API does not return and calls `mail`
  `email`. It cannot supply **สาขา** (`levelName` is the degree level) or
  ชื่อเล่น. UAT is backed by the REAL directory, so this transfers to prod.
  Blocking: our registration is **UAT-only** (prod login answers "Cannot find the
  CREDENTIAL"), so a production app must be requested; and `citizenId` comes back
  on both calls and must never be stored. Probe: `node tools/sso-probe.mjs`.
- **KKU SSO assessed, not built** — `docs/KKU-SSO.md`. It is a login
  improvement, NOT a data source: no roster endpoint, no สายรหัส, no สาขา, and it
  returns `citizenId` we must never store. **The CSV is still required.**
  Credentials in `.env.local` (`KKU_SSO_*`); manual `docs/KKU-SSO-MANUAL.md`.


## The live proofs, both directions

- `get_my_student_record()` payload keys: carries `cohort_year`, and no `year` /
  `year_override` / `verified_at` / `roster_visible`.
- A patch sending `{"year_override":3,"verify":true,"nickname_self":"…"}` wrote
  the nickname and ignored the other two — probe rolled back by ending the DO
  block in a `raise`, so production was never changed.
- `get_house_roster` is gone from `pg_proc` while `get_house_summary` is still
  there (the positive control that proves the sweep can find things).
- `house_advisors` returns one row per (อาจารย์, สาย) for the caller's house.

## 0125–0126 — the self-edit boundary, and the nameless row

- **0125**: a student owns ชื่อ · นามสกุล · ชื่อเล่น · รหัสนักศึกษา · สาขา, and
  their สายรหัส not at all. Four of those are import-owned columns, so
  `students.self_edited text[]` + a BEFORE UPDATE trigger preserve them on any
  write stamping a new `last_import_batch` (admin > student > import). สาขา is
  validated against `team_majors`, whose write gate widened to `house`.
  Consequence: `sai_self_edit_open` / `sai_locked` / `sai_self_edits` are
  vestigial and ระบบบ้าน has **no admin settings at all** any more.
- **0126**: `first_name_th` nullable, `full_name` NULL rather than `''` when
  empty — the import file may deliberately carry no names. Recommended ask is
  now `kkumail, student_id, sai, major`. Also: a self-edited duplicate
  รหัสนักศึกษา used to surface a raw 23505 from `students_sid_uniq`; now a Thai
  message, pre-checked and caught in an exception handler for the race.

Live proofs (all rolled back via a terminal `raise`): a self-edit survives a
simulated import while `cohort_year` still updates; an off-list สาขา raises; a
patch carrying `sai_code` changes nothing; a nameless row inserts and reads back
`full_name = NULL`; a duplicate รหัส and a blanked name both raise in Thai.

## Vestigial columns left in place

`students.year_override`, `students.verified_at`, `students.is_listed`,
`house_settings.academic_year`, `house_settings.roster_visible`. Nothing reads
or writes any of them; each carries a `comment on column` saying so. Dropping a
column is the one step re-running a migration cannot undo, so it waits until the
real data has landed and they are confirmed empty.
