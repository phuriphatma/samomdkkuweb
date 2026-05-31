# Mistakes log — hard-learned bugs

Read this BEFORE touching:
- `src/js/auth.js`
- `src/js/db.js`
- Anything that calls supabase-js or `navigator.sendBeacon`

Each entry: **Symptom → Cause → Fix → Where it lives now**.

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

## `navigator.sendBeacon` does not follow HTTP redirects

**Symptom**: Discord notifications stopped firing after switching `notify.js`
to sendBeacon. Apps Script execution log showed nothing — the request never
arrived.
**Cause**: Apps Script `/exec` URLs always 302-redirect to
`script.googleusercontent.com`. sendBeacon doesn't follow redirects.
**Fix**: Use plain `fetch(url, { keepalive: true, ... })` for GAS endpoints,
chain `.then(r => r.text())` to drain the body.
**Where**: `src/js/notify.js`. **Don't go back to sendBeacon for GAS endpoints.**

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

## Synthetic email domain must be a real public TLD

**Symptom**: Registration fails with `Email address "x@samomdkku.local" is invalid`.
**Cause**: Supabase Auth rejects RFC 6762 reserved TLDs (`.local`, `.localhost`).
**Fix**: Use `samomdkku.app` (real public TLD; we don't actually own it but
the format passes validation; no mail delivers).
**Where**: `src/js/auth.js` `PASSWORD_EMAIL_DOMAIN` and
`supabase/migrations/0002_seed_staff_accounts.sql`. Do not switch back.

---

## `form.reset()` clears hidden inputs

**Symptom**: First PR submit succeeds; second submit goes through with
`submitter = 'Guest'` even though user is signed in.
**Cause**: After success, we call `form.reset()` to clear visible fields.
This also resets hidden inputs `prGoogleUserEmail` / `prGoogleUserName`.
**Fix**: Re-populate hidden inputs from `authGetUser()` immediately after reset.
**Where**: `src/js/pr-form.js` success path inside `handlePrFormSubmit`.

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

## Email confirmation must be OFF in Supabase for synthetic emails

**Symptom**: Registration hits `Email rate limit exceeded` after 3 attempts.
**Cause**: Supabase tries to send a confirmation email to `@samomdkku.app`
which doesn't deliver. Each attempt counts toward the rate limit (3/hour
on free tier built-in SMTP).
**Fix**: Supabase Dashboard → Authentication → Providers → Email →
toggle off "Confirm email". Synthetic emails don't need confirmation; Google
users come in via OAuth which is already verified.

**This applies to the profile email-add flow too — DO NOT flip "Confirm
email" ON to "make magic-link verification work".** The toggle is
project-wide, not per-call. Turning it ON would re-break signup at the
same rate limit because every new `samomdkkuvpa@samomdkku.app`-style
account sends a bounced confirmation. With it OFF,
`db.auth.updateUser({email})` updates the email *immediately* without
a verification step — that's accepted in this app because the
ownership proof is the subsequent `linkIdentity` Google OAuth round-
trip (Supabase will only link a Google identity whose email matches
the user's auth email). Users who only want a contact email skip the
proof step; that's the design tradeoff. See `STATE.md` "Supabase
config for the profile email-add flow (0026)" for the longer write-
up and the future OTP-via-Apps-Script path if real verification is
ever needed.

---

## Bootstrap tab JS keeps the parent dropdown open

**Symptom**: After clicking "PR Form" inside the "เครื่องมือ" dropdown, the
dropdown stays open and the toggle stays styled active.
**Cause**: Bootstrap's tab JS directly sets `.show` on the parent
`.dropdown-menu`, bypassing the Dropdown API — so `.hide()` doesn't help.
**Fix**: Listen for `shown.bs.tab`. Strip `.show` from any `.dropdown-menu.show`
inside `.samo-navbar` and reset `aria-expanded="false"` on the toggle.
**Where**: `src/js/main.js`.

---

## Bootstrap mobile offcanvas + `data-bs-toggle="pill"` race

**Symptom**: On mobile, tapping a tool in the offcanvas drawer activates the
new pane on top of the old one (stacked panes).
**Cause**: The offcanvas pill buttons aren't part of the navbar's tablist, so
Bootstrap activates the new pane but never deactivates the previously-active
one.
**Fix**: In the offcanvas, drop `data-bs-toggle="pill"` and use
`onclick="activateTab('pills-X-tab')"` which routes through the canonical
tab button (in the right tablist). Close offcanvas in a delegated click
handler.
**Where**: `src/html/navbar.html` + `src/js/main.js`.

---

## `form.reset()` clears the file input but `fileInput.files` still references the old File

Not currently biting us, but worth knowing: after `form.reset()`, the file
input element's `.files` property may still reference the previously-selected
file in some browsers. If you trigger an upload in a second submission and
read `fileInput.files`, you can re-upload the previous file. Re-create the
input element OR explicitly `fileInput.value = ''` if this becomes a problem.

---

## HTML5 `required` on a hidden field silently blocks form submit

**Symptom**: User fills in every visible field of the project send-document
modal, clicks "ส่ง" — nothing happens. No error, no spinner, no Discord
ping, no row. DevTools console quietly says
`An invalid form control with name='' is not focusable.`
**Cause**: The same `<form>` does double duty for "create project + first
doc" and "add doc to existing project". Depending on mode, half its fields
are hidden via `d-none`. But HTML5 form validation **still runs on hidden
required fields** — and because the browser can't focus a hidden field to
show the validation tooltip, it just refuses to submit, silently.
**Fix**: Add `novalidate` to the `<form>` AND remove all `required`
attributes from inputs that may be hidden by mode. Do validation in JS
(`onSubmit` throws clear Thai errors that surface via `alert`). HTML5
required + dynamic hide/show is a footgun in any multi-mode form here.
**Where**: `src/html/modal-project-send.html` `#projectSendForm`. If you
add a new dual-mode modal, do the same.

---

## Check constraint must be dropped BEFORE updating to a new enum value

**Symptom**: Running a migration that renames enum values fails with
`ERROR: new row for relation "X" violates check constraint "X_col_check"`
on the `UPDATE` statement itself — even though that UPDATE's whole job
is to move the values to the new set.
**Cause**: PostgreSQL evaluates check constraints on every row mutation.
If the migration UPDATEs to a value that's outside the OLD check, the
update fails before the new ALTER … ADD CHECK runs.
**Fix**: Always `ALTER TABLE … DROP CONSTRAINT IF EXISTS X_check` **before**
`UPDATE … SET col = new_value`, then `ALTER TABLE … ADD CONSTRAINT X_check
CHECK (col IN (new_set))` afterwards. Also broaden the UPDATE to
`WHERE col NOT IN (new_set)` so a re-run / unexpected legacy value
doesn't get left in an invalid state.
**Where**: `supabase/migrations/0007_shop_refactor.sql` for the shop
`source` enum (md/rt/mdi/sittikao). Apply this pattern to any future
enum-rename migration.

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

## Hardcoded reserved-username lists rot when new staff accounts are added

**Symptom**: Registration form lets a public visitor try
`samomdkkuradiology` (or any of the 9 VP usernames added in 0010/0011).
Backend uniqueness on `public.users.username` returns
"Username นี้มีผู้ใช้งานแล้ว" — but only IF the VP auth user has already
been seeded. If not, the visitor squats the name and the admin can't
seed the legitimate account.
**Cause**: `auth.js registerWithPassword` had a literal list of 6 reserved
usernames. Every time a new `samomdkku*` staff account is added (per-VP,
new dept, future role) the list goes out of date. `reserved_staff_usernames`
is reference-only (0011 itself comments "not load-bearing"), so the only
defence is the username unique constraint *if* the row exists.
**Fix**: Use a prefix check — `/^samomdkku/.test(lc) || lc === 'sastaff'`.
The repo's convention is that ALL staff accounts share the `samomdkku`
prefix; literal lists shouldn't be added.
**Where**: `src/js/auth.js` `registerWithPassword`. Don't reintroduce
the literal list. If a future non-prefix staff username is needed,
extend the regex / OR clause — don't fall back to literals.

---

## iOS Safari `100vh` hides the bottom of a full-height drawer

**Symptom**: Sign-out button (or any bottom-anchored control) in the
mobile admin sidebar drawer was unreachable on iPhone — buried under
Safari's bottom URL chrome.
**Cause**: iOS Safari measures `100vh` against the *large viewport*
(URL bar hidden). When the URL bar is shown — which is the default
state on first open — the drawer extends *past* the visible area, and
the user has to scroll to reach the bottom. Adding `bottom: 0` on a
fixed element doesn't help: the element is positioned relative to the
same large viewport.
**Fix**: Use `100dvh` (dynamic viewport height) for the drawer height,
which shrinks when the chrome is shown. Keep `100vh` above it as a
fallback for browsers that don't grok `dvh`. Additionally pad the bottom
of the bottom-anchored control with
`max(0.85rem, calc(env(safe-area-inset-bottom) + 0.6rem))` so it sits
above the iOS home-indicator inset too.
**Where**: `src/css/workspace.css` `.workspace-side` (mobile @media block)
+ `.workspace-side-foot` (same block). Apply the same pattern to any
new full-height mobile overlay (offcanvas, modal-fullscreen on mobile).

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

## Supabase `unlinkIdentity` requires ≥2 identities — `hasPassword` is NOT the check

**Symptom**: A Google-only user adds a password via the profile modal
(`setUsernameAndPassword` → `db.auth.updateUser({password})`), then taps
"ยกเลิกการเชื่อม Google". Server responds with
`single_identity_not_deletable`. The UI had let them click because
we trusted `hasPassword=true` as the green light.
**Cause**: Supabase's docs and source are explicit: "The user must have
at least 2 identities in order to unlink an identity"
(`@supabase/auth-js` GoTrueClient.js, error code
`single_identity_not_deletable`). `db.auth.updateUser({password})`
sets `auth.users.encrypted_password` but does NOT reliably create an
`email`-provider identity row. So a Google-only-then-password user
can have `hasPassword=true` while `auth.identities = [google]` — one
row. Unlinking that row is refused.
**Fix**: Gate unlink UI on both (a) `hasPassword` for the UX rule
("they still have a way in"), AND (b) `identities.length >= 2` for the
Supabase rule. Surface a specific Thai message on the server error
code so the user knows it's not a bug in their click.
**Where**: `src/js/auth.js unlinkGoogleIdentity` + `src/js/profile.js`
repaint of `#profileUnlinkGoogleBtn`. Don't ship a new "unlink"
flow without checking the post-unlink identity count.

---

## supabase-js `updateUser({password})` doesn't create an `email` identity

**Symptom**: A Google-only user opens the profile modal, sets a
username + password, hits Save, success. They close + reopen the
modal — the "Set password" form is still there. They try again,
same result. Confused.
**Cause**: `db.auth.updateUser({password})` writes
`auth.users.encrypted_password` but does NOT add an `email`-provider
identity row in `auth.identities`. So the
"check `authUser.identities` for `provider === 'email'`" heuristic
keeps returning `false` forever even though signInWithPassword
would now work for them.
**Fix**: Don't read "has password" off the identities array. Mirror
`auth.users.encrypted_password is not null` into
`public.users.has_password` via an AFTER-UPDATE trigger
(migration 0027), then read that column on the normal profile fetch.
The identity-array heuristic stays as a pre-0027 fallback.
**Where**: `supabase/migrations/0027_username_case_and_has_password.sql`
+ `src/js/auth.js buildCurrentUser`. The same `has_password` column
also lets the privilege-escalation guard (0028) treat
`has_password` as server-only.

---

## Pane-scoped DOM selectors break when the shell is rewritten

**Symptom**: In the admin app, clicking "การตั้งค่า" inside the หนังสือโครงการ
pane does nothing — the manage view never replaces the inbox view.
**Cause**: `setView()` in `src/js/projects/index.js` scoped its selectors
to `#pills-projects [data-projects-view]` / `[data-projects-pane]`, and
its click delegation listened on `#pills-projects`. The cc27157 public→
admin split removed the `id="pills-projects"` wrapper (tab-projects.html
now sits inside `<section data-admin-pane="projects">`), so every
scoped query found nothing and the click handler never bound.
**Fix**: Drop the `#pills-projects` scoping — the `data-projects-view`
/ `data-projects-pane` attributes are unique to this feature, so match
them at document scope. Delegate the click on `document` too.
**Where**: `src/js/projects/index.js` `setView()` + the `initProjects()`
click delegate. Whenever a refactor moves a partial into a new shell,
audit any module-scoped `#foo`-rooted query selectors against the new
DOM — the JS module's selector strings travel with the module and
will silently break if the host wrapper id changes.

---

## Notification `notify_*_in_app` flags gate the in-app fanout — schema default `true`, but a user-toggle silently disables EVERYTHING

**Symptom**: uni_staff signs in, no bell badge, the offcanvas shows
"ยังไม่มีการแจ้งเตือน" even though VP-Admin has been actively sending
documents. Discord and email channels also stop firing.
**Cause**: `public.project_settings` has four channel flags
(`notify_uni_in_app`, `notify_uni_email`, `notify_vp_in_app`,
`notify_vp_discord`) defaulting to `true` in schema 0005. The notify
fanout in `src/js/projects/notify.js` checks each one with the
shape `if (settings?.notify_uni_in_app !== false) { create row }` —
so a row flipped to `false` (user save of the manage form, or any
PATCH) silently disables the entire channel. Bell empty looks like a
broken query but is really a config-off state.
**Fix**: Restore via SQL (or the manage UI now that the pane is
reachable):
```sql
update public.project_settings
   set notify_uni_in_app = true, notify_vp_in_app  = true,
       notify_uni_email  = true, notify_vp_discord = true
 where id = 1;
```
Past missed sends do NOT backfill — only new actions get rows.
**Where**: settings row in Supabase; flag checks in
`src/js/projects/notify.js` (`notifyUniStaff` / `notifyVpAdmin`).
Future thought: if "no notifications" feels broken often, change
the offcanvas empty-state to surface a "การแจ้งเตือนในแอปถูกปิดอยู่"
hint when `settings.notify_*_in_app === false`.

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

## "Login is still there so the cache must be cleared" — localStorage and the HTTP cache are different buckets

**Symptom**: User reports a JS-level bug fixed on main, deploy is up
and `curl -I` confirms the new `Cache-Control: no-cache` header on
`/admin/`. User closes Safari, restarts iPad, comes back, sees they
are still signed in, and concludes "cache hasn't cleared" because
the JS fix still isn't visible.
**Cause**: Two different storage layers being confused.
- **localStorage** (`sb-<ref>-auth-token`, `samo.savedAccounts`,
  `projects.commentsSeenAt`, etc.) survives Safari restarts,
  device restarts, and tab closes. That's why the user is still
  signed in — completely independent of the HTTP cache.
- **HTTP cache** (the disk-cached copy of `/admin/index.html` and
  the JS bundle it references) is what carries the JS fix. iPad
  Safari keeps the cached HTML keyed by the cache headers that
  were on it AT THE TIME IT WAS CACHED — a later deploy that adds
  `Cache-Control: no-cache` only governs FUTURE fetches; it does
  NOT retroactively invalidate the cached copy.
So the iPad is happily serving stale HTML that points at the OLD
bundle hash, while the user sees "login still works → cache fine".
**Fix**: Three escalating options, in order:
1. Visit a fresh URL — `?v=2` or any querystring works because it's
   a different cache key. Verifies the new bundle without touching
   localStorage / signing out.
2. Settings → Safari → Advanced → Website Data → swipe-delete the
   entry for the site. iOS rolls localStorage into "Website Data"
   so this DOES sign the user out — fine, they re-sign-in.
3. Settings → Safari → Clear History and Website Data — last
   resort, nukes everything.
**Where it lives now**: `public/_headers` ships
`Cache-Control: no-cache, must-revalidate` on HTML so the NEXT
deploy after this fix won't re-trap a user, but the FIRST deploy
where this is added still requires one of the three steps above.
Pattern to recognise: any "fix shipped, deploy verified, user
still doesn't see it" report — first thing to check is whether
the user's HTML cache predates the `_headers` fix.

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

## When in doubt: check `mistakes.md` before re-implementing

Every entry above represents hours we already spent. If a symptom looks
similar to something here, the fix is probably the same or related.
