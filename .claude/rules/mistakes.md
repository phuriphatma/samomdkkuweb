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
   audience lookup still leaking. Enumerate the paths. Non-security twin: a fix
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
   `team/fields.js`.
7. **Verify from the authority, and test BOTH directions.** A sweep returning
   NOTHING is not evidence of nothing — make it find something you know is there
   first (`pg_get_functiondef` needs `prokind='f'`; policy bodies render
   `'team'::text`, so the recipe in 0110's comments matched zero of twelve).
    Read the ACL from
   `pg_proc.proacl`, not from the `revoke` you just wrote; grep the SERVED
   bundle, not the local file; read the LIVE function body, not the migration
   that first defined it. And a probe that can only report "denied" cannot
   distinguish a working guard from a broken service — always exercise the
   allow path too.

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
*Open when:* any policy, `current_user_*` helper, or definer RPC. *(20 entries)*

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
*Open when:* writing a migration. *(11 entries)*

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

### `docs/mistakes/frontend-ui.md` — Bootstrap, CSS, DOM & the browser
*Open when:* markup, modals, layout, touch, icons. *(30 entries)*

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

### `docs/mistakes/app-state.md` — Routing, read-state, caches & serialization
*Open when:* URL state, per-user "seen", import/export. *(8 entries)*

- "Unread" highlight inside an item vanishes the moment you open it — mark seen AFTER capturing seenAt for the open view
- Per-user read-state means a newly-granted account INHERITS the whole backlog as unread
- Migrating a SHARED workflow account to a personal one moves the AUTHORIZATION but leaves every uid-bound row behind
- Module-scope caches make an in-place account switch show two accounts at once
- A path-only router silently discards sub-state — and its own tab handler is what clears the hash you just wrote
- A snapshot table that COPIES a foreign resource id makes the original's delete path destroy history
- An allow-list feeding a BACKUP has the opposite safe default from one feeding a public projection
- A scroll-to-top fix applied in the tab handler misses every link that navigates programmatically

### `docs/mistakes/integrations.md` — Notifications, Apps Script & Google Drive
*Open when:* notify, GAS handlers, Drive URLs. *(16 entries)*

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

### `docs/mistakes/deploy-hosting.md` — Deploy, nginx & caching
*Open when:* deploy.sh, nginx, cache headers. *(6 entries)*

- `rsync --delete` on deploy yanks the previous build's chunks out from under OPEN tabs
- A deploy script that `git pull`s ITSELF and keeps running will execute a garbage fragment
- "Login is still there so the cache must be cleared" — localStorage and the HTTP cache are different buckets
- CI `npm test` fails on Node 20 — supabase-js throws "Node.js 20 detected without native WebSocket support" at import
- nginx subpath app: bare `/passport` (no trailing slash) silently serves the wrong SPA
- nginx without an `$uri.html` fallback breaks EXTENSIONLESS deep links that a retired Cloudflare-Pages host used to serv…

### `docs/mistakes/tooling-proofs.md` — Proof scripts & verification discipline
*Open when:* writing or trusting a `tools/*.mjs` proof. *(5 entries)*

- Two implementations of one rule drift silently — diff them, don't eyeball them
- Debugging note: `tools/db-query.mjs` COMMITS — a probe with `limit 1` and no `ORDER BY` will mutate a real row
- RLS does not RAISE on UPDATE/DELETE — a proof that asks "did it throw?" scores a fully-blocked write as permitted
- A proof script that fails for a CORRECT reason gets ignored — then it protects nothing
- `pg_get_functiondef` over every function 42809s on aggregates

<!-- END GENERATED INDEX -->
