# STATE — current task & latest known state

Last updated: 2026-07-29. Slim by design — "what is true right now". Full
per-deploy narrative of the prior session: `docs/state-archive/2026-07-24-full.md`;
chronology: `git log --oneline`; architecture/RLS: `docs/CONTEXT.md`; bug
post-mortems: `.claude/rules/mistakes.md`.

## CURRENT DEPLOY

- Prod host = KKU VM `samo.md.kku.ac.th` (pages.dev retired → splash-redirects).
- Live web = pushed `main` HEAD `397ff56`, **deployed to the VM** (VM HEAD matches;
  working tree CLEAN). Last code-bearing commit is `397ff56`; anything after it is
  docs-only, so a VM/STATE mismatch of one or two `docs(state):` commits is normal
  and does NOT mean a deploy is pending — check `git diff --name-only <vm>..HEAD`
  for anything outside `STATE.md` / `.claude/` / `docs/` before redeploying.
  Migrations 0081–0101 applied to the live DB. Verify a deploy
  by grepping the served shared `analytics-*.js` chunk (auth.js lives there) + the
  admin bundle for feature strings — NOT by hash (Mac vs VM hashes differ).
- Deploy method: `ssh samo-vm` → `cd ~/samo-projects/samomdkkuweb` →
  `./server/deploy.sh` (pull → `npm ci` → build → `sudo rsync dist/` →
  `/var/www/samo-web` → chown → restart notify → `nginx -t` + reload; also builds
  passport with `PASSPORT_BASE=/passport/`). `deploy.sh` uses BARE `sudo`, which
  needs a tty — run over `ssh -tt`, and prime the cred cache first in the SAME
  session: `printf '%s\n' "$PW" | ssh -tt samo-vm 'read -rs PW; echo "$PW" | sudo -S
  -v && ./server/deploy.sh'` (PW = `.env.local` `SAMO_VM_SUDO_PASSWORD`; a lone
  `sudo -S -v` without `-tt` primes nothing — deploy.sh's next `sudo` still errors
  "A terminal is required to authenticate"). Bundle content-hashes differ Mac vs VM
  (dep/Node deltas) — verify a deploy by grepping the served bundle for feature
  strings, not by hash-matching.
- One Supabase project `fheueuowbchsnsvbcgil` (web `public` + passport in `passport`
  schema). Migrations applied through `tools/apply-migration.mjs` (Management-API PAT).
  **To INVESTIGATE the DB, use `tools/db-query.mjs <file.sql>`, not
  apply-migration** — the latter truncates its echoed result at 2000 chars
  without saying so, which turns any introspection query (policy dumps,
  `pg_get_functiondef` sweeps, column lists) into a confidently wrong answer.
  Both run as the Postgres SUPERUSER: `auth.uid()` is null and RLS is bypassed,
  so to see what a REAL user sees you must `set_config('role', …)` +
  `set_config('request.jwt.claims', …)` inside `begin; … rollback;` — every
  `tools/*` proof script is built that way and is the template to copy.

## ทีม SAMO is the grant engine (0081–0088, ALL APPLIED + DEPLOYED)

The org tree grants REAL access. Full narrative: `docs/state-archive/2026-07-25-team-grants.md`.

**Model.** A node or member carries permissions plus, per feature, a SCOPE binding.
Everything resolves at login (`sync_my_team_permissions()`, called in `auth.js
buildCurrentUser`) and live on any tree edit (statement triggers), into
server-managed, guarded `public.users` columns:

| dimension | tree column(s) | users column | RLS helper |
|---|---|---|---|
| app perms | `permissions[]` | `managed_permissions[]` | `current_user_has_permission()` |
| VitalSound dept | `vs_dept` | `managed_vs_depts[]` | `current_user_vs_scope()` |
| หนังสือโครงการ seat | `project_seat` (vpa/staff/prof) | `managed_project_seats[]` | `current_user_project_seats()` |
| SAMO Passport | `passport_dept_id` / `passport_sub_dept_id` | `managed_passport_scopes[]` (`d:<id>`/`s:<id>`) | `passport_admin_context()` |

**The rule that keeps biting — SCOPED IS NOT FULL.** A blanket permission key
(`vs`, `passport`) is an unconditional OR-branch in RLS and swallows any narrower
check, so a scoped grant stores the BINDING and drops the key. Consequences already
paid for (all in mistakes.md): the UI must tick the checkbox from EITHER signal
(`permTicked()` — a miss silently wipes the grant on the next save); the scope
picker's index 0 must be a non-choice, never "ทุกฝ่าย"; and a new access channel
must be threaded through EVERY gate the old one used.

**Seats vs scopes.** `projects` is the exception: the seat does NOT drop the
permission, because there the seat picks WHICH of three workflows
(`projectSeatRole()` maps it to the role string the module already branches on).
`prof` is deliberately not a project actor.

**Verification.** Ten self-provisioning proof scripts, each running in rolled-back
transactions, independent of live config — re-run after ANY change to these RLS
paths:
`tools/vs0083-scope.mjs` 16 · `tools/proj0086-seats.mjs` 24 ·
`tools/pass0087-scope.mjs` 10 · `tools/team0089-manage.mjs` 5 ·
`tools/proj0092-seat-parity.mjs` 13 · `tools/grant0093-reads.mjs` 15 ·
`tools/prof0095-seat-parity.mjs` 10 · `tools/vs0072-isolation.mjs` 23 ·
`tools/vs0096-remark-vis.mjs` 37 · `tools/shop0100-buyer-guard.mjs` 12.
**165 checks total, all green.**
**`node tools/security-sweeps.mjs`** — three standing sweeps in one command,
each encoding a bug class already shipped. Run after ANY policy / RLS / definer
change. Exits non-zero on a finding; its allow-lists carry the deliberate
exceptions. Also `node tools/vs-remark-vis-mirror.mjs` (SQL↔JS ladder diff).
Still manual: the attribute-handler sweep (`data-projects-role` /
`data-admin-side` / `data-perm-only` values in the markup vs. the JS that
toggles them — commands in mistakes.md).
Not a test: `tools/proj-handover.mjs` (dry-run by default) transfers a SHARED
workflow account's uid-bound state — read state, and optionally the bell and
signature assignments — to a personal kkumail account during the migration.

**Shared → personal migration** and **passport enforcement** are pending work —
see NEXT #4 and NEXT #3. (`tools/proj-handover.mjs` moves read state; since 0095
an อาจารย์ seat needs NO sign-request handover to see the queue.)

**Settled grant-channel decisions (0093–0095)** — full write-up in
`docs/state-archive/2026-07-25-grant-channel-detail.md`. The three that a future
change must not undo:
- **SAMO Shop is ONE role** — the 0093 per-source scope was REVERTED by 0094
  (orders can't be scoped, so a product-only scope isolates nothing). The
  `shop_source` / `managed_shop_sources` columns remain but are inert.
  **Do not re-add a source scope without being asked.**
- **Never widen `current_user_is_staff()`** — `users_self_update_guard` trusts it
  for privileged-column writes, so widening it lets any grantee self-promote to
  `dev`. 0093 repointed the three affected READ policies individually instead.
  **Three role-only policies REMAIN BY DESIGN — do not "fix" them**:
  `users_update_staff`, `notify_log_select_staff`,
  `reserved_staff_usernames_read_staff`. The sweep's expected count is 3.
- **The อาจารย์ seat grants the อาจารย์ ROLE (0095)** — prof gates ask "am I
  อาจารย์, and was this sent for signature?", not `prof_id = auth.uid()`, so a
  seat holder sees the same 11 of 26 as `saprof`. Still NOT an actor. Tradeoff:
  every อาจารย์ sees every signature request.

**Public org chart (0086).** `team_nodes.is_public` (อาจารย์ + เจ้าหน้าที่คณะแพทย์ =
false). The flag is NOT the privacy boundary: `get_public_org_chart()` is a definer
PROJECTION (name/nickname/structure only, recursive so hiding a parent hides the
subtree) and is the ONLY sanctioned publisher. Never add a public SELECT policy to
`team_members` — anon reads 0 rows from it today and must keep doing so.

## VITALSOUND 0096–0099 · project_files seat parity (0097)

Full write-up: `docs/state-archive/2026-07-29-vs-remark-visibility.md`.
Shipped + deployed: the บันทึกข้อความ **visibility ladder**, the board's
**ความคืบหน้าจากทีมงาน** stream, **หมวดหมู่/แท็ก delete**, a **self_public**
board banner for a canonical's own submitter, VS **sub-state in the URL**, and
the staff ticket modal **no longer closing on save**.

**The invariants a future change must not break:**
- **The ladder** is `staff < ticket < thread < public`, normalized by
  `vs_remark_vis()` (SQL) and `remarkVis()` (`utils.js`) — **mirrors, keep them
  in step**. A missing `vis` reads as `ticket`, `internal:true` as `staff`.
  The server is the boundary: a submitter can never write above `ticket`.
- **`vs_tickets` has a column guard** (`vs_tickets_self_update_guard`, 0096).
  Without it a submitter PATCHes `is_public`/`public_title` and self-publishes
  to the board, routing around `vs_set_public()`. It fires ONLY when
  `auth.uid() = submitter_id` and the caller is not a VS handler, so server
  contexts are untouched. Column comparison is `to_jsonb(row) - allowed_keys`
  so a FUTURE column is guarded by default.
- **Both submitter read paths are sanitized server-side** —
  `get_my_vs_tickets()` and `get_vs_ticket_by_id()`. Never re-introduce a raw
  `select=…,remarks,…` owner read: `remarks` carries the canonical id in the
  TEXT of its 0071 internal entries.
- **An unresolvable `vs_categories` id fails CLOSED in all SEVEN readers**
  (0098 + 0099). หมวดหมู่ is deletable, so dangling ids are reachable. Re-run
  the audit as a QUERY after any change here — see mistakes.md for the exact
  `pg_get_functiondef` sweep.
- **`get_vs_linked_context()` is the ONLY sanctioned way** to tell a submitter
  about the board. Do not add `is_public`/`public_title` to the submitter
  projection — that is a second path to keep sanitized.

**Browser-verified (public half, Chrome, prod + local)**: mode↔hash both ways,
cold deep-load, back links, tab round-trip, the self_public banner, and
ความคืบหน้าจากทีมงาน rendering escaped — the full checklist is in the archive
write-up. **NOT browser-verified**: everything behind the admin login (see
NEXT #1).

## PRE-/CLEAR SECURITY SCAN (2026-07-29) — 4 real bugs found, all FIXED

Narrative + proofs: `docs/state-archive/2026-07-29-pre-clear-scan.md`. In short,
all four proven live in rolled-back transactions, fixed in `0100`/`0101`, and
each now carries a `mistakes.md` entry: a **buyer could zero their own order's
total** (third table with an unguarded per-row owner UPDATE, after `users` and
`vs_tickets`); **`get_pr_ticket_by_id` matched with `ILIKE`**, making the ticket
id a pattern instead of a capability; **the ten team resolvers were
anon-callable**, an anonymous grant oracle; and **the `vis` ladder's SQL and JS
implementations disagreed** on 3 of 26 inputs.

Two conclusions from that scan are still live constraints:

**Knowingly ACCEPTED, not missed** — two per-row owner UPDATE policies have no
column guard: `project_doc_views_update_own` (own read state; `user_id` pinned
by the check) and `project_notifications_update` (own bell rows — a user can
reword a notification only they can see). Both are self-defacement with no
cross-user reach. They are allow-listed in `tools/security-sweeps.mjs`; if that
sweep ever reports a THIRD, it is new.

**Not done**: no XSS re-audit of the anon-INSERTable tables this round (the
`escHtml` rule from mistakes.md). The renderers touched this session
(`updatesHtml`, `renderTimeline` chips, the board banner) do escape — verified
in-browser with an `<img onerror>` payload — but the older PR/VS renderers were
not re-checked.

## NEXT — HANDOVER (nothing below is in flight; all of it is un-started)

Ordered by what will bite first. Everything named here is verified true as of
HEAD; the proof scripts and migrations referenced all exist and pass.

### 1. Nothing behind the ADMIN LOGIN has had a signed-in browser run
Every server path is proven by the 10 scripts (165 checks). The PUBLIC half is
now browser-verified (see the VitalSound section); everything requiring a login
is not, because there is no way to authenticate from the agent session. Check
these first — they are the likeliest place a regression hides:
- **VS บันทึกข้อความ (0096)** — the visibility select in the staff ticket modal;
  a `thread` note written on a canonical must appear on a duplicate's tracking
  timeline tagged "จากเรื่องที่เกี่ยวข้อง"; a `public` note must appear in
  ความคืบหน้าจากทีมงาน on the board (separate from comments).
- **VS staff modal (0099 UX)** — บันทึกข้อมูล must now KEEP the ticket open,
  repaint its timeline, and show "บันทึกแล้ว" inline in the footer.
- **VS จัดการหมวดหมู่ / จัดการแท็กภายใน** — ลบ works, its confirm names the
  usage count, and a newly ADDED หมวดหมู่ is immediately selectable in the open
  ticket without closing it.
- **อาจารย์ (0095)** — `phuriphat.ma@kkumail.com` holds the `prof` seat and must
  now see the SAME 11 หนังสือ as `saprof` (26 exist; 11 carry a signature
  request). If it shows 0, the seat resolution broke, not the RLS.
- **SAMO Shop (0094)** — unscoped again for everyone; the ทีม SAMO picker should
  have NO แหล่งที่มา field.
- **ประกาศ (0093B)** — a `creator` grantee must see their own drafts/pending in
  เขียนประกาศ + ลำดับการแสดงประกาศ (before 0093 they could write and not read).
- **Admin account switch** — switching accounts must hard-reload `/admin/`.
- **Public article แก้ไข/ลบ** — now `data-perm-only="creator"`; a tree-granted
  creator should see them, a plain user should not.
- **Passport** — the Google sign-in round-trip and the dept-scoped admin view.
  This is the one I could not test at all (no way to drive OAuth from here).

### 2. Passport `admin`/`1234` — a deliberate TEMPORARY second door, not a bug
**The intended model, confirmed by the user 2026-07-30**: whoever holds the
`passport` permission (or a dept scope) in ทีม SAMO is a passport admin. That is
exactly what `public.passport_admin_context()` implements — `is_admin` = blanket
`passport` perm or `role='dev'` (→ `all_departments: true`) OR any
`managed_passport_scopes` entry; null `auth.uid()` fails closed. Nothing to
change here.

`admin`/`1234` is a knowingly-temporary alternate entrance to be removed later.
To retire it: `LEGACY_PASSWORD_LOGIN = false` in passport `js/admin-scope.js`,
redeploy, confirm every admin can sign in with Google, then delete the marked
block, `handleLegacyLogin` in `admin-page.js`, and `#admin-legacy-box` in
`html/admin.html`.
**Who keeps access when that flag flips** (live, 2026-07-30 — the previous note
here said 2 people and was STALE):
- ทุกฝ่าย: `kita.a@kkumail.com`, `putita.s@kkumail.com`, `worapat.c@kkumail.com`
- dept-scoped `d:1`: `jinjutha.t@kkumail.com`, `phuriphat.ma@kkumail.com`

Re-run the check before flipping — the tree changes:
`select email, managed_passport_scopes, managed_permissions from users where
'passport' = any(managed_permissions) or managed_passport_scopes <> '{}';`

### 3. Passport RLS enforces NOTHING — this is NOT about who is an admin
Distinct from #2, and easy to conflate with it. The grant channel is correct; the
DATABASE enforces nothing on anyone. The `passport` schema still carries 0056's
`using (true)` for `anon`, so with the anon key that ships in the bundle, ANY
visitor — signed in or not, admin or not — can do what was proven live (rolled
back): insert an activity, update ALL 845 scans, award themselves arbitrary
points, read all 593 profiles incl. name + email. So the ทีม SAMO dept scope is
today a **UI** boundary that anyone who opens DevTools steps around. Retiring
`admin`/`1234` does not help — the hole is below the login.

Plan: `passport/SECURITY-HARDENING-PLAN.md` — NOT applied, and **local to this
Mac only**: it is excluded via the passport repo's `.git/info/exclude`, so it is
NOT in a fresh clone and not on the VM. Deliberate (it describes a live, unfixed
hole in a repo that has been pushed to GitHub) — keep it that way; if it must be
shared, hand it over out-of-band rather than committing it.
It predates 0087 and proposed a `passport.admins(user_id)` table — **do not build
that**; `passport.is_admin()` must read `public.passport_admin_context()` so the
tree stays the single source of truth. §2, §3.1 and §7 were rewritten
2026-07-30 to say so, and §3.1 now carries the wrapper + a
`passport.admin_covers_dept(int)` helper for the per-ฝ่าย policies.

Of the plan's 4 open questions, **2 are answered**:
- *Admin list* → the ทีม SAMO grant (above). No second table, no seed list.
- *Bulk scan-insert path* → **none exists.** The only INSERT into `scans` is the
  interactive `js/scanning.js:131`; everything else reads. So `scans_insert` can
  be fully closed behind the `stamp_scan()` definer RPC.

**Still needs a decision (2)**: whether the admin leaderboard keeps showing
student **email** — it is the ONLY reader of `profiles.email`
(`admin-page.js ensureLbScans`, rendered at :1730 and CSV-exported at :1741).
Keeping it means the leaderboard must move to a definer RPC that scope-filters
server-side (a plain policy cannot express "profiles referenced by in-scope
scans", since `profiles` has no department); dropping it allows a simple
self-or-admin policy. Plus: any live event window to avoid for cutover.

### 4. Shared → personal accounts: the AUTHORIZATION is DONE — only read-state cosmetics remain
**The intended model, confirmed by the user 2026-07-30**: a ทีม SAMO seat IS the
shared account's role. `เจ้าหน้าที่คณะ` ≡ `sastaff`, `อาจารย์` ≡ `saprof`,
`ผู้ส่งหนังสือ` ≡ `samomdkkuvpa`. **That is what ships** — `projectSeatRole()`
maps the seat to the role string the module branches on, `current_user_project_seats()`
carries it into RLS, and 0095 made the อาจารย์ seat see the same signature queue
as `saprof` rather than a per-uid subset. A seat holder needs NO migration to do
the job. Earlier notes framed this as a pending "migration", which overstated it.

The ONE thing a grant cannot carry is per-user state, and neither piece affects
access:
- `project_doc_views` — which documents *you personally* have opened, i.e. the
  "อัปเดต" badge. Live: `samomdkkuvpa` 28/28 docs, `sastaff` 25, `saprof` 11,
  `phuriphat.ma` 22 (from the one handover already run).
- `project_notifications` — historical bell rows addressed to the shared
  account's uid. NEW notifications already reach seat holders (0091
  `list_project_seat_users`).

So `tools/proj-handover.mjs` is **optional badge parity**, worth running only
when RETIRING a shared account and you want day-one badges to match it. Skip it
and the first-run BASELINE marks everything seen — the sane default for someone
joining today. `--sign-requests` is NOT needed for an อาจารย์ to see the queue
(0095); run it only to re-attribute history away from `saprof`.
Residual if you do run it: `getDocSeenAt()` falls back to a localStorage map when
the server has no row, so a badge can look wrong on a device the target already
browsed on — clear site data there.

### 5. Inert columns from the reverted shop scope
`team_nodes.shop_source`, `team_members.shop_source`,
`users.managed_shop_sources` exist and NOTHING reads them (0094 reverted the
feature). Drop statements are in 0094's header; after dropping, also strip them
from `sync_my_team_permissions`, `recompute_team_managed_permissions`,
`users_self_update_guard` and `current_user_has_any_grant`, which still name
them. Left in place because dropping columns is destructive and was not asked
for. **Do not re-add a SAMO Shop source scope without being asked** — it was
declined because orders cannot be scoped (one order holds items from several
sources), so a product-only scope isolates nothing.

### 6. Watch-outs a future change must not break
- **0095 tradeoff**: every อาจารย์ now sees every signature request. Correct for
  one shared role; the day per-professor privacy is wanted the fix is the uid
  check PLUS a "which professor am I" dimension — a plain revert re-empties the
  seat.
- **Never widen `current_user_is_staff()`** — `users_self_update_guard` trusts it
  for privileged-column writes, so widening it lets any grantee self-promote to
  `dev`. `tools/grant0093-reads.mjs` asserts this with a real attempt.
- **`tools/vp-accounts.mjs`** still does a plain `.update({role})` and will hit
  `users_self_update_guard` if re-run — port the select→delete→insert fallback
  from `tools/president-account.mjs` first (see mistakes.md).

### 7. Not started
- **Org-chart renderer** — `get_public_org_chart()` exists (a definer PROJECTION,
  the ONLY sanctioned publisher); no UI consumes it.
- **Notify follow-up (b)** from the notify_log entry in mistakes.md:
  `waitUntil`-deliver + immediate 202, so delivery is decoupled from the client
  connection. Changes the callGAS success-echo contract — do it together with
  making `notify_log` the source of truth for failures.
- Passport repo has untracked `AGENTS.md` + `.agents/` (not mine, left alone).

## PR + VITALSOUND — stable, pruned to the archive

Both shipped and deployed (PR ฝ่าย single-source-of-truth `src/js/pr-depts.js`;
VS service desk + public board, migrations through 0080). Full write-up incl. the
VS confidentiality invariants: `docs/state-archive/2026-07-25-pr-vs.md`.

## OTHER SYSTEMS (stable; details in archive + CONTEXT.md)

- **PR / News / Shop / Projects / Analytics**: unchanged this session. Shop = Model A
  shared admin (0057/0058); projects ปีงบ filter; analytics strip + staff dashboard live.
- **Passport** (separate repo `phuriphatma/samomdkkupassport`, same Supabase project,
  `passport` schema): kkumail-only gate live; 5 gmail→kkumail migrations verified;
  awaiting students' replies at mdstuddata.beta@gmail.com. Dev test still ACTIVE
  (pmphuriphat→phuriphat.ma) — revert SQL in `docs/state-archive/2026-07-24-full.md`
  ("ACTIVE TEST STATE"). Old project B `idwlabpbwiwgaoqwbozz` paused as cold backup —
  rotate its DB password (in `.env.local`) before deleting.
- **notify**: `/notify` Node service on the VM; `notify_log` (0055) recording;
  `main` branch protected (1 approval; owner ff-push exempt).
- Retention jobs NOT scheduled (`prune_analytics`, `prune_notify_log`) — run manually
  if tables grow.

## Housekeeping

- **`.claude/rules/mistakes.md` pruned (2026-07-30): 2340 → ~2040 lines, 74 → 58
  entries.** 16 STABLE + NICHE entries moved to `.claude/rules/mistakes-archive.md`
  (17 → 33 entries) — settled auth/signup config facts, one-off SQL gotchas, and
  UI quirks whose code path no longer changes. Nothing deleted. Two additions
  make the split safe to rely on:
  - the hot file's header now names the **five recurring classes** (per-row
    UPDATE ≠ column policy · unknown-reference fails open · scoped-is-not-full ·
    read authorization is per-path · mirrors drift) as a read-these-first list;
  - it carries a **by-area index of what is in the archive**, so a symptom whose
    entry moved is still greppable from the hot file. Keep that index in step
    when you move the next entry.
  Still ~2040 lines: the remaining bulk is entry VERBOSITY, not entry count, and
  every kept entry is either one of the five classes or on the auth/db hot path.
  Trimming prose is the next lever if it needs to shrink again.

- **STATE.md is 377 lines against CLAUDE.md's ~200 budget.** It went 336 → 321 by
  archiving narrative, then back up to 377 because NEXT #2/#3/#4 had to be
  REWRITTEN (they described work that is already shipped — see `git show d44565b`).
  That is the right trade: a wrong handoff costs more than a long one. The
  2026-07-29 scan narrative moved to
  `docs/state-archive/2026-07-29-pre-clear-scan.md` and the VS browser-verified
  checklist is now a pointer (it was duplicated verbatim in the 07-29 archive).
  It does not get much shorter without gutting `NEXT`, which is 140 of those
  lines and is the actual handover. Prune `NEXT` items as they are COMPLETED,
  not to hit the number.

- `.env.local` holds the Supabase PAT, VM sudo pw, project-B DB creds — never commit.
- CI = Node 22 (supabase-js WebSocket). `npm run build && npm test` before every
  commit — 140 tests green at session end; isolation proof 23/23.
