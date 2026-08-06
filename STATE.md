# STATE — current task & latest known state

Last updated: 2026-08-05. Read on every cold start, so it is "what is true
RIGHT NOW" and nothing else — `git log --oneline` is the chronology. Keep it
under ~200 lines; when it bloats, move SHIPPED narratives to
`docs/state-archive/YYYY-MM-DD.md` and leave a two-line pointer.

**Start here:** the section immediately below (what just shipped), then CURRENT DEPLOY.

Shipped detail pruned out of here most recently:
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

### ⚠️ OWED — start the next session here

1. **The photo SAVE path still has not been exercised end to end.** Everything
   up to the upload is proven (above), but "บันทึก uploads exactly one file into
   `Team/<ปี>/<ฝ่าย>/` and trashes the previous portrait" writes to production
   Drive against a real member's row, so it was left for the user to say yes to.
   The failure branch (upload throws → return early, pick still pending) is also
   unexercised.
2. **`ฝ่ายเอิงtest` test data is still live** on the public org chart and inside
   real people's cards (a posting called `hi` under `ฝ่ายเอิงtest › เอิงnew ›
   เอิงsubtest`). Still not deleted — it is a data change and needs the user's
   word.
3. **No human has reviewed the Thai copy** in any of this — the new field hints,
   the จัดการรายการ modal, the reworded escalation lines, or the 15 staged
   release notes.
4. `team_person_mirror_down()` still writes guarded columns without setting
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

## Shipped & stable (2026-08-04 → 08-05) — detail archived

The public org chart accordion + the first `ตำแหน่งของฉัน` card, and the
`/updates` release notes + the `MAJOR.MINOR.PATCH` version system + the
เบื้องหลังการพัฒนา panel. Both live and verified against the served bundle.
Full write-ups: `docs/state-archive/2026-08-05-shipped.md`.

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
- **samoweb**: `main` head (`b8d12ad`), **deployed 2026-08-06 07:4x**,
  `buildId eac07e594ba9`. Latest: the implicit-permission lock fix. **Verified
  by DRIVING the served bundle**, not by grep — signed into
  `https://samo.md.kku.ac.th/admin/#team` in headless Chrome and exercised the
  แก้ไขสิทธิ์ grid: ทีม SAMO (ดู) stays `{checked:true, disabled:true}` on open,
  after a click, and across master ON→OFF, while `pr` still locks with master
  and comes back unchecked; จัดการรายการสาขา opens on prod with its live counts.
  Before that: migration **0113** — คำนำหน้า dropped, the
  `team_majors` vocabulary + CRUD, ชั้นปี/สาขา choosers, the canonical
  รหัสนักศึกษา form, photo upload moved to the SAVE path, the ADMIN_FEATURES
  link gate, the ข้อมูลของฉัน pane, and the navigateTo() scroll fix. See
  "THIS SESSION" at the top for all 13 items and what is still owed.
  **Grep the `analytics-*.js` chunk, not just `public-*.js`** — the ตำแหน่งของฉัน
  card lives there. Verified on the SERVED artifacts at deploy time:
  `/build.json` → `{"buildId":"4198ffa0e667","version":"4.4.0"}`;
  `analytics-*.js` carries `myseat-crumb`, `653070317-0`, `team_majors`,
  `myseat-photo-btn`, `term_year` and `แจ้งอุปนายกฝ่ายของท่าน`; `/admin/` carries
  `teamMajorsModal`, `data-team-mode="me"`, `จัดการรายการสาขา` and NO
  `teamMemberPrefix`.
  Superseded: `61f2f6281e25`, `4198ffa0e667`, `bb074fa12f41`, `f401da0ea2f2`, `c380fc060101` (08-05),
  `9f65ec53b172` (08-04).
  Latest change: public release notes at `/updates`, the `MAJOR.MINOR.PATCH`
  version system (**v4.4.0**, tag pushed), and the เบื้องหลังการพัฒนา panel on
  the landing page. Verified against the SERVED artifacts: `/build.json` returns
  `{"buildId":"9f65ec53b172","version":"4.4.0"}`, `/updates` → 200 carrying
  `id="clList"` / `id="devActivity"` / `cl-hero-aurora`, and `IT SAMO` appears
  twice in `/assets/public-*.js`. The 2026-08-01 ทีม SAMO deploy (`28c757c`,
  `buildId e74de393eebd`) is included in this one.
- **passport** (separate repo): code `b57eb1e` **deployed 2026-07-30** (pulled
  + built by `deploy.sh` alongside samoweb). Served bundles
  verified by grep: `stamp_scan` in the scan chunk, `leaderboard_names` in
  dashboard, `admin_leaderboard` + the shared-admin email in admin,
  `sb-passport-legacy-admin` in the shared chunk, and no `from('scans').insert`.
- Migrations: samoweb `public` 0081–**0113**; passport `db/0010` + `db/0011` + `db/0012`
  ALL applied — passport authorization is now enforced server-side (NEXT #3).
- Verify any deploy by grepping the served bundle for feature strings — NOT by
  hash (Mac vs VM hashes differ). For samoweb the shared `analytics-*.js` chunk
  carries auth.js.
- Deploy method: `ssh samo-vm` → `cd ~/samo-projects/samomdkkuweb` →
  `./server/deploy.sh` (pull → `npm ci` → build → `sudo rsync dist/` →
  `/var/www/samo-web` → chown → restart notify → `nginx -t` + reload; also builds
  passport with `PASSPORT_BASE=/passport/`). `deploy.sh` uses BARE `sudo`, which
  needs a tty. **The `ssh -tt` + `sudo -S -v` priming recipe previously recorded
  here does NOT work** — the cred cache does not carry into deploy.sh's own sudo
  calls and it still dies "A terminal is required to authenticate", AFTER both
  vite builds have run. Use an askpass helper instead (no tty needed, verified
  2026-07-31, PW = `.env.local` `SAMO_VM_SUDO_PASSWORD`):
  ```sh
  PW=$(grep '^SAMO_VM_SUDO_PASSWORD=' .env.local | cut -d= -f2- | tr -d '"'"'"'"')
  printf '%s\n' "$PW" | ssh samo-vm 'read -r PW;
    printf "#!/bin/sh\nprintf %%s \"\$SAMO_PW\"\n" > /tmp/askpass.sh; chmod +x /tmp/askpass.sh
    cd ~/samo-projects/samomdkkuweb && git pull --ff-only &&
    SAMO_PW="$PW" SUDO_ASKPASS=/tmp/askpass.sh bash -c "
      sudo() { command sudo -A \"\$@\"; }; export -f sudo; bash server/deploy.sh"
    rm -f /tmp/askpass.sh'
  ```
  Pull manually first (as above) — deploy.sh re-execs itself after its own pull,
  and the manual pull keeps that transition honest. Bundle content-hashes differ Mac vs VM
  (dep/Node deltas) — verify a deploy by grepping the served bundle for feature
  strings, not by hash-matching.
- One Supabase project `fheueuowbchsnsvbcgil` (web `public` + passport in `passport`
  schema). Migrations applied through `tools/apply-migration.mjs` (Management-API PAT).
  **To INVESTIGATE the DB, use `tools/db-query.mjs <file.sql>`, not
  apply-migration** — the latter truncates its echoed result at 2000 chars
  without saying so, which turns any introspection query (policy dumps,
  `pg_get_functiondef` sweeps, column lists) into a confidently wrong answer.
  **`db-query.mjs` COMMITS** — "READ-ONLY" in its header is intent, not an
  enforced mode. Any write probe you run through it lands in production, and a
  plpgsql `exception when others` block only rolls back the FAILING sub
  transaction, so the probes that SUCCEED persist. End every investigative file
  with `rollback;`, and snapshot what you are about to disturb
  (`select <col>, count(*) … group by 1`) before the first write probe — that
  diff is what caught a real ticket being moved on 2026-07-31. Details in
  `.claude/rules/mistakes.md`.
  Both run as the Postgres SUPERUSER: `auth.uid()` is null and RLS is bypassed,
  so to see what a REAL user sees you must `set_config('role', …)` +
  `set_config('request.jwt.claims', …)` inside `begin; … rollback;` — every
  `tools/*` proof script is built that way and is the template to copy.

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

## Housekeeping — the memory system (2026-08-05, RESTRUCTURED)

**The old prune-and-archive loop is retired. Do not re-create
`.claude/rules/mistakes-archive.md`.**

Everything in `.claude/rules/` plus `CLAUDE.md` is injected into EVERY agent
session. That had reached **251k chars ≈ 63k tokens — a quarter of the context
window, spent before the user types anything** — because 118 full write-ups
lived there. The archive file did not help: it is in the same auto-loaded
directory, so it loaded too. It had been split along a *budget* axis
("stable/niche") rather than a *topic* axis, which also made it useless for
retrieval.

Now **26k chars ≈ 6.5k tokens** (a 90% cut), split by what each layer is for:

| | where | loaded |
|---|---|---|
| recurring **classes** (now seven) + a 1-line index of all 117 entries | `.claude/rules/mistakes.md` | every session |
| the 117 **write-ups**, nine files by area | `docs/mistakes/*.md` | on demand |

- **The index is GENERATED** — `npm run mistakes:index` rebuilds it from the
  `## ` headings in `docs/mistakes/`. Never hand-edit it; if a line reads badly,
  fix the heading. The previous hand-written "what's in the archive" blurb had
  already rotted, which is why this one is mechanical.
- **The budget is ENFORCED** — `npm run check:context` fails when an
  auto-loaded file exceeds its cap or a new undeclared `.md` appears in
  `.claude/rules/`. `npm test` runs it (`tools/memory-system.test.js`, 10
  tests: budget, index freshness, no duplicate entry across the nine files, no
  write-up shape back in the hot file). All three guards were verified to FAIL
  when deliberately broken, per class 7.
- **When a file breaches its budget, move detail into `docs/`. Never raise the
  cap.** That is the lever the old loop reached for and it is what got us here.
- `AGENTS.md` was a stale copy of `CLAUDE.md` naming a `.Codex/rules/`
  directory that has never existed (and pages.dev as prod). Collapsed to a
  pointer — one router, no mirror.
- **Release notes are now staged as the work ships.** `PENDING` in
  `src/data/changelog.js` collects user-visible changes in the commit that
  ships them (end-of-turn loop step 3); `npm run release` folds it into the new
  version and clears it. It is NOT rendered on `/updates` — an unreleased list
  on a public page is a promise, and this project has a standing rule against
  promising cadence. `changelog.test.js` holds staged notes to the same
  no-identifiers standard as released ones (it caught a bad `area` immediately).

- **STATE.md is ~350 lines against CLAUDE.md's ~200 budget.** Prune by moving
  COMPLETED items to `docs/state-archive/`, and leave `NEXT` as only what is
  genuinely un-started. `NEXT` is the actual handover — prune it as items are
  completed, not to hit the number.

- `.env.local` holds the Supabase PAT, VM sudo pw, project-B DB creds — never commit.
- CI = Node 22 (supabase-js WebSocket). `npm run build && npm test` before every
  commit — 140 tests green at session end; isolation proof 23/23.

## NEXT-SESSION PROMPT (paste this after a /clear — written 2026-08-05 22:45)

> Read STATE.md first — the section "THIS SESSION (2026-08-05, late)" and its
> ⚠️ OWED list. Everything in it is committed, deployed to
> `samo.md.kku.ac.th` (buildId `61f2f6281e25`) and migration 0113 is applied.
> The ONLY thing outstanding is that none of it has been seen rendering in a
> real browser.
>
> Do this, in order:
> 1. Sign in as a ทีม SAMO member and open `/admin/#team`. Check: the new
>    **ข้อมูลของฉัน** mode paints the ตำแหน่งของฉัน card; the สมาชิก editor's
>    ชั้นปี and สาขา are dropdowns showing the person's current value; the
>    **จัดการรายการ** link beside สาขา opens the จัดการรายการสาขา modal ON TOP of
>    the editor without breaking the backdrop or the scroll chain (that exact
>    chain broke in 0110 — see docs/mistakes/frontend-ui.md); คำนำหน้า is gone
>    from the form; **ทุกระบบ (Master)** in แก้ไขสิทธิ์ does NOT look ticked when
>    it is not; **ทีม SAMO (ดู)** shows as a locked/dashed "อัตโนมัติ" row.
> 2. Replace a member photo: pick a file, crop, then pick a DIFFERENT file, then
>    save. Exactly ONE new file should appear in
>    Drive `IT Database/Team/<ปี>/<ฝ่าย>/`, and the previous portrait should be
>    trashed. Then repeat but CLOSE the modal without saving — Drive must gain
>    nothing.
> 3. On the home page as that member: the ตำแหน่งของฉัน card's breadcrumb should
>    read `ฝ่าย… › ฝ่าย… › ตำแหน่ง` in one line; **แก้ไขข้อมูลของฉัน** should
>    offer ชื่อ-สกุล, ชื่อเล่น, รหัสนักศึกษา (with the format hint), ชั้นปี and
>    สาขา as dropdowns, and a เปลี่ยนรูป button. Save, then confirm the same
>    values appear in admin ทีม SAMO for every ตำแหน่ง that person holds.
> 4. Confirm the account menu (top right) shows **ไปยัง Admin Dashboard** for a
>    member whose only grant is ทีม SAMO (ดู).
> 5. Fix whatever that turns up, write up anything that was a real bug in
>    `docs/mistakes/*.md` + `npm run mistakes:index`, stage a PENDING note if a
>    person would notice, then `npm run build && npm test`, commit, push and
>    redeploy with the askpass recipe in CURRENT DEPLOY.
>
> Then ask me about the two decisions still open: deleting the `ฝ่ายเอิงtest`
> test data (it is visible on the public org chart AND inside real people's
> cards), and whether to cut a release — 14 notes are staged in `PENDING` and
> `npm run release` is the mechanical half.
