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

### ⚠️ THE NEW สถิติ PANELS HAVE NEVER BEEN LOOKED AT

Be precise about what was verified, because it is less than it sounds:

- ✅ the render functions have 29 unit tests, each falsified;
- ✅ the strings and CSS classes are in the SERVED bundle and stylesheet;
- ❌ **nobody has opened `/admin#analytics` and SEEN them.**

This repo's own rule is that *a change is NOT verified in a view you never
opened*, and the failures that would survive everything above are exactly the
visual ones: a meter with no width, a table overflowing on a phone, the burst
row colliding with the legend, Thai text wrapping badly. `an-email-meter` uses
`--fill` as an inline width — if that percentage is ever 0 the bar is invisible
and looks like a bug rather than good news.

**Next session: drive it.** `skills/drive-the-browser.md` §4 has the auth
recipe, and `/admin#analytics` needs any admin grant. It is the last honest step
on this work.

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
