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

## WHAT CHANGED MOST RECENTLY (2026-08-30)

000. ✅ **Scoped grants were invisible in four readers — fixed, deployed**
    (`docs/mistakes/authz-grants.md`). The two RULES it left behind moved to
    `docs/INVARIANTS.md` — what `passport` grants, and one LATENT reader that
    would deny 42 of 45 holders. Read them there before gating anything on it.

00. ✅ **PASSPORT — 0174's trigger would have zeroed a carried student's km on
    signup; FIXED by 0175, zero students affected.** `postgres-schema.md`.

01. ✅ **Previews exist, point at `samo-dev`, safe to submit forms on** (guard:
    `preview-docs.test.js`). **`docs/TEAM-WORKFLOW.md` §9 lists the files a
    landed phase must correct — treat it as a checklist.**

02. ✅ **DOCS SITE — REBUILT AND DEPLOYED 2026-08-31.**
    **`https://samo.md.kku.ac.th/docs` is the address to give people.** English,
    task-shaped: `docs/start/` (prerequisites → install → first-change →
    dependent-work → troubleshooting) then `docs/contributing.md`; maintainer
    and agent notes collapsed at the bottom. The old CONTRIBUTE and
    STEP-BY-STEP pages were MERGED AWAY (nginx 301s both) — do not recreate.
    Verified live. GitHub Pages mirrors it. Thai stays only where this
    organisation uses a Thai name (ฝ่าย, UI labels).
    ⛔ **`deploy.sh` does NOT install nginx config** — always a separate
    `sudo cp … && nginx -t && systemctl reload` (header of
    `server/nginx-samo.conf`). Done for this change; remember it next time.
    **Why it is shaped this way: `docs/state-archive/2026-08-31-docs-site-restructure.md`.**

03. ✅ **THE REPO'S IDENTITY HAS ONE HOME** — `package.json` `repository.url`
    (`tools/repo-identity.mjs`). Change that one field and `npm test` prints
    every stale reference. **`docs/SUCCESSION.md` + `npm run succession:audit`**
    map who can recover each system; the org move runbook is
    `skills/move-the-repo-to-an-organisation.md`.

## WHAT CHANGED BEFORE THAT — 2026-08-27 → 29

Pruned to `docs/state-archive/2026-08-30-status-prune.md`. Still operative:

- **PASSPORT TOTALS — CLOSED, do NOT re-investigate.** 0174 + 0175 close both
  halves. ⚠️ The salvaged old-project scan dump at
  `~/samo-passport-old-db-backup-2026-08-29/` **must never be committed** — both
  repos are PUBLIC and it holds real student emails.
- **179 passport profiles with no `auth.users` row is EXPECTED**, not a bug.
- **READ `docs/EMAIL.md` BEFORE TOUCHING MAIL.** The VM can SEND via a relay on
  587; it cannot BE or RECEIVE mail. **No password reset exists; mail config is
  why.**
- **Discord notify is rotated; VitalSound routes per ฝ่าย to 12 channels** —
  read the notify rules in `docs/INVARIANTS.md` BEFORE touching notifications.

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
- ✅ **DEPLOYED = `f27ebdd` (2026-08-31)** — app bundles AND `/docs` both
  current, verified from the SERVED site rather than an exit code (one run
  exited 0 having published nothing): the served `/docs/start/install` names
  the ORG slug ten times and the personal one zero times.
  ✅ **THE HANG DID NOT REPRODUCE.** Two full runs, both exit 0, both ~7 min,
  docs step INCLUDED — one with output redirected on the VM, one streamed
  exactly as `skills/deploy-vm.md` documents. **A full deploy takes ~7 minutes**
  and every earlier report is consistent with a ceiling below that (the skill
  records `timeout 300` killing a live docs build). ⚠️ NOT proven — two clean
  runs are not a root cause. Give it `timeout 900`, run it in the BACKGROUND,
  and do not re-open the sudo or PTY theories: both are now falsified.
  Checked live: `/`, `/admin/`, `/passport/`, `/pr`, `/updates`, `/notify` and
  `/docs` all 200 · `/docs/NOPE` 404 (the deny half).
  ⚠️ Grepping the wrong bundle proves nothing — the SHARED-CHUNK trap lives in
  `docs/INVARIANTS.md`. Previous: `17bfd01`, `9ba0e9c`.
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

- ⚠️ **Verify from the SERVED artifact, and grep the RIGHT one.** Both traps
  live once — `docs/INVARIANTS.md` (shared chunk) and
  `docs/mistakes/deploy-hosting.md` (a string behind `import.meta.env` is
  DELETED, not renamed). Each has been mistaken for a failed deploy.
- ✅ **The สถิติ panels HAVE now been driven** (2026-08-29) and the two layout
  faults it found are fixed and deployed. `docs/state/phuriphatma.md`.
- **Migrations through 0175. ALL 27 LIVE PROOFS GREEN**, re-run 2026-08-30
  after 0175 reached production. ⚠️ The proof count is guarded against
  `run-proofs.mjs`; the TEST count is not, which is why it is deliberately not
  written here — run `npm test` / `npm run proofs`, never quote a remembered
  number.

---

### WHAT PROD IS DOING RIGHT NOW

- **Claude usage measurement is ON** since 2026-08-25 17:18 UTC, sampling every
  15 min. ⚠️ This block once said OFF, with a procedure to re-enable something
  already enabled — **ask the DATABASE, never this file, for runtime state**:
  `select monitoring_enabled, monitoring_changed_at from public.claude_settings`.
- `monitoring_note` still holds the old pause reason — not shown while
  measurement is on, and used correctly by the monitor-on notice. Leave it.
- **`claude_bookings` is still EMPTY** — deployed, granted, unused.
- ⚠️ **Ask the DATABASE, never this file, for runtime state.** Last checked
  2026-08-27, healthy. `tools/db-query.mjs` takes a FILE, not an inline string.

---

### What is owed

⛔ **START HERE.**

### A. NEXT SESSION — buildable now, nobody is blocking you

✅ Shipped, do not rebuild: the passport guard (proof #27) · the docs site and
its restructure (02 above). ⛔ **No polling timer for the docs** — one was
built, verified and REMOVED the same day; reasoning in the archive named in 02.

0. ✅ **THE ORG MOVE IS DONE — `samomdkku/samomdkkuweb` since 2026-08-31.**
   Protection and Pages survived; `@samomdkku/maintainers` owns all sixteen
   `CODEOWNERS` paths instead of a person; identity repointed; Cloudflare
   reconnected; the VM's remote repointed and proven by a deploy.
   **`node tools/repo-protection.mjs` — all 13 pass.** ⛔ Org 2FA is OFF by
   OWNER DECISION. ⚠️ **A transfer WIPES ruleset bypass actors** — it refused
   the next push while the proof read all-green (§5d).
   ❌ **Last box, §10: someone who is NOT the owner must add a person to a team
   once.** Until that happens the bottleneck has not moved.
   ⛔ **NOTHING on `*.pages.dev` may reach the production database** — both
   Cloudflare envs are pinned to `samo-dev` after a production-branch deployment
   served live student data under a PREVIEW ribbon (`deploy-hosting.md`).

1. **The ฝ่าย tools slot** — `src/data/tools.js` registry, `public/embed/` +
   the frame, the starter kit. **This is what blocks the departments**, not the
   pages. `docs/DEPT-TOOLS.md` §13 has the build order.
2. ✅ **THE DEPLOY HANG IS NOT REPRODUCING** — two full runs on 2026-08-31,
   both ~7 min, both exit 0. Treat `deploy.sh` as working; give it a 900 s
   ceiling. ⛔ The prescribed diagnostic was BLIND: `deploy.sh` re-execs itself
   after pulling, so `bash -x` instruments only the first two seconds
   (`skills/deploy-vm.md`). If it recurs, `set -x` INSIDE the script.
### B. OWNER ONLY — these need accounts/credentials nobody else has

1. **A second Google OAuth client for `samo-dev`** (previews are
   username/password only). **Only the CONSOLE step is yours** — Google exposes
   no API for it. Paste the id/secret into `.env.local`, then
   **`npm run dev:google`** does the rest (`-- --check` prints the exact
   redirect URI). ⛔ Never reuse production's client — dev keys are shared.
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
- **The docs site is `docs/` RENDERED — it is NOT the status.** `STATE.md` stays
  at the repo root on purpose. Nothing secret goes in `docs/`.
- **ฝ่าย tools — THE WORKFLOW IS ON; the frame and registry are NOT built.**
  Read `docs/DEPT-TOOLS.md` (§0a holds owner decisions that must not be
  re-litigated) — do not work from this bullet. ✅ Live: branch protection,
  `CODEOWNERS`, the Thai request template, `skills/onboard-a-contributor.md`,
  and **Golden Period at `/tools/golden-period`, which is THEIRS to PR against**.
  ❌ NOT built: the pieces in A1 above.
- **เกี่ยวกับเรา on mobile — WAITING ON THE OWNER'S PICK. Do not build yet.**
  Read `docs/demos/about-3d/README.md`, not a bullet.
- **The browser pass, continued — `skills/drive-the-browser.md`.** Still
  undriven: VS staff modal, ประกาศ drafts, อาจารย์ signature queue, SHOP
  CHECKOUT. `docs/NEXT.md` §1. The auth blocker is solved; §4 of that skill has
  the recipe and both traps.
- **ทีม SAMO restructure — DO NOT reparent a ฝ่าย without reading `docs/INVARIANTS.md`.**
- `docs/NEXT.md` carries the rest. Genuinely un-started: §0c (two latent
  role-only policies, deliberately not swept), §0a (ทีม SAMO admin model, PARKED
  by the owner), §0b2 + §1 (the browser pass), §0 (`photo_reference_count()`
  cannot see `houses.icon_url`).

---

## NEXT SESSION — start here

1. **This file**, top to bottom. Read all of it.
2. **`docs/INVARIANTS.md`** — the rules. Longer, and it changes slowly.
3. **`docs/state/phuriphatma.md`** — its top block names the three claims a new
   session is most likely to get wrong, and what is decided so you do not redo it.
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
| 5 | **SUCCESSION.** The two role gmails (studbeta, samomdkku.ai) handed down each year are the RIGHT shape — ⛔ decided, do not re-litigate. But **studbeta alone holds prod Supabase + the Google sign-in OAuth client + Cloudflare**, its Cloudflare member is Super Administrator with **2FA OFF**, and the VM ssh key is on one Mac | `docs/SUCCESSION.md`, `npm run succession:audit` | **step 0 is the recovery settings on both gmails** — "it does not graduate" is a property of those, not of the address. Then cross-add each account to the other's systems. The GitHub move is step 7 of 8 |
| 6 | ~~Move to a GitHub organisation?~~ ✅ **DONE 2026-08-31 except Cloudflare.** Both repos are in the org, `CODEOWNERS` names a team, Copilot is unaffected (org holds 0 seats — never buy any). ⛔ Do not re-litigate | `skills/move-the-repo-to-an-organisation.md` §0a | **One thing left needs the dashboard: reconnect Cloudflare Pages (§5a), or previews stay dead** |
| 7 | ~~What URL should the docs site have?~~ ✅ **ANSWERED AND BUILT 2026-08-31 — nothing owed.** `https://samo.md.kku.ac.th/docs` serves the real pages from the VM. (HOW they get rebuilt is status, not a decision — see the CURRENT DEPLOY block above; `deploy.sh` hangs at that step today.) ⛔ **Do not re-open this and do not ask KKU for a subdomain** — the owner confirmed KKU gives one VM and one hostname, so `docs.samo.md.kku.ac.th` was never available and the CNAME plan that stood here was dead on arrival | `server/nginx-samo.conf`, `server/deploy.sh` | Serving docs at a PATH is mainstream, not a compromise: nextjs.org/docs, tailwindcss.com/docs, supabase.com/docs and kubernetes.io/docs all answer 200 at the path (measured). ⛔ **And do not re-add a polling timer.** One was built and removed the same day: its whole justification was "otherwise publishing needs someone on VPN", and the owner's answer was that deploy-time updates are fine. Pull-based deploy is a real pattern (ArgoCD, Flux) but it is for keeping an app current, not a docs page — **the lesson is that the requirement was assumed, not asked** |

⛔ **Previews are NOT on this list — they were DECIDED long ago** (§1 + D8:
per-PR, Cloudflare Pages). A session re-opened them on 2026-08-27 and wasted a
round trip. **Check `docs/TEAM-WORKFLOW.md` §0/§1 before asking anything.**

One thing to OFFER rather than assume: **build the SLOT for ฝ่าย tools?** (A2).
📌 Golden Period itself is THEIRS — IT only drafted it; hand the route over when
their version lands. An IT-built page is a page IT owns, which is the bottleneck
that design removes.

**No deploy is owed.** Check, do not trust this line — and note that it names
no sha, on purpose. Retyping one into a `git diff` is the bug that opened
2026-08-28, and `state-handoff.test.js` now forbids the shape:

```bash
npm run deploy:owed
```
