# STATE — current task & latest known state

Last updated: **2026-08-15**. This is "what is true RIGHT NOW" and nothing else;
`git log --oneline` is the chronology and `docs/state-archive/` holds the
reasoning. **Keep it under ~200 lines** — when it bloats, move narrative to the
archive rather than trimming the invariants.

**Read the `## NEXT-SESSION PROMPT` at the bottom first.** Then CURRENT DEPLOY.

Reasoning lives in `docs/state-archive/` — newest first:
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
- ✅ **DEPLOYED = `f73a6a4` (2026-08-15)** — working tree clean, local ==
  origin == VM. Verified from the SERVED artifacts: `teamNodeTierField` in the
  admin HTML, `tier-down` in the admin JS, `team-tier-btn` and
  `[data-depth].is-selected` in the admin CSS, and `ใต้สังกัด` in
  **`analytics-*.js`** — the shared chunk, NOT `public-*.js`, which is the trap
  two bullets down and cost a false alarm here. Check rather than trust — EMPTY
  means prod is current:

  ```bash
  git diff --stat f73a6a4..HEAD -- src/ supabase/ appscript/ server/ ':!src/**/*.test.js'
  ```

  The `:!…*.test.js` exclusion is load-bearing, not tidiness: without it a
  guard-test edit sends the next reader on a pointless 90-second deploy.
  **Migrations applied through 0154.** **847 tests green.**
- ⚠️ **จองโควตา Claude (0154) is BUILT AND APPLIED but NOT YET DEPLOYED.** The
  migration is live on Supabase; the bundle serving it is not on the VM yet.
  Two things it needs before it works for anyone:
  **(a) `DISCORD_CLAUDE_WEBHOOK=` in `/etc/samo-notify.env`** then
  `sudo systemctl restart samo-notify` — without it the booking still saves and
  only the notification is skipped. **The webhook the owner supplied was pasted
  in chat and must be REGENERATED first.**
  **(b) grant the `claude` permission** to whoever should book (ทีม SAMO →
  the permission grid). Note ~13 ฝ่าย IT accounts already hold `master`, which
  answers yes to every key, so they have it whether or not anyone ticks a box.
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

## NEXT-SESSION PROMPT (paste this after a /clear — updated 2026-08-15)

> **Read this file, then `skills/write-a-guard.md`.** Nothing is blocking and
> prod == main (CURRENT DEPLOY says how to confirm in one command). Migrations
> through **0153** applied; **798 tests green**; `npm run proofs` 15/15,
> re-run at the end of that session.
>
> **The last session was the org chart**, front to back: two kinds instead of
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
> - **The `master` grants inside ฝ่าย IT are INTENTIONAL — the owner confirmed
>   this on 2026-08-14.** `ฝ่าย IT` carries `permissions = {master}` with
>   inheritance on, so 13 member rows resolve to `master`, 9 of them ordinary
>   `สมาชิกฝ่าย Backend/Frontend` accounts with it live on their users row. That
>   is the IT team that builds this app, and it is deliberate. **Do not "fix" it,
>   and do not raise it as a finding again.** It does still mean the §1
>   restructure warning below is real: the same inheritance reaches further the
>   moment a ฝ่าย is reparented.
> - **The ทีม SAMO admin-model rework is PARKED at the owner's request
>   (2026-08-14).** Analysed in full, nothing built. **Do not restart it unless
>   they ask — `docs/NEXT.md` §0a has the diagnosis, the measurements and the
>   four-step plan.** One thing to carry: they asked whether the display
>   structure and the permission structure should be SEPARATE. They should not —
>   the admin already has four `mode`s over ONE tree, which is the right pattern.
>   ⚠️ **The owner has been EDITING the tree since (272 → 296 nodes), and has
>   already moved `อุปนายกฯ`'s container grant onto the ten อุปนายก leaves by
>   hand. Re-measure before acting on any count.** One open question for them:
>   **`house` is now granted by NO node**, so ระบบบ้าน admin is role-only
>   (12 accounts, zero via permission). Intentional, or lost in the restructure?
> - **SAMO Shop stays open to BOTH login routes.** The owner asked whether
>   customers should be Google-only. They should not: the checkout email field is
>   editable even when Google prefills it, so restricting the login method buys
>   the LOOK of a verified contact and none of it. What staff need is a reachable
>   contact ON THE ORDER — 0150 plus the checkout recap solve it there. If
>   contact reliability comes up again the next step is verifying the address (a
>   confirmation mail that bounces), not narrowing the door.
> - **The sign-in modal's copy rules are settled after SIX reports.** Read the
>   four-report entry in `docs/mistakes/frontend-ui.md` BEFORE touching it. All
>   guarded by `signin-screen.test.js`: NO email domain anywhere in the modal (a
>   domain list is read as a whitelist); the Google button keeps the spec fill and
>   the four-colour G (branding compliance, not taste); the switch link asks about
>   a WANT never a STATE; ONE verb for creating an account (สร้างบัญชี); and the
>   Google label says it both creates and signs in.
>
> ### 1. What is owed
>
> - **เกี่ยวกับเรา on mobile — WAITING ON THE OWNER'S PICK. Do not build yet.**
>   Demo published (private artifact
>   `claude.ai/code/artifact/0c4533a8-099a-49c0-bf48-35173db32cc0`); nothing in
>   `src/` was changed. **Read `docs/demos/about-3d/README.md`, not this
>   bullet** — numbers, pipeline, the open 3D-flicker bug, and the
>   recommendation (ship the 2D grid, 3D as an optional hero).
> - **The browser pass, continued — now with a playbook:
>   `skills/drive-the-browser.md`.** It has found bugs nothing else could (the
>   dead ยกเลิก button; the iPad portrait no DOM measurement could see). **Still
>   undriven: VS staff modal, ประกาศ drafts, อาจารย์ signature queue, and the
>   SHOP CHECKOUT + order card** — the shop contact recap and inline contact
>   editor shipped 2026-08-12 were verified by build, tests, code trace and a
>   static render, never in a browser, because that needs a signed-in session
>   with a cart. `docs/NEXT.md` §1.
> - **The org chart on a REAL iPad.** The four views are shipped and verified on
>   Playwright's WebKit with an iPad profile — same engine, not the same device.
>   Worth one real-device pass: whether the pan/zoom canvas or the เต็มหน้าจอ
>   overlay traps touch-scroll, and whether four view buttons wrap acceptably on
>   a phone. Nothing is known to be wrong; nothing has been confirmed right.
> - **ทีม SAMO restructure — DO NOT reparent a ฝ่าย without reading this.**
>   `node_effective_permissions()` climbs the parent chain while
>   `inherit_permissions` is true, and twelve nodes carry grants. **Simulated in
>   a rolled-back transaction: moving ฝ่าย PR/ComArt/IT under
>   อุปนายกฝ่ายดิจิทัล takes `master` from 3 people to 20** — 17 students
>   silently become full admins. Move the grants onto
>   `team_members.permissions` first, or set `inherit_permissions = false` on
>   the ฝ่าย being moved, then re-run that simulation as a BEFORE == AFTER
>   differential. ⚠️ 0153 flattened eight SEATS; it moved no ฝ่าย, so this is
>   untouched and still true.
> - `docs/NEXT.md` carries the rest, including **§0c** (two role-only policies
>   left latent on purpose) and **§0d** (make the PR delete rule ONE predicate
>   instead of a policy plus a copy — `current_user_vs_scope()` is the model).
>
> ### 1b. The public org chart (`/team`) — the six-line version
>
> **Full reference: `docs/state-archive/2026-08-15-late-org-chart-reporting.md`.
> Read it before touching any of the four views.** What you must not rediscover
> the hard way:
>
> - **FOUR views, TWO parentages.** รายการ + แผนผัง draw CONTAINMENT from the
>   stored tree; ผังองค์กร + ผังรวม draw REPORTING from `chartParentage()`.
>   **Do not unify them** — "one structure so they cannot drift" is exactly the
>   reasoning that turned แผนผัง into a 52,000px staircase.
> - **รายการ + แผนผัง share ONE renderer and ONE markup**; only CSS differs.
>   Scope every rule on `[data-view=…]`, never on a width.
> - **The display rules all live in `src/js/org-rung.js`** — sibling order,
>   the ฝ่าย→head re-parenting, ระดับ, the rungs, and the card's meta line.
>   Pure, no DOM, guarded by `org-rung.test.js` (32).
> - **"แสดงถึง" is a KIND, not a depth** (ฝ่ายหลัก / ฝ่ายย่อย / ตำแหน่ง /
>   ทั้งหมด = 14 / 136 / 290 / 298 cards). A number cannot name a level of a
>   ragged tree.
> - **ระดับ (`tier`, 0153) carries RANK so `parent_id` can mean CONTAINMENT.**
>   NULL = 1. Nesting still works; ระดับ removes the need for it.
> - **Colour**: `team_nodes.color` (0152) beats the name-derived tint, which is
>   **ROOT-ONLY**. Hex-constrained in the DB *and* in JS — it lands in a
>   `style` attribute on an anonymous page.
>
> ### 1c. OPEN — nothing, and two rulings not to re-raise
>
> Nothing is outstanding from the org-chart work. Two things the owner has
> ruled on:
>
> - **The `master` grants that reach สมาชิกฝ่าย IT are INTENTIONAL** — confirmed
>   twice, most recently 2026-08-15 when the tier proposal cited them as a side
>   effect. They are not an argument for anything. Do not raise them a third time.
> - **The owner's asks are about ผังรวม.** They explicitly do not want แผนผัง
>   reworked.
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
