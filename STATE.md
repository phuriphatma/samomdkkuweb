# STATE — current task & latest known state

Last updated: **2026-08-16**. This is "what is true RIGHT NOW" and nothing else;
`git log --oneline` is the chronology and `docs/state-archive/` holds the
reasoning. **Keep it under ~200 lines** — when it bloats, move narrative to the
archive rather than trimming the invariants.

**Read the `## NEXT-SESSION PROMPT` at the bottom first.** Then CURRENT DEPLOY.

Reasoning lives in `docs/state-archive/` — newest first:
`2026-08-16-claude-quota-booking.md` (**read before touching `/admin#claude`**) ·
`2026-08-15-late-org-chart-reporting.md` (the two parentages, ระดับ, colour;
**read before touching `/team`**) · `2026-08-15-org-chart-views.md` (the d3
views, the library survey, three portrait bugs) ·
`2026-08-12-signin-shop-guards.md` · `2026-08-10-late-security-and-identity.md`
· `2026-08-10-chan-pi.md` · and nine older files back to `2026-07-24-full.md`.
Architecture/RLS: `docs/CONTEXT.md`. Bugs: `docs/mistakes/*.md`, indexed by
`.claude/rules/mistakes.md`. Backlog: `docs/NEXT.md`.

## CURRENT DEPLOY

- Prod = KKU VM `samo.md.kku.ac.th`. Deploy = commit → push `main` →
  `skills/deploy-vm.md`. **Needs VPN. Pushing does NOT deploy.**
- ✅ **DEPLOYED = `d83308c` (2026-08-16)** — working tree clean, local == origin == VM.
  Verified from the SERVED artifacts: `ว่างให้ใช้เลย โดยไม่ต้องจอง`,
  `จำกัดด้วยโควตาสัปดาห์`, `claude-week-fig-block`, `ช่วงนี้มีคนจองไว้แล้ว`,
  `hidden.bs.modal` in the admin JS; `--claude-lane`, `--claude-part`,
  `claude-free.is-held` in the admin CSS; **0** in the served `public-*.js`
  (the pane is admin-only — that is the control). Check rather than trust — EMPTY means prod is current:

  ```bash
  git diff --stat 2f80973..HEAD -- src/ supabase/ appscript/ server/ ':!src/**/*.test.js'
  ```

  The `:!…*.test.js` exclusion is load-bearing, not tidiness: without it a
  guard-test edit sends the next reader on a pointless 90-second deploy.
  **Migrations applied through 0158.** **1057 tests green.**
- ✅ **จองโควตา Claude (0154 + 0155) is LIVE END TO END** — booking, the board,
  the Discord notice, the MEASURED usage strip, **"ใช้ได้เลยตอนนี้"**, the
  per-segment capacity rail on the calendar, and the measured LOG. Verified
  2026-08-16: the VM's systemd timer fires every 15 minutes and writes as
  `claude-reporter@samomdkku.app` under RLS.
  **One thing still owed: grant the `claude` permission** in ทีม SAMO to whoever
  should book. (~13 ฝ่าย IT accounts already hold `master`, which answers yes to
  every key.)
- **0155's one idea: the board answers "may I use it NOW", not only "is this
  slot free".** `claude_free_now(p_at)` = `min(what is left in the live 5-hour
  window, what the week has left after everyone's reservations)`, and
  `claude_free_windows()` walks it over the whole week for the calendar rail.
  Read `docs/state-archive/2026-08-16-claude-quota-booking.md` §"0155" before
  touching any of it — especially **why the answer changes at
  `booking_start − 5h`**, an instant nothing on a calendar marks.
  Proof: `tools/claude0155-free-now.sql` (21/21), built from the owner's own
  three worked examples and falsified against two injected bugs.
- ⛔ **`claude setup-token` CANNOT be used for the usage reporter. Measured:**
  `oauth/usage` → **403 "OAuth token does not meet scope requirement
  user:profile"**, while a `claude login` token → 200. The one-year token
  carries `user:inference` but not `user:profile`, so it can SPEND the
  subscription and cannot READ it. It was recommended here for its lifetime and
  that was wrong; do not re-suggest it. The reporter's credential comes from
  `claude login` ON THE VM, and the script refreshes and re-saves it (access
  ~2h, refresh ~12d and rotating), so a 15-minute timer renews it ~96×/day.
- ⚠️ **A `setup-token` (valid to 2027-08) was pasted in chat and is STILL LIVE**
  — confirmed HTTP 200 on `/v1/messages`. It was removed from the VM but only
  the owner can revoke it: claude.ai → Settings → Connectors/Tokens, or
  `claude auth logout` on the machine that minted it. It can burn quota; it
  cannot spend money (see the security note below).
- ⚠️ **The 700% weekly pool may be wrong from 19 Aug 16:00.** `/usage` on the
  owner's machine shows *"+50% weekly limits promo through Aug 19"*. The pool
  is derived from their ratio 1% weekly = 7% session; if the weekly cap is
  currently inflated 50% and the session cap is not, that ratio is not stable
  across the promo boundary — and the boundary IS the next weekly reset. Nobody
  has measured which side the 1:7 was taken on, so this is a question for the
  owner, not a number to guess. Fix is one statement, no migration:
  `update public.claude_settings set week_pool_pct = <n>;` — the value was made
  a SETTING for exactly this.
  It is also DERIVABLE once samples accumulate: each `claude_usage_samples` row
  carries both `five_hour_pct` and `seven_day_pct`, so the weekly delta across
  one full session window is the ratio, measured rather than assumed.
- ⚠️ **Verify from the chunk the served HTML actually loads.** Code often lands
  in the SHARED `analytics-*.js` that BOTH entries import (the shop checkout
  strings did), and minified builds rename module-scope `let`s — grep a STRING
  LITERAL or a CSS class.
  ⚠️ **`askConfirm` is admin-only by import graph**, so its strings are absent
  from the PUBLIC bundle BY DESIGN.
- **Apps Script: both projects deployed** — samoweb v11, passport v10. ⚠️ A
  missing `GAS_SCRIPT_ID` makes `npm run deploy:gas` a SILENT NO-OP.
- ⚠️ **Rotate the VM sudo password** and the **KKU SSO client secret** — both
  were exposed in chat transcripts (2026-08-07 / 08-08).

## Live proofs — `npm run proofs`

**All 15 green — RE-RUN 2026-08-15 at the end of the org-chart session, after
0151–0153, not inherited.** One command runs every live proof and prints one
verdict each; `npm run proofs <substring>` runs a subset.

**`tools/team0153-tier-parity.mjs` is NOT in that 15, on purpose** — it compares
the tree against a snapshot pinned to 2026-08-15, so it will legitimately go red
once the tree is edited. One-shot, kept re-runnable:
`node tools/team0153-tier-parity.mjs tools/fixtures/team-tree-before-0153.json`.

⚠️ **They were 14/15 when this session checked, and STATE.md had been claiming
15/15 for three days.** `house0144-delete-impact.sql` was ERRORING (42501): its
subject picker matched only `has_permission('house')`, and zero accounts held it
in either permission column while twelve held the `vp_admin`/`dev` role the
function ALSO accepts — so it selected nobody and the RPC correctly refused.
Fixed by making the picker mirror the gate. **A proof's subject selector is part
of the gate; re-derive it from the function's own `if`.**
`docs/mistakes/tooling-proofs.md`. **Do not carry this claim forward without
re-running — it went stale silently, and an errored proof is silence.**

**Do not check them with an ad-hoc parser** — they emit four different output
shapes and doing it by hand produced two false alarms in a row.
`tools/run-proofs.mjs` normalises them and reports UNKNOWN as a FAILURE.

Run the one covering what you touch. All are both-directional.
**Read `skills/write-a-guard.md` before writing or trusting any of them.**

- `authz-sweep-identity.sql` (23/23) — run after ANY policy change on
  `users`/`people`/`students`/`team_members`.
- **The claude pane's colour system, since the owner asked for it:** clay
  (`--claude-clay`, Claude's own) = MEASURED, what Claude reports it spent ·
  green = free/available · ฝ่าย colours = booked by a person · amber
  (`--claude-part`) = partly booked · red = none left. The capacity ramp's
  middle was `--brand-orange` and had to move to amber, because orange sits one
  hue-step from clay and "partly booked" started looking like "actually used".
- ⚠️ **The claude pane has TWO TIME SCOPES and they are not interchangeable.**
  The hero (`ใช้ได้เลยตอนนี้`) is about NOW; the week card is about the week the
  arrows landed on. 0156 exists because the card was reading `right_now` — it
  agreed on the current week and was wrong on every other. A future week
  measures **NULL, not 0**: a zero draws an empty bar and reads as a reading.
- ⚠️ **`get_claude_board()` grows superlinearly with bookings** — measured
  2026-08-16: ~25 ms at 7 bookings in a week, ~37 at 19, ~65 at 24, ~100 at 30.
  `claude_free_windows()` calls `claude_free_now()` once per boundary and the
  boundaries grow with the bookings, so it is O(bookings²)-ish, and the board
  polls every 60 s per open admin tab. Fine at this feature's real scale (a
  handful a week) — recorded so nobody rediscovers it in production. If a week
  ever carries ~50 bookings, hoist the settings/sample reads out of
  `claude_free_now()` or compute the bands in one pass.
- `claude0157-rail-segments.sql` (8/8) — the calendar's capacity rail. Asserts
  the PROPERTY ("the answer does not change inside a band") rather than a list
  of boundaries, **because the bug WAS a wrong list**: 0155's header named four
  instants where the answer can change and the code's `union` had three. A
  guard restating that list would have passed. Falsified against both original
  bugs. ⚠️ Its §B taught the other half — the first draft asserted that every
  band's END still earns that band's number and three bands failed; the
  ASSERTION was wrong. Only `booking_start − 5h` carries "you may still start
  AT this instant"; at a window reset or a booking's start/end the later value
  already applies.
- `claude0155-free-now.sql` (21/21) — "how much may I use right now, until
  when". Its §A is the owner's three worked examples verbatim; §B1 holds the
  branch they never reach (an ALREADY-OPEN 5-hour window comes from the
  MEASUREMENT, not the clock) and §B2 is the unconstrained control. FALSIFIED
  2026-08-16 by injecting two bugs — dropping the weekly term reddens A3 only,
  anchoring the window to the clock reddens B1/B1b only.
- `claude0154-quota-guard.sql` (20/20) — the จองโควตา Claude caps. Written and
  FALSIFIED on 2026-08-16: with the trigger disabled and the exclusion
  constraint dropped, D1/D2/D4/D5 flip red and D3 stays green (it is the CHECK
  constraint, a different mechanism), which is what says each case is held by
  the thing it names.
- `pr0149-delete-permission.sql` (12/12) · `shop0150-buyer-contact.sql` (10/10) ·
  `house0116-authz.sql` · `house0144-delete-impact.sql` (18/18) ·
  `house0145-duplicate-person.sql` · `house0146-crest-refcount.sql` ·
  `team0145-one-chan-pi.sql` · `team0145-save-as-the-member.sql` ·
  `house0132-registry.mjs` · `proj0092-seat-parity.mjs` ·
  `team0135-name-split.mjs` · `team0137-search.mjs` · `grant0093-reads.mjs` ·
  `team0143-photo-refcount.mjs`
- ⚠️ **`shop0150`'s subject is MANUFACTURED** — all six real orders belong to
  shop ADMINS and the guard early-returns for one, so a proof that picks a real
  order reports that a buyer may set the total to ฿1.

## จองโควตา Claude — security posture

Verified 2026-08-16 and unchanged since; the detail moved to
`docs/state-archive/2026-08-16-claude-quota-booking.md`. The three facts that
matter: **nothing leaked to git** (the token appears in 0 commits), the
credential on the VM can burn QUOTA but **cannot spend money**
(`extra_usage.is_enabled=false`, `can_purchase_credits=false` — keep it that
way, that setting is doing real work), and `claude-reporter@samomdkku.app`
holds only `claude`. ⚠️ A `setup-token` pasted in chat is STILL LIVE; only the
owner can revoke it.

## OTHER SYSTEMS — stable, nothing owed

PR · VitalSound · News · หนังสือโครงการ · Analytics: unchanged. Write-ups in
`docs/state-archive/`; architecture in `docs/CONTEXT.md`.

- **Passport** (repo `phuriphatma/samomdkkupassport`, same Supabase project,
  `passport` schema): kkumail-only gate live. Dev test still ACTIVE
  (pmphuriphat→phuriphat.ma) — revert SQL in `2026-07-24-full.md`. Old project
  `idwlabpbwiwgaoqwbozz` is a cold backup — rotate its DB password before deleting.
- **notify**: `/notify` Node service on the VM; `notify_log` (0055) recording.
- Retention jobs NOT scheduled (`prune_analytics`, `prune_notify_log`).

## Housekeeping

The memory layout is in `CLAUDE.md` § "Memory layout" — not repeated here,
because two copies of one rule is the class this repo pays for most.

- **Do not re-create `.claude/rules/mistakes-archive.md`** — it lived in the
  auto-loaded directory, so archiving into it saved nothing.
- **The design/plan docs were swept 2026-08-12 and now carry status banners.**
  **When a plan doc is finished, banner it the same day** — a stale plan with
  destructive steps (PASSPORT-MERGE still said "not started" while containing a
  `truncate passport.*`) is the most dangerous file in a repo.
- **Never hand-edit the mistakes index** — `npm run mistakes:index` generates it.
- **Never raise the context cap** when `npm run check:context` fails. Move detail
  into `docs/`.
- `.env.local` holds the Supabase PAT, the VM sudo pw, project-B DB creds.
- CI = Node 22. `npm run build && npm test` before every commit.

## จองโควตา Claude — THE FEATURE THIS SESSION REBUILT (read before touching it)

Five migrations in one day (0154 → 0158) and **every single fix came from the
owner testing live**. The pattern is worth more than the code: each bug was a
number that was ARITHMETICALLY RIGHT and MEANT something else.

**The two rules that produced four of the five bugs:**

1. **Two quantities in one subtraction must share an INSTANT.** 0156 (the week
   card read `right_now`, so browsing ahead showed today's usage) and 0158 (the
   weekly remainder subtracted a FUTURE reservation list from a PRESENT
   measurement, so finished bookings appeared to hand their quota back and
   `week_free` climbed 10 → 60 → 160 → 260 → 360). Both were invisible in
   review, because the present is the one instant where every scope agrees —
   and it is the instant you are looking at while you build.

2. **A readout is only correct where its question applies.** The rail's
   `claude_free_now()` really is 50 inside somebody's block — and the rail says
   "free to use without booking", so it was inviting the collision booking
   exists to prevent. Now carved out and drawn as a hatched "held" state.

**The three panels and their scopes — do not cross them:**

| Panel | Scope | Source |
|---|---|---|
| `ใช้ได้เลยตอนนี้` (hero) | this instant | `claude_free_now()` |
| the week card | the week ON SCREEN | `board.week.*` (0156) |
| the rail | per START TIME | `claude_free_windows()` |

**Colour carries meaning here:** clay = MEASURED (Claude's own number) · green =
free · ฝ่าย colours = booked by a person · amber = partly available · red = none
· hatch = held by someone. Amber was `--brand-orange` and had to move: it sat
one hue-step from clay and "partly booked" started looking like "actually used".

**The rail's semantics, exactly:** a band means "start anywhere in here and you
may take this much", and its END is the LATEST START that still earns it. That
is why `booking_start − 5h` is a boundary — a session begun exactly then ends as
their block opens and shares with nobody. Bands are evaluated one second INSIDE,
never at the edge (0157).

**Guards, and what they cost to get right:**
- `tools/claude0157-rail-segments.sql` (10/10) asserts the PROPERTY ("the answer
  does not change inside a band"), **not a list of boundaries — because the bug
  WAS a wrong list**: 0155's header named four instants and the code had three.
- Its §B first asserted every band's end earns that band's number; three bands
  failed and the ASSERTION was wrong, not the code.
- Its sample is DERIVED from the booked total: hardcoded, the live week capped
  every band and the controls B3/B4 correctly went red.
- `tools/claude0155-free-now.sql` (22/22) — C3 asserted the opposite of the
  truth and went red the moment 0158 landed. That is the right way round.
- `src/js/claude/gesture.test.js` (35) — the touch gesture, the lane, the
  identity. Three of its assertions were BLIND on first write (a regex that ran
  past the end of a function; `.match` without `/g` reading the wrong CSS rule;
  `toContain('carve(')` matching the definition).
- Browser probes live in the scratchpad, not the repo: a 13-case iPad touch run
  and a painted-box overlap check. **The touch run's ALLOW case is what caught
  a harness where the modal counter had been dropped** and every "opens no
  modal" case was passing vacuously.

⚠️ **`get_claude_board()` cost grows with bookings** — ~25 ms at 7/week, ~100 ms
at 30, polled every 60 s per open tab. Fine at real scale; see the note above.

## NEXT-SESSION PROMPT (paste this after a /clear — updated 2026-08-16)

> **Read this file, then `skills/write-a-guard.md`.** Nothing is blocking and
> prod == main (CURRENT DEPLOY says how to confirm in one command). Migrations
> through **0155** applied; **1047 tests green**; `npm run proofs` 15/15 as of
> 2026-08-15, plus `claude0155-free-now.sql` 21/21 re-run today.
>
> **The last session was จองโควตา Claude, front to back, five migrations
> (0154 → 0158) and eleven owner reports.** It is done, deployed and verified.
> **Read the "จองโควตา Claude" section above before touching `/admin#claude`** —
> it has the three panels and their scopes, the colour system, the rail's exact
> semantics, and what the guards cost to get right. The archive file
> `docs/state-archive/2026-08-16-claude-quota-booking.md` has the reasoning.
>
> **The one thing still owed: grant the `claude` permission** in ทีม SAMO to
> whoever should book. Exactly ONE account holds it today.
>
> **Two habits this session paid for, in case they save you the money:**
> **render the view you changed** (three bugs were only visible in a
> screenshot, and one — the rail overlapping the session frame — was invisible
> in the stylesheet and obvious in the painted boxes), and **when a number
> looks right, check the SENTENCE around it is true everywhere it is drawn.**
> Four of the five bugs were correct arithmetic answering the wrong question.
> **Read `docs/state-archive/2026-08-16-claude-quota-booking.md` before touching
> `/admin#claude`** — especially the three bugs the owner found, the two dead
> ends (`setup-token` cannot read usage; local-log tools cannot see a shared
> account), and why a session is DERIVED rather than a slot on a grid.
>
> The session before that was the org chart, front to back: two kinds instead of
> three, kind-based rungs, a reporting parentage on the canvas, per-ฝ่าย colour,
> and ระดับ. Seven commits, four deploys, three migrations, five owner reports
> answered. **If the next thing you touch is `/team`, read
> `docs/state-archive/2026-08-15-late-org-chart-reporting.md` first** — §1b here
> is only the index to it.
>
> Two habits that session paid for, in case they save you the same money:
> **render the view you changed** (three of four views were inspected; the
> fourth was the one that broke), and **when a report reads as ambiguous between
> two designs, it means the more expensive one** — "role first, then ฝ่าย under
> it" was shipped as a sort and meant a rank, and cost two extra rounds.
>
> ### The decisions already made — do not re-litigate
>
> Each was settled with the owner; the reasoning is in the archive file named.
>
> - **The `master` grants reaching สมาชิกฝ่าย IT are INTENTIONAL** — confirmed
>   twice (2026-08-14, 2026-08-15). That is the team that builds this app. Do
>   not "fix" it and do not raise it a third time.
> - **The ทีม SAMO admin-model rework is PARKED** at the owner's request.
>   `docs/NEXT.md` §0a has the diagnosis and plan. Display structure and
>   permission structure should NOT be separated — four `mode`s over ONE tree is
>   the right pattern. ⚠️ The tree has been edited since (272 → 296 nodes);
>   re-measure before acting on any count. Open question for them: **`house` is
>   granted by NO node**, so ระบบบ้าน admin is role-only. Intentional or lost?
> - **SAMO Shop stays open to BOTH login routes** — the checkout email is
>   editable even when Google prefills it, so restricting the login method buys
>   the LOOK of a verified contact and none of it.
> - **The sign-in modal's copy is settled after SIX reports.** Read the entry in
>   `docs/mistakes/frontend-ui.md` BEFORE touching it; guarded by
>   `signin-screen.test.js`. No email domain anywhere in the modal, ever.
> - **The org chart: the owner's asks are about ผังรวม**; they explicitly do not
>   want แผนผัง reworked.
>
> ### 1. What is owed
>
> - **จองโควตา Claude: grant the `claude` permission** to whoever should book.
>   Everything else is live. (Details in CURRENT DEPLOY above.)
> - **เกี่ยวกับเรา on mobile — WAITING ON THE OWNER'S PICK. Do not build yet.**
>   Read `docs/demos/about-3d/README.md`, not a bullet — it has the numbers, the
>   open 3D-flicker bug and the recommendation. Nothing in `src/` was changed.
> - **The browser pass, continued — `skills/drive-the-browser.md`.** It finds
>   bugs nothing else can (the dead ยกเลิก button; the iPad portrait). Still
>   undriven: VS staff modal, ประกาศ drafts, อาจารย์ signature queue, and the
>   SHOP CHECKOUT + order card. `docs/NEXT.md` §1.
> - **The org chart on a REAL iPad.** Verified on Playwright's WebKit with an
>   iPad profile — same engine, not the same device. Nothing is known wrong;
>   nothing is confirmed right.
> - **ทีม SAMO restructure — DO NOT reparent a ฝ่าย without reading this.**
>   `node_effective_permissions()` climbs while `inherit_permissions` is true.
>   **Simulated in a rolled-back transaction: moving ฝ่าย PR/ComArt/IT under
>   อุปนายกฝ่ายดิจิทัล takes `master` from 3 people to 20.** Move grants onto
>   `team_members.permissions` first, or set `inherit_permissions = false`, then
>   re-run that simulation as a BEFORE == AFTER differential.
> - `docs/NEXT.md` carries the rest (§0c two latent role-only policies, §0d make
>   the PR delete rule ONE predicate).
>
> ### 1b. The public org chart (`/team`)
>
> **Fully archived — read `docs/state-archive/2026-08-15-late-org-chart-reporting.md`
> before touching any of the four views.** The two rules that get rediscovered
> the hard way: **FOUR views, TWO parentages** (รายการ+แผนผัง draw CONTAINMENT,
> ผังองค์กร+ผังรวม draw REPORTING — do NOT unify them, that is what made แผนผัง
> a 52,000px staircase), and **"แสดงถึง" is a KIND, not a depth**. Display rules
> live in `src/js/org-rung.js`, guarded by `org-rung.test.js`.
>
> ### 2. Invariants that will bite you
>
> - **`public.people` is the person registry.** `students.person_id` /
>   `team_members.person_id` are PLACEMENTS, both `ON DELETE SET NULL`. Both
>   mirrors are guarded by `is distinct from`, and **that guard is the
>   TERMINATION CONDITION**. A mirror is only bidirectional on the columns BOTH
>   directions NAME.
> - **Deleting a นักศึกษา is two different deletes** — `student_delete_impact()`
>   (0144) is the only correct way to tell them apart.
> - **`team_members` has NO unique key on kkumail, on purpose** — 82 people hold
>   2–4 ตำแหน่ง. `students.kkumail` IS unique. Do not "fix" the asymmetry.
> - **Nothing may re-add a role branch to `users_read_all`** — `role` and
>   `permissions` share the row, so a full read maps who holds `master`.
> - **ชั้นปี IS NOT STORED.** `src/js/study-year.js` computes it; never spread a
>   row and overwrite only `student_id` — call `yearBasis(stored, typed)`.
> - **A "fill only if empty" prefill is safe only while the IDENTITY behind it
>   cannot change.** The account switcher does not reload, so any such prefill
>   must remember WHOSE data it holds (`applyBuyerPrefill`, `prefillUid`).
> - **A client-side count over an RLS-gated table is a fail-open** — RLS returns
>   ZERO ROWS, not an error. Count server-side.
> - **Deploy first, drop second.** 0129 dropped columns the SERVED bundle still
>   named and took ระบบบ้าน's admin tab down for 20 minutes.
> - **A TRASHED Drive file is still served publicly** by `lh3`.
> - **`set_config(…, true)` is TRANSACTION-scoped** and `reset role` does not
>   clear it.
> - **A guard's INSTRUMENT needs a guard.** Comment stripping, bundle grepping
>   and result parsing all silently change what a test can SEE, and a wrong
>   instrument makes a test PASS. Use `src/js/strip-comments.js` and
>   `npm run proofs`, never a fresh regex.
> - **Grep the SHARED chunk, not just `public-*.js`.** `ใต้สังกัด` reads 0 in the
>   public bundle and 1 in `analytics-*.js`, which `/team` also loads. That cost
>   a false "the deploy did not take" on 2026-08-15.
>
> ### 3. How this repo wants you to work
>
> - **The owner tests live and reports in bursts**, often against code shipped
>   hours earlier. Treat their message as the test pass this repo does not have.
>   Their reports are usually about MEANING, not mechanics — six sign-in reports
>   were all "this text is accurate to us and ambiguous to a stranger".
> - **A fix on ONE path is not a fix** (class 4) and **prove it live in BOTH
>   directions** (class 7) — both are in the auto-loaded `.claude/rules/mistakes.md`.
> - **When a hazard has been paid for twice, the third fix is a TEST.** Fourteen
>   ratchets now (`undefined-refs` · `native-dialog` · `upload-cleanup` ·
>   `photo-retire` · `portrait-filename` · `confirm-modal` · `signin-screen` ·
>   `definer-authz` · `strip-comments` · `checkout-prefill` · `node-kind` ·
>   `org-rung` · `dept-tint` · `team-state-specificity`). Every one found
>   something. **Falsify each assertion before committing it** — two fixtures
>   written on 2026-08-15 passed with the bug reintroduced because they could
>   not reach the branch they claimed to cover.
> - **Batch commits before deploying** — each VM deploy is ~90 s. A `tools/`- or
>   `docs/`-only commit needs no deploy.
