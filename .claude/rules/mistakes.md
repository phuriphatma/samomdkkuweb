# Mistakes — classes & index

Every bug this repo has paid for is written up. **This file is loaded into
every session, so it holds only the recurring CLASSES and one line per entry.**
The write-ups live in `docs/mistakes/*.md` and are read on demand.

**To use it**: scan the index below for a line that resembles your symptom, then
open that file — or just `grep -rin "<phrase>" docs/mistakes/`. A near-match is
worth reading; most of these bugs recurred in a second place wearing different
clothes.

**Read the matching file BEFORE touching**: `src/js/auth.js` · `src/js/db.js` ·
anything calling supabase-js · any RLS policy, `current_user_*` helper or
SECURITY DEFINER function · `server/deploy.sh` · `appscript/*.gs`.

---

## The seven classes

Most of what has bitten this repo twice or more is one of these. If you read
nothing else, read this section — it is the part that generalises to code that
has not been written yet.

1. **A per-row UPDATE policy is not a column policy.** `for update using (<col>
   = auth.uid())` gates *which row*, then grants *every column in it*. Found on
   `users` (0028), `vs_tickets` (0096), `shop_orders` (0100) — treat it as
   incomplete by construction and pair it with a column guard.
2. **An unresolvable reference fails OPEN.** `coalesce(flag, false)`, a
   `left join`, `if not found then`, and `null in (...)` all answer "allowed"
   for an id that no longer resolves. Adding a DELETE to reference data creates
   that input for the first time.
3. **Scoped is not full.** A narrow branch added *beside* an unconditional one
   (`has_permission('x')`, `using (true)`, a role list) is decorative —
   permissive policies are OR'd, so the broad grant always wins. Make them
   mutually exclusive, in the form as well as the schema.
4. **Authorization is per-PATH, not per-table.** Sanitising one reader leaves
   `select=*`, the other RPC, the view without `security_invoker`, and the
   audience lookup still leaking. Enumerate the paths. Mirror image: a correct
   restriction mistaken for a complete design — an admin typed a decision note
   into `student_change_requests`, which is admin-only, and the student it was
   addressed to had no read path at all (0128). A form that collects a message
   for a named person is a promise that person can read it. A gate on the WIDGET is not a gate on the ROUTE: the admin sidebar hid
   sections an account could not use and the click delegate skipped them, but
   the HASH was unchecked, so `/admin/#vs` opened VitalSound for someone with no
   VS grant (fixed by `canOpenSection`). Enumerate every way in — click, hash,
   query string, deep link. Non-security twin: a fix
   in an EVENT handler guarded on state the CALLER sets misses every other entry
   point — the /updates scroll fix worked for nav pills and not for
   `navigateTo()`.
5. **A new access channel must be threaded through EVERY gate the old one used**
   — writes, reads, audience/directory lookups, definer-RPC `raise` guards, and
   UI `role === 'x'` branches. This is the single most repeated bug here
   (0089 → 0090 → 0091 → 0093 → 0102). A UI gate that honours the new channel
   hides the gap until someone tries to save.
6. **Two implementations of one rule drift.** SQL↔JS mirrors, a read path and a
   write path, an export and its import, a guard and its call sites. Write the
   differential test in the same commit — a comment saying "keep these in step"
   is not a mechanism. Also the shape where one list is spelled out by hand
   beside a shared constant: main.js's own five-key admin-link list vs
   `ADMIN_FEATURES` (0113), and `io.js`'s own `normalizeYear` vs
   `team/fields.js`. Also a CONVENTION applied in some modules and not others:
   Also TWO WRITABLE TABLES holding one fact: `students` and `team_members` both
   carried a person's identity, and each editor wrote only its own copy — fixed
   by `public.people` plus mirrors (0132–0134). **A bidirectional mirror needs
   `is distinct from` on BOTH sides: that guard is the TERMINATION CONDITION,
   not an optimisation**, and it must compare the value a READER sees — for a
   GENERATED target, compare the generated column while writing the source it
   derives from (ชื่อเล่น, 0134). A generated column is never a reason to skip a
   field in a sync. **And a mirror is only bidirectional on the columns BOTH
   directions NAME**: `people.year` was pushed down and never carried up, so any
   touch of the registry reverted a person's own ชั้นปี edit — "nothing happens"
   (0145). The guard reports a one-way column as settled, by construction.
   Also a DERIVED COLUMN and the expression it came from: `students.cohort_year`
   was filled `if <copy> is null`, so a corrected รหัสนักศึกษา never re-derived
   the รุ่น and every reader's `coalesce(copy, source)` preferred the stale one
   (0128). Fill-once means never-correct — and the SAME shape reappeared in the
   FORMS, where `{...row, student_id: typed}` keeps the stale `cohort_year` that
   `studyYear` prefers (`yearBasis`, 0145). Also one fact STORED in one system and
   DERIVED in the other: `team_members.year` vs ระบบบ้าน's computed ชั้นปี — nine
   members a year behind, and `house/fields.js` had predicted it in a comment
   eight months early, which prevented nothing.
   Also a rule implemented on the writers you HAPPENED to be looking at:
   the replaced-portrait cleanup existed on the ทีม SAMO admin editor and the
   archive editor but NOT on `my-seat.js`, the card every ordinary member uses —
   so "เปลี่ยนรูป leaves the old picture in Drive" was a rule that looked
   implemented. Now one `photoToRetire()` all three call. When a second copy is
   unavoidable (`student_delete_impact` restates `prune_orphan_person`), the
   guard is a DIFFERENTIAL test that predicts, then does it, then compares.
   Also a SELECTOR and the MARKUP it targets: CSS fails SILENTLY — no
   undefined-reference error, no console warning — so a rule that stops matching
   looks exactly like a feature nobody built. Wrapping a station in `.org-box`
   unhooked five `> .org-station` rules; scoping a layout to
   `@media (max-width: 1023.98px)` and later making the view USER-SELECTABLE
   disabled it on desktop (a view is not a breakpoint). When you insert a
   wrapper, grep `> .<child>`; when a layout becomes a choice, grep the `@media`
   that used to make it. The only instrument that can see this is the COMPUTED
   style, never the stylesheet.
   `prefer: 'return=representation'` + a `data.length` check on every DELETE
   (projects/vs/announcements had it; all 5 in `team/api.js` and 3 in
   `shop/api.js` did not) — now swept by `delete-guard.test.js`.
   Also TWO PASSES assigning one DOM property: the perm grid's
   markup locked ทีม SAMO (ดู), then `syncMasterVisibility`'s blanket
   `cb.disabled = on` unlocked it. Only touch what THIS pass locked. Same
   geometry, N passes: a delegated listener re-attached to the SURVIVING host on
   every render, whose handler `toggle`d `d-none` — the panel then opened only
   on odd-numbered paints (`my-house.js`). State in a variable, listeners on the
   nodes this paint made.
7. **Verify from the authority, and test BOTH directions.** Read the ACL from
   `pg_proc.proacl`, not the `revoke` you just wrote; grep the SERVED bundle,
   not the local file; read the LIVE function body, not the migration that first
   defined it.

   **Guards fail GREEN, which is why they get their own playbook —
   `skills/write-a-guard.md`. Read it before writing any test, proof or sweep.**
   The five ways, each paid for here: it cannot SEE the hazard
   (`photo-refcount.test.js` scanned for `photo_url`, hazard sat in
   `houses.icon_url`, 0146) · its CONTROL also finds nothing (0147's first sweep
   printed "0 name users" beside "0 name anything") · it is satisfied by PROSE
   (`confirm-modal.test.js` matched `[data-confirm-no]` inside a *comment* and
   passed with the bug present) · its SUBJECT is a hardcoded name that rotted
   (`proj0092` named a member the org chart moved; `house0116` named an email
   that never existed, so its ALLOW half was always vacuous) · it ERRORS rather
   than fails, and an aborted script is silence, not a red line (`house0116`
   called a function 0124 dropped and ran ZERO assertions for 23 migrations —
   when a migration drops a function or column, grep `tools/` in the same
   commit). **The ritual that catches all five: reintroduce the bug, watch it
   fail on the assertion you expect, restore.**

   Pair every DENY with an ALLOW over the same rows — a table with policies but
   no GRANT denies everyone and reads exactly like the policy working (0138),
   and a probe that can only print "denied" cannot tell a working guard from a
   broken service. **Check the PROBE SUBJECT**: `current_user_has_permission()`
   reads the UNION of `permissions` AND `managed_permissions` (0081), so an
   account picked by `permissions='{}'` may hold `master` through the tree.
   **Check the INSTRUMENT can see it**: minified builds rename module-scope
   `let`s (grep a STRING LITERAL or CSS class), code often lands in a SHARED
   chunk both entries import (0145), `curl -L` turns a GAS `/exec` POST into a
   GET, and `lh3` still serves a TRASHED Drive file. **Re-read a rule's stated
   JUSTIFICATION, not just its predicate** — `users_read_all` carried "needed
   for staff dashboards" in a comment, that need had ended years earlier, and
   the policy outlived its reason in silence (0147).

---

## Adding an entry

1. Write it in the matching `docs/mistakes/*.md`, shaped
   **Symptom → Cause → Fix → Where it lives now**, ending with the general rule.
   Lead with the symptom *as it was reported* — that is what the next reader greps for.
2. Run `npm run mistakes:index` (regenerates the index below from the headings —
   never hand-edit it). If a generated line reads badly, fix the heading.
3. If it is a new instance of one of the seven classes, say so in the entry and
   add the site to that class's list above.

`npm run check:context` fails if this file grows past its budget. When it does,
the fix is to move detail into `docs/mistakes/`, never to raise the budget.

---

## Index — every entry, by area

<!-- BEGIN GENERATED INDEX — npm run mistakes:index -->

### `docs/mistakes/supabase-client.md` — supabase-js, PostgREST & the session lifecycle
*Open when:* auth.js · db.js · anything calling supabase-js. *(17 entries)*

- Supabase Realtime in this app: token goes stale + RLS-gated events silently vanish (autoRefreshToken is OFF), and re-re…
- supabase-js `onAuthStateChange` deadlocks every subsequent call
- supabase-js autoRefreshToken can stall, blocking subsequent requests
- supabase-js silent-success on RLS-blocked updates / deletes
- supabase-js gets into a bad state — bypass with `dbRest()`
- Android Chrome surfaces the supabase-js "bad state" hang on the FIRST call
- `onAuthChange` fires on every refresh — "initial-routing" logic inside it must be gated by a one-shot flag
- PostgREST 400s on unknown URL query params — never cache-bust via `?_=…`
- `PGRST303 JWT expired` mid-modal when the 25-min proactive refresh misses
- Synchronous first `onAuthChange` fire flashes the sign-in gate before the session is restored (looks like "logged out o…
- Hardcoded reserved-username lists rot when new staff accounts are added
- Synthetic email domain must be a real public TLD
- Email confirmation must be OFF in Supabase for synthetic emails
- Supabase `unlinkIdentity` requires ≥2 identities — `hasPassword` is NOT the check
- supabase-js `updateUser({password})` doesn't create an `email` identity
- Account-switcher: capturing the OUTGOING session's tokens fire-and-forget races the session swap → first switch-back fo…
- (Passport repo) Forcing Google OAuth `hd=<workspace-domain>` redirects to the domain's SAML IdP

### `docs/mistakes/authz-rls.md` — RLS policies, SECURITY DEFINER & read paths
*Open when:* any policy, `current_user_*` helper, or definer RPC. *(26 entries)*

- RLS inline subqueries silently depend on the referenced table's RLS
- RLS row-level policies don't gate per-column writes
- `INSERT ... RETURNING` (a.k.a. `Prefer: return=representation`) re-applies the SELECT RLS policy to the inserted row
- Soft-delete changes the operation from DELETE to UPDATE
- `null in (...)` makes a `raise`-on-unauthorized guard fail OPEN
- A per-recipient SELECT RLS policy is DEAD when a `using(true)` public-read policy already exists on the same table (pol…
- A SECURITY DEFINER RPC over a ROW-SCOPED table leaks the restricted rows unless it re-applies the scope
- GitHub-style "duplicate of #A" cross-references LEAK across a per-submitter visibility boundary
- Sanitizing ONE read path of a confidential column leaves parallel read paths leaking
- Publishing a table-backed directory must be a PROJECTION, never a public SELECT policy
- A row-level UPDATE policy with no column guard let a SUBMITTER self-publish to the public board
- Adding a DELETE to reference data turns every `coalesce(<flag>, false)` lookup into a live fail-open
- The row-level-UPDATE-without-a-column-guard class, found on a THIRD table — this time it was money
- An `ILIKE` lookup makes the id a PATTERN, not a capability
- A `left join` onto a reference table fails OPEN exactly as `coalesce(flag,false)` does
- An UPDATE that moves a row OUT of your own SELECT policy fails with the WITH-CHECK error
- A VIEW without `security_invoker` reads its base table with the VIEW OWNER's rights
- `revoke all ... from public` does NOT remove an explicit grant to `anon`
- Moving a read behind an identity-gated RPC breaks every caller that has NO identity
- `revoke ... from public` leaves the grant that the schema's DEFAULT PRIVILEGES gave `authenticated`
- An anon-readable settings table published a staff member's real email
- An admin's decision was written to a column no student had any read path to
- An RLS policy with no table GRANT denies everyone, and looks exactly like the policy working
- An RLS policy's inline subquery is subject to the referenced table's RLS
- A bypass flag set with `set_config(..., true)` stays set for the whole TRANSACTION, not the statement
- Every signed-in account could read all 531 rows of `public.users` — a directory dump AND a map of who holds `master`

### `docs/mistakes/authz-grants.md` — The permission / seat / scope channel
*Open when:* adding an access channel, a scope, or a seat. *(11 entries)*

- Adding a permission-based access channel leaves every ROLE-ONLY gate as a latent block
- A narrowing "scope" dimension added ALONGSIDE an unconditional full-access permission is DEAD
- The privilege-ESCALATING option must never be a select's default
- A capability key is not a ROLE — granting flat `projects` produced a tab with no controls, because the app branches on…
- When a SCOPED grant deliberately drops its blanket permission key, every reader of that key must learn the second signal
- The permission that manages the grant engine was the one the grant engine didn't honour
- A seat/scope dimension that is UNIONED with what it inherits is not a choice
- A permission channel has TWO halves — writes AND reads. `current_user_is_staff()` is a role list, so every read gated o…
- Deriving "which department is this admin" from a UI filter is not a permission
- A seat that grants a SHARED role must not be modelled as a new individual
- WEAKENING the meaning of a permission key silently PROMOTES every gate that still treats it as the strong one

### `docs/mistakes/postgres-schema.md` — Migrations, DDL, triggers & constraints
*Open when:* writing a migration. *(18 entries)*

- Postgres has no `create or replace policy` — partial-replay migrations 42710 out
- A self-update column guard silently bricks EVERY new signup when it blocks a column another trigger legitimately writes
- Service-role seed can't UPDATE `role`/`permissions`
- `create or replace function` CANNOT change the return type — drop it first
- A `NOT NULL` column with `ON DELETE SET NULL` is a latent contradiction
- Recreating a function from the migration that FIRST defined it silently reverts every later one
- Hard-deleting a row referenced by an `ON DELETE RESTRICT` FK fails 23503
- Check constraint must be dropped BEFORE updating to a new enum value
- (Passport) An `AFTER INSERT`-on-`auth.users` re-key trigger only fires for accounts that have NEVER logged into the pro…
- A PL/pgSQL `RETURNS TABLE(... col ...)` function silently ignores `ORDER BY col`
- A self-update column guard must exempt the definer FUNCTION that writes on login
- A UNIQUE EXPRESSION index cannot serve `ON CONFLICT (col)` — the upsert 42P10s, so the whole import is dead on arrival
- Seeding an OBSERVED range as if it were reference data — the FK then rejects every real row outside the guess
- Applying "create the parent on demand" at ONE call site instead of on the table — the other three writers still 23503
- "เปลี่ยนรหัสนักศึกษาเป็น 59… หรือ 64… แล้วรุ่นไม่เปลี่ยนตาม" — a DERIVED column filled once and never re-derived
- A bidirectional mirror without an `is distinct from` guard is an infinite recursion
- "เปลี่ยนชื่อเล่นในทีม SAMO แล้วระบบบ้านไม่เปลี่ยน" — a GENERATED column was treated as a reason to skip the field
- "when i change ชั้นปี in the main web, nothing happens" — a mirror that was one-way on ONE column

### `docs/mistakes/frontend-ui.md` — Bootstrap, CSS, DOM & the browser
*Open when:* markup, modals, layout, touch, icons. *(51 entries)*

- Ticket renderers interpolate user-text into innerHTML → XSS
- A module shared across two shells carries shell-specific assumptions that silently break in the other shell
- An anon-INSERTable table's text columns are ATTACKER-controlled
- Re-opening an ALREADY-OPEN Bootstrap modal with `new bootstrap.Modal(...).show()` stacks a second backdrop
- A destructive-direction toggle without a confirm silently dropped a privacy guard (vs_categories.personal flipped to pu…
- A modal that closes on save makes every edit a round trip — refresh in place instead
- A manager modal opened ON TOP of a form must repaint that form's inputs
- Attribute-driven visibility: check that EVERY value in the markup has a handler, and which way an unhandled one fails
- A directional action whose direction lives ONLY in a label on the other party's row gets read backwards
- `touch-action: none` on a drag handle makes the page unscrollable THERE
- A partial left behind by a restructure is a DECOY
- A shared `render()` that repaints a pane another module owns will destroy that module's in-progress input
- A `busy` flag that RETURNS EARLY silently discards the second action — serialise instead of dropping
- A Bootstrap icon name from a LATER release renders as nothing — no error, no failed request, just an empty box
- iOS Safari `100vh` hides the bottom of a full-height drawer
- Pane-scoped DOM selectors break when the shell is rewritten
- A full-height centered page with `height:100% + overflow:hidden` is unscrollable on mobile when the content is taller t…
- Bootstrap tab JS keeps the parent dropdown open
- Bootstrap mobile offcanvas + `data-bs-toggle="pill"` race
- `form.reset()` clears the file input but `fileInput.files` still references the old File
- `form.reset()` clears hidden inputs
- HTML5 `required` on a hidden field silently blocks form submit
- Adding `prefers-color-scheme: dark` to ONE component in a light-only app makes just that component go dark on a dark-mo…
- A `data-role="x"` element with no matching toggle in the JS is visible to EVERYONE
- Bootstrap gives EVERY modal the same z-index
- A class in the markup with NO rule in any stylesheet is invisible in review and looks exactly like a broken value
- An indicator that links to a LIST moves the work instead of removing it — the click already said WHICH one, so carry it
- State parked on a REUSED DOM element outlives the record it describes — a modal is filled again, the element is not
- Uploading a replacement photo on PICK leaves the previous file in Drive forever
- A filled "danger" style made an UNCHECKED checkbox look ticked
- A second pass over the same controls silently UNLOCKED the checkbox the first pass had locked
- "ลบสมาชิกไม่ได้" — the delete button did nothing at all, and BOTH ways it can do nothing were silent
- "แก้ไขข้อมูล ของระบบบ้าน — ต้องกดหลายครั้งถึงจะขึ้น" — one listener per re-render, and a toggle that reads its own state
- A chooser that opens as an empty placeholder while its vocabulary loads SUBMITS the empty value
- "ปฏิเสธ ไม่ทำงาน แต่อนุมัติทำงาน" — the same suppressed-dialog bug, on a different button
- "แก้ไขสมาชิก shows ชื่อ นามสกุล as blank, that isn't good" — a correct refusal, applied where there WAS a human to ask
- Adding an `await` before the modal closes re-opened a double-submit window
- "เพิ่มสมาชิก ไม่ทำงาน" + "ค้นหาคนจากระบบ ไม่ขึ้นรายชื่อ" — one deletion took out the block sitting next to it
- The ลบ button on a สาขา row rendered OUTSIDE the modal on a phone — an `auto` grid track sized from min-content
- `confirm()` on a SAVE path, not just a delete — permissions silently refused to save
- `/admin/#vs` opened the VitalSound workspace for an admin with no VitalSound grant
- `{"code":"23505" … "students_kkumail_key"}` in an alert() — a unique index used as a first line of defence
- "แก้ไขสมาชิก … ค้นหาคนจากระบบ … พู่กัน picture become myself"
- The ยกเลิก button in `askConfirm` did nothing — in the module written because buttons did nothing
- A VIEW is not a BREAKPOINT — scoping a layout to `@media` and then making it user-selectable
- A markup refactor silently unhooked every `> .org-station` selector
- `justify-content: center` makes the overflow of a scroll container UNREACHABLE
- `flex-wrap` does nothing inside `width: max-content`
- "เข้าสู่ระบบด้วย Google" read as KKU-only — a steer written as a rule, and a form hidden behind a collapse
- "when i zoom, it renders some different view then switches back" — an auto-fit re-armed by the gesture itself
- A blank canvas is not a diagnosis — the graph had flown past the far plane

### `docs/mistakes/app-state.md` — Routing, read-state, caches & serialization
*Open when:* URL state, per-user "seen", import/export. *(14 entries)*

- "Unread" highlight inside an item vanishes the moment you open it — mark seen AFTER capturing seenAt for the open view
- Per-user read-state means a newly-granted account INHERITS the whole backlog as unread
- Migrating a SHARED workflow account to a personal one moves the AUTHORIZATION but leaves every uid-bound row behind
- Module-scope caches make an in-place account switch show two accounts at once
- A path-only router silently discards sub-state — and its own tab handler is what clears the hash you just wrote
- A snapshot table that COPIES a foreign resource id makes the original's delete path destroy history
- An allow-list feeding a BACKUP has the opposite safe default from one feeding a public projection
- A scroll-to-top fix applied in the tab handler misses every link that navigates programmatically
- An upsert that sends EVERY column wipes the ones the file did not have
- An export that carries a GENERATED column re-imports as the real one
- Stripping a คำนำหน้า off a name renames the people whose name STARTS with one
- "แก้ชื่อในหน้าตัวเอง แล้วชื่อ-นามสกุลในระบบบ้านสลับกัน"
- "this person is the same person but it detects wrong because no email"
- An INSERT is a write path too — the import guard covered UPDATE only

### `docs/mistakes/integrations.md` — Notifications, Apps Script & Google Drive
*Open when:* notify, GAS handlers, Drive URLs. *(22 entries)*

- "Email notification doesn't work" = a silent gate, not broken plumbing (verify the channel end-to-end BEFORE rebuilding…
- Discord-notify drops leave NO trace — Pages Function logs aren't retained, so add a durable log before debugging
- `convertDriveUrl(url, size)` silently ignores `size` for an already-lh3 URL
- Never append a query string to an `lh3.googleusercontent.com` URL
- Renaming a folder breaks every guard that matches it BY NAME
- A "validates before touching anything" probe is only side-effect-free on the path that fails FIRST
- A public Apps Script web app is an UNAUTHENTICATED API
- Adding a Google service to an Apps Script web app widens its auto-derived OAuth scopes
- `navigator.sendBeacon` does not follow HTTP redirects
- Fire-and-forget GAS notifications + `muteHttpExceptions:true` = invisible drops
- GAS Cloud Logs are EMPTY for any browser-fetch call (logs simply not recorded)
- Async click handlers run concurrently → parallel Discord POSTs hit per-webhook rate limit
- Cloudflare 1015 (per-IP rate limit) blocks GAS → Discord webhook traffic, NOT Discord's own webhook bucket
- Notification `notify_*_in_app` flags gate the in-app fanout
- Awaiting the serialised Discord notify queue blocks the UI re-render (status/comment clicks feel sluggish)
- `drive.google.com/thumbnail?id=…` images 302-redirect → intermittently BLANK on iOS Safari (iPad) while desktop is fine
- A vendor manual's field list is not the contract
- A refcount is only as true as its list of referrers — and a client-side one cannot see past RLS
- "เปลี่ยนรูป เปลี่ยนรูปแล้ว แต่ในไดรฟ์ยังมีรูปเก่าอยู่" — the cleanup existed, on one of the two writers
- "ลบรูปใน Drive แล้ว แต่เว็บยังขึ้นรูปเดิม" — a TRASHED Drive file is still served publicly
- `uploadPRFile` had no counterpart, so every announcement cover ever re-cropped is still in Drive
- The crest refcount could not see the crest — and the guard reported green

### `docs/mistakes/deploy-hosting.md` — Deploy, nginx & caching
*Open when:* deploy.sh, nginx, cache headers. *(7 entries)*

- `rsync --delete` on deploy yanks the previous build's chunks out from under OPEN tabs
- A deploy script that `git pull`s ITSELF and keeps running will execute a garbage fragment
- "Login is still there so the cache must be cleared" — localStorage and the HTTP cache are different buckets
- CI `npm test` fails on Node 20 — supabase-js throws "Node.js 20 detected without native WebSocket support" at import
- nginx subpath app: bare `/passport` (no trailing slash) silently serves the wrong SPA
- nginx without an `$uri.html` fallback breaks EXTENSIONLESS deep links that a retired Cloudflare-Pages host used to serv…
- Dropping a column while the SERVED bundle still names it — `42703` on the live admin tab

### `docs/mistakes/tooling-proofs.md` — Proof scripts & verification discipline
*Open when:* writing or trusting a `tools/*.mjs` proof. *(7 entries)*

- Two implementations of one rule drift silently — diff them, don't eyeball them
- Debugging note: `tools/db-query.mjs` COMMITS — a probe with `limit 1` and no `ORDER BY` will mutate a real row
- RLS does not RAISE on UPDATE/DELETE — a proof that asks "did it throw?" scores a fully-blocked write as permitted
- A proof script that fails for a CORRECT reason gets ignored — then it protects nothing
- `pg_get_functiondef` over every function 42809s on aggregates
- A proof failed for a CORRECT reason because its subject was hardcoded — the org chart moved underneath it
- A proof that ERRORS is not a proof that fails

<!-- END GENERATED INDEX -->
