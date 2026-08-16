# Mistakes — classes & index

Every bug this repo has paid for is written up. **This file is loaded into
every session, so it holds only the recurring CLASSES and one line per entry.**
The write-ups live in `docs/mistakes/*.md` and are read on demand.

**To use it**: scan the index below for a line that resembles your symptom, then
open that file — or just `grep -rin "<phrase>" docs/mistakes/`. A near-match is
worth reading; most of these bugs recurred in a second place wearing different
clothes.

**Read the matching file BEFORE touching** `auth.js` · `db.js` · anything
calling supabase-js · any RLS policy, `current_user_*` helper or definer
function · `server/deploy.sh` · `appscript/*.gs`.

---

## The seven classes

Most of what has bitten this repo twice or more is one of these. If you read
nothing else, read this section — it is the part that generalises to code that
has not been written yet.

1. **A per-row UPDATE policy is not a column policy.** `for update using (<col>
   = auth.uid())` gates *which row*, then grants *every column in it*. Found on
   `users` (0028), `vs_tickets` (0096), `shop_orders` (0100) — incomplete by
   construction; pair it with a column guard.
2. **An unresolvable reference fails OPEN.** `coalesce(flag, false)`, a
   `left join`, `if not found then` and `null in (...)` all answer "allowed" for
   an id that no longer resolves. A DELETE on reference data creates that input
   for the first time.
3. **Scoped is not full.** A narrow branch added *beside* an unconditional one
   (`has_permission('x')`, `using (true)`, a role list) is decorative —
   permissive policies are OR'd, so the broad grant wins. Make them exclusive.
4. **Authorization is per-PATH, not per-table.** Sanitising one reader leaves
   `select=*`, the other RPC, the view without `security_invoker` and the
   audience lookup leaking. Mirror image: a correct restriction mistaken for a
   complete design — an admin's decision note went into admin-only
   `student_change_requests` and the student it addressed had no read path
   (0128). A form collecting a message for a named person promises that person
   can read it. A gate on the WIDGET is not a gate on the ROUTE: the sidebar hid
   sections an account could not use, but the HASH was unchecked, so
   `/admin/#vs` opened VitalSound for someone with no VS grant. Enumerate every
   way in — click, hash, query string, deep link, GESTURE (on a scroll surface
   `pointerdown` starts every gesture the surface supports, and state armed
   there must be released on `pointercancel`). Non-security twin: a handler
   guarded on state the CALLER sets misses every other entry point. COPY too —
   one claim lived in the sign-in caption, the signup link AND the home strip.
   A LABEL, a CHART and a DERIVED value each make a claim about every case they
   cover — the four org-chart entries in `docs/mistakes/frontend-ui.md`.
5. **A new access channel must be threaded through EVERY gate the old one used**
   — writes, reads, audience/directory lookups, definer-RPC `raise` guards and
   UI `role === 'x'` branches. The most repeated bug here
   (0089 → 0090 → 0091 → 0093 → 0102). A UI gate that honours the new channel
   hides the gap until someone tries to save. **A SECURITY DEFINER RPC that
   restates a policy is one of those gates** — `soft_delete_pr_ticket` kept the
   pr_staff/dev test 29 migrations after the policy learned `has_permission('pr')`
   while its VS twin was correct, so the pair read as permission-aware (0149).
   Check the SECOND twin.
6. **Two implementations of one rule drift** — but check both callers want the
   SAME answer: unifying the four org views on one parentage made แผนผัง a
   52,000px staircase (two draw containment, two reporting). A change is NOT
   verified in a view you never opened. SQL↔JS mirrors, a read path and a write
   path, an export and its import, a guard and its call sites. Write the
   differential test in the same commit — a comment saying "keep in step" is not
   a mechanism. Also a hand-written list beside a shared constant (main.js's
   admin links vs `ADMIN_FEATURES`, 0113). Also TWO WRITABLE TABLES holding one
   fact: `students` and `team_members` each carried a person's identity and each
   editor wrote its own copy — fixed by `public.people` (0132–0134).
   **A bidirectional mirror needs `is distinct from` on BOTH sides: that guard is
   the TERMINATION CONDITION, not an optimisation**, and it must compare the
   value a READER sees — for a GENERATED target, compare the generated column
   while writing the source it derives from (ชื่อเล่น, 0134); a generated column
   is never a reason to skip a field. **And a mirror is only bidirectional on
   the columns BOTH directions NAME**: `people.year` was pushed down, never
   carried up, so any touch of the registry reverted a person's own ชั้นปี edit
   (0145) — the guard reports a one-way column as settled, by construction.
   Also a DERIVED COLUMN vs the expression it came from: `cohort_year` filled
   `if <copy> is null`, so a corrected รหัสนักศึกษา never re-derived the รุ่น
   (0128) — fill-once means never-correct; same in FORMS, where
   `{...row, student_id: typed}` keeps the stale copy (`yearBasis`, 0145).
   Also a rule implemented on the writers you HAPPENED to be looking at (the
   portrait cleanup missed `my-seat.js`). Where a second copy is unavoidable,
   the guard is a DIFFERENTIAL test.
   **"ONE HOME" MUST MEAN ONE FUNCTION, NOT ONE TIER**: `claude_free_now` took
   the 5-hour window from the CLOCK, the trigger's `claude_window_loads` from the
   booking chain — the rail offered 100% where the guard refused over 25% (0161).
   Also a GUARD vs the DERIVED STATE it checks: `claude_booking_guard` checked a
   new booking against sessions derived from the OTHER rows, and that derivation
   is greedy in start order, so an earlier insert re-derived everyone and
   nothing re-checked them (0159). **Tell: the same rows legal or illegal
   depending on TYPING ORDER.** Re-derive WITH the candidate in it.
   Also a SELECTOR vs the MARKUP, in BOTH directions: a descendant selector
   styles content not written yet (`.list b` made every inline bold a heading),
   a child combinator stops matching after a refactor. CSS fails SILENTLY, so a
   rule that stops matching looks like a feature nobody built. The instrument is
   the COMPUTED style, never the stylesheet — and for a PAINT or OVERLAP bug,
   the PAINTED BOXES. Also TWO PASSES over one DOM property, and one listener
   per re-render (`docs/mistakes/frontend-ui.md`): touch only what THIS pass set,
   keep state in a variable and listeners on the nodes this paint made.
7. **Verify from the authority, and test BOTH directions.** Read the ACL from
   `pg_proc.proacl`, not the `revoke` you just wrote; grep the SERVED bundle,
   not the local file; read the LIVE function body, not the migration that first
   defined it.

   Every DELETE needs `return=representation` + a `data.length` check — RLS
   returns zero rows, not an error (`delete-guard.test.js`).

   **Guards fail GREEN — `skills/write-a-guard.md`.** Two quantities in one
   SUBTRACTION must share an INSTANT (0156/0158).
   **A guard's INSTRUMENT needs a guard too**: four tests hand-rolled one
   block-comment regex and `'image/*'` opened a "comment" that blanked 13,839
   chars before any assertion ran (one shared `strip-comments.js` now).
   Also: **never measure a container to size the content that sizes it**
   (`overflow:auto`+`max-height` makes `clientHeight` an OUTPUT; tell — it fixes
   itself if you toggle twice), and **a button label is only unambiguous next to
   the OTHER buttons** — read the rendered dialog.
   The five ways, each paid for here: it cannot SEE the hazard (0146) · its
   CONTROL finds nothing either (0147) · it is satisfied by PROSE
   (`confirm-modal.test.js` matched a *comment*) · its SUBJECT is a hardcoded
   name that rotted (`proj0092`, `house0116`) · it ERRORS rather than fails, and an
   aborted script is silence (`house0116`: ZERO assertions for 23 migrations —
   when a migration drops a function or column, grep `tools/` in that commit). **The ritual that catches all five: reintroduce the bug,
   watch it fail on the assertion you expect, restore.** Never write a guard
   from the SAME LIST the code came from — assert the PROPERTY that list was
   meant to produce, or a wrong list passes itself.

   Pair every DENY with an ALLOW over the same rows — a table with policies but
   no GRANT denies everyone and reads exactly like the policy working (0138),
   and a deny-only probe cannot tell a working guard from a broken service.
   **Check the PROBE SUBJECT**, and derive it from the gate's own predicate:
   `current_user_has_permission()` reads the UNION of `permissions` AND
   `managed_permissions` (0081), so `permissions='{}'` may still hold `master`.
   **Check the INSTRUMENT can see it**: minified builds rename module-scope
   `let`s (grep a STRING LITERAL or CSS class), code often lands in a SHARED
   chunk both entries import (0145), `curl -L` turns a GAS `/exec` POST into a
   GET. **Re-read a rule's stated JUSTIFICATION, not just its predicate** —
   `users_read_all` carried "needed for staff dashboards" in a comment, the need
   had ended years earlier, and the policy outlived its reason (0147).

---

## Adding an entry

Write it in the matching `docs/mistakes/*.md` as **Symptom → Cause → Fix → Where
it lives now**, ending with the general rule and LEADING with the symptom as it
was reported — that is what the next reader greps for. Run
`npm run mistakes:index` (never hand-edit the index; if a line reads badly, fix
the heading). If it is a new instance of one of the seven classes, add the site
to that class above.

**This file is charged to every session and the index only grows.** When
`npm run check:context` fails, compress the classes or move detail into
`docs/mistakes/` — never raise the budget.

---

## Index — every entry, by area

<!-- BEGIN GENERATED INDEX — npm run mistakes:index -->

### `supabase-client.md` — supabase-js, PostgREST & the session lifecycle *(17)*
- Supabase Realtime in this app: token goes stale + RLS-gated events silently vanish (autoRefreshToken is OFF), and re-re…
- supabase-js `onAuthStateChange` deadlocks every subsequent call
- supabase-js autoRefreshToken can stall, blocking subsequent requests
- supabase-js silent-success on RLS-blocked updates / deletes
- supabase-js gets into a bad state — bypass with `dbRest()`
- Android Chrome surfaces the supabase-js "bad state" hang on the FIRST call
- `onAuthChange` fires on every refresh
- PostgREST 400s on unknown URL query params
- `PGRST303 JWT expired` mid-modal when the 25-min proactive refresh misses
- Synchronous first `onAuthChange` fire flashes the sign-in gate before the session is restored (looks like "logged out o…
- Hardcoded reserved-username lists rot when new staff accounts are added
- Synthetic email domain must be a real public TLD
- Email confirmation must be OFF in Supabase for synthetic emails
- Supabase `unlinkIdentity` requires ≥2 identities
- supabase-js `updateUser({password})` doesn't create an `email` identity
- Account-switcher: capturing the OUTGOING session's tokens fire-and-forget races the session swap → first switch-back fo…
- (Passport repo) Forcing Google OAuth `hd=<workspace-domain>` redirects to the domain's SAML IdP

### `authz-rls.md` — RLS policies, SECURITY DEFINER & read paths *(27)*
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
- The row-level-UPDATE-without-a-column-guard class, found on a THIRD table
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
- Every signed-in account could read all 531 rows of `public.users`
- "someone could just book 16.40-20.00 kick me out"

### `authz-grants.md` — The permission / seat / scope channel *(12)*
- Adding a permission-based access channel leaves every ROLE-ONLY gate as a latent block
- "โมนา got pr permission in teamsamo but she can't delete pr ticket"
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

### `postgres-schema.md` — Migrations, DDL, triggers & constraints *(21)*
- Postgres has no `create or replace policy`
- A self-update column guard silently bricks EVERY new signup when it blocks a column another trigger legitimately writes
- Service-role seed can't UPDATE `role`/`permissions`
- `create or replace function` CANNOT change the return type
- A `NOT NULL` column with `ON DELETE SET NULL` is a latent contradiction
- Recreating a function from the migration that FIRST defined it silently reverts every later one
- Hard-deleting a row referenced by an `ON DELETE RESTRICT` FK fails 23503
- Check constraint must be dropped BEFORE updating to a new enum value
- (Passport) An `AFTER INSERT`-on-`auth.users` re-key trigger only fires for accounts that have NEVER logged into the pro…
- A PL/pgSQL `RETURNS TABLE(... col ...)` function silently ignores `ORDER BY col`
- A self-update column guard must exempt the definer FUNCTION that writes on login
- A UNIQUE EXPRESSION index cannot serve `ON CONFLICT (col)`
- Seeding an OBSERVED range as if it were reference data
- Applying "create the parent on demand" at ONE call site instead of on the table
- "เปลี่ยนรหัสนักศึกษาเป็น 59… หรือ 64… แล้วรุ่นไม่เปลี่ยนตาม"
- A bidirectional mirror without an `is distinct from` guard is an infinite recursion
- "เปลี่ยนชื่อเล่นในทีม SAMO แล้วระบบบ้านไม่เปลี่ยน"
- "when i change ชั้นปี in the main web, nothing happens"
- "why 18 august has rail show green 100% shouldn't it be 10%"
- "i can even book at 06.00 which shouldn't be"
- "it shouldnt show the rail as 100% in that 25%"

### `frontend-ui.md` — Bootstrap, CSS, DOM & the browser *(72)*
- Ticket renderers interpolate user-text into innerHTML → XSS
- A module shared across two shells carries shell-specific assumptions that silently break in the other shell
- An anon-INSERTable table's text columns are ATTACKER-controlled
- Re-opening an ALREADY-OPEN Bootstrap modal with `new bootstrap.Modal(...).show()` stacks a second backdrop
- A destructive-direction toggle without a confirm silently dropped a privacy guard (vs_categories.personal flipped to pu…
- A modal that closes on save makes every edit a round trip
- A manager modal opened ON TOP of a form must repaint that form's inputs
- Attribute-driven visibility: check that EVERY value in the markup has a handler, and which way an unhandled one fails
- A directional action whose direction lives ONLY in a label on the other party's row gets read backwards
- `touch-action: none` on a drag handle makes the page unscrollable THERE
- A partial left behind by a restructure is a DECOY
- A shared `render()` that repaints a pane another module owns will destroy that module's in-progress input
- A `busy` flag that RETURNS EARLY silently discards the second action
- A Bootstrap icon name from a LATER release renders as nothing
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
- An indicator that links to a LIST moves the work instead of removing it
- State parked on a REUSED DOM element outlives the record it describes
- Uploading a replacement photo on PICK leaves the previous file in Drive forever
- A filled "danger" style made an UNCHECKED checkbox look ticked
- A second pass over the same controls silently UNLOCKED the checkbox the first pass had locked
- "ลบสมาชิกไม่ได้" — the delete button did nothing at all, and BOTH ways it can do nothing were silent
- "แก้ไขข้อมูล ของระบบบ้าน — ต้องกดหลายครั้งถึงจะขึ้น" — one listener per re-render + a toggle reading its own state
- A chooser that opens as an empty placeholder while its vocabulary loads SUBMITS the empty value
- "ปฏิเสธ ไม่ทำงาน แต่อนุมัติทำงาน" — the same suppressed-dialog bug, on a different button
- "แก้ไขสมาชิก shows ชื่อ นามสกุล as blank, that isn't good"
- Adding an `await` before the modal closes re-opened a double-submit window
- "เพิ่มสมาชิก ไม่ทำงาน" + "ค้นหาคนจากระบบ ไม่ขึ้นรายชื่อ"
- The ลบ button on a สาขา row rendered OUTSIDE the modal on a phone
- `confirm()` on a SAVE path, not just a delete
- `/admin/#vs` opened the VitalSound workspace for an admin with no VitalSound grant
- `{"code":"23505" … "students_kkumail_key"}` in an alert()
- "แก้ไขสมาชิก … ค้นหาคนจากระบบ … พู่กัน picture become myself"
- The ยกเลิก button in `askConfirm` did nothing
- A VIEW is not a BREAKPOINT — scoping a layout to `@media` and then making it user-selectable
- A markup refactor silently unhooked every `> .org-station` selector
- `justify-content: center` makes the overflow of a scroll container UNREACHABLE
- `flex-wrap` does nothing inside `width: max-content`
- "เข้าสู่ระบบด้วย Google" read as KKU-only
- "เข้าสู่ระบบด้วย Google ... it also gmail.com email etc."
- "when i zoom, it renders some different view then switches back"
- A blank canvas is not a diagnosis — the graph had flown past the far plane
- "the picture render wrong ... zoom also bug"
- "the picture on ipad still bug" — `position` in `<foreignObject>` drops the transform
- A DEPTH NUMBER cannot name a level of a ragged tree
- "It shows 4 lines to อุปนายก, ฝ่าย PR, ComArt, IT"
- "ฝ่ายวิชาการ inside ฝ่ายรังสีเทคนิค shows different color"
- แผนผัง became a staircase — one structure, two different drawings
- จองโควตา Claude rendered unstyled — CSS in the wrong ENTRY
- "on ipad, when touch, it mess up between scroll and adding the booking"
- "in the next week it shows ยังไม่มีตำแหน่งในผังทีม"
- "the rails it got overlap with the booking making it look weird"
- "why there's 50% rails in the period that has people book"
- "พอดีจอ" collapsed the calendar to its minimum row height
- An inline `<b>` rendered as a second heading
- A confirm dialog offered two buttons that both began with "ยกเลิก"
- "i see something weird in the box booking behind" + "10:00100%"
- A tag positioned where the thing it describes always covers it
- "it shows only 16.00 not 16.00-21:00"
- The 5-hour frame described the window; people were asking what they could put in it
- "ใช้จริง" drew the gauge reading instead of the usage
- "why does it show color weird" / "i still see rail weird"

### `app-state.md` — Routing, read-state, caches & serialization *(16)*
- "Unread" highlight inside an item vanishes the moment you open it
- Per-user read-state means a newly-granted account INHERITS the whole backlog as unread
- Migrating a SHARED workflow account to a personal one moves the AUTHORIZATION but leaves every uid-bound row behind
- Module-scope caches make an in-place account switch show two accounts at once
- A path-only router silently discards sub-state
- A snapshot table that COPIES a foreign resource id makes the original's delete path destroy history
- An allow-list feeding a BACKUP has the opposite safe default from one feeding a public projection
- A scroll-to-top fix applied in the tab handler misses every link that navigates programmatically
- An upsert that sends EVERY column wipes the ones the file did not have
- An export that carries a GENERATED column re-imports as the real one
- Stripping a คำนำหน้า off a name renames the people whose name STARTS with one
- "แก้ชื่อในหน้าตัวเอง แล้วชื่อ-นามสกุลในระบบบ้านสลับกัน"
- "this person is the same person but it detects wrong because no email"
- The checkout form kept the PREVIOUS account's email after an in-place account switch
- An INSERT is a write path too — the import guard covered UPDATE only
- "in next next week, it still show ใช้ไปแล้วจริง value, which it would be reset by then"

### `integrations.md` — Notifications, Apps Script & Google Drive *(22)*
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
- A refcount is only as true as its list of referrers
- "เปลี่ยนรูป เปลี่ยนรูปแล้ว แต่ในไดรฟ์ยังมีรูปเก่าอยู่"
- "ลบรูปใน Drive แล้ว แต่เว็บยังขึ้นรูปเดิม"
- `uploadPRFile` had no counterpart, so every announcement cover ever re-cropped is still in Drive
- The crest refcount could not see the crest

### `deploy-hosting.md` — Deploy, nginx & caching *(7)*
- `rsync --delete` on deploy yanks the previous build's chunks out from under OPEN tabs
- A deploy script that `git pull`s ITSELF and keeps running will execute a garbage fragment
- "Login is still there so the cache must be cleared"
- CI `npm test` fails on Node 20 — supabase-js throws "Node.js 20 detected without native WebSocket support" at import
- nginx subpath app: bare `/passport` (no trailing slash) silently serves the wrong SPA
- nginx without an `$uri.html` fallback breaks EXTENSIONLESS deep links that a retired Cloudflare-Pages host used to serv…
- Dropping a column while the SERVED bundle still names it

### `tooling-proofs.md` — Proof scripts & verification discipline *(12)*
- Two implementations of one rule drift silently
- Debugging note: `tools/db-query.mjs` COMMITS
- RLS does not RAISE on UPDATE/DELETE — a proof that asks "did it throw?" scores a fully-blocked write as permitted
- A proof script that fails for a CORRECT reason gets ignored
- `pg_get_functiondef` over every function 42809s on aggregates
- A proof failed for a CORRECT reason because its subject was hardcoded
- Four guards were reading a MANGLED file
- A proof whose subject was a SHOP ADMIN reported that a buyer could set an order total to ฿1
- Checking the proofs by hand produced TWO false alarms in a row
- A proof that ERRORS is not a proof that fails
- A browser probe measured its coordinates before the page scrolled
- A comment listed four boundaries and the code had three

<!-- END GENERATED INDEX -->
