# Mistakes — Notifications, Apps Script & Google Drive

Everything that leaves the app: Discord, email, GAS as a public API, and Drive image URLs.

Each entry: **Symptom → Cause → Fix → Where it lives now**. The always-loaded index of every entry across all nine files is `.claude/rules/mistakes.md`; add new entries here, then run `npm run mistakes:index`.

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

---

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

---

## Fire-and-forget GAS notifications + `muteHttpExceptions:true` = invisible drops

**Symptom**: Discord notifications to VPA arrive for "most" uni_staff
actions but go missing for some. The in-app bell row always lands
(consistent across the same actions); only Discord is intermittent.
No errors in the console, no errors in GAS execution logs.
**Cause**: A two-layer silent-failure stack.
- Frontend `fireGAS()` in `src/js/projects/notify.js` started the
  fetch but returned immediately, with `.catch(() => {})` swallowing
  every network / 4xx / 5xx outcome. The user-action handler moved
  on (`onChanged`, re-render, sometimes a navigation) before the
  request completed. iPad Safari + slow networks could drop the
  in-flight fetch entirely with no surface.
- GAS `sendProjectDiscord()` used `muteHttpExceptions: true` AND
  ignored the response code, so Discord rate limits (429), expired
  webhook URLs (404), and malformed payloads (400) all silently
  "succeeded" — `notifyProjectDiscord` returned `{ success: true }`
  regardless of what Discord actually did.
**Fix**:
- `callGAS()` replaces `fireGAS()` — awaitable, 10s timeout, logs every
  failure mode with status code + body. The hot path that depends on
  reliability (VPA Discord) AWAITS it; the email path keeps
  fire-and-forget but logs failures via the same helper.
- GAS `sendProjectDiscord()` still uses `muteHttpExceptions: true`
  but inspects `getResponseCode()` and returns `{ ok, status, body }`.
  The `doPost` handler propagates non-2xx as `success: false` with
  the Discord status so the frontend can log a meaningful warning.
**Where**: `src/js/projects/notify.js` `callGAS` / `notifyVpAdmin`;
`appscript/prform.gs` `sendProjectDiscord` + the `notifyProjectDiscord`
branch of `doPost`. Don't reintroduce a silent `.catch(() => {})` on
any user-visible side-channel. If a fire-and-forget is the right
pattern for a future channel, log the failure inside the helper.

---

---

## GAS Cloud Logs are EMPTY for any browser-fetch call (logs simply not recorded)

**Symptom**: You add `Logger.log` / `console.log` to a GAS `doPost`
handler, redeploy, hit the `/exec` endpoint from the frontend, see
the execution land in the GAS "Executions" panel — but the Cloud
Logs section is permanently empty ("No logs are available for this
execution"). Refreshing, waiting, redeploying don't help.
**Cause**: GAS deliberately suppresses `Logger.log` / `console.log`
output for Web Apps deployed as *Execute as: Me + Who has access:
Anyone* when called from an unauthenticated client — i.e. our
frontend `fetch(GAS_API_URL, …)` with no `Authorization: Bearer`
header. The logs are NOT delayed; they're never recorded. This is
documented GAS behaviour; see `skills/deploy-gas.md` for the full
matrix.
**Fix**: One of three workarounds depending on what you're debugging:
  1. Run the handler manually from the GAS Editor (Editor runs are
     owner-authenticated, logs always appear). `testProjectDiscord()`
     in `prform.gs` is the template for this — write a small test
     function that calls the real handler.
  2. Echo the diagnostic data in the HTTP response. The frontend
     `callGAS` / `dbRest` helpers log the response body on failure,
     so the data lands in the browser console instead.
  3. Link the GAS project to GCP (Project Settings → GCP → Change
     project) — once linked, Stackdriver records every execution
     regardless of caller. Not currently done; one-time setup if
     deeper diagnostics are needed.
**Where**: `skills/deploy-gas.md` "Where the logs DO and DON'T appear"
section has the full table. Don't redeploy repeatedly hoping logs
will appear for a public-fetch call.

---

---

## Async click handlers run concurrently → parallel Discord POSTs hit per-webhook rate limit

**Symptom**: User clicks two actions in quick succession (e.g., "เสร็จสิ้น"
then "คอมเมนต์" within ~1 second). GAS logs both `doPost` executions
completing — one fast (~1s), one slow (~5-10s). Only ONE Discord
message lands in the channel. Adding more GAS-side retries doesn't
help — all 3 retries return 429.
**Cause**: JS click handlers are async but the event loop INTERLEAVES
them. When the first handler hits its first `await` (timeline patch,
profile fetch, etc.), JS yields back to the event loop and the
SECOND click's handler starts running concurrently. Both eventually
reach `await callGAS('notifyProjectDiscord', …)` at roughly the same
moment → two POSTs hit the webhook in parallel → Discord's per-route
bucket (~5 tokens / 2s) rate-limits one. GAS-side retries don't
recover because the bucket stays exhausted for the full retry
window. Bell writes survive because they go through PostgREST, not
the rate-limited Discord webhook.
**Fix**: Serialise Discord calls through a module-level promise chain
with a minimum-spacing delay (>2s, past Discord's bucket refill).
The first call fires immediately; the second waits its turn. Both
notifications arrive; the second is delayed by ~2s.
**Where**: `src/js/projects/notify.js` `queueDiscord` + the
`notifyVpAdmin` Discord block now wrapped in `queueDiscord(() => …)`.
Pattern reusable for any other rate-limited side-channel: if the
callsite is a click handler and the destination has a rate limit,
the GAS-side retry is insufficient — the queue is required.

---

---

## Cloudflare 1015 (per-IP rate limit) blocks GAS → Discord webhook traffic, NOT Discord's own webhook bucket

**Symptom**: Discord notifications start arriving inconsistently or
stop entirely. GAS executions complete in ~10s (the 3-retry path);
HTTP responses are 429 across all attempts. The response BODY is
literally the string `error code: 1015` (not Discord's standard
JSON error envelope). Running `testProjectDiscord()` manually from
the GAS editor — supposedly bypasses all our runtime logic — ALSO
hits HTTP 429 with body `error code: 1015`.
**Cause**: Discord's API sits behind Cloudflare. `error code: 1015`
is Cloudflare's "you are being rate limited" page, not Discord's
own webhook rate limit. Two important differences:

  - **Per-IP, not per-webhook**: rotating the webhook URL won't help.
    Every webhook URL on `discord.com` goes through the same
    Cloudflare edge. The block is on the *source* IP (GAS server's
    egress IP), not the destination.
  - **Cooldown is minutes, not seconds**: Discord's webhook bucket
    refills in ~2s. Cloudflare 1015 cooldowns are typically 30s
    to several minutes, and *extend* if you keep hammering. So
    retrying inside the same request window almost never recovers,
    and aggressive retries make the cooldown worse.

  GAS shares IPs across users — sustained testing volume from one
  GAS project pushes the *shared* IP into Cloudflare's penalty box.
**Fix**:
  - `prform.gs` `sendProjectDiscord` — detect body containing `1015`
    and bail the retry loop early (no point burning more GAS time).
    Retry sleep clamp bumped from 5s → 9s for the cases where the
    cooldown is shorter.
  - `notify.js` `MIN_DISCORD_SPACING_MS` — bumped from 2.2s → 6s.
    Wider spacing reduces the chance the next call even sees the
    1015 page.
  - **There is NO code-only fix that recovers from an active 1015
    cooldown** — wait it out (5-60 minutes), reduce ongoing traffic,
    or move Discord notify off GAS to a dedicated proxy (Cloudflare
    Worker, Supabase Edge Function, etc.) that uses a different
    egress IP.
**Where**: `appscript/prform.gs` `sendProjectDiscord` retry loop;
`src/js/projects/notify.js` `MIN_DISCORD_SPACING_MS`. If reliability
becomes important (campaign cycles, demos), seriously consider a
non-GAS proxy.

---

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

---

## Awaiting the serialised Discord notify queue blocks the UI re-render (status/comment clicks feel sluggish)

**Symptom**: sastaff (uni_staff) clicks "รับเรื่อง" / "เสร็จสิ้น" /
"คอมเมนต์" and the card takes a noticeable beat to update.
**Cause**: The doc action handlers `await notifyVpAdmin(...)` BEFORE
calling `onChanged()` (the re-render). `notifyVpAdmin` awaits
`queueDiscord(...)`, which enforces `MIN_DISCORD_SPACING_MS` (6s) between
calls plus up to ~20s of GAS retry budget — so the UI sat waiting on an
out-of-band side-channel that the user doesn't need to see complete.
**Fix**: Re-render FIRST (`markDocSeen` + `onChanged()`), then fire the
notify fire-and-forget (`.catch(() => {})`). Discord is best-effort and
already serialised + logged inside `notify.js`; nothing depends on the
await. Applied to `onDocStatusClick`, `onDocReturnClick`,
`onDocResendClick`, `onDocCommentClick`, `onCommentEditClick`.
**Where**: `src/js/projects/inbox.js`. Never `await` a serialised /
rate-limited side-channel on a click handler's render path — fire it
after the render.

---

---

## `drive.google.com/thumbnail?id=…` images 302-redirect → intermittently BLANK on iOS Safari (iPad) while desktop is fine

**Symptom**: ประกาศ (announcement covers) and SAMO Shop product/banner images
"never load" on iPad — but load fine on desktop Chrome, AND the exact same
image URL opens fine when tapped DIRECTLY in iPad Safari, AND a page refresh on
the iPad often brings them back. Looks like a broken image / permission / CORS
bug; it's none of those (the bytes are reachable).
**Cause**: images were embedded as
`https://drive.google.com/thumbnail?id=<id>&sz=w2000`. That endpoint **302-
redirects to `lh3.googleusercontent.com`** on every load. iOS Safari drops the
redirected subresource load intermittently on a cold cache (extra hop + slower/
stricter than desktop) → the `<img>` stays blank. A refresh (warm cache) or a
direct top-level navigation (no redirect-in-`<img>` context) succeeds, which is
why it looked flaky and device-specific. `sz=w2000` also over-fetches (2000px
for a ~140–260px card), adding to iOS image-memory pressure.
**Fix**: emit the **direct CDN** form `https://lh3.googleusercontent.com/d/<id>=w1200`
— no redirect, correct Content-Type, smaller payload — in `convertDriveUrl`
(`src/js/uploads.js`). It now ALSO runs at RENDER time (not just on upload), so
it rewrites the legacy `thumbnail?id=` URLs already stored in the DB → existing
rows fixed with no data migration. Kept `loading="lazy"` (dropping it would
decode every image at once and worsen iOS memory). Both forms still need the
file shared "anyone with the link".
**Where**: `src/js/uploads.js` `convertDriveUrl` (+ test). Applied at EVERY
Drive-image render site (the shared bug — grep audit): `announcements.js`
covers+inline via `pickCover`, `departments.js` card cover, `shop/products.js`
banner/launch/grid, `shop/admin.js` product+banner lists. **Rule**: never put a
`drive.google.com/thumbnail` (or `/uc?export=view`, or a `/file/d/…/view`) URL
straight into an `<img src>` — always run it through `convertDriveUrl` so it
becomes the redirect-free lh3 URL. Verify image bugs on the REPORTED device
class (iOS Safari here), not just desktop — the redirect only bites iOS.

---

---

## A vendor manual's field list is not the contract — the live response had two fields it does not document, and lacked one it does

**Symptom**: the KKU SSO manual was about to be used to decide a data-import
design. Read literally, `user.profile` had no รหัสนักศึกษา, which would have
meant asking Data Analytics for a column we did not need — or worse, building
the integration and discovering the gap afterwards.

**Cause**: the manual was treated as the API's definition. One real login
(`tools/sso-probe.mjs`) showed it is a description, and an out-of-date one:

| the manual says | the API actually does |
|---|---|
| `auth.token` returns `immutableId` | it does not |
| `user.profile` returns `email` | the key is `mail` (`auth.token` does use `email`) |
| — | `user.profile` also returns `studentId` **and** `studentCode`, neither documented |
| `employeeId` (unexplained) | empty for a student — it is the staff id |

The undocumented `studentCode` was the field that answered the question, and it
arrived already in this app's canonical `653070317-0` form. **No amount of
re-reading the PDF could have produced it.**

**Fix**: a throwaway probe that performs the real handshake and prints the field
NAMES, run before any design depended on the answer. It cost one login. Values
are printed only for the identifier-shaped fields; `citizenId`, `phoneNumber`
and the access token are redacted to a shape, because receiving personal data is
not a reason to put it in a terminal transcript.

**Where it lives now**: `tools/sso-probe.mjs`, `docs/KKU-SSO.md`.

**Rules**: (1) **Probe the endpoint before designing against its documentation**
— especially when the answer decides what you ask another department for.
(2) Read defensively afterwards: a response that has two undocumented fields and
is missing a documented one will change again, so never assume a key is present
because the manual says it is. (3) A related trap found in the same session: the
`auth.token` endpoint answers a bad code with the SAME error whether the client
secret is right or wrong, so it looked like a credential check and was not — a
probe that returns one answer for every input is evidence of nothing (the
"test BOTH directions" class).

---

## A refcount is only as true as its list of referrers — and a client-side one cannot see past RLS

**Symptom**: none reported. Found by auditing the photo path after the person
registry shipped. Measured on a rollback transaction: delete a ทีม SAMO member
whose portrait had mirrored to the registry, and

```
count the app checks (team_members + team_archive_members) : 0
people   still points at the file                          : 1
students still points at the file                          : 1
```

so `deleteTeamPhotoIfUnused` trashed the Drive file and left the person's own
card and ระบบบ้าน showing a broken image, permanently, from a cleanup that
believed nothing referenced it.

**Cause, part one**: the list was complete when it was written. `team_members` +
`team_archive_members` covered every holder of a `photo_url` until 0132 gave
`people` one and its mirror copied the same URL down to `students`. Adding a new
holder of a value silently makes every existing count wrong, and nothing about
the counting code looks stale.

**Cause, part two, and the reason the obvious fix is worse than nothing**:
querying the extra tables from the browser does not work.

```
students_admin_all  →  house / vp_admin / dev
advisors_admin_all  →  house / vp_admin / dev
people_read         →  team / team_edit / house / vp_admin / dev
```

The admin who deletes ทีม SAMO members holds `team_edit`, not `house`. **RLS does
not raise — it returns zero rows.** So for exactly the caller who triggers this
cleanup, the added queries answer "no references", which is indistinguishable
from the truth, and the file is deleted anyway. This is the read-side twin of
"RLS does not RAISE on UPDATE/DELETE" in `tooling-proofs.md`.

**Fix**: `photo_reference_count(url)` — SECURITY DEFINER, counts all five tables
with the owner's rights, returns an integer. It leaks nothing: the caller
already holds the URL and is asking whether they may delete the file. Every
ambiguous input is pinned to the safe direction — a blank URL answers **1**, and
the client deletes only on a definite numeric zero (`!Number.isFinite(refs) ||
refs !== 0` keeps the file).

**Where it lives now**: `supabase/migrations/0143_a_refcount_the_caller_cannot_undercount.sql`,
`src/js/team/api.js`, `src/js/photo-refcount.test.js` (scans the migration DDL
for every table given a `photo_url` and fails if the count omits one),
`tools/team0143-photo-refcount.mjs` (5/5).

**Rules**: (1) A refcount must name every referrer, and adding a column that
holds a foreign id means auditing every count of it. (2) **Never do a refcount
in the client when RLS can hide a referrer** — a blocked read is zero rows, not
an error, and the resulting undercount deletes data. (3) Pin every ambiguous
answer to the direction that keeps the file.

---

## "เปลี่ยนรูป เปลี่ยนรูปแล้ว แต่ในไดรฟ์ยังมีรูปเก่าอยู่" — the cleanup existed, on one of the two writers

**Symptom** (reported after the owner tested a fix for a different photo bug):
replacing a portrait from **ข้อมูลของฉัน** changed the picture everywhere in the
app, but the previous file stayed in Drive. Two files per person, sometimes
under two different names because a rename had happened in between.

**Cause**: `my-seat.js` — the self-service card EVERY ordinary member uses —
uploaded the new portrait, repointed the row, and stopped. It never called
`deleteTeamPhotoIfUnused`. The ทีม SAMO admin editor had cleaned up since 0143
and `team/terms.js` since the archive shipped, so the rule looked implemented;
it was implemented on two of three writers, and the missing one was the one with
the most users.

The file left behind is shared "anyone with the link", so this is a **privacy**
defect before it is a storage one: someone who replaces or removes their
portrait reasonably believes the old one is gone.

Two more of the same shape found while sweeping the other upload surfaces:
- **`house/index.js` uploaded the crest ON PICK.** Every intermediate choice
  became a real Drive file that no row ever pointed at — and a reference count
  cannot distinguish those from a live photo, so *nothing could ever clean them
  up*. Moved into `onHouseSubmit`, plus a cleanup for the replaced crest.
- **`shop/admin.js`** left the previous product image behind on every replace.

**A related discovery that explains the ORIGINAL report** ("it still uses the old
photo that I removed long ago"): `lh3.googleusercontent.com` **keeps serving a
Drive file after it is trashed**. A removed portrait therefore goes on rendering
as if nothing happened, which reads as "the app is pointing at an old photo"
when it is really pointing at a deleted one. Emptying the trash is part of
removing a photo, not an afterthought.

**Fix**: one rule, `photoToRetire(prevUrl, payload, key)` in `team/api.js`, used
by all three writers. Its key-presence test is load-bearing — **นำรูปออก sets the
column to `null`, and any `??` / `||` fallback reads that null as "unchanged"**
and skips the cleanup on the one action whose entire point is that the file
should be gone. `src/js/photo-retire.test.js` covers both directions (too eager
breaks a live portrait; too shy is this bug).

The audit is the guard: `src/js/upload-cleanup.test.js` holds one row per
uploading module naming what cleans up after it, and fails when a new upload
site appears without one. Two obvious rules were tried first and both were
wrong — "the uploading module must also delete" (shop/checkout.js uploads a slip
that shop/api.js correctly deletes) and "never upload in a change handler" (the
QR, banner and slip pickers upload and PERSIST in the same handler, orphaning
nothing). Written down, the debt is visible: the whole `uploadPRFile` family
(announcement covers, Quill inline images, PR attachments) has **no delete
action in `appscript/prform.gs` at all**, so those need a GAS change first.

**Where it lives now**: `src/js/team/api.js` (`photoToRetire`) ·
`src/js/my-seat.js` · `src/js/house/index.js` · `src/js/shop/admin.js` ·
`src/js/photo-retire.test.js` · `src/js/upload-cleanup.test.js`.

**Rule**: a feature implemented on the writers you happened to be looking at is
not implemented. Enumerate the writers — and when the rule is "what happens to
the thing this replaces", make it one function they all call, because the
difference between three correct copies and two is invisible until someone
opens Drive.

---

## "ลบรูปใน Drive แล้ว แต่เว็บยังขึ้นรูปเดิม" — a TRASHED Drive file is still served publicly

**Symptom**: the owner deleted their portrait's file in Google Drive and the app
went on showing it. Reported twice, in two different shapes, before the cause
was pinned: first as "it uses the old photo I removed long ago", then as "I've
deleted what I uploaded in the Drive and it still shows my picture".

**Cause**: `lh3.googleusercontent.com/d/<id>` — the URL form this app stores and
renders — **keeps serving a file after it is trashed**. Verified live, twice, on
files that were sitting in the trash at the time:

```
curl -sL "https://lh3.googleusercontent.com/d/<trashed-id>=w200"
→ HTTP 200, image/jpeg, 12327 bytes
```

Two consequences, and the second is the serious one:

1. **Deleting in Drive is not how you remove a photo from the app.** Nothing
   tells the database, so the row still points at the URL — and the URL still
   works. The only removal that works is the app's own นำรูปออก, which nulls the
   column *and* trashes the file.
2. **Our own delete was not a removal either.** Every GAS handler ended in
   `file.setTrashed(true)`, and the file stayed shared "anyone with the link".
   So for the whole 30-day undo window — forever, if the trash is never emptied
   — a portrait somebody had deliberately removed was still readable by anyone
   who had ever seen its URL. For a portrait that is a privacy failure, and the
   comment above the line said "trash, not purge: Drive keeps a 30-day undo
   window, which is the right trade", which is true about RECOVERY and says
   nothing about VISIBILITY.

**Fix**: revoke the share *before* trashing —
`file.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE)` then
`setTrashed(true)`. Access dies immediately, the 30-day undo survives. Applied
to all four samoweb handlers via `revokeAndTrash_()`, to `deleteProjectFolder`
(whose children keep serving exactly as a trashed file does, so the files inside
are revoked before the folder is trashed), and to the passport's `handleDelete_`
in the other repo — the same line, the same gap.

**Where it lives now**: `appscript/prform.gs` (`revokeAndTrash_`) ·
`samomdkkupassport gas/Upload.gs` (`handleDelete_`).

**Rule**: for a publicly-shared file, "deleted" means UNREACHABLE, not "moved to
Trash". Revoke access first; the bin is about recovery, not about who can see
it. And when a user says "I deleted it and it still shows", check whether the
CDN honours the deletion before looking for a cache or a stale row.

---

## `uploadPRFile` had no counterpart, so every announcement cover ever re-cropped is still in Drive

**Symptom**: found by audit, and confirmed by the shape of the Drive folder.
Announcement covers are re-cropped on any edit and each crop is a new upload, so
an article edited five times left five covers — four of them orphaned and all
five publicly readable.

**Cause**: `uploadPRFile` is the oldest upload path in this project and the only
one that never got a delete action. Shop, Team and Projects each grew one; PR
did not, so `announcements.js`, the Quill image handler and `pr-form.js` all had
nowhere to send a cleanup even if they had wanted to.

**Fix**: `deletePRFile` in `appscript/prform.gs`, scoped by the same ancestry
check as the other three (`fileLivesUnderTop_(file, 'PR')`) because this
endpoint is unauthenticated and the check is the only thing between a caller and
the owner's whole Drive. It adds no new Google service, so it does not widen the
auto-derived OAuth scopes — the trap that took the delete gate down for an hour
on 2026-07-31.

Then `filesToRetire(before, after, others)` in `announcements.js`: an article
body is rich text, so "which files does this article use" is a question about
its HTML, not about a column. **It diffs Drive FILE IDS, never URL strings** —
one file appears as `=w1200`, `=w600` and a bare `/view` depending on when it
was inserted, and comparing URLs would call two spellings of one file two
different files and delete a picture the body still renders. `others` is the
whole live list, because duplicating an article for next year gives two rows one
cover.

Two upload sites were left uncleaned ON PURPOSE, and the reasons are recorded in
`src/js/upload-cleanup.test.js` rather than in someone's memory: PR request
attachments (written once, never replaced, and the staff delete is a RECOVERABLE
soft delete — trashing there would destroy a restorable ticket's evidence), and
Quill images in the VS form (written once, no edit path; what does leak is an
image pasted by someone who then abandons the form, which needs the
upload-on-SAVE change portraits already got).

**Where it lives now**: `appscript/prform.gs` (`handleDeletePRFile`) ·
`src/js/uploads.js` (`deletePRFile`, `driveIdsInHtml`) ·
`src/js/announcements.js` (`filesToRetire`) ·
`src/js/announcement-files.test.js` (23 cases, both directions).

**Rule**: when a subsystem has an upload and no delete, that is not "not needed
yet" — it is a leak with an age. And a cleanup that compares URLs instead of
resource IDS will eventually delete something still in use, because one resource
has as many URLs as the app has ever had rendering sizes.
