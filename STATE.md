# STATE — current task & latest known state

Last updated: 2026-06-06. Slim by design — "what is true right now",
not a project diary. Session narratives live in `git log`; architecture
in `docs/CONTEXT.md`; bug post-mortems in `.claude/rules/mistakes.md`.

## Migrations through 0049 APPLIED — NONE pending

All migrations through **0049 are APPLIED** to Supabase (real project
`fheueuowbchsnsvbcgil`). SAMO Team: 0046 (tables) + 0047 (seed: 218 nodes,
351 member rows) + 0048 (realtime publication + replica identity full) +
0049 (year normalize). No pending migrations.

## SAMO Team management — SHIPPED to main (0046–0049 applied)

New admin section **ทีม SAMO** (sidebar `data-admin-side="team"`), gated to
`vp_admin` + `dev` via `userCanAccess('team')` (vp_admin default now
`['vs','team']`; dev all). Org tree: divisions → departments → roles → subroles
(unlimited depth via `team_nodes.parent_id`), people under each node.
- **Two toolbar modes** (segmented toggle) so the page stays uncluttered:
  `จัดการทีม` (roles + people) and `จัดการสิทธิ์` (permissions only). Permission
  chips + the perm editor only appear in perms mode; the node edit modal in team
  mode is just name + kind.
- Add / edit / move / delete nodes + members. Two move paths: **drag-and-drop**
  for fine reorder (SortableJS; cycle guard via `onMove` + `isAncestor`) AND an
  explicit **searchable destination picker** (`openPicker` in index.js +
  `#teamPickerModal`) — type-to-filter list of candidate parents/roles, select,
  confirm; excludes own subtree, "— ระดับบนสุด —" promotes to a root. Replaced
  the clunky 200-option `<select>`. The member modal's ตำแหน่ง field and the
  per-row member "ย้าย" both open the same picker.
- ชั้นปี stored as a bare number; the year chip renders "ปี N".
- **Multi-select** ("เลือกหลายรายการ" toolbar toggle): checkboxes on node + member
  rows, a sticky bulk bar → **ย้าย** (one picker moves all selected: nodes
  reparent, members reassign; excludes selected nodes' own subtrees) or **ลบ**
  (bulk delete; nodes cascade, members not under a deleted node deleted
  individually). Drag is disabled in select mode. Multi-drag was intentionally
  NOT used (nested-tree multi-drag is unreliable) — bulk move is via the picker.
- Member rows now show **kkumail** inline (no need to open the editor).
- Per-node app **permissions** (`pr/vs/samoshop/projects/creator/team`) with an
  **inherit** toggle, edited in the separate perms mode. v1 = **org metadata
  only** — NOT wired into live login access yet (chips: own=solid,
  inherited=dashed). Live-auth wiring is the scoped follow-up if wanted.
- Files: `src/js/team/{index,api}.js`, `src/html/tab-team.html`,
  `src/css/team.css`, registered in `admin/index.html` + `admin-main.js`
  (SECTION_META/SIDE_FEATURE/initTeam/enterTeamWorkspace).
- Seed pipeline: `tools/extract-team-seed.py` reads
  `externaldata/roledata.xlsx` (10 division tabs) + `previousroledata.json`
  (tree order) → `externaldata/team-seed.json` + `0047`. 37 xlsx roles with no
  JSON match (RT/MDI have no JSON roles + minor spelling variants) land as
  loose role nodes under their division — drag into place in the UI. Re-run:
  `python3 tools/extract-team-seed.py` (needs openpyxl).
- Mutations are optimistic (update model + render, then persist; reload+toast
  on write failure).
- **Live multi-editor sync** (`src/js/team/realtime.js`, migration 0048): Supabase
  Realtime postgres_changes on both tables → remote edits merge into the model
  and re-render (debounced 120ms; deferred while a drag is in progress to avoid
  cancelling the gesture). Last-write-wins, NOT character-level OT. Socket
  re-auths every 20 min (client autoRefresh off). Realtime node rows normalize
  `permissions` in case it arrives as a PG array literal. (No presence indicator
  — the channel stays open across admin sections, so a count would include
  people who left; removed as misleading.)
- Every team-mode node is **expandable** (even an empty leaf role) and an empty
  leaf role shows a dashed **drop placeholder** so you can drag a person into a
  role that has no members yet (previously impossible — no drop target existed).
- Perf: `attachSortables` skips lists inside collapsed (`d-none`) bodies
  (`inCollapsedBody`) — only visible drop targets get a SortableJS instance, not
  all ~2×N lists every render (was iPad jank on the 218-node tree).
- **Import / export** (`src/js/team/io.js`, pure + unit-tested): export full
  tree+people as JSON or members as CSV (BOM for Excel Thai); import JSON
  (append, new ids, parents-first) or members CSV (Thai header aliases; resolves
  `path` "ฝ่าย / แผนก / ตำแหน่ง", auto-creating missing roles when toggled).
  Import is additive (never deletes); sequential creates, so a big import is
  slow but safe. **Robust to messy input**: trims/collapses whitespace,
  normalizes ชั้นปี to a number, accepts loose `confirmed` spellings
  (true/TRU/yes/ใช่/เข้าแล้ว…) and flags genuinely ambiguous ones, validates JSON
  shape (aborts with a clear message; orphan nodes go to root with a warning),
  de-dupes within the file AND against existing rows (by kkumail, else
  name+student_id per node), validates email format — and shows a per-import
  **report** (added / updated / skipped-with-reasons / warnings) instead of
  failing on the first bad row. The import modal stays open so the report is
  reviewable. The **"เมื่อพบข้อมูลซ้ำ" select** offers three modes:
  **เลือกทีละรายการ (default)** opens a git-merge-style per-conflict resolver —
  each duplicate shows a เดิม→ใหม่ field diff with a เก็บเดิม/ใช้ใหม่ toggle (+
  bulk all-keep / all-replace); **ข้ามทั้งหมด** / **อัปเดตทับทั้งหมด** are the
  non-interactive shortcuts. CSV import is a read-only **plan** pass
  (`planMembersCsv` → creates/conflicts/identical/skipped) then **apply**
  (`applyPlan`); path resolution only mutates at apply time. Path separator is
  **" / " with spaces** — a slash touching letters (e.g. `Art/Graphic`) is part
  of the name, not a level break (`splitPath` splits on `/\s+\/\s+/`).
- The destination picker + import modal are **`modal-fullscreen-sm-down`** with a
  flex body (sticky search, the list scrolls) so they're clean on iPad/phone.


## President account + นายกสโม VS dept (this session)

- New account `samomdkkupresident` / `samo69president`, **role=dev** (full
  access, "permission like dev"), `department='นายกสโม'`. Provisioned via
  `tools/president-account.mjs seed` (CONFIRM=1) against real project. The
  service-role `.from('users').update({role})` is blocked by
  `users_self_update_guard` (auth.uid()=null → not staff), so the script
  re-seeds the row via select→delete→insert (no INSERT guard exists). See
  `mistakes.md`. **vp-accounts.mjs has the same latent block** if re-run.
- **นายกสโม** added as a VS target dept everywhere: form select
  (`tab-vitalsound.html`), dashboard filter (`tab-admin.html`), transfer
  modal (`modal-vs-staff.html`), and `DEPT_META` color/badge in `vs-staff.js`.
- VS dashboard: a super user (vs_staff/dev) with a `department` set now
  **defaults its dept filter to that dept on first entry** (president →
  นายกสโม) while the picker stays visible so they can still browse ทุกฝ่าย /
  any dept. One-shot via `staffDashboardEntered`; existing dev/SE have empty
  department → still default to ทุกฝ่าย (no behavior change). `vs-staff.js`
  `enterVSStaffDashboard`.

## Branches

- `main` HEAD: latest production. Auto-deploys to `samomdkkuweb.pages.dev`.
- `refactor/modular`: **in sync with main** (preview). Auto-deploys to
  `refactorsamomdkkuweb.pages.dev`. Both branches share an identical base — the
  historical big-bang `MERGE-CHECKLIST.md` risks (creds, dev GAS URLs) are moot;
  refactor→main merges are clean fast-forwards now.

## Recently shipped (pre-team, archived)

Stable applied work — full snapshot in `docs/state-archive/2026-06-06.md`,
authoritative history in `git log`:
- **Ticket soft-delete** (0043–0045): PR/VS delete is soft + recoverable via
  SECURITY DEFINER RPCs (null-role fail-closed). Restore = admin SQL.
- **Signup fixes** (0041 + 0042): unblocked new signups + resilient profile
  insert.
- **Discord → Cloudflare Pages Function** (`/notify`, `functions/notify.js`):
  all Discord proxies through one CF Function (kills the 1015 per-IP limit);
  GAS keeps Drive uploads + projects email only; `vssound.gs` deleted,
  `prform.gs` redeployed. Client serialises via `src/js/discord-queue.js`.
- **Samoshop per-item overhaul + admin UX** (0040): order status = payment
  phase, per-item `item_status`, multi-slip, customer_note, bulk order
  select/delete, stock-tab keyboard fix.

## Automation credentials (live, intentionally un-rotated)

User has **DECLINED rotating** the Discord webhooks + Cloudflare API token
(informed choice — don't nag). Instead, the working creds are stashed in
`.env.local` (gitignored) so automation runs across sessions:
`CLOUDFLARE_API_TOKEN` (Pages:Edit), `CLOUDFLARE_ACCOUNT_ID`,
`NOTIFY_DISCORD_PR_WEBHOOK`, `NOTIFY_DISCORD_PROJECTS_WEBHOOK`,
`NOTIFY_DISCORD_VS_WEBHOOKS` (11-dept JSON). `tools/set-notify-secrets.mjs`
reads these to re-PATCH Pages env vars on `samomdkkuweb` / `refactorsamomdkkuweb`.
**NEVER commit or echo these values.** They're live and un-rotated, so treat
`.env.local` as sensitive.

## Open follow-ups (not yet done)

- **Mobile login caveat** — if a phone genuinely evicts localStorage (not
  just slow restore), the boot-gate fix won't help; needs a real-device repro.
- **Migrations tooling — DEFERRED by user (don't re-raise unprompted).**
  Best practice = Supabase CLI with a tracked `schema_migrations` ledger
  (`supabase migration repair --status applied 0001..0045` to baseline the
  already-manually-applied files, then `db push`) + a CI job that replays
  migrations on a fresh Postgres + an optional `supabase/schema.sql` baseline.
  The numbered files themselves are fine (append-only, immutable — NEVER
  squash/rewrite applied ones). Current process = manual SQL-editor apply,
  applied-state tracked here in STATE. User will set up the CLI later.

## DB migrations status (Supabase `fheueuowbchsnsvbcgil`)

Apply in numeric order via the SQL editor. **All migrations through 0049
are APPLIED — none pending.** Full numbered history is in
`supabase/migrations/`; `git log` carries the per-migration context.

## Supabase config notes

- Authentication → Providers → Email → **Confirm email: OFF**. Flipping
  ON breaks signup at the project-wide email rate limit because every
  synthetic `<user>@samomdkku.app` bounces a verification email. See
  `mistakes.md` "Email confirmation must be OFF for synthetic emails"
  for the longer story + the implications for the profile email-add
  flow (`db.auth.updateUser({email})` writes immediately, ownership
  proof is the subsequent `linkIdentity` Google OAuth round-trip).
- Authentication → URL Configuration → Redirect URLs include both
  `https://samomdkkuweb.pages.dev/**` and
  `https://refactorsamomdkkuweb.pages.dev/**`.

## GAS (`appscript/prform.gs`) — Drive uploads + projects email ONLY

Post-cutover, prform.gs serves only Drive uploads (`uploadPRFile` /
`uploadShopFile` / project files+folders) + `notifyProjectEmail` (MailApp).
**All Discord moved to the `/notify` Cloudflare Function**; `vssound.gs` was
deleted. **prform.gs REDEPLOYED** (2026-06-06) — the live /exec now matches
the repo (Discord handlers gone). The `vssound` GAS project + `/exec` can be
deleted at leisure. The 1015 rate-limit problem is moot now (CF egress IP,
not GAS's shared one). Redeploy procedure: `skills/deploy-gas.md`.

## End-of-turn loop reminder

Every meaningful change should:
1. Update STATE.md if real state changed (branch HEAD, migrations,
   in-flight work, blocking issues). Don't append session narratives —
   `git log` is the archive.
2. Append to `.claude/rules/mistakes.md` if a new bug class was
   discovered.
3. Create / update `skills/*.md` if a repeatable workflow appeared.
4. Update README / docs/CONTEXT.md only if user-visible features,
   architecture, or build setup changed — skip for internal-only
   refactors / bugfixes / comment edits.

## Where to look next

| Looking for | Read |
|---|---|
| Project rules, file placement, end-of-turn loop | `CLAUDE.md` |
| Architecture, RLS, schema, deploy plumbing | `docs/CONTEXT.md` |
| Anti-patterns / bug post-mortems / sharp edges | `.claude/rules/mistakes.md` |
| API key hygiene | `.claude/rules/security.md` |
| Merge checklist (refactor → main) | `docs/MERGE-CHECKLIST.md` |
| Multi-step workflows | `skills/*.md` |
| Feature history | `git log --oneline --grep='<topic>'` |
| Who shipped what when | `git log --since=YYYY-MM-DD --oneline` |
| Earlier STATE.md snapshots | `docs/state-archive/*.md` |

## When STATE.md gets bloated again

If a future session balloons this file past ~200 lines, prune:

- Past session narratives → `docs/state-archive/YYYY-MM-DD.md` then
  rewrite STATE.md fresh.
- Big architecture write-ups → `docs/CONTEXT.md`.
- Reusable workflows → `skills/*.md`.
- New bug classes → `.claude/rules/mistakes.md`.
- Cross-conversation user facts → auto-memory under
  `/Users/xeno/.claude/projects/.../memory/`.

This file answers "what is true right now". Nothing else.
