# phuriphatma — session notes

One file per person, as designed in `docs/TEAM-WORKFLOW.md` §6.5. **Write your
own; never rewrite someone else's.**

What belongs here: what I am part-way through, what I tried that did not work,
what I want to pick up next. What does NOT belong here:

- a rule that will still be true next year → `docs/INVARIANTS.md`
- what is true right now for everyone → `STATE.md`
- why something was done the way it was → `docs/state-archive/`
- a bug that was fixed → `docs/mistakes/<area>.md`, then `npm run mistakes:index`

The dead-pointer sweep in `state-handoff.test.js` runs over this file too, so a
path named here must resolve.

---

## ▶ Golden Period — BUILT, SHIPPED, LIVE

✅ **Built as `3b92df5`, deployed in `7405712`, and two deploys behind us now.**
No deploy is owed for it. This block said "DEPLOY IS OWED" for a day after it
had gone out — never trust a deploy claim in a hand-written file; run
`npm run deploy:owed`, which reads the one sha in `STATE.md` and answers from
the working tree.

If you ever do need to verify it in a served bundle, the marker is the string
`gp-tab` or `ช่วงเวลาที่เหมาะกับการจัดกิจกรรม`, NOT a function name (the
minifier renames those).

What shipped: `/tools/golden-period` under **ฝ่ายยุทธศาสตร์และพัฒนาองค์กร**
(`strategy` — NOT `admin`; that was a wrong guess from a screenshot, corrected
by the owner). วิธีอ่านค่า as four bands, the สโมฯ calendar embedded, a button
to the GPC Dashboard sheet, and a release note in `PENDING`.

**Verified in headless Chrome at 390 px and 1280 px** (`skills/drive-the-browser.md`):
pane activates from the route, calendar mode is AGENDA on the phone and MONTH on
desktop, the band dot is actually painted, no horizontal overflow, no console
errors, and the calendar returns real data.

📌 **It is the file the ฝ่าย open a PR against, not a placeholder to replace.**
Its header says so in Thai and names what is safe to change. `id="gpCalendar"`
and the `.gp-tab` class are the two things that must not move.

⚠️ **`dept-tool-mirror.test.js` is new** — every ฝ่าย tool must be findable in
the launcher, because `DEPT_DEFS` and `tab-tools.html` are still two
hand-maintained copies. The real fix remains the single registry
(`docs/DEPT-TOOLS.md` §2).

## ▶ SESSION 2026-08-28 — WHAT I DID, AND WHAT WOULD MISLEAD YOU

Read `STATE.md` first; this is the part that does not fit there. **Six commits,
all deployed or docs-only, working tree clean, 1394 tests green.**

### The three things most likely to be misunderstood

1. **"The VM cannot do email" is FALSE and I wrote it that way first.** It can
   SEND, through a relay on 587, proven with a live SMTP session. It cannot BE a
   mail server (port 25 out is blocked, `DMARC p=reject`) and cannot RECEIVE (no
   inbound port but 443). Those are three separate facts — `docs/EMAIL.md` §3.
   The owner pushed back on the sloppy version twice; do not re-flatten it.

2. **`npm run deploy:owed` is the ONLY way to ask whether a deploy is owed.**
   Do NOT retype a sha into a `git diff` — that is the bug this session opened
   with (STATE.md's own "check, do not trust this line" command named a sha two
   deploys stale and reported already-shipped code as owed).
   `state-handoff.test.js` now forbids the shape.

3. **The สถิติ email/GAS numbers are FLOORS and one was 12× wrong before I
   checked the rows.** `file_url is not null` counted the sentinel
   `ไม่มีไฟล์แนบ` and pasted links as uploads, and a bulk import (25 rows in
   2.86 s) as live traffic. Real peak is 2 calls/minute of 30. **Before you
   trust or extend those panels, read `docs/mistakes/tooling-proofs.md`.**

### Two gaps closed only after being asked "are you sure"

Worth knowing that the first handoff was incomplete, and how:

- **`npm run email:smoke`** now exists. Before it, the only end-to-end email
  test was a throwaway scratchpad script — the capability existed for one
  session and would have died with it. It sends one marked message AND requires
  an unlisted address to be refused, because that `/exec` URL is public and the
  allow-list is all that stops it being an open relay.
- **`npm run dev:check` now compares auth config.** The `mailer_autoconfirm` /
  `site_url` / `uri_allow_list` drift was fixed BY HAND, and a hand fix has no
  memory — those are dashboard settings, outside git, and nothing would have
  noticed them coming back.

**The lesson for the next handoff:** ask what only exists in THIS session's
context — a capability exercised once, a fix applied by hand, a number verified
in a scratchpad. Those are the things that vanish silently.

### ✅ THE สถิติ PANELS HAVE NOW BEEN LOOKED AT — and two things were wrong

Driven 2026-08-29 at 390 px and 1280 px, deployed as `f9584e5`. The previous
handoff called this "the last honest step" and it was: **two faults were
visible in the first screenshot**, and every instrument that had been used to
verify these panels was blind to both.

- `มองไม่เห็น` wrapped to two lines in 8 of the 12 action rows.
- `แยกตามระบบ` showed `ไฟล์หนังสือโคร…` and `SAMO Pass…` — the full text sat in
  a `title` tooltip, **and a phone has no hover**. The panel's whole purpose is
  to say which system spends the shared quota, and that was the cut-off part.

What was NOT wrong, so nobody needs to re-check it: the `--fill` meter renders
at 6% and 7% (the `min-width: 3px` already covers a 0% reading — that was the
worried-about case and it is fine), no horizontal overflow at either width, no
console errors, the 12-row table fits 390 px without scrolling, and 186/186
chart bars paint.

📌 **Method, if you drive another gated pane.** `skills/drive-the-browser.md` §7
works, but reproduce the pane's REAL ancestry — my first harness put the pane in
a bare div and it rendered 660 px wide inside a 1280 px viewport, which would
have hidden the truncation entirely. The real one is
`.workspace-shell > main.workspace-main > section[data-admin-pane]`, and the
payload comes from `analytics_overview(30)` under an impersonated JWT
(`set_config('request.jwt.claims', …)`; a bare superuser call is refused with
"requires an admin grant").

### What is genuinely un-started (not blocked, just not begun)

- `src/data/tools.js`, the one-source ฝ่าย tool registry — `DEPT_DEFS` and
  `tab-tools.html` are still two hand-maintained copies held in step only by
  `dept-tool-mirror.test.js`. `docs/DEPT-TOOLS.md` §13 has the order.
- The browser pass — `docs/NEXT.md` §1; VS staff modal, ประกาศ drafts, อาจารย์
  signature queue, SHOP CHECKOUT are still undriven.
- **Password reset does not exist in the app**, and mail config is why
  (`docs/EMAIL.md` §2). Fixing it is small and is the biggest user-visible win
  available — but it needs a sending credential, which is owner-gated.

### Do NOT redo these — they are decided

- Previews are per-PR on Cloudflare Pages. Decided, built, proven.
- Apps Script STAYS for email. 100/day against a busiest day of 7 is not a
  problem; the Workspace move is an option to reach for IF volume changes, not
  work to do. I recommended it before measuring, and measuring retired it.
- The Mailpit trap is withdrawn AND its need is met.

## ▶ PHASE 6 — the proofs now run against samo-dev (2026-08-29)

✅ **`npm run proofs:dev`** and `.github/workflows/proofs.yml` (PRs touching
`supabase/**`). **All 23 database proofs pass against `samo-dev`** — that is the
first direct evidence for §7.3's assumption, the one the un-gated preview URLs
rest on. The two non-database proofs (`repo-protection`, `notify-exposure`) are
SKIPPED with the reason printed, never silently dropped.

⛔ **NOT WIRED INTO CI, and that is the decision — do not re-open it.** A CI job
needs the Supabase management token in GitHub Actions secrets. That token runs
arbitrary SQL, `samo-dev` holds real student data, and this repo is PUBLIC with
five write-access collaborators — secrets are hidden from FORK PRs but readable
by any workflow pushed on a BRANCH. The secrets were added on 2026-08-29 and
**removed within minutes** when the owner said to take the safe default; the
workflow file was deleted with them, and PR #18 (which proved the job fires) was
closed. The reasoning and the safe alternative (a GitHub Environment with the
owner as required reviewer) are in `docs/TEAM-WORKFLOW.md` §7.9.

📌 **Nothing of value was lost.** The job was only ever a scheduler; the two
things worth having — `npm run proofs:dev`, and a runner that fails a proof
which answered from the wrong database — are local and shipped.

📌 **What building it found, and why it matters more than the CI job.** The
documented dev targeting was broken: two proofs parsed `.env.local` themselves,
so `VITE_SUPABASE_URL=$SUPABASE_DEV_URL npm run proofs` ran them against
PRODUCTION and printed one green summary over the mixture. The fix is NOT the
two files — it is that `run-proofs.mjs` reads each proof's own `→ project:`
line back and fails any proof that answered from the wrong database. Write-up:
`docs/mistakes/tooling-proofs.md`.

✅ **PHASE 6 IS COMPLETE.** `tools/smoke-browser.mjs` — nine checks, Chrome over
CDP, **no npm dependency and no credential** — runs on every Cloudflare preview
(`.github/workflows/smoke.yml`). It exists because `npm test` and
`npm run build` BOTH PASS for a build whose entry module never reaches the
browser, which is this app's signature failure: Bootstrap is a CDN script, so
every menu still opens while ~90 inline `onclick` handlers are dead.

Run it by hand against anything: `npm run smoke:browser -- https://samo.md.kku.ac.th --expect-no-ribbon`.

📌 **The design decision worth keeping.** It loads the page as an anonymous
visitor, so it needs no key — and that is precisely why it is allowed in CI when
the proofs job was not (§7.9). If you extend it to anything behind sign-in, you
have changed that property and the whole §7.9 argument applies again.
`src/js/ci-workflows.test.js` now fails the build if ANY workflow reads a stored
secret, so that decision is a mechanism rather than a paragraph.

## ▶ DEV SYSTEM — ONE ITEM LEFT, and it needs you

✅ **`dev-grants.json` is built** (2026-08-28) — `npm run dev:grants`, and step 8
of `dev:refresh` so a rebuild cannot drop it. Refuses any project but `samo-dev`
BY REF before it writes; every entry must carry an expiry and a reason; it
reports expired entries and emails matching no account at each run, because a
list of people rots and a typo grants nothing while looking like success.
The file ships EMPTY, which is the correct steady state.

✅ **The mail trap is retracted AND its need is met.** Dev mail is forced to one
test inbox at the transport, so no trap is needed to keep test mail off real
people. `docs/EMAIL.md` has the whole assessment.

❌ **LAST ITEM: the dev Apps Script deployment under its own Google account.**
Owner-gated — see item 2 below. Everything else in phase 2 is done.

## ▶ The old passport project — DONE, and it is now safe to delete (2026-08-29)

`idwlabpbwiwgaoqwbozz` was the frozen pre-move backup. Checked before deleting,
and the one thing it held that the live project did not has been restored.

- **Frozen since 2026-07-22** — last write of any kind. Nothing in five weeks.
- **All 469 profiles are represented**, except the 5 gmail accounts merged into
  kkumail identities (`passport.account_migrations` names all five).
- **537 scans. Two were absent; now ONE is**, and that one is correct:
  - `213` — kedsaraporn's gmail scan of an activity her kkumail account also
    scanned. **The live table has `unique (user_id, activity_id)`**, so after
    the merge made them one person the second row could not exist. That is the
    constraint working, not a loss. (Found by accident, when a rollback-wrapped
    trigger proof tripped it.)
  - `157` — **RESTORED 2026-08-29.** kanyapat.ki@kkumail.com,
    โครงการรับน้องบ้านเขียว ปีการศึกษา 2569, 200 pts, 2026-06-21 12:24:55.
    She now reads **300 km, 2 stamps**, and her scan sum matches her stored
    total (the profiles-with-drift count went 12 → 11).

📌 **How the restore was done, if it is ever needed again.** `passport.scans`
has an `on_new_scan` trigger that ADDS `points_awarded` to `profiles.total_km`.
Her total ALREADY included the 200, so a plain insert would have taken her to
500. The insert ran with the trigger disabled inside one transaction —
`alter table … disable trigger` is transactional, so a failure would have rolled
the disable back with everything else. **Then the trigger was proved to still
FIRE** (rollback-wrapped insert → 300+7=307), because `tgenabled = 'O'` is a
flag, not a behaviour: a passport whose trigger silently stopped firing would
award nobody any points and look fine.

📌 **Why 157 dropped is still NOT determined.** Ruled out: the activity exists ·
the season is absent for all 537 equally · her profile exists · id 157 was free ·
her auth account was created in the same batch as controls that copied fine
(#180 of 247, 67 created after her). The migration was a hand-run script, not in
this repo, and left no log. **Do not invent a cause for it.**

⛔ **The old project can now be deleted** — it holds nothing the live one does
not. `docs/INVARIANTS.md` says to rotate its DB password first.

**Separately**: 11 profiles still have `total_km` disagreeing with the sum of
their scans. Pre-existing, unexplained, not chased.

## ▶ The 11 drifting passport totals — and the app CONTRADICTS ITSELF (2026-08-29)

⚠️ **A first pass here recommended leaving the totals alone, reasoning that
recomputing would "take points away". That reasoning was WRONG and the owner
caught it**: *"worapat.c shows 750 in the leaderboard"*. The leaderboard never
used `total_km` at all. Two different numbers drive two different screens:

| Screen | Source | worapat.c sees |
|---|---|---|
| Leaderboard (`admin_leaderboard`) | `sum(scans.points_awarded)` | **750** |
| Tier badge + own page (`user_tiers`) | `profiles.total_km` | **3,600 → "The Voyager"** |

Both are readable by `authenticated` (`profiles_read_self_or_admin`), so the
student sees BOTH numbers and they disagree by 2,850.

**SEVEN students display a tier they have not earned.** Recomputing changes no
leaderboard position — those already come from scans — it only corrects badges:

| Student | badge km | board km | tier now | tier if fixed |
|---|---|---|---|---|
| วรภัทร จงชูวณิชย์ | 3600 | 750 | Voyager | Novice |
| *(test acct `pmphuriphat`)* | 2800 | 0 | Voyager | Novice |
| Mint N *(`mintonaurak`, stranded)* | 2700 | 0 | Voyager | Novice |
| Kita Aimsang | 2500 | 300 | Voyager | Novice |
| พุธิตา สร้อยสุข | 2246 | 250 | Explorer | Novice |
| Phuriphat mahapromrak *(owner)* | 1600 | 400 | Explorer | Novice |
| Natchanun Chuangsakul | 1050 | 850 | Explorer | Novice |

Four more drift without changing tier (all stay Novice): Supphaset 600/500 ·
Chayaphat 500/400 · Phatiphan 500/300 · ธนกฤต 300/200.

📌 **Which number is right is NOT settled.** Scans are auditable (activity,
timestamp, department, points); `total_km` is an unauditable counter that has
been provably one-way since 0056. That argues the scans win. **But Kanyapat's
case argues the opposite** — her total was RIGHT and her scan row was the thing
missing. If worapat really attended those activities, the fix is restoring
scans, not cutting the badge. The deleted rows are gone, so this cannot be
settled from the data. **Ask the students before demoting anyone.**

📌 **`pmphuriphat`'s profile is named "วรภัทร จงชูวณิชย์ เอิงเทส"** — worapat's
name plus a test marker. The test account appears to have been made from
worapat's profile, which may be why worapat drifts too. A lead, not a finding.

### Two findings that are NOT about totals

- **`chayaphat.t@kkumail.com` has a passport profile but NO auth account** —
  none by id and none by email. **They cannot sign in at all.**
- **13 non-kkumail profiles cannot stamp.** Only `mintonaurak` (2700 km) has
  anything at stake; the other 12 hold 0 km.

## ▶ ASKED FOR AND NOT DONE — pick these up first

1. **A `DEV` folder inside `IT Database` on Drive.** The owner asked for it
   (2026-08-27) and it was never created — the Discord webhook incident took the
   rest of the session. Parent folder id: **`1_VQXAVh4ZMoj7_TLiHJFe4HM223Q0oLW`**.
   Purpose: a dev Apps Script deployment writes uploads there instead of into the
   real tree (`docs/TEAM-WORKFLOW.md` §1). ⚠️ The clasp token on this machine is
   `drive.file` + `drive.metadata.readonly` and EXPIRES hourly, so it may not be
   able to create inside a folder it did not make — **it is 30 seconds by hand in
   the Drive UI**, and that is the sane path.

2. **The dev Apps Script deployment.** `samoweb` (`1lENmMdToG_P…`) is the LIVE
   one — confirmed by matching its deployment v11 to the `/exec` id in
   `src/js/config.js`. A dev copy should live under **its own Google account** so
   its credential reaches nothing real (`.claude/rules/security.md` explains why:
   `prform.gs` uses `DriveApp`, so re-authorising grants the whole Drive).

3. ~~**A mail server on the VM — run Mailpit, point `samo-dev`'s SMTP at it.**~~
   **RETRACTED 2026-08-28 — but only the RECEIVING half.** A trap needs
   Supabase to connect IN, and nothing can: the VM holds only
   `10.101.111.181`, and the public `202.28.95.46` has 25/587/465/1025 filtered
   (443 open as the control).
   ⚠️ **Do not read that as "the VM cannot do mail" — it CAN send.**
   `smtp.gmail.com:587` and every other relay answer from the box, proven with a
   real STARTTLS session that offered `AUTH`. What is blocked is port 25
   OUTBOUND (so it cannot be an independent server) and the domain's
   `DMARC p=reject` (so it cannot send AS `@md.kku.ac.th` without KKU NOC).
   **The whole assessment — both senders, every quota ceiling, and the
   recommendation — is `docs/EMAIL.md`.** Read that, not this bullet.
   Headline: there is no password reset in this app, and mail is why; the
   cheapest large win is moving the Apps Script to a KKU Workspace account
   (100 → 1,500 recipients/day, no DNS request, no new service). If a browsable
   trap is still wanted, the transport is Supabase's Send Email Hook over
   HTTPS — 443 is the only port that reaches the VM — and it is NOT built.

## In flight

- ✅ **The database password is in `.env.local` and verified.** Schema dumped:
  64 tables, 165 functions, 156 policies, 592 GRANTs. Recipe and traps in
  `skills/build-the-dev-database.md`. **The dump is a build artifact and is NOT
  in the repo** — it lives in the session scratchpad and goes stale; re-run the
  dump rather than reusing an old file.
- ✅ **`samo-dev` is BUILT, LOADED and PROVEN** (`xibugtlsphcfuvstnxxh`).
  Rebuild any time with `CONFIRM=1 npm run dev:refresh`; check it with
  `npm run dev:check`. Credentials are the `SUPABASE_DEV_*` block in
  `.env.local` and are safe to share with the team — that account holds nothing
  but disposable projects.
- **The one-source tool registry is un-started** — `src/data/tools.js`,
  `docs/DEPT-TOOLS.md` §13. (This bullet used to read "Golden Period is
  un-started", contradicting the top of this same file; the PAGE shipped, the
  REGISTRY did not.) `DEPT_DEFS` in `src/js/departments.js` and
  `src/html/tab-tools.html` are still two hand-maintained copies of one list,
  held in step only by `dept-tool-mirror.test.js`.

## Next time I have an hour

- The project board (the last outstanding piece of `TEAM-WORKFLOW` phase 0).
- ~~Decide whether previews are per-PR or one always-on dev site.~~ **DECIDED
  and BUILT: per-pull-request, on Cloudflare Pages** (`docs/TEAM-WORKFLOW.md`
  §1, D8), proven end to end on 2026-08-27. Left here struck through because a
  session re-opened it from this very bullet and wasted a round trip.
