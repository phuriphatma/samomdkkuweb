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
  `state-handoff.test.js` enforces that. **ALL 23 LIVE PROOFS GREEN**
  (re-run 2026-08-26). Run `npm test` / `npm run proofs`; never quote a
  remembered number.

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
- ✅ **NOT OWED — the two named people were never locked out.** `sastaff` /
  `saprof` were deleted 2026-08-18 as intended. **Worapong
  (`woratho@kku.ac.th`, seat `staff`) and Prakasit (`prakasa@kku.ac.th`, seat
  `prof`) sign in with their own kkumail and hold the desk through their
  ทีม SAMO permission.** Corrected by the owner 2026-08-26, after two sessions
  repeated the claim. **Reason about the LIVE channel (the seat), not the
  credential that was removed.**
- ✅ **The `claude` permission is GRANTED — no longer owed.** Measured
  2026-08-26: **~154** accounts carry the `claude` key in `permissions` /
  `managed_permissions`, plus **42** `master` holders who answer yes to every
  key. ⚠️ **These were 146 and 41 eight days earlier, and the `claude` count
  moved 153 → 154 within a single day — the owner edits the tree, so treat
  every head-count here as a METHOD, not a fact.** The method:
  `select count(*) from public.users where 'claude' = any(permissions) or
  'claude' = any(managed_permissions);`
  What is still true is that **`claude_bookings` is EMPTY** — the feature is
  deployed, granted and unused. ⚠️ **This bullet used to add "that is also why
  `claude0157` B4 is red". It is NOT red** — 0157 was made self-contained on
  2026-08-25 (it MOVES the quota week and plants two synthetic bookings rather
  than hoping the live calendar cooperates), and all 23 proofs are green.
  A proof that depends on real usage existing is the thing that was FIXED; do
  not re-derive the old excuse from this file.
- ✅ **The ประกาศ deploy is DONE** (2026-08-26, `2993dd1`, verified served).
- ⏸ **The boot bar's first-failure branch — OFFERED, owner will decide.** See
  the Stay block above. Do not build it unprompted.
- **DEV SYSTEM — phase 0 DONE, migration coordination DONE, phase 1 blocked
  on ONE thing.** `docs/TEAM-WORKFLOW.md` is the plan.
  ✅ **Built 2026-08-27**: `public.schema_migrations` (0169, applied +
  backfilled — 1 `applied`, 168 `backfilled`, 0 pending), `npm run
  migrate:status`, `npm run migrate:new` (numbers from the HIGHER of the
  working tree and `origin/main`), `tools/migrations-lib.mjs` (one home for
  what all three tools need), `migration-numbers.test.js` (falsified by
  planting a duplicate), `.gitattributes` `merge=union` on
  `docs/mistakes/*.md` ONLY.
  `apply-migration.mjs` now records every apply and **never fails the run if
  the bookkeeping fails** — the DDL already landed by then.
  ⚠️ **`backfilled` ≠ `applied`.** A backfilled row means "predates tracking,
  believed present, apply time never observed". Do not merge the two words.
  RLS is deny-all BY DESIGN and was proved in both directions: anon → 401
  `42501`, control table → 200 with a row.
  ✅ **2026-08-27 later — §7.1 is CLOSED.** The password is in `.env.local` and
  verified against the live project; the schema is dumped (64 tables, 165
  functions, 156 policies, **592 GRANTs**). Recipe + four measured traps:
  **`skills/build-the-dev-database.md`**.
  ⛔ **The first dump used `--no-privileges` and had ZERO grants** — RLS with no
  GRANT denies everyone and reads exactly like the policies working (0138).
  **Count the GRANTs after every dump.**
  ✅ **`samo-dev` EXISTS — `xibugtlsphcfuvstnxxh`**, ap-southeast-1, Postgres
  17.6, on the separate account `samomdkkuaiorg` (D7). Schema loaded and
  **verified against production object by object**: tables 64=64, functions
  165=165, triggers 64=64, RLS-on 62=62, `public`+`passport` policies 121+35
  identical. Credentials are the `SUPABASE_DEV_*` block in `.env.local`.
  Tools take `--dev`; **the default is PRODUCTION on purpose** and each prints
  which it chose.
  ⛔ **THE RESTORE WAS MORE PERMISSIVE THAN THE SOURCE — 134 grants dev had and
  prod does not, 0 missing.** `anon` had been granted on 16 tables including
  `students` and `people`, because Supabase's `ALTER DEFAULT PRIVILEGES` grant
  on every newly created table and `pg_dump` emits no REVOKEs. Revoked from the
  MEASURED difference; now 0 extra / 0 missing. **`npm run dev:check` is the
  ratchet** (falsified by re-granting `anon` on `students`: reported DRIFT,
  exit 1). Write-up in `docs/mistakes/tooling-proofs.md`.
  ✅ **DATA IS LOADED AND PROVEN. Phase 1 + the auth half of phase 2 are DONE.**
  66 tables compared (`public` + `passport` + `auth.users` + `auth.identities`):
  **0 row-count differences, 0 grant differences either way.**
  **`CONFIRM=1 npm run dev:refresh` rebuilds it in one command** — three guards
  protect production, all three falsified rather than assumed.
  **Sign-in proven END TO END on the rebuilt copy**, five steps, both
  directions: GoTrue accepts the directly-written `auth.users` row · password
  sign-in returns a session · RLS returns that identity's OWN row (`role=dev`) ·
  returns ZERO rows for anyone else · and a control read that must ALLOW does.
  ⛔ **The first `dev:refresh` run printed "identical to production" and had
  refreshed NOTHING in `auth`** — step 2 drops `public`/`passport` only, so the
  `COPY auth.users` aborted on duplicate ids, and the verification compared 64
  tables instead of 66 so it could not see it. **The check's blind spot was in
  the same place as the bug.** Both fixed; write-up in
  `docs/mistakes/tooling-proofs.md`.
  📌 `auth` schema skew (§7.5's worry) **does not exist**: 44 shared columns,
  0 on either side alone. `schema_migrations` is EXCLUDED from the data copy —
  it describes the database it lives in.
  ⏳ **Left for phase 2**: the mail trap, `#samo-dev-bot`, the dev GAS
  deployment, `dev-grants.json`. **Phase 3** (previews) is untouched, and the
  owner has not chosen per-PR previews vs one always-on dev site.
  📌 The 4 `storage` policies were NOT copied and that is correct: the app has
  **0** Supabase-Storage call sites (files go to Drive via GAS).
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
  **Lane C stays SHUT until `TEAM-WORKFLOW` phase 1 (the dev database)** —
  `CONTRIBUTING.md` still sends contributors at production.
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

### Open question for the owner, asked and unanswered

The usage reporter polls every 15 min on a systemd timer. Faster is possible,
but the endpoint rate-limits hard (a 429 is already handled as a skipped tick)
and every run rotates the OAuth refresh token — more runs is more chances to
strand a credential only a human on the VM can restore. The **refresh button**
added this session re-reads the DATABASE only, and says so; a true on-demand
poll would need an authenticated endpoint on the VM that spawns the reporter,
which is new attack surface on a service that is currently unauthenticated.
**Recommendation given: leave it at 15 minutes.**
---

## NEXT SESSION — start here

1. **This file**, top to bottom. It is ~200 lines now; read all of it.
2. **`docs/INVARIANTS.md`** — the rules. Longer, and it changes slowly.
3. Only then, the archive file for whatever you are about to touch.

**What the owner is owed a question about** is under "What is owed" above, and
the one blocker is named there: **the database password**, which is the only
thing standing between here and `docs/TEAM-WORKFLOW.md` phase 1.
