# Mistakes log — hard-learned bugs

Read this BEFORE touching:
- `src/js/auth.js`
- `src/js/db.js`
- `supabase/functions/`
- Anything that calls supabase-js or `navigator.sendBeacon`
- The migration script (`tools/migrate-from-sheets.mjs`)

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
**Where**: `src/js/auth.js` `PASSWORD_EMAIL_DOMAIN`, `tools/migrate-from-sheets.mjs`,
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

## Edge Functions `Deno.serve` fails on older Supabase Edge Runtime

**Symptom**: Function deploys but returns 502 EDGE_FUNCTION_ERROR with no
visible logs.
**Cause**: `Deno.serve()` is the modern API. Supabase's edge runtime may not
have it (depends on project age / region).
**Fix**: Use `import { serve } from "https://deno.land/std@0.224.0/http/server.ts";`.
**Where**: `supabase/functions/notify-pr/index.ts`, `supabase/functions/notify-vs/index.ts`
(currently unused — Discord stays on GAS).

---

## Email confirmation must be OFF in Supabase for synthetic emails

**Symptom**: Registration hits `Email rate limit exceeded` after 3 attempts.
**Cause**: Supabase tries to send a confirmation email to `@samomdkku.app`
which doesn't deliver. Each attempt counts toward the rate limit (3/hour
on free tier built-in SMTP).
**Fix**: Supabase Dashboard → Authentication → Providers → Email →
toggle off "Confirm email". Synthetic emails don't need confirmation; Google
users come in via OAuth which is already verified.

---

## CSV columns with empty headers need positional access

**Symptom**: Migration silently writes `[]` / `null` for `assignees`,
`other_platforms`, `other_platform_reason`. CSV has values for them.
**Cause**: Prod sheet exported with empty header cells for columns 20-22.
`r['Assignees']` returns `undefined`. With named-key access alone, those
columns are unreachable.
**Fix**: `readCSV` now exposes `obj._raw[idx]` for positional access. Use
`r._raw[20]` etc. for unnamed columns.
**Where**: `tools/migrate-from-sheets.mjs`.

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

## When in doubt: check `mistakes.md` before re-implementing

Every entry above represents hours we already spent. If a symptom looks
similar to something here, the fix is probably the same or related.
