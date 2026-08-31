# Backlog

> Work not yet started. Read alongside `STATE.md`

Moved out of `STATE.md` on 2026-08-04 so that file can stay under the ~200-line
cold-start budget CLAUDE.md sets. **Nothing here is in flight.** Everything is
un-started; STATE.md carries a one-line pointer to this file.

Ordered by what will bite first. Everything named here is verified true as of
HEAD; the proof scripts and migrations referenced all exist and pass.

### 0a. ทีม SAMO admin model — PARKED at the owner's request (2026-08-14)

Analysed in full, nothing built, owner asked to hold it. Do not restart this
without them asking; do not re-raise the `master` finding (it is INTENTIONAL —
see STATE.md).

**The diagnosis.** One `team_nodes.parent_id` edge carries three different
relations at once: display containment, reporting line, and permission
inheritance. That is why grants behave surprisingly — you cannot express "the
head reports to the ฝ่าย, members report to the head, but the head's personal
grants are personal", because it is all one edge.

⚠️ **RE-MEASURE BEFORE ACTING — the owner has been editing the tree.** The
numbers below moved between 2026-08-14 and 08-15 (272 → 296 nodes, 398 → 423
people), so treat any count here as a method, not a fact.

Measured 2026-08-15:

- **18 nodes carry a grant** (permission, `vs_dept` or `project_seat`) — was 12
  the day before. The permission "tree" is still a short list, not a hierarchy.
- **6 of those still CASCADE** (they have children), which is the shape the plan
  is about. Re-run: a grant-bearing node that `exists (select 1 from team_nodes
  c where c.parent_id = n.id)`.
- **The owner already did part of step 4 by hand.** `อุปนายกฯ` — a CONTAINER
  carrying `team_edit, house` over 10 children — is gone; `team_edit` now sits on
  each of the ten individual อุปนายก LEAF nodes instead. That is exactly the
  "move the grant from the container to the leaf" move. Credit it, do not redo it.
- **`house` is now granted by NO node at all.** ระบบบ้าน admin is reachable only
  through the `vp_admin`/`dev` ROLE — 12 accounts — and through zero permission
  grants. **Ask the owner whether that is intentional**; it disappeared during
  the same restructure, and a role-only gate is the exact shape
  `.claude/rules/mistakes.md` class 5 warns about. It also broke
  `house0144-delete-impact.sql`, which had been selecting its subject from the
  permission channel alone.
- **`kind='role'` WITH children** remains the mechanical detector for the
  ฝ่ายดิจิทัล nesting convention the other head nodes do not use.

**The proposed rule**, if it is ever picked up: a `kind='role'` node is always a
leaf, and grants attach only to `kind='role'`. `kind` already exists and is
currently marked "advisory only"; making it load-bearing means a grant can never
cascade, by construction rather than by care.

**Proposed order** (1 and 2 are UI-only, no migration, and stop the bleeding):

1. Disable the grant control on `division`/`department` rows, with a hint that
   the grant belongs on a ตำแหน่ง inside.
2. Show the **downward blast radius** in the perms modal. `refreshPermInherited()`
   (`src/js/team/index.js:1869`) calls `inheritedPermsFor` / `inheritedSeatsFor` /
   `inheritedVsDeptsFor` — **all three walk `parent_id` UPWARD**. Nothing anywhere
   computes what a grant *gives*, which is exactly how a container grant went
   unnoticed. Add the descending counterpart plus a confirm above N people.
3. A new `mode: 'grants'`: one flat table of all ~12 grants, sorted by reach
   descending, so anything odd floats to the top. Derived, so it cannot drift.
4. Only then, the migration: re-parent the 6 nodes and move the 4 container
   grants onto leaves, with the invariant landing as a guard test in the same
   commit.

**Do NOT build a second tree for permissions.** The owner asked whether the
display structure and the permission structure should be separated; they should
not. The admin already has `mode: 'team' | 'perms' | 'years' | 'health'` — four
views over ONE tree — which is the correct pattern and already shipped. Two
writable trees is `.claude/rules/mistakes.md` class 6 by construction.

### 0b2. The shop checkout + order card have never been driven in a browser (2026-08-12)

The contact recap above the place-order button, and the inline "แก้ไขข้อมูลติดต่อ"
editor on an order card, shipped on 2026-08-12 verified by: build, 717 tests,
`undefined-refs`, a full code trace, and a STATIC render of the two markup
fragments against the real stylesheet at 390px. **Not verified: the wiring** —
the delegated click handlers for แก้ไข / บันทึก / ยกเลิก, and the live recap sync
from the field listeners. Driving it needs a signed-in session with items in the
cart, which the headless driver cannot fake (module-scope `getUser()` cannot be
stubbed from the page).

Worth doing on the next browser pass: sign in as a test account, add an item,
and walk checkout → place → order card → แก้ไข → บันทึก. Everything else in that
flow is unchanged and long-proven; only this session's additions are unexercised.

### 0c. Two authorization gates that are latent, not broken (2026-08-12)

Found while sweeping for more of 0149's shape (a definer RPC that restated a
policy and missed the permission channel). Both were PROBED LIVE and neither is
reachable from the app today, which is why they are here and not a fix:

- **`users_update_staff` is `current_user_is_staff()`** — a pure role list. A
  person holding `master` through the ทีม SAMO tree (3 accounts, `role='user'`)
  cannot UPDATE another user's row; probed live, 0 rows affected. Harmless
  ONLY because nothing in `src/js` writes another user's row — permissions flow
  from `team_nodes` through the definer sync, not through this policy. The day
  something needs a cross-user write from the admin UI, this refuses the very
  people the tree was built to empower.
- **`notify_log_select_staff` / `reserved_staff_usernames_read_staff`** — same
  role list, both probed at 0 rows for a permission-only admin. Neither table
  is read from `src/js` at all.

Deliberately NOT swept into 0149: changing a live policy for a path nothing
takes is risk without a beneficiary. `src/js/definer-authz.test.js` covers the
FUNCTION half of this class on every commit; policies are not machine-checkable
the same way, which is what this note is for.

Checked and CORRECT, recorded so nobody re-investigates: `vs_tags` reads pass
through `vs_tags_write_scoped` (a `FOR ALL` policy also covers SELECT — probed
9/9 with an ungranted control at 0); `projects/manage.js` gates on the
SEAT-RESOLVED role via `projectSeatRole()`, so a `vpa`-seat holder does get the
controls; `vs-staff.js` `isVsSuper` and `team-vocab.js` `canEditTeam` both
consult permissions and role.

### 0d. ✅ DONE 2026-08-26 — the PR desk rule is ONE predicate (0168)

Kept as a pointer because the SHAPE is worth copying, and because opening it
found more than this note knew.

**It was FOUR copies, not two.** `pr_tickets_read`'s third branch,
`pr_tickets_update_staff`, `pr_tickets_delete_staff` and `soft_delete_pr_ticket`
all spelled `current_user_role() in ('pr_staff','dev') or
current_user_has_permission('pr')`. Naming the extraction after DELETE — which
is what this note asked for — would have left three copies behind under a name
that lied about where the rule is used. **Read `pg_policy` before believing a
note about how many copies there are.**

All four now call `public.current_user_can_manage_pr()`. Behaviour unchanged and
measured both directions before and after;
`tools/pr0149-delete-permission.sql` went 13 cases → 25, with a new §D that is
STRUCTURAL — behaviour alone cannot see a fourth copy, because four identical
copies agree perfectly right up until one is edited.

⚠️ **The cleanup nearly cost a guard its eyesight, and that is the transferable
part.** Moving the decision into a shared predicate moved it out of the body
`src/js/definer-authz.test.js` reads, so that sweep would have skipped
`soft_delete_pr_ticket` at "it decides some other way" — green, and blind. It
now follows one level of helper calls, with a control that measures raw vs
expanded so the expansion cannot silently stop. **Extracting a predicate is the
right fix for drift; check what was WATCHING the thing you extracted.**

The same treatment is still worth copying for any new policy+RPC pair — it is
what the VS side has done since 0083 (`current_user_vs_scope()`).

### 0. `photo_reference_count()` cannot see `houses.icon_url` (2026-08-09)

The house-crest cleanup in `src/js/house/index.js` (`onHouseSubmit` →
`deleteTeamPhotoIfUnused(prevIcon)`) decides on `photo_reference_count()`, which
counts five tables and every one of them on `photo_url`. A crest lives in
`houses.icon_url`, so the count answers **0 for every crest** and the delete
always proceeds.

Safe today only by coincidence — the row is repointed before the count runs, so
nothing else legitimately references it. It stops being safe the moment two
houses share a crest URL: replacing one trashes the file the other displays, and
because GAS deletes now REVOKE SHARING before trashing (2026-08-09), the victim
breaks *immediately* rather than lingering through the trash window.

⚠️ `src/js/photo-refcount.test.js` is the guard for exactly this class and it
reports GREEN here, because it scans the migration DDL for tables given a
`photo_url` — `icon_url` is invisible to it. That false assurance is why the
crest cleanup was written this way in the first place.

**Fix**: a new migration adding `houses` to `photo_reference_count()`, and widen
the guard test to any `*_url` column a delete path can reach. Verify with
`node tools/team0143-photo-refcount.mjs` (5/5 today) plus a crest case.

### 0b. Three small things seen while driving the admin UI (2026-08-10)

Found during the first signed-in browser pass. None is urgent; all are cheap.

1. **`/admin/#team` on a COLD load lands on ภาพรวม.** Navigating to the hash
   from a fresh page load did not open ทีม SAMO — clicking the sidebar did. The
   hash router is gated by `canOpenSection` (0144-era) and honours in-session
   hash changes; what looks unhandled is the FIRST paint, where the section is
   decided before the router reads `location.hash`. Deep links people paste to
   each other are exactly the cold-load case. Confirm before fixing: it may be a
   race with the permission fetch rather than a missing call.

2. **The ค้นหาคนจากระบบ hint goes stale.** Typing a second query leaves
   `ไม่พบใครที่ตรงกับ "<old query>"` on screen while the NEW results are listed
   directly beneath it — the hint is written on the empty path and never cleared
   when a later reply paints rows. One line in `renderPersonResults`.

3. **ตรวจสอบข้อมูล shows 8 findings** on the live tree and nobody has looked at
   them. They are data issues (`team/health.js`), not code, but 8 is small
   enough to actually resolve rather than carry.

### 1. Nothing behind the ADMIN LOGIN has had a signed-in browser run
Every server path is proven by the 12 scripts (234 checks, all re-run green at
session end). The PUBLIC half is browser-verified; everything requiring a login is
not, because the agent session cannot authenticate. Check these first — likeliest
place a regression hides.

**Added 2026-07-30 — shipped this session, server-proven, NOT clicked:**
- **ทีม SAMO photo upload** — member form → รูปประจำตัว. Goes through
  `uploadImageToDrive` (GAS `uploadPRFile`), then `photo_url` saves with บันทึก.
  The whole GAS upload leg is untested here; if it fails, check the GAS deploy
  before suspecting the column. Preview + "นำรูปออก" also unclicked.
- **จัดการสิทธิ์ search** — typing a PERSON's name there now filters (the member
  scan used to be gated to จัดการทีม). Type a ชื่อเล่น and confirm the person
  appears with their ตำแหน่ง ancestors.
- **Mobile drag on ทีม SAMO** — needs a REAL phone. A scroll starting on a drag
  handle must scroll; a ~220ms hold must start a drag and highlight the row; drag
  must be absent entirely in จัดการสิทธิ์.
- **สถิติการใช้งาน** — proven server-side for a tree grantee (0102), but open it
  as a non-staff grantee once to confirm the dashboard renders rather than erroring.
- **Public /team org chart** — verified at desktop width only. **Not verified at
  mobile width**: the browser extension screenshots at a fixed size regardless of
  window resize, so the sub-768px stacking rests on the media queries alone.
- **VS บันทึกข้อความ (0096)** — the visibility select in the staff ticket modal;
  a `thread` note written on a canonical must appear on a duplicate's tracking
  timeline tagged "จากเรื่องที่เกี่ยวข้อง"; a `public` note must appear in
  ความคืบหน้าจากทีมงาน on the board (separate from comments).
- **VS staff modal (0099 UX)** — บันทึกข้อมูล must now KEEP the ticket open,
  repaint its timeline, and show "บันทึกแล้ว" inline in the footer.
- **VS จัดการหมวดหมู่ / จัดการแท็กภายใน** — ลบ works, its confirm names the
  usage count, and a newly ADDED หมวดหมู่ is immediately selectable in the open
  ticket without closing it.
- **อาจารย์ (0095)** — a `prof`-seat holder must see EVERY หนังสือ that carries
  a signature request (17 of 43 as of 2026-08-18), not a per-uid subset. The
  shared `saprof` account this used to be diffed against is gone; the number to
  compare with is the corpus count, which `tools/prof0095-seat-parity.mjs` now
  computes as superuser. If it shows 0, the seat resolution broke, not the RLS.
- **SAMO Shop (0094)** — unscoped again for everyone; the ทีม SAMO picker should
  have NO แหล่งที่มา field.
- **ประกาศ (0093B)** — a `creator` grantee must see their own drafts/pending in
  เขียนประกาศ + ลำดับการแสดงประกาศ (before 0093 they could write and not read).
- **Admin account switch** — switching accounts must hard-reload `/admin/`.
- **Public article แก้ไข/ลบ** — now `data-perm-only="creator"`; a tree-granted
  creator should see them, a plain user should not.
- **Passport** — the Google sign-in round-trip and the dept-scoped admin view.
  This is the one I could not test at all (no way to drive OAuth from here).

### 2. Passport `admin`/`1234` — a deliberate TEMPORARY second door, not a bug
**The intended model, confirmed by the user 2026-07-30**: whoever holds the
`passport` permission (or a dept scope) in ทีม SAMO is a passport admin. That is
exactly what `public.passport_admin_context()` implements — `is_admin` = blanket
`passport` perm or `role='dev'` (→ `all_departments: true`) OR any
`managed_passport_scopes` entry; null `auth.uid()` fails closed. Nothing to
change here.

`admin`/`1234` is a knowingly-temporary alternate entrance, and since 2026-07-30 it
**signs into a real shared Supabase account** rather than comparing strings —
`passportadmin@samomdkku.app`, `permissions={passport}`, on its own client with its
own `storageKey` so it can never disturb an organiser's personal Google session.
That is what let `db/0011` land while the door keeps full admin. Credentials live
in `VITE_PASSPORT_ADMIN_EMAIL` / `VITE_PASSPORT_ADMIN_PASSWORD` (this Mac's
`passport/.env.local` AND the VM's `~/samo-projects/samomdkkupassport/.env.local`)
— **not in the public repo**, though they do ship in the built bundle because they
must be usable. So the door is no more secure than '1234' was; what changed is that
everyone NOT using it now has no write access at all, and its writes carry a uid.

To retire it: `LEGACY_PASSWORD_LOGIN = false` in passport `js/admin-scope.js`,
redeploy, confirm every admin can sign in with Google, then delete the marked
block, `handleLegacyLogin` in `admin-page.js`, `#admin-legacy-box` in
`html/admin.html`, the two env vars in both places, and finally strip the shared
account's grant (`array_remove(permissions,'passport')` — needs the
`users_self_update_guard` disable dance, see mistakes.md) or delete the auth user.
**Who keeps access when that flag flips** (live, 2026-07-30 — the previous note
here said 2 people and was STALE):
- ทุกฝ่าย: `kita.a@kkumail.com`, `putita.s@kkumail.com`, `worapat.c@kkumail.com`
- dept-scoped `d:1`: `jinjutha.t@kkumail.com`, `phuriphat.ma@kkumail.com`

Re-run the check before flipping — the tree changes:
`select email, managed_passport_scopes, managed_permissions from users where
'passport' = any(managed_permissions) or managed_passport_scopes <> '{}';`

### 3. Passport authorization — DONE. Two small follow-ups remain
Narrative: `docs/state-archive/2026-07-30-passport-authz.md`. `db/0010` + `0011` +
`0012` applied, app deployed. `tools/pass-anon-probe.mjs` (real anon key over
HTTPS) went **6/9 → 9/9**: student emails, the roster via `user_tiers`, and
`PATCH /scans` are all refused now; the catalog and scan-points reads the app needs
before sign-in still work. `tools/pass-hardening.mjs` = **60 checks** over seven
principals, applying the lockdown inside a rolled-back transaction.

**`admin`/`1234` still works as a FULL admin** — user's standing requirement, many
people use it. It now signs into a shared Supabase account so it carries a real
JWT (see the archive for why nothing else could work). **Do not retire it without
asking**; checklist in #2.

**Follow-ups, neither urgent:**
1. **`activities.static_token` is anon-readable** because the whole row is — RLS
   cannot hide a column. Impact is small now (`stamp_scan()` pins the scan to
   `auth.uid()` and derives the km itself), so a leaked token only lets a signed-in
   kkumail student stamp something they did not attend. To close: drop the
   `isStaticMatch` client pre-check, switch `scanning.js` off `select('*')` to an
   explicit column list, THEN
   `revoke select (static_token) on passport.activities from anon, authenticated`.
   That order, or the scan page 400s.
2. **Per-ฝ่าย WRITE scoping is unenforced** — the write policies check
   `is_admin()`, not the department, so a scoped admin can still edit another
   ฝ่าย's activity via DevTools. `passport.admin_covers_dept(dept, sub_dept)`
   already exists for it. Pointless while the all-departments `1234` door is open,
   so sequence it after retiring that door.

### 4. Shared → personal accounts: ✅ CLOSED 2026-08-18
Every shared หนังสือโครงการ login is now DELETED. `samomdkkuvpa` went on
2026-08-17; `sastaff` and `saprof` went on 2026-08-18 via
`tools/purge-shared-project-accounts.mjs`, which reassigned their work to the
named person already holding the equivalent seat (161 rows → เจ้าหน้าที่คณะ,
65 rows → อาจารย์) before deleting them. `public.users` now holds **no**
`uni_staff` and **no** `sa_prof` row at all.

The model that replaced them: a ทีม SAMO seat IS the role. `projectSeatRole()`
maps the seat to the role string the module branches on,
`current_user_project_seats()` carries it into RLS, and every project_* policy
asks a seat-aware helper. Proof: `tools/proj0165-succession-and-prefs.sql`
(37/37) — the seat reads a project the public mirror cannot, opens a signing
request, and is denied everything the seat should not reach.

⚠️ **CLOSED does not mean the first pass was complete.** The purge moved every
uid COLUMN and deliberately left `project_documents.timeline[].by` /
`project_sign_requests.timeline[].by` alone (its header said why). That cost 42
of the 43 comments in the system their แก้ไข / ลบ buttons, for every account,
because `isMineComment` is `c.by === myId`. Migration **0166** remapped the 298
events on 2026-08-18 after the owner reversed the call; §D7/§D8 of the proof now
watch both timelines, and §D4/§D5 ask whether a uid RESOLVES rather than whether
it is `null` — which is why this read green for a day.

`tools/proj-handover.mjs` remains for the general case (moving read-state,
sign-requests and bell rows between two accounts); the purge script does the
same job inline for a delete. Residual if you run the handover:
`getDocSeenAt()` falls back to a localStorage map when the server has no row,
so a badge can look wrong on a device the target already browsed on — clear
site data there.

### 5. Inert columns from the reverted shop scope
`team_nodes.shop_source`, `team_members.shop_source`,
`users.managed_shop_sources` exist and NOTHING reads them (0094 reverted the
feature). Drop statements are in 0094's header; after dropping, also strip them
from `sync_my_team_permissions`, `recompute_team_managed_permissions`,
`users_self_update_guard` and `current_user_has_any_grant`, which still name
them. Left in place because dropping columns is destructive and was not asked
for. **Do not re-add a SAMO Shop source scope without being asked** — it was
declined because orders cannot be scoped (one order holds items from several
sources), so a product-only scope isolates nothing.

### 6. Watch-outs a future change must not break
- **0095 tradeoff**: every อาจารย์ now sees every signature request. Correct for
  one shared role; the day per-professor privacy is wanted the fix is the uid
  check PLUS a "which professor am I" dimension — a plain revert re-empties the
  seat.
- **Never widen `current_user_is_staff()`** — `users_self_update_guard` trusts it
  for privileged-column writes, so widening it lets any grantee self-promote to
  `dev`. `tools/grant0093-reads.mjs` asserts this with a real attempt.
- **`tools/vp-accounts.mjs`** still does a plain `.update({role})` and will hit
  `users_self_update_guard` if re-run — port the select→delete→insert fallback
  from `tools/president-account.mjs` first (see mistakes.md).

### 7. Not started
- ~~**Org-chart renderer**~~ **DONE 2026-07-30** — public `/team` page, migration
  0103. Detail: `docs/state-archive/2026-07-30-passport-authz.md`.
  **Live privacy constraint**: a member's name + photo go public as soon as their
  ตำแหน่ง sits in a public subtree. `team_nodes.is_public` is the ONLY control —
  there is no per-member opt-out. `get_public_org_chart()` remains the only
  sanctioned publisher; a new `team_members` column is not published until it is
  named in that function's jsonb.

- **Notify follow-up (b)** from the notify_log entry in mistakes.md:
  `waitUntil`-deliver + immediate 202, so delivery is decoupled from the client
  connection. Changes the callGAS success-echo contract — do it together with
  making `notify_log` the source of truth for failures.
- Passport repo has untracked `AGENTS.md` + `.agents/` (not mine, left alone).

---

## Hardening `notifyProjectEmail` beyond the allow-list

The recipient allow-list closes the broad case. What it does NOT constrain is
the **content**: `subject` and `htmlBody` still come from the caller, so the
endpoint can still be made to send an arbitrary-looking message to an allowed
address, and repeated calls still consume the MailApp daily quota that the real
notifications depend on. Ranked options, best first:

1. **Template the content server-side** (recommended, cheapest). Stop accepting
   `subject`/`htmlBody`; accept structured fields (doc id, action, actor) and
   render them into a fixed template in `prform.gs`, escaping the values. The
   caller then chooses only *what the notification is about*, never its wording.
   No new OAuth scope, no re-consent, no infrastructure. Touches
   `src/js/projects/notify.js` and the GAS handler together.
2. **Move email off GAS entirely**, to the `samo-notify` service on the VM —
   the same move already made for Discord, and for the same reasons. A Node
   service can hold a real secret and verify a Supabase JWT cheaply, which GAS
   cannot do without widening its scopes. Leaves GAS doing only Drive.
3. **Add the caller-identity gate** (`requireSupabaseUser_`, already written and
   reverted — see the GAS section). Requires the owner to re-consent FIRST.
4. **Rate-limit per hour** via `CacheService` in GAS. Protects the quota only;
   does nothing about content. Cheap, but do not add it untested at the end of a
   session — a wrong threshold silently drops real notifications.

1 + 3 together would leave very little: a fixed recipient set, templated
wording, and a signed-in caller.

---

## Drop the two dead ชั้นปี columns (0145 left them deliberately)

`team_members.year` and `people.year` are dead as of 0145 — nothing reads or
writes them — but they were NOT dropped in the same migration. 0129 took
ระบบบ้าน's admin tab down for 20 minutes by dropping columns the SERVED bundle
still named, so the order is fixed: **deploy, confirm served, then drop.**

The bundle that stopped reading them was served on 2026-08-10 (v4.6.0). Two
things to do together in one small migration:

1. `alter table public.team_members drop column year;`
   `alter table public.people drop column year;`
2. Remove `'year'` from `team_members_self_update_guard`'s `v_allowed`, and
   drop the corresponding exception in `src/js/name-split.test.js` (it asserts
   the guard still lists the dead column, and says so in a comment).

`get_my_team_seat()` also still emits `'year', m.year` "for one release" —
remove that key at the same time.

## photo_reference_count compares URL STRINGS, so it cannot cover the whole schema

0146 widened it to `houses.icon_url`, and widened the guard test to force a
decision on every `*_url` column. Eight columns are deliberately excluded, and
the reason is the same for most of them: **one Drive file has many URL
spellings** (`=w1200`, `=w600`, `/view`, `lh3` vs `drive.google.com`), so string
equality would answer 0 for a file that IS referenced under another spelling —
a fail-open that destroys the file.

Portraits are safe today because one uploader writes them all in one spelling.
To cover announcement covers, PR attachments and project files with the same
count, normalise to a Drive FILE ID first — `driveIdsInHtml`/`filesToRetire` in
`announcements.js` already do exactly that in JS, so the rule exists and would
need a SQL twin (which is itself the two-implementations hazard: prefer moving
the callers to one path over writing the second one).

The exclusions and their reasons are the `NOT_A_PORTRAIT` map in
`src/js/photo-refcount.test.js`. It is shrink-only.


## The Claude reporter's polling interval — asked, answered, not acted on

Moved out of `STATE.md` on 2026-08-28: it is reasoning, not status, and the
status file was over its line budget. (Its heading there read "Question 2" while
the table beside it called the same thing question 1.)

Faster than 15 minutes is possible but pays three ways: the endpoint rate-limits
hard, **every run rotates the OAuth refresh token** — more runs, more chances to
strand a credential only a human on the VM can restore — and a true on-demand
poll needs an authenticated endpoint on the VM, which is new attack surface on a
service that has none today. The refresh button re-reads the DATABASE only, and
says so.

**Recommendation: leave it at 15 minutes.**

## The org chart on a REAL iPad

Moved out of `STATE.md` on 2026-08-28 to stay under its line ceiling — it is a
task, not a status, and deleting it would have lost the only record.

The org chart has been verified on **Playwright's WebKit only**. That is the
same engine iOS uses, but not the same device: touch targets, momentum
scrolling, pinch-zoom and the safe-area insets are all things a desktop WebKit
does not reproduce. It has never been opened on real hardware.

📌 Related, and already paid for once: **a bug in one iOS browser but not
another is never the browser** — every iOS browser is WebKit, so the variable is
STATE. Disprove with a fresh context first (`docs/mistakes/frontend-ui.md`).
