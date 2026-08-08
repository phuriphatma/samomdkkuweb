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

## SHIPPED 2026-08-09 — ONE ACCOUNT SYSTEM (0132 + 0133)

**`public.people` is the person registry.** 304 rows, one per human, keyed on
kkumail. Identity lives there; PLACEMENTS point at it — `students.person_id`
(house) and `team_members.person_id` (org posting). A person can hold two
postings and a house placement at once, which is why placements did NOT merge.

Promoted from `team_people`, which 0108 had already built and populated and
which nothing in `src/` ever read. Renamed because a student who has never been
in ทีม SAMO now has a row in it. Taken when `students` held THREE rows and
exactly TWO humans were in both tables — after the 1,800-row import it would
have been hundreds of duplicate identities to reconcile by hand.

**All three editors reach the registry** (0133):
- the person's own card → `update_my_identity()` → house + every posting + registry
- the ทีม SAMO admin pane → `team_member_mirror_up` → registry → down to ระบบบ้าน
- the ระบบบ้าน admin pane → `student_mirror_up` → registry → down to ทีม SAMO

Both mirrors are guarded by `is distinct from`. **That guard is load-bearing** —
without it the up/down pair is an infinite recursion. It converges in two hops.

⚠️ **0134 — a GENERATED column is not a reason to skip a field.** `ชื่อเล่น` did
not sync (reported live): `person_mirror_down` had no nickname branch because
`students.nickname` is generated and writing it would 428C9. The fix is to write
the column it is generated FROM — `nickname_self`, because it outranks
`nickname_imported` and the registry value always came from an authoritative
editor. **The guard compares the GENERATED value**, not the source column: that
is what a reader sees, and comparing the source would fire forever for a row
whose value comes from the other slot.

**EXPAND ONLY.** Nothing dropped. Both placement tables keep every identity
column and the mirrors keep them equal. Views over `people` were considered and
REJECTED (INSTEAD OF triggers on every write path + `security_invoker` on each;
see `docs/mistakes/authz-rls.md`). The CONTRACT step is one reader at a time.

Also closed 0108's long-owed contract step: a BEFORE INSERT trigger links every
new placement to a person by kkumail, so `createMember` and the CSV import can
no longer create orphans.

⚠️ **ONE KNOWN GAP, measured and deliberate.** A COMBINED name edited in the
ทีม SAMO pane does not overwrite a SPLIT name in ระบบบ้าน — splitting
"สมชาย ณ อยุธยา" renames a real person. **Next step: give the ทีม SAMO member
form the same ชื่อ/นามสกุล split**, then the mirror carries it. Full plan:
**`docs/PERSON-REGISTRY.md`**.

**UI: ONE CARD.** `ข้อมูลของฉัน` shows the identity once, then a ทีม SAMO
section and a ระบบบ้าน section under one heading. my-house.js has
`mode: 'section'`; my-seat.js leaves a slot and calls `opts.afterRender`.
⚠️ **That hook is required** — the seat card re-renders on every save and would
otherwise wipe the house section (mistakes.md: "a shared render() that repaints
a pane another module owns").

Proof: `node tools/house0132-registry.mjs` — **17/17**, all three doors, both
mirrors, link-at-birth, and the deny half (sai_code and node_id never touched,
no duplicate humans, a stranger gets null).

## SHIPPED 2026-08-08 (late) — 0128–0131

Detail: **`docs/state-archive/2026-08-08-late-0128-0131.md`**. Four to carry:

- **0128** — `cohort_year` re-derives on every รหัส change (it was fill-once, so
  a corrected รหัส kept the old รุ่น forever); a คำขอแก้ไข's verdict + note +
  `applied_value` now reach the student; `advisors.title` dropped.
- **0129** — five vestigial columns off `students`. ⚠️ **Caused a ~20-min
  outage**: the SERVED bundle still named them and PostgREST 400s on an unknown
  column. **Deploy first, drop second** (`docs/mistakes/deploy-hosting.md`).
- **0130** — `lookup_student_by_kkumail()`, exact match only, no anon grant.
- **0131** — **ชั้นปี is a stored DIFFERENCE** (`students.year_offset`), never a
  number. ปีการศึกษา comes from the clock (สิงหาคม), one constant, NOT a setting.
  No SQL twin of the derivation — JS owns it. `team_members.year` is still a
  typed column nothing ever bumps; repointing it waits on the registry.

**Debug note (mistakes.md class 7):** `current_user_has_permission()` reads the
UNION of `permissions` AND `managed_permissions` (0081). A probe subject picked
by `permissions = '{}'` alone may hold `master` through the ทีม SAMO tree and
reads exactly like a fail-open RLS policy. Filter on BOTH.

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
**The rule that governs it: kkumail is the identity, รหัสนักศึกษา is a field.**
Never merge on name — `673070332-6` is one mistyped รหัส shared by two humans.

**0108's table is now `public.people` and its INSERT gap is CLOSED** (0133): a
BEFORE INSERT trigger links every new placement by kkumail, so `createMember`
and the CSV import can no longer create orphans. The ten
`effective_team_*_for_email` resolvers still join `team_members.kkumail` — that
is contract-step work, not a bug. Background:
`docs/state-archive/2026-08-01-team-identity.md`.

## CURRENT DEPLOY

- Prod host = KKU VM `samo.md.kku.ac.th` (pages.dev retired → splash-redirects).
  Deploy = commit → push `main` → `skills/deploy-vm.md`. **Needs VPN.**
- **samoweb**: `main` = `1051042` on the VM (later commits are docs-only),
  verified from the served artifact. Still **v4.5.0**, and
  ⚠️ **`PENDING` in `src/data/changelog.js` now holds 20 entries** — two
  sessions of user-visible work with no version cut. **A `npm run release`
  minor bump is OWED** and `/updates` is showing none of it. Read
  `docs/VERSIONING.md` first; the bump is a **minor**.
- **Migrations applied through 0134.** Live proofs, all both-directional:
  `node tools/house0128-cohort.mjs` (8/8) · `node tools/house0128-requests.mjs`
  (9/9) · `node tools/house0131-year-offset.mjs` (9/9) ·
  `node tools/house0132-registry.mjs` (19/19) · `node tools/db-query.mjs tools/house0116-authz.sql` (house authz) ·
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

## NEXT-SESSION PROMPT (paste this after a /clear — written 2026-08-09)

> ⚠️ **FIRST: the owner has a BACKLOG OF UNREPORTED BUGS AND QUESTIONS.** The
> previous session ended with them saying "there are many bugs and many
> question i want to ask, but for now very properly hand off". So expect the
> opening message to be a list, not a task. Do NOT start the planned work below
> until they have said what they found — the planned items are cheap to defer
> and a live bug is not.
>
> ⚠️ **SECOND: none of the ADMIN UI shipped on 2026-08-08/09 has ever been seen
> in a signed-in browser.** The request queue, the นักศึกษา filters, the import
> preview table, the สาย/อาจารย์ modal, the admin landing cards and the
> ชั้นปี choosers were verified by unit tests, live DB proofs and greps of the
> SERVED bundle — never by a human or a driven browser behind the admin login.
> `docs/NEXT.md` §1 has said this since 2026-08-04 and it is still true. Two of
> this session's bugs (ปฏิเสธ doing nothing, ชื่อเล่น not syncing) were found by
> the OWNER using the app, not by any check here. **Treat the owner's incoming
> bug list as the missing test pass**, and consider driving the admin panes with
> the headless-Chrome CDP approach before adding more admin UI.
>
> Read STATE.md first: the SHIPPED block at the top, then CURRENT DEPLOY.
> **Everything is shipped, deployed and verified from the SERVED bundle.**
> Migrations applied through **0134**, 552 tests green, nothing in flight.
>
> **The one thing to understand before touching anything: `public.people` is
> the person registry.** One row per human, keyed on kkumail. Identity lives
> there; PLACEMENTS point at it — `students.person_id` (house) and
> `team_members.person_id` (org posting). Three editors all reach it: the
> person's own card through `update_my_identity()`, and each admin pane through
> a mirror UP on its placement table. 0132's mirror DOWN then carries the change
> to the other side.
>
> **Both mirrors are guarded by `is distinct from`, and that guard is
> load-bearing** — remove it and the up/down pair recurses forever. It converges
> in two hops. `sai_code` and `node_id` are NEVER mirrored: they are placement
> facts, and a mirror that copied `sai_code` would move a student between houses
> from the ทีม SAMO editor, silently.
>
> **EXPAND ONLY.** Both placement tables still carry every identity column; the
> mirrors keep them equal. The CONTRACT step (retire them, one reader at a time)
> is planned in `docs/PERSON-REGISTRY.md` and is NOT started.
>
> Before changing any of this, run `node tools/house0132-registry.mjs` (19/19).
> It covers all three doors, both mirrors, link-at-birth, and the deny half.
>
> **Next, in order:**
> 1. **Split the ทีม SAMO name field.** `team_members.full_name` is one column;
>    the registry and ระบบบ้าน use `first_name_th` + `last_name_th`. This is the
>    one known sync gap: a combined name edited in ทีม SAMO cannot overwrite a
>    split name, because splitting "สมชาย ณ อยุธยา" renames a real person.
>    Add the split to the form and the table; backfill NOTHING — a row acquires
>    the split when a human types it.
> 2. **Repoint `team_members.year` at the derived ชั้นปี** (0131). 381/399 rows
>    have a รหัส that yields a cohort; only 11 disagree, and those 11 become
>    `year_offset`. Nothing in this repo has EVER bumped that column, so all 399
>    silently go stale every August.
> 3. **The CONTRACT step**, smallest blast radius first: the CSV export, then the
>    admin tables, then the ten `effective_team_*_for_email` resolvers (they
>    still join `team_members.kkumail`), then the archives. Do not batch them.
>
> **Standing hazards, all paid for at least once:**
> - **Deploy first, drop second.** 0129 dropped columns the SERVED bundle still
>   named and took ระบบบ้าน's admin tab down for 20 minutes. PostgREST 400s the
>   whole query on an unknown column.
> - **Grep the SERVED bundle, not the local file** — for removals as well as fixes.
> - **A probe subject with `permissions = '{}'` may still be a full admin** via
>   `managed_permissions` (0081). Filter on BOTH columns or you will report a
>   vulnerability that is the grant engine working.
> - **A write and the check that reads it back must be SEPARATE statements**, or
>   the subquery reads a pre-write snapshot and the proof lies.
> - **`renderMySeat` owns a slot my-house.js paints into.** It calls
>   `opts.afterRender`; without it ระบบบ้าน vanishes on the first save.
>
> Open, none blocking:
> 1. **Rotate the VM sudo password** and **the KKU SSO client secret** (both were
>    exposed in chat transcripts on 2026-08-07 / 08-08).
> 2. **`team/index.js` still has 9 native `confirm()` calls.**
>    `src/js/confirm-modal.js` exists and ระบบบ้าน uses it; converting ทีม SAMO is
>    mechanical. This class shipped a live bug in ระบบบ้าน's ปฏิเสธ button AFTER
>    being listed as an open item.
> 3. **`students.self_edited` is invisible to admins** — not in `STUDENT_COLS`,
>    not in the CSV export.
> 4. **`house_settings` is entirely vestigial.** No reader, no writer. Dropping a
>    TABLE needs the owner's word.
> 5. **`tools/team0108-people.mjs` fails** on `column "prefix" does not exist` —
>    pre-existing since 0113 (it replays the 0108 migration). Not a regression.
> 6. **`students` is not empty** — a few manual-test rows incl. the owner's real
>    record. The import upserts on kkumail so it will merge.
> 7. Older: real student identities are in this PUBLIC repo's git history (0047
>    seed) and that needs the owner's decision.
>
> **Signatures that CHANGED this session** — a call site written from memory
> will be wrong:
> - `saveMyStudentRecord(patch)` now posts to **`update_my_identity`** (not
>   `update_my_student_record`) and returns `data.house`, so the shape callers
>   see is unchanged. That indirection IS the sync; do not "simplify" it back.
> - `decideRequest(id, status, note, userId, applied)` — 5th arg is
>   `applied_value`, written only when it differs from what was requested.
> - `renderMyHouse(host, rec, opts)` — `opts.mode === 'section'` drops the card
>   shell; `opts.identityShownAbove` drops the duplicated identity rows.
> - `renderMySeat(host, seat, opts)` / `showMySeat(host, uid, opts)` —
>   `opts.afterRender(hostEl)` fires after every paint. **Required**, see above.
> - **`team_people` is now `public.people`.** Four `tools/*.mjs` were repointed.
>   `tools/team0108-people.mjs` still fails on `column "prefix" does not exist`
>   — pre-existing since 0113, verified identical on the parent commit.
>
> **Design answers given verbally last session — recorded so they survive the
> /clear, because the owner asked and may act on them:**
> - **Name shape (best practice):** store the PARTS, generate the whole —
>   `first_name_th` + `last_name_th`, `full_name` derived, `nickname` its own
>   field, no คำนำหน้า column anywhere (dropped 0113 for ทีม SAMO, 0128 for
>   อาจารย์). NEVER split an existing combined name.
> - **รุ่น vs ชั้นปี:** they are DIFFERENT facts and ลาพัก separates them —
>   that person is still MD50 and is now studying ปี 4. Store รุ่น (via
>   `cohort_year`), DERIVE ชั้นปี, store only the OFFSET.
> - **Discord bot (not built):** make the ROLE รุ่น (assigned once, correct
>   forever) and the DISPLAY NAME ปี (derived, re-synced each August). A ปี role
>   would have to be reassigned for every member every year.
>
> **Where the new things live:** `people` + mirrors → migrations 0132/0133/0134
> · the one card → `src/js/my-seat.js` (shell + slot) and
> `src/js/house/my-house.js` (section mode) · composition → `src/js/main.js`
> around `paintHouseInto` · ชั้นปี derivation → `src/js/house/fields.js`
> (`studyYear` / `offsetForPickedYear`, JS only, no SQL twin).
>
> **How to work on this repo, learned the hard way over the last two sessions:**
> - **A fix applied on ONE path is not a fix.** Nearly every bug found this
>   session was that shape: `cohort_year` filled once, the decision note with no
>   read path, the sync that covered one of three editors, ชื่อเล่น missing from
>   one mirror. Before declaring anything done, enumerate the paths — grep the
>   column, grep the RPC, list the editors.
> - **Prove it live, both directions.** Every `tools/house*.mjs` here exercises
>   an ALLOW and a DENY, because a probe that can only print "denied" cannot
>   tell a working guard from a broken connection.
> - **Verify from the SERVED artifact.** The local file is not what users run.
> - **Deploy is ~90 s on the VM.** Batch commits before deploying; the previous
>   session ran four separate deploys and wasted real time.
>
> Backlog: `docs/NEXT.md`. Registry plan: `docs/PERSON-REGISTRY.md`.
