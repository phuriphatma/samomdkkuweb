# STATE — current task & latest known state

Last updated: 2026-08-08. Read on every cold start, so it is "what is true
RIGHT NOW" and nothing else — `git log --oneline` is the chronology. Keep it
under ~200 lines; when it bloats, move SHIPPED narratives to
`docs/state-archive/YYYY-MM-DD.md` and leave a two-line pointer.

**Start with the `## NEXT-SESSION PROMPT` at the BOTTOM of this file.** It
carries the two things that change what you do first — the owner's pending bug
list, and the fact that none of the admin UI has been browser-verified — plus
the registry model, the signatures that changed, and the next work in order.
Then come back for the section immediately below (what just shipped) and
CURRENT DEPLOY.

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

## ✅ CLOSED 2026-08-09 (late) — the เพิ่มสมาชิก bug: one deletion, two symptoms

**Root cause found and fixed.** The 0141 commit (`e443fbe`) removed
"ดึงจากระบบบ้าน" and its deletion ran 95 lines past the end of
`onFillFromHouse`, taking the **0137 person picker** with it —
`personSearchToken` / `personSearchTimer` / `personSearchHits` and the two
renderers `renderPersonResults()` / `pickPerson()`. Every CALL site stayed.

Five free identifiers, both reported symptoms:
- `fillMemberModal` resets the picker on open (`personSearchToken += 1`) → a
  `ReferenceError` thrown while PREPARING the dialog → **เพิ่มสมาชิก opened
  nothing and said nothing**, on every device and every path into the modal.
- the search input handler touches `personSearchTimer` on the first keystroke →
  **ค้นหาคนจากระบบ never showed a suggestion.**

The two containment fixes (`54d2c5f`, `dbd8312`) were both right and neither was
the cure — they turned a dead button into a degraded one. **The block is
restored verbatim.**

**The mechanism that would have caught it, and now does:**
`src/js/undefined-refs.test.js` parses every module with `rollup/parseAst` and
fails the build on any identifier read but bound nowhere in its file. Proven
both directions — it names all five on the pre-fix tree and is clean after.
Vite/Rollup treat an unknown name as a global and this repo has no linter, so
this was previously **invisible to `npm run build` and to all 552 tests**.
The allow-list holds six real globals (`bootstrap`, `Quill`,
`createImageBitmap`, …); add to it only for a genuine global.

Also removed `teamMemberHouseFillHint` (markup + JS), the dead status line of
the button 0141 took out. Write-up: `docs/mistakes/frontend-ui.md`.

## ✅ CLOSED 2026-08-09 — a TRASHED Drive file is still served publicly

**This is the answer to both photo reports, and it is not a cache.**
`lh3.googleusercontent.com/d/<id>` — the URL form this app stores and renders —
**keeps serving a file after it is trashed.** Verified live, twice, with curl on
files that were in the trash at the time: HTTP 200, real JPEG.

Two consequences:
1. **Deleting a file in Drive does not remove it from the app.** Nothing tells
   the database, so the row still points at a URL that still works. The only
   removal that works is the app's own นำรูปออก.
2. **Our own delete was not a removal either.** Every GAS handler ended in
   `setTrashed(true)` with the file still shared "anyone with the link", so for
   the whole 30-day undo window — forever if the trash is never emptied — a
   portrait somebody deliberately removed stayed readable by anyone with the
   URL. The comment above the line defended the 30-day window, which is true
   about RECOVERY and says nothing about VISIBILITY.

**Fix**: revoke the share BEFORE trashing (`setSharing(PRIVATE, NONE)` then
`setTrashed(true)`). Access dies at once, the undo window survives. Applied to
all four samoweb handlers via `revokeAndTrash_()`, to `deleteProjectFolder`
(children keep serving exactly as a trashed file does, so they are revoked
first), and to the **passport repo's** `handleDelete_` — same line, same gap.

⚠️ **BOTH GAS PROJECTS NEED A REDEPLOY** for this to take effect. Nothing about
it works from the frontend.

## ✅ CLOSED 2026-08-09 — `uploadPRFile` finally has a counterpart

Announcement covers are re-cropped on every edit and each crop is a new upload,
so an article edited five times left five covers, four orphaned and all five
publicly readable. `uploadPRFile` is the oldest upload path here and the only
one that never got a delete action.

- **`deletePRFile`** in `appscript/prform.gs`, scoped by the same ancestry check
  as the other three (`fileLivesUnderTop_(file, 'PR')`) — the endpoint is
  unauthenticated, so that check is the only thing between a caller and the
  owner's whole Drive. Adds no new Google service, so **no OAuth re-consent**.
- **`filesToRetire(before, after, others)`** in `announcements.js`. An article
  body is rich text, so "which files does this use" is a question about its HTML.
  ⚠️ **It diffs Drive FILE IDS, never URL strings** — one file appears as
  `=w1200`, `=w600` and a bare `/view`, and comparing URLs would treat two
  spellings of one file as two files and delete a picture the body still shows.
  `others` is the whole live list, because duplicating an article for next year
  gives two rows one cover.
  Wired on edit (retire what the new version dropped) and on delete (retire
  everything, minus what a surviving article uses).
- Guard: `src/js/announcement-files.test.js` — 23 cases, both directions, half
  of them holding the URL-spelling line.

**Two sites left uncleaned ON PURPOSE**, reasons recorded in
`src/js/upload-cleanup.test.js` so they are facts and not folklore:
- **PR attachments** — written once, never replaced, and the staff delete is
  `soft_delete_pr_ticket`, i.e. RECOVERABLE. Trashing there would destroy a
  restorable ticket's evidence.
- **Quill images in the VS form** — written once, no edit path. What does leak
  is an image pasted by someone who then abandons the form; closing that needs
  the upload-on-SAVE change portraits already got.

**Passport audit (separate repo, `/Users/xeno/development/samodevmdkku69/passport`)**:
its CALLERS are the most complete of any app here — activity delete drops the
badge (`admin-page.js:865`), a replaced image drops the previous one (`:1339`),
uncommitted uploads are beaconed away on unload (`:85`), and bulk delete sweeps
(`:1594`). Only the trash-still-serves gap applied, and it is fixed. **Its GAS
needs its own redeploy and its own commit — that repo is not pushed yet.**

## ✅ CLOSED 2026-08-09 — the portrait bug was TWO bugs

**1. "it still uses the old photo I removed long ago."**
`lh3.googleusercontent.com` **keeps serving a Drive file after it is trashed.**
The row pointed at a file the owner had deleted months earlier and Drive served
it happily, so it read as "the app is stuck on an old photo" when it was stuck on
a *deleted* one. Emptying the trash is part of removing a photo.
Ruled out along the way, each from the live DB: no archive rows exist (so not a
stale published snapshot); no bulk write cluster in `updated_at` (so nothing was
wiped); `team_members_self_update_guard` DOES allow `photo_url` and raises rather
than reverting; both mirrors assign `photo_url = new.photo_url` with no coalesce.
The 4 rows pointing at the trashed file were snapshotted and cleared.

**2. "เปลี่ยนรูป changes the picture but the old one is still in the drive."**
`my-seat.js` — the self-service card every ordinary member uses — uploaded,
repointed the row, and never called `deleteTeamPhotoIfUnused`. The admin editor
and `terms.js` had done so since 0143, so the rule LOOKED implemented: it was, on
two of three writers, and the missing one had the most users. The leftover file
stays shared "anyone with the link", so this is privacy before storage.

Swept every other upload surface and found two more of the same shape:
- **`house/index.js` uploaded the crest ON PICK** — every intermediate choice
  became a Drive file no row ever pointed at, which a reference count can never
  distinguish from a live photo, so nothing could ever clean them up. Moved into
  `onHouseSubmit` + cleanup of the replaced crest. **Verified in a browser: a
  pick now sends ZERO requests to GAS and previews from a local `blob:` URL.**
- **`shop/admin.js`** left the previous product image behind on every replace.

**One rule now, three writers:** `photoToRetire(prevUrl, payload, key)` in
`team/api.js`. ⚠️ **Its key-PRESENCE test is load-bearing** — นำรูปออก sets the
column to `null`, and any `??`/`||` fallback reads that null as "unchanged" and
skips the cleanup on the one action whose whole point is that the file is gone.
`src/js/photo-retire.test.js` covers both directions (11 cases).

**The guard is an AUDIT, not a pattern match**: `src/js/upload-cleanup.test.js`
holds one row per uploading module naming what cleans up after it, and fails when
a new upload site appears without one. Two simpler rules were tried and both were
wrong — "the uploader must also delete" (shop/checkout.js uploads a slip that
shop/api.js correctly deletes) and "never upload in a change handler" (QR, banner
and slip pickers upload and PERSIST in the same handler, orphaning nothing).

⚠️ **KNOWN DEBT, now written down**: the whole `uploadPRFile` family —
announcement covers, Quill inline images, PR attachments — has **no delete
action in `appscript/prform.gs` at all**. The cover cropper leaks a file per
re-crop. Closing it needs a GAS action + redeploy, not a frontend change.

## SHIPPED 2026-08-09 (scrutiny pass) — the dialog class, closed with a ratchet

An end-to-end review (public entry → admin → ทีม SAMO → ระบบบ้าน → accounts),
driven in headless Chrome at **390 / 412 / 768 / 1440 px**. Four real defects,
all fixed:

- **`confirm()` was still control flow in ทีม SAMO** — 13 calls across
  `team/index.js` + `team/terms.js`, the last modules holding out. The new one
  this found: **`readPermInputsOrWarn` guards the SAVE path**, so with dialogs
  suppressed บันทึก on a full `vs` / `passport` grant did nothing at all, no
  message. The two earlier instances of this class were both deletes, which is
  why it kept being filed as "the delete button is broken". All now go through
  `askConfirm`/`askDelete`; `confirmMaster` and `readPermInputsOrWarn` are async
  and awaited at four call sites. `renameMajor`'s `prompt()` became an input in
  the row it renames (there is deliberately no `askPrompt`).
  **Guard: `src/js/native-dialog.test.js` — a RATCHET.** `STILL_NATIVE` lists
  the five modules that have not been converted (shop/vs/pr/announcements/
  profile) and the list may only SHRINK; a separate assertion pins the ทีม SAMO
  / ระบบบ้าน / self-service modules clean.
- **จัดการรายการสาขา was unusable on a phone** — the rows were 426 px wide inside
  a 374 px dialog, so the ลบ button rendered OUTSIDE the modal and a สาขา could
  not be deleted at all on iPhone/Android. Cause: a CSS grid's implicit `auto`
  track is floored at min-content, so the row grew past its container instead of
  shrinking. `grid-template-columns: minmax(0, 1fr)` + `flex-wrap`. ⚠️ **The
  page-level overflow check said everything was fine** — the modal body clipped
  it. Measure each control against the container that clips it.
- **`/admin/#vs` opened the VitalSound workspace for an account with no VS
  grant.** The sidebar hides it and the click delegate skips a hidden button —
  the HASH was never checked. Same gap on `#creator/<id>` and `?scan=`. RLS kept
  the rows empty, so this was a pane that lies, not a leak. Now
  `canOpenSection()` in admin-main.js.
- `my-house.js` section mode queried `.myhouse-card`, which section mode does not
  render, so the แจ้งสายรหัสไม่ถูกต้อง button never showed its open state.

Checked and found clean: no page-level horizontal overflow on either entry at
any of the four widths; `teamMemberModal` / `teamNodeModal` / `teamPickerModal` /
`houseStudentModal` all fit their content box with no control outside it.

**Not fixed, deliberate design, noted for the owner:** the account switcher
keeps `refresh_token`s for up to 6 accounts in `localStorage` so a fast switch
needs no password. `ออกจากระบบ` revokes globally (the stored copy dies with it),
but "+ เพิ่มบัญชี" signs out with `scope:'local'` on purpose. On a shared
machine those tokens are replayable until they expire.

## SHIPPED 2026-08-09 (audit) — 0143 + two containment fixes

- **0143 — the portrait refcount could destroy a file in use.** It counted
  `team_members` + `team_archive_members`; since 0132 `people` and `students`
  hold the same URL. Worse, a client-side fix is impossible: `students` and
  `advisors` need `house`, the admin who deletes members holds `team_edit`, and
  **RLS returns zero rows, not an error** — so the extra queries would answer
  "unreferenced" for exactly that caller. Count moved to a SECURITY DEFINER
  `photo_reference_count()`. Blank URL answers 1; the client deletes only on a
  definite numeric zero. Proof: `node tools/team0143-photo-refcount.mjs` (5/5).
  Guard: `src/js/photo-refcount.test.js` scans the migration DDL for every table
  given a `photo_url` and fails if the count omits one.
- **Double-submit**: `onMemberSubmit` disabled its button only inside the photo
  branch — safe only because nothing awaited before `hide()`. The 0141 name
  confirmation added an `await` there, so two presses created two members. Now
  an explicit busy guard (`runMemberSubmit`).

## SHIPPED 2026-08-09 (evening) — the owner's bug list (0139–0142)

All applied, deployed, verified. **Read this before touching identity.**

- **0139 — an INSERT is a write path too.** 0125/0138 guard the import on
  UPDATE. For the ~380 ทีม SAMO members not yet in ระบบบ้าน the import *INSERTs*
  their placement, and that path was unguarded: the file's spelling won and the
  registry silently disagreed with the row pointing at it. Reconciliation now
  lives INSIDE `students_link_person` (one trigger, so trigger-name ordering
  cannot break it). A human-created row mirrors UP, which an INSERT never did.
  Also **refcounts orphan `people`** when their last placement goes.
- **0140 — "เป็นคนเดียวกับ …" is a MERGE.** It 23505'd. Giving a placement an
  address another person holds now RE-POINTS it at that person and fills the
  row's empty columns FROM them (a sparse row must not blank a rich one).
  ⚠️ Two traps recorded: a kkumail-ONLY write never fired the mirror at all
  (the `is distinct from` guard excludes kkumail), and **`after update of <col>`
  fires on the STATEMENT's column list, not on what a BEFORE trigger changed**.
- **0141 — ปีการศึกษา is ADMIN-SET.** Reverses half of 0131 and keeps the half
  that matters: ชั้นปี stays derived, only the OFFSET is stored. The BASE moved
  from the clock to `house_settings.academic_year`, moved by a button, with a
  "ถึงกำหนดเลื่อน" reminder. It reminds; it never acts. Seeded from the clock so
  nothing on screen changed. `set_academic_year` takes the TARGET year, not +1.
- **0142 — who-has-checked is about PEOPLE.** The count read `people` (301) and
  the per-row filter read `students` (3). One `checked` definition now
  (confirmed OR self-edited), used by both, and `list_identity_check()` lists
  every ทีม SAMO member by name — so the check week is chaseable TODAY.

**The populate question, answered:** ทีม SAMO people do NOT get fabricated
`students` rows. A `students` row is a house placement and there is no สายรหัส to
give it. They are already shared via `people`; when the file lands they acquire
a placement by kkumail (0139) carrying the identity they already have.

Also fixed: the ตรวจสอบข้อมูล false "รหัสซ้ำ" for one human with a no-email
posting (identity.js rule 2 was a single-pass key — see app-state.md), the blank
ชื่อ/นามสกุล boxes in แก้ไขสมาชิก (`suggestNameSplit` + one confirm), the ghost
suggestions from a deleted ฝ่าย, and "have to refresh to see รุ่น change"
(`profile-cache.js` — one card, two module caches).

⚠️ **`ดึงจากระบบบ้าน` is GONE** (0141). There is no second copy to pull from.

## SHIPPED 2026-08-09 (later) — ONE ACCOUNT, ALL THE WAY (0135–0138)

**0135 — ชื่อ/นามสกุล is split everywhere, and nothing guesses a boundary.**
`team_members` gained `first_name_th` / `last_name_th`; `full_name` is now
DERIVED from them (trigger, same shape as `people`'s since 0132) and dropped its
NOT NULL. Both mirrors carry the split, so **the one documented sync gap is
closed**. **Nothing was backfilled** and nothing ever will be — a row acquires
the split when a human types one, and a row holding only a combined name never
overwrites a person who has the split.

⚠️ It also fixed a LIVE, UNREPORTED bug: `my-seat.js` split the person's own
ชื่อ-สกุล on whitespace on the way to ระบบบ้าน, so `first='สมชาย ใจดี'`
`last='ดีมาก'` became `first='สมชาย'` `last='ใจดี ดีมาก'` on their first save —
and `self_edited` then claimed the person had chosen it. `house/io.js` refuses a
whole CSV for that guess. **`src/js/name-split.test.js` now fails the build on
any module that reconstructs a split from a combined string**, and pins the
card's editable list against the SQL allow-list.

**0136 — a fail-open found BY THE PROOF, not by a report.**
`recompute_team_managed_permissions` and `sync_my_team_permissions` set
`app.team_sync='1'` and never restored it. `set_config(...,true)` is
TRANSACTION-scoped, so **one `update public.students` turned
`team_members_self_update_guard`'s column allow-list off for the rest of that
transaction.** Not reachable through PostgREST today (one statement per request,
and the BEFORE ROW guard beats the AFTER STATEMENT recompute) — but that is an
accident, not a design. Both now save and restore the previous value.

**0137 — `search_people()`.** Add a ทีม SAMO member by searching ชื่อ, นามสกุล,
ชื่อเล่น, รหัสนักศึกษา (dash optional), สาขา or kkumail. 0130's exact-kkumail
lookup asked for the one field an admin does not have, so all six boxes were
retyped — which is how one human becomes two records. It is an ILIKE and it is
BOUNDED: wildcards escaped, min 2 chars, limit clamped to 50 server-side,
hand-built column list, **no placement facts** (no สายรหัส, no บ้าน), no anon
grant. Hits carry `in_team` / `team_nodes` so the picker names the ฝ่าย someone
is already in.

**0138 — the roster reconciliation. Read `docs/PERSON-REGISTRY.md` for the
reasoning; the rule is three lines:**
- **Authority is per FIELD, not per actor.**
- **Silence is not agreement** — a person who never looked has claimed nothing,
  so the file just writes. That is most of the 1,800 rows.
- **A disagreement is a THING**, not a dropped write. `students_keep_self_edits`
  used to discard the file's value silently; it now records an
  `identity_conflicts` row and the person is asked on the home page.

`people.identity_confirmed_at` separates "checked, it's right" from "never
opened the page". `identity_check_summary()` counts both. The import preview
reports how many rows carry a value it will NOT be allowed to write, with its
own filter.

⚠️ **Two bugs 0138's proof caught in 0138 itself**, both worth knowing:
`identity_conflicts` had RLS policies and **no GRANT**, so every policy was dead
and every DENY step passed vacuously; and the own-read policy's inline subquery
read `people`, whose own RLS denies ordinary students — the FIRST entry in
`docs/mistakes/authz-rls.md`, met again in a policy written for exactly that
caller. Fixed with `my_person_id()` (definer).

Proofs, all both-directional: `node tools/team0135-name-split.mjs` (16/16) ·
`node tools/team0137-search.mjs` (14/14) · `node tools/house0138-conflicts.mjs`
(21/21).

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

✅ **The gap this block used to record is CLOSED by 0135** (see above). Full
plan and the reconciliation rules: **`docs/PERSON-REGISTRY.md`**.

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
- **samoweb**: `main` = `ec42f93` on the VM, verified from the served artifact
  (`assets/admin-BbCDLy9w.js` carries `team-person-hit` / `อยู่ในทีมแล้ว` /
  `team-person-meta`, and `teamMemberHouseFillHint` is gone from both the bundle
  and `admin/index.html`). ⚠️ **Minified builds rename module-scope `let`s** —
  grep the served bundle for a STRING LITERAL or a CSS class, never for a
  variable name. Still **v4.5.0**, and
  ⚠️ **`PENDING` in `src/data/changelog.js` now holds ~36 entries** — two
  sessions of user-visible work with no version cut. **A `npm run release`
  minor bump is OWED** and `/updates` is showing none of it. Read
  `docs/VERSIONING.md` first; the bump is a **minor**.
- **Migrations applied through 0143.** Live proofs, all both-directional:
  `node tools/house0128-cohort.mjs` (8/8) · `node tools/house0128-requests.mjs`
  (9/9) · `node tools/house0131-year-offset.mjs` (9/9) ·
  `node tools/house0132-registry.mjs` (19/19) ·
  `node tools/team0135-name-split.mjs` (16/16) ·
  `node tools/team0137-search.mjs` (14/14) ·
  `node tools/house0138-conflicts.mjs` (21/21) ·
  `node tools/house0139-insert-path.mjs` (10/10) ·
  `node tools/team0140-merge.mjs` (7/7) · `node tools/db-query.mjs tools/house0116-authz.sql` (house authz) ·
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

> ✅ The เพิ่มสมาชิก / ค้นหาคนจากระบบ bug is **CLOSED** — see the top of this
> file. One deletion took its neighbour with it; `src/js/undefined-refs.test.js`
> now fails the build on any identifier that resolves to nothing.
>
> ⚠️ **FIRST: the owner tests live and reports in bursts.** Nine bugs came in
> this way on 2026-08-09, several in code shipped hours earlier. Expect the
> opening message to be a list, not a task, and treat their report as the test
> pass this repo does not have.
>
> ⚠️ **SECOND: almost none of the ADMIN UI shipped on 2026-08-08/09 has been seen
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
> Everything is shipped and deployed; migrations applied through **0134**, 552
> tests green, nothing in flight. **"Verified from the served bundle" means the
> right BYTES are on the server — it does not mean the feature was used.** Read
> it together with the second warning above, not instead of it.
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
> 1. ~~Split the ทีม SAMO name field.~~ **DONE — 0135.** Both columns exist,
>    `full_name` is derived, both mirrors carry it, nothing backfilled. The
>    build now fails if any module reconstructs a split from a combined string
>    (`src/js/name-split.test.js`).
> 2. **Repoint `team_members.year` at the derived ชั้นปี** (0131). 381/399 rows
>    have a รหัส that yields a cohort; only 11 disagree, and those 11 become
>    `year_offset`. Nothing in this repo has EVER bumped that column, so all 399
>    silently go stale every August.
>    ⚠️ `team_members.full_name` is now DERIVED when the split is present, so
>    the CSV export carries all three columns and the importer resolves the
>    precedence in ONE place (`team/io.js parseMembersCsv`). Keep it that way.
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
>    ~~2. `team/index.js` still has 9 native `confirm()` calls.~~ **DONE** — all
>    13 (index.js + terms.js) converted, and `src/js/native-dialog.test.js` is
>    now a ratchet over the whole tree. Five modules remain on the list
>    (shop/admin.js, vs-staff.js, pr-staff.js, announcements.js, profile.js) and
>    the test fails if that list grows.
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
