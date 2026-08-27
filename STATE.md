# STATE — what is true RIGHT NOW

**Split 2026-08-27.** This file was 1,403 lines against a ~200-line target
because it held three lifetimes at once. It now holds one: **status**.

| Looking for | It is in |
|---|---|
| rules that outlive a session | **`docs/INVARIANTS.md`** |
| what a past session did, and why | **`docs/state-archive/`** — newest `2026-08-27-state-split.md` |
| what one person is working on | `docs/state/<github-handle>.md` |
| the chronology | `git log --oneline` |
| bugs already paid for | `docs/mistakes/*.md`, indexed by `.claude/rules/mistakes.md` |
| architecture, RLS, schema, deploy | `docs/CONTEXT.md` |
| the backlog | `docs/NEXT.md` |

**Rules for editing this file, all of them paid for:**

1. **Give a decaying fact ONE home.** The split itself surfaced four facts with
   two homes, each corrected in only one: a deployed sha, the migration
   high-water mark, the test count, and a proof count reading 20 where the
   runner registers 23. `state-handoff.test.js` pins what is mechanically
   checkable; it cannot judge whether a sentence is TRUE.
2. **Grep the WHOLE file before correcting anything.**
3. **Never touch the deploy block unless you deployed.**
4. **Do not append a session narrative.** Write `docs/state/<your-handle>.md`,
   or archive it. Never rewrite someone else's.

---

## CURRENT DEPLOY

- Prod = KKU VM `samo.md.kku.ac.th`. Deploy = commit → push `main` →
  `skills/deploy-vm.md`. **Needs VPN. Pushing does NOT deploy.**
- **Last recorded deploy = `36ac1d5` (2026-08-26 late)**, VM HEAD confirmed over
  ssh, `DEPLOY_EXIT=0`.
  ⚠️ **Two blocks of this file disagreed about this until the split** — one said
  `2993dd1`, which is the deploy before it. `36ac1d5` is kept because it is the
  later claim and carries its ssh confirmation. **A stale sha here reads exactly
  like "a deploy is owed" and costs somebody a VPN session to disprove**, so if
  you deploy, correct THIS line and no other.
- ✅ **`main` being AHEAD of the deployed sha is the NORMAL state.** Most commits
  are docs, `docs/mistakes/` and tests, none of which reaches a bundle. Ask
  about `src/` and the two entry HTMLs alone — **EMPTY means current**:

  ```bash
  git diff --stat 36ac1d5..HEAD -- src/ ':!src/**/*.test.js' index.html admin/index.html
  ```

- ⚠️ **Verify a deploy from the SERVED artifact, and grep the RIGHT one.** The
  VM builds its own asset hashes, so find the bundle name in the served HTML.
  Most shared code lands in the chunk Vite names **`analytics-*.js`**, which
  BOTH entries load — grepping only `public-*.js` or `admin-*.js` reports 0 and
  looks exactly like a failed deploy. Pick a **string literal or a CSS class**
  as the marker; module-scope function names are renamed by the minifier.
  ⚠️ **A string behind `import.meta.env` is DELETED, not renamed** — Vite
  substitutes at build time, so a message inside `if (!VITE_SUPABASE_URL)` greps
  0 in every build that has the vars, correctly. Grep a known-shipping control
  beside whatever you are looking for.
- **1323 tests. Migrations through 0169.** Both have exactly ONE home, here, and
  `state-handoff.test.js` enforces that. **ALL 23 LIVE PROOFS GREEN — re-run
  2026-08-27**, after 0169 was applied to production. Run `npm test` /
  `npm run proofs`; never quote a remembered number.

---

### WHAT PROD IS DOING RIGHT NOW

- **Claude usage measurement is ON.** The owner switched it back on from
  `/admin#claude` on 2026-08-25 17:18 UTC; the timer wrote its first sample at
  17:20 and has run every 15 minutes since. ⚠️ **The previous version of this
  block said measurement was switched OFF, with a whole procedure for turning
  it back on. It had already been done.** Ask the DATABASE what the switch says
  before repeating a runtime claim out of this file — `select
  monitoring_enabled, monitoring_changed_at from public.claude_settings`.
- `monitoring_note` still holds the old pause reason. Not shown while
  measurement is on (checked in `paintMeasured`), and used correctly by the
  monitor-on Discord notice as "why it had been paused". Leave it.
- **`claude_bookings` is still EMPTY** — deployed, widely granted, and unused.
  (Head-counts rot here; the numbers and the query live under "What is owed".)
- ✅ **All three of the above were re-verified against the DATABASE on
  2026-08-27**: measurement `true` since 2026-08-25 17:18, **96 samples in the
  last 24 h with the newest 7 minutes old** — exactly the rate a 15-minute timer
  gives, so the reporter is healthy — 0 bookings, 154 `claude` holders.
  ⚠️ **Re-verify rather than quoting this**; it is a runtime fact with a
  timestamp, and `tools/db-query.mjs` takes a FILE, not an inline string.

---

### What is owed

- ✅ **MEASUREMENT IS ON AND NOTHING IS OWED HERE — 2026-08-25 17:18 UTC.**
  The owner flipped it on from `/admin#claude`; the trigger stamped them, the
  timer wrote its first sample two minutes later, and it has run every 15 min
  since — re-verified 2026-08-26 late at the steady 15-minute rate. The
  `claude login` this file warned would be needed evidently held. **Ask the
  database for the count; this file must not carry one.**
  ⚠️ **The latent timer bug found on 2026-08-25 is still only fixed BY HAND on
  the VM** (`OnActiveSec=1min` added in `/etc/systemd/system/`, which
  `server/deploy.sh` does not touch). A rebuilt VM takes it from
  `server/setup.sh`. Without it, `systemctl enable --now` after a multi-day
  `disable` reports `enabled` + `active` and schedules **infinity**. Read `NEXT`
  from `list-timers`, never the `enabled` word. Write-up in
  `docs/mistakes/deploy-hosting.md`.
- ✅ **The `claude` permission is GRANTED and `claude_bookings` is EMPTY** —
  deployed, widely granted, unused. Head-counts belong to the database, not to
  this file; the query and the reason are in `docs/INVARIANTS.md`.
- ✅ **The ประกาศ deploy is DONE** (2026-08-26, `2993dd1`, verified served).
- ⏸ **The boot bar's first-failure branch — OFFERED, owner will decide.** See
  the Stay block above. Do not build it unprompted.
- ✅ **DEV SYSTEM — phases 0 and 1 are DONE and `samo-dev` IS USABLE.**
  Plan: `docs/TEAM-WORKFLOW.md`. Procedure + every trap:
  `skills/build-the-dev-database.md`.
  **`samo-dev` = `xibugtlsphcfuvstnxxh`**, ap-southeast-1, Postgres 17.6, on the
  separate account `samomdkkuaiorg` (D7). Credentials = the `SUPABASE_DEV_*`
  block in `.env.local`, **safe to share with the team** (that account holds
  only disposable projects) — but the URL is never published, because dev holds
  REAL student data (D1).
  ```
  CONFIRM=1 npm run dev:refresh   # rebuild from prod, ~2 min, refuses production
  npm run dev:check               # does dev answer identically to prod?
  npm run migrate:status [--dev]  # default is PRODUCTION, on purpose
  npm run migrate:new "<slug>"    # numbers from the higher of tree and origin/main
  ```
  **Verified 2026-08-27, both directions**: 66 tables (`public` + `passport` +
  `auth.users` + `auth.identities`), 0 row-count differences, 0 grant
  differences either way, and sign-in as a copied account proven end to end
  (GoTrue accepts the row · session issued · RLS gives that identity its OWN row
  and ZERO of anyone else's · a control read that must ALLOW does).
  ⚠️ **`backfilled` ≠ `applied`** in `schema_migrations`: backfilled means
  "predates tracking, apply time never observed". Do not merge the two words.
  ⏳ **Left in phase 2**: mail trap · `#samo-dev-bot` · dev GAS deployment under
  its own Google account · `dev-grants.json`.
  ✅ **Phase 3 (previews) is DECIDED — do NOT re-open it.** `docs/TEAM-WORKFLOW.md`
  §1 and D8 settled it: **one temporary site per pull request, on Cloudflare
  Pages** (`<pr>.samo-preview.pages.dev`), deployed by GitHub Actions. Off the
  VM on purpose — the VM is on a private address, so Actions cannot reach it and
  it would have to poll, which is the systemd shape that already produced a
  timer scheduling `infinity`.
  ⛔ **A 2026-08-27 session presented this as an OPEN QUESTION, recommended the
  opposite, then argued back to the decision.** It had read the owner's phrase
  "the dev server" as a preference and never checked §1. **Before calling
  anything an open question, grep `docs/TEAM-WORKFLOW.md` §0 and §1 — a settled
  decision restated as a question costs the owner a reply and buys nothing.**
  📌 **It is UNBLOCKED and buildable now**: phase 1 is done and
  `CLOUDFLARE_ACCOUNT_ID` / `CLOUDFLARE_API_TOKEN` are already in `.env.local`.
  ~2 h. The task list is phase 3 in §8, and two traps are already written down:
  `wrangler pages deploy dist` **will not upload `functions/`** (§7.4 — every
  Discord notification would silently no-op), and the `*.pages.dev` host-guard
  in BOTH entry HTMLs currently redirects any `pages.dev` to the VM, so it must
  be narrowed to the two named retired hosts or every preview URL bounces.
  ⚠️ **OWED, small, and nobody has built it: the repo SETTINGS have no guard.**
  The two branch-protection flags and the `tool-request` label live on GitHub,
  outside git — if anyone switches them off, no test goes red and the whole
  contributor design silently becomes advisory again. ~20 lines: read the
  protection object and assert `required_status_checks.contexts = ['build']`
  and `require_code_owner_reviews = true`. Offered, not built.
  📌 The three lessons this cost are NOT repeated here — they are in
  `docs/mistakes/tooling-proofs.md`: a `pg_dump` restore is MORE permissive than
  its source; a refresh that cannot refresh `auth` still printed "identical to
  production"; and `which` cannot see a keg-only binary.
- **ฝ่าย tools / Golden Period — THE WORKFLOW IS ON; THE TOOLS ARE NOT
  BUILT.** Read `docs/DEPT-TOOLS.md`; §0a holds owner decisions that must
  not be re-litigated. **ONE workflow for everybody — the ฝ่าย use the dev
  team's pull-request pipeline unchanged and `CODEOWNERS` carries the whole
  difference. This is NOT a second project: it is `docs/TEAM-WORKFLOW.md`
  with more users; delete the restatement when those phases land rather
  than maintaining it twice.**
  ✅ **LIVE on the repo since 2026-08-27, verified back from the GitHub
  API** — `main` now REQUIRES the `build` check (context confirmed against
  a real check run) and code-owner review. `enforce_admins` is still
  `false` ON PURPOSE: it is what lets the owner push `main`.
  ⚠️ **Consequence, do not 'fix' it:** nobody may approve their own PR, so
  an OWNER PR touching an owner-owned path cannot collect the approval it
  now demands — merge with the admin bypass, or push `main` as usual.
  Also shipped: `CODEOWNERS` contributor paths (`public/embed/**`
  deliberately unowned), the Thai tool-request template + its label,
  `skills/onboard-a-contributor.md`, CONTRIBUTING + PR-template updates.
  **NOT built**: `src/data/tools.js`, `public/embed/`, the frame,
  `src/js/data/` doors, `/tools/<slug>`, the starter kit.
  ✅ **Lane C's blocker is GONE** — phase 1 landed the same day, and
  `CONTRIBUTING.md` now points contributors at `samo-dev` instead of at
  production. What still gates lane C is only the work itself: the
  `src/js/data/` doors do not exist.
- **เกี่ยวกับเรา on mobile — WAITING ON THE OWNER'S PICK. Do not build yet.**
  Read `docs/demos/about-3d/README.md`, not a bullet.
- **The browser pass, continued — `skills/drive-the-browser.md`.** Still
  undriven: VS staff modal, ประกาศ drafts, อาจารย์ signature queue, SHOP
  CHECKOUT. `docs/NEXT.md` §1.
  ✅ **The auth blocker is solved — §4 of that skill now has the recipe.** The
  two traps that made this hard, both paid for on 2026-08-18: you CANNOT
  inject a session into `localStorage` (drive the sign-in form instead), and a
  grant written straight into `public.users` is ERASED on the next login by
  `sync_my_team_permissions` — a probe account needs a `team_members` row.
  With that, a throwaway account can render any role-gated control.
- **The org chart on a REAL iPad.** Verified on Playwright's WebKit only.
- **ทีม SAMO restructure — DO NOT reparent a ฝ่าย without reading `docs/INVARIANTS.md`.**
- `docs/NEXT.md` carries the rest. **§0d is DONE (0168, 2026-08-26)** and is
  kept there only as a PATTERN worth copying. What is genuinely un-started:
  §0c (two latent role-only policies, deliberately not swept — nothing in
  `src/js` takes those paths), §0a (ทีม SAMO admin model, PARKED by the owner),
  §0b2 and §1 (the browser pass), §0 (`photo_reference_count()` cannot see
  `houses.icon_url`).

### Question 2 in full — the reporter's polling interval

Faster than 15 min is possible but pays three ways: the endpoint rate-limits
hard, **every run rotates the OAuth refresh token** (more runs = more chances to
strand a credential only a human on the VM can restore), and a true on-demand
poll needs an authenticated endpoint on the VM — new attack surface on a service
that has none today. The refresh button re-reads the DATABASE only, and says so.
**Recommendation: leave it at 15 minutes.**
---

## NEXT SESSION — start here

1. **This file**, top to bottom. It is ~200 lines now; read all of it.
2. **`docs/INVARIANTS.md`** — the rules. Longer, and it changes slowly.
3. Only then, the archive file for whatever you are about to touch.

**Nothing is blocked on a credential.** THREE things are waiting on the owner and
none should be built unprompted. Ask them in plain language:

| # | Question | Where | Recommendation on file |
|---|---|---|---|
| 1 | Should the Claude usage reporter poll more often than every 15 min? | below | **leave it at 15** |
| 2 | Build the boot bar's first-failure branch? | ⏸ above | offered, not urgent |
| 3 | เกี่ยวกับเรา on mobile — which of the demos? | above | read `docs/demos/about-3d/README.md`, do not summarise it |

⛔ **Previews are NOT on this list — they were DECIDED long ago** (§1 + D8:
per-PR, Cloudflare Pages). A session re-opened them on 2026-08-27 and wasted a
round trip. **Check `docs/TEAM-WORKFLOW.md` §0/§1 before asking anything.**

Two more the assistant should offer rather than assume:

- **Build the SLOT for ฝ่าย tools?** — one tool list instead of the two
  hand-maintained copies, the frame a contributed page drops into, and the
  starter kit. **The slot is what blocks them, not the page.**
  📌 **Golden Period itself is THEIRS** — the ฝ่าย build it with Claude
  (`docs/DEPT-TOOLS.md` D8). The owner then allowed IT to **draft a simple
  placeholder** so students are not waiting. If you build that draft: keep it
  plain, say on the page that it is a placeholder, and hand the route over the
  moment their version lands — an IT-built page is the page IT owns, and that is
  the bottleneck this whole design removes.
- **The ~20-line guard for the repo settings?** The two branch-protection
  switches live on GitHub, outside git — turn them off and no test goes red,
  while every contributor rule built on 2026-08-27 silently becomes advisory.

**Nothing is owed to a person, and no deploy is owed** — as of 2026-08-27 every
commit since `36ac1d5` is docs, tooling or tests. Check, do not trust this line:

```bash
git diff --stat 36ac1d5..HEAD -- src/ ':!src/**/*.test.js' index.html admin/index.html
```
