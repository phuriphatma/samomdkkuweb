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

Four things, in the order a newcomer needs them:

1. **There is a development database now** — `samo-dev`, a full copy of
   production on a separate Supabase account. Nobody tests against live student
   data any more.
2. **Per-PR previews work.** Open a pull request, Cloudflare builds it at its own
   URL and posts the link. Previews talk to `samo-dev` and to a dev Discord
   channel, never to production or a real ฝ่าย channel.
3. **Golden Period shipped** at `/tools/golden-period` — an IT *draft*; the ฝ่าย
   own the page and open PRs against it (`docs/DEPT-TOOLS.md` D8).
4. **The Discord notify credentials were rotated**, VitalSound now routes per
   ฝ่าย to 12 channels instead of one, and the "do not ping" flag works on every
   action. **Two real messages reached a live ฝ่าย channel during this work** —
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
- ✅ **DEPLOYED = `c7d0cac` (2026-08-28)**, `DEPLOY_EXIT=0`. The email quota
  panel + the send guard, verified from the SERVED bundle (all three send paths
  call `resolveRecipients`). ⚠️ The host-dependency this exposed is a durable
  rule and lives in `docs/INVARIANTS.md`, not here.
  ⚠️ **Verify a `functions/` change ON THE VM, not in a bundle** — the notify
  service is Node on the box, not part of any JS chunk. `ssh samo-vm 'grep -c
  <marker> ~/samo-projects/samomdkkuweb/functions/_discord.js'`.
  ⚠️ **Production renders NO env ribbon** — confirmed by DRIVING the page, not
  grepping. A grep for `"preview"` DOES hit, from an unrelated announcements
  button; the rendered DOM is the instrument.
  Previous: `832bb14`, and `7405712` before it.
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
- ✅ **All three of the above were re-verified against the DATABASE on
  2026-08-27**: measurement `true` since 2026-08-25 17:18, **96 samples in the
  last 24 h with the newest 7 minutes old** — exactly the rate a 15-minute timer
  gives, so the reporter is healthy — 0 bookings, 154 `claude` holders.
  ⚠️ **Re-verify rather than quoting this**; it is a runtime fact with a
  timestamp, and `tools/db-query.mjs` takes a FILE, not an inline string.

---

### What is owed

⛔ **START HERE. Two actions for the OWNER, one queue of work for YOU.**
Nothing else in this file is blocked on anyone.

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

**Then the work queue — three things ASKED FOR and never done**: a `DEV` folder
in Drive, the dev Apps Script deployment, and a mail trap on the VM (the answer
is Mailpit, not a real mail server). All three, with the Drive folder id and the
reasoning, are at the TOP of **`docs/state/phuriphatma.md`**.


- ✅ **Nothing owed on Claude measurement, the `claude` grant, or ประกาศ.**
  Ask the DATABASE for any runtime state or count; this file must not carry
  them. The durable rules from these are in `docs/INVARIANTS.md`.
- ⏸ **The boot bar's first-failure branch — OFFERED, owner will decide.** See
  the Stay block above. Do not build it unprompted.
- ✅ **DEV SYSTEM — phases 0 and 1 are DONE and `samo-dev` IS USABLE.**
  Plan: `docs/TEAM-WORKFLOW.md`. Procedure + every trap:
  `skills/build-the-dev-database.md`.
  **`samo-dev` = `xibugtlsphcfuvstnxxh`** (separate account `samomdkkuaiorg`,
  D7). Creds = `SUPABASE_DEV_*` in `.env.local`, **shareable with the team**;
  the URL is never published — dev holds REAL student data (D1). Verified both
  directions: 66 tables, 0 row-count and 0 grant differences, sign-in proven.
  ⚠️ **`backfilled` ≠ `applied`** in `schema_migrations`. Commands + every trap:
  `skills/build-the-dev-database.md` and `README.md`.
  ⏳ **Left in phase 2**: dev GAS deployment under its own Google account ·
  `dev-grants.json`. **The mail trap is RETRACTED, not pending** — it needed
  Supabase to connect IN and the VM has no inbound port but 443. **That is NOT
  "the VM cannot do mail": it CAN send** through a relay on 587 (proven with a
  live STARTTLS session). Full assessment: `docs/EMAIL.md`.
  ⚠️ **Four `samo-dev` hazards fixed 2026-08-28 — detail in `docs/EMAIL.md` §6.**
  It emailed a REAL `@kku.ac.th` staff address (same GAS deployment as prod);
  now the owner's test inbox, re-applied by `dev:refresh` step 7 so a rebuild
  cannot undo it, and non-prod subjects carry an `[ENV]` prefix. Auth also
  diverged: `mailer_autoconfirm` `false` where `auth.js` DEPENDS on `true`,
  `site_url` `:3000`, and an EMPTY `uri_allow_list` — so no preview could
  finish a redirect. **Google sign-in is still OFF on dev** (owner: an OAuth
  client). (The plan's `#samo-dev-bot` EXISTS — it is
  `#developer-server-notify`, and previews post there.)
  ✅ **PHASE 3 — PREVIEWS WORK, proven end to end 2026-08-27** (throwaway PR
  #17, closed). **They were ALREADY configured** on the `samomdkkuweb` project —
  **no Actions job, no `wrangler`**, so §7.4's `functions/` trap never applied.
  A PR builds at `<hash>.samomdkkuweb.pages.dev`; Cloudflare posts the link.
  ⚠️ **Preview traps (host guard must match EXACT hosts; preview env points at
  `samo-dev`; env vars freeze at BUILD time) — `docs/INVARIANTS.md`.**
  📌 `refactorsamomdkkuweb` preview builds are OFF (dead branch building twice);
  project kept so its URL still serves the splash. Undo = that field back to `all`.
  ✅ **PREVIEW ribbon ships** — polarity is deliberately the REVERSE of
  `TEAM-WORKFLOW` §1 (absent var = no ribbon); why, in `docs/INVARIANTS.md`.
  `robots.txt` now exists; `noindex` needed no work.
  ✅ **Phase 3 is COMPLETE** — the `/notify` dev stub prints to the terminal.
  ✅ **NOTIFY — RESOLVED 2026-08-28 and TESTED end to end** (prod: every action;
  preview: every action + all 12 ฝ่าย → the dev channel). All three exposed
  webhooks rotated, so the ~600 frozen deployment copies are inert. Credentials
  live in `/etc/samo-notify.env` and, dev-channel only, the `samomdkkuweb`
  PREVIEW env.
  🆕 **VitalSound routes PER ฝ่าย** — 12 webhooks, 12 distinct `#vs-*` channels
  (it was ONE for all 12). **Map KEYS must be the exact `data.department`
  strings**; a mismatch falls back to `SE` and misroutes one ฝ่าย's confidential
  reports to another.
  ✅ Silence is applied ONCE in `resolveTarget`; 4 of 7 actions used to DROP it.
  🔧 **`npm run notify:smoke` is the ONLY way to test notifications.**
  `webhook:id` says where one points via GET. **Never verify by sending.**
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

---

## NEXT SESSION — start here

1. **This file**, top to bottom. It is ~200 lines now; read all of it.
2. **`docs/INVARIANTS.md`** — the rules. Longer, and it changes slowly.
3. Only then, the archive file for whatever you are about to touch.

**Nothing is blocked on a credential.** THREE things are waiting on the owner and
none should be built unprompted. Ask them in plain language:

| # | Question | Where | Recommendation on file |
|---|---|---|---|
| 1 | Should the Claude usage reporter poll more often than every 15 min? | `docs/NEXT.md` | **leave it at 15** |
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

**Nothing is owed to a person, and no deploy is owed.** Check, do not trust
this line — and note it names no sha, on purpose:

```bash
npm run deploy:owed
```
