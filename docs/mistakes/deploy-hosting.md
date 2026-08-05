# Mistakes — Deploy, nginx & caching

The VM, the deploy script, and every layer between a build and a browser that already has one.

Each entry: **Symptom → Cause → Fix → Where it lives now**. The always-loaded index of every entry across all nine files is `.claude/rules/mistakes.md`; add new entries here, then run `npm run mistakes:index`.

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
