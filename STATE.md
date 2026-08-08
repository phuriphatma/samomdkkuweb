# STATE — current task & latest known state

Last updated: 2026-08-08. Read on every cold start, so it is "what is true
RIGHT NOW" and nothing else — `git log --oneline` is the chronology. Keep it
under ~200 lines; when it bloats, move SHIPPED narratives to
`docs/state-archive/YYYY-MM-DD.md` and leave a two-line pointer.

**Start here:** the section immediately below (what just shipped), then CURRENT DEPLOY.

Shipped detail pruned out of here most recently:
`docs/state-archive/2026-08-08-late-0128-0131.md` (0128–0131 — the cohort fix,
the request answer path, the vestigial-column drop and the ชั้นปี offset),
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

## SHIPPED 2026-08-08 (late) — 0128–0131

Live on the VM (`main` = `a5c28fd`), verified from the served bundles.

**0131 — ชั้นปี is a stored DIFFERENCE, not a number.** รุ่น and ชั้นปี are
different facts and ลาพัก is what separates them: that person is still MD50 and
is now studying ปี 4. So `students.year_offset` holds the GAP (`-1` = one year
behind their รุ่น, correct forever), the year is COMPUTED on every render, and
both choosers show real years 1–6 while saving `picked − computed`. ปีการศึกษา
comes from the clock (สิงหาคม rollover), one constant, NOT a setting. There is
deliberately **no SQL twin** of the derivation — nothing server-side gates on
ชั้นปี. Unbounded on purpose (owner's call). Proof:
`node tools/house0131-year-offset.mjs` (9/9) + 11 unit tests across two
academic years.

⚠️ **`team_members.year` is still a typed 1–6 column, 399 rows, and NOTHING in
this repo has ever bumped it** (verified: no `year + 1` anywhere, and publishing
a term snapshots without recomputing). So every August all 399 silently become
last year's answer. 381/399 have a รหัส that yields a cohort and only 11
disagree with the computed year — i.e. the repoint is cheap and the 11 become
offsets. It is NOT done here on purpose: doing it now means a second offset
column the person-registry merge would immediately have to reconcile. See
`docs/PERSON-REGISTRY.md`.

## The 0128–0130 pass — fifteen reports, all live

Full detail and every proof: **`docs/state-archive/2026-08-08-late-0128-0131.md`**.
Carry these four:

- **0128** — `cohort_year` re-derives on every รหัส change (it was `if is null`,
  i.e. fill-once); a คำขอแก้ไข's verdict + note + `applied_value` now reach the
  student through `get_my_student_record()`; `advisors.title` dropped and
  `email` published to the house.
- **0129** — five vestigial columns off `students`. ⚠️ **This caused a ~20-min
  outage**: the SERVED bundle still named them and PostgREST 400s on an unknown
  column. **Deploy first, drop second** — now in `docs/mistakes/deploy-hosting.md`.
- **0130** — `lookup_student_by_kkumail()`, exact match only, no anon grant. A
  deliberate widening: `team` alone can now resolve one address against
  `students`. Full merge designed in **`docs/PERSON-REGISTRY.md`**, NOT built.
- **Admin landing** carries a card for every `SIDE_FEATURE` key, and
  ข้อมูลของฉัน moved there out of the ทีม SAMO tab. Pinned by
  `src/js/admin-landing.test.js` (verified to fail when a card is removed).

**Debugging note, now in mistakes.md class 7:** `current_user_has_permission()`
reads the UNION of `permissions` AND `managed_permissions` (0081). A probe
subject picked by `permissions = '{}'` alone may hold `master` through the
ทีม SAMO tree and reads exactly like a fail-open RLS policy. Filter on BOTH.
## SHIPPED 2026-08-08 — ระบบบ้าน, end to end (0123–0127)

All applied, deployed, verified on the served artifacts. Detail + every live
proof: **`docs/state-archive/2026-08-08-house-polish.md`**. The four invariants
worth carrying:

- **บ้านของฉัน shows รุ่น (MD50), never ชั้นปี** — a fact fixed at admission, so
  it needs no clock, no override and no maintenance.
- **ระบบบ้าน publishes อาจารย์, never students.** `get_house_roster()` dropped.
- **admin > student > import, enforced on the TABLE** — `students.self_edited`
  plus a BEFORE UPDATE trigger, so a re-import cannot revert a self-edit.
- **The import writes only the columns its file carried.** A row may have no
  name; `000` is refused; short สาย (`7` → `007`) are fine.

## SHIPPED 2026-08-07 — ระบบบ้าน + the DELETE guard + หนังสือโครงการ visibility

Migrations **0114–0122**, all live. Reasoning + proofs:
**`docs/state-archive/2026-08-07-house-system.md`**. Carry these three:

- `house = last digit of สายรหัส`; สายรหัส is any `001`–`999`, random, NOT derived
  from รหัสนักศึกษา. `sais.house_id` is GENERATED; `sais` rows are created **on
  demand by a trigger on `students`** (0122) — never seeded, never per-caller.
- Every DELETE reports an RLS block (`src/js/delete-guard.test.js` sweeps it).
- `projects.is_public` / `project_documents.is_public` — opt-out, sender-side
  only, per-COLUMN trigger. Proof: `node tools/proj0114-visibility.mjs`.

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
- **samoweb**: `main` = `a5c28fd`, DEPLOYED and verified from the served
  artifact. Still **v4.5.0** — no version cut; `PENDING` in `src/data/changelog.js` now
  holds ~15 notes, so the next release is a **minor** bump (`npm run release`).
- **Migrations applied through 0131.** Live proofs, all both-directional:
  `node tools/house0128-cohort.mjs` (8/8) · `node tools/house0128-requests.mjs`
  (9/9) · `node tools/house0131-year-offset.mjs` (9/9) · `node tools/db-query.mjs tools/house0116-authz.sql` (house authz) ·
  `node tools/proj0114-visibility.mjs` (29/29, projects visibility).
- ⚠️ **Rotate the VM sudo password.** A malformed ssh call echoed it into a
  session transcript on 2026-08-07. Change it on the VM and update
  `SAMO_VM_SUDO_PASSWORD` in `.env.local`.

## NEXT — un-started work → `docs/NEXT.md`

The backlog (with the reasoning behind each item, including the
`notifyProjectEmail` content-hardening options) lives in **`docs/NEXT.md`**; the roles/permissions + member-photo design is a separate,
fuller document at **`docs/TEAM-ROLES-AND-PHOTOS.md`** (written 2026-08-04,
nothing built, and it ends with five decisions the user has to make).

## OTHER SYSTEMS — stable, nothing owed

PR · VitalSound · News · Shop · หนังสือโครงการ · ทีม SAMO · Analytics: unchanged
this session. Write-ups in `docs/state-archive/` (VS confidentiality invariants:
`2026-07-25-pr-vs.md`); architecture in `docs/CONTEXT.md`.

- **Passport** (repo `phuriphatma/samomdkkupassport`, same Supabase project,
  `passport` schema): kkumail-only gate live. Dev test still ACTIVE
  (pmphuriphat→phuriphat.ma) — revert SQL in
  `docs/state-archive/2026-07-24-full.md` ("ACTIVE TEST STATE"). Old project B
  `idwlabpbwiwgaoqwbozz` is a cold backup — rotate its DB password before deleting.
- **notify**: `/notify` Node service on the VM; `notify_log` (0055) recording;
  `main` protected (1 approval; owner ff-push exempt).
- Retention jobs NOT scheduled (`prune_analytics`, `prune_notify_log`).

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

## NEXT-SESSION PROMPT (paste this after a /clear — written 2026-08-08)

> Read STATE.md first: the SHIPPED block at the top, then CURRENT DEPLOY.
> **Everything is shipped, deployed and verified on the served artifacts.**
> `main` = the commit named in CURRENT DEPLOY, migrations applied through
> **0126**, 499 tests green. Nothing is in flight.
>
> This session was all **ระบบบ้าน**. What it now is, in one paragraph: a student
> signs in with kkumail and sees ONE card — their record as a label→value list
> (ชื่อ-สกุล · ชื่อเล่น · รหัสนักศึกษา · **รุ่น MD50** · สาขา · สายรหัส · บ้าน ·
> KKU Mail), the อาจารย์ที่ปรึกษา of their own สาย, and the อาจารย์ of every
> other สาย in their house. They can edit five of those fields; they can never
> edit their สายรหัส. Admins manage อาจารย์ by clicking a สาย.
>
> **The one thing actually waiting: the student data has not arrived.** Send
> `docs/house-data-spec-th.md` to Data Analytics as-is. It now leads with a
> **4-column ask — `kkumail, student_id, sai, major`, no names at all**
> (`docs/templates/house-import-minimal-template.csv`); the 7-column form is
> still there for when a named list is wanted. 20 rows first, then ~1,800.
> Import at `/admin/` → ระบบบ้าน → นำเข้าข้อมูล: it previews and writes nothing
> until confirmed. Until then every pane renders an honest empty state.
>
> **Decided this session — do not re-raise:**
> - **ระบบบ้าน has no ชั้นปี.** รุ่น (`MD{cohort−2515}`, from the รหัสนักศึกษา) is
>   the only cohort vocabulary. No academic-year setting, no per-student
>   override, and `student_year()` is dropped in BOTH SQL and JS.
> - **No ยืนยันข้อมูล**, and **no student roster** — ระบบบ้าน publishes อาจารย์,
>   never one student to another. `get_house_roster()` is dropped; do not re-add.
> - **A student can NEVER self-edit สายรหัส.** It decides the house. The route is
>   `request_my_change('sai_code', …)` → an admin approves.
> - **A student CAN self-edit ชื่อ · นามสกุล · ชื่อเล่น · รหัสนักศึกษา · สาขา**, and
>   `students.self_edited` + a BEFORE UPDATE trigger stop the next import
>   reverting it. Order is **admin > student > import**, enforced on the TABLE.
> - **สาขา is a chooser over `team_majors`** — one faculty-wide vocabulary, CRUD
>   at ทีม SAMO → สาขา, and the RPC refuses anything off the list.
> - **An import writes ONLY the columns its file carried**, and a row may have no
>   name at all. A COMBINED "ชื่อ-สกุล" column is still refused.
> - **Never normalise a NAME.** A leading `นาย`/`นางสาว` is REPORTED, never
>   stripped — `นายก` is a real name. Case/whitespace/digits have canonical
>   forms; names do not. (`kkumail` is the deliberate exception: lowercasing is
>   required by a plain UNIQUE index + `lower()=lower()` lookups, and enforced by
>   a table trigger since 0119.)
> - **KKU SSO is a login improvement, not a data source** — `docs/KKU-SSO.md`.
>   It CAN supply ชื่อ/นามสกุล/รหัสนักศึกษา at login (probed live: `studentCode`
>   arrives as `653070317-0`), but not สาขา, there is no roster endpoint, and our
>   registration is **UAT-only**. Decision recorded: import the CSV instead.
> - **สายรหัส is NOT derived from รหัสนักศึกษา**, any `001`–`999` is legal, no
>   maximum may be hardcoded, and `sais` rows are created on demand by a trigger.
>   A short สาย (`7`, `17`) is PADDED and accepted — padding only ever restores a
>   leading zero and the house is the last digit, so it is lossless. **`000` is
>   refused** in JS and by a check constraint (0127): it is what a spreadsheet
>   puts in an empty numeric cell, not a สาย.
> - **house = last digit of สายรหัส**; `sais.house_id` (GENERATED) is the only
>   implementation.
>
> Open, none blocking:
> 1. **Rotate the VM sudo password** and **the KKU SSO client secret** (both were
>    exposed in chat transcripts on 2026-08-07 / 08-08).
> 2. **`team/index.js` still has 9 native `confirm()` calls.** `src/js/confirm-modal.js`
>    (`askConfirm` / `askDelete`) exists now and ระบบบ้าน uses it — converting
>    ทีม SAMO is mechanical and is the next thing to do. This is not theoretical:
>    the same class shipped a live bug in ระบบบ้าน's ปฏิเสธ button on 2026-08-08
>    AFTER being listed as an open item, which is why it is worth doing now.
> 3. **`students.self_edited` is invisible to admins** — not in `STUDENT_COLS`,
>    not in the CSV export. An admin cannot see which fields a student owns, and
>    a backup/restore loses it. Harmless today (admin edits win regardless).
> 5. **`students` is not empty** — a few rows from manual testing, incl. the
>    owner's real record. The import upserts on kkumail so it will merge.
> 6. Older, still true: **0108's contract step is owed** (`createMember` and the
>    ทีม SAMO CSV import still write `person_id = null`); the team photo SAVE
>    path is unverified by hand; real student identities are in this PUBLIC
>    repo's git history (0047 seed) and that needs the owner's decision.
>
> **Vestigial columns.** The five on `students` are GONE (0129:
> `year_override`, `verified_at`, `is_listed`, `sai_locked`, `sai_self_edits`) —
> and dropping them while the served bundle still named them is what caused the
> 20-minute outage, so **deploy first, drop second**. Still there and still
> dead: the whole of `house_settings` (`academic_year`, `roster_visible`,
> `sai_self_edit_open`, `sai_edit_until`). Nothing reads or writes that row. It
> is a TABLE, so dropping it needs the owner's word.
>
> Backlog: `docs/NEXT.md`. Roles/photos design with five open decisions:
> `docs/TEAM-ROLES-AND-PHOTOS.md`.
