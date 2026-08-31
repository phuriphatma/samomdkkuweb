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

---

## Dropping a column while the SERVED bundle still names it — `42703` on the live admin tab

**Symptom**: minutes after applying a migration, ระบบบ้าน's admin tab in
production showed `{"code":"42703","message":"column students.year_override does
not exist"}` and loaded nothing. Reported by the owner while the session that
caused it was still running.

**Cause**: migration 0129 dropped five vestigial columns from `students`. The
LOCAL code had already stopped asking for them — `STUDENT_COLS` in
`src/js/house/api.js` was edited in the same commit — but that commit had not
been deployed. The bundle actually being served was the previous build, and it
still sent `select=…,year_override,is_listed,…`. PostgREST answers an unknown
column with **400 / 42703 on the whole query**, not by ignoring it, so
`fetchStudents()` threw and the entire workspace `reload()` failed.

Everything about the drop was checked first — no function body referenced the
columns, no trigger fired `of <column>`, every stored value was the default. The
one reader nobody checked was the artifact on the server, which is precisely the
reader `docs/mistakes/tooling-proofs.md` already says to check: *"grep the SERVED
bundle, not the local file."* That rule was written for verifying a fix. It
applies just as hard to verifying a **removal**.

**Fix**: deploy, then verify from the served bundle
(`curl <host>/assets/admin-*.js | grep -c year_override` → 0). ~20 minutes of
downtime on one admin tab.

**Where it lives now**: `supabase/migrations/0129_students_lose_the_vestigial_columns.sql`.

**Rule**: a schema REMOVAL and a code deploy are ordered, and the order is
**deploy first, drop second**. Adding a column is safe in either order because
old code simply does not ask for it; dropping one is not, because old code is
still asking. If the drop must go first, it is not a drop — it is a two-step:
ship the code that stops reading the column, confirm it is the version being
SERVED, then drop. The window between them is measured in whatever your deploy
takes, and during it the feature is down.

## `systemctl enable --now` reported success and scheduled nothing

**Symptom.** The Claude usage reporter's timer had been `disable`d by hand for
four days to stop a Discord alert loop. Re-enabling it with
`sudo systemctl enable --now samo-claude-usage.timer` printed the symlink line,
and `is-enabled` / `is-active` both answered `enabled` / `active`. It would
never have run again. The tell was one field:

```
NextElapseUSecMonotonic=infinity
NEXT  -   LEFT  -   LAST Fri 2026-08-21 17:15:24 UTC
```

An empty `NEXT` in `systemctl list-timers`, which nothing about the enable
command draws your attention to.

**Cause.** The unit had only monotonic triggers:

```ini
OnBootSec=3min
OnUnitActiveSec=15min
```

`OnBootSec` is measured from BOOT. The machine had been up for weeks, so that
trigger point was long past and consumed. `OnUnitActiveSec` only chains from a
run that has already happened, and the timer had not run since being disabled.
So nothing anchored a next elapse, and systemd correctly scheduled infinity —
there was no rule left that named a future instant.

The unit worked for months because it was enabled once, shortly after a boot,
and then never stopped. The failure needs a gap: `disable`, wait past the boot
window, `enable --now`. Which is exactly the workflow the new pause switch
(migration 0167) creates, and will create again.

**Fix.** `OnActiveSec=1min`, which is relative to the TIMER being started rather
than to boot or to a previous run. Enabling now always anchors a first run a
minute later, and `OnUnitActiveSec=15min` chains from there. Verified live: the
timer fired on its own at 16:19:44 and scheduled 16:34:44.

**Where it lives now.** `server/samo-claude-usage.timer`, with the measurement
in a comment on the line.

**The general rule.** *`enable` is not `schedule` — after enabling any timer,
read `NEXT` from `systemctl list-timers`, not `is-active`.* A unit whose only
triggers are relative to events that already happened is enabled, active, and
inert. Any timer that a human will ever stop and restart needs at least one
trigger anchored to the TIMER's own activation.

---

## "I grepped the served bundle for the string I just changed and it is not there — did the deploy fail?"

**Symptom.** A one-line copy fix to `src/js/db.js` was deployed to the VM.
`DEPLOY_EXIT=0`, VM `git log` matched local HEAD. Then the standing
verification step — grep the SERVED artifact for a string the change added —
found the new text in **0 of 27 bundles**. The old text was also gone, so the
evidence was equally consistent with "the deploy worked" and "the deploy
silently shipped nothing".

**Cause.** The string lives inside a guard on a build-time variable:

```js
const url = import.meta.env.VITE_SUPABASE_URL;
if (!url || !anonKey) { console.error('[db] Missing Supabase env vars…'); }
```

Vite **substitutes** `import.meta.env.*` at build time. On any build where the
variable is set — which is every real build, on the VM and on a developer's
machine alike — `!url` becomes `!"https://…"`, folds to `false`, and the minifier
deletes the whole branch. **The message ships only in a build that does not have
the values**, which is precisely the situation it exists to explain. It is not
missing from production; it cannot be in production.

**Fix.** Nothing to fix in the code. What was wrong was the verification. Proved
in both directions before believing it:

```bash
# with the vars present (the VM build, and a normal local build)
grep -l "Missing Supabase env vars" dist/assets/*.js        # → nothing
# with them blanked, which is when the message is meant to appear
VITE_SUPABASE_URL= VITE_SUPABASE_ANON_KEY= npx vite build --outDir /tmp/noenv
grep -c "Missing Supabase env vars" /tmp/noenv/assets/*.js  # → analytics-*.js:1
```

A control ran alongside it — a string known to ship (`อัปเดตไม่สำเร็จ`) greps 1 in
eight `analytics-*.js` chunks, so the grep and the path were both working.

**Where it lives now.** `src/js/db.js`, and this entry. `STATE.md` already warns
that a bundle grep can read 0 for reasons that are not "the deploy failed" —
minified module-scope names, and code landing in the SHARED chunk. This is the
third reason and the only one where the string is *deleted rather than renamed*.

**The general rule.** *A string behind a build-time flag is not in the artifact
you are grepping — it was compiled out.* Before concluding a deploy failed,
ask whether the code you changed can even be reached in this build's
configuration, and verify a change like that by building **with the flag in the
state that makes the branch live**. Pick a verification string from code that
runs unconditionally; a control that greps a string you know ships tells you
whether the instrument or the deploy is the problem.


## "There is no preview deploy" — the contributor guide denied a pipeline that had been running for weeks

**Symptom.** `CONTRIBUTING.md` told every contributor: *"There is no preview
deploy — Cloudflare Pages is retired, so nothing comments a per-branch URL.
Review visually by running `npm run dev` locally."* Per-PR previews had been
live since phase 3 of the dev system: Cloudflare builds every branch, comments
the link on the pull request, and points the build at `samo-dev`. Read back from
the Cloudflare API, not from a doc: `preview_deployment_setting: all`,
`pr_comments_enabled: true`, preview `VITE_SUPABASE_URL` = the dev project.

**Cause — one true sentence and one false one welded together.** Cloudflare
Pages *is* retired **as the production host** (the VM serves
`samo.md.kku.ac.th`). It is *not* retired as the **preview builder**. The
paragraph inferred the second from the first, and the inference was written
before previews were switched on, so it was true when written. Nothing
re-examined it afterwards: `docs/TEAM-WORKFLOW.md` §9 is an explicit list of the
files a landed phase must correct, `CONTRIBUTING.md` is on it, and every OTHER
entry on that list had been done — `README.md`, `.claude/rules/security.md`,
`skills/deploy-vm.md`. A checklist that is followed four times out of five reads
exactly like a checklist that was followed.

**The cost is not "a stale doc".** It is the one sentence a new ฝ่าย contributor
uses to decide how to test their change. It sent them to a local dev server
pointed at whatever their `.env.local` held — which, for anyone who had not been
handed the `SUPABASE_DEV_*` block, is production — while a preview wired to the
dev copy was being built for them and its link posted on their own PR.

**Fix.** The section now describes the real flow, names `npm run preview:url`,
and says the thing nobody had written down anywhere: **a preview points at
`samo-dev`, so it is safe to submit forms on.** Guard:
`src/js/preview-docs.test.js` — it fails if a contributor-facing doc denies
previews while `tools/preview-url.mjs` and the `preview:url` script exist, and
it also asserts the doc POSITIVELY explains them, because deleting the paragraph
would otherwise pass.

**Where it lives now.** `CONTRIBUTING.md`, `src/js/preview-docs.test.js`.

**The general rule.** *A retirement is scoped to a ROLE, not to a technology.*
"We stopped using X for A" does not license "X does nothing here" — name the
role you retired it from, and check every other role it still plays before
writing the general sentence. **And when a design lists the files a landed
change must correct, that list is a checklist, not prose**: work it in the same
commit that lands the change, because a half-worked list is indistinguishable
from a finished one to everyone who comes after.


## GitHub was silently DELETING words out of the docs, and nothing could tell us until we rendered them somewhere strict

**Symptom.** None reported — nobody reads a sentence and thinks "a word is
missing here". Found only because a VitePress build of `docs/` refused to
compile. Three places where the published documentation says less than the
source does, confirmed against **GitHub's own renderer**, which is how these
files are actually read:

```bash
gh api -X POST /markdown -f mode=gfm -f text='A full-screen "ย้ายไป <kkumail>" block.'
# → <p>A full-screen "ย้ายไป " block.</p>
```

**Cause — two different markdown rules, both invisible.**

1. **An unknown tag is DROPPED, not escaped.** `<kkumail>` and `<gmail>` are
   placeholders, but to a renderer they are HTML tags nobody knows, so the
   sanitiser removes them. The sentence keeps its punctuation and loses its
   subject: *"ย้ายไป "*. Two of these sat in `docs/state-archive/`.
2. **A line that STARTS with a tag begins an HTML block, and an HTML block
   interrupts the paragraph** — so an inline code span cannot cross into it.
   `docs/mistakes/authz-rls.md` had a span opened at the end of one line and
   closed on the next, which began `<table>`. GitHub emitted a literal
   backtick, an empty `<table>` element, and a sentence in pieces.

**Fix.** Wrap the placeholders in backticks; keep a code span on one line.
`0175`-era commit. Guards, in order of authority:

- **`npm run docs:build` inside the required `build` check.** The Vue compiler
  refuses to build any of the above. This is the real guard.
- **`src/js/md-raw-tags.test.js`** — a fast local approximation for the same
  rule, so the failure arrives before CI.

**⚠️ The approximation was WRONG THREE TIMES, in both directions**, which is
the part worth remembering:

| Miss | What it did |
|---|---|
| multi-line inline code spans | reported 20 false hits — "fixing" them would have rewritten SQL in five write-ups for no reason |
| fenced blocks inside a blockquote (`> ```bash`) | a "fix" applied to one put stray backticks INSIDE a code block |
| a tag-name regex that swallowed attributes | `<img src="x">` came back as a tag named `img src=` |

Each is now a fixture in that test. A fourth version would be wrong too if it
were written from the same list the code came from.

**Where it lives now.** `src/js/md-raw-tags.js` + its test,
`.github/workflows/build.yml`, `docs/.vitepress/config.mjs`.

**The general rule.** *A permissive renderer does not report your mistakes — it
performs them.* Markdown, HTML and SQL all fail this way: the output looks
finished, so nobody looks twice. **When you have a choice of renderers, the
STRICT one is the instrument**, even if you publish with the permissive one —
its refusal to build is the only signal you are going to get. And when you must
approximate a renderer with a regex, remember you are re-implementing a parser:
give each thing it got wrong a fixture, because the next version will get a
fourth thing wrong.

## A missing docs page answered HTTP 200, so a dead link looked healthy

**Symptom.** `https://samo.md.kku.ac.th/docs/NOPE` — a page that does not exist
— returned **200 OK**. The reader saw the correct "404" page; every machine saw
success.

**Cause.** The nginx block ended `try_files $uri $uri.html $uri/
/docs/404.html;`. A `try_files` fallback to a FILE serves that file with the
status of a normal hit. It looks right in a browser, which is how it passes
review, and it lies to everything that is not a human: link checkers, uptime
monitors, crawlers, and any script asserting a page exists. A broken link then
survives until somebody happens to mention it.

**Fix.** `try_files $uri $uri.html $uri/ =404;` with `error_page 404
/docs/404.html;`. The reader still gets the styled page; the status is honest.

**Where it lives now.** `server/nginx-samo.conf`, in the `location /docs/`
block, with the measurement that found it.

**The general rule.** **A fallback that RENDERS the right thing is not the same
as one that REPORTS the right thing.** Whenever a rule ends in "…otherwise serve
this instead", ask what status code goes out with it — the humans are fine
either way, and the instruments are the ones you are lying to. Probe the DENY
half of every route, not just the allow half: `/docs/CONTRIBUTE` returning 200
proved the routing worked and said nothing at all about `/docs/NOPE`.

## The deploy went silent after "==> docs site" and was killed by its own timeout — twice

**Symptom.** `./server/deploy.sh` over ssh printed its three build headings,
then nothing. Both attempts ended at **exactly** the outer `timeout` value —
300 s on the first run, 600 s on the second — with no `==> fix permissions` and
no `==> done`. The site stayed healthy throughout; the docs publish and the
nginx reload simply never happened, so it read as "the deploy is slow" rather
than "the deploy is stuck".

**Cause.** **sudo's credential cache expired mid-run, and the next `sudo` had no
stdin to prompt on, so it blocked forever.** The deploy is driven by piping the
password in ONCE at the start (`printf '%s\n' "$PW" | ssh -tt … 'sudo -v && …'`,
with a short `sleep` to hold the pipe open). That was correct when the script
built one app and finished in ~90 s. It now runs three `npm ci` and three builds
— samomdkkuweb, samomdkkupassport and the docs site — and takes over five
minutes, which outlives the timestamp.

**Both obvious readings were wrong, and each was checked.** Not a slow build:
`DOCS_BASE=/docs/ npm run docs:build` measures **10 s** on the VM. Not a slow
rsync: the whole `publish()` measures **under a second**. Running the identical
steps with a fresh credential completed in 10 s end to end. What differed was
only the age of the sudo timestamp.

**Fix.** A keep-alive in `server/deploy.sh`: assert a cached credential up
front, then `sudo -v` every 45 s in a background loop that exits with its parent
(`kill -0 "$$"`). `skills/deploy-vm.md` also gained the measured duration — its
"~90 s" was from the one-app era — and now says to run the deploy with
`run_in_background` and a generous ceiling, because the ceiling was never the
thing anyone was waiting on.

**Where it lives now.** `server/deploy.sh`, above `publish()`;
`skills/deploy-vm.md`.

**The general rules.** Two, and the second is the transferable one:

1. **A credential handed over once must outlive the longest run, not the
   original one.** Anything that authenticates at the start and is consumed
   throughout — sudo, a session token, an ssh agent — becomes a hang the day the
   work between the first use and the last grows past the lifetime. Refresh it
   on a timer rather than assuming the run is short.
2. **A process that stops at EXACTLY its timeout was not slow, it was blocked.**
   A genuinely slow job finishes at an arbitrary time; only a stuck one lands on
   the round number. Treat "it hit the ceiling again, at the higher ceiling too"
   as proof that raising the ceiling is the wrong fix — the second run is the
   experiment that rules slowness out, so read it that way instead of raising it
   a third time.
