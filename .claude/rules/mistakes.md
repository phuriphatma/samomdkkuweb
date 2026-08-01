# Mistakes log — hard-learned bugs

Read this BEFORE touching:
- `src/js/auth.js`
- `src/js/db.js`
- Anything that calls supabase-js
- Any RLS policy or `current_user_*` helper — the grant-channel entries below
  (0089→0093) are the most-repeated bug class in this repo

Each entry: **Symptom → Cause → Fix → Where it lives now**.

**Five classes account for most of what has bitten this repo twice or more.** If
you are short on time, read these and skip the rest:
1. **A per-row UPDATE policy is not a column policy** — `for update using (<col>
   = auth.uid())` grants every column in the row. Found on `users` (0028),
   `vs_tickets` (0096), `shop_orders` (0100).
2. **An unresolvable reference fails OPEN** — `coalesce(flag, false)`, a
   `left join`, `if not found then`, and `null in (...)` all say "allowed" for
   an id that no longer resolves.
3. **Scoped is not full** — a narrower RLS branch added beside an unconditional
   one (`has_permission('x')`, `using (true)`, a role list) is decorative,
   because permissive policies are OR'd.
4. **Read authorization is per-PATH, not per-table** — sanitizing one reader
   (a definer RPC) leaves `select=*`, the other RPC, and the audience lookup
   leaking. A new access channel must be threaded through writes, reads AND
   directory lookups.
5. **Two implementations of one rule drift** — SQL↔JS mirrors, a read path and a
   write path, a guard and its call sites. Write the differential test in the
   same commit.

> Stable, niche fixes that no longer need to live in the hot path have been
> moved to `.claude/rules/mistakes-archive.md` (kept to hold this file under
> the context-budget limit). **Check the archive if a symptom isn't found here** —
> what's over there, by area:
>
> - *auth / signup config* — synthetic email TLD must be public · "Confirm email"
>   must stay OFF · `unlinkIdentity` needs ≥2 identities ·
>   `updateUser({password})` creates no `email` identity · hardcoded
>   reserved-username lists rot · account-switcher token-capture race
> - *forms & Bootstrap UI* — `form.reset()` clears hidden inputs (and still
>   holds the old `File`) · HTML5 `required` on a hidden field blocks submit
>   silently · iOS `100vh` drawer · full-height centered page unscrollable ·
>   tab-JS keeps the dropdown open · offcanvas + `data-bs-toggle="pill"` race ·
>   a `data-role` element with no toggle · a dark-mode island in a light-only app ·
>   **stacked modals all share z-index 1055 so DOM order decides what paints on
>   top** · **a class in the markup with no CSS rule anywhere** · **an indicator
>   that links to a list without carrying WHICH row**
> - *refactors* — pane-scoped `#id`-rooted selectors break when the shell that
>   provided the id is rewritten
> - *SQL one-offs* — drop a CHECK before UPDATEing to a new enum value ·
>   `RETURNS TABLE` OUT-param shadows `ORDER BY`
> - *notify (GAS era + config)* — `notify_*_in_app` flags silently off ·
>   awaiting the Discord queue blocks the re-render · `sendBeacon` won't follow
>   redirects · GAS logs empty for browser-fetch calls · Cloudflare 1015 ·
>   concurrent click handlers hit the per-webhook limit
> - *hosting / assets* — nginx bare-subpath and `$uri.html` fallbacks ·
>   Drive `thumbnail?id=` blanks on iOS · localStorage vs the HTTP cache ·
>   CI Node 20 + supabase-js WebSocket · FK `ON DELETE RESTRICT` → archive
> - *passport repo* — OAuth `hd=` hits the SAML IdP · the re-key trigger only
>   fires on an account's first-ever login

---

## Supabase Realtime in this app: token goes stale + RLS-gated events silently vanish (autoRefreshToken is OFF), and re-rendering on a remote event cancels an in-flight drag

**Symptom**: A live-collaboration feature (SAMO Team org tree) works for the
first ~hour, then remote edits stop arriving for long-lived tabs — no error.
Separately, while a user is mid-drag (SortableJS), a remote change repaints the
tree and the drag gesture dies.
**Cause**: Two coupled gotchas.
1. `src/js/db.js` creates the supabase-js client with `autoRefreshToken: false`
   (deliberate — see the autoRefresh-stall entry). The Realtime websocket
   authenticates with whatever JWT it had at `subscribe()` time and does NOT
   refresh it. After the ~1h TTL, reconnects present a stale token; Realtime
   re-checks RLS per subscriber, so `postgres_changes` events the user is no
   longer authorized for (stale token → null role) are silently dropped.
2. A full re-render (`innerHTML` rebuild) triggered by an incoming Realtime
   event while SortableJS is mid-gesture removes the dragged node from the DOM,
   cancelling the drag.
**Fix**:
- Re-push the token on an interval: `setInterval(() => db.realtime.setAuth(
  currentAccessToken()), 20*60*1000)` (and once before subscribe). Export
  `currentAccessToken()` from `db.js`. dbRest already keeps the stored token
  fresh on writes, so this just forwards it to the socket.
- Guard renders: set a `dragging` flag on SortableJS `onStart`, clear it at the
  top of `onEnd`; remote-change handler buffers (`pendingRender`) instead of
  rendering while `dragging`, and debounces bursts (~120ms).
- Also normalize realtime row payloads: a Postgres `text[]` column can arrive
  as the array LITERAL string `"{pr,vs}"` (not a JS array) on some realtime
  versions — coerce before use.
**Where**: `src/js/team/realtime.js` (`setAuth` interval),
`src/js/team/index.js` (`dragging`/`pendingRender`/`scheduleRemoteRender`,
`normalizeNodeRow`), `src/js/db.js` (`export function currentAccessToken`).
Realtime needs the table in the `supabase_realtime` publication +
`replica identity full` (migration 0048) or events never fire at all. Apply the
same pattern to any future Realtime subscription in this app.

---

## supabase-js `onAuthStateChange` deadlocks every subsequent call

**Symptom**: After signing in, the next ~1 supabase call works. The one after
that hangs forever. User refresh fixes it. Repeats every login.
**Cause**: Known supabase-js bug (auth-js #762, ~2yr old). Any **async call to
supabase** inside the `onAuthStateChange` callback acquires the GoTrue session
lock and never releases it from the next caller's perspective. Subsequent
supabase calls queue forever.
**Fix**: Wrap the work in `setTimeout(() => { ... }, 0)` so it runs on the
next macrotask, after the auth callback has released its lock.
**Where**: `src/js/auth.js` `initAuth()`. **Do not remove the setTimeout.**

```js
db.auth.onAuthStateChange((_event, session) => {
  setTimeout(async () => {
    currentUser = await buildCurrentUser(session);  // ← this is a supabase call
    notify();
  }, 0);
});
```

Reference: <https://github.com/supabase/auth-js/issues/762>

---

## supabase-js autoRefreshToken can stall, blocking subsequent requests

**Symptom**: Second form submit hangs 30s, times out. Reproduces ~hourly
(token TTL).
**Cause**: When the JWT nears expiry, supabase-js fires an inline refresh
before the next request. If that refresh stalls (network blip, Supabase
slowness), every queued request waits.
**Fix**: Disable `autoRefreshToken` in the client config and call
`db.auth.refreshSession()` on a 25-min `setInterval` instead.
**Where**: `src/js/db.js`.

```js
createClient(url, anon, {
  auth: {
    persistSession: true,
    autoRefreshToken: false,   // ← do not re-enable
    detectSessionInUrl: true,
  },
});
setInterval(() => db.auth.refreshSession().catch(...), 25 * 60 * 1000);
```

---

## Ticket renderers interpolate user-text into innerHTML → XSS

**Symptom**: A guest who submits a PR/VS ticket with `<img src=x onerror=alert(1)>`
in any free-text field (brief, caption, rushReason, otherPlatformReason,
contentName, contact, problem, remark, …) pops scripts at every staff
viewer of that ticket.
**Cause**: Renderers like `renderPRDashboard`, `renderPRHistoryList`,
`renderUserHistoryList`, `renderTimeline`, the VS staff kanban, and
`renderManageAgentsList` build their HTML with template literals and
`insertAdjacentHTML` / `innerHTML`. Any user-text field interpolated
raw is an XSS hole.
**Fix**: Use `escHtml` from `utils.js` for any text field. Use `safeUrl`
for any URL going into an `href` attribute (blocks `javascript:`,
`data:`, attribute-injection payloads). The only string that may go
through innerHTML *raw* is Quill-produced rich text (announcement
content + VS problem field) — both are explicitly trusted.
**Where**: applied in `src/js/pr-tracking.js`, `pr-staff.js`,
`vs-tracking.js`, `vs-staff.js`, `utils.js renderTimeline`,
`announcements.js`. Don't add a new renderer without an `escHtml`
audit.

---

## supabase-js silent-success on RLS-blocked updates / deletes

**Symptom**: User clicks "Update announcement" → success message → opens the
announcement → old content. Update silently did nothing. Same shape for
staff status updates, ticket deletes, agent roster saves, user dept set.
**Cause**: `db.from().update().eq(...)` and `.delete().eq(...)` return
`{ data: null, error: null }` when zero rows are touched (RLS blocks, id
mismatch). No error to catch.
**Fix**: Use `dbRest()` from `db.js` with `prefer: 'return=representation'`
and check `data.length`. If 0, throw a real error.
**Where it lives now**: every write that matters is on dbRest —
- `src/js/announcements.js` `publishAnnouncement()`
- `src/js/pr-staff.js` `submitPRStaffAction()` / `deletePRStaffAction()` / `saveGlobalAgents()`
- `src/js/vs-staff.js` `submitStaffAction()`
- `src/js/vs-tracking.js` `submitUserRemark()`
- `src/js/auth.js` `setDepartment()`

**Don't bring back `db.from().update/delete` for any write that matters.**
If a new write site appears, use `dbRest()` and verify `data.length > 0`.

---

## supabase-js gets into a bad state — bypass with `dbRest()`

**Symptom**: After one supabase-js call succeeds, the next one hangs. Even
selects, even on different tables. autoRefresh disabled, deadlock workaround
in place, still hangs.
**Cause**: Unidentified residual state in the supabase-js client.
**Fix**: For any call that has to be reliable, use the `dbRest()` helper in
`src/js/db.js` — it's raw fetch + AbortController against PostgREST, with the
same auth headers supabase-js would send.
**Where**: Use `dbRest('/table?...', { method, body, prefer })` everywhere
that previously hung. PR tracking and announcements use it now.

---

## RLS inline subqueries silently depend on the referenced table's RLS

**Symptom**: Per-dept VP gate stops returning rows after someone tightens
an unrelated RLS policy on `public.users` (e.g. restricting `users_read_all`
to self-row only). No error — the dashboard just goes blank for VPs.
**Cause**: Policies like `vs_tickets_read` (0010), `vs_tickets_update_staff`
(0013), `vs_tickets_delete_staff` (0015) used
`target_dept = (select department from public.users where id = auth.uid())`
inline. That subquery runs under the *caller's* RLS, not as `security definer`.
It worked only because `users_read_all` (0001) was wide-open. The coupling
is invisible from the policy body.
**Fix**: For any cross-table lookup used in an RLS predicate, wrap it in a
helper function with `language sql stable security definer set search_path = public`
and `grant execute … to anon, authenticated`. Same pattern as the existing
`current_user_role()` / `current_user_has_permission()` helpers. The dept
lookup is now `public.current_user_dept()` (migration 0016).
**Where**: `current_user_dept()` defined in `0016_current_user_dept_helper.sql`;
all three `vs_tickets` policies repointed there. Don't reintroduce inline
`(select … from public.users where id = auth.uid())` in any new policy.

---

## Android Chrome surfaces the supabase-js "bad state" hang on the FIRST call

**Symptom**: User on Android Chrome types username + password, taps
"เข้าสู่ระบบ", spinner shows "กำลังตรวจสอบ", then quietly returns to
the original button text with no error and no closed modal. iPad /
desktop / iOS Safari all work fine with the same credentials.
**Cause**: Android Chrome triggers the same supabase-js bad-state bug
documented above, but earlier in the session than other browsers —
specifically on the first `db.from('users').select(...).eq(...)`
inside the `onAuthStateChange` callback. `db.auth.signInWithPassword`
itself resolves cleanly (so `samoPasswordSignIn`'s `finally` runs and
the button text resets), but the post-login profile fetch hangs and
`currentUser` is never populated → the auth subscriber never closes
the modal → user looks signed-out. Same pattern affects
`trackWithTicketId` / `loginToViewHistory` on Android Chrome.
**Fix**: Convert `buildCurrentUser()` in `auth.js` to use `dbRest()` for
the `public.users` row fetch. Apply the same pattern to any read on
the post-auth path.
**Where**: `src/js/auth.js` `buildCurrentUser` and `src/js/vs-tracking.js`
`trackWithTicketId` + `loginToViewHistory`. If a new auth-related
fetch is added later, default it to dbRest — supabase-js's PostgREST
client is the unreliable axis here.

---

## RLS row-level policies don't gate per-column writes

**Symptom**: Any signed-in user can `PATCH /users?id=eq.<their_uid>`
with `{"role":"dev"}` and silently self-promote to dev — full admin
access. Nothing in the browser code does this; an attacker uses curl
or DevTools.
**Cause**: The 0001 RLS policy is
`for update using (id = auth.uid())`. PostgreSQL RLS is row-level
only — it gates *which rows* a caller can mutate, NOT *which columns*.
Once the row check passes, PostgREST happily writes any column the
user includes in the body.
**Fix**: A BEFORE-UPDATE trigger that compares OLD vs NEW and raises
on privileged-column changes for non-staff. Migration 0028 adds
`users_self_update_guard` for `public.users`. Pattern is reusable:
any table where the JS only writes a subset of columns but RLS
allows a per-row UPDATE needs the same kind of guard.
**Where**: `supabase/migrations/0028_users_self_update_guard.sql`,
plus `current_user_is_staff()` (broadened to all staff roles in
0005) used inside the trigger to let admin tools through. **Don't
ship a new `for update using (... = auth.uid())` policy without an
accompanying column guard if any sensitive column lives on the row.**

---

## `INSERT ... RETURNING` (a.k.a. `Prefer: return=representation`) re-applies the SELECT RLS policy to the inserted row

**Symptom**: VP-Admin sends a doc → `POST /rest/v1/project_notifications`
returns `403` with `{"code":"42501","message":"new row violates
row-level security policy for table \"project_notifications\""}`.
Browser console confirms the user is signed in (correct `sub` in JWT),
the user's role in `public.users` is `vp_admin`, the live RLS policy is
`with_check (current_user_is_project_actor())`, and calling
`/rpc/current_user_is_project_actor` with the exact same JWT returns
`true`. WITH CHECK clearly passes. INSERT still fails.
**Cause**: Postgres rule: when `INSERT ... RETURNING` (which PostgREST
emits whenever `Prefer: return=representation` is set), the row also
has to pass the SELECT policy or the entire INSERT is rolled back
with the same generic "new row violates row-level security policy"
message. Here:
- WITH CHECK on INSERT: `current_user_is_project_actor()` → ✅ vp_admin
- USING on SELECT:     `user_id = auth.uid()` → ❌ because `user_id`
  is the RECIPIENT (uni_staff), not the caller (vp_admin).
Same wording as a WITH CHECK failure, so it looks like a WITH CHECK
bug; the function returns true under impersonation/RPC and you chase
your tail.
**Fix**: Drop `prefer: 'return=representation'` on any write where
- the inserted/updated row targets a DIFFERENT user than the caller, AND
- the SELECT policy is "owner-only" (`user_id = auth.uid()` or similar).
Use `prefer: 'return=minimal'` (or omit). Callers that need to confirm
the write should check `error` only, not `data.length`. This **conflicts
with the "always check `data.length > 0`" rule** from the
silent-success entry above — that rule applies when the caller is
the *recipient* of the row (so SELECT passes naturally). When the
caller writes "on behalf of" someone else under owner-only SELECT
RLS, `return=minimal` is the only option.
**Where**: `src/js/projects/api.js` `createNotification`. Pattern to
audit on any other "write to another user's row" call site if SELECT
RLS is owner-only.

---

## `onAuthChange` fires on every refresh — "initial-routing" logic inside it must be gated by a one-shot flag

**Symptom**: User is on the admin app at, say, `#projects/PRJ-K3X7` looking
at a specific หนังสือโครงการ. They switch to another browser tab for a
few seconds, then switch back — and the app has jumped to ภาพรวม Admin
(landing). The hash has been wiped too. The user thinks "did something
crash?", but the network is fine; the UI just re-routed itself.
**Cause**: `onAuthChange(user => { ... showAdminSide(...) })` in
`src/js/admin-main.js` fires on:
1. initial subscription,
2. token refresh (every ~25 min via our setInterval, and also when the
   tab regains focus after being backgrounded — supabase-js wakes up
   and re-validates the session),
3. any other auth state change.
Inside the callback we were unconditionally running:
```js
const rawHash = location.hash.replace(/^#/, '');
showAdminSide(SECTION_META[rawHash] ? rawHash : 'landing');
```
which has two problems on each re-fire:
- `rawHash` for a deep link is `projects/PRJ-K3X7`, not `projects`, so
  `SECTION_META[rawHash]` is undefined → falls to `'landing'`.
- Even when the hash IS exactly `#projects`, `showAdminSide` overwrote
  the hash back to `#projects`, nuking any deep-link path the projects
  module had set via its own `history.replaceState`.
**Fix**:
1. Run "initial section setup" exactly once per session. A module-scope
   `let initialSectionApplied = false` flipped to true on first signed-in
   fire prevents subsequent token refreshes from re-routing the user.
2. Hash lookup uses the FIRST SEGMENT only: `rawHash.split('/')[0]` so
   deep links like `#projects/PRJ-K3X7/doc/DOC-AB2KX` resolve to the
   projects section.
3. `showAdminSide` no longer rewrites the hash when the existing hash
   already starts with `#<section>/…` — only when the section is
   genuinely different.
**Where**: `src/js/admin-main.js` — `initialSectionApplied` flag at module
scope, the `onAuthChange` block that reads `location.hash`, and the
`history.replaceState` call inside `showAdminSide`. Any new
`onAuthChange` callback that wants to do "initial routing" must use the
same one-shot pattern — never assume the callback fires only once.

---

## "Unread" highlight inside an item vanishes the moment you open it — mark seen AFTER capturing seenAt for the open view

**Symptom**: VPA writes a comment on a หนังสือ. Receiver sees the grid
"X คอมเมนต์" badge and the doc-card "อัปเดต" pill correctly. They
click the หนังสือ to read the comment → the inline comment banner
("คอมเมนต์ใหม่: …"), the "X ใหม่" thread header, and the per-row
`is-unread` highlight all FAIL to appear. The user can't see WHICH
comment is new even though they opened the doc specifically to read
it. Worse on iPad Safari normal-mode (probably timing-related)
which is why it looked like an iPad-specific bug at first.
**Cause**: The expand-click handler in `inbox.js` did
`expandedDocs.add(id); markCommentsSeen(id); render();`. The
`markCommentsSeen` writes `now` into localStorage BEFORE render runs.
Then `renderCommentBanner` and `renderCommentsList` both read
`getCommentsSeenAt(docId)` → get `now` → filter
`effectiveTs(e) > seenAt` returns nothing → no banner, no "ใหม่"
pill, no `is-unread` row. The outer grid/card highlights only "work"
because they render BEFORE expansion (different render pass).
**Fix**: Capture the **pre-expand** seenAt into a module-scope Map
(`expandedDocsSeenAt`) at the moment of expansion, then call
`markCommentsSeen` to persist "I saw it" globally. Pass the frozen
value into `renderCommentBanner(doc, role, seenAtOverride)` and
`renderCommentsList(doc, role, seenAtOverride)` so the expanded body
keeps showing what was new at expand-time. Clear the Map entry on
collapse / back-to-grid / doc delete so a re-expand without a fresh
comment shows no highlight (matches "they already read it").
**Where**: `src/js/projects/inbox.js` `toggleDocExpansion()` is the
single chokepoint; `openDocumentDetail` (deep-link), the
`projectsBackToGrid` handler, and `onDocDeleteClick` all touch
`expandedDocsSeenAt` alongside `expandedDocs`. **Pattern to reuse:
any time a "mark seen" persistence happens at the same moment the
view first shows the unread item, freeze the read-side state before
the write, and let the renderer use the frozen value while the
storage carries the new value.**

---

## PostgREST 400s on unknown URL query params — never cache-bust via `?_=…`

**Symptom**: After adding a `&_=Date.now()` cache buster to every dbRest
GET, the whole app breaks. News doesn't load, the staff-section
dropdown is empty, projects + shop both fail with
`{"code":"PGRST100","message":"failed to parse filter (1780199700877)"}`.
**Cause**: PostgREST treats every URL query parameter (except a small
reserved set — `select`, `order`, `limit`, `offset`, `on_conflict`,
`or`, `and`, `not`) as a horizontal filter of the form `column=op.value`.
A bare `?_=1780199700877` is parsed as a filter on column `_` with no
operator → 400. There is no "ignored param" escape hatch.
**Fix**: Use `cache: 'no-store'` on the fetch (modern Safari / Chromium
/ Firefox honour it) or a custom request header — never a query string.
PostgREST already sends `Cache-Control: no-store` on its responses so
the browser shouldn't disk-cache them in the first place. The bfcache
in-memory restore case has to be handled at the app level — see
`projects/index.js` `pageshow` reload.
**Where**: `src/js/db.js` `dbRest()`. Don't reintroduce a URL-param
cache buster for any PostgREST call. If the underlying problem is a
specific old browser ignoring `cache: 'no-store'`, add a request
header (e.g. `Cache-Control: no-cache`) or change the URL via a
*reserved* param such as `select=`, never invent a new one.

---

## Postgres has no `create or replace policy` — partial-replay migrations 42710 out

**Symptom**: User runs an RLS-adding migration once. Later runs the
same file again (re-applying after a tweak elsewhere, or the SQL editor
double-fires). Postgres errors:
`ERROR: 42710: policy "policy_name" for table "x" already exists`
and the script aborts BEFORE any grants / data fixes below it.
**Cause**: `create policy` has no `or replace` variant in Postgres
(through at least 16). `create table if not exists` and `create index
if not exists` ARE idempotent and lull migration authors into a false
sense of safety.
**Fix**: Wrap every `create policy` with `drop policy if exists`:
```sql
drop policy if exists "policy_name" on schema.table;
create policy "policy_name" on schema.table for select using (...);
```
Apply to every RLS policy in every new migration. The drop is a no-op
on first run; it makes the re-run case clean.
**Where**: First seen in
`supabase/migrations/0031_project_doc_views.sql`. Pattern to use in
any future migration that adds RLS policies. (Migrations 0001, 0013,
0014, etc. predate this rule — leave them; they're applied and not
re-run.)

---

## `PGRST303 JWT expired` mid-modal when the 25-min proactive refresh misses

**Symptom**: VP-Admin opens the "สร้างโครงการใหม่" modal, types the
name + description carefully for ~hour+ on iPad (or any mobile that
backgrounds the tab between thoughts), clicks "บันทึก" — get
`{"code":"PGRST303","message":"JWT expired"}` and the create fails.
Reload + immediate retry works. Reproduces only on slow-typing /
long-idle in a modal; never on quick-fire form submits.
**Cause**: `db.js` proactively refreshes the JWT on a 25-min
`setInterval`, which is well below the 1-hour Supabase TTL. But
`setInterval` is clamped or skipped entirely on backgrounded /
throttled tabs (Safari especially), so a user who opens the modal,
the tab gets backgrounded, and they come back ~1h later, the token
expired without ever getting refreshed.
**Fix**: `dbRest()` now detects `PGRST303 JWT expired` on a 401/403
response, calls `db.auth.refreshSession()` (single-flight: concurrent
expired writes share one refresh), and retries the request once. The
proactive refresh stays — this is just the safety net.
**Where**: `src/js/db.js` `dbRest()` + `refreshAccessTokenOnce()` /
`isJwtExpiredError()`. Don't add a duplicate "refresh before every
write" path elsewhere — the dbRest retry already covers it, and an
unconditional pre-write refresh would double network round-trips on
the 99% of requests that don't need it.

---

## Synchronous first `onAuthChange` fire flashes the sign-in gate before the session is restored (looks like "logged out on every refresh" on slow mobile)

**Symptom**: On a phone, signing into the admin app then refreshing
shows the sign-in screen again — the user thinks the session didn't
persist and re-enters username/password. iPad / desktop are fine with
the same account.
**Cause**: `onAuthChange(cb)` invokes `cb(currentUser)` **synchronously**
on subscribe. At that instant `initAuth()` hasn't awaited
`db.auth.getSession()` yet, so `currentUser` is `null` even for a
perfectly valid persisted session. The admin boot handler treated that
null as "signed out" and called `showAuthGate()` immediately. On a fast
connection `initAuth` resolves a few ms later and `showApp()` wins, so
the gate flash is invisible. On a slow mobile network the gate lingers
long enough that the user starts typing — and a stale/expired token that
needs a (slow) network refresh makes it worse.
**Fix**: Distinguish "we don't know yet" from "confirmed signed out".
`auth.js` exports `authReady` (a promise that resolves after the first
`getSession()` settles) and `hasPersistedSession()` (checks localStorage
for `sb-<ref>-auth-token`). The boot handler now: on a null fire, if
auth hasn't settled AND a token is persisted → stay on the boot spinner
(`return`, don't show the gate); `authReady.then()` shows the gate for
real only if the restored session turns out absent/stale. A 9s safety
timeout falls through to the gate so a wedged `getSession()` can't trap
the user on the spinner forever.
**Where**: `src/js/auth.js` (`authReady`, `hasPersistedSession`,
`markAuthReady` after the first `notify()`); `src/js/admin-main.js`
(`authSettled` flag, the null-branch boot-stay, the `authReady.then`
settle handler + fallback timer). Any future full-screen auth gate must
gate on `authReady` / `hasPersistedSession`, never on the first
synchronous `onAuthChange(null)`.

---

## A module shared across two shells carries shell-specific assumptions that silently break in the other shell

**Symptom (two faces, same root)**:
  1. Tapping a หนังสือโครงการ notification from another admin section
     (ภาพรวม / PR / Shop) does nothing — you must already be on the
     หนังสือโครงการ section for it to navigate.
  2. The public read-only customer mirror (`/projects-view`) flashes a
     "คอมเมนต์ใหม่" banner + "ใหม่" pills on every comment, even though
     the customer has no unread state.
**Cause**: `src/js/projects/*` is mounted in BOTH the public SPA and the
admin app. (1) `openProjectsTab()` switched sections via
`window.activateTab('pills-projects-tab')` — a Bootstrap pill that only
exists in the public shell; the admin shell switches sections via
`showAdminSide()`, so the jump silently no-op'd. (2) `renderCommentBanner`
/ `renderCommentsList` decided "unread" purely from `e.role !== role`;
for the synthetic `role='customer'` there is no per-user seenAt
(`getDocSeenAt` returns 0), so every comment read as new.
**Fix**: (1) `openProjectsTab()` detects the admin shell
(`document.getElementById('adminSideNav')`) and routes through
`window.openAdminSection('projects')` instead of the pill; added a
single-flight guard on `loadInitialData()` so the sidebar + jump paths
don't double-fetch. (2) Gate the comment banner + unread highlighting on
`!customerMode` in `inbox.js`.
**Where**: `src/js/projects/index.js` `openProjectsTab` + `loadInitialData`
single-flight; `src/js/projects/inbox.js` `renderCommentBanner` /
`renderCommentsList`. When reusing a module in a second shell, audit every
`activateTab` / `#bootstrap-id` / role assumption against the host shell.
**CSS flavor of the same trap (2026-07-24)**: styles for an ADMIN-only surface
(the VS staff modal's `.vs-duptree*` / `.vs-modal-section*`) were added to
`src/css/vs.css`, which only the PUBLIC entry imports (`main.css`); the admin
entry loads `src/admin.css` → the new UI shipped completely unstyled on the
admin app (looked like raw text on iPad). Before styling any component, check
WHICH html includes its partial (`grep modal-x admin/index.html index.html`)
and put the CSS in the entry that actually loads it: public-only → `vs.css`
(via `main.css`), admin-only → e.g. `vs-admin.css` (via `admin.css`), both →
a file imported by both.

---

## A self-update column guard silently bricks EVERY new signup when it blocks a column another trigger legitimately writes

**Symptom**: Brand-new Google sign-in fails. The Supabase OAuth callback
(`/auth/v1/callback?...`) 302-redirects back to the app with
`error_code=unexpected_failure` +
`error_description=Database+error+saving+new+user`. Existing users log
in fine; only first-time signups fail. The same failure bricks the
profile-modal "set password" flow. Looks like an OAuth/redirect-config
problem; it isn't.
**Cause**: Two triggers fire on user creation and they fight:
- 0027 `handle_auth_user_password_sync` (AFTER INSERT / AFTER UPDATE OF
  `encrypted_password` on `auth.users`) UPDATEs `public.users.has_password`
  to mirror "does this auth user have a password".
- 0028 `users_self_update_guard` (BEFORE UPDATE on `public.users`) RAISES
  if a non-staff caller changes a privileged column — including
  `has_password` ("server-managed").
During a GoTrue signup the sync trigger's UPDATE runs with
`auth.uid() = NULL`, so `current_user_is_staff()` is false, so the guard
takes its `has_password` branch and aborts the whole signup transaction.
The guard cannot distinguish the legitimate server-side sync trigger from
a malicious client PATCH — both execute in a non-staff context.
**How it was confirmed**: `POST /auth/v1/admin/users` (with the service
role, with OR without a password) reproduces it exactly:
`P0001 users_self_update_guard: has_password is server-managed`, HTTP 500,
no row created. The admin API fires the same triggers as a real OAuth
signup, so it's a faithful, reversible repro (delete the test user after,
or nothing is created when it fails).
**Fix**: 0041 redefines the guard so the `has_password` change is allowed
when it AGREES with the authoritative `auth.users.encrypted_password`
state (sync trigger always writes the correct mirror value → passes; a
client trying to set a contradicting value → still blocked; setting the
already-correct value → harmless no-op). All other guarded columns
(id/role/permissions/method/username-once) unchanged.
**Where**: `supabase/migrations/0041_fix_has_password_guard_blocks_signup.sql`.
**Pattern to never repeat**: before adding a `raise`-on-change column guard
keyed on `current_user_is_staff()` / `auth.uid()`, list EVERY other trigger
that writes that column. Any server-managed column written by another
trigger will be writing under a NULL `auth.uid()` during signup and will
trip the guard, taking the whole transaction down. Guard against the
*client write path*, not the *value* — gate on agreement with the source
of truth (or a transaction-local bypass flag set by the server writer),
never on the staff context alone.

---

## Soft-delete changes the operation from DELETE to UPDATE — so it silently inherits the (usually broader) UPDATE RLS, not the DELETE RLS

**Symptom**: You convert a hard `DELETE` to a soft-delete by PATCHing a
`deleted_at` column. Authorization quietly changes: users who could *update*
a row but not *delete* it can now "delete" it — e.g. the VS owner-can-update
policy (0009) would let a SUBMITTER soft-delete their own ticket via a
crafted PATCH, even though VS deletion is meant to be staff-only — and any
per-row delete rules stop applying because the row's UPDATE policy has
different `using` / `with check` predicates.
**Cause**: PostgreSQL RLS is per-operation. `pr_tickets`/`vs_tickets` had
DELETE policies (pr_staff/dev; vs_staff/dev/has('vs')/vp_admin-own-dept) that
were deliberately narrower than their UPDATE policies (which include
has('pr') (0014), an owner-can-update policy (0009), and a vp_admin policy
whose WITH CHECK is about `target_dept`, not deletion). A `PATCH deleted_at`
runs under the UPDATE policies → wrong authorization. There's also no
column guard, so an owner could set `deleted_at` on their own row via curl.
**Fix**: Don't soft-delete via a raw PATCH when the DELETE and UPDATE
policies differ. Route soft-delete through a `security definer` RPC that
re-checks the SAME predicates as the original DELETE policy, then stamps
`deleted_at`. Reads filter `deleted_at is null` in-app (a deleted row stays
visible to a direct admin query for restore); guest-lookup RPCs must add the
filter too, or a deleted ticket stays trackable by id.
**Where**: `supabase/migrations/0043_soft_delete_tickets.sql`
(+ `0044_vs_delete_any_staff.sql` relaxed VS delete to any staff/VP)
(`soft_delete_pr_ticket` / `soft_delete_vs_ticket`, + the 0021 guest RPCs
recreated with the filter); callers in `src/js/pr-staff.js` /
`src/js/vs-staff.js`. Apply the RPC pattern to any future soft-delete whose
table's DELETE policy isn't identical to its UPDATE policy.

---

## `null in (...)` makes a `raise`-on-unauthorized guard fail OPEN

**Symptom**: A SECURITY DEFINER RPC guards itself with
`if current_user_role() not in ('staff','dev') then raise ...`. A caller
whose `current_user_role()` is NULL sails straight past the guard and runs
the privileged body instead of being rejected.
**Cause**: SQL three-valued logic. `null in ('a','b')` is `NULL` (not
`false`); `not NULL` is `NULL`; and `IF NULL THEN raise` does NOT execute
the then-branch (only TRUE does). So the guard is skipped — fails OPEN —
for any null input. `current_user_role()` is null when there's no
`public.users` row for `auth.uid()` (and for the service_role JWT, whose
`auth.uid()` is null).
**Fix**: capture the value and add an explicit null check that fails CLOSED:
`if v_role is null or v_role not in (...) then raise`. For an OR of
predicates, lead with `if v_role is null or not (...) then raise` so a NULL
inside the OR can't swallow the whole condition.
**Where**: `supabase/migrations/0045_soft_delete_null_role_guard.sql`
(hardens the 0043/0044 `soft_delete_pr_ticket` / `soft_delete_vs_ticket`).
Audit any `current_user_*() in/not in (...)` guard in a definer function for
the same fail-open. (Granting the RPC to `authenticated` only + a NOT NULL
role column kept it unexploitable here, but don't rely on that.)

---

## Service-role seed can't UPDATE `role`/`permissions` — `users_self_update_guard` fires for the service role too (auth.uid()=null → not staff)

**Symptom**: A provisioning script (e.g. `tools/vp-accounts.mjs`,
`tools/president-account.mjs`) creates the auth user fine, then
`supabase.from('users').update({ role: 'dev', ... }).eq('id', uid)` with the
**service_role** key fails:
`users_self_update_guard: role can only be changed by staff`.
**Cause**: RLS is bypassed for `service_role`, but **triggers still fire**.
`users_self_update_guard` (0028/0041, BEFORE UPDATE on `public.users`) lets
only staff change privileged columns (`role`, `permissions`, `method`,
`has_password`, locked `username`). "Staff" = `current_user_is_staff()` →
`current_user_role()` → row for `auth.uid()`. The service-role JWT has no
`sub`, so `auth.uid()` is null → no row → not staff → guard raises. (Same
shape as the 0041 signup-brick bug: server contexts run with null
`auth.uid()`.)
**Fix**: The guard is **BEFORE UPDATE only — there is no INSERT guard** on
`public.users`. Re-seed the row instead of updating it: `select *` the
existing row, `delete` it, `insert` it back with `role`/`department` changed.
Service role bypasses RLS for both delete and insert; the auto-created row is
safe to replace for a brand-new account (nothing FK-references it yet). Done
in `tools/president-account.mjs seed`. **`vp-accounts.mjs` still does a plain
`.update({role})` and will hit this same block if re-run today** — port the
select→delete→insert fallback there if you re-provision VPs. (Alternatives if
the row already has dependents: a SECURITY DEFINER RPC granted to
service_role, or set the role in the Supabase SQL editor — both need SQL
access this repo's `.env.local` doesn't carry.)
**Where**: `tools/president-account.mjs`; guard in
`supabase/migrations/0028` + `0041`.
**Best method for an EXISTING row with FK dependents** (e.g. granting an
already-provisioned staff account a new `permissions[]` value — done
2026-07-22 to add `'samoshop'` to `samomdkkumdi`): do NOT delete+insert —
that row is FK-referenced (created content, actions, etc.) and the delete
either cascades data away or fails on RESTRICT. Instead disable the guard
for one atomic UPDATE via `tools/apply-migration.mjs` (runs as Postgres
superuser over the Management API `database/query` endpoint):
```sql
alter table public.users disable trigger users_self_update_guard;
update public.users set permissions = array_append(coalesce(permissions,'{}'),'samoshop')
 where username = 'samomdkkumdi' and not ('samoshop' = any(coalesce(permissions,'{}')));
alter table public.users enable trigger users_self_update_guard;
```
Safe because: the endpoint runs a multi-statement string as ONE implicit
transaction (simple-query protocol), so a failing UPDATE rolls back the
DISABLE too (trigger stays enabled); and `ALTER TABLE … DISABLE TRIGGER`
takes a transaction-scoped ACCESS EXCLUSIVE lock, so no other session ever
observes the guard disabled. Verify `tgenabled='O'` (enabled) on
`pg_trigger` afterward. Prefer this over delete+insert for any established
`public.users` row.

---

## "Email notification doesn't work" = a silent gate, not broken plumbing (verify the channel end-to-end BEFORE rebuilding it)

**Symptom**: หนังสือโครงการ email never arrives. Easy to assume the GAS
MailApp path is broken / the deployment is stale / a CF-Worker rewrite is
needed.
**Cause**: The send is double-gated in `projects/notify.js notifyUniStaff`:
`settings.notify_uni_email !== false` AND a truthy `settings.uni_staff_email`.
Live DB had `notify_uni_email = false` AND `uni_staff_email = ""` → the channel
was simply OFF. The plumbing was fine — a direct POST to the live `/exec`
`notifyProjectEmail` returned `{"success":true}` and delivered a real email.
The uni_staff *account* email is synthetic (`@samomdkku.app`, never delivers),
which is why a SEPARATE curated `uni_staff_email` recipient field exists — and
it was never filled. Same shape as the `notify_*_in_app` flag entry above.
**Fix**: Don't rebuild a working channel — verify it first (curl the live
endpoint to your own address). Then make the silent-off state IMPOSSIBLE to
miss: manage UI now shows a warning when email-notify is ON but the recipient
is blank, plus a "ทดสอบ" send-test button. `normalizeRecipients()` allows
multiple addresses. GAS MailApp stays the channel (best deliverability with no
custom domain — see STATE.md GAS section for why CF Workers lose here).
**Where**: `src/js/projects/notify.js` (`normalizeRecipients`, the `to` gate),
`src/js/projects/manage.js` (`refreshEmailWarn` / `onSendTestEmail`),
`src/html/tab-projects.html`. Any future "notification X doesn't arrive": curl
the channel end-to-end before touching its code, and check the on/off config.

---

## A per-recipient SELECT RLS policy is DEAD when a `using(true)` public-read policy already exists on the same table (policies are OR'd)

**Symptom**: You add a narrow "this user sees only their rows" SELECT policy
to `projects` / `project_documents` / `project_files` (e.g. to scope the new
professor `sa_prof` seat to "only หนังสือ sent to him"). It has no effect —
the professor (and in fact anyone with the anon key) can still read EVERY
project, document, and file, including private drafts.
**Cause**: migration 0032 (`*_read_public`) already granted
`for select to anon, authenticated using (true)` on those tables to power the
public customer mirror (`/projects-view`). Postgres RLS combines multiple
permissive policies with OR — a `using(true)` policy is unconditionally true,
so it swallows every narrower SELECT branch you add later. The project tables
are simply world-readable by design; SELECT RLS can't re-narrow them.
**Fix**: Don't fight the public-read policy. Enforce the per-recipient scope
at the UI/query layer instead, keyed off a table that DOESN'T have a public
policy. Here `project_sign_requests` has only the 0050 RLS (`actor OR
prof_id = auth.uid()`), so a doc's embedded `sign_requests` is non-empty for
the professor ONLY when it was sent to him — `scopeProjectsForRole()` in
`src/js/projects/index.js` filters his inbox on that signal, and
`loadFilesForDoc()` in `inbox.js` filters his file list to the requested +
signed files. The genuinely load-bearing prof RLS is the **INSERT** branch
(signed-file upload), because 0032 added no public INSERT policy.
**Where**: `supabase/migrations/0050_prof_sign_requests.sql` (the SELECT
branches are commented as DEFENSIVE); UI scoping in
`src/js/projects/index.js` + `inbox.js`. **Before adding any "owner-only"
SELECT RLS to a project table, grep the migrations for an existing
`*_read_public` / `using (true)` policy on it — if one exists, RLS won't
narrow reads; scope in the app off a non-public table instead.**

---

## `create or replace function` CANNOT change the return type — drop it first

**Symptom**: A migration that evolves an existing RPC's return type (e.g. 0082
changing `sync_my_team_permissions()` from `returns text[]` to `returns jsonb`)
fails on apply with `42P13: cannot change return type of existing function` /
`HINT: Use DROP FUNCTION ... first`. The whole file rolls back (Management-API
runs it as one txn), so nothing lands — safe, but confusing if you expected the
columns above it to persist.
**Cause**: `create or replace function` may change the body but NOT the
signature's return type (nor arg types). Postgres refuses in-place.
**Fix**: `drop function if exists public.fn(argtypes);` immediately before the
`create`. Re-`grant` after (the drop takes the grants with it). Watch for
callers depending on the old return shape during the deploy window — 0082's
frontend handles BOTH `text[]` (pre) and `{permissions,vs_depts}` (post) so an
old bundle against the new RPC still works. If other DB objects depend on the
function, `drop` will fail unless you recreate them too (or the return change is
what forces a coordinated migration).
**Where**: `supabase/migrations/0082_team_vs_dept_scope.sql`. Same family as the
"no create or replace policy" entry — some objects can't be replaced in place.

---

## Adding a permission-based access channel leaves every ROLE-ONLY gate as a latent block — a role:'user' account with real granted perms gets bounced

**Symptom**: After 0081 made the SAMO Team tree grant real perms, a person
(`phuriphat.ma@kkumail.com`) whose tree membership gave them `pr` (+more) logged
into `/admin/` and got stuck at the sign-in gate — even though the DB row was
correct (`role='user'`, `managed_permissions=['creator','pr','projects','samoshop',
'team','vs']`, verified live). The PR tab never even rendered.
**Cause**: The admin ENTRY gate was role-only:
`const isStaff = STAFF_ROLES.includes(role); if (!isStaff) showAuthGate()`.
`STAFF_ROLES` is the fixed list of staff roles; a Google login is `role='user'`,
which isn't in it — so the gate bounced the account before `userCanAccess()` (which
IS permission-aware) ever ran. The per-section sidebar gating at
`userCanAccess(feature)` was already correct; the bug was the COARSE "are you allowed
in the building at all" check one level up, which still asked "is your ROLE staff?"
not "do you have ANY admin capability?". Same shape lurked in the `authReady.then()`
settle-check (`!STAFF_ROLES.includes(u.role)`) and the `?scan=` subscriber.
**Fix**: `canUseAdmin(user) = STAFF_ROLES.includes(role) || ADMIN_FEATURES.some(f =>
userCanAccess(f, user))` where `ADMIN_FEATURES = ['pr','vs','samoshop','projects',
'creator','team']`. Gate BOTH the onAuthChange handler and the authReady settle-check
on `canUseAdmin`, not the role list. Non-staff admin users get a 'ทีม SAMO' sidebar
label fallback.
**Where**: `src/js/admin-main.js` (`canUseAdmin`/`ADMIN_FEATURES`, the onAuthChange
gate, the authReady `.then`). **Rule**: when you introduce a permission channel that
can grant access to accounts OUTSIDE the existing role set (here: `managed_permissions`
on `role='user'` kkumail logins), grep for EVERY `ROLE.includes(role)` / `role === 'x'`
gate — each is a role-only chokepoint that silently ignores the new channel. Route the
coarse "can this account use the app at all" check through the same
permission-aware predicate the fine-grained gates use, never a hardcoded role list.

---

## Discord-notify drops leave NO trace — Pages Function logs aren't retained, so add a durable log before debugging

**Symptom**: PR (and occasionally VS/projects) Discord notifications don't
arrive for *some* submissions. Intermittent, not reproducible on demand,
and — the real trap — **nothing to look at afterward**. You go to find the
failure in the logs and there are no logs.
**Cause (two parts)**:
- *No durable record.* The `/notify` Cloudflare Pages Function's
  `console.warn`/`console.info` only surface in a LIVE
  `wrangler pages deployment tail` (or the dashboard real-time logs) —
  Pages Functions retain nothing by default (no Logpush configured). The
  client-side `console.warn` in `discord-queue.js callGAS` lives only in
  that one browser tab and dies with it. So a drop that happened an hour
  ago is unrecoverable. You cannot debug what you cannot see.
- *A widened drop window.* The client queue (`discord-queue.js`) carried a
  6s inter-call spacing from the GAS era, where the binding limit was
  Cloudflare's per-IP **1015** (cooldown in minutes). Once notify moved to
  the `/notify` Pages Function (Cloudflare's own egress), 1015 stopped
  being the limit — the Function now handles Discord's per-webhook 429
  itself (3 retries, honours Retry-After). But the 6s spacing stayed, and
  a fire-and-forget call PARKED in that 6s delay hasn't been fetched yet,
  so `keepalive` can't save it — mobile Safari freezes a backgrounded tab
  and the parked `setTimeout` never runs → dropped notify. The wide 6s was
  a GAS-era artifact actively making drops *more* likely on the new path.
**Fix**:
- **Log first, then debug.** Added `notify_log` (migration 0055): the
  Function appends one row per delivery outcome (ok, discord_status,
  attempts, retried, ticket_id). Append-only RLS (anon/authenticated
  INSERT via the public anon key, staff-only SELECT). Best-effort — a
  failed log write can never affect delivery — and gated on
  `SUPABASE_URL`/`SUPABASE_ANON_KEY` Pages env vars, so it no-ops if
  they're unset. Query `select * from notify_log where not ok` to see
  exactly which notifies failed and why. The write is scheduled via
  `context.waitUntil` so it adds no response latency and completes even
  after the client navigates away.
- **Shrank the spacing** 6s → 800ms in `discord-queue.js` (still under
  Discord's 5/2s bucket at worst; the Function's 429 retry is the real
  backstop). Shorter park window = far fewer background/close drops.
- **Drain on page teardown (follow-up (a), now DONE).** `flushDiscordQueue()`
  in `discord-queue.js` fires anything parked in the spacing delay the
  instant the page hits `pagehide` / `visibilitychange=hidden`, and holds
  spacing at 0 until `pageshow`/visible. The parked call's `keepalive:true`
  fetch then leaves the tab before mobile Safari freezes it — closing the
  "request never left the tab" gap. Resets on show so a mere tab-switch
  doesn't permanently disable spacing.
- **Hardened `notify_log` (review follow-up).** The table is publicly
  INSERTable via the bundled anon key (`with check (true)`), so a direct
  `POST /rest/v1/notify_log` could otherwise store arbitrary-size rows,
  unbounded. Added per-column `char_length` CHECKs (caps per-row size for
  ALL callers, app or attacker) + `prune_notify_log(retain_days=30)`
  (security-definer, NOT granted to anon/authenticated) for retention.
  Bounds both row size and row count; the residual (an attacker can still
  insert many small rows) is the same anon-write exposure as pr_tickets and
  is bounded by the prune.
**Where**: `supabase/migrations/0055_notify_log.sql` (CHECKs +
`prune_notify_log`); `functions/_discord.js` `logNotifyOutcome`;
`functions/notify.js` (waitUntil wiring; `firstStatus ?? null` keeps a 0);
`src/js/discord-queue.js` `flushDiscordQueue` + page-lifecycle listeners.
**Open follow-up (not done, tradeoff noted in PR)**: (b) move to
`waitUntil`-deliver + immediate `202` so delivery is fully decoupled from
the client connection (changes the callGAS success-echo contract — the
notify_log becomes the source of truth for failures, so do it together).

---

## An anon-INSERTable table's text columns are ATTACKER-controlled — escape on render even in a "staff-only" internal dashboard

**Symptom**: The new `analytics_events` table (migration 0065) is publicly
INSERTable via the bundled anon key (same append-only pattern as `notify_log`
/ `pr_tickets`). Its `path` column is normally written by the frontend tracker
from `location`, so it *looks* like trusted first-party data. But the staff
usage dashboard (`analytics-dashboard.js` `rankBars`) rendered `top_paths[].path`
into `innerHTML` raw — and an attacker can `POST /rest/v1/analytics_events` with
`{"path":"<img src=x onerror=…>"}` directly. Result: **stored XSS that fires in
every staff member's browser** when they open สถิติการใช้งาน (confirmed: the raw
`<img onerror>` string stores verbatim).
**Cause**: "internal / staff-only view" gave a false sense that its inputs are
trusted. Authorization on the *read* (staff-only SELECT / RPC) says nothing
about who could *write* the row. Any table whose INSERT policy is
`with check (true)` for anon has every text column attacker-controlled,
regardless of who reads it back. Same root class as the ticket-renderer XSS
entry above — just reached through an anon-writable log instead of a form.
**Fix**: `escHtml()` every such field on render (path AND role, both into the
text node and the `title=""` attribute). Length CHECKs in the migration cap
size but do NOT sanitize content — escaping at render is the actual defense.
**Where**: `src/js/analytics-dashboard.js` (`rankBars` + `barChart` now import
and apply `escHtml` from `utils.js`). **Rule**: before rendering ANY column of
an anon-INSERTable table (`analytics_events`, `notify_log`, `pr_tickets`,
`vs_tickets`, …) into innerHTML — even in a staff-only dashboard — treat it as
untrusted and `escHtml` it. Read-side authorization is not input validation.

---

## A SECURITY DEFINER RPC over a ROW-SCOPED table leaks the restricted rows unless it re-applies the scope — the table's RLS does NOT protect a definer function

**Symptom**: `find_similar_vs_tickets` / `merge_vs_tickets` (0068) returned VS
tickets from ALL departments to a `vp_admin`, who by the `vs_tickets` read RLS
(0010) may only see their OWN department's tickets. A confidential complaint
system leaking other-dept problem text to the wrong VP.
**Cause**: the RPCs are `SECURITY DEFINER` (needed to compute similarity /
cascade across the table). SECURITY DEFINER runs as the owner and **bypasses
RLS entirely** — so the `vs_tickets_read` policy that scopes `vp_admin` to
`target_dept = current_user_dept()` simply does not apply inside the function.
The function authorized `vp_admin` but then queried the whole table.
(`vs_staff`/`dev` are fine — their RLS is unrestricted, so "see all" matches.)
**Fix**: re-implement the SAME scope predicate inside the definer function for
the restricted role: return only `target_dept = public.current_user_dept()`
rows for `vp_admin`, and reject cross-dept merges. Migration 0069.
**Where**: `supabase/migrations/0069_vs_dedup_dept_scope.sql`. **Rule**: whenever
a SECURITY DEFINER function reads/writes a table whose RLS is row-scoped by role
(dept, owner, tenant…), you MUST re-apply that scope in the function body for any
role that the RLS restricts — the definer bypass means RLS gives you nothing.
Audit every definer RPC against the base table's SELECT/UPDATE policies. Related:
the "per-recipient SELECT RLS is DEAD under `using(true)`" and "RLS inline
subqueries depend on the referenced table's RLS" entries.

---

## GitHub-style "duplicate of #A" cross-references LEAK across a per-submitter visibility boundary — the id itself is a capability when lookup is by-id

**Symptom**: VS duplicate management (0068) linked ticket B → canonical A and
wrote remarks like "รวมกับ VS-A…" into B's timeline, plus exposed
`B.duplicate_of = A`. But `get_vs_ticket_by_id` (0021) is a guest lookup granted
to `anon` that returns any ticket by id — **the id is the only secret**. So B's
submitter (a student) could read A's id from their own ticket, paste it into the
tracker, and view A — another student's confidential complaint. Symmetric for
A's submitter seeing B.
**Cause**: GitHub's close-as-duplicate + `#A` mention is safe only because a repo
has UNIFORM visibility. A confidential, per-submitter system does not — tickets
have different owners/depts and lookup-by-id is a capability. Putting the
canonical's id anywhere the duplicate's submitter can read (a remark, or the
`duplicate_of` column returned by the guest RPC) hands them access to it.
**Fix**: keep the cross-reference STAFF-INTERNAL; give the submitter a GENERIC
resolution. (1) Tag id-bearing dedup remarks `internal:true`. (2) The guest
lookup SANITIZES its row — nulls `duplicate_of` and strips `internal` remarks
(staff read the raw table, so they still see the link). (3) On auto-close the
submitter gets a generic "ดำเนินการและปิดแล้ว" remark, no id. Migration 0071 +
a defensive `!e.internal` filter in `vs-tracking.js rowToTicket`.
**Where**: `supabase/migrations/0071_vs_dedup_confidentiality.sql`,
`src/js/vs-tracking.js`. **Rule**: before cross-linking two records that belong
to different principals, check whether the reference (id, link, mention) is
itself readable by the other principal — if lookup is by-id/capability, the id
IS the data. Keep cross-refs on the staff side; sanitize any anon/guest-facing
read.

---

## A `NOT NULL` column with `ON DELETE SET NULL` is a latent contradiction — the FK cleanup fails at delete time and BLOCKS the parent delete

**Symptom**: A brand-new child table applies clean, all tests + isolation
checks pass, feature ships. The bug is invisible because nothing in normal
use / tests ever deletes a referenced PARENT row. Then one day deleting a
`public.users` row (or whatever the FK points at) errors with a NOT NULL
violation on a child table you weren't even thinking about — and the parent
delete is blocked entirely.
**Cause**: a column declared BOTH `not null` AND `references parent(id) on
delete set null`. The clauses contradict: when the parent is deleted Postgres
tries to SET the child FK column to NULL, but the column is NOT NULL → the
whole DELETE aborts. Seen in 0072: `vs_public_comments.author_user_id uuid
not null references public.users(id) on delete set null`. `create table if
not exists` will NOT fix it on a re-apply (the table already exists), so the
contradiction persists silently.
**Fix**: make the delete action consistent with the null-ability —
`on delete cascade` if the child can't exist without its parent (chosen here,
matches `vs_followers`), OR drop `not null` if you genuinely want
orphan-but-keep (`set null`). For a table already created by an earlier run,
re-point it idempotently:
`alter table X drop constraint if exists X_<col>_fkey;
 alter table X add constraint X_<col>_fkey foreign key (<col>) references
 parent(id) on delete cascade;` — then verify `pg_constraint.confdeltype='c'`
(c=cascade, n=set null, a=no action).
**Where**: `supabase/migrations/0072_vs_public_board.sql`. **Rule**: grep every
new migration for a column that is both `not null` and `on delete set null`
(or `set default` with no default) on the same FK — that pair is always a bug.

---

## Sanitizing ONE read path of a confidential column leaves parallel read paths leaking — the guest RPC was cleaned, the owner `select=*` was not

**Symptom**: 0071 sanitized the VS guest lookup (`get_vs_ticket_by_id` nulls
`duplicate_of` so a duplicate's submitter can't discover — and then look up —
the canonical ticket, which is ANOTHER student's confidential complaint). But a
**logged-in** submitter reading their own tickets went through a *different*
path — `dbRest('/vs_tickets?select=*&or=(submitter_id...)')` in
`loginToViewHistory` — which returned the raw `duplicate_of` in the JSON. So the
exact id 0071 protected was still one DevTools-open away for any signed-in
submitter. The confidentiality fix looked complete but only covered one of two
reader paths.
**Cause**: A table has multiple submitter-facing read paths (a security-definer
guest RPC AND a direct RLS `select=*`). A sanitization written into ONE (the
RPC) does nothing for the other. `select=*` in particular is a standing hazard:
it ships EVERY column, so any newly-sensitive column is exposed by default, and
a column-level confidentiality rule can't be expressed in RLS (row-level only).
**Fix**: Treat submitter reads as an explicit allow-list, default-deny. The
owner read now selects a named `SUBMITTER_COLS` list that OMITS `duplicate_of`
(and any staff-only field); the guest RPC keeps nulling it. To still show
"your report is linked to an earlier one" WITHOUT the id, a generated
`is_duplicate boolean` (from `duplicate_of is not null`, 0074) is exposed
instead — a non-identifying flag. Verified: guest RPC returns
`duplicate_of=null, is_duplicate=true`; owner read never includes the column.
**Where**: `supabase/migrations/0074_vs_duplicate_linked_tracking.sql`
(`is_duplicate`), `src/js/vs-tracking.js` (`SUBMITTER_COLS`, both the owner read
and the guest fallback read). **Rule**: when you sanitize a confidential column
on one reader, grep for EVERY other path that reads that table for a submitter/
guest (`select=*`, other RPCs, direct `.from()`), and fix them all — or better,
switch those reads to an explicit submitter-safe column allow-list so a future
sensitive column isn't leaked by `*` default. Same family as the "per-recipient
SELECT RLS is DEAD under using(true)" and "definer bypasses RLS" entries: read
authorization is per-path, not per-table.
**Follow-on instance (0080)**: `get_vs_ticket_by_id` (the anon guest lookup) is
`returns setof public.vs_tickets` built from `select * into r … return next r` —
so EVERY column added to `vs_tickets` is auto-exposed to `anon` the moment the
migration lands, until you blank it in that function. 0079 added
`vs_tickets.tags` and it silently rode out to guests (opaque tag ids in the wire
JSON) even though the frontend never rendered it. 0080 blanks `r.tags := '{}'`
alongside the existing `r.duplicate_of := null`. **Rule**: any time you ALTER
`vs_tickets` (or any table behind a `returns setof <table>` / `select *` guest
RPC), open that RPC and decide per-column: sanitize (blank/null) or intentionally
expose. A new column is exposed BY DEFAULT — the type carries it automatically.

---

## Re-opening an ALREADY-OPEN Bootstrap modal with `new bootstrap.Modal(...).show()` stacks a second backdrop — page stays dimmed after close

**Symptom**: In the VS staff modal, tapping a ticket in the แผนผังเรื่องซ้ำ
(dup tree) — which re-runs `openStaffModal` to jump to the linked ticket while
the modal is already open — left the page dimmed ("web dimmer") afterward.
Closing the modal removed one backdrop but another stayed forever.
**Cause**: `openStaffModal` ended with `new bootstrap.Modal(el).show()`. When
the element is ALREADY shown, constructing a fresh Modal instance and calling
`.show()` adds a SECOND `.modal-backdrop` that the original instance's
`.hide()` never cleans up. Any "navigate within an open modal" flow (dup tree,
kanban dup-rows, similar-list jumps) triggers it.
**Fix**: `bootstrap.Modal.getOrCreateInstance(el).show()` — reuses the live
instance, whose `.show()` no-ops when `_isShown`; the DOM content re-rendered
above it just appears. Rule: NEVER `new bootstrap.Modal(...)` in a code path
that can run while that modal is open; always `getOrCreateInstance`.
**Where**: `src/js/vs-staff.js` `openStaffModal`. Grep for `new bootstrap.Modal`
if any other modal ever gains an internal "jump to other record" affordance.

---

## A destructive-direction toggle without a confirm silently dropped a privacy guard (vs_categories.personal flipped to publishable)

**Symptom**: The 0072 isolation proof went 19/23 — the CONFIDENTIAL test
ticket appeared on the public board, its detail returned data, SE could
publish it, students could me-too it. Root cause was DATA, not code: the
seeded `personal` category had `is_confidential=false, public_eligible=true`.
**Cause**: The new category manager confirmed the toggle only when turning
confidential ON. Turning it OFF — the direction that REMOVES a privacy
guard — was a silent one-tap, and a tap during user testing flipped the
personal-complaints lane to publishable. No real ticket leaked (none in that
category was published), but every confidential re-check downstream keys on
that flag, so the whole hard-exclusion stood on an unguarded toggle.
**Fix**: (1) restored `personal` to confidential; (2) the manager now
confirms BOTH directions, with the OFF confirm worded as removing
protection. **Rule**: when adding a toggle whose one direction weakens a
security/privacy invariant, that direction needs the STRONGER confirm (or a
type-to-confirm) — not the safe direction. Also: re-run
`tools/vs0072-isolation.mjs` after ANY change that touches vs_categories or
the public-board RPCs; it catches config-level regressions, not just code.

---

## A narrowing "scope" dimension added ALONGSIDE an unconditional full-access permission is DEAD — RLS ORs the branches, so the broad grant always wins

**Symptom**: A person granted VitalSound through the SAMO Team tree with a
per-ฝ่าย binding (0082 `team_nodes.vs_dept` → `users.managed_vs_depts`) logged
in with their kkumail and saw + managed EVERY department's tickets — not the
one dept they were bound to, unlike a real VP account (`samomdkkuvpa`). The
tree row, the resolver, `managed_vs_depts`, and the new RLS branch were all
verifiably correct, which is what makes this one hard to see.
**Cause**: 0082 added the dept scope as an ADDITIVE dimension parallel to the
`vs` permission, and the perm modal offered the two independently — a checkbox
grid ("VitalSound") plus an always-visible dept `<select>`. The admin did the
natural thing: ticked VitalSound (to grant VS at all) AND picked a dept. But
`vs` means FULL VS — `current_user_has_permission('vs')` is an unconditional
`true` branch in every VS policy, and permissive RLS policies are OR'd, so it
swallowed the narrower `target_dept = any(current_user_vs_depts())` branch.
Live proof: node `หัวหน้าฝ่าย IT` had `permissions={vs}` AND
`vs_dept='อุปนายกฝ่ายวิชาการ'` → `managed_permissions={pr,vs}` → full access.
Same family as "a per-recipient SELECT RLS is DEAD when a `using(true)` policy
already exists" — a broad OR-branch cannot be narrowed by adding a second one.
**Fix**: make the scope a PROPERTY OF THE GRANT, not a sibling of it. A row now
carries EITHER `vs` (all depts) OR a `vs_dept` (that dept only), never both:
the dept picker appears only after VitalSound is ticked (progressive
disclosure), and choosing a specific dept drops `vs` from `permissions[]` on
save (`readPermInputs()`). Migration 0083 normalises the rows written under the
old model (`array_remove(permissions,'vs') where vs_dept is not null`) and adds
`current_user_vs_scope()` — NULL = all depts, `{}` = no access, else the
allowed depts — so every VS surface asks ONE fail-closed predicate instead of
re-deriving `role in (...) or has_permission or vp_admin-dept` five ways.
**Where**: `supabase/migrations/0083_vs_scope_is_not_full.sql`,
`src/js/team/index.js` (`readPermInputs` / `syncVsScopeVisibility`),
`src/js/vs-staff.js` (`isVsSuper` / `vsScopeDepts`),
`tools/vs0083-scope.mjs` (10-check proof, run it after any VS RLS change).
**Rules**: (1) before adding a narrowing dimension to an authorization model,
grep the policies for an existing unconditional branch (`has_permission('x')`,
`using(true)`, a role list) — if one exists, your new branch is decorative
until the broad grant is made mutually exclusive with it. (2) A UI that lets an
admin select both a broad grant and a narrow scope INDEPENDENTLY will be used
that way; encode the exclusivity in the form, not in a doc comment.
(3) The second half of this fix is the boring half: a scoped principal needs
the SAME dept-scoped abilities everywhere the existing narrow role has them
(tags, dedup search/merge/unmerge, soft-delete, moderation) or every button
throws "not authorized" — grep for each `= current_user_dept()` site.

---

## The privilege-ESCALATING option must never be a select's default — "ทุกแผนก" at index 0 silently granted full VitalSound on every save

**Symptom**: minutes after the 0083 UI shipped, the same team node kept coming
back as `permissions={vs}, vs_dept=null` (full VS) even though the admin's
stated intent was a per-ฝ่าย scope. Looked like the fix had not deployed, or
like a string-encoding mismatch stopping the `<select>` from preselecting the
stored dept. It was neither — a byte-compare of all 12 dept values against
`vs_tickets.target_dept` matched exactly, and the deployed bundle was correct.
**Cause**: the new scope select was built as
`<option value="">ทุกแผนก</option>` + one option per dept. The empty value —
i.e. the browser's default selection for a fresh grant — WAS the widest
possible grant. So ticking "VitalSound" and pressing บันทึก without ever
touching the scope picker handed over every department's confidential tickets.
The one interaction an admin is most likely to perform (tick the box, save)
produced the most dangerous outcome, silently.
**Fix**: split "nothing chosen" from "all departments". `""` is now
`— เลือกขอบเขต —` and saving with it blocks with a Thai message;
`__all__` (`VS_SCOPE_ALL`) is the explicit full grant and additionally
requires a `confirm()` naming the consequence. A node/member that already
carries `vs` preselects `__all__`, so editing an existing full grant is
unchanged. Same principle as the vs_categories confidential-toggle entry
above: guard the direction that REMOVES protection, not the safe one.
**Where**: `src/js/team/index.js` (`VS_SCOPE_ALL`, `fillVsScopeSelect`,
`readPermInputs` returning null, `readPermInputsOrWarn`).
**Rule**: in any picker where one option is broader/more destructive than the
others, index 0 must be a non-choice ("— เลือก… —") and the broad option must
be selected deliberately. Never let "the user didn't touch this control" and
"the user asked for maximum privilege" be the same input value. Corollary for
debugging: when live data keeps reverting to a wide setting, suspect the
form's default before suspecting the write path.

---

## A capability key is not a ROLE — granting flat `projects` produced a tab with no controls, because the app branches on `user.role`, not on the permission

**Symptom**: the obvious way to let a person use หนังสือโครงการ via the SAMO
Team tree — tick "หนังสือโครงการ" in จัดการสิทธิ์ — opens the tab for them and
then does nothing useful. No ส่งหนังสือ button, no รับเรื่อง controls, no role
hint, and every write is refused. Looks like the grant didn't apply; the grant
is fine.
**Cause**: `projects` is one permission key but THREE workflows
(`vp_admin` = ส่งหนังสือ, `uni_staff` = รับเรื่อง/อัปเดต, `sa_prof` = ลงนาม).
`src/js/projects/index.js` does `currentRole = user.role` and every control,
hint, scope filter and notification branch keys off that string; a tree
grantee is `role='user'`, which matches no branch. Server-side the same shape:
`current_user_is_project_actor()` was the hardcoded list
`role in ('vp_admin','uni_staff','dev')`. So the permission opened the door to
a room with no furniture. Two further role-only chokepoints hid behind it:
`current_user_is_prof()` (`role = 'sa_prof'`) gated every professor policy, and
`sign.js` addressed the signature request with
`listUsersByRole('sa_prof')[0]` — a role query that can never see a tree-granted
อาจารย์ AND silently assumed exactly one professor exists.
**Fix**: give the grant a SEAT — `team_nodes/team_members.project_seat ∈
(vpa|staff|prof)` → `users.managed_project_seats[]` →
`current_user_project_seats()` (0086), mirroring how `vs_dept` scoped
VitalSound. Widen the two role-only helpers at their single definition each so
every policy that calls them picks seats up for free, and resolve the seat to a
role ONCE in the frontend (`projectSeatRole()`) so the ~40 `role === '…'`
branches keep working untouched. The seat picker is required whenever the perm
is ticked — a `projects` grant with no seat is refused at save time rather than
shipped as a dead tab. `prof` is deliberately NOT an actor (a professor who
became one would see every project instead of only what was sent to them).
**Where**: `supabase/migrations/0086_team_project_seats.sql`,
`src/js/projects/index.js` (`projectSeatRole`), `src/js/projects/api.js`
(`listProjectProfs`), `src/js/projects/sign.js`, `src/js/team/index.js`.
Proof: `tools/proj0086-seats.mjs` (18 checks incl. the prof-is-not-an-actor
negative).
**Rule**: before exposing a feature through a flat permission key, grep the
module for `user.role` / `role === `. If the UI or RLS branches on role rather
than on the permission, the permission alone is NOT a working grant — either
add the missing dimension (a seat/scope) or the grant is decorative. Same
family as the VS "scope added next to an unconditional permission" entry: a new
access channel must be threaded through EVERY gate the old channel used, not
just the one you were looking at.

---

## Publishing a table-backed directory must be a PROJECTION, never a public SELECT policy — `is_public` filters rows, and rows carry every column

**Symptom** (designed out before it shipped, not observed): the SAMO Team tree
is destined to be rendered publicly as the org chart with people's names. The
natural implementation — add `using (true)` to `team_members` like migration
0032 did for the projects tables, and filter on a new `is_public` flag — would
have published `kkumail`, `student_id`, `year`, `major`, `permissions`,
`vs_dept`, `project_seat` and `user_id` for **every student in the tree**,
plus the @kku.ac.th addresses of the อาจารย์ / เจ้าหน้าที่ who hold seats.
**Cause**: RLS is row-level. A visibility flag controls WHICH ROWS a policy
returns and says nothing about which COLUMNS travel with them — and once a
`using (true)` policy exists it can never be narrowed later (policies are OR'd;
see the "per-recipient SELECT RLS is DEAD" entry). A `returns setof
public.team_members` RPC has the same defect from the other direction: every
column added afterwards is exposed automatically, which is exactly how
`vs_tickets.tags` reached guests in 0079.
**Fix**: the only sanctioned publisher is `get_public_org_chart()` (0086) — a
SECURITY DEFINER function returning a hand-built jsonb of
`{id,parent_id,name,kind,position}` + `{node_id,name,nickname,position}` and
nothing else, over a recursive CTE so a non-public parent hides its whole
subtree. `team_nodes.is_public` is defence-in-depth on top of that, not the
boundary. `team_members` keeps NO public policy at all (asserted:
anon reads 0 rows). Verified by `tools/proj0086-seats.mjs`, which asserts the
serialized chart contains no `@`, no `student_id`, no `kkumail`, no seat.
**Rule**: whenever a table holding personal data gains a public surface, write
the projection first and give it the only grant. If you find yourself adding a
public SELECT policy to reach a "just the names" view, stop — you are
publishing the whole row. And put the column allow-list in the function body
(explicit `jsonb_build_object` keys), never `select *` or `returns setof
<table>`, so a future `alter table` cannot silently widen it.

---

## When a SCOPED grant deliberately drops its blanket permission key, every reader of that key must learn the second signal — or re-opening the editor wipes the grant

**Symptom** (caught in a bug scan, before it reached a user): a person or node
granted SAMO Passport **scoped to one department** shows the "SAMO Passport"
checkbox UNTICKED when the จัดการสิทธิ์ modal is re-opened, with the scope block
hidden. Nothing looks broken — until the admin saves that modal for any
unrelated reason (adding `pr`, flipping inherit), at which point
`passport_dept_id` is written back as `null` and the grant is **silently
destroyed**. The row still exists, so nothing errors.
**Cause**: 0083/0087 make scoped and full mutually exclusive — a scoped grant
stores the binding (`vs_dept` / `passport_dept_id`) and NO blanket key in
`permissions[]`, because the blanket key is an unconditional OR-branch in RLS
that would swallow the narrower check. That is correct. But the modal restored
its checkboxes from `permissions[]` alone, with a hand-written special case for
exactly one key:
```js
cb.checked = cb.value === 'vs' ? vsOn : own.has(cb.value);   // ← 'passport' missing
```
The `vs` case had been patched when VS gained its scope; adding a SECOND scoped
permission re-introduced the same bug for the new key. The read path and the
write path disagreed about what "granted" means.
**Fix**: one predicate both modals share — `permTicked(key, own, row)` — that
knows every key whose grant can be expressed as a binding instead of a
permission. New scoped permissions extend that function rather than adding
another ternary. Regression-tested in `src/js/team/perm-ticked.test.js`,
including `passport_dept_id: 0` (a real id must not read as falsy).
**Where**: `src/js/team/index.js` `permTicked` + both `open*PermModal`.
**Rule**: any time you make a grant's storage POLYMORPHIC — "either this key or
that binding" — grep for every place that answers "is this granted?" and route
them all through one shared predicate the same commit. A read that knows only
the old representation does not fail loudly; it reports "not granted", and the
next write makes that true.

---

## The permission that manages the grant engine was the one the grant engine didn't honour — and a helper test is not a permission test

**Symptom** (reported live): the ทีม SAMO permission was granted to
`phuriphat.ma@kkumail.com` through the tree. Signed in as that account, EVERY
tree edit failed with "บันทึกไม่สำเร็จ (สิทธิ์ไม่พอ)" — which also made granting
เขียนประกาศ to someone fail, so it read as two separate bugs. It was one: the
account could not write the tree at all, so no grant could be issued from it.
**Cause**: 0046 gated `team_nodes` / `team_members` on ROLE only —
`current_user_role() = any(array['vp_admin','dev'])` — with no
`current_user_has_permission('team')` branch. When 0081 introduced
`managed_permissions`, every OTHER feature's policy was updated (announcements
honours `creator`, `pr_agents` and `pr_tickets` honour `pr`,
`current_user_is_shop_admin()` honours `samoshop`) — the team tables were
missed. The UI honoured it (`userCanAccess('team')`, `ADMIN_FEATURES`), so the
section rendered and only writes died. Third instance of the same class this
cycle.
**A second one fell out of the same sweep**: `projects_insert` /
`projects_delete` / `project_documents_insert` / `project_documents_delete`
never called `current_user_is_project_actor()` and stayed role-only, so the
0086 `vpa` seat could UPDATE a project but not CREATE one — the single thing
ผู้ส่งหนังสือ exists to do. `proj0086-seats.mjs` missed it because it asserted
`current_user_is_project_actor()` returned true rather than performing a real
INSERT. **A predicate test is not a permission test**: the helper can be right
while the policy that was supposed to call it never does. The script now does
the INSERT (allowed for `vpa`, refused for `prof` and for no seat).
**Fix**: 0089 adds the `team` permission branch to both team-table policies;
0090 adds the `vpa` seat to the four project write policies — deliberately
alongside the existing role list rather than switching to the actor helper,
because that helper also admits `uni_staff`, who must not create projects.
**Where**: `supabase/migrations/0089_*`, `0090_*`; proofs
`tools/team0089-manage.mjs` (5) and the extended `tools/proj0086-seats.mjs` (21).
**Rules**: (1) after adding an access channel, enumerate EVERY table the
feature writes and check each policy names the channel — a UI gate that honours
it will hide the gap until someone tries to save. (2) Test the OPERATION, not
the predicate. (3) Watch for the recursive case: the permission governing the
permission system is the easiest one to forget, because you are usually holding
a role that already works.
**Third layer, same sweep (0091)**: the notify fan-out resolved every audience
by role — `listUsersByRole('uni_staff'|'vp_admin'|'sa_prof')` — so a seat holder
could be sent a หนังสือ, act on it, and never get a single in-app notification.
This is the quietest failure of the three: the workflow works, the bell is just
empty, and nobody reports a notification they never knew to expect. Replaced by
`list_project_seat_users(seat)` (role OR seat, id + display name only). So the
enumeration rule covers **writes AND audience lookups** — anywhere the feature
asks "who is the X?", not just "may this user write?".
**Harness note (cost me 20 minutes)**: seeding a grant by poking
`users.managed_permissions` directly then writing to `team_nodes` does NOT work
— the write fires the statement-level recompute trigger, which rebuilds
managed_permissions from the tree and wipes a grant with no binding behind it.
Seed the real node+member binding and call `sync_my_team_permissions()`.

---

## A seat/scope dimension that is UNIONED with what it inherits is not a choice — the widest value wins and the explicit pick is decorative

**Symptom**: "I gave myself หนังสือโครงการ as **คณะ**, but it shows many new
notifications / many updates — it should look like samomdkkuvpa." The person had
picked เจ้าหน้าที่คณะ in จัดการสิทธิ์, yet got the VP-Admin inbox (every project,
nothing seen ⇒ everything badged "อัปเดต"). Looks like an unread-state bug; the
seen-state code is fine (per-user `project_doc_views` + user-scoped localStorage).
**Cause**: `effective_team_project_seats_for_email()` UNIONed the person's own
`project_seat` with every seat inherited from their ตำแหน่ง, and the frontend
`projectSeatRole()` then resolved the array with `SEAT_ORDER = ['vpa','staff','prof']`
— *widest first*. Their ตำแหน่ง (หัวหน้าฝ่าย IT) carries `vpa`, so picking `staff`
yields `{staff,vpa}` → `vp_admin`. Proven live by simulating the pick in a
rolled-back transaction. **The union is what makes the pick meaningless**: for an
additive grant (permissions, VS depts) union is right — you can hold PR *and*
inherit ประกาศ. A seat is a single role in one workflow; two seats is not a wider
grant, it is an ambiguous one, and any "pick the widest" tiebreak turns the
narrower explicit choice into a no-op.
**Fix (0092)**: nearest explicit binding wins. A person's own seat REPLACES
inheritance; `node_effective_project_seats` returns at the FIRST ancestor naming a
seat instead of collecting all of them. `SEAT_ORDER` survives only as a tiebreak
across two genuine postings. The three UI sites that painted "own + inherited"
chips now show one or the other, or the modal advertises a grant that doesn't
resolve.
**Where**: `supabase/migrations/0092_project_seat_parity.sql`;
`src/js/team/index.js` (`inheritedSeatsFor`, `nodeEffectiveSeats`,
`refreshMemberPermEff`, both chip renderers); `src/js/projects/index.js`
(`SEAT_ORDER` comment). Proof: `tools/proj0092-seat-parity.mjs`.
**Rule**: before making a dimension inheritable, decide whether it is ADDITIVE or
EXCLUSIVE. If two values cannot both be true of one person, inheritance must
OVERRIDE, never union — and never resolve the ambiguity with "widest wins", which
silently upgrades privilege. Same family as the 0083 VS entry ("a narrowing scope
added alongside an unconditional permission is DEAD") and the 0087 passport-scope
`permTicked` entry: whenever a grant's storage becomes polymorphic, every reader
must agree on which representation wins.

**Three more role-only gaps fell out of the same sweep** — the 0089/0090/0091 rule
("enumerate EVERY table the feature writes AND every audience lookup") had still
missed a table and a helper:
- `project_sign_requests` INSERT/UPDATE/DELETE were `role in ('uni_staff','dev')`,
  so a `staff` seat could act on a document but could not **ส่งให้อาจารย์ลงนาม** —
  the one thing เจ้าหน้าที่คณะ exists for. Now `current_user_is_project_uni_staff()`
  (role OR seat). Deliberately NOT `current_user_is_project_actor()`, which also
  admits `vpa` — the sender does not request signatures.
- `project_settings` write was `role in ('vp_admin','dev')` → the `vpa` seat opens
  การตั้งค่า and cannot save.
- **A regression 0091 shipped**, hitting the REAL `saprof` account in production:
  `list_project_seat_users()` guards on `current_user_is_project_actor()`, which is
  deliberately false for a professor (0086 — a prof must not see every project).
  But `notifySignDecision()` runs AS the professor and asks for the staff + vpa
  audiences, so both returned **zero rows** and the professor's sign/reject
  notified nobody. It returns an empty set rather than an error, so the role-only
  fallback in `api.js listProjectSeatUsers` never fired either. Measured: as
  saprof `staff=0 vpa=0`; as sastaff `staff=1 vpa=11`. Now a prof may READ an
  audience (still id + display_name only) — reading "who is the คณะ" is not the
  same capability as being an actor.
**Rule**: when you narrow a helper that an audience/notification lookup depends
on, check every ROLE that calls it, not just the ones it was written for — an
authorization predicate reused as a *directory* query fails silently and empty.

---

## Per-user read-state means a newly-granted account INHERITS the whole backlog as unread — baseline them at first run, and never trust a sentinel that was set on a no-op

**Symptom**: "I want my email to see หนังสือโครงการ like samomdkkuvpa sees it, but
when I log in with my email it shows many '1 อัปเดต' — as samomdkkuvpa I don't."
Both accounts have the SAME role/seat and see the same documents, so it reads like
a permission or scoping bug. It isn't.
**Cause**: read-state is per user — `project_doc_views` rows keyed by `user_id`,
plus a user-scoped localStorage map. Measured: `samomdkkuvpa` had 26 rows for 26
documents (clean because it has been reading them for months); the newly-granted
account had **0**, so `getDocSeenAt()` returned 0 for every doc and every card
rendered an "อัปเดต" pill for activity that predates the person's access. Working
as designed, and wrong as a product: joining an inbox should not mean inheriting a
year of unread. The existing first-run pass only MIGRATED localStorage → server, so
a brand-new user (nothing in localStorage either) got nothing.
**Fix**: `planSeenAtRows()` — pure, unit-tested — splits the two cases. MIGRATE an
existing reader's local map; BASELINE a reader with no history *anywhere* to "seen
as of now". Gated on the server map being empty, because baselining someone who
already has rows would mark their genuinely-unread documents as read.
**Two traps this hid behind, both worth the entry on their own:**
1. **A sentinel set on a no-op poisons the next fix.** The old code did
   `if (rows.length === 0) { setItem(sentinel); return; }` — so every user who had
   opened the tab once was already flagged "migrated" with zero rows written, and
   would have skipped the new BASELINE branch forever. The key had to be bumped
   (`…BulkMigrated` → `…BulkMigrated.v2`). Only set a "done" marker for work you
   actually did, or version the marker when the rule changes.
2. **Re-running a `merge-duplicates` upsert can move state BACKWARDS.**
   `bulkUpsertMyDocViews` posts with `prefer: resolution=merge-duplicates`, which
   OVERWRITES `seen_at`. Bumping the sentinel makes every established user re-run
   the pass, and any localStorage entry older than their server row would have
   re-flagged already-read documents. `planSeenAtRows` now emits a local value only
   when strictly newer than the server's.
**Also**: the pass resolves AFTER the first paint, so it returns whether it wrote
anything and `index.js` repaints — otherwise the new reader still sees one
screenful of pills until they reload.
**Where**: `src/js/projects/inbox.js` (`planSeenAtRows`,
`migrateLocalSeenAtToServer`, `BULK_MIGRATED_SENTINEL_KEY`),
`src/js/projects/index.js` (repaint on change),
`src/js/projects/seen-baseline.test.js` (9 cases).
**Rule**: any per-user read/seen/ack state needs a defined answer to "what does a
user who joins TODAY see?". The default — "has seen nothing" — is almost never it.
And before comparing two accounts' views, check whether the difference is
*authorization* or *accumulated per-user state*; they look identical in a
screenshot.

---

## Migrating a SHARED workflow account to a personal one moves the AUTHORIZATION but leaves every uid-bound row behind — read state, signature assignments, notifications

**Symptom**: after granting a personal kkumail account the `staff` seat, its
หนังสือโครงการ inbox showed "1 ใหม่" but NOT the "1 อัปเดต" that `sastaff` shows on
the same project. Looks like the seat isn't fully equivalent to the role.
**Cause**: the two badges have completely different sources, which is easy to miss
because they render side by side:
- **"N ใหม่"** = `docs.filter(d => d.status === 'sent').length` — pure document
  STATUS, identical for every uni_staff viewer. It matched immediately.
- **"N อัปเดต"** = `docHasUnseenBeyondStatusBadge()` → `getDocSeenAt()` — PER USER,
  from `project_doc_views` keyed by `user_id`.
So the seat was working perfectly; what differed was accumulated per-user state.
Worse, the first-run BASELINE (added the same day, see the entry above) had marked
all 26 documents seen for the new account — correct for a genuinely new person,
exactly wrong for someone taking over an existing workflow, where the point is to
inherit the predecessor's pending work.
**Fix**: `tools/proj-handover.mjs` — a dry-run-by-default transfer of
`project_doc_views` from the shared account to the personal one. **It REPLACES
rather than merges**: parity requires that a document the source has never opened
has NO row on the target either, or its "อัปเดต" stays hidden. sastaff had 22 rows
for 26 documents; a merge would have left 4 baseline rows masking 4 genuine
unreads. Verified per-document afterwards: 9 unseen for sastaff, 9 for the target,
0 mismatches.
**The same class is WORSE for `sa_prof`** (checked because the same migration is
planned for อาจารย์): a signature request names ONE `prof_id`. `scopeProjectsForRole()`
keeps only documents whose `sign_requests` name the viewer, and
`docPendingSignForProf()` ("N รอลงนาม") matches the same uid — so a migrated
อาจารย์ account does not merely lose badges, it sees a **completely EMPTY inbox**.
Measured: saprof 11 documents visible, a personal account 0. NEW requests are fine
(`list_project_profs()` already returns role `sa_prof` OR `prof`-seat holders, 0086),
so only the pre-existing ones are stranded — `--sign-requests` repoints them, and
it MOVES rather than copies because a request has exactly one professor.
**Where**: `tools/proj-handover.mjs`; badge sources in `src/js/projects/inbox.js`
(`renderProjectListRow`, `renderProjectCard`, `docPendingSignForProf`);
prof scoping in `src/js/projects/index.js` (`scopeProjectsForRole`).
**Residual to know about**: `getDocSeenAt()` falls back to a user-scoped
localStorage map when the server has no row for a document, so if the target
account had already opened one of the source's never-opened documents on that
device, the local cache can still mask it. Clear `projects.docSeenAt.<uid>` (or
site data) on that device after a handover if a badge looks wrong.
**Rule**: "granted the permission" ≠ "took over the job". Before migrating a shared
account, enumerate every table with a `user_id` / assignee column scoped to it —
read state, assignments, notifications, drafts — and decide per table whether it
COPIES (the shared account stays live) or MOVES (it is being retired). A
permission grant migrates none of them.

---

## A permission channel has TWO halves — writes AND reads. `current_user_is_staff()` is a role list, so every read gated on it silently excluded tree-granted accounts

**Symptom** (found by a sweep, before most of it was reported): a `creator`
grantee could WRITE an announcement and then not SEE it. `announcements_write`
honours `current_user_has_permission('creator')`; `announcements_read` was
`status = 'approved' OR current_user_is_staff()`. A tree-granted account is
`role='user'`, so drafts and pending posts vanished from เขียนประกาศ and
ลำดับการแสดงประกาศ — the writer's own unpublished work, invisible to them.
Write-only access is the nastiest shape of this bug: the save succeeds, so
nothing looks broken until you go looking for the row.
**The sweep that found it** (worth re-running after any RLS change):
```sql
select tablename, policyname, cmd, coalesce(qual,'')||' '||coalesce(with_check,'')
  from pg_policies where schemaname='public';
```
then flag every policy matching `current_user_role|current_user_is_staff` that
does NOT also match `has_permission|managed_|current_user_.*scope|_seats`. That
turned up 7, of which 3 were real: `announcements_read`, `vs_followers` /
`vs_public_comments` read (a VS dept-scoped handler could administer a ticket but
not read its followers or staff comment thread), and `analytics_events`
(สถิติการใช้งาน is offered to anyone who can use the admin app).
**The fix that would have been WRONG**: broadening `current_user_is_staff()`
itself. It is what `users_self_update_guard` (0028/0041) trusts to allow
privileged-column writes — widening it lets any tree-granted account
`update users set role='dev'` on itself. Each policy was repointed individually
instead: announcements → `+ has_permission('creator')`; VS →
`current_user_is_vs_handler()` (already "staff OR any VS scope");
analytics → a new `current_user_has_any_grant()`. 0093's proof asserts the
non-widening explicitly, with a real self-promotion attempt.
**Where**: `supabase/migrations/0093_shop_scope_and_grant_reads.sql`; proof
`tools/shop0093-scope.mjs` (18 checks).
**Rule**: when you add an access channel, the enumeration covers **writes,
audience lookups (0091), AND reads**. A read gated on a role list is invisible
until someone with the new channel goes looking for data they just created. And
never widen a predicate that a security trigger also consumes — check
`grep -rn "current_user_is_staff" supabase/migrations/` before touching it.
**FOURTH surface, found 2026-07-30 (0102)**: a **SECURITY DEFINER RPC's own
`raise` guard**. 0093 repointed the `analytics_events` TABLE read to
`current_user_has_any_grant()` but left `analytics_overview()` raising
`'analytics_overview: staff only'`. สถิติการใช้งาน is offered with NO permission
requirement (`SIDE_FEATURE.analytics = null`), so every ทีม SAMO grantee saw the
menu item and got `P0001 staff only` on open. The table and the function
disagreed about the same question. Fix: the SAME predicate in both, so they
cannot drift. So the enumeration is: **writes · reads · audience lookups ·
definer-RPC guards**. Sweep for the last one with
`select proname from pg_proc where pg_get_functiondef(oid) ~ 'current_user_is_staff'`.

---

## Deriving "which department is this admin" from a UI filter is not a permission — SAMO Shop had one grant and a localStorage preference

**Symptom / premise to correct**: "samoshop has two workflow permissions, for
samomdkkuvpa and samomdkkumdi". It did not. There is ONE `samoshop` permission
and both accounts simply held it; `current_user_is_shop_admin()` was
`role in ('shop_admin','dev') OR has_permission('samoshop')` and EVERY shop table
hung off that single predicate. What looked like two workflows was
`shop_products.source` (md/rt/mdi/sittikao, the 0058 ownership key) driving a
**localStorage** filter default — a UI preference the admin could clear, not a
boundary.
**Fix (0093)**: a real scope — `team_nodes/team_members.shop_source` →
`users.managed_shop_sources` → `current_user_shop_scope()` (NULL = every source,
`{}` = none, else the list), shaped like `current_user_vs_scope()` so no caller
can read "no access" as "all access". Product writes are confined by
`current_user_owns_shop_source(source)`.
**What was deliberately NOT scoped, and why it matters**: ORDERS. One order can
hold items from several sources — that is what a shared cart means — so "MDI's
orders" is not a property of a row, it is a property of *some of its items*.
A policy pretending otherwise would either hide orders that contain MDI items or
expose orders that contain everyone's. Splitting order access per source means
splitting the ORDER, which is a product decision. Orders stay admin-wide and the
UI keeps filtering them by `product_source`. **Shipping a policy that LOOKS like
it isolates departments but doesn't is worse than shipping none** — write down
the boundary you did not draw.
**Also**: a scoped admin's product LIST is filtered client-side to their sources.
Not for secrecy (the catalogue is public) but because rows they cannot write
would render with live-looking Edit/Delete buttons that every click 42501s on.
**REVERTED BY 0094 — and the reason is the lesson.** The user's answer was "SAMO
Shop is one role, I want it full, both": a product-only scope isolates nothing
anyone cares about, because ORDERS — the thing a department actually works out
of — cannot be scoped. Building the scopeable half of a boundary and leaving the
meaningful half shared produces a setting that looks like isolation and isn't.
**The right question was "what does a department need to NOT see?", not "which
column can I scope?"** — the answer would have been "orders", and that would have
surfaced the mixed-source problem before any code was written. All the shop
scoping is gone (helpers dropped, policy restored, picker removed); the
`shop_source` / `managed_shop_sources` columns remain inert and unread.
**Do not re-add a source scope without being asked.**
**Where**: `supabase/migrations/0093_*.sql` (added) and `0094_*.sql` (reverted).

---

## Module-scope caches make an in-place account switch show two accounts at once — reload instead of teaching every module to reset

**Symptom**: switching accounts in the admin app leaves the previous account's
data on screen — a stale projects list, the old shop state, a section the new
account cannot open.
**Cause**: the account switcher swaps the Supabase session *in place*
(`setAuthSession`) and lets the `onAuthChange` subscriber repaint. But every
feature module holds module-scope caches (`cache.projects` + the seenAt map,
shop `state`, PR/VS lists, the team tree, `initialSectionApplied`) written for a
page that serves ONE account for its lifetime. Nothing resets them, and the next
module added will have the same gap by default.
**Fix**: `admin-main.js` records `bootUserId` on the first signed-in fire; if
`onAuthChange` later reports a DIFFERENT non-null id, `location.replace(pathname)`
— hard reload, hash dropped (a deep link like `#projects/PRJ-XXXX` may be a
section the new account cannot open) and no back-history entry into a page
rendered for the previous account. Gated on `bootUserId` being set, so an
ordinary first sign-in (null → user) does NOT reload, and on the id CHANGING, so
the 25-minute token refresh — which re-fires with the same id — does not either.
**Rule**: prefer one reload over N cache-reset call sites when identity changes
underneath a long-lived page. The reset approach is correct exactly once and then
rots with every module you add.

---

## A seat that grants a SHARED role must not be modelled as a new individual — the อาจารย์ seat built a private desk instead of opening the existing one

**Symptom**: "on saprof there are 11 shown in ทั้งหมด, but on my kkumail granted
อาจารย์ in ทีม SAMO it shows 0." Both accounts resolve to `sa_prof`; the grant,
the seat resolver and the RLS all check out. Easy to answer "working as designed
— nothing has been sent to you yet", and that answer is *technically* right and
*practically* wrong.
**Cause**: every prof gate keyed on `sign_requests.prof_id = auth.uid()` —
`prof_can_see_document/_project/_file`, the sign-request read+update policies,
`scopeProjectsForRole()`, `docPendingSignForProf()`, and the file filter in
`loadFilesForDoc`. So the seat produced **a brand-new professor with an empty
desk**, when what the org wanted was **access to the professor's desk**. The
other two seats already behaved the second way (`staff` sees what sastaff sees,
`vpa` what samomdkkuvpa sees) because uni_staff and vp_admin are not per-person
filtered — prof was the only per-uid one, so the inconsistency was invisible
until someone held the seat.
**The signal I should have caught earlier**: this org runs SHARED department
accounts and the repo already records "don't design per-person assignee/roster
features". A per-uid recipient IS a per-person assignee. When a seat exists to
let a real person occupy a shared institutional role, "scoped to me" is the
wrong default — the role is the unit, not the individual.
**Fix (0095)**: the helpers now ask "am I อาจารย์, and was this sent for
signature at all?" `current_user_is_prof()` stays INSIDE each helper — the
policies OR them in, so a helper that ignored the caller would hand every
signature-requested document to any authenticated user. Frontend filters follow
the same rule.
**What deliberately did NOT change**: a professor is still not a project actor.
They see only หนังสือ carrying a signature request (11 of 26 live), never the
other 15, and inside a requested หนังสือ still only the requested + signed files,
never the private drafts. Making prof an actor exposes all 26 — rejected in 0086,
still rejected. Proof `tools/prof0095-seat-parity.mjs` asserts BOTH halves: same
desk as saprof, AND still cannot create a project or request a signature.
**Tradeoff written down**: every อาจารย์ now sees every signature request, so two
professors would see each other's. Correct for one shared role, wrong the day
per-professor privacy is wanted — and the fix then is the uid check PLUS a "which
professor am I" dimension, not a plain revert (which would empty the seat again).
**Rule**: when adding a seat/grant that lets an individual act as a shared role,
ask "should this person see what the shared account sees, or start empty?" for
EACH surface. If the answer is "the same", any `= auth.uid()` predicate on that
surface is a bug in waiting — and it will look like correct behaviour, because an
empty inbox is indistinguishable from a working one with nothing in it.

---

## A row-level UPDATE policy with no column guard let a SUBMITTER self-publish to the public board — the curation gate lived in an RPC the policy routed around

**Symptom**: none reported. Found while adding a "public" rung to the VS remark
visibility ladder (0096) and asking "who can actually write this field?".
**Cause**: `vs_tickets_update_owner` (0009) is
`using/with check (submitter_id = auth.uid())`. RLS is ROW-level — once the row
check passes, PostgREST writes ANY column in the body. 0072 put the publishing
gate inside `vs_set_public()` (SE-only, rejects confidential categories,
requires an SE-written headline) and its invariant #2 says "a student's raw
report is NEVER published verbatim" — but nothing stopped a student PATCHing
the columns that function guards. Proven live in a rolled-back transaction as a
real submitter's uid:
```
update vs_tickets set is_public=true, public_title='SELF-PUBLISHED', category='facilities'
 where id = <their own ticket>;                    → UPDATE ACCEPTED
get_public_vs_board(...)                           → 1 row
get_public_vs_problem(id) → 'SELF-PUBLISHED'
```
Also self-close (`status`), reroute (`target_dept`), pollute internal triage
(`tags`), and re-link into another thread (`duplicate_of`).
**Fix**: `vs_tickets_self_update_guard` (0096), the 0028 pattern with the 0041
lesson applied — it fires ONLY when `auth.uid() = old.submitter_id` and the
caller is not a VS handler, so server contexts (null `auth.uid()`: migrations,
definer RPCs, the cascade trigger, `tools/*.mjs` over the Management API) are
untouched. Two details worth copying:
- Compare `to_jsonb(old) - allowed_keys` against `to_jsonb(new) - allowed_keys`
  instead of a hand-written column list, so a column added by a FUTURE
  migration is guarded BY DEFAULT (fails closed).
- Exclude `is_duplicate` from that comparison: it is `GENERATED ALWAYS`, and
  Postgres computes generated columns AFTER before-row triggers, so
  `NEW.is_duplicate` is NULL while `OLD` holds the stored value. Comparing them
  rejects every write. (`updated_at` likewise — the touch trigger fires first,
  't' < 'v' by name.)
- Remarks are append-only + capped, and appended entries must be `vis:'ticket'`
  authored by `'ผู้แจ้งปัญหา'` — otherwise a submitter appends
  `{"vis":"public","by":"เจ้าหน้าที่"}` and it renders on the board as a staff
  progress update.
**Where**: `supabase/migrations/0096_vs_remark_visibility.sql` §6; proof
`tools/vs0096-remark-vis.mjs` (27 checks).
**Rule**: whenever a table's write authorization is "call this RPC, it checks
things", grep for a per-row UPDATE policy on the same table. If one exists, the
RPC is advisory and the real interface is `PATCH /rest/v1/<table>`. Every column
that RPC validates needs a column guard, or the validation is decorative. Same
family as the `public.users` `role` self-promotion entry above — that one was
found in 2 tables, this is the third; **audit any `for update using (<col> =
auth.uid())` policy the moment the table gains a column the owner must not set.**

---

## Adding a DELETE to reference data turns every `coalesce(<flag>, false)` lookup into a live fail-open — the dangling id is the new input nobody wrote for

**Symptom**: none reported — found by asking "what reads this table?" before
shipping a delete button for หมวดหมู่ (`vs_categories`), the same affordance
`vs_tags` had just been given.
**Cause**: `vs_tickets.category` is loose text with NO foreign key — 0072's
deliberate choice so retiring a category can never break a ticket. Correct, but
it means deleting a row creates DANGLING references, an input that did not exist
while the table was append-only. Four readers resolve `is_confidential` from
that id; three failed closed and one did not:
```
get_public_vs_board     inner join vs_categories          → row vanishes  ✔
vs_post_public_comment  coalesce(c.is_confidential, true) → refused       ✔
vs_set_public           coalesce(v_conf, true)            → refused       ✔
get_public_vs_problem   coalesce(v_conf, FALSE)           → GATE PASSES   ✗
```
Measured live in a rolled-back transaction, on a confidential ticket left at
`is_public = true` — a state the app reaches ON PURPOSE (staff may move an
already-published ticket into a ความลับ category; the modal confirms "จะซ่อนจาก
กระดานทันที" and relies entirely on the read layer, which is exactly what
0072's isolation test asserts):
```
BEFORE deleting the category   on_board=0  detail=NULL (hidden)   ✔
AFTER  deleting the category   on_board=0  detail='ไม่ควรแสดง'    ✗ SERVED
```
So an ordinary admin action — deleting the confidential category — would have
un-hidden the curated projection AND the whole public comment thread of every
ticket in it.
**Fix**: `coalesce(v_conf, true)` (0098). An id that cannot be resolved is
treated as confidential. This also makes the DETAIL agree with the LIST for the
first time; previously a dangling category meant "absent from the board but
reachable by direct id", a split no caller could have predicted.
**Where**: `supabase/migrations/0098_vs_unknown_category_fails_closed.sql`;
proof in `tools/vs0096-remark-vis.mjs` (the CATEGORY DELETE block).
**Rules**: (1) Before adding DELETE to any reference table, grep every reader of
the referencing column and check what each does with an id that no longer
resolves — `coalesce(flag, false)`, `left join`, and `if not found then` are the
three shapes that fail open. (2) When several readers ask the same question, they
must agree on the unknown case; a table where three say "closed" and one says
"open" is not a design, it is a bug that has not been reached yet. (3) A loose
reference with no FK is fine, but it makes the DEFAULT for a missing row a
security decision — write it down at every call site.

---

## The row-level-UPDATE-without-a-column-guard class, found on a THIRD table — this time it was money

**Symptom**: none reported. Found by asking, as a sweep rather than a hunch,
"which tables have a per-row owner UPDATE policy and NO column guard?"
```sql
select p.tablename, p.policyname,
       (select count(*) from pg_trigger t
         where t.tgrelid=(quote_ident(p.schemaname)||'.'||quote_ident(p.tablename))::regclass
           and not t.tgisinternal and t.tgname ~ 'guard') as guards
from pg_policies p where p.schemaname='public' and p.cmd in ('UPDATE','ALL')
  and coalesce(p.qual,'') ~ 'auth\.uid\(\)';
```
**Cause**: `shop_orders_update_self_early` (0003) is
`using (buyer_id = auth.uid() and status = any(array['pending','review','slip_mismatch']))`
with **no `with check`** — so Postgres reuses USING as the check, which is the
only reason a buyer cannot self-approve to `paid`. But inside that window RLS
grants EVERY column. Proven live on a real buyer's own ฿520 pending order:
```
update shop_orders set total=0, subtotal=0, fee=0                    → ACCEPTED
update shop_orders set admin_note='PAID IN FULL - verified by staff',
       timeline='[{"by":"admin","text":"ชำระเงินแล้ว"}]'             → ACCEPTED
update shop_orders set status='paid'                                 → blocked ✔
```
So: place an order, zero the total, forge an `admin_note` and a timeline entry
attributed to "admin", upload any slip — it reaches the verify queue showing ฿0
due with staff-looking corroboration.
**Fix**: `shop_orders_self_update_guard` (0100), same construction as
`users_self_update_guard` (0028/0041) and `vs_tickets_self_update_guard` (0096)
— deny-by-default via `to_jsonb(row) - allowed_keys`, firing only when
`auth.uid() = old.buyer_id` and the caller is not a shop admin.
**The half that mattered more than the guard**: the allow-list came from
READING THE THREE BUYER CALL SITES in `src/js/shop/api.js` (`enrichNewOrder`,
`addOrderSlip`, `removeOrderSlip`) — not from guessing — and
`tools/shop0100-buyer-guard.mjs` replays all three and asserts they still
succeed. A guard that breaks checkout is worse than the hole it closes.
**Where**: `supabase/migrations/0100_*.sql`; proof `tools/shop0100-buyer-guard.mjs`
(12 checks: 5 attacks blocked, 3 buyer flows intact, admin + server unaffected).
**Rule**: this class has now appeared on `users`, `vs_tickets` and
`shop_orders`. Treat `for update using (<col> = auth.uid())` as **incomplete by
construction** — it is a row filter, never a column policy. `tools/security-sweeps.mjs`
sweep #3 keeps the list honest; two low-severity rows
(`project_doc_views`, `project_notifications` — self-defacement only, `user_id`
pinned by the check) are knowingly accepted, not missed.

---

## Two implementations of one rule drift silently — diff them, don't eyeball them

**Symptom**: none. The 0096 visibility ladder is implemented twice —
`public.vs_remark_vis()` as the server boundary and `remarkVis()` in `utils.js`
for rendering — and STATE.md dutifully said "mirrors, keep them in step". That
sentence is not a mechanism.
**Cause**: a differential test over 26 input shapes found 3 disagreements. The
SQL accepts `'t'`, `'1'` and numeric `1` as truthy for the legacy `internal`
flag (`lower(e->>'internal') in ('true','t','1')`; jsonb `->>` stringifies, so
`1` arrives as `'1'`); the JS accepted only `true` and `'true'`.
**Severity**: fails SAFE — the server strips the entry as staff-only and the
client never sees it. The reverse direction (JS believing an entry is
staff-only while the server ships it) would have rendered a staff note to a
submitter. No live row uses those shapes; the app writes `internal: true`.
**Fix**: JS now matches the SQL truthy set exactly, pinned in
`utils.test.js`, and the differential test is permanent:
`tools/vs-remark-vis-mirror.mjs` runs every legal + malformed shape through
BOTH and diffs.
**Rule**: when one rule is implemented on both sides of the wire, write the
differential test the same commit. And when reviewing one, state which
direction of disagreement is the dangerous one — here "JS stricter than SQL" is
safe and "SQL stricter than JS" is a leak, and only the test can tell you which
you have.

---

## An `ILIKE` lookup makes the id a PATTERN, not a capability

**Symptom**: none reported. Found while sweeping `setof <table>` RPCs for the
0080 auto-expose trap.
**Cause**: `get_pr_ticket_by_id` (0021) was
`select * from pr_tickets where id ilike p_id … limit 1` — ILIKE presumably to
make a hand-typed id case-insensitive. But ILIKE hands the CALLER pattern
syntax, and the function is granted to `anon`. With nothing but the bundled
anon key:
```
POST /rest/v1/rpc/get_pr_ticket_by_id {"p_id":"%"}
  → PR-68TE3N, submitter_label "…@gmail.com", submitter_id, brief, file_url
```
`limit 1` bounds one call; an attacker walks `'PR-A%'`, `'PR-B%'`, … to
enumerate every id and then reads each in full. The entire guest-lookup design
rests on "the id IS the secret". The VS twin uses `=` and was unaffected —
verified with the same probe.
**Fix**: `lower(id) = lower(btrim(p_id))` (0101) — keeps the case-insensitivity
ILIKE existed for, drops the pattern semantics, still resolves a pasted id with
whitespace.
**Also found in the same sweep**: the ten `effective_team_*_for_email` /
`node_effective_*` resolvers were executable by `anon`/PUBLIC, i.e. an
anonymous oracle — `{"p_email":"…@kkumail.com"}` returned that person's exact
grant set. Nothing outside SQL calls them (the frontend only names them in
comments) and their real callers are SECURITY DEFINER, so they were revoked
from anon/authenticated/PUBLIC. `sync_my_team_permissions()` KEEPS its
authenticated grant — `auth.js` calls it every login and it only resolves the
caller's own identity.
**Rule**: in any lookup where the id is the authorization, the comparison must
be `=` (or `lower(x)=lower(y)`) — never `like`/`ilike`/`similar to`/`~`. And
when granting a helper to `anon`, ask what it answers about someone who is NOT
the caller.

---

## …and the sweep that entry prescribed found a FIFTH reader — a `left join` fails open the same way a `coalesce(flag,false)` does

**Symptom**: none reported. Found one commit after the entry above, while
extending `get_vs_linked_context()` for a feature — by re-reading its
"is the canonical publishable" predicate with the delete button now in mind.
**Cause**: 0075 computed it over a LEFT JOIN as
```sql
(coalesce(c.is_confidential, false) or not coalesce(c.public_eligible, true))
```
Both defaults point the wrong way, so a deleted category (c.* all NULL) makes
`blocked` FALSE. Measured live on a confidential canonical + its duplicate:
```
BEFORE deleting the category  {"linked":true,"public":false,"related_count":2}
AFTER  deleting the category  {"linked":true,"public":true,
                               "public_id":"VS-TSTCTXA",
                               "public_title":"หัวข้อลับของเรื่องหลัก",…}
```
It hands the duplicate's submitter the CONFIDENTIAL canonical's id and title —
the exact disclosure 0071/0074/0075 exist to prevent, and the id is a lookup
capability (`get_vs_ticket_by_id` is granted to `anon`).
**Why it was missed**: 0098's header said "grep every reader of the referencing
column", and I grepped the four PUBLIC BOARD readers — the ones I was already
thinking about. `get_vs_linked_context` reads the same column for a different
audience (the submitter tracking view), so it never came to mind. The rule was
right; the search was scoped by feature area instead of by column.
**The sweep that actually works** — mechanical, no judgement about which
feature a function belongs to:
```sql
with fns as (select oid, proname from pg_proc p
             join pg_namespace n on n.oid=p.pronamespace
             where n.nspname='public' and p.prokind='f')   -- prokind: functiondef throws on aggregates
select proname, pg_get_functiondef(oid) from fns
 where pg_get_functiondef(oid) ~ 'is_confidential|public_eligible';
```
Seven hits; six were closed (four inner joins, two `coalesce(...,true)`), this
was the seventh. Full audit table is in 0099's header.
**Fix**: `coalesce(is_confidential, TRUE)` and `coalesce(public_eligible,
FALSE)` (0099). Note a LEFT JOIN is the same hazard as `coalesce(flag,false)`
wearing different clothes — it is what MAKES the row NULL-able in the first
place; an INNER join would have failed closed for free.
**Where**: `supabase/migrations/0099_vs_self_public_context.sql`; proof in
`tools/vs0096-remark-vis.mjs` (BOARD CONTEXT block).
**Rule**: when a fix's own lesson is "audit every reader", run the audit as a
QUERY over `pg_get_functiondef`, not as a mental list of the callers you happen
to be holding. And treat `left join <reference table>` as a fail-open marker
wherever the joined row gates visibility.

---

## Recreating a function from the migration that FIRST defined it silently reverts every later one

**Symptom**: `tools/vs0083-scope.mjs` went 15/16 immediately after applying an
unrelated feature migration — "board: reads staff-only comment on OWN dept"
failed with `is_handler=true, reads_own=false`. Nothing in the new migration
mentioned scopes or handlers.
**Cause**: 0096 needed to add an `updates` key to `get_public_vs_problem`, so it
was written by copying that function's body out of `0078_vs_staff_only_comments.sql`
and editing it. But the function had been redefined AGAIN in
`0084_vs_board_scoped_handler_is_staff.sql`, which added `v_scope
text[] := current_user_vs_scope()` and two comment-visibility branches. Copying
0078's body and `create or replace`-ing it dropped 0084's work — a clean apply,
no error, and the only signal was a proof script from three migrations ago.
`create or replace function` has no "are you sure you're editing the latest
version" check; the file you read is not necessarily the definition that is live.
**Fix**: before re-creating ANY existing function, diff against the LIVE body:
```sql
select pg_get_functiondef(p.oid) from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname='public' and p.proname='<fn>';
```
and/or `grep -ln "function public.<fn>" supabase/migrations/*.sql` to find every
file that defines it — the LAST one is the base to edit. 0096 also touched
`get_public_vs_board` (last defined 0078 ✔) and `get_vs_ticket_by_id` (last
defined 0080 ✔); only the one with a THIRD definition bit.
**Where**: `supabase/migrations/0096_vs_remark_visibility.sql` §5 (now carries a
"BASED ON 0084's BODY" note naming the trap).
**Rule**: the migrations directory is an append-only log, not a source tree —
the newest definition wins and older files are actively misleading. Re-run the
proof scripts for the FEATURE AREA after any function rewrite, not just for the
thing you were changing; that is the only thing that caught this.

---

## A path-only router silently discards sub-state — and its own tab handler is what clears the hash you just wrote

**Symptom** (reported): "when I'm in ติดตามสถานะ inside a ticket and I reload to
see refreshed progress, it switches to กระดานปัญหา, and when I tap ติดตามสถานะ I
have to โหลดประวัติของฉัน and tap the ticket again." Reloading is the natural way
to check for progress on a ticket, so the app threw away the user's place at
exactly the moment they most wanted it kept.
**Cause**: the public site routes by PATH (`PATH_ROUTES` in `main.js`:
`/vssound` → the VS tab). Everything below a tab — which of the three VS modes
is showing, which ticket/problem is open — lived only in DOM state. Nothing
persisted it, so a reload rebuilt the default (board) view.
**Fix**: the hash carries the sub-state (`#track`, `#track/VS-XXXX`,
`#problem/VS-XXXX`, `#report`) in a small `vs-route.js`. The hash was free —
nothing else in the public bundle reads or writes it.
**Three traps that cost real debugging time:**
1. **The path router clears the hash on every tab activation.** Its
   `shown.bs.tab` handler does `history.pushState(null, '', tabToPath(target))`
   — a bare pathname, so the hash is dropped. Leaving the VS tab and returning
   left the URL saying "board" while the DOM still showed ติดตามสถานะ, and a
   reload then obeyed the URL. Fixed by re-syncing the URL FROM the live view
   on re-entry (`syncRouteFromView`) — sync the URL to the view, not the view
   to the URL; the user's place is the thing worth keeping. It must run in a
   `setTimeout(…, 0)` because the path router's listener is registered LATER in
   main.js but fires in the same synchronous `shown.bs.tab` chain.
2. **Every hash write fires `hashchange`**, which re-enters the router. Guard
   with a `lastWritten` value compared on the way in, plus an `applying` flag.
3. **Never decide "is the user signed in" before `authReady`.** On a cold
   reload `getUser()` is null for a perfectly valid session, so restoring
   `#track/<id>` immediately would always take the signed-out path. `await
   authReady` first, then fall back to the by-id guest lookup — which grants
   nothing new, since the id is already in the user's own URL.
**Also**: `replaceState`, not `pushState`. The mode radios are a segmented
control; one history entry per tap makes the back button feel broken.
**Where**: `src/js/vs-route.js`; writers in `vs-form.js toggleVitalSoundMode`,
`vs-tracking.js` (`openTicketDetail` / `trackWithTicketId` / `logoutTrack`),
`vs-board.js` (`vsBoardOpen` / `vsBoardBack`). Writers call `window.vsSetRoute`
rather than importing, to avoid a cycle (vs-route imports those modules).
**Rule**: any view a user would REFRESH to update needs its identity in the URL.
And when adding sub-state under an existing router, check what that router does
to the URL on navigation — a handler that rewrites the whole path will erase it.

---

## A modal that closes on save makes every edit a round trip — refresh in place instead

**Symptom** (reported): "when บันทึกข้อมูล on a VitalSound ticket it closes the
ticket and I have to keep opening it again — I think it's for refresh, but I
want better UX."
**Cause**: `submitStaffAction` ended with `alert('อัปเดตข้อมูลสำเร็จ!')` →
`modal.hide()` → `fetchStaffTickets()`. Closing was doing the work of
*refreshing*: the only way to see the new timeline entry was to reopen the
ticket, because the modal's content is rendered once at open time. So every
status bump and one-line remark bounced the staffer back to the kanban to find
the ticket again — and the success `alert()` was a blocking dialog on top of a
modal, for the happy path, on every single save.
**Fix**: `await fetchStaffTickets()` (which repaints the kanban behind the
modal), then re-render the modal from the fresh row and report success inline in
the footer. Closing becomes the ปิด button's job, i.e. the user's choice.
Re-rendering while shown is safe *only* because `openStaffModal` ends in
`bootstrap.Modal.getOrCreateInstance(el).show()`, which no-ops on an open modal
— `new bootstrap.Modal(...)` there would stack a second backdrop (see the
stacked-backdrop entry). Guard the case where the refetched cache no longer
contains the ticket (transferred to a dept this user can't see, or deleted
concurrently): hide the modal rather than rendering stale data.
**Where**: `src/js/vs-staff.js` `submitStaffAction` / `reopenCurrentTicket` /
`staffSaveStatus`; `#staffSaveStatus` in `src/html/modal-vs-staff.html`.
**Rule**: if a dialog closes itself after a write, ask whether it is closing
because the user is *done* or because the code has no way to refresh in place.
The second is a bug wearing a feature's clothes.

---

## A manager modal opened ON TOP of a form must repaint that form's inputs — the vocabulary it edits was rendered once, at open time

**Symptom** (reported): "after I จัดการหมวดหมู่ → add a หมวดหมู่, I can't select
the one I added immediately — I have to close the ticket and open it again."
**Cause**: `#staffCategory` / `#staffPubCategorySel` are filled ONCE by
`fillStaffCategorySelect()` inside `openStaffModal()`. The category manager is a
stacked modal opened over that still-open ticket, and after a write it repainted
the kanban facet, the publish panel and its own list — but never the two selects
underneath it. So the new row existed everywhere except the control the user
opened the manager in order to use. The TAG manager next door had it right
(`refreshTagsAfterMutate()` re-fills the open ticket's tag editor); the category
manager was simply never given the equivalent, and the gap is invisible unless
you use the two features back to back.
**Fix**: `refreshCategoriesAfterMutate()`, called from add / patch / delete
alike. Two details that matter more than the repaint itself:
- **Preserve the pending selection.** `fillStaffCategorySelect()` resets the
  selects to the ticket's SAVED category, so a naive re-fill throws away an
  unsaved pick the user made just before opening the manager. Snapshot
  `sel.value`, re-fill, restore it if that option still exists (it won't if they
  just deleted it).
- **Do NOT auto-select the newly added category.** It is what the user
  "obviously" wants, but category drives confidentiality and board eligibility,
  so auto-selecting silently stages a re-classification on a ticket they only
  meant to add vocabulary for. Make it available in one click and say so in the
  status line instead.
**Where**: `src/js/vs-staff.js` `refreshCategoriesAfterMutate` (+ `vsCatAdd` /
`vsCatPatch` / `vsCatDelete`); the pattern to copy is `refreshTagsAfterMutate`.
**Rule**: whenever a modal edits the VOCABULARY that a form behind it renders as
options, list every control that consumed that vocabulary and repaint all of
them — the one you forget is usually the one the user opened the modal to fill.

---

## Attribute-driven visibility: check that EVERY value in the markup has a handler, and which way an unhandled one fails

**Symptom class** (three instances found in one sweep): an element gated by a
`data-*` attribute is shown to the wrong people, or to nobody, because the JS
that toggles it doesn't know that attribute value.
**The sweep** — cheap, run it whenever a role/permission is added:
```sh
grep -rho 'data-projects-role="[^"]*"' src/html/*.html | sort -u   # values in markup
grep -n  'data-projects-role='          src/js/projects/index.js   # values with a handler
```
Repeat for `data-admin-side` (vs `SIDE_FEATURE`), `data-role-only`,
`data-perm-only`, `data-admin-pane` (vs `SECTION_META`).
**Which way it fails depends on the markup, and that is the part to check first:**
- `#projectsGridEmpty` spans carry NO `d-none` → the JS hides by ADDING it → an
  unhandled value **fails OPEN** (visible to everyone). This bit: a new
  `data-projects-role="sa_prof"` span with no matching `querySelectorAll` block
  would have shown professor copy to vp_admin as well.
- The article edit/delete buttons DO carry `d-none` → **fails CLOSED**. Safer,
  but it hides the bug: the buttons were gated `data-role-only="pr_staff dev"`,
  so a ทีม SAMO `creator` grantee (role='user') never got them even though
  `announcements_write` lets them edit. Replaced with `data-perm-only="creator"`,
  resolved through `userCanAccess()` so role defaults, `permissions[]` and the
  tree all count.
**Also found the same shape in plain JS**, not attributes: the inbox bucket
empty-copy was `role === 'uni_staff' ? A : B`, so อาจารย์ silently got the
vp_admin wording ("ไม่มีหนังสือถูกตีกลับให้แก้") for a bucket that for them means
รอลงนาม. A two-way ternary on a three-role system is the same missing-handler bug
with no attribute involved.
**Rules**: (1) prefer `d-none`-in-markup + opt-in showing, so an unhandled value
fails closed. (2) Gate on a CAPABILITY (`data-perm-only` → `userCanAccess`) not a
role list, or every ทีม SAMO grant works except at that one control. (3) Any
`role === 'x' ? … : …` is a missing branch as soon as a third role exists — grep
for them after adding a role.

---

## An UPDATE that moves a row OUT of your own SELECT policy fails with the WITH-CHECK error — the read policy is re-applied to the NEW row, so a handoff is un-PATCHable

**Symptom** (reported): a dept-scoped VitalSound handler picks "โอนคืน SE" and
gets `บันทึกไม่สำเร็จ: {"code":"42501", …"new row violates row-level security
policy for table \"vs_tickets\""}`. Every other save on the same ticket works.
**The trap is the error message.** It names the WITH CHECK failure mode, so you
go read the UPDATE policy — and `vs_tickets_update_staff`'s WITH CHECK (0082)
*explicitly* permits SE:
`... or (current_user_role() = 'vp_admin' and target_dept = any(array[current_user_dept(),'SE']))`.
It is not lying. Three separate proofs that the UPDATE policy passes:
evaluating the expression pulled straight from `pg_policy` returned **true**; a
probe wired in as `(<orig>) or _dbg_raise(…)` **never fired** for `'SE'` while
firing correctly for a genuinely-forbidden other-dept value; and rewriting it to
`with check (true)` **with every user trigger disabled** produced the same 42501.
That last one is the experiment to reach for early — it costs one query and
rules the whole policy out.
**Cause**: Postgres re-applies the **SELECT** policy to the NEW row on UPDATE and
reports the failure with WITH-CHECK wording. `vs_tickets_read` scopes a handler
to their own dept (`target_dept = current_user_dept()` /
`= any(current_user_vs_depts())`), so the instant `target_dept` becomes `'SE'`
the row leaves the writer's visibility. Confirmed by widening ONLY
`vs_tickets_read` to `using (true)`, both UPDATE policies untouched: the very
same statement returns `rows=1`. This is the UPDATE flavour of the
`INSERT … RETURNING` entry above — and it does **not** need `RETURNING`; a bare
plpgsql `update` reproduces it.
**The general shape**: any UPDATE whose *whole purpose* is to move a row out of
your scope cannot satisfy a SELECT policy keyed on that scope. Handoffs,
reassignment, transfer-of-ownership, "release back to the pool" — all
structurally un-PATCHable. And the read policy is CORRECT (you handed the ticket
off; you should not keep reading it), so widening it is the wrong fix.
**Fix**: route the move through a SECURITY DEFINER RPC that re-applies the same
predicate the UPDATE policy encodes — the pattern already used for soft-delete
(0043/0045), publish (0072) and merge (0083). `vs_transfer_dept(p_id, p_dept,
p_remarks)` (0107). RLS is unchanged; nothing gains a new read. Two details
worth copying: it takes the timeline array so the move + its log land in ONE
statement, and the client withholds the "โอนย้ายฝ่าย: X → Y" entry from the
preceding PATCH so a refused transfer can never leave a timeline claiming a
handoff that did not happen. `p_dept` is null/blank-checked BEFORE the
`any(scope)` tests — `null = any(...)` is NULL and `if not (NULL) then` does not
take the branch, so a null destination would otherwise have blanked the column
(the recurring fail-open, again).
**The sweep for the rest of the class** — run it whenever a SELECT policy starts
keying on a mutable column:
```sql
select s.tablename, s.qual from pg_policies s
 where s.schemaname='public' and s.cmd='SELECT' and s.qual !~ '^\(?true\)?$'
   and exists (select 1 from pg_policies u where u.schemaname='public'
                and u.tablename=s.tablename and u.cmd in ('UPDATE','ALL'));
```
then ask of each: *does the qual reference a column this writer can change?*
Done 2026-07-31 — 22 tables, `vs_tickets.target_dept` was the only live
instance. Every other narrow SELECT qual keys on the writer's own
role/permission (`announcements`, `pr_tickets`, `shop_*`, `project_*`) or on a
column the write policy pins (`user_id`, `buyer_id`), so the new row is always
still visible to whoever wrote it.
**Where**: `supabase/migrations/0107_vs_transfer_dept_rpc.sql`;
`src/js/vs-staff.js` `submitStaffAction`; proof `tools/vs0107-transfer.mjs`
(26 checks, both principal shapes — the shared vp_admin account AND a ทีม SAMO
grantee with `managed_vs_depts`).
**Two follow-ons this exposed, both worth the habit:**
1. *A client pre-guard that only half-mirrors the server is a worse error
   message, not a guard.* The warning fired only for `อุปนายก*` destinations, so
   `คณะ` / `นายกสโม` skipped the friendly Thai text and hit the raw RLS error.
   If you write a "catch it before the request" check, mirror the server
   predicate exactly.
2. *A modal that closes itself on success reads as a failure.* After a handoff
   the ticket leaves the user's view, `reopenCurrentTicket()` hides the modal,
   and the inline footer confirmation was being written into something the user
   could no longer see. Say what happened out loud whenever the thing the user
   was looking at disappears as a RESULT of what they did.

---

## A directional action whose direction lives ONLY in a label on the other party's row gets read backwards — and offering just one direction turns an N-item job into N searches

**Symptom** (reported): "when I want a ticket to be a subticket, `รวมเข้าเรื่องนี้`
— the user is confused, they think the current ticket is the master and the
listed one becomes the subticket." Exactly inverted from what it did.
**Cause**: the merge panel had ONE direction, stated nowhere except a button
label sitting on the OTHER ticket's row. "รวมเข้าเรื่องนี้" = "merge into THIS
one" — and `นี้` has no fixed referent: read on the row it means the row, read
by someone who just opened a ticket it means the open ticket. The action took
the second reading and did the opposite of it. A demonstrative pronoun in a
button label is ambiguous BY CONSTRUCTION whenever the button sits on one of
the two things it could refer to.
**The second half, which the user found by using it**: with only the
duplicate→canonical direction, merging 10 tickets into one main meant opening
each of the 10 and re-searching for the main every time. The workflow existed
only from the side that happens to be *one* ticket, so the bulk case — which is
the common one when curating a known main — was N× the work.
**Fix**: (1) direction is an explicit MODE, restated as a sentence naming the
open ticket's id and what happens to it; (2) every button names what the ROW
becomes (`เลือกเป็นเรื่องหลัก`), never what "this" does; (3) BOTH directions
ship — push (the open ticket becomes a duplicate; one target ⇒ a button) and
pull (ticked tickets become duplicates of the open one; many targets ⇒
checkboxes + one bulk action). Same `merge_vs_tickets(p_dup, p_canonical)`,
only the argument order differs — no migration.
**Where**: `src/js/vs-staff.js` (`mergeDir` / `mergeTargetRow` /
`renderMergeDirection` / `onPullMergeClick`), `src/html/modal-vs-staff.html`,
`src/css/vs-admin.css`.
**Three details worth reusing for any bulk action:**
- *Pre-empt the refusals the server will make.* `merge_vs_tickets` rejects a
  source that already owns duplicates. In pull mode that row is locked with the
  reason ON the row, rather than letting the user tick it and collect an error.
- *Bulk ≠ atomic.* Each merge is independently meaningful, so 8-of-10 is a
  correct outcome, not a broken transaction — sequential calls, per-ticket
  failure report. What is NOT acceptable is a silent partial.
- *A selection is scoped to the thing it was made in.* It is cleared when the
  modal opens another ticket; otherwise it silently follows the user into a
  different cluster and the next click merges the wrong things.
**Rule**: whenever an action relates two records asymmetrically (merge, link,
parent, supersede, assign), the UI must name BOTH sides and which one changes —
never rely on "this"/"นี้"/"here". And ask which side the user will be looking
at when they start the task: if it can be either, both directions need to
exist, and the many-to-one side needs multi-select or it is N separate jobs.

---

## Debugging note: `tools/db-query.mjs` COMMITS — a probe with `limit 1` and no `ORDER BY` will mutate a real row

**Symptom**: while reproducing the RLS bug above, a probe that did
`update vs_tickets set target_dept='SE' where id = (select id … limit 1)` under
a widened policy reported `rows=1` — and moved a **real production ticket** into
SE. Caught only by diffing `select target_dept, count(*)` against a snapshot
taken before the session.
**Cause**: `db-query.mjs` posts to the Management API `database/query` endpoint,
which runs the string as ONE implicit transaction and **commits**. Its header
says "READ-ONLY" as a statement of intent, not an enforced mode. A plpgsql
`begin … exception when others` block only rolls back the failing *sub*
transaction; every probe that SUCCEEDED persisted.
**Fix / how to probe safely**:
- Every proof script in `tools/` ends its Management-API call with `rollback;`
  for exactly this reason. Do the same for ad-hoc investigation — it is one word.
- Snapshot the shape you are about to disturb (`select <col>, count(*) … group
  by 1`) BEFORE the first write probe, and diff it after. That snapshot is what
  turned "everything looks restored" into "one ticket is in the wrong dept".
- `where id = (… limit 1)` with no `ORDER BY` picks a DIFFERENT row per call, so
  verifying "the ticket I touched" by id proves nothing about the one an earlier
  probe touched.
**Restoring**: the ticket's own timeline said which dept it belonged to. Reverted
with `touch_vs_tickets_updated_at` disabled so the restore did not stamp a third
bogus `updated_at`, and set `updated_at` back to the last genuine event.

---

## `convertDriveUrl(url, size)` silently ignores `size` for an already-lh3 URL — so every "small thumbnail" call site is asking for nothing and getting the stored size

**Symptom** (from a screenshot): the ทีม SAMO member editor's portrait preview
rendered at full size and burst out of the modal, over the fields. The call site
looked right — `convertDriveUrl(url, 320)`.
**Cause, two independent bugs stacked:**
1. `convertDriveUrl` returns EARLY and UNCHANGED for anything already matching
   `googleusercontent.com/d/` — which is exactly what `uploadTeamPhoto` stores
   (it ran the URL through `convertDriveUrl(fileUrl)` at upload time, default
   size 1200). So the `size` parameter is a no-op for every row this app writes;
   it only ever applies to a legacy `drive.google.com/thumbnail` URL. The preview
   asked for `=w320` and was handed the stored `=w1200`.
2. `.team-photo-field` / `-preview` / `-controls` / `-empty` were in
   `tab-team.html` with **no CSS rule anywhere in the repo** — the markup shipped
   without its stylesheet. With no box to fit, a 1200px `<img>` renders at 1200px
   (Bootstrap 5 Reboot does NOT set a global `img{max-width:100%}` — that is
   `.img-fluid`). Either bug alone is survivable; together the image was both
   huge and unconstrained.
**Fix**: use `portraitSrc(url, w, focus)` for any sized derivative — it extracts
the file id and REBUILDS the option string, so it works on lh3, `/file/d/` and
`?id=` forms alike. `convertDriveUrl` is for NORMALISING a URL's form, not for
sizing. Added the missing `.team-photo-*` rules.
**Where**: `src/js/uploads.js` (`convertDriveUrl` vs `portraitSrc`), call sites
in `src/js/team/index.js` `setMemberPhoto` and `src/js/team/terms.js`
`archiveMemberRow`; CSS in `src/css/team.css`.
**Rules**: (1) a function that returns its input unchanged on a fast path must
not also take a parameter that only applies off that path — grep every
`convertDriveUrl(x, n)` with an explicit size, it is almost certainly a no-op.
(2) When new markup ships, grep one class name against `src/css/` before
assuming a layout bug is in the JS; a class with zero rules is invisible in
review and looks exactly like a broken value.

---

## A snapshot table that COPIES a foreign resource id makes the original's delete path destroy history — count references, and count them AFTER the write

**Symptom** (designed out, not observed): adding the long-missing `deleteTeamFile`
so a replaced/removed ทีม SAMO portrait stops orphaning in Drive. The obvious
implementation — trash the file whenever the member's `photo_url` changes —
would silently blank that person's card in a PUBLISHED ปีการศึกษา, months later.
**Cause**: `publish_team_term` copies `m.photo_url` **verbatim** into
`team_archive_members`. The archive is a snapshot of the ROW, but the photo is
not copied — both rows point at the SAME Drive file id. So the live table does
not own that file; it shares it. Deleting through one reference breaks the other,
and the archive is exactly the thing that can never be regenerated. The live data
hid this completely: at the time of writing there is 1 live photo and 0 archived,
so `shared_live_and_archive` measured **0** — the mechanism is in place and
produces the sharing on the next publish, which is the worst kind of latent bug
(a query says you are fine, the code says you are not).
**Fix**: `deleteTeamPhotoIfUnused()` in `src/js/team/api.js` counts references in
`team_members` AND `team_archive_members` and only then calls the GAS delete. Two
details that are the whole point:
- **A failed count must not read as "no references."** `live.error ||
  archived.error` skips the delete — the recurring fail-open shape in this repo.
- **Call it AFTER the row is gone or repointed, never from the form action.**
  Deleting on the นำรูปออก click would destroy a photo the DB still uses if the
  admin then cancels the editor. With the write committed first, the ref-count is
  simply the truth and needs no special-casing for "the row I am editing".
**Where**: `src/js/team/api.js` `deleteTeamPhotoIfUnused`; `appscript/prform.gs`
`handleDeleteTeamFile` (guarded by the existing `fileLivesUnderTop_(file,
'Team')`, and adding no new Google service so the OAuth scopes are unchanged —
see the re-consent entry above); call sites in `team/index.js` `onMemberSubmit` /
`onDeleteMember` and `team/terms.js` `onArchivePhoto` / the archive delete.
**Rule**: before adding a delete path for a row that references an EXTERNAL
resource (a Drive file, an uploaded blob, an S3 key), grep for every table that
copies that reference — a snapshot/archive/audit table usually copies the id
without copying the resource. If one exists, the delete is a refcount, not a
delete. And measuring the current data proves nothing when the sharing is created
by a code path that has not run yet.

---

## When in doubt: check `mistakes.md` before re-implementing

Every entry above represents hours we already spent. If a symptom looks
similar to something here, the fix is probably the same or related.

---

## A VIEW without `security_invoker` reads its base table with the VIEW OWNER's rights — so closing the table's RLS leaves the view still serving the whole thing

**Symptom**: none yet — caught while writing the passport lockdown, one step before
it would have shipped as a false sense of security. The plan closed
`passport.profiles` (`profiles_read_all using (true)` → self-or-admin) to stop anon
dumping 593 students' names + emails. Verified after the change that
`GET /rest/v1/profiles` returns 0 rows for anon. Done, apparently.
**Cause**: `passport.user_tiers` is a plain view over `passport.profiles`, owned by
`postgres`, with `reloptions = null` — i.e. **no `security_invoker`**. A view
without it executes with the privileges of its OWNER, so it never evaluates the
caller's RLS on the underlying table. anon holds SELECT on the view (the schema's
`ALTER DEFAULT PRIVILEGES` grants it automatically). So
`GET /rest/v1/user_tiers?select=*` would have kept returning every student's
`id, full_name, total_km, tier_override, final_tier, has_travel_visa` — plus a
`has_travel_visa` that sub-queries `scans` — with the "fixed" table sitting right
underneath it. Measured live pre-fix: profiles 5 rows / user_tiers 5 rows; the
whole point of the migration undone by an object nobody was looking at.
**Fix**: `alter view passport.user_tiers set (security_invoker = on)` (PG15+; this
project is PG17.6). Landed in the ADDITIVE migration rather than the lockdown,
because while the base policy is still `using (true)` it is a provable no-op — the
dashboard's own-row read behaves identically — which makes it safe to verify early.
**Where**: `passport/db/0010_passport_authz_hardening.sql` §5; asserted by
`tools/pass-hardening.mjs` ("reads 0 user_tiers") and by the external
`tools/pass-anon-probe.mjs`.
**Rule**: before narrowing a table's SELECT policy, list every VIEW over it
(`select c.relname, c.reloptions from pg_class c where c.relkind='v'`) and check
each for `security_invoker=on`. A view without it is a parallel read path that
your new policy does not govern — the same family as "sanitizing ONE read path
leaves the others leaking", except the second path is invisible in `pg_policies`
because a view has no policies of its own.

---

## `revoke all ... from public` does NOT remove an explicit grant to `anon` — and a Supabase schema's DEFAULT PRIVILEGES hand `anon` EXECUTE on every new function

**Symptom**: a new SECURITY DEFINER RPC is written to be admin-only and grants
`execute` to `authenticated` only, preceded by the usual
`revoke all on function … from public;`. It applies clean. `anon` can still call
it. Nothing in the migration hints at why.
**Cause**: two separate facts compounding.
- `PUBLIC` and `anon` are **different grantees**. Revoking from `PUBLIC` removes
  only the implicit world grant; an explicit `anon=X/postgres` ACL entry survives
  untouched. `\df+`-style thinking hides this — you have to read `proacl`.
- The `passport` schema carries `ALTER DEFAULT PRIVILEGES … GRANT EXECUTE ON
  FUNCTIONS TO anon, authenticated` (and, for tables, full `arwdDxtm` to both).
  Confirmed in `pg_default_acl`: `defaclobjtype='f'` → `{anon=X/postgres,…}`. So
  **every function created in that schema is anon-callable the instant it exists**,
  before any grant of yours runs.
Measured: after `revoke … from public` + `grant … to authenticated`,
`proacl` on `stamp_scan` was `{postgres=X,anon=X,authenticated=X}` and
`has_function_privilege('anon', …, 'execute')` was true.
**Fix**: `revoke all on function … from anon;` **by name**, per function, and then
verify from the catalog rather than from the migration text:
```sql
select proname, proacl from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='<schema>' and proname in (…);
```
The two RLS *policy helpers* deliberately KEEP their anon grant: policy expressions
are evaluated with the querying role's privileges, so if `anon` could not execute
`passport.is_admin()` every policy calling it would fail with "permission denied
for function" instead of evaluating to false.
**Where**: `passport/db/0010_passport_authz_hardening.sql` §0 documents the schema's
default ACLs; the explicit anon revokes sit with each `grant`.
`tools/pass-anon-probe.mjs` asserts it over real HTTPS.
**Corollary that is worse than the function case**: the same default privileges
give `anon` full DML on every FUTURE TABLE in that schema. So in a schema like
this, RLS is not defence-in-depth — it is the only defence, and a new table
created with RLS off (or on with a `:: true` policy) is world-writable the moment
it exists.

---

## RLS does not RAISE on UPDATE/DELETE — a proof that asks "did it throw?" scores a fully-blocked write as permitted

**Symptom**: the first run of a new authorization proof reported
`anon cannot update scans -> ALLOWED`, `anon cannot set anyone total_km ->
ALLOWED`, and `CAN still rename self -> ALLOWED` — the last one a pass, the first
two apparently catastrophic. The policies were in fact correct; the *test* was
wrong, in the direction that matters: it would equally have reported ALLOWED for a
genuinely open policy, so it could not tell a closed system from an open one.
**Cause**: RLS filters rows; it does not reject statements. For UPDATE and DELETE a
row the policy hides is simply **not visible**, so the statement succeeds having
touched nothing and no exception is raised. Wrapping it in
`begin … exception when others then 'blocked'` therefore records ALLOWED for both
the permitted case and the fully-denied case. INSERT is the exception that misleads
you into the pattern: a `WITH CHECK` failure IS a real error (42501), so
INSERT probes written this way work, and you generalize from them.
**Fix**: for UPDATE/DELETE assert `ROW_COUNT`, not the absence of an exception:
```sql
update … ; get diagnostics v_rc = ROW_COUNT;
insert into out values('k','rows='||v_rc);
```
then treat `blocked:*` OR `rows=0` as denied, and `rows=N>0` as permitted. The
distinction also makes the assertion honest in the other direction — "the student
CAN still rename themselves" now means one row actually changed, not merely that
nothing exploded.
**Where**: `tools/pass-hardening.mjs` `TRY` (INSERT / RPC probes) vs `TRYN`
(UPDATE / DELETE probes); the 53 checks split along exactly that line.
**Rule**: in any RLS proof, classify each probe by statement type first. Only
INSERT and an explicit `raise` in a definer function fail loudly; SELECT, UPDATE
and DELETE fail *quietly and by row count*. Two more traps from the same script:
the Management API returns **201**, not 200, so a `status !== 200` guard discards a
successful run; and once you `set_config('role', 'anon')` inside a transaction you
must `reset role` at top level before impersonating the next principal, or every
later phase silently runs as anon and "passes".

---

## Moving a read behind an identity-gated RPC breaks every caller that has NO identity — and a client-side password login is exactly that

**Symptom**: the passport admin leaderboard rendered "Could not load leaderboard:
NOT_AUTHORIZED" for every admin using the temporary `admin`/`1234` door,
immediately after a commit that pointed it at
`passport.admin_leaderboard()` — a SECURITY DEFINER RPC guarding on
`passport.is_admin()`. Admins signing in with Google were fine, so it looked like
a permission-data problem. It wasn't: the RPC was correct and the grant was
correct.
**Cause**: `admin`/`1234` is a **client-side string compare** — `legacyLogin()`
compares two literals and sets a localStorage flag. The password never reaches the
server in any verifiable form, so those sessions carry **no Supabase JWT at all**,
`auth.uid()` is null, and `is_admin()` cannot tell them from an anonymous visitor.
The previous code worked only because it read `profiles` directly and
`profiles_read_all` was `using (true)` — i.e. it worked *because* the table was
world-readable. Replacing a world-readable read with an authorization-checked one
is normally the whole point; the trap is that it silently converts "no identity"
from *fine* into *rejected*, and the caller with no identity is the one nobody
lists when enumerating roles.
**This generalises past legacy logins.** Any caller without a session hits the
same wall: a public/guest page, a pre-login step (the passport scan page resolves
an activity BEFORE sign-in), a cron or webhook using the anon key, a server-side
render. Enumerating "which ROLES call this?" misses them all, because their answer
to "which role?" is *none*.
**Fix**: branch on the explicit signal, not on catching the error —
`adminScope.legacy === true` selects the old direct read; a real session uses the
RPC. Catching NOT_AUTHORIZED would work but hides why two paths exist, and would
also swallow a genuine permission bug in the RPC path.
**Where**: `passport/js/admin-page.js` `ensureLbScans` (commit `76dac38`, fixing
`079f422` the same session); the RPC in `passport/db/0010_passport_authz_hardening.sql`.
**The structural half, which is the real lesson**: this also means the lockdown
(`db/0011`) and "keep admin/1234 fully working" are mutually exclusive, and no
amount of policy writing reconciles them — a door that cannot prove who is behind
it cannot be granted anything the anonymous public isn't. The only fix is to give
that door a real identity (sign it into one shared Supabase account) or retire it.
**Rule**: before putting an existing read behind an identity check, list its
callers by SESSION STATE (signed-in / anonymous / no-session-by-design), not by
role. Every caller in the third bucket breaks, and it breaks loudly for users
while looking correct in every test you wrote as an authenticated principal.

---

## `touch-action: none` on a drag handle makes the page unscrollable THERE — so every scroll that starts on a handle becomes a drag

**Symptom** (reported): "on ทีม SAMO on mobile, sometimes I just scroll the phone,
and it accidentally swaps / moves the role." Intermittent, never on desktop, and
it looked like a SortableJS sensitivity problem.
**Cause**: CSS, not the drag library. `.team-handle` carried
`touch-action: none`. That property tells the browser to suppress **every**
default touch gesture on the element — including panning — so a touch that merely
*began* on a handle could not scroll the page at all. SortableJS (no `delay`
configured) starts dragging on `touchstart`. Combined: finger lands on a handle
while flicking down the list → the browser refuses to scroll → the library
interprets the movement as a drag → a ตำแหน่ง silently moves. `touch-action: none`
is the right advice for a handle when drags start immediately (it stops the page
fighting the drag), which is exactly why it gets copied in — but it makes the
handle a scroll dead-zone, and on a tree view the handles are spread down the
whole scrollable surface.
**Fix**: make touch drags require intent, and let the browser keep panning.
- `touch-action: pan-y` on the handle (vertical scroll still belongs to the
  browser);
- `delay: 220` + **`delayOnTouchOnly: true`** so a mouse stays instant and only
  touch needs a hold;
- `touchStartThreshold: 8` so any finger travel inside the delay cancels the
  pending drag — this is what makes "scroll wins, hold wins" unambiguous;
- `chosenClass` feedback, because a touch drag that starts with no visual signal
  reads as either broken or accidental;
- a larger hit box under `@media (pointer: coarse)` — the mouse-sized
  `padding: 0.15rem` caused BOTH accidental drags and failed deliberate ones;
- and drag disabled outright in the mode where reordering is not the task
  (จัดการสิทธิ์), since there it can only ever happen by mistake.
**Where**: `src/css/team.css` `.team-handle`; `src/js/team/index.js` `TOUCH_DRAG`
+ `attachSortables` + the `mode === 'team'` gate on the attach call.
**Rule**: never pair `touch-action: none` with a drag that begins on
`touchstart` inside a scrollable list. Pick one: immediate drag on a small
dedicated non-scrolling surface, or (for a list) long-press + `pan-y`. And when a
mobile gesture "sometimes" does the wrong thing, check the CSS `touch-action` of
whatever the finger landed on before tuning the JS library.

---

## A partial left behind by a restructure is a DECOY — edits land in a file nothing includes, and the page simply does not change

**Symptom**: added a year picker and a board grid to `src/html/tab-team-public.html`,
rebuilt, reloaded — neither element existed in the DOM
(`document.getElementById('orgBoard')` → null). The rest of that same partial was
clearly live: `#orgBody`, `#orgSearch` and the whole spine tree rendered fine. So
the page looked like it was serving a STALE copy of the file I had just edited,
and the first two theories were both about caching (the HTML-include plugin not
watching partials; Vite holding a transform). Restarting the dev server changed
nothing, which is the tell.
**Cause**: `grep -rn "tab-team-public" index.html` returns NOTHING. Commit
`07b9beb` ("merge ทีม SAMO org chart into เกี่ยวกับเรา tab") had COPIED that
markup into `src/html/tab-about.html` and repointed `index.html` at it, leaving
the original partial on disk, unreferenced. The ids matched because it was a
copy, so every symptom pointed at the live file while every edit went to the dead
one. `git grep` for the id would have found two hits in ~5 seconds; I searched for
the behaviour instead of the file.
**Fix**: apply the edits to `tab-about.html`, and `git rm` the orphan so there is
one copy again. **Rule**: before editing any `src/html/*.html` partial, confirm
something includes it — `grep -rn "<partial-name>" index.html admin/index.html`.
An unreferenced partial is worse than a deleted one: it absorbs edits silently.
And when a DOM element you just added is missing while its siblings render,
suspect TWO FILES before suspecting one stale one — `getElementById` returning
null for new markup next to working old markup is the signature.

---

## Never append a query string to an `lh3.googleusercontent.com` URL — the image 404s, and it looks like the option string is wrong

**Symptom**: verifying the new ทีม SAMO portrait pipeline in a browser, every card
was blank with the initials fallback showing through. `curl` on the exact same URL
returned `200 image/webp`. A narrowing probe reported `=w520` → loads,
`=w520-h693-c-rw` → ERROR, which read as "lh3 doesn't support crop+webp from a
browser" and nearly cost the whole server-side-crop design.
**Cause**: the probe appended `?cb=<random>` to bust the cache between attempts.
lh3 encodes its options in the PATH (`/d/<id>=w520-h693-c-rw`) and rejects the
request when an unknown query string rides along. Re-running the identical probe
with no query string: all eight option combinations load, `=w520-h693-c-rw` →
520x693 WebP. The failing variable was the test harness, not the URL scheme.
(`=w520?cb=` happened to survive, which made the result look option-specific and
sent the diagnosis the wrong way.)
**Fix**: don't cache-bust these URLs. To force a re-fetch, change a real option
(`=w521`) or hard-reload. Directly parallel to the PostgREST `?_=…` entry above:
two services in this app now treat an unexpected query param as a hard error.
**Where**: `portraitSrc` / `portraitSrcSet` in `src/js/uploads.js` build option
strings with no query component — keep it that way, and pin the exact expected
suffix in `uploads.test.js` so a "harmless" param cannot be added later.

---

## An allow-list feeding a BACKUP has the opposite safe default from one feeding a public projection — the same construct, inverted failure mode

**Symptom**: none observed — found by asking "what else enumerates team columns?"
after adding two. `buildExportJson` (`src/js/team/io.js`) and the two `create*`
calls in `importJson` (`src/js/team/index.js`) both list fields explicitly, and
neither carried `is_board`, `photo_url` or `photo_focus`. So the export →
restructure → re-import round trip that `io.js` exists FOR would have silently
wiped every member portrait and emptied the whole คณะกรรมการ grid. `photo_url`
had been missing since 0103; nothing failed, because nothing had been restored
yet.
**Cause**: this repo has trained itself, correctly, that a hand-built column list
is the safe pattern — `get_public_team_chart()` names keys one by one precisely
so a new column is NOT published by accident (0086/0103/0104), and
`returns setof <table>` is banned for exactly the opposite reason (0079/0080).
But the safe DIRECTION depends on which way the data flows:

| allow-list feeds | a column left out is… | correct default |
|---|---|---|
| a public projection | not published | **omit** (fail closed) |
| a backup / round trip | **destroyed on restore** | **include** (fail loud) |

Reaching for the projection habit on a serializer inverts the guarantee. And it
cannot be caught by reading either file alone: export and import were internally
consistent with each other — both simply forgot the same three columns.
**Fix**: add the fields to both sides, and pin the key sets in
`src/js/team/io.test.js` (`buildExportJson round-trip fidelity`) so the next
column added to `team_nodes`/`team_members` fails a test instead of vanishing on
a restore. Those tests immediately caught an error in my own expectation list
(`project_seat`), which is the argument for writing them rather than re-reading
the code. `shop_source` is deliberately still excluded — 0094 reverted shop
scoping and the column is inert; that exclusion is a comment in the file, not an
oversight.
**Rule**: whenever you add a column to a table that has an export/serialize path,
grep for every function that enumerates that table's fields and classify each by
data direction. "It's an allow-list, allow-lists are safe" is not the analysis.

---

## A shared `render()` that repaints a pane another module owns will destroy that module's in-progress input

**Symptom**: none reported — found by tracing what fires `render()` in
`src/js/team/index.js`. It is the target of `scheduleRemoteRender()`, i.e. the
Supabase Realtime subscription on `team_nodes`/`team_members`. The new
ปีการศึกษา branch ended in `renderTerms()`, so **another admin editing the live
tree would `innerHTML`-rebuild the archive editor and throw away whatever the
first admin was typing** — a name half-corrected, an unsaved ชื่อเล่น.
**Cause**: `render()` already knew this hazard for drag (`dragging` /
`pendingRender` exist because a remote event mid-SortableJS-gesture cancels the
drag — logged above). Adding a third mode that owns its own DOM re-introduced the
same exposure through a different door: a text input is as destroyable as a drag
gesture, and there was no equivalent guard. The archive is also *independent of
the live tree*, so the repaint had no informational value at all.
**Fix**: the `isYears` branch toggles visibility and returns. `terms.js` owns its
pane and repaints on its own actions; `enterTerms()` paints a loading line on
cold entry, since `render()` no longer does it.
**Rule**: when a shell's `render()` can be invoked by a remote/background event,
it must not rebuild DOM owned by a sub-module that holds user input. Either the
sub-module owns its repaint, or the shell needs the same "is the user mid-gesture"
guard the drag path already has. Before adding a branch to a shared render, list
every caller of that function — not just the one you are writing for.

---

## A `busy` flag that RETURNS EARLY silently discards the second action — serialise instead of dropping

**Symptom**: none reported. `guard()` in `src/js/team/terms.js` opened with
`if (busy) return;`. Type a corrected name, Tab to ชื่อเล่น, type, blur — the two
`change` events land close enough together that the second PATCH is dropped. The
status line still reads "บันทึกแล้ว" (from the first), so the edit looks saved
and is not; the value survives on screen until the next repaint, then reverts.
**Cause**: a re-entrancy guard was reached for where a QUEUE was needed. Dropping
is only correct when the second call is a duplicate of the first (a double-clicked
submit). Here every call carries different data, so dropping is data loss —
and the early `return` gives the caller no way to know it happened.
**Fix**: `chain = chain.then(...)` — every call queues behind the previous one,
nothing is discarded, and the status line reports the last real outcome.
**Rule**: before writing `if (busy) return`, ask what the dropped call CARRIED. If
it carries user input, serialise it. Reserve the drop for idempotent re-submits,
and even then prefer disabling the control so the user can see why nothing
happened.

---

## `rsync --delete` on deploy yanks the previous build's chunks out from under OPEN tabs — and a load-time-only self-heal cannot rescue them

**Symptom** (reported live 2026-07-30): "I just test upload my picture and now the
web is down"… then, minutes later, "oh the web comes back now". Reads like the
upload broke production.
**It was not the upload.** Evidence, in the order it ruled things out:
- every endpoint 200, `/notify` healthy → server up;
- `nginx` active **9 days**, zero error-log lines, **zero restarts** → nginx never
  fell over;
- CPU **100% idle**, load average 6.50 decaying on a **2-core** box → the load was
  the deploy's `npm ci` + two vite builds, already finished;
- `team_members.updated_at` for the photo = **10:41:30 UTC**, deploy finished
  **10:29:59** → the upload SUCCEEDED, 11½ minutes after the deploy;
- the pre-deploy bundle `/assets/public-Cp4_CgAT.js` → **404**, the new one → 200.
**Cause**: `server/deploy.sh` published with `rsync -a --delete dist/ /var/www/…`,
which deletes the previous build's content-hashed assets the instant the new ones
land. A tab open ACROSS the deploy keeps running (its JS is already in memory) —
which is why the upload worked — but the moment it needs anything new it 404s.
This app has real lazy chunks: `await import('./esign.js')` in
`projects/inbox.js`, `./qr.js` in `shop/admin.js`. A reload fixes it, hence "comes
back now".
`src/js/build-check.js` exists for exactly this and still could not help: it runs
**once, at page load**, and the broken tab never loaded again.
**Fix**, three parts:
1. `deploy.sh` `publish()` — assets rsync **additively** (hashed names never
   collide, so keeping the old ones is free), everything else mirrors with
   `--delete --exclude=assets/`, then `find … -mtime +7 -delete` prunes. Note
   `--exclude` also protects those files from `--delete` unless you pass
   `--delete-excluded`.
2. `build-check.js` re-checks on `visibilitychange`→visible and on a bfcache
   `pageshow`, not just at load.
3. …but that re-check must NOT reload over unsaved work. This admin backgrounds
   constantly and is full of modals holding untyped-but-unsaved text. `pageIsIdle()`
   (no `.modal.show`/`.offcanvas.show`, no non-empty visible input) gates the
   foreground path; the page-load path passes `force: true` because nothing can be
   typed yet. **A self-heal that destroys user input is a worse bug than the one it
   fixes.**
**Rule**: never `--delete` content-hashed assets in the same step that publishes
their replacements — a deploy is not atomic from an open tab's point of view. And
any "reload to heal" mechanism needs an answer to "what if the user is mid-edit?".

---

## A deploy script that `git pull`s ITSELF and keeps running will execute a garbage fragment — bash reads a script by byte offset

**Symptom**: none yet — spotted while editing `server/deploy.sh`, one commit
before it would have fired.
**Cause**: bash does not slurp a script; it reads and executes incrementally,
tracking a BYTE OFFSET into the file. `deploy.sh` runs `git pull --ff-only` on the
repo it lives in. Any commit that changes the script's length shifts every byte
after that point, and bash resumes at its old offset inside the NEW file —
mid-token, mid-command, as root. It appears to work for years because the file
rarely changes, then corrupts exactly on the deploy that changes it. The change
that surfaced this added ~30 lines NEAR THE TOP, shifting everything.
**Fix**: pull, then re-exec, guarded by an env var so it cannot recurse:
```bash
if [ "${SAMO_DEPLOY_REEXEC:-}" != "1" ]; then
  cd "$WEB_DIR"; git pull --ff-only
  SAMO_DEPLOY_REEXEC=1 exec bash "$WEB_DIR/server/deploy.sh" "$@"
fi
```
Verified with stubbed `git`/`npm`/`sudo`: unset → pulls and re-execs exactly once;
set → skips the block entirely.
**The transition itself is the dangerous run**: the OLD script (no guard) is what
starts, pulls the new one, and continues at stale offsets. For the first deploy
after adding this, pull MANUALLY first so bash reads the new file from the top:
`cd ~/samo-projects/samomdkkuweb && git pull --ff-only && bash server/deploy.sh`.
**Rule**: any script that updates its own source must re-exec, and self-updating
scripts should be changed with an out-of-band pull for the transition.

---

## Renaming a folder breaks every guard that matches it BY NAME — and the one that gates DELETION fails in the safe-looking direction, so nothing reports it

**Symptom** (caught in review, before deploying): renaming the Drive folders
(`SAMO_Shop` → `Shop`, `PR_Submissions` → `PR`) would have silently made every
shop-slip and project-file delete refuse with *"file is not inside SAMO_Shop"*.
Uploads would keep working perfectly, so the break would surface days later as
"deleting an order doesn't remove its slip" — with nothing in the logs tying it
to a rename.
**Cause**: `fileLivesUnderSamoShop_` / `fileLivesUnderProjects_` walk a file's
parent chain looking for `f.getName() === 'SAMO_Shop'` and gate `setTrashed`.
They are the *safety* half of the feature — deliberately allow-listing which
files a stray call may trash — so they are written as string comparisons and
never touched. Renaming the folder they name turns them permanently false.
The failure is fail-CLOSED (nothing is wrongly deleted), which is why no error
surfaces and why it is easy to ship: the loud half (uploads) keeps working
because uploads go through the resolver that knows about the rename.
**Fix**: one `TOP_FOLDER_CANON` map that is BOTH the rename map and the
transition allow-list, and everything that compares a folder name goes through
`canonTopFolder_()` — the upload allow-lists, the non-creating delete lookup
(`findTopFolder_`), and the ancestry walk (`fileLivesUnderTop_`). Legacy keys
stay in the map so an old bundle in an open tab still uploads.
**Where**: `appscript/prform.gs`. **Rules**: (1) before renaming anything that
appears as a string literal in a security/allow-list check, grep for every
comparison against that literal — the checks that gate DESTRUCTION fail quietly
and are the ones you will not notice. (2) A rename across a client/server
boundary needs expand-then-contract, server first: teach the server both
spellings, deploy, then switch the client. Shipping the client first fails every
request on the allow-list. (3) Prefer one canonicalising predicate over N
literal comparisons, so the next rename is a one-line map edit.

---

## A "validates before touching anything" probe is only side-effect-free on the path that fails FIRST — pass a *valid* argument and you execute the real work

**Symptom**: `skills/deploy-gas.md` documents the deploy canary as
`uploadTeamFile` with **no `folderPath`** — "the handler validates its argument
before touching Drive, so it proves the action exists while writing nothing".
True. I then reused that shape to verify the rename accepted both spellings, by
POSTing a valid `folderPath` and no `fileData`, expecting the same harmless
validation error. It did error — but only *after* creating `IT Database`,
moving four folders into it and renaming them. The migration I had planned as a
deliberate, human-reviewed step happened as a side effect of a test.
**Cause**: the handler is
`var folder = getOrCreateFolderPath_(path); var b64 = data.fileData.split(...)`.
The guarantee was never "this handler is inert"; it was "*this specific input*
fails at the first guard". Supplying a valid `folderPath` moves the failure
point past the Drive work. The outcome here was benign — it is exactly what
`migrateDriveLayout` would have done, and I verified afterwards that all four
folders kept their original ids and child counts — but it was luck, not design:
the same shape against `uploadProjectFile` with `Projects/x` would have created
a junk `x/` folder (avoided by passing bare `Projects`).
**Where**: `appscript/prform.gs` `handleUploadShopFile` / `handleUploadTeamFile`
/ `handleUploadPRFile`; canary doc in `skills/deploy-gas.md`.
**Rule**: when reusing a "safe probe" with different arguments, re-read the
handler and find where YOUR input stops — a probe is only inert up to its first
guard, and every argument you make valid pushes execution further in. If a
handler must be probeable, give it an explicit dry-run/validate-only branch
rather than relying on an argument being absent.

---

## A public Apps Script web app is an UNAUTHENTICATED API — every handler must be scoped by what it may touch, because there is no caller to trust

**Symptom**: none reported; found by asking of each `doPost` action "who can call
this, and what can they reach?" Two live holes, both years old, both in code
nobody thought of as an API surface:
1. **Passport `handleDelete_`** — `DriveApp.getFileById(fileId).setTrashed(true)`
   with NO ancestry check. Deployed `ANYONE_ANONYMOUS`, and its `/exec` URL ships
   inside the public admin bundle (confirmed in `/passport/assets/admin-*.js`),
   so it was an unauthenticated *trash any file this account owns* primitive. The
   SAMO Drive holds `Academic Database`, exam keys, and the whole `IT Database`
   tree; Drive ids of shared files are discoverable.
2. **samoweb `notifyProjectEmail`** — `to`, `subject` and `htmlBody` taken
   straight from the request into `MailApp.sendEmail({name:'MDKKU SAMO'})`. An
   open relay: arbitrary mail to arbitrary recipients, from the institution's own
   account, under a display name the recipients trust. Also a free way to burn
   the ~100/day MailApp quota, which silently stops the real notifications.
**Cause**: the mental model was "this is our upload helper", not "this is a
public endpoint". Web-app handlers get written like internal functions —
parameters treated as trusted because *our* frontend is the only thing that
calls them. But `Execute as: Me` + `Who has access: Anyone` means every handler
runs with the OWNER's full Drive/Gmail authority for any caller on the internet,
and the URL is not a secret: `VITE_*` / `config.js` values are inlined into the
bundle at build time.
**Fix**: scope each handler by what it may REACH, since there is no identity to
check. Deletes walk the parent chain and require the file to live under the
app's own folder — comparing folder **IDs**, not names, so a rename can neither
widen nor break the check. Email allow-lists recipient *domains* (overridable
via a Script Property, so no redeploy to add one), validates EVERY recipient
rather than the first, and uses exact matching — a suffix test would admit
`kku.ac.th.evil.com`. Both reject loudly so a blocked call cannot read as a
silent success.
**Where**: `passport/gas/Upload.gs` `fileLivesUnderAppFolder_` + `handleDelete_`;
`appscript/prform.gs` `sendProjectEmail` + `allowedEmailDomains_`. samoweb's
other deletes already had the ancestry pattern — which is why the passport one
stood out as the odd handler once the question was asked uniformly.
**Rules**: (1) enumerate every `doPost` action and write down, per action, what
an anonymous caller can reach with it — the ones that take an *id* or an
*address* are the dangerous shape, because the caller chooses the target. (2)
Never treat the `/exec` URL as a secret. (3) Test a guard from BOTH sides: a real
target outside the allowed tree must survive, and the legitimate flow must still
work — I verified the delete guard by attacking a real file (it survived) and
then round-tripping a real upload+delete (count returned to its original 15).
**Follow-on**: the same review flagged the destructive actions as needing a real
caller identity rather than scope alone. That gate was built, deployed — and
reverted within the hour, because it needed a new OAuth scope. See the next
entry; it is the more important lesson of the two.


---

## Adding a Google service to an Apps Script web app widens its auto-derived OAuth scopes — and a web app running AS ITS OWNER dies until that owner re-consents

**Symptom**: every `deleteShopFile` / `deleteProjectFile` / `deleteProjectFolder`
call started returning `unauthorized: could not verify session`, for ~an hour, in
production. It looked like the new session-verification gate rejecting tokens —
including tokens that were perfectly valid. Uploads and email were unaffected,
which made it look like a bug in the gate's logic rather than in its permissions.
**Cause**: the gate called `UrlFetchApp.fetch` to verify the caller's token
against Supabase. The manifest declares no explicit `oauthScopes`, so GAS derives
them from the code — and `UrlFetchApp` adds
`https://www.googleapis.com/auth/script.external_request`, which the owner had
never granted. The deployment is `Execute as: Me`, so the script cannot run a
service the owner has not consented to: `UrlFetchApp.fetch` THROWS before any
logic runs. The gate's catch turned that into a generic "could not verify
session", which is fail-closed (correct) but hid the real cause.
**How it was found**: not by the probes — those all reported "denied", which is
what a working gate looks like. It surfaced only when asking *which branch* was
denying: the message was the CATCH branch, and a 403 from Supabase with
`muteHttpExceptions: true` does not throw. Echoing `String(e)` gave the real
error verbatim (in Thai): *"คุณไม่ได้รับอนุญาตให้เรียกใช้ UrlFetchApp.fetch
สิทธิ์ที่จำเป็นคือ …/script.external_request"*.
**Fix**: reverted the gate, removing the external call entirely; deletes work
again (verified with a real upload→delete round trip, plus the folder guard still
refusing a file outside the tree). Re-enabling is now documented as a strict
two-step: the owner re-consents FIRST, then the gate is restored. The frontend
already sends `accessToken`, so only the GAS side changes.
**The bitter part**: `skills/deploy-gas.md` had carried this exact warning since
that morning — *"adding a new Google service changes the auto-derived OAuth
scopes and forces a re-authorization; this web app is ANYONE_ANONYMOUS +
USER_DEPLOYING, so an unauthorised deployment means every call fails"* — written
while checking that a DIFFERENT change was safe. Writing a hazard down does not
make you check it; the check has to be part of the deploy, not part of the docs.
**Rules**: (1) before adding ANY new Google service (`UrlFetchApp`, `GmailApp`,
`CalendarApp`, `SpreadsheetApp`…) to a script, ask whether it widens the derived
scopes — if it does, the owner must re-consent BEFORE the code that uses it goes
live. (2) A probe that only ever asserts "denied" cannot distinguish a working
guard from a broken service; always test the ALLOW path too, with a real
credential. (3) When a guard's catch-all fires, echo the underlying exception —
a generic failure message hid this for an hour.
