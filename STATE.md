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

00. ✅ **PASSPORT — a carried student would have lost every km on signing in.
    FIXED by 0175 before anyone hit it.** 0174 (yesterday) taught
    `passport.scans` an UPDATE trigger that reads a change of `user_id` as a
    transfer: debit the old owner, credit the new. The signup re-key
    (`passport_link_user_by_email`) moves the SCANS first and the PROFILE last,
    so the debit emptied the student's real profile and the credit landed on an
    id nothing lived at yet. **Zero students affected** — 144 carried profiles
    hold km and none of them had signed in inside the window. The re-key now
    restates the invariant (`total_km` = sum of its own scans) instead of trying
    to out-order a trigger. Found by the new guard, not by a report:
    `tools/passport-link-on-signup.sql` (proof #27), which also covers the
    silent-failure item that was owed. Write-up: `docs/mistakes/postgres-schema.md`.

01. ✅ **CONTRIBUTING.md said "there is no preview deploy" — it was wrong.**
    Per-PR previews shipped as phase 3 five weeks of reading ago; the one
    sentence a new ฝ่าย contributor uses to decide how to test their change
    denied they existed. Read back from the Cloudflare API before rewriting:
    `preview_deployment_setting: all`, `pr_comments_enabled: true`, and the
    preview `VITE_SUPABASE_URL` is **samo-dev**, not production. Corrected, plus
    the bit no one had written down — a preview is SAFE to submit forms on.
    Guard: `src/js/preview-docs.test.js`. **`docs/TEAM-WORKFLOW.md` §9 is the
    list of files a landed phase must correct; treat it as a checklist, not
    prose** — every other entry on it had been done.

## WHAT CHANGED BEFORE THAT — 2026-08-27 → 29

Pruned to `docs/state-archive/2026-08-29-passport-email-dev-system.md` on
2026-08-30. What is still operative, and nothing else:

- **PASSPORT TOTALS — CLOSED, do NOT re-investigate.** 0174 + 0175 close both
  halves; every total now equals the scans behind it. ⚠️ The salvaged old-project
  scan dump at `~/samo-passport-old-db-backup-2026-08-29/` **must never be
  committed** — both repos are PUBLIC and it holds real student emails.
- **179 passport profiles with no `auth.users` row is the EXPECTED state**, not
  a bug. It was called one for a day. The re-key happens on first signup.
- **READ `docs/EMAIL.md` BEFORE TOUCHING MAIL.** The VM can SEND through a relay
  on 587; it cannot BE or RECEIVE mail. **No password reset exists; mail config
  is why.** สถิติ's email + GAS numbers are FLOORS.
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
- ✅ **DEPLOYED = `8fd21f4` (2026-08-29)**, `DEPLOY_EXIT=0`. The Google-provider
  guard, verified in the SERVED shared chunk by an ASCII marker AND the Thai
  string, plus `npm run smoke:browser` 9/9 against production.
  ⚠️ **How to verify a deploy — shared chunk, ASCII marker, `functions/` on the
  VM, no ribbon on prod — is in `docs/INVARIANTS.md`, not here.** Each has been
  mistaken for a failed deploy at least once.
  Previous: `ce23857`, and `f9584e5` before it.
- ✅ **`main` being AHEAD of the deployed sha is the NORMAL state.** Most commits
  are docs, `docs/mistakes/` and tests, none of which reaches a bundle. Ask
  about `src/` and the two entry HTMLs alone — and do NOT retype the sha:

  ```bash
  npm run deploy:owed
  ```

  It reads the ✅ DEPLOYED line above, which is the sha's only home, and
  compares that commit with the WORKING TREE. Exit 0 = prod is current.
  ⛔ **Never paste a `git diff <sha>..HEAD` snippet back into this file.** That
  is what rotted: the sha had four homes here and one of them was corrected.

- ⚠️ **Verify a deploy from the SERVED artifact, and grep the RIGHT one** — the
  shared-chunk trap and the marker rules are durable, so they live once, in
  `docs/INVARIANTS.md` (`analytics-*.js`) and `docs/mistakes/deploy-hosting.md`
  (a string behind `import.meta.env` is DELETED, not renamed). Read them BEFORE
  concluding a deploy failed; each has been mistaken for one.
- ✅ **The สถิติ panels HAVE now been driven** (2026-08-29) and the two layout
  faults it found are fixed and deployed. `docs/state/phuriphatma.md`.
- **Migrations through 0175.** For the test count run `npm test` — a number
  here has nothing to check it and rots (it read 1323 while the suite ran 1355). Both have exactly ONE home, here, and
  `state-handoff.test.js` enforces that. **ALL 27 LIVE PROOFS GREEN — re-run
  2026-08-30** (this count is guarded against `run-proofs.mjs`, unlike the test
  count, which is not — that is why one is stated here and the other is not), after 0175 was applied to production. Run `npm test` /
  `npm run proofs`; never quote a remembered number.

---

### WHAT PROD IS DOING RIGHT NOW

- **Claude usage measurement is ON** since 2026-08-25 17:18 UTC, sampling every
  15 min. ⚠️ This block once said OFF, with a procedure to re-enable something
  already enabled — **ask the DATABASE, never this file, for runtime state**:
  `select monitoring_enabled, monitoring_changed_at from public.claude_settings`.
- `monitoring_note` still holds the old pause reason. Not shown while
  measurement is on (checked in `paintMeasured`), and used correctly by the
  monitor-on Discord notice as "why it had been paused". Leave it.
- **`claude_bookings` is still EMPTY** — deployed, widely granted, and unused.
  (Head-counts rot here; the numbers and the query live under "What is owed".)
- ⚠️ **Re-verify all three against the DATABASE; do not quote a number from
  here.** Last checked 2026-08-27 and healthy (sample rate matched the
  15-minute timer). `tools/db-query.mjs` takes a FILE, not an inline string.

---

### What is owed

⛔ **START HERE.**

### A. NEXT SESSION — buildable now, nobody is blocking you

1. ~~The passport silent-failure guard.~~ ✅ **BUILT** —
   `tools/passport-link-on-signup.sql`, registered as proof #27. It found a live
   regression on its first run (see 00 above), so do not treat it as decoration.
2. **The ฝ่าย tools slot** — `src/data/tools.js` registry, `public/embed/` +
   the frame, the starter kit. **This is what blocks the departments**, not the
   pages. `docs/DEPT-TOOLS.md` §13 has the build order.
3. ~~Phase 5 — a docs site over `docs/`.~~ ✅ **SHIPPED 2026-08-30** —
   **https://phuriphatma.github.io/samomdkkuweb/**, VitePress, deployed by
   `.github/workflows/docs.yml` on any push to `docs/`. `npm run docs:dev` to
   work on it. ⚠️ `npm run docs:build` is now inside the REQUIRED `build`
   check: markdown that would break the site cannot merge.

### B. OWNER ONLY — these need accounts/credentials nobody else has

1. **A second Google OAuth client for `samo-dev`**, so previews can use Google
   sign-in (today they are username/password only). **~2 min; exact steps in
   `docs/TEAM-WORKFLOW.md` §3a.** ⛔ Do NOT reuse production's client — the dev
   keys are shared with the whole team.
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

- ✅ **Nothing owed on Claude measurement, the `claude` grant, or ประกาศ.**
  Ask the DATABASE for any runtime state or count; this file must not carry
  them. The durable rules from these are in `docs/INVARIANTS.md`.
- ⏸ **The boot bar's first-failure branch — OFFERED, owner decides.** Do not
  build unprompted.
- ✅ **DEV SYSTEM — phases 1, 3, 4, 5 and 6 are DONE.** Only phase 2's last
  item remains and it is OWNER-GATED (§B2). Plan + per-phase status:
  `docs/TEAM-WORKFLOW.md` §8.
- **The docs site is `docs/` rendered — it is NOT the status.** `STATE.md` stays
  at the repo root on purpose; a copy on the site would be a second home for the
  fastest-decaying file here. Nothing secret may go into `docs/`: it was always
  a public repo, and now it is also a browsable, indexable site. Plan + per-phase status:
  `docs/TEAM-WORKFLOW.md` §8. Procedure and every trap:
  `skills/build-the-dev-database.md`. **`samo-dev` = `xibugtlsphcfuvstnxxh`**
  (separate account, D7); creds are the `SUPABASE_DEV_*` block in `.env.local`,
  shareable with the team, URL never published — dev holds REAL student data.
  Rebuild `CONFIRM=1 npm run dev:refresh`; check `npm run dev:check`;
  proofs `npm run proofs:dev`. **Google sign-in is OFF on dev** (owner: §B1).
  What remains is in "What is owed" above — nothing else is blocked.
- **ฝ่าย tools — THE WORKFLOW IS ON; the frame and registry are NOT built.**
  Read `docs/DEPT-TOOLS.md` (§0a holds owner decisions that must not be
  re-litigated) — do not work from this bullet. ✅ Live: branch protection,
  `CODEOWNERS`, the Thai request template, `skills/onboard-a-contributor.md`,
  and **Golden Period at `/tools/golden-period`, which is THEIRS to PR against**.
  ❌ NOT built: the four pieces in A2 above.
- **เกี่ยวกับเรา on mobile — WAITING ON THE OWNER'S PICK. Do not build yet.**
  Read `docs/demos/about-3d/README.md`, not a bullet.
- **The browser pass, continued — `skills/drive-the-browser.md`.** Still
  undriven: VS staff modal, ประกาศ drafts, อาจารย์ signature queue, SHOP
  CHECKOUT. `docs/NEXT.md` §1. The auth blocker is solved; §4 of that skill has
  the recipe and both traps.
- **ทีม SAMO restructure — DO NOT reparent a ฝ่าย without reading `docs/INVARIANTS.md`.**
- `docs/NEXT.md` carries the rest. **§0d is DONE (0168, 2026-08-26)** and is
  kept there only as a PATTERN worth copying. What is genuinely un-started:
  §0c (two latent role-only policies, deliberately not swept — nothing in
  `src/js` takes those paths), §0a (ทีม SAMO admin model, PARKED by the owner),
  §0b2 and §1 (the browser pass), §0 (`photo_reference_count()` cannot see
  `houses.icon_url`).

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
| 6 | **Move the project to a GitHub ORGANISATION?** — the fix for "I have to add every contributor myself". ✅ **A complete runbook is written and ready to execute in one sitting**: `skills/move-the-repo-to-an-organisation.md` (~90 min, phases 0–5, rollback, and a §10 done-when list). The repo is on a personal account, so every gate ends at one human — `CODEOWNERS` names `@phuriphatma` on `auth.js`, `db.js`, `supabase/`, `server/`, `tools/`, and that keeps blocking merges on a review that stops coming | `skills/move-the-repo-to-an-organisation.md` | **yes, a FREE org — and NOT a shared `samo` login.** The repo is public, so branch protection, Actions and Pages stay free. ⚠️ The Copilot worry inverts: a shared role account is not a student and qualifies for NOTHING, while an org changes nobody's personal Copilot. §0 of that skill is a 10-minute experiment; run it before believing either of us |
| 7 | **What URL should the docs site have?** It is on `phuriphatma.github.io/samomdkkuweb/` — a PERSONAL account's name, which reads as unofficial to a ฝ่าย member and dies if the account is ever renamed | `docs/TEAM-WORKFLOW.md` §8 phase 5 | **ask KKU for one CNAME, `docs.samo.md.kku.ac.th` → `phuriphatma.github.io`.** Keeps the automatic deploy; costs one request. ⛔ Do NOT serve it from the VM at `samo.md.kku.ac.th/docs/` — CI cannot reach the VM (deploys need VPN), so that trades a 40-second automatic publish for a manual one |

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
