# Mistakes — every entry, by area

**GENERATED — do not hand-edit.** `npm run mistakes:index` rewrites this from
the `##` headings in the files beside it. If a line here reads badly, fix the
HEADING in the write-up, not this file.

Scan for a line resembling your symptom, then open that file. Usually faster:
`grep -rin "<phrase>" docs/mistakes/` — it searches the write-ups themselves,
not just their titles. Read near-matches; most of these recurred elsewhere in
different clothes.

The recurring CLASSES — the part that generalises to code not yet written —
are in `.claude/rules/mistakes.md`, which every session already has.

## `supabase-client.md` — supabase-js, PostgREST & the session lifecycle *(18)*

Open when: auth.js · db.js · anything calling supabase-js.

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
- "when i login in the preview, i got {"code":400,…"Unsupported provider: provider is not enabled"}"

## `authz-rls.md` — RLS policies, SECURITY DEFINER & read paths *(27)*

Open when: any policy, `current_user_*` helper, or definer RPC.

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

## `authz-grants.md` — The permission / seat / scope channel *(14)*

Open when: adding an access channel, a scope, or a seat.

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
- `master` opened the tab but not the ROLE-gated controls inside it
- "when i select permission as master, i cant select sub of the หนังสือโครงการ"

## `postgres-schema.md` — Migrations, DDL, triggers & constraints *(24)*

Open when: writing a migration.

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
- 11 students' passport totals were higher than their own scans, and nothing could ever subtract
- "144 students cannot sign in" — a false alarm from reading the function instead of the trigger list
- A carried passport student would have signed in to 0 km

## `frontend-ui.md` — Bootstrap, CSS, DOM & the browser *(82)*

Open when: markup, modals, layout, touch, icons.

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
- "ย้ายปีงบ แล้วโครงการหายไปเลย" — a follow-the-row fix that only fired half the time
- Adding one cell to a flex row collapsed the project name to one character per line
- "it doesn't care about ระดับ that i config in the admin teamsamo"
- `hidden` did nothing, and only Bootstrap's CDN stylesheet was hiding it
- A CSS block lifted out of a deleted commit came back with three rules silently commented out
- "i press สร้างบัญชีและเข้าสู่ระบบด้วย google and button do nothing … but on google app it works"
- "even i press the โหลดใหม่ … it still show it"
- A SyntaxError blamed on the DOCUMENT, in a page whose own scripts all parse
- A second markup site for the same navigation had no handler, so it full-reloaded
- The สถิติ quota panels had 29 tests and had never been LOOKED at

## `app-state.md` — Routing, read-state, caches & serialization *(20)*

Open when: URL state, per-user "seen", import/export.

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
- "I'm looking from เจ้าหน้าที่คณะ and I don't see file highlighting anymore"
- A DELIBERATE omission in the account purge cost 42 of 43 comments their edit button
- "why does the week still say 61% used when nothing has measured it for four days"
- A trailing slash matched no route and landed on the home tab, silently

## `integrations.md` — Notifications, Apps Script & Google Drive *(27)*

Open when: notify, GAS handlers, Drive URLs.

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
- The Discord alert told a human to run the command that CAUSED the error
- Removing `@here` from two builders left three ways to put it back
- A preview deployment could post into the real ฝ่าย Discord channel
- A test notification read as a real incident, because every builder hardcodes its own alarm
- The dev database emailed a REAL staff member, because it is an exact copy of production

## `deploy-hosting.md` — Deploy, nginx & caching *(11)*

Open when: deploy.sh, nginx, cache headers.

- `rsync --delete` on deploy yanks the previous build's chunks out from under OPEN tabs
- A deploy script that `git pull`s ITSELF and keeps running will execute a garbage fragment
- "Login is still there so the cache must be cleared"
- CI `npm test` fails on Node 20 — supabase-js throws "Node.js 20 detected without native WebSocket support" at import
- nginx subpath app: bare `/passport` (no trailing slash) silently serves the wrong SPA
- nginx without an `$uri.html` fallback breaks EXTENSIONLESS deep links that a retired Cloudflare-Pages host used to serv…
- Dropping a column while the SERVED bundle still names it
- `systemctl enable --now` reported success and scheduled nothing
- "I grepped the served bundle for the string I just changed and it is not there
- "There is no preview deploy" — the contributor guide denied a pipeline that had been running for weeks
- GitHub was silently DELETING words out of the docs, and nothing could tell us until we rendered them somewhere strict

## `tooling-proofs.md` — Proof scripts & verification discipline *(29)*

Open when: writing or trusting a `tools/*.mjs` proof.

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
- A control threshold that assumed the proof runs early in the quota week
- Two proofs ERRORED for six days because their scenario needed a week with room left in it
- `open(p, "w")` truncates before the `read()` you passed to it
- A proof went red fifteen minutes after the app started working again
- STATE.md said a proof was red that had been green for a day
- `which pg_dump` said it was not installed, and it had been installed all along
- A `pg_dump` restore made the copy MORE permissive than the original
- A refresh script printed "identical to production" while refreshing nothing
- `npm test | grep` returned success while the suite was failing
- `urllib` got 403 from Discord and I reported the service as DOWN
- The verification command in STATE.md named a sha two deploys behind
- "The VM can't do mail" — one probe answered a narrower question than the sentence it was written into
- A dashboard was about to report 83% of a quota that was really at 7%
- Impersonating a user through the Management API works for one statement and silently stops working at the next
- `npm run proofs` against dev ran two proofs against PRODUCTION and printed one green summary
- `main`'s CI was red for a day because a guard could not see the commit it was checking
- A CI gate whose red depended on jsDelivr, and two tests that passed over deleted code

_252 entries across 9 files._
