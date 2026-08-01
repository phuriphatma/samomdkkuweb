# Mistakes log — archive

Entries moved out of `.claude/rules/mistakes.md` to keep that file under the
agent context-budget limit. These are still real, still apply — they're just
stable / niche enough that they don't need to sit in the always-read hot path.
If a symptom isn't in `mistakes.md`, check here.

Each entry: **Symptom → Cause → Fix → Where it lives now**.

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

## CI `npm test` fails on Node 20 — supabase-js throws "Node.js 20 detected without native WebSocket support" at import

**Symptom**: Every GitHub Actions `build` run (build.yml) fails in ~18s,
on `main` AND `refactor/modular`, for many commits in a row. Tests pass
locally. The CI log's failing step is `npm test`, with
`Error: Node.js 20 detected without native WebSocket support.` →
`Process completed with exit code 1`. The build step is never reached.
**Cause**: `@supabase/supabase-js` (^2.106.1) → realtime-js hard-throws at
**import time** when `globalThis.WebSocket` is absent. Node 20 has no
global WebSocket; Node 22 ships a stable one. At least one Vitest file
transitively imports `src/js/db.js` (which imports `@supabase/supabase-js`),
so the throw fires the moment Vitest loads that module — before any test
runs. Tests pass locally only because the dev machine runs Node 22+.
(`npm run build` is unaffected: Vite *bundles* db.js, it never *executes*
its module-level code in Node — the WebSocket check only runs at real
import, i.e. in the browser at runtime and in the Node test process.)
**Fix**: Bump `node-version` in `.github/workflows/build.yml` from `'20'`
to `'22'`. Also bumped README "Prerequisites" to Node 22+ so contributors
don't hit the same wall locally. Do NOT pin CI back to Node 20 while on
this supabase-js line. If a future need forces Node 20, the alternative is
to stop the test process importing db.js (isolate the pure-helper tests) or
polyfill `globalThis.WebSocket` in the Vitest setup — bumping Node is the
cleaner fix.
**Where**: `.github/workflows/build.yml` (`node-version: '22'`); `README.md`
Quick start prerequisites.

---

## Hard-deleting a row referenced by an `ON DELETE RESTRICT` FK fails 23503 — degrade to archive, don't surface the raw error

**Symptom**: Admin SAMO Shop → ลบสินค้า on a product that has been ordered
→ "ลบไม่สำเร็จ: {"code":"23503", ... "shop_order_items_product_id_fkey" ...}".
The raw PostgREST error JSON is dumped into the toast.
**Cause**: `shop_order_items.product_id references shop_products(id) ON DELETE
RESTRICT` (0003 schema) — deliberately protects order history. Any product
that appears in even one order can never be hard-deleted; PostgREST returns
Postgres error 23503 (the FK guard makes the DELETE a clean no-op, so nothing
is half-deleted). `deleteProduct` rethrew `error.message` raw (which, via
`dbRest`, is the whole PostgREST JSON body string — that's why the toast
showed JSON).
**Fix**: `shop_products` already has `is_active` + a read policy
`using (is_active OR current_user_is_shop_admin())`, so archiving (set
`is_active = false`) hides a product from the shop while keeping it visible to
admin and preserving every order FK. Same write RLS as DELETE
(`shop_products_write_admin` `for all`), so no auth change and no soft-delete-
RLS trap. `deleteProduct` now detects 23503 / the FK name and throws a typed
`PRODUCT_HAS_ORDERS` error; the admin click-handler offers a confirm to
`archiveProduct()` instead.
**Where**: `src/js/shop/api.js` (`deleteProduct` typed error +
`archiveProduct`), `src/js/shop/admin.js` (delete handler fallback). **Latent
parallel**: `project_documents.type_id references project_doc_types(id) ON
DELETE RESTRICT` (0005) is the same class — no UI deletes doc types today, but
if one is added, apply the same detect-23503-then-archive/block pattern.

---

## nginx subpath app: bare `/passport` (no trailing slash) silently serves the wrong SPA

**Symptom**: `https://samo.md.kku.ac.th/passport` stopped working — it served
the samoweb SPA (or "not found") instead of the passport app. `/passport/`
(with slash) was fine.
**Cause**: `location /passport/` is a prefix match that only matches URIs
*beginning with* `/passport/`. A bare `/passport` does NOT match it, so it fell
through to the catch-all `location /` whose `try_files … /index.html` serves
samoweb's index from `root /var/www/samo-web`. Nginx's built-in
trailing-slash auto-redirect (301 `/passport` → `/passport/`) only fires when
the active root actually contains a `passport` directory — but passport lives
at `/var/www/passport` (reached via the `root /var/www` override *inside* the
`/passport/` block), so under the catch-all's `/var/www/samo-web` root there's
no `passport` dir and the auto-redirect never triggers.
**Fix**: Add an exact-match redirect for the bare path, above the prefix block:
`location = /passport { return 301 /passport/; }`. `location =` (exact) always
wins over prefix matches, so ordering is safe.
**Where**: `server/nginx-samo.conf`. Apply the same `location = /foo { return
301 /foo/; }` pattern to ANY subpath-mounted app whose files live outside the
catch-all root. **`/admin` has the identical latent gap** (bare `/admin` →
samoweb catch-all) — patch it the same way if a bare `/admin` link ever ships.
To apply live on the VM: scp the config to the box, `sudo cp` it to
`/etc/nginx/sites-available/default`, `sudo nginx -t` (validates before
committing), `sudo systemctl reload nginx`.

---

## nginx without an `$uri.html` fallback breaks EXTENSIONLESS deep links that a retired Cloudflare-Pages host used to serve as clean URLs — old passport QR scans silently landed on the home page (no points)

**Symptom**: Old **printed** passport QR codes stopped stamping points/activities;
freshly-generated QR codes (from admin) worked. Scanning an old code showed the
pages.dev "we've moved" splash, then forwarded — but the user never earned the point.
Nothing errored.
**Cause**: Two facts collide.
- Old QR codes were generated when the app lived on Cloudflare Pages, which serves
  **clean URLs** — so they encode the **extensionless** path
  `/passport/html/scan?aid=..&tk=..` (no `.html`). New QRs are built from
  `ROUTES.SCAN = BASE + 'html/scan.html'` (WITH `.html`).
- The VM nginx `location /passport/` had `try_files $uri $uri/ /passport/index.html`
  — **no `$uri.html` step**. For `/passport/html/scan` (extensionless): `$uri` (no
  file `scan`), `$uri/` (no dir) both miss → nginx falls straight to
  `/passport/index.html` = the **home page**. The scan module never loads, the
  `aid`/`tk` params are dropped, no scan row is inserted. New `.html` QRs matched
  `$uri` directly, which is why only *old* codes failed.

  Confirmed live before/after with two curls comparing `<title>` (home
  "Samo Passport — Life is a Journey" vs scan "Stamping Passport..."). The token
  itself was fine — `generateStaticQR` never rotates `static_token`, so old and new
  codes for the same activity carry the same token; the break was purely path
  resolution.
**Fix**: Add the clean-URL fallback BEFORE the index fallback:
`try_files $uri $uri.html $uri/ /passport/index.html;`. Now
`/passport/html/scan` → `/passport/html/scan.html`. Edited `server/nginx-samo.conf`
AND applied live (backup → `sudo nginx -t` → `sudo systemctl reload nginx`; the
sudo password is piped from `.env.local` `SAMO_VM_SUDO_PASSWORD` over ssh — env vars
do NOT propagate over ssh, so `read -r PW` from stdin then `echo "$PW" | sudo -S`).
**Where**: `server/nginx-samo.conf` `location /passport/`. **Rule**: whenever an app
that ran on a clean-URL host (Cloudflare Pages, Netlify, `_redirects`) is re-hosted
on nginx, its `try_files` MUST include `$uri.html` or every extensionless deep link
(and every printed QR / old bookmark that predates the move) silently resolves to the
SPA index instead of the intended page. The public samoweb SPA is unaffected — it's a
single-`index.html` hash router with no sibling `.html` pages; the passport app is the
one with real per-page `.html` files (`dashboard.html`, `admin.html`, `scan.html`).

---

## A full-height centered page with `height:100% + overflow:hidden` is unscrollable on mobile when the content is taller than the viewport

**Symptom**: The pages.dev "we've moved" splash (`public/moved.html`) could not be
scrolled up/down on iPad — the card (and the countdown + CTA below it) were
clipped, unreachable. Fine on desktop / tall phone viewports; only bit where the
card exceeds the viewport (iPad landscape, large text / zoom, short screens).
**Cause**: the splash `body` used `html,body{height:100%}` + `body{display:grid;
place-items:center; overflow:hidden}`. `height:100%` pins the body to exactly the
viewport height, and `overflow:hidden` then clips anything taller — so a centered
card bigger than the viewport has its overflow hidden with no way to scroll to it.
(Same family as the iOS `100vh` drawer entry above — full-height mobile layouts
are the recurring trap.)
**Fix**: drop the fixed `height:100%` (keep `min-height:100dvh` so it still fills
the screen but can GROW past it), and change `overflow:hidden` → `overflow-x:hidden`
(kills only horizontal aurora bleed; per CSS the y-axis then computes to `auto`, so
the page scrolls vertically). Grid `place-items:center` with auto rows keeps the
card centered when it fits and top-aligned+scrollable when it doesn't. The fixed
background layers (`.aurora`/`.stars`, `position:fixed`) are unaffected — `body`'s
overflow never clips fixed descendants (their containing block is the viewport,
not `body`), so the backdrop stays put while content scrolls.
**Where**: `public/moved.html` in BOTH this repo and the passport repo. For any
future full-screen centered page, use `min-height:100dvh` (never `height:100%`)
and never `overflow:hidden` on the scroll root — reach for `overflow-x:hidden` if
you only need to tame horizontal bleed.

---

# Moved out 2026-07-25 — the GAS notify era + stable Bootstrap quirks

Discord/email notification left Apps Script entirely (GAS `/exec` → the `/notify`
Cloudflare Pages Function → the `samo-notify` node service on the KKU VM), so the
five GAS entries below no longer describe a live code path. They are kept because
the *shapes* recur: a fire-and-forget side channel that swallows its own failures,
a retry loop that can't tell a per-IP edge block from a per-webhook bucket, and a
platform whose logs are silently unavailable for the exact caller you're debugging.
The three Bootstrap entries are stable UI facts about the public SPA.

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

# Moved out 2026-07-30 — stable auth/signup config facts, one-off SQL gotchas, retired-path UI quirks

None of these describe a recurring CLASS; each is a single fact whose code path
is settled. The hot file keeps the classes that have bitten this repo twice or
more (row-level UPDATE without a column guard, unknown-reference fail-open,
scoped-is-not-full, read-path parity, mirrors that drift).

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

## Account-switcher: capturing the OUTGOING session's tokens fire-and-forget races the session swap → first switch-back forces a password re-login

**Symptom**: Signed in as VPA, switch to dev (works), then tap back to
VPA → forced to re-enter VPA username/password. Every *subsequent*
switch (dev↔vpa, to other accounts) then works. Only the FIRST
switch-back to a given account fails.
**Cause**: `pickAccount()` snapshotted the outgoing account with
`rememberAccount(getUser())` (whose token capture is a fire-and-forget
`getCurrentSessionTokens().then(write)`), then `await sleep(80)`, then
`setAuthSession(targetTokens)`. The 80ms was a *hope* that the capture
flushed first. When it didn't, `getSession()` resolved AFTER the session
was already swapped to the target — so the **target's** tokens got
written onto the **outgoing** account's saved entry. Worse, those target
tokens were the pre-swap refresh_token, which `setAuthSession` had just
**rotated** (supabase refresh tokens are single-use) — so they were
already dead. Switching back replayed that dead token → `setAuthSession`
returns null → `clearSavedTokens` → password path. The re-login then
saved fresh, correct tokens, so every later switch worked.
**Fix**: Capture the outgoing tokens *synchronously awaited* while the
live session is still that account, BEFORE the swap. Split
`rememberAccount` into `writeAccountEntry()` (sync identity row) +
`stitchCurrentTokens(key)` (awaitable token capture); add
`rememberAccountAwait()` and call `await rememberAccountAwait(getUser())`
in `pickAccount` (dropping the 80ms sleep). The normal sign-in subscriber
path keeps the fire-and-forget `rememberAccount` (no swap racing it).
**Where**: `src/js/account-switch.js`. Never capture a session's tokens
fire-and-forget when the very next step replaces that session — the read
will race the write and snapshot the wrong (and already-rotated) tokens.

---

## (Passport repo) Forcing Google OAuth `hd=<workspace-domain>` redirects to the domain's SAML IdP — a broken IdP URL then hard-fails login with ERR_ADDRESS_INVALID

**Symptom**: SAMO Passport login broke — after clicking "Board Your Flight",
the browser showed `This site can't be reached` at
`https://ssonext-api.kku.ac.th/sso/SingleSignOnService/kkumail.com.m`,
`ERR_ADDRESS_INVALID`. Reproduced when signing in fresh / after logout.
**Cause**: `signInWithOAuth({ options: { queryParams: { hd: 'kkumail.com' } } })`
in `js/index.js` + `js/scanning.js` (added as a "pre-filter the Google chooser
to kkumail" UX hint). But `kkumail.com` is a Google **Workspace domain with
third-party SAML SSO** (KKU's IdP). Passing `hd` for such a domain makes Google
skip its normal chooser and redirect **straight to that domain's IdP SSO URL**,
which for KKU is malformed (`…/kkumail.com.m`) → Chrome can't navigate it →
`ERR_ADDRESS_INVALID`. `hd` is documented as only a hint, but for an SSO-federated
Workspace domain it changes the flow, not just the UI.
**Fix**: Remove `queryParams.hd` from every `signInWithOAuth` call. The normal
Google chooser routes a kkumail login through Google's own (working) SSO
handling; the real kkumail-only enforcement is the app-side gate
(`getPassportAccess` / `renderAccessBlock`), so nothing is weakened. If the
error persists with a REAL kkumail account after removing `hd`, the fault is
KKU's SSO endpoint (their infra), not our code.
**Where**: passport repo `js/index.js`, `js/scanning.js` (commit `33ddf07`).
Don't reintroduce `hd` for any OAuth call against an SSO-federated Workspace
domain — enforce the domain app-side instead.

---

## (Passport) An `AFTER INSERT`-on-`auth.users` re-key trigger only fires for accounts that have NEVER logged into the project — pre-existing accounts silently don't get their carried data

**Symptom**: A gmail→kkumail migration test on `pmphuriphat→phuriphat.ma`
showed the receiving kkumail account with **no points/activities/stamps**,
even though the migration "moved" the data.
**Cause**: The merge relies on `passport_link_user_by_email()`, wired as
`on_auth_user_created_passport_link` **AFTER INSERT on auth.users** (0060/0063).
It re-keys a carried profile (matched by email) to the new auth uuid — but only
on the **INSERT** of the auth user, i.e. the account's **first-ever login** to
the project. `phuriphat.ma` already had an auth user (logged in months earlier),
so the trigger had already fired (finding nothing then) and will NOT fire again;
`ensureProfile()` matches by **uuid only** (not email), so it just creates an
empty profile. Data stranded on the old-uuid profile. **The real 5 are fine** —
verified none of their kkumail addresses had a pre-existing `auth.users` row, so
their first kkumail login WILL fire the re-key. The trap is only for a target
account that already exists.
**Fix / how to test such a case faithfully**: don't rely on the login trigger
for an already-existing target — do the re-key manually (move
`scans.user_id`/`season_results.user_id`/`profiles.id` old→new uuid), which is
exactly what the trigger would have done. Before any future re-key migration,
check `auth.users` for a pre-existing target row; if present, the trigger won't
fire and the profile must be merged/re-keyed explicitly.
**Where**: trigger in `0060`/`0063`; `ensureProfile` in passport `js/auth.js`;
verification + tracker queries recorded in STATE.md passport section.

---

## Adding `prefers-color-scheme: dark` to ONE component in a light-only app makes just that component go dark on a dark-mode OS

**Symptom**: The new landing-page stat strip rendered **dark green** while the
rest of the (white) site stayed light. Only happened for users whose OS/browser
was set to dark mode.
**Cause**: This app is **light-only** — a repo-wide grep shows ZERO
`prefers-color-scheme` / `data-theme` rules anywhere except the files just added
(`home-stats.css`, `analytics.css`). Those new files included
`@media (prefers-color-scheme: dark)` + `:root[data-theme="dark"]` overrides
(a good habit for standalone artifacts / theme-aware sites — but wrong here).
With no app-level theme system, the media query is the ONLY thing reacting to
the OS preference, so a dark-mode visitor got a dark component island floating
in the otherwise-white page. The general "design both themes" guidance has an
explicit carve-out — *"a design that deliberately commits to one visual world
may stay single-theme"* — and this app has committed to light.
**Fix**: Remove all `prefers-color-scheme` / `data-theme` blocks from
`home-stats.css` + `analytics.css`; they now render light unconditionally.
**Rule**: before adding dark-mode CSS to a NEW component, grep the app for an
existing theme system (`prefers-color-scheme`, `data-theme`, a theme toggle). If
there is none, the app is single-theme — match it, don't unilaterally introduce
a half-theme that only your component honors. (Standalone Artifacts are the
exception — those SHOULD be theme-aware; the deployed app is not.)
**Where**: `src/css/home-stats.css`, `src/css/analytics.css`.

---

## A PL/pgSQL `RETURNS TABLE(... col ...)` function silently ignores `ORDER BY col` — the OUT-param name shadows the query column, so it sorts by the NULL variable

**Symptom**: `find_similar_vs_tickets` (migration 0068) returned the right rows
but in the wrong order — "most similar" was NOT first. No error; the migration
applied clean (the bug only executes at call time, which needs a real staff JWT,
so it never showed during `apply-migration`).
**Cause**: the function is `returns table (... sim real)` and the body did
`return query select …, similarity(…) order by sim desc`. In PL/pgSQL every
`RETURNS TABLE` column is also an OUT **variable**. The final SELECT column is the
*expression* `similarity(…)` — it has no output name `sim` — so `order by sim`
does NOT bind to the query column; it binds to the OUT variable `sim`, which is
unset (NULL) at that point → `order by NULL` → no effective sort. Postgres does
not raise; it just doesn't sort.
**Fix**: order by the **explicit expression**, never the OUT-param name:
`order by …, similarity(regexp_replace(…), v_problem) desc`. (Alternatives:
rename the OUT column so it can't shadow, or `order by <position>`.)
**Where**: `supabase/migrations/0068_vs_dedup.sql` `find_similar_vs_tickets`.
Rule: in any `RETURNS TABLE` PL/pgSQL function, never `ORDER BY`/`WHERE` on an
OUT-param name that isn't an actual output alias of the query — use the
expression or a column position. Verify sort-dependent RPCs by executing them
(not just applying), since the shadowing is silent.

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

## A `data-role="x"` element with no matching toggle in the JS is visible to EVERYONE — and a role with no empty-state copy reads as a broken page

**Symptom**: "I assigned myself as อาจารย์ on ทีม SAMO, but when I open
หนังสือโครงการ I see nothing." Not a permission bug — verified live that 0 sign
requests named that account (all 11 named `saprof`), so an empty inbox was
CORRECT. It looked broken because of what the empty state said: nothing.
**Cause**: `#projectsGridEmpty` carries one `<span data-projects-role="…">` per
role, and `applyRoleVisibility()` toggled `d-none` on the `vp_admin` and
`uni_staff` spans only. There was no `sa_prof` span at all, so a professor got
the heading "ยังไม่มีโครงการในมุมมองนี้" above an EMPTY paragraph — no reason, no
next step. A role whose normal state is "empty until someone sends you
something" needs that said out loud, or every professor's first login looks like
a failure.
**The trap in the fix**: these spans carry NO `d-none` in the markup — they are
hidden by the JS toggling it ON. So adding a `data-projects-role="sa_prof"` span
WITHOUT adding a matching `querySelectorAll` block makes it visible to every
role instead of only the professor (a vp_admin would read both "กด สร้าง
โครงการใหม่" and "เมื่อเจ้าหน้าที่คณะส่งหนังสือมาให้ลงนาม"). Default-visible +
opt-in hiding means an unhandled attribute FAILS OPEN.
**Where**: `src/html/tab-projects.html` `#projectsGridEmpty`;
`src/js/projects/index.js` `applyRoleVisibility()` (now toggles all three roles).
**Rules**: (1) when a role can legitimately see zero rows, write its empty-state
copy — "nothing here yet" and "you have no access" look identical to a user.
(2) Any attribute-driven visibility scheme that hides by ADDING a class fails
open; grep that every value in the markup has a handler
(`grep -o 'data-projects-role="[a-z_]*"' src/html/*.html | sort -u` vs the
`querySelectorAll` calls) whenever you add a role.

---

# Moved out 2026-08-01 — UI-shaped entries from the ทีม SAMO session

Real, still applicable; moved because they are UI/UX classes rather than the
data-safety ones the hot file keeps.

## Bootstrap gives EVERY modal the same z-index — so a stacked modal declared earlier in the HTML paints BEHIND the one that opened it

**Symptom** (reported): in จัดการทีม → a person → the ตำแหน่ง selector, "it
doesn't show the popup, it shows เลือกตำแหน่ง behind it". The picker opens, the
backdrop dims, focus moves into it — and it is invisible, underneath the member
editor. Reads like a broken `.show()` call or a missing `d-none` toggle.
**Cause**: Bootstrap's docs say "multiple open modals are not supported" and the
CSS means it — every `.modal` is z-index 1055 and every `.modal-backdrop` 1050,
with no per-instance adjustment. Equal z-index means **DOM order decides the
painting order**, so the modal declared LATER in the HTML wins. `#teamPickerModal`
sits at line ~149 of `tab-team.html` and `#teamMemberModal` at ~372, so opening
the picker from the member editor put it behind. Nothing about the JS is wrong,
and the same code works perfectly when the picker is opened from the tree (no
other modal up), which is what makes it look intermittent.
**Fix**: `src/js/modal-stack.js` — ONE delegated `show.bs.modal` listener,
wired in both entries. It counts `.modal.show` (the event fires before Bootstrap
adds `.show` to this element and before it appends this modal's backdrop, so the
count is exactly the modals already up), and lifts this modal to
`1055 + depth*20` with its backdrop 10 below. `hidden.bs.modal` clears the
inline z-index and re-asserts `modal-open` on `<body>`, which Bootstrap strips
on ANY hide even when an outer modal is still shown.
**Where**: `src/js/modal-stack.js`; `initModalStack()` in `main.js` +
`admin-main.js`. **Rules**: (1) opening a modal from inside another modal needs
this — do not "fix" it by reordering the HTML, which only moves the problem to
the next pair. (2) It composes with the existing stacked-backdrop entry above:
use `getOrCreateInstance(el).show()` (never `new bootstrap.Modal`) AND let the
stacker place it.

---

## A class in the markup with NO rule in any stylesheet is invisible in review and looks exactly like a broken value — assert the coverage

**Symptom** (reported with a screenshot): the ทีม SAMO member editor's portrait
preview rendered at full size and burst out of the modal, over the form. The
call site looked right. The markup looked right.
**Cause**: `.team-photo-field` / `-preview` / `-controls` / `-empty` were written
into `src/html/tab-team.html` and **the stylesheet rules were never added** —
`grep -rn "team-photo" src/css/` returned nothing. With no box to fit, an `<img>`
renders at its natural size (Bootstrap 5's Reboot does NOT set a global
`img{max-width:100%}` — that is `.img-fluid`, opt-in). Nothing errors, nothing
logs, and the diff that introduced it reads as complete.
**Fix**: the rules, plus a TEST that makes the class impossible to forget —
`src/js/team/health.test.js` extracts every `team-*` class from the partial and
every `team-health-*` / `imgcrop-*` class from the JS, and asserts each has a
rule in the stylesheets those entries load. Run on the existing code it
immediately found four more: two deliberate layout hooks (allow-listed by name,
so the list itself stays meaningful), one **dead class** (`team-picker-dialog` —
no rule, no JS selector, removed), and one genuinely missing rule
(`team-perm-inherited-label`).
**Where**: `src/css/team.css`; the coverage tests at the bottom of
`src/js/team/health.test.js`. Two things that make the test not-annoying: the
allow-list is explicit and named (a growing allow-list is a smell, not a
solution), and the regex uses `(?<!-)` so a CSS CUSTOM PROPERTY set from JS
(`--imgcrop-ratio`) is not mistaken for a class.
**Rule**: when a layout bug appears in NEW markup, `grep` one of its class names
against `src/css/` before debugging the JS. And for any module that owns its own
class namespace, assert the coverage — it costs six lines and catches the whole
class. Related: the entry above on `convertDriveUrl`'s ignored size argument;
both bugs were in that one screenshot, and either alone was survivable.

---

## An indicator that links to a LIST moves the work instead of removing it — the click already said WHICH one, so carry it

**Symptom** (reported): "when I click the flag on a person in จัดการทีม it goes
to ตรวจสอบข้อมูล, but I don't know where to look — the admin shouldn't have to
remember the person they just clicked." Exactly right, and the feature had
looked finished: the flag was on the correct rows, the tooltip named the real
reasons, the navigation worked.
**Cause**: the flag answered "does this person need attention?" and then handed
over to a screen answering "who needs attention?" — a strictly *less* specific
question than the one just asked. With 24 findings the admin re-scans a list to
re-find someone they had already pointed at. The information was thrown away at
the exact moment it was most precise.
**Fix**: the navigation carries the subject. A member-row flag opens the pane
filtered to that person; a rolled-up count on a ตำแหน่ง filters to that whole
branch (clicking "11" is asking about those 11). Three details that make a
filter safe rather than confusing:
- **The filter is stated and reversible on screen** — a "แสดงเฉพาะ … · N
  รายการ" banner with a "ดูทั้งหมด (24)" button. A silent filter is worse than
  none.
- **Arriving by the ordinary tab CLEARS it.** A screen that quietly keeps
  showing a subset reads as "everything else is fixed".
- **The empty state must know it is filtered.** "ข้อมูลครบถ้วน" under a filter
  is a lie about the other 23; it says "…สำหรับ <คนนี้> แล้ว" instead.
**The bug this shape hides**: the filter and the indicator must agree about
which records a finding concerns. If the filter's id extraction missed one of
the shapes the indicator uses, clicking a flag would open a pane declaring that
person has NOTHING wrong — indistinguishable from a resolved problem, so nobody
reports it. `idsOf()` is therefore exported and unit-tested directly against the
flag map ("every flagged member is reachable from at least one finding").
**Where**: `src/js/team/health.js` (`idsOf`, `focusIds`, `enterHealth(focus)`),
`src/js/team/index.js` (`openHealthFor`, `memberIdsUnder`).
**Rule**: whenever a per-row indicator navigates to an aggregate view, pass the
row through. And when two code paths derive "which records does this concern?",
test them against each other — the failure mode is a screen confidently saying
"nothing here", which reads as success.
