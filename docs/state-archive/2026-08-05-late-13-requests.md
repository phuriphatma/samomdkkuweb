# State archive — 2026-08-05 (late) → 08-06

Pruned out of `STATE.md` on 2026-08-07 to keep it under its ~200-line budget.
This is the narrative of the 13-request session, the ทีม SAMO view/edit +
master work (0110/0111) and the 08-04→08-05 shipped list. All of it is DONE
and live; nothing here is owed. Chronology: `git log --oneline`.

---


## THIS SESSION (2026-08-05, late) — all 13 requests DONE, none browser-verified

**Everything below is COMMITTED and migration 0113 is APPLIED to the live DB
(proof `tools/team0113-fields.mjs` → 26/26).** Read the "OWED" block at the end
of this section first — it is the whole handover.

The user asked for 13 numbered things in one sitting (items arrived mid-turn, so
they are numbered as they were asked, not by area):

1. **ทีม SAMO (ดู) now shows the admin link.** `main.js` had its OWN hand-written
   list of five permission keys for "ไปยัง Admin Dashboard", written before ทีม
   SAMO had rungs — so every one of the ~285 people who hold `team` implicitly
   could reach `/admin/` by typing the URL but were never shown the door. Now
   `ADMIN_FEATURES.some(userCanAccess)`, the same array `admin-main.js
   canUseAdmin()` uses. Guard test in `team-vocab.test.js`.
2. **Master no longer looks pre-selected.** `.is-danger` painted the same tinted
   background + coloured border that `:has(input:checked)` uses for ON. Now OFF
   is a white row with an orange label; ON is the filled panel. Write-up in
   `docs/mistakes/frontend-ui.md`.
3. **The card's breadcrumb runs all the way in** — `ฝ่ายดิจิทัลฯ › ฝ่าย IT ›
   หัวหน้าฝ่าย IT` as ONE trail (`team_node_path()` returns ancestors only, so
   the renderer appends the node). Guard test asserts the node is INSIDE the path
   element and after the last ancestor.
4. **Self-edit now covers every synced field.** `full_name` was missing (the
   server guard always allowed it — the form just did not offer it), plus a photo
   field. The PATCH writes every row carrying the person's kkumail, which is what
   makes the admin pane show what they typed.
5. **คำนำหน้า is GONE** — `alter table drop column` on `team_members` AND
   `team_people` (380 values deleted; the user was shown the count and chose it),
   plus the three functions that named it, the CSV columns/aliases, the drift
   rule, the modal field and the card.
6. **รหัสนักศึกษา canonical form = `653070317-0`** (380/405 live rows already
   dashed). Bare 10 digits, Thai numerals, stray punctuation and a stray Thai
   vowel mark are all normalised; anything else is REFUSED at the form, but only
   when the value CHANGED (two live rows carry unfixable ids and an unrelated
   nickname edit must not be held hostage).
7. **ทีม SAMO (ดู) is now a locked, ticked, non-writable checkbox.** Since 0110
   the resolver grants it to everyone in the tree, so the control could not turn
   it off — it was a lie. Left visible (the grid is also how an admin READS a
   grant) with the reason on the row. **Best-practice answer to the question the
   user asked**: there is no revoke case to design for — "this person should not
   see the roster" means they are not on the team, and the fix is to remove their
   posting. If a posting-without-visibility is ever genuinely needed it is a new
   column on the row (an observer flag), not this key.
8. **Bug scan / docs / notes / deploy** — see below.
9. **`ดูอัปเดตทั้งหมด` lands at the top.** This had already been "fixed" once and
   shipped: the fix lived in the `shown.bs.tab` handler behind
   `location.pathname !== want`, and `navigateTo()` pushes the path BEFORE
   activating the tab, so the guard was false for every programmatic link.
   Write-up in `docs/mistakes/app-state.md`.
10. **Where self-edit lives — decided: ONE editor, THREE entry points.** The card
    component is the only editor; it is reachable from the home page, the
    โปรไฟล์ modal (account dropdown — it was already there), and NOW from a new
    **ข้อมูลของฉัน** mode inside admin ทีม SAMO, because the read-only note used
    to tell an admin to go to the public home page to fix their own row. No second
    implementation: `team/index.js` `enterMySeatPane()` is 8 lines calling
    `renderMySeat`.
11. **Escalation copy names a real person** — "แจ้งอุปนายกฝ่ายของท่าน หรือผู้ที่มี
    สิทธิ์แก้ไขทีม SAMO" replaces "ผู้ดูแลทีม SAMO" / "หัวหน้าฝ่ายหรือฝ่าย IT".
12. **ชั้นปี and สาขา are choosers, and สาขา has CRUD.** New `team_majors`
    vocabulary (seeded MD/MDI/RT from live data) with add / rename-with-backfill /
    remove, each showing how many PEOPLE it touches first. **`team_members.major`
    stays free TEXT with NO foreign key** — the user asked for a DELETE on
    reference data, which is exactly the fail-open class, so removing a สาขา only
    shrinks the picker and every person keeps their value. An off-list value is
    kept as its own `<option>` so a save of an unrelated field cannot rewrite it.
13. **Replacing a member photo no longer leaves both files in Drive.** The upload
    happened on PICK, so every intermediate choice became a real Drive file and
    only the last reached the row; the delete path could never help because it
    trashes the file the DB POINTS AT. Now nothing leaves the browser until
    บันทึก, on both the admin form and the card. (The GAS delete action itself was
    probed live and works — `{success:true, alreadyGone:true}` for a well-formed
    non-existent id, `Unknown action` for a junk action, so the probe could tell
    the two apart.)

### New/changed files worth knowing about

- **`src/js/team/fields.js` + `fields.test.js` (20 tests)** — THE one definition
  of what a รหัสนักศึกษา / ชั้นปี / สาขา may look like. Three writers now share
  it: the admin form, the CSV importer, and the person's own card. `io.js`'s
  duplicate `normalizeYear` now delegates to it.
- **`supabase/migrations/0113_drop_prefix_and_field_vocabulary.sql`** — APPLIED.
  Drops `prefix` (2 tables, 3 functions, 1 trigger recreated by hand because a
  `drop column` would have cascade-dropped it silently), creates `team_majors`
  (+RLS: read = any authenticated, write = `team_edit` only), and canonicalises
  the live data (382 dashed รหัส now; `66666666-2` deliberately left — 9 digits,
  unknowable, and both panes report it).
- **`tools/team0113-fields.mjs`** — 26/26, both directions on every guard.
- `get_my_team_seat()` now also returns **`term_year`**, so the card can file a
  self-uploaded portrait into `Team/<ปี>/<ฝ่าย>/` like the admin does.

### ✅ BROWSER PASS DONE (2026-08-06) — one bug found and fixed

Driven in headless Chrome against `npm run dev`, signed in as `samomdkkudev`
(the CDP recipe is in the memory note `headless-chrome-cdp-driver`; screenshots
were read, not just asserted on). **Verified rendering:**

- admin ทีม SAMO paints; all five modes present incl. **ข้อมูลของฉัน**, whose
  empty state for a posting-less account reads
  "บัญชีนี้ไม่มีตำแหน่งในผังทีม SAMO…" and whose card paints when a real seat
  payload is injected.
- สมาชิก editor: **no คำนำหน้า**, ชั้นปี = `<select>` showing the stored value
  ("ปี 5"), สาขา = `<select>` (MD/MDI/RT) showing "MD — แพทยศาสตร์", รหัส hint
  present.
- **จัดการรายการสาขา stacks correctly** — 2 backdrops at z 1050/1065 under
  modals at 1055/1075, per-row people counts (348/31/19); closing it leaves ONE
  backdrop, the editor still scrolls (`scrollTop` moves) and its inputs and
  บันทึก are still the top hit-test target. The 0110 scroll-chain break did NOT
  recur. NOTE when driving this: measure backdrop counts ≥1.5 s after `hide()`,
  or you count the one still fading out and report a leak that is not there.
- **ทุกระบบ (Master)** is a white row with an orange label when off — does not
  read as ticked.
- The ตำแหน่งของฉัน card renders both postings with the full trail ending at the
  node; **แก้ไขข้อมูลของฉัน** offers ชื่อ-สกุล / ชื่อเล่น / รหัส (with hint) /
  ชั้นปี + สาขา as dropdowns / เพิ่มรูป, and a read-only KKU Mail.
- `ADMIN_FEATURES.some(userCanAccess)` in the live bundle: `team`-only → **true**
  (so the ไปยัง Admin Dashboard link shows), `passport`-only and `[]` → false.
- **Photo: nothing leaves the browser on PICK.** Set a real file on the input via
  CDP, cropped, confirmed: **zero** network calls, hint reads
  "รูปใหม่ยังไม่ถูกบันทึก — กดบันทึกเพื่ออัปโหลด", and closing the modal without
  saving fired none either.

**The bug**: ทีม SAMO (ดู) rendered locked but `disabled` was false on every
open — `syncMasterVisibility()` does `cb.disabled = on` over every non-master
box, so with master OFF (the normal case) it cleared the lock `fillPermGrid()`
had just set in the markup. Unticking it made the pane claim the person had no
view access. Fixed by skipping `IMPLICIT_PERMS` there; guard test in
`team-vocab.test.js`, verified red with the line removed. Write-up in
`docs/mistakes/frontend-ui.md` (new class-6 site).

### Data fixed 2026-08-06 — one stale grant stripped

`หัวหน้าฝ่าย IT` stored `permissions = ['team']`, written on 2026-08-05 12:03
through the UI in the window before the box was locked. Since 0110 `team` is
IMPLICIT (appended by `effective_team_permissions_for_email()`), so a stored
copy is meaningless — and `tools/team0110-view-edit.mjs` asserts none exists
precisely so it doubles as a **detector for a write path that forgets to filter
implicit keys**. Set to `'{}'` after snapshotting; effective permissions for both
rows on that node are `['master','team']` before AND after, and
`users.managed_permissions` agrees. Proof back to **41/41**.

The rule: if that assertion goes red again, do NOT just clear the data — first
find which write path stored the key, because the form cannot.

### ⚠️ OWED — start the next session here

1. **The photo SAVE path still has not been exercised end to end.** Everything
   up to the upload is proven (above), but "บันทึก uploads exactly one file into
   `Team/<ปี>/<ฝ่าย>/` and trashes the previous portrait" writes to production
   Drive against a real member's row. **The user is checking this by hand** —
   one upload from the admin form, one from the card. The failure branch (upload
   throws → return early, pick still pending) is also unexercised.
2. **No human has reviewed the Thai copy** in any of this — the new field hints,
   the จัดการรายการ modal, the reworded escalation lines, or the v4.5.0 notes
   now public at `/updates`.
3. `team_person_mirror_down()` still writes guarded columns without setting
   `app.team_sync`. Unreachable by a non-editor today (0113 rewrote the function
   but kept that property); give it the flag if `team_people` ever gets a
   self-service surface.

## ทีม SAMO view/edit + master + the full ตำแหน่งของฉัน card — LIVE

**SHIPPED 2026-08-05.** KKU VM deployed, **`buildId bb074fa12f41`**;
migrations **0110 + 0111 + 0112 applied**. Verified against
the SERVED bundle, not the local build.

What landed: `team` (ดู) / `team_edit` (แก้ไข) split with view granted implicitly
to everyone holding a posting · `master`, one grant carrying every permission ·
the ตำแหน่งของฉัน card showing the whole record with an inline self-edit · one
tabbed แก้ไข…/แก้ไขสิทธิ์ editor reachable from both ทีม modes · a read-only tree
for view-only members.

**Four bugs were found AFTER the first deploy and are fixed in this one** —
worth knowing because three of them only appear on the second interaction, which
is exactly what a single manual pass misses:
1. the permission grid carried the PREVIOUS row's state into the next one (would
   have SAVED wrong permissions — data corruption, not cosmetic);
2. the แก้ไขสมาชิก modal could not scroll (the tab refactor broke Bootstrap's
   `modal-dialog-scrollable` flex chain);
3. KKU Mail broke mid-address on the card;
4. the card jumped when opening the edit form (trigger at the bottom, form in
   the middle).
Write-ups: `docs/mistakes/frontend-ui.md`.

**Verification gotcha — read before concluding a deploy failed:** the
ตำแหน่งของฉัน card is code-split into the shared **`analytics-*.js`** chunk, NOT
`public-*.js`. Grepping only `public-*.js` reported every marker MISSING on a
perfectly good deploy. Fetch every `/assets/*.js` the entry links.

**A design call that was reversed, worth knowing about:** `sid_clash` shipped as
a documented "the card cannot compute this" gap — a clash is a fact about TWO
people and the payload carries one. The user pushed back: it is the person's OWN
รหัส and they should see it when they log in. Migration **0112** returns one
extra fact (`student_id_shared_with`, a COUNT, never a name) and the card now
reports it. The rule engine was NOT re-implemented in SQL. If another finding
turns out to be uncomputable client-side, copy that shape.

**A proof script went red for a CORRECT reason and was re-pointed:**
`team0110-view-edit.mjs` asserted "4 nodes + 2 members hold `team_edit`" — a
snapshot of live data. Someone edited a ตำแหน่ง's permissions in the admin UI
and it failed. It now asserts the invariant that matters ("somebody still holds
`team_edit`, so the tree is still manageable"). **This repo keeps re-learning
this**: never assert a count of live rows; assert the property.

**Known, NOT fixed — needs your call:**
- **`ฝ่ายเอิงtest` test data is live**, on the public org chart AND now inside
  real people's ตำแหน่งของฉัน card (it renders a second posting called `hi`
  under `ฝ่ายเอิงtest › เอิงnew › เอิงsubtest`). Deleting it is a data change,
  so it has been left alone — but it is now visible to the person it belongs to.
- **No human has reviewed the Thai copy** on the card, the Master confirm
  dialog, the read-only notice, or the eight staged release notes. I cannot
  judge natural Thai.
- `team_person_mirror_down()` (0108) writes guarded columns without setting the
  `app.team_sync` flag. Unreachable by a non-editor today; give it the flag if
  `team_people` ever gets a self-service surface.

## `master` grant + greeting fix (0111)

Migration **0111 applied**. Proof `tools/master0111-grant.mjs` → **30/30**.

- **`master`** is a ทีม SAMO permission that answers YES to every permission
  question. Built by teaching `current_user_has_permission()` — the one
  predicate every gate already calls — rather than OR-ing a new helper into ~40
  policies. `current_user_project_seats()` was the only helper needing separate
  treatment (it reads `managed_project_seats` directly); it returns all three
  seats for a master.
- **It is NOT `role='dev'`, on purpose.** `current_user_is_staff()` is
  untouched, because `users_self_update_guard` trusts it — widening it would let
  a master self-promote to `role='dev'`, a permanent escalation the tree could
  no longer revoke. Asserted in the proof. Three role-only surfaces stay closed
  and this is correct: `users_update_staff` (role assignment),
  `notify_log_select_staff`, `reserved_staff_usernames_read_staff`. **If you
  want one of those, grant a real staff role — do not widen
  `current_user_is_staff()`.**
- UI: last in the grid, `danger: true`, a `confirm()` on the way in, the other
  keys shown ticked-and-locked while it is on, and stored as `['master']` alone.
- **Home greeting no longer says "ยังไม่ได้ระบุฝ่าย".** For a ทีม SAMO member it
  was simply wrong — their ฝ่าย lives in the org tree, not `users.department` —
  and for everyone else it nagged about a field they cannot set there. The line
  is hidden when empty; the ตำแหน่งของฉัน card carries the real answer. The card
  also said the person's name TWICE (header + beside the portrait); it now says
  it once, with the prefix and ชื่อเล่น.

### ทีม SAMO view/edit split + the full ตำแหน่งของฉัน card (0110)

Proof `tools/team0110-view-edit.mjs` → **41/41**; tabbed modals driven in
headless Chrome (9/9).

- **`team` = ดู, `team_edit` = แก้ไข.** Everyone with a posting in the tree gets
  `team` implicitly — injected once in `effective_team_permissions_for_email()`
  rather than as a new access channel, so RLS, `userCanAccess()` and
  `ADMIN_FEATURES` all honour it with no new plumbing. Today's 4 nodes + 2
  members that held `team` were rewritten to `team_edit`.
  **⚠️ Privacy, explicitly chosen by the user when shown the consequence:** all
  ~285 people in the tree can now read all ~404 member rows, including other
  people's รหัสนักศึกษา and kkumail. The PUBLIC org chart is unchanged (still the
  `get_public_team_chart()` projection; `team_members` still has no anon policy —
  asserted over real HTTPS in the proof).
- **A member can fix their own row** — `team_members_update_self` + a
  deny-by-default column guard. Only name/nickname/รหัส/ชั้นปี/สาขา/photo;
  `permissions`, `vs_dept`, `project_seat`, `node_id` and `kkumail` are all
  refused (9 escalation probes).
- **ตำแหน่งของฉัน now shows the whole record** — portrait, ชื่อเล่น, รหัส, ชั้นปี,
  สาขา, kkumail — plus that person's own ตรวจสอบข้อมูล findings and an inline fix.
  The findings come from the SAME engine as the admin pane: the pure rules moved
  out of `team/health.js` into **`src/js/team/identity.js`** (health.js re-exports
  them, so every existing importer is untouched). `sid_clash` is the one finding
  the card cannot compute — it needs other people's rows, which the payload
  deliberately does not carry — and it is also the one a person cannot fix alone.
- **One editor, two tabs.** `teamPermModal` / `teamMemberPermModal` are gone;
  `teamNodeModal` and `teamMemberModal` now each carry แก้ไข… / แก้ไขสิทธิ์ tabs,
  reachable from BOTH จัดการทีม and จัดการสิทธิ์ — the mode only picks which tab
  leads. Both `<form>`s and their submit handlers are unchanged; the single
  footer button `requestSubmit()`s whichever pane is active.
- **View-only members see a read-only tree** — `canEdit()` gates every write
  affordance at RENDER time (no drag handles, no add/edit/delete buttons, no
  bulk select, modal inputs disabled), so nobody gets a live-looking button that
  42501s.

**Known gaps / next:**
- **Not rendered in a browser as a signed-in member.** The tab mechanism was
  driven headless against a harness; the read-only tree, the enriched card and
  the self-edit round trip have NOT been seen with real data. Worth one pass.
- `sid_clash` is invisible on the card (see above) — deliberate, but if members
  start asking "why does ตรวจสอบข้อมูล say I have a problem I can't see", that is
  why.
- `team_person_mirror_down()` (0108) writes guarded columns without setting the
  `app.team_sync` flag. Unreachable by a non-editor today; if `team_people` ever
  gets a self-service surface, give it the flag.
