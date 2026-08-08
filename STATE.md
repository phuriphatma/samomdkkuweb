# STATE — current task & latest known state

Last updated: 2026-08-08. Read on every cold start, so it is "what is true
RIGHT NOW" and nothing else — `git log --oneline` is the chronology. Keep it
under ~200 lines; when it bloats, move SHIPPED narratives to
`docs/state-archive/YYYY-MM-DD.md` and leave a two-line pointer.

**Start here:** the section immediately below (what just shipped), then CURRENT DEPLOY.

Shipped detail pruned out of here most recently:
`docs/state-archive/2026-08-08-house-polish.md` (0123 + 0124, the บ้านของฉัน card
and the CSV round-trip work),
`docs/state-archive/2026-08-05-late-13-requests.md` (the 13-request session,
ทีม SAMO view/edit + master, 0110–0113),
`docs/state-archive/2026-08-05-shipped.md` (the org-chart accordion, the first
ตำแหน่งของฉัน card, `/updates` + the version system),
`docs/state-archive/2026-08-04-shipped.md` (the GAS/Drive migration, the
article-cover fix and the earlier shipped list),
`docs/state-archive/2026-07-31-team-0104-detail.md` and
`docs/state-archive/2026-07-30-pre-clear.md`; earlier narrative:
`docs/state-archive/2026-07-24-full.md`;
chronology: `git log --oneline`; architecture/RLS: `docs/CONTEXT.md`; bug
post-mortems: **`docs/mistakes/*.md`** (indexed by `.claude/rules/mistakes.md`
— see Housekeeping at the bottom; the corpus moved out of `.claude/rules/` on
2026-08-05 and the archive file is gone).

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
- **KKU SSO assessed, not built** — `docs/KKU-SSO.md`. It is a login
  improvement, NOT a data source: no roster endpoint, no สายรหัส, no สาขา, and it
  returns `citizenId` we must never store. **The CSV is still required.**
  Credentials in `.env.local` (`KKU_SSO_*`); manual `docs/KKU-SSO-MANUAL.md`.

## SHIPPED 2026-08-07 — ระบบบ้าน + the DELETE guard + หนังสือโครงการ visibility

Migrations **0114–0122**, all live. Reasoning + proofs:
**`docs/state-archive/2026-08-07-house-system.md`**. Carry these four:

- `house = last digit of สายรหัส`; สายรหัส is any `001`–`999`, random, NOT derived
  from รหัสนักศึกษา. `sais.house_id` is GENERATED; `sais` rows are created **on
  demand by a trigger on `students`** (0122) — never seeded, never per-caller.
- Every DELETE reports an RLS block (`src/js/delete-guard.test.js` sweeps it).
- `projects.is_public` / `project_documents.is_public` — opt-out, sender-side
  only, per-COLUMN trigger. Proof: `node tools/proj0114-visibility.mjs`.
- Example data carries no real student's identity (`659999999-9`).

## Earlier sessions — archived, nothing owed

The 13-request session and the ทีม SAMO view/edit + master work (0110–0113):
`docs/state-archive/2026-08-05-late-13-requests.md`. The public org-chart
accordion, the first ตำแหน่งของฉัน card, `/updates` + the version system:
`docs/state-archive/2026-08-05-shipped.md`. All live and verified.

## ทีม SAMO — shipped 2026-08-01, still true

Crop-on-upload, stacked modals, real Drive photo deletes (a REFCOUNT — an
archived year shares the live photo's file id), and the ตรวจสอบข้อมูล pane
(24 findings, flags WHO on each member row and rolls counts up the tree).
Migration **0108 `team_people`** is applied but EXPAND-ONLY: nothing reads it,
all ten resolvers still join `team_members.kkumail`.

**The rule that governs it: kkumail is the identity, รหัสนักศึกษา is a field.**
Never merge on name — `673070332-6` is one mistyped รหัส shared by two humans.

**0108's contract step is still owed, and its first job is the INSERT gap:**
`createMember` and the CSV import write `person_id = null`, so rows added since
0108 are already unlinked. Fix with a BEFORE INSERT trigger or re-run the
(idempotent) backfill. Full reasoning: `docs/state-archive/2026-08-01-team-identity.md`.

## CURRENT DEPLOY

- Prod host = KKU VM `samo.md.kku.ac.th` (pages.dev retired → splash-redirects).
  Deploy = commit → push `main` → `skills/deploy-vm.md`. **Needs VPN.**
- **samoweb**: `main` = `d62a374` is what is DEPLOYED; the บ้านของฉัน rework +
  0123–0124 are committed but NOT yet on the VM (needs VPN → `skills/deploy-vm.md`).
  Still **v4.5.0** — no version cut; `PENDING` in
  `src/data/changelog.js` holds notes for หนังสือโครงการ, the DELETE fix and
  ระบบบ้าน, so the next release is a **minor** bump (`npm run release`).
- **Migrations applied through 0125.** Live proofs, both directions:
  `node tools/db-query.mjs tools/house0116-authz.sql` (house authz) and
  `node tools/proj0114-visibility.mjs` (29/29, projects visibility).
- ⚠️ **Rotate the VM sudo password.** A malformed ssh call echoed it into a
  session transcript on 2026-08-07. Change it on the VM and update
  `SAMO_VM_SUDO_PASSWORD` in `.env.local`.

## NEXT — un-started work → `docs/NEXT.md`

The backlog (with the reasoning behind each item, including the
`notifyProjectEmail` content-hardening options) lives in **`docs/NEXT.md`**; the roles/permissions + member-photo design is a separate,
fuller document at **`docs/TEAM-ROLES-AND-PHOTOS.md`** (written 2026-08-04,
nothing built, and it ends with five decisions the user has to make).

## PR + VITALSOUND — stable, pruned to the archive

Both shipped and deployed (PR ฝ่าย single-source-of-truth `src/js/pr-depts.js`;
VS service desk + public board, migrations through 0080). Full write-up incl. the
VS confidentiality invariants: `docs/state-archive/2026-07-25-pr-vs.md`.

## OTHER SYSTEMS (stable; details in archive + CONTEXT.md)

- **PR / News / Shop / Projects / Analytics**: unchanged this session. Shop = Model A
  shared admin (0057/0058); projects ปีงบ filter; analytics strip + staff dashboard live.
- **Passport** (separate repo `phuriphatma/samomdkkupassport`, same Supabase project,
  `passport` schema): kkumail-only gate live; 5 gmail→kkumail migrations verified;
  awaiting students' replies at mdstuddata.beta@gmail.com. Dev test still ACTIVE
  (pmphuriphat→phuriphat.ma) — revert SQL in `docs/state-archive/2026-07-24-full.md`
  ("ACTIVE TEST STATE"). Old project B `idwlabpbwiwgaoqwbozz` paused as cold backup —
  rotate its DB password (in `.env.local`) before deleting.
- **notify**: `/notify` Node service on the VM; `notify_log` (0055) recording;
  `main` branch protected (1 approval; owner ff-push exempt).
- Retention jobs NOT scheduled (`prune_analytics`, `prune_notify_log`) — run manually
  if tables grow.

## Housekeeping — the memory system

Restructured 2026-08-05 and stable since. **Do not re-create
`.claude/rules/mistakes-archive.md`** — it lived in the auto-loaded directory, so
archiving into it saved nothing.

| | where | loaded |
|---|---|---|
| recurring **classes** + a 1-line index of every entry | `.claude/rules/mistakes.md` | every session |
| the **write-ups**, nine files by area | `docs/mistakes/*.md` | on demand |

- **The index is GENERATED** — `npm run mistakes:index`. Never hand-edit it; if a
  line reads badly, fix the heading it came from.
- **The budget is ENFORCED** — `npm run check:context` (run by `npm test`) fails
  when an auto-loaded file exceeds its cap. **When it breaches, move detail into
  `docs/`. Never raise the cap** — reaching for the cap is what caused the 63k-token
  problem this replaced.
- **Release notes are staged as the work ships** — `PENDING` in
  `src/data/changelog.js`, folded in by `npm run release`. Not rendered on
  `/updates`: an unreleased list on a public page is a promise.
- **STATE.md**: keep COMPLETED work in `docs/state-archive/`; leave only what is
  true right now. `git log --oneline` is the chronology.
- `.env.local` holds the Supabase PAT, VM sudo pw, project-B DB creds — never commit.
- CI = Node 22. `npm run build && npm test` before every commit.

## NEXT-SESSION PROMPT (paste this after a /clear — written 2026-08-07)

> Read STATE.md first: the SHIPPED block at the top, then CURRENT DEPLOY.
> Migrations are applied through **0125**, 494 tests green, nothing in flight —
> but the latest commits are **not on the VM yet**: `main` = `d62a374` is what
> `samo.md.kku.ac.th` is serving. Deploying needs VPN (`skills/deploy-vm.md`).
>
> What landed last: **ระบบบ้าน (House)** — every student in the faculty gets a
> record they see by signing in with kkumail, plus a house derived from their
> สายรหัส. Design `docs/HOUSE-SYSTEM.md`; the session's full reasoning and every
> live proof is `docs/state-archive/2026-08-07-house-system.md`. Also: every
> DELETE in the app now reports an RLS block instead of silently succeeding.
>
> **The one thing actually waiting: the student data has not arrived.** The
> handover spec to send the Data Analytics dept is `docs/house-data-spec-th.md`
> (forward it as-is; template `docs/templates/house-import-template.csv`). They
> send **20 rows first**, then the full ~1,800. Import at
> `/admin/` → ระบบบ้าน → นำเข้าข้อมูล: it previews, and writes nothing until
> confirmed. Until then every pane renders an honest empty state — that is
> designed, not broken.
>
> Last thing fixed (0122): setting a student's สาย to a code nobody had used yet
> 23503'd on the `sai_code` foreign key. `sais` is a DERIVED set, so a BEFORE
> trigger on `students` now creates the สาย row on demand — **do not "fix" this
> again in a caller.** The lesson generalises and is the one to carry: when a fix
> is "materialise X on demand", put it on the TABLE (trigger / default /
> generated column), never in the one caller you happened to be looking at.
> `grep` the column name and count the writers first. This repo has now paid for
> that shape three times in one session (0119, 0121, 0122).
>
> Open, none blocking:
> 1. **The ทีม SAMO delete diagnosis is UNCONFIRMED.** "Nothing happens" on the
>    trash button is almost certainly Chrome's "Prevent this page from creating
>    additional dialogs" making `confirm()` return false silently. A hard reload
>    settles it. If confirmed, replace the 8 native `confirm()` calls in
>    `team/index.js` with an app-owned Bootstrap modal.
> 2. **Real student identities are in the public repo.**
>    `supabase/migrations/0047_seed_team_data.sql` seeds ~285 real members
>    (names, kkumail, รหัส) and several `docs/mistakes/*.md` write-ups quote real
>    students. Deliberately NOT rewritten — 0047 is applied history and the
>    write-ups describe real incidents. Removing them from the working tree does
>    not remove them from git history, which is already public. Needs the user's
>    decision: accept, rewrite history, or make the repo private.
> 3. **Rotate the VM sudo password** (see CURRENT DEPLOY), and **rotate the KKU
>    SSO client secret** — it was pasted into a chat transcript on 2026-08-08.
> 4. **`students` is not empty.** At least one row exists for the owner's kkumail
>    from manual testing — created before any import. Tidy it in ระบบบ้าน →
>    นักศึกษา before the real import, or let the import update it (it upserts on
>    kkumail, so it will merge rather than duplicate).
> 5. Older, still true: **0108's contract step is owed** (`createMember` and the
>    CSV import still write `person_id = null`); the team photo SAVE path is
>    unverified by hand.
>
> **Decided — do not re-raise:**
> - **ระบบบ้าน has no ชั้นปี.** รุ่น (`MD{cohort−2515}`, from the รหัสนักศึกษา) is
>   the only cohort vocabulary. No academic-year setting, no per-student
>   override, no `student_year()` in either language.
> - **No ยืนยันข้อมูล.** We do not ask students to confirm their record.
> - **No student roster.** ระบบบ้าน publishes อาจารย์ only — never one student to
>   another. `get_house_roster()` is dropped; do not re-add it.
> - **สายรหัส is NOT derived from รหัสนักศึกษา.** It is the university's random
>   mentor assignment; nothing may compute, infer or "repair" one. Any `001`–`999`
>   is legal and **no maximum may be hardcoded** — that bug has been made twice.
> - **`sais` is DERIVED, never seeded**, and the trigger on `students` (0122) is
>   what guarantees a สาย exists. No maximum, no seeded range, no per-caller check.
> - **house = last digit of สายรหัส**, and `sais.house_id` (GENERATED) is the only
>   implementation. JS reads it; `houseOf()` exists solely for the import preview.
> - **ชื่อ and นามสกุล stay separate** in `students` (joined by a generated
>   `full_name`). Separate→combined is lossless; combined→separate is a guess that
>   breaks on `ณ อยุธยา`. ทีม SAMO keeps its single field — do not migrate it.
> - **Nothing is gated on a date**, and there is **no reveal flag** — an unnamed
>   house is the un-revealed state.
> - **Public visibility of หนังสือโครงการ defaults to SHOWN** (opt-out).
> - **`ฝ่ายเอิงtest` and the second `ภู` row on `หัวหน้าฝ่าย IT` stay** — the
>   user's own test rows, knowingly kept.
>
> Backlog: `docs/NEXT.md`. Roles/photos design with five open decisions:
> `docs/TEAM-ROLES-AND-PHOTOS.md`.
