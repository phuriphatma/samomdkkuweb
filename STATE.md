# STATE — current task & latest known state

Last updated: **2026-08-12**. This is "what is true RIGHT NOW" and nothing else;
`git log --oneline` is the chronology and `docs/state-archive/` holds the
reasoning. Keep it under ~200 lines — when it bloats, move narrative to the
archive rather than trimming the invariants.

**Read the `## NEXT-SESSION PROMPT` at the bottom first.** Then CURRENT DEPLOY.

Archives (all `docs/state-archive/`): `2026-08-10-late-security-and-identity.md`
(0147–0148, the identity swap, the first browser pass) · `2026-08-10-chan-pi.md`
(0145–0146, v4.6.0) · `2026-08-09-session.md` (the person registry, the mirrors,
Drive cleanup, both GAS redeploys) · `2026-08-08-late-0128-0131.md` ·
`2026-08-08-house-polish.md` · `2026-08-05-late-13-requests.md` ·
`2026-08-05-shipped.md` · `2026-08-04-shipped.md` ·
`2026-07-31-team-0104-detail.md` · `2026-07-30-pre-clear.md` ·
`2026-07-24-full.md`.
Architecture/RLS: `docs/CONTEXT.md`. Bugs: `docs/mistakes/*.md`, indexed by
`.claude/rules/mistakes.md`. Backlog: `docs/NEXT.md`.

## CURRENT DEPLOY

- Prod = KKU VM `samo.md.kku.ac.th`. Deploy = commit → push `main` →
  `skills/deploy-vm.md`. **Needs VPN. Pushing does NOT deploy.**
- ✅ **DEPLOYED = `1f514f1` (2026-08-12), verified from the SERVED artifact**:
  `order-contact` in the public CSS bundle, `เราจะติดต่อกลับที่` in the served
  `analytics-*.js` (the shared chunk — NOT in `index-*.js`, which is exactly the
  documented trap), and the sign-in caption's KKU domains gone (the remaining
  `kkumail.com` hits in the served HTML are a Google Apps Script URL, not copy). Check rather than trust — EMPTY means prod is current, anything
  else means deploy before believing the rest of this file:

  ```bash
  git diff --stat 1f514f1..HEAD -- src/ supabase/ appscript/ server/ ':!src/**/*.test.js'
  ```

  The `:!…*.test.js` exclusion is load-bearing, not tidiness: the first version
  of this command flagged a guard-test edit one commit after it was written and
  would have sent the next reader on a pointless 90-second deploy.
  `ca3b824` is the sign-in modal rebuilt to the conventional layout with a
  branding-compliant Google button. **Its caption is deleted on purpose and must
  not come back** — see `docs/mistakes/frontend-ui.md`, the four-report entry:
  any list of email domains under that button is read as a whitelist.
  `signin-screen.test.js` fails if one reappears.
  **Migrations applied through 0150** (0150 is the last, and it is applied).
  **709 tests green.**
- ⚠️ **Verify from the chunk the served HTML actually loads.** Code often lands
  in the SHARED `analytics-*.js` that BOTH entries import, and minified builds
  rename module-scope `let`s — grep a STRING LITERAL or a CSS class.
  ⚠️ **`askConfirm` is admin-only by import graph** (`confirm-modal.js` is
  reached only from `house/index.js`, `team/index.js`, `team/health.js`,
  `team/terms.js`), so its strings are absent from the PUBLIC bundle BY DESIGN.
- **Apps Script: both projects deployed** — samoweb v11, passport v10. ⚠️ A
  missing `GAS_SCRIPT_ID` makes `npm run deploy:gas` a SILENT NO-OP.
- ⚠️ **Rotate the VM sudo password** and the **KKU SSO client secret** — both
  were exposed in chat transcripts (2026-08-07 / 08-08).

## Live proofs — run the one covering what you touch

All both-directional. `node tools/db-query.mjs tools/<x>.sql` for the SQL ones.
**Read `skills/write-a-guard.md` before writing or trusting any of them.**

- `authz-sweep-identity.sql` (23/23) — the identity boundary for anon AND an
  ungranted student. Run after ANY policy change on
  `users`/`people`/`students`/`team_members`.
- `shop0150-buyer-contact.sql` (10/10) — what a BUYER may change on their own
  order. **Its subject is MANUFACTURED** (an order cloned onto a real non-admin
  account inside the rolled-back transaction) because all six real orders belong
  to shop ADMINS, and `shop_orders_self_update_guard` returns early for an
  admin — a proof that picks a real order reports that a buyer may set the total
  to 1. The DENY half is what caught that.
- `pr0149-delete-permission.sql` (12/12, differential) — asks the DELETE POLICY
  and `soft_delete_pr_ticket()` the same question about a permission-only, a
  role-only and an ungranted subject, and fails if they disagree. Run it after
  touching either. Any OTHER definer RPC that restates a policy needs the same.
  Its commit-time half is `src/js/definer-authz.test.js`, which runs in
  `npm test`: no definer function may raise 42501 on the ROLE channel alone.
  The whole class was swept on 2026-08-12 — 0149 was the only live instance;
  the latent-but-unreachable ones are `docs/NEXT.md` §0c.
- `house0116-authz.sql` (8/8) · `house0144-delete-impact.sql` (18/18,
  differential) · `house0145-duplicate-person.sql` (6/6) ·
  `house0146-crest-refcount.sql` (6/6)
- `team0145-one-chan-pi.sql` (17/17) · `team0145-save-as-the-member.sql` (14/14)
- `node tools/house0132-registry.mjs` · `proj0092-seat-parity.mjs` (14/14) ·
  `team0135-name-split.mjs` (16/16) · `team0137-search.mjs` (14/14) ·
  `grant0093-reads.mjs` (15/15) · `team0143-photo-refcount.mjs` (5/5)
- **ALL of the above were re-run green at the end of 2026-08-10.** Two had to be
  repaired first, both for stale fixtures rather than regressions, which is the
  documented way a proof stops being read:
  `house0146` picked its control subject with `limit 1` and NO `ORDER BY`, then
  hardcoded the answer to 3 — a person with two ตำแหน่ง legitimately counts 4.
  `team0145-save-as-the-member` named the reporting account, whose ระบบบ้าน row
  has since been removed, so it reported `None` vs `-2` and read as a broken
  mirror. Both resolve their subjects from the data now and assert the
  precondition separately.

## OTHER SYSTEMS — stable, nothing owed

PR · VitalSound · News · Shop · หนังสือโครงการ · Analytics: unchanged. Write-ups
in `docs/state-archive/`; architecture in `docs/CONTEXT.md`.

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
- **Never hand-edit the mistakes index** — `npm run mistakes:index` generates it.
- **Never raise the context cap** when `npm run check:context` fails. Move detail
  into `docs/`.
- `.env.local` holds the Supabase PAT, the VM sudo pw, project-B DB creds.
- CI = Node 22. `npm run build && npm test` before every commit.

## NEXT-SESSION PROMPT (paste this after a /clear — updated 2026-08-12)

> **Read this file, then `skills/write-a-guard.md`.** Nothing is blocking and
> prod == main — deployed at the end of the session and the VM's HEAD read back
> (CURRENT DEPLOY above says how to confirm that in one command instead of
> trusting this sentence). The security item that used to live in agent memory
> is CLOSED (0147); its write-up is in `docs/mistakes/authz-rls.md`.
>
> **The SAMO Shop login question is DECIDED: both routes stay, the ORDER is
> hardened.** The owner asked whether shop customers should be Google-only. They
> should not — the checkout email field is editable even when Google prefills it,
> so restricting the login method buys the LOOK of a verified contact and none of
> it. What staff actually need is a reachable contact ON THE ORDER, so 0150 +
> the checkout recap solve it there. Do not revisit this as a login-method
> question; if contact reliability comes up again the next step is verifying the
> address (a confirmation mail that bounces), not narrowing the door.
>
> **Also shipped (2026-08-12, second half): 0149** — the owner reported
> that a ทีม SAMO member with the PR grant could read and edit PR tickets but got
> `42501 not authorized to delete PR tickets`. `soft_delete_pr_ticket` had
> hand-copied the DELETE policy from 0001 while 0014 had already added
> `has_permission('pr')` to it; the copy was stale the day it was written and
> survived 106 migrations because every tester holds the ROLE and the VS twin in
> the same migration was correct. DB-only, applied, nothing to deploy. The class
> was then swept end-to-end (definer functions, policies, and the JS gates) —
> that was the ONLY live instance; see `docs/NEXT.md` §0c for two latent ones
> that are deliberately unfixed and §0d for the one-predicate refactor worth
> copying next time that area is open.
>
> The one thing to know before you start: **the top item below is a decision
> waiting on the owner, not a task.** A demo was built and published for them to
> choose from; building the feature before they pick would be wasted work.
>
> ### 1. What is owed
>
> - **เกี่ยวกับเรา on mobile — WAITING ON THE OWNER'S PICK. Do not build yet.**
>   2026-08-12 the owner said the org chart "doesn't look good on mobile, the
>   width can only show one column" and asked to try 3D like
>   `vasturiano/3d-force-graph`'s tree example. A three-option demo on the real
>   398-person data is published (private artifact) at
>   `claude.ai/code/artifact/0c4533a8-099a-49c0-bf48-35173db32cc0`.
>   **Everything about it — the numbers, the rebuild pipeline, the open bug, the
>   recommendation — is in `docs/demos/about-3d/README.md`. Read that before
>   touching this, not this bullet.** The short version: measured on the live
>   site at 390px, แผนผัง is 108,726px tall (~130 screens) and a person card uses
>   ~35% of the width; a 4-column tile grid takes the same content from 64,419px
>   to ~19,900px (the demo measures both live, so the exact figure moves with
>   the frame width) and lands at ~1,250px with ฝ่าย collapsed. Recommendation given:
>   ship the 2D grid, treat 3D as an optional hero only. **Nothing in `src/` was
>   changed** — no `org-chart.js` / `org-chart.css` edits exist for any of this.
>   ⚠️ One bug is OPEN: the 3D frame still flickers while zooming, reported twice.
>   One real cause was found and fixed (auto-fit re-armed by every resize, and a
>   pinch resizes the visual viewport); something else remains. Four leads and a
>   repro note are in that README — and it needs a real touch device, since the
>   `touchmove` path never runs under a headless mouse.
> - **The signed-in browser pass, continued.** It started 2026-08-10 and
>   immediately found a bug nothing else could: the ยกเลิก button in EVERY
>   confirm dialog did nothing, because ESC worked and nobody clicks ESC.
>   **Keep driving the UI.** Clicked so far: ทีม SAMO member modal, the confirm
>   dialog, the sign-in modal (390/768 via headless CDP), the public org chart.
>   Still unclicked: VS staff modal, ประกาศ drafts, อาจารย์ signature queue,
>   Shop, mobile drag — `docs/NEXT.md` §1.
> - **ทีม SAMO restructure — DO NOT reparent ฝ่าย without reading this.** The
>   owner wants นายกฯ → อุปนายก → ฝ่าย and asked whether it affects สิทธิ์. It
>   does, severely. `node_effective_permissions()` climbs the parent chain while
>   `inherit_permissions` is true, and eleven nodes carry grants —
>   `นายกฯ {master}`, `อุปนายกฝ่ายดิจิทัล {master}`, `อุปนายกฯ {team_edit,house}`,
>   `อุปนายกฝ่ายบริหารองค์กร {samoshop,projects}` + a `vpa` seat, … Today those
>   อุปนายก nodes are LEAVES, so one person inherits each. **Simulated in a
>   rolled-back transaction: moving ฝ่าย PR/ComArt/IT under
>   อุปนายกฝ่ายดิจิทัล takes `master` from 3 people to 20** — 17 students
>   silently become full admins. Before any reparenting: move the grants onto
>   `team_members.permissions`, or set `inherit_permissions = false` on the ฝ่าย
>   being moved. Then re-run that simulation as a differential guard; it must
>   show BEFORE == AFTER.
> - `docs/NEXT.md` carries the rest: §0b three small UI things seen while
>   driving (`/admin/#team` on a COLD load, a stale "ไม่พบใคร" hint, 8 unexamined
>   ตรวจสอบข้อมูล findings), dropping the dead `team_members.year` / `people.year`,
>   and why `photo_reference_count` cannot widen past portraits yet.
>
> ### 1b. The public org chart (`/team`) — how it is built
>
> Two views over ONE renderer and ONE markup; only CSS differs. The wrapper
> carries `data-view`, and the toggle flips it WITHOUT re-rendering so open
> ตำแหน่ง and scroll position survive. **Scope every rule on `[data-view=…]`,
> never on a width** — the list rules were once inside a media query and
> silently stopped applying when the view became a user choice.
>
> แผนผัง fits 400 people through three measured decisions, all in the CSS block
> header: ONE SECTION PER ฝ่าย (as one chart it was 44,386px ≈ 30 screens,
> because the twelve ฝ่าย widths ADD); BRANCH SIDEWAYS ONCE, then reuse the
> vertical spine (branching at every level let the LEAF row set the width); and
> THE SPREADING ROW WRAPS, bounded to the viewport. ⚠️ `flex-wrap` alone did
> NOTHING — `.org-tree` is `width: max-content`, so the container always grows
> and the wrap point is never reached. A wrapping row must be BOUNDED.
> `justify-content` is `safe center`: plain `center` on an overflowing scroll
> container makes the start-side overflow unreachable.
> Result at 390 / 820 / 1024px: every section within ~13px of the viewport.
>
> The คณะกรรมการ grid is GONE on purpose — it rendered นายกฯ and the อุปนายก a
> second time at twice everyone's size, a duplicate AND a competing ranking.
> `is_board` still exists for the admin and my-seat's award icon. Card size is
> the same for everyone: **rank is position in the chart, not card size** — do
> not reintroduce a bigger card for heads, and do not detect heads from Thai
> title prefixes (the tree already orders them; position 0 under a ฝ่าย is the
> head).
>
> ### 2. Invariants that will bite you
>
> - **A control that changes WHICH ENTITY a row refers to is not an edit
>   control.** `pickPerson` reassigned a posting to another human with no
>   confirmation, and the mirrors turned that into a write across ทีม SAMO, the
>   registry and ระบบบ้าน — portrait included. When one widget serves ADD and
>   EDIT, ask what the click MEANS in each.
> - **A projection that feeds a form must carry every column the save writes**,
>   or the form composes one entity out of two (0148 — `search_people` had no
>   portrait, so the form described one person while holding another's face).
> - **`public.people` is the person registry.** `students.person_id` and
>   `team_members.person_id` are PLACEMENTS, both `ON DELETE SET NULL`. Both
>   mirrors are guarded by `is distinct from`, and **that guard is the
>   TERMINATION CONDITION**, not an optimisation. A mirror is only bidirectional
>   on the columns BOTH directions NAME. Run `node tools/house0132-registry.mjs`
>   before touching any of it.
> - **Deleting a นักศึกษา is two different deletes.** With a ทีม SAMO posting only
>   the house placement goes; house-only + never-signed-in + never-confirmed also
>   prunes the `people` row. `student_delete_impact()` (0144) is the only correct
>   way to tell them apart, and `house0144-delete-impact.sql` is DIFFERENTIAL
>   because the RPC restates `prune_orphan_person`'s conditions.
> - **`team_members` has NO unique key on kkumail, on purpose** — 82 people hold
>   2–4 ตำแหน่ง. A duplicate there is legal and silent, which is why เพิ่มสมาชิก
>   WARNS rather than blocks. `students.kkumail` IS unique, so ระบบบ้าน refuses.
>   Do not "fix" the asymmetry.
> - **Nothing may re-add a role branch to `users_read_all`** — `role` and
>   `permissions` share the row, so a full read is a map of who holds `master`.
>   Cross-user lookups go through `list_project_profs()` /
>   `list_project_seat_users()` / `search_people()`.
> - **ชั้นปี IS NOT STORED.** `src/js/study-year.js` computes it:
>   ปีการศึกษา − ปีที่เข้า + 1 + `year_offset`. `study-year.test.js` fails the
>   build on a `year:` key in ANY write payload. Never spread a row and overwrite
>   only `student_id` — call `yearBasis(stored, typed)`.
> - **A client-side count over an RLS-gated table is a fail-open** — RLS returns
>   ZERO ROWS, not an error. Count server-side.
> - **Deploy first, drop second.** 0129 dropped columns the SERVED bundle still
>   named and took ระบบบ้าน's admin tab down for 20 minutes.
> - **A TRASHED Drive file is still served publicly** by `lh3` (HTTP 200, real
>   image). "I deleted it and it still shows" is the CDN, not a stale row. Every
>   GAS delete revokes sharing first (`revokeAndTrash_`).
> - **`set_config(…, true)` is TRANSACTION-scoped** and `reset role` does not
>   clear it — a deny case after an impersonation helper can pass with the
>   previous identity still in place.
> - **`person_mirror_down` SAVES AND RESTORES `app.team_sync`, never blanks it.**
>   Blanking disarms the exemption for row 2 — visible only for members with more
>   than one ตำแหน่ง.
>
> ### 3. How this repo wants you to work
>
> - **The owner tests live and reports in bursts**, often against code shipped
>   hours earlier. Treat their message as the test pass this repo does not have.
> - **A fix on ONE path is not a fix** (class 4) and **prove it live in BOTH
>   directions** (class 7) — both are in the auto-loaded
>   `.claude/rules/mistakes.md`; not restated here on purpose.
> - **When a hazard has been paid for twice, the third fix is a TEST** — and
>   `skills/write-a-guard.md` says how to write one that is not blind to its own
>   hazard. Ratchets exist and every one found something:
>   `undefined-refs.test.js` · `native-dialog.test.js` · `upload-cleanup.test.js`
>   · `photo-retire.test.js` · `portrait-filename.test.js` (found a 4th bad call
>   site on its first run) · `confirm-modal.test.js` · `signin-screen.test.js`.
> - **Batch commits before deploying** — each VM deploy is ~90 s. A `tools/`- or
>   `docs/`-only commit needs no deploy.
>
