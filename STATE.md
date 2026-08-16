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
- ✅ **DEPLOYED = `1e752d5` (2026-08-16)** — working tree clean, local ==
  origin == VM. Verified from the SERVED artifacts: `get_claude_usage_log`,
  `free_windows`, `ใช้ได้เลยตอนนี้ โดยไม่ต้องจอง`, `แตะค้างไว้` and
  `pointercancel` in `admin-2IUWXJd9.js`; `claude-free-tag`, `cu-line-week`,
  `claude-now-pct` in the `admin-*.css` the served HTML actually links; **0** in
  the served `public-*.js` (the pane is admin-only — that is the control).
  PostgREST resolves both RPCs (42501, not 404), so its schema cache is current
  and anon is refused. Check rather than trust — EMPTY means prod is current:

  ```bash
  git diff --stat 2f80973..HEAD -- src/ supabase/ appscript/ server/ ':!src/**/*.test.js'
  ```

  The `:!…*.test.js` exclusion is load-bearing, not tidiness: without it a
  guard-test edit sends the next reader on a pointless 90-second deploy.
  **Migrations applied through 0156.** **1050 tests green.**
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

**Do not check them with an ad-hoc parser.** They emit four different output
shapes, and doing it by hand produced two false alarms in a row (a fully green
proof read as "0/23 FAIL", then four more as N-1/N because each file's own
`ALL PASS` summary row was counted as a failing case). `tools/run-proofs.mjs`
normalises them and reports **UNKNOWN as a failure** for output it cannot read.

Run the one covering what you touch. All are both-directional.
**Read `skills/write-a-guard.md` before writing or trusting any of them.**

- `authz-sweep-identity.sql` (23/23) — run after ANY policy change on
  `users`/`people`/`students`/`team_members`.
- ⚠️ **The claude pane has TWO TIME SCOPES and they are not interchangeable.**
  The hero (`ใช้ได้เลยตอนนี้`) is about NOW; the week card is about the week the
  arrows landed on. 0156 exists because the card was reading `right_now` — it
  agreed on the current week and was wrong on every other. A future week
  measures **NULL, not 0**: a zero draws an empty bar and reads as a reading.
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

## จองโควตา Claude — security posture (verified 2026-08-16)

Checked rather than assumed, because the owner asked directly.

- **Nothing leaked to git.** `sk-ant-oat01` appears in **0** commits; the only
  `discord.com/api/webhooks/...` strings ever committed are the `xxx/yyy`
  placeholders in `*.example`; `dist/` carries neither. `.env.local` is ignored.
- **What DID leak is the chat transcript** — the Discord webhook and the Claude
  token were both pasted there. That is the real exposure surface, not the repo.
- **Blast radius if the VM is compromised**: an attacker gets a credential that
  can make inference calls, i.e. burn the 5-hour/weekly QUOTA. Self-healing at
  the next reset, and revocable.
- **It cannot spend MONEY.** Read live from the account:
  `extra_usage.is_enabled=false`, `user_disabled=true`, `spend.enabled=false`,
  `can_purchase_credits=false`, `can_toggle=false`, `spend.used=0`. Billing and
  plan changes need a claude.ai WEB session (cookies), a different credential
  that never touches the VM. **Keep usage credits disabled — that setting is
  doing real work as a spend ceiling.**
- Both VM secret files are `-rw------- root root`:
  `/etc/samo-notify.env`, `/etc/samo-claude-usage.env`.
- `claude-reporter@samomdkku.app` is a DEDICATED account holding only
  `claude` — least privilege, so the credential in `/etc` can insert usage
  samples and read the board and nothing else. Password in `/etc` (600) only,
  never in git, never printed. Created by direct `auth.users` insert; that needs
  the GoTrue token columns set to `''` not NULL or every sign-in 500s with
  "Database error querying schema".

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

## NEXT-SESSION PROMPT (paste this after a /clear — updated 2026-08-16)

> **Read this file, then `skills/write-a-guard.md`.** Nothing is blocking and
> prod == main (CURRENT DEPLOY says how to confirm in one command). Migrations
> through **0155** applied; **1047 tests green**; `npm run proofs` 15/15 as of
> 2026-08-15, plus `claude0155-free-now.sql` 21/21 re-run today.
>
> **The last session was จองโควตา Claude again**, answering four owner reports
> from a day of using 0154: the iPad touch mess (hold-to-book), the week-arrow
> "shows my profile" (a stale drag), the id card naming the wrong person in
> another week, and — the one that changed the feature — **"ใช้ได้เลยตอนนี้"**,
> how much may be used right now without booking, and until when. Plus the
> measured 15-minute log and a capacity rail on the calendar. Migration 0155.
> It is done, deployed and verified — the only thing owed is still granting the
> `claude` permission to whoever should book.
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
