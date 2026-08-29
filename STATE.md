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

## WHAT CHANGED MOST RECENTLY (2026-08-27 → 28)

In the order a newcomer needs them:

1. **There is a development database** — `samo-dev`, a full copy of production on
   a separate Supabase account. Nobody tests against live student data any more.
2. **Per-PR previews work.** Open a pull request, Cloudflare builds it at its own
   URL and posts the link. Previews talk to `samo-dev` and a dev Discord channel.
3. **Golden Period shipped** at `/tools/golden-period` — an IT *draft*; the ฝ่าย
   own the page and open PRs against it (`docs/DEPT-TOOLS.md` D8).
4. **Discord notify credentials rotated**, VitalSound routes per ฝ่าย to 12
   channels, and "do not ping" works on every action. **Two real messages reached
   a live ฝ่าย channel during that work** — read the notify rules in
   `docs/INVARIANTS.md` BEFORE touching notifications.
5. **EMAIL WAS AUDITED END TO END (2026-08-28).** Read `docs/EMAIL.md` before
   touching anything that sends mail. The three facts that matter:
   **the VM CAN send** through a relay on 587 (proven with a live SMTP session)
   but cannot BE or RECEIVE mail · **only production emails the people configured
   in admin** — `resolveRecipients()` forces every other environment to one test
   inbox, at the transport, because dev held a REAL `@kku.ac.th` staff address ·
   **there is NO password reset in the app**, and mail configuration is why.
6. **สถิติ now shows email + Apps Script quota use** (migrations 0170–0173).
   Measured: 95 emails in 72 days, busiest day 7 of 100; all Apps Script traffic
   peaks at 2 calls/minute of 30. **Nothing is near a limit** — so Apps Script
   stays exactly as it is. ⚠️ Both numbers are FLOORS and the panels say so.

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
- ✅ **DEPLOYED = `f9584e5` (2026-08-29)**, `DEPLOY_EXIT=0`. The สถิติ quota
  panels' phone-layout fix, verified from the SERVED **stylesheet** (a CSS-only
  change: grep `admin-*.css`, not a JS chunk), with an untouched rule beside it
  as the control. ⚠️ The host-dependency this exposed is a durable
  rule and lives in `docs/INVARIANTS.md`, not here.
  ⚠️ **Verify a `functions/` change ON THE VM, not in a bundle** — the notify
  service is Node on the box (`ssh samo-vm 'grep -c <marker>
  ~/samo-projects/samomdkkuweb/functions/_discord.js'`). ⚠️ **Production renders
  NO env ribbon** — confirmed by DRIVING it; a grep for `"preview"` hits an
  unrelated button, so the rendered DOM is the instrument.
  Previous: `e0bd2e2`, and `832bb14` before it.
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
- **Migrations through 0173.** For the test count run `npm test` — a number
  here has nothing to check it and rots (it read 1323 while the suite ran 1355). Both have exactly ONE home, here, and
  `state-handoff.test.js` enforces that. **ALL 25 LIVE PROOFS GREEN — re-run
  2026-08-27**, after 0169 was applied to production. Run `npm test` /
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

⛔ **START HERE. THREE actions, ALL for the OWNER.** Nothing else in this file
is blocked on anyone, and there is no queue of buildable work left in it.

1. **Reset the Discord bot token** — *"Role assignment bot for SAMO69"*
   (app `1492541609445949465`). It has **Administrator**, it was pasted into a
   chat transcript on 2026-08-28 to provision webhooks in bulk, and nothing
   built here still needs it. ⚠️ If a service uses that bot for role
   assignment, resetting BREAKS it until that service gets the new token.
2. **Confirm the dev-channel test landed** (owner — it needs eyes on Discord).
   All 12 ฝ่าย notifications were sent from a preview naming REAL ฝ่าย; they
   must ALL be in `#developer-server-notify` and none in a real `#vs-*`.
   Delivery is confirmed (16×204); the DESTINATION needs human eyes.
   **If any reached a real ฝ่าย channel, preview isolation is broken.**

3. **The dev Apps Script deployment, under its OWN Google account** — with a
   `DEV` folder in Drive (parent id in `docs/state/phuriphatma.md`). This is the
   LAST item of dev-system phase 2 and the only one nobody else can do: the
   point is that its credential reaches nothing real, so it needs an account
   only you can create. ⚠️ The clasp token on this Mac EXPIRED 2026-08-27.
   ~~a mail trap on the VM~~ — **withdrawn, and no longer needed**; `docs/EMAIL.md` §7.


- ✅ **Nothing owed on Claude measurement, the `claude` grant, or ประกาศ.**
  Ask the DATABASE for any runtime state or count; this file must not carry
  them. The durable rules from these are in `docs/INVARIANTS.md`.
- ⏸ **The boot bar's first-failure branch — OFFERED, owner decides.** Do not
  build unprompted.
- ✅ **DEV SYSTEM — phases 0 and 1 are DONE and `samo-dev` IS USABLE.**
  Plan: `docs/TEAM-WORKFLOW.md`. Procedure + every trap:
  `skills/build-the-dev-database.md`.
  **`samo-dev` = `xibugtlsphcfuvstnxxh`** (separate account `samomdkkuaiorg`,
  D7). Creds = `SUPABASE_DEV_*` in `.env.local`, **shareable with the team**;
  the URL is never published — dev holds REAL student data (D1). Commands and
  every trap (incl. `backfilled` ≠ `applied`): `skills/build-the-dev-database.md`.
  ⏳ **Phase 2 has ONE item left and it is owner-gated**: the dev Apps Script
  deployment under its own Google account. ✅ `dev-grants.json` +
  `npm run dev:grants` shipped (guest access that expires, refuses any project
  but `samo-dev` by ref, re-applied as `dev:refresh` step 8).
  ✅ **The mail trap is RETRACTED and its NEED is met** — it needed Supabase to
  connect IN and the VM has no inbound port but 443; dev mail is now forced to
  one test inbox at the transport instead. **That is NOT "the VM cannot do
  mail": it CAN send** via a relay on 587. Full assessment: `docs/EMAIL.md`.
  ⚠️ **Four `samo-dev` hazards fixed 2026-08-28 — all four in `docs/EMAIL.md` §6**
  (it emailed a REAL staff address; three auth settings diverged). Both are now
  guarded: `dev:refresh` step 7 and `npm run dev:check`.
  **Google sign-in is still OFF on dev** (owner: an OAuth client). The plan's
  `#samo-dev-bot` EXISTS — it is `#developer-server-notify`.
  ⏳ **PHASE 6 IS PART DONE (2026-08-29)** — **`npm run proofs:dev`**, and
  **all 23 database proofs pass against dev**. ⛔ **NOT in CI, on purpose** —
  that would put a token that can run any SQL where 5 people can read it
  (`docs/TEAM-WORKFLOW.md` §7.9). `docs/state/phuriphatma.md`.
  ✅ **PHASE 3 IS COMPLETE — previews and notify both work**, proven end to end
  2026-08-27/28. A PR builds at `<hash>.samomdkkuweb.pages.dev` and Cloudflare
  posts the link; the ribbon ships; the `/notify` dev stub prints to the
  terminal; all exposed webhooks were rotated. How it was proven is archived —
  **the RULES that outlive it are in `docs/INVARIANTS.md` and you must read them
  before touching notifications or previews.** The three live warnings:
  🆕 **VitalSound routes PER ฝ่าย** — 12 webhooks, 12 `#vs-*` channels. **Map
  KEYS must be the exact `data.department` strings**; a mismatch falls back to
  `SE` and misroutes one ฝ่าย's confidential reports to another.
  🔧 **`npm run notify:smoke` is the ONLY way to test notifications**;
  `webhook:id` says where one points via GET. **Never verify by sending.**
  📌 `refactorsamomdkkuweb` preview builds are OFF (dead branch building twice);
  project kept so its URL still serves the splash. Undo = that field back to `all`.
  📖 **The rules — and why each was paid for — are in `docs/INVARIANTS.md`.**
  ⚠️ **`GAS_WEBHOOK_URL` on preview is STILL REAL** — a preview upload lands in
  the REAL Drive, and preview EMAIL goes through the real deployment too (now
  marked `[PREVIEW]` in the subject). Closed properly by the dev GAS deployment.
  ✅ **The repo SETTINGS have a guard** — `tools/repo-protection.mjs`, proof
  #24. `enforce_admins` must stay OFF: it is what lets the owner push `main`.
  📌 Three lessons this cost are in `docs/mistakes/tooling-proofs.md`.
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
