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

## WHAT CHANGED MOST RECENTLY (2026-08-29)

0. ✅ **PASSPORT — the "144 students cannot sign in" alarm was FALSE.** 179
   profiles have no auth row, which is the EXPECTED state: the trigger
   `on_auth_user_created_passport_link` re-keys a carried profile by email on
   first signup, so the student keeps their km. It was called a bug here for
   one commit because the wrong function was read — **check `pg_trigger` on
   `auth.users`, not a function body.** Residual: that re-key swallows its own
   errors (`raise warning`), so a failure would be silent. Detail:
   `docs/state/phuriphatma.md`.

0b. **PASSPORT TOTALS — CLOSED, do NOT re-investigate.** `total_km` could only
   go UP (only a BEFORE INSERT trigger since 0056); **0174** adds the
   delete/update halves. The leaderboard sums SCANS while the tier badge reads
   `total_km`, so all 11 drifting totals were recalculated from scans (drift 0,
   no leaderboard position moved). One scan lost in July was restored.
   ⚠️ **The old Supabase project was DELETED by the owner; its salvaged scan
   dump is at `~/samo-passport-old-db-backup-2026-08-29/` and must never be
   committed — both repos are PUBLIC and it holds real student emails.**

## WHAT CHANGED BEFORE THAT (2026-08-27 → 28)

1. **`samo-dev` exists** (`skills/build-the-dev-database.md`); **per-PR previews
   work**, pointing at it and a dev Discord channel. **Golden Period ships** at
   `/tools/golden-period` — an IT DRAFT the ฝ่าย own (`docs/DEPT-TOOLS.md` D8).
2. **Discord notify rotated; VitalSound routes per ฝ่าย to 12 channels.** Two
   real messages reached a live ฝ่าย channel then — **read the notify rules in
   `docs/INVARIANTS.md` BEFORE touching notifications.**
3. **EMAIL AUDITED — read `docs/EMAIL.md` before touching mail.** The VM CAN
   send via a relay on 587; it cannot BE or RECEIVE mail. **No password reset
   exists; mail config is why.** สถิติ shows email + GAS quota (0170–0173);
   nothing is near a limit and both numbers are FLOORS.

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
- **Migrations through 0174.** For the test count run `npm test` — a number
  here has nothing to check it and rots (it read 1323 while the suite ran 1355). Both have exactly ONE home, here, and
  `state-handoff.test.js` enforces that. **ALL 26 LIVE PROOFS GREEN — re-run
  2026-08-29** (this count is guarded against `run-proofs.mjs`, unlike the test
  count, which is not — that is why one is stated here and the other is not), after 0169 was applied to production. Run `npm test` /
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

1. **The passport silent-failure guard.** `passport_link_user_by_email` re-keys
   a carried profile on first signup but wraps the whole thing in
   `exception when others then raise warning` — a failure is SILENT and the
   student gets an empty passport. Guard = count profiles whose email matches
   an `auth.users` row with a DIFFERENT id (0 after that user signs in).
   Full context: `docs/state/phuriphatma.md`.
2. **The ฝ่าย tools slot** — `src/data/tools.js` registry, `public/embed/` +
   the frame, the starter kit. **This is what blocks the departments**, not the
   pages. `docs/DEPT-TOOLS.md` §13 has the build order.
3. **Phase 5, optional** — a VitePress docs site over `docs/`.

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
- ✅ **DEV SYSTEM — phases 1, 3, 4 and 6 are DONE.** Plan + per-phase status:
  `docs/TEAM-WORKFLOW.md` §8. Procedure and every trap:
  `skills/build-the-dev-database.md`. **`samo-dev` = `xibugtlsphcfuvstnxxh`**
  (separate account, D7); creds are the `SUPABASE_DEV_*` block in `.env.local`,
  shareable with the team, URL never published — dev holds REAL student data.
  Rebuild `CONFIRM=1 npm run dev:refresh`; check `npm run dev:check`;
  proofs `npm run proofs:dev`. **Google sign-in is OFF on dev** (owner: §B1).
  What remains is in "What is owed" above — nothing else is blocked.
- **ฝ่าย tools — THE WORKFLOW IS ON; the frame and registry are NOT built.**
  Read `docs/DEPT-TOOLS.md`; §0a holds owner decisions that must not be
  re-litigated. **ONE workflow for everybody** — the ฝ่าย use the dev team's
  pull-request pipeline unchanged and `CODEOWNERS` carries the whole difference.
  ✅ Live: branch protection ENFORCING · `CODEOWNERS` contributor paths · the
  Thai tool-request template · `skills/onboard-a-contributor.md`.
  ✅ **Golden Period ships** at `/tools/golden-period` under ฝ่ายยุทธศาสตร์ —
  the IT DRAFT (D8). **The ฝ่าย own the page and PR against
  `src/html/tab-golden-period.html`**, whose header tells them so in Thai.
  ❌ NOT built: `src/data/tools.js` registry · `public/embed/` + the frame ·
  `src/js/data/` doors · the starter kit.
- **เกี่ยวกับเรา on mobile — WAITING ON THE OWNER'S PICK. Do not build yet.**
  Read `docs/demos/about-3d/README.md`, not a bullet.
- **The browser pass, continued — `skills/drive-the-browser.md`.** Still
  undriven: VS staff modal, ประกาศ drafts, อาจารย์ signature queue, SHOP
  CHECKOUT. `docs/NEXT.md` §1. ✅ The auth blocker is solved (§4 of that skill
  has the recipe and both traps). ⚠️ Its wording "a grant in `public.users` is
  ERASED at next login" means the **`managed_*`** columns only —
  `sync_my_team_permissions` does not touch `permissions`, which is why
  `dev-grants.mjs` writes that one.
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

**ONE thing is blocked on a credential**: the dev Apps Script deployment needs a
Google account only the owner can create. FOUR things wait on the owner and none
should be built unprompted. Ask in plain language:

| # | Question | Where | Recommendation on file |
|---|---|---|---|
| 1 | **Turn on password reset?** It does not exist today and mail config is why — the biggest user-visible win available | `docs/EMAIL.md` §2/§5 | start with a Gmail app password; needs nothing from KKU |
| 2 | Should the Claude usage reporter poll more often than every 15 min? | `docs/NEXT.md` | **leave it at 15** |
| 3 | Build the boot bar's first-failure branch? | ⏸ above | offered, not urgent |
| 4 | เกี่ยวกับเรา on mobile — which of the demos? | above | read `docs/demos/about-3d/README.md`, do not summarise it |

⛔ **Previews are NOT on this list — they were DECIDED long ago** (§1 + D8:
per-PR, Cloudflare Pages). A session re-opened them on 2026-08-27 and wasted a
round trip. **Check `docs/TEAM-WORKFLOW.md` §0/§1 before asking anything.**

Two more the assistant should offer rather than assume:

- **Build the SLOT for ฝ่าย tools?** — one tool list instead of the two
  hand-maintained copies, the frame a contributed page drops into, and the
  starter kit. **The slot is what blocks them, not the page.**
  📌 **Golden Period itself is THEIRS** — the ฝ่าย build it, IT only drafted a
  placeholder; hand the route over when their version lands (`docs/DEPT-TOOLS.md`
  D8). An IT-built page is the page IT owns, which is the bottleneck this design
  removes.
- **The ~20-line guard for the repo settings?** The two branch-protection
  switches live on GitHub, outside git — turn them off and no test goes red,
  while every contributor rule built on 2026-08-27 silently becomes advisory.

**No deploy is owed.** Check, do not trust this line — and note that it names
no sha, on purpose. Retyping one into a `git diff` is the bug that opened
2026-08-28, and `state-handoff.test.js` now forbids the shape:

```bash
npm run deploy:owed
```
