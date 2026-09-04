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

## WHAT CHANGED MOST RECENTLY (2026-09-01)

00. ✅ **Settled, written up, do not re-derive:** the `master` หนังสือ guard
    (0176) · passport km on signup (0175), both in `docs/mistakes/` (0176's rule
    is class 5 in `.claude/rules/mistakes.md`) · previews exist, point at
    `samo-dev`, safe to submit forms on · repo identity has ONE home
    (`package.json` `repository.url`, guarded by `npm test`; recovery map is
    `docs/SUCCESSION.md` + `npm run succession:audit`).

Everything older was drained on 2026-09-01 — reasoning in
`docs/state-archive/2026-08-30-status-prune.md`, durable items in
`docs/INVARIANTS.md`.

**Rules for editing this file, each paid for:** give a decaying fact ONE home ·
grep the WHOLE file before correcting anything · never touch the deploy block
unless you deployed · **do not append a session narrative** — write
`docs/state/<your-handle>.md` instead, and never rewrite someone else's.
`state-handoff.test.js` pins what is mechanically checkable (dead pointers,
disagreeing counts, this file's length); it cannot judge whether a sentence is
TRUE. That is what the grep is for.

---

## CURRENT DEPLOY

- Prod = KKU VM `samo.md.kku.ac.th`. Deploy = commit → push `main` →
  `skills/deploy-vm.md`. **Needs VPN. Pushing does NOT deploy.**
- ✅ **DEPLOYED = `5ada77a` (2026-09-04)** — three runs, all complete, roots
  agreeing, docs published with no hand step; new `INVARIANTS.md` content
  confirmed in the SERVED `/var/www/docs` against an older control, six
  endpoints 200. Previous: `4af99d9`, `b31454d`.
  ⚠️ **All three ran 4×–13× baseline (123/389/347 s) and NONE was the docs
  fault** — `npm ci` is the whole anomaly, `docs:build` was 10–11 s every time.
  Exactly ONE of the two `npm ci` calls stalls ~5 min per run and **which one
  alternates**, so it is not either repo's lockfile. Cause unknown; disk,
  memory, registry, CPU all measured healthy. **Duration alone is not the known
  hang** — table in `skills/deploy-vm.md`.
  ⚠️ **Ask which surface a commit SHIPS to before grepping for it** — `b31454d`
  had none in the browser, only `/notify`; its changelog note sits in `PENDING`,
  which nothing imports and Rollup shakes out (`docs/mistakes/deploy-hosting.md`).
  ⛔ **THE DOCS STEP IS INTERMITTENT — AND IT EXITS 0.** The run tally lives in
  `skills/deploy-vm.md`, its ONE home — do not restate it here. `deploy.sh`
  writes every run to `~/samo-deploy-logs` on the VM plus an xtrace naming the
  line reached. Read the log before theorising.
  ⛔ **A HEALTHY RUN IS ~30 SECONDS.** A run taking MINUTES is already the fault
  — the two "clean ~7-minute runs" the hang was once declared dead on were 14×
  baseline, not controls.
  ⚠️ **After every deploy, check the ARTEFACT** — root write times must agree
  (`stat -c "%y %n" /var/www/samo-web /var/www/docs`), then curl-grep a SERVED
  page for a string added today, with an old one as control (`skills/deploy-vm.md`).
  ⛔ Falsified, do not re-open: sudo expiry · the `timeout` ceiling · the PTY.
  Two clean runs were NOT a root cause — `docs/mistakes/deploy-hosting.md`, and
  the whole recipe is `skills/deploy-vm.md`.
- ✅ **`main` being AHEAD of the deployed sha is the NORMAL state** — tests and
  session notes reach nothing. ⚠️ **`docs/` DOES ship now** (the VM serves
  `/docs`), so "it is only docs" stopped being a reason to skip a deploy on
  2026-08-31. Do not judge this by eye and do not retype the sha:

  ```bash
  npm run deploy:owed
  ```

  It reads the ✅ DEPLOYED line above, which is the sha's only home, and
  compares that commit with the WORKING TREE. Exit 0 = prod is current.
  ⛔ **Never paste a `git diff <sha>..HEAD` snippet back in** — the sha had four
  homes here and only one got corrected.

- ⚠️ **Verify from the SERVED artifact**, and grep the RIGHT one — both traps
  live once, in `docs/INVARIANTS.md` and `docs/mistakes/deploy-hosting.md`.
- **Migrations through 0179. ALL 30 LIVE PROOFS GREEN**, whole suite re-run
  against production at end of session 2026-09-02. 0179 was applied to samo-dev
  AND production that day, 10/10 both directions on each. ⚠️ Re-run rather than
  believing this line — the proof count is guarded against `run-proofs.mjs`, but
  nothing guards whether they still PASS. The TEST count is deliberately not
  written here.

---

### WHAT PROD IS DOING RIGHT NOW

- **Claude usage measurement is ON** since 2026-08-25 17:18 UTC, sampling every
  15 min. ⚠️ This block once said OFF, with a procedure to re-enable something
  already enabled — **ask the DATABASE, never this file, for runtime state**:
  `select monitoring_enabled, monitoring_changed_at from public.claude_settings`.
- `monitoring_note` still holds the old pause reason — not shown while
  measurement is on, used correctly by the monitor-on notice. Leave it.
  `claude_bookings` is deployed and granted but still EMPTY.
- ⚠️ **Ask the DATABASE for runtime state, never this file.** `db-query.mjs` takes a FILE.

---

### What is owed

⛔ **START HERE.**

### A. NEXT SESSION — buildable now, nobody is blocking you

✅ Shipped, do not rebuild: the passport guard (proof #27) · the docs site and
its restructure (02 above). ⛔ **No polling timer for the docs** — one was
built, verified and REMOVED the same day; reasoning in the archive named in 02.

0. ✅ **ORG MOVE DONE** (2026-08-31); `node tools/repo-protection.mjs` — 27 pass.
   Traps: `skills/move-the-repo-to-an-organisation.md`. Org 2FA OFF by OWNER
   DECISION. ❌ **Last box, §10: someone who is NOT the owner must add a person
   to a team once.** ⛔ **NOTHING on `*.pages.dev` may reach the production
   database** — the guard once asserted this of ONE project of THREE
   (`deploy-hosting.md`). ⛔ **Open, OWNER + destructive: the two retired Pages
   projects still serve the old bundle at `<hash>.<project>.pages.dev`;
   deleting them is the only complete fix.**

1. ✅ **A ฝ่าย NOW EDITS ITS OWN PAGE — no commit, no deploy (0177/0178/0179).**
   เมนู "หน้าฝ่าย" in /admin/. **Four kinds since 0179: หัวข้อ · การ์ด · ข้อความ ·
   HTML**, a new row is a DRAFT, and covers UPLOAD from your machine (the file
   they replace is retired).
   ✅ **AND the ฝ่าย tools lane** — `public/embed/starter/` → a `tool/*` PR →
   `/tools/<slug>`. Both are LIVE; do not rebuild either.
   ⛔ **THE ISOLATION OF BOTH IS ONE MISSING WORD** (`allow-same-origin`), and
   the three changes that delete it are now a rule in `docs/INVARIANTS.md` —
   with the owner-facing fake-sign-in risk. Read it before touching the frame.
   🧪 **A VISUAL EDITOR SPIKE IS LIVE AND AWAITS THE OWNER'S VERDICT** —
   "แก้แบบเห็นภาพ" on an html row (GrapesJS 0.23.6, admin-only, lazy, its own
   1.15 MB chunk, zero refs from the public entry). ⛔ **Build NOTHING more on
   it until the owner answers**; if the feel is wrong, delete
   `dept-visual-editor.js` + the dep and nothing else knows it existed.
   ⚠️ An earlier note the SAME DAY said a canvas was REJECTED — superseded, and
   `docs/state/phuriphatma.md` says so at both ends. Why GrapesJS and not
   Puck/Craft.js (React-only), plus the block-set work next: same file.
   ❌ **What is left is NOT code: §13 step 8, teach two people**, and step 5 on
   a REAL phone. Detail: `docs/state/phuriphatma.md` + `docs/DEPT-TOOLS.md`.
2. ⚠️ **THE DEPLOY DOCS STEP — INTERMITTENT, and this entry used to say the
   opposite.** It read "NOT REPRODUCING, treat deploy.sh as working" while the
   block above it counted four failures; an intermittent fault is never
   disproven by successes. ✅ The diagnostic it asked for is now PERMANENT:
   `set -x` inside the script, writing `~/samo-deploy-logs/<stamp>.trace` on the
   VM. **Read the log before forming any theory — every theory so far was
   formed without one.** Status, tally and how to read a log live in ONE place,
   the CURRENT DEPLOY block above; do not restate them here.
3. ⏳ **PASSPORT ON THE DEV SERVER — steps 1, 3 and 4 remain; step 2 is done.** samo-dev
   now EXPOSES the `passport` schema (it always held the data), so dev answers
   exactly as production. Owner did Part A; **Part B — reconnect the
   `samomdkkupassport` Pages project in the DASHBOARD — is not done.**
   ✅ Step 2 is DONE — its variables now name samo-dev, not the frozen old DB.
   **The remaining steps are in `docs/state/phuriphatma.md`.**
### B. OWNER ONLY — these need accounts/credentials nobody else has

1. ✅ **DONE 2026-08-31 — Google sign-in works on previews.** A dev-only OAuth
   client is in `.env.local` as `GOOGLE_DEV_*` and enabled on samo-dev;
   `external.google` reads true. Re-check or re-apply with
   **`npm run dev:google`** (`-- --check` reports without writing). ⛔ Never
   reuse production's client — dev keys are shared with the team.
2. **The dev Apps Script deployment under its own Google account** — the last
   item of dev-system phase 2, plus a `DEV` folder in Drive (parent id in
   `docs/state/phuriphatma.md`).
3. **The GitHub project board** — phase 0's last piece; `gh` here lacks the
   `project` scope.
4. **Reset the Discord bot token** *"Role assignment bot for SAMO69"* (app
   `1492541609445949465`) — it has Administrator and was pasted into a chat
   transcript on 2026-08-28. Nothing built here needs it.
5. **Confirm the dev-channel test landed** — all 12 ฝ่าย notifications must be
   in `#developer-server-notify` and none in a real `#vs-*`. Delivery is
   confirmed (16×204); the DESTINATION needs human eyes.

- ✅ **Nothing owed on Claude measurement, the `claude` grant, or ประกาศ.** Ask
  the DATABASE for runtime state; this file must not carry it.
- ⏸ **The boot bar's first-failure branch — OFFERED, owner decides.**
- ✅ **DEV SYSTEM — phases 1, 3, 4, 5 and 6 are DONE.** Only phase 2's last
  item remains and it is OWNER-GATED (§B2). Plan + per-phase status:
  `docs/TEAM-WORKFLOW.md` §8; procedure and every trap
  `skills/build-the-dev-database.md`. **`samo-dev`'s ref is in
  `SUPABASE_DEV_URL`** (separate account, D7); creds are the `SUPABASE_DEV_*`
  block in `.env.local`, shareable with the team, **URL never published — dev
  holds REAL student data**. Rebuild `CONFIRM=1 npm run dev:refresh`; check
  `npm run dev:check`; proofs `npm run proofs:dev`. **Google sign-in is OFF on
  dev** (owner: §B1).
- **The docs site is `docs/` RENDERED.** Nothing secret goes in `docs/`.
- **ฝ่าย tools — WORKFLOW, REGISTRY AND FRAME ARE ALL LIVE.** Read
  `docs/DEPT-TOOLS.md` (§0a = owner decisions, do not re-litigate). Also live:
  branch protection, `CODEOWNERS`, the Thai request template,
  `skills/onboard-a-contributor.md`, and **Golden Period at
  `/tools/golden-period`, THEIRS to PR against**.
  ⛔ Lane C (a tool that reads real data) is still HARD-BLOCKED on §13 step 15.
- **เกี่ยวกับเรา on mobile — WAITING ON THE OWNER'S PICK.** Read
  `docs/demos/about-3d/README.md`, not a bullet.
- **The browser pass, continued — `skills/drive-the-browser.md`.** Still
  undriven: VS staff modal, ประกาศ drafts, อาจารย์ signature queue, SHOP
  CHECKOUT. `docs/NEXT.md` §1. The auth blocker is solved; §4 of that skill has
  the recipe and both traps.
- **ทีม SAMO restructure — read `docs/INVARIANTS.md` before reparenting a ฝ่าย.**
- `docs/NEXT.md` carries the rest. Genuinely un-started: §0c (two latent
  role-only policies, deliberately not swept), §0a (ทีม SAMO admin model, PARKED
  by the owner), §0b2 + §1 (the browser pass). ⚠️ Its §0
  (`photo_reference_count()` cannot see `houses.icon_url`) is **already FIXED**
  — read from `pg_get_functiondef`, 2026-09-01. 0178 added the ฝ่าย covers too.

---

## NEXT SESSION — start here

1. **This file**, top to bottom. Read all of it.
2. **`docs/INVARIANTS.md`** — the rules. Longer, and it changes slowly.
3. **`docs/state/phuriphatma.md` — its FIRST `## ▶ HANDOFF` block**, whichever
   date that is. It names what is owed, what is waiting on the owner, and what
   was deliberately NOT verified. Everything below it is history, including
   older handoff blocks.
   ⚠️ **Do not name a date here.** This step named "HANDOFF 2026-09-01" and a
   newer block was inserted above it the same day, so the first thing a new
   session was told to read was the superseded one.
4. Only then, the archive file for whatever you are about to touch.

**What waits on the owner is section B above — do not restate it here.** These
are DECISIONS rather than credentials, and none should be built unprompted. Ask
in plain language:

| # | Question | Where | Recommendation on file |
|---|---|---|---|
| 1 | **Turn on password reset?** It does not exist today and mail config is why — the biggest user-visible win available | `docs/EMAIL.md` §2/§5 | start with a Gmail app password; needs nothing from KKU |
| 2 | Should the Claude usage reporter poll more often than every 15 min? | `docs/NEXT.md` | **leave it at 15** |
| 3 | Build the boot bar's first-failure branch? | ⏸ above | offered, not urgent |
| 4 | เกี่ยวกับเรา on mobile — which of the demos? | above | read `docs/demos/about-3d/README.md`, do not summarise it |
| 4b | **Merge `samomdkkupassport` into this repo?** ✅ **ANSWERED: yes — but as its own session, it is a one-way door.** They already deploy ATOMICALLY (`deploy.sh` builds both), so the split pays every polyrepo cost for the one benefit — independent cadence — this project does not use. Production is already one link. ⛔ Do NOT reconnect the passport Pages project, and ⛔ do NOT have Cloudflare `git clone` passport at `main`: that makes a preview that is not reproducible from a commit | `docs/state/phuriphatma.md` | `git subtree`, npm workspaces, then retire the second repo's protection + Pages project |
| 5 | **SUCCESSION.** The two role gmails (studbeta, samomdkku.ai) handed down each year are the RIGHT shape — ⛔ decided, do not re-litigate. But **studbeta alone holds prod Supabase + the Google sign-in OAuth client + Cloudflare**, its Cloudflare member is Super Administrator with **2FA OFF**, and the VM ssh key is on one Mac | `docs/SUCCESSION.md`, `npm run succession:audit` | **step 0 is the recovery settings on both gmails** — "it does not graduate" is a property of those, not of the address. Then cross-add each account to the other's systems. The GitHub move is step 7 of 8 |
| 6 | ~~Move to a GitHub organisation?~~ ✅ **DONE 2026-08-31 except Cloudflare.** Both repos are in the org, `CODEOWNERS` names a team, Copilot is unaffected (org holds 0 seats — never buy any). ⛔ Do not re-litigate | `skills/move-the-repo-to-an-organisation.md` §0a | **One thing left needs the dashboard: reconnect Cloudflare Pages (§5a), or previews stay dead** |
| 7 | ~~What URL should the docs site have?~~ ✅ **ANSWERED AND BUILT 2026-08-31 — nothing owed.** `https://samo.md.kku.ac.th/docs` serves the real pages from the VM. (HOW they get rebuilt is status, not a decision — the CURRENT DEPLOY block above is its one home; do not restate it here.) ⛔ **Do not re-open this and do not ask KKU for a subdomain** — the owner confirmed KKU gives one VM and one hostname, so `docs.samo.md.kku.ac.th` was never available and the CNAME plan that stood here was dead on arrival | `server/nginx-samo.conf`, `server/deploy.sh` | Serving docs at a PATH is mainstream, not a compromise: nextjs.org/docs, tailwindcss.com/docs, supabase.com/docs and kubernetes.io/docs all answer 200 at the path (measured). ⛔ **And do not re-add a polling timer.** One was built and removed the same day: its whole justification was "otherwise publishing needs someone on VPN", and the owner's answer was that deploy-time updates are fine. Pull-based deploy is a real pattern (ArgoCD, Flux) but it is for keeping an app current, not a docs page — **the lesson is that the requirement was assumed, not asked** |

⛔ **Previews are NOT on this list — they were DECIDED long ago** (§1 + D8:
per-PR, Cloudflare Pages). A session re-opened them on 2026-08-27 and wasted a
round trip. **Check `docs/TEAM-WORKFLOW.md` §0/§1 before asking anything.**

⛔ **Do not offer to "build the ฝ่าย tools frame" — it is BUILT** (2026-09-01),
and so is the หน้าฝ่าย editor beside it. What is left there is §13 step 8:
teaching two people. See A1.
📌 Golden Period itself is THEIRS — IT only drafted it; hand the route over when
their version lands. An IT-built page is a page IT owns, which is the bottleneck
that design removes.

**No deploy is owed.** Check, do not trust this line — and note that it names
no sha, on purpose. Retyping one into a `git diff` is the bug that opened
2026-08-28, and `state-handoff.test.js` now forbids the shape:

```bash
npm run deploy:owed
```
