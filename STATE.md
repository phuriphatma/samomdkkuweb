# STATE — current task & latest known state

Last updated: 2026-07-25. Slim by design — "what is true right now". Full
per-deploy narrative of the prior session: `docs/state-archive/2026-07-24-full.md`;
chronology: `git log --oneline`; architecture/RLS: `docs/CONTEXT.md`; bug
post-mortems: `.claude/rules/mistakes.md`.

## CURRENT DEPLOY

- Prod host = KKU VM `samo.md.kku.ac.th` (pages.dev retired → splash-redirects).
- Live web = pushed `main` HEAD `20a0cb1`, **deployed to the VM** (VM HEAD matches;
  working tree CLEAN). Last code-bearing commit is `20a0cb1`; anything after it is
  docs-only, so a VM/STATE mismatch of one or two `docs(state):` commits is normal
  and does NOT mean a deploy is pending — check `git diff --name-only <vm>..HEAD`
  for anything outside `STATE.md` / `.claude/` / `docs/` before redeploying.
  Migrations 0081–0095 applied to the live DB. Verify a deploy
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

**Verification.** Eight self-provisioning proof scripts, each running in rolled-back
transactions, independent of live config — re-run after ANY change to these RLS
paths:
`tools/vs0083-scope.mjs` 16 · `tools/proj0086-seats.mjs` 21 ·
`tools/pass0087-scope.mjs` 10 · `tools/team0089-manage.mjs` 5 ·
`tools/proj0092-seat-parity.mjs` 13 · `tools/grant0093-reads.mjs` 15 ·
`tools/prof0095-seat-parity.mjs` 10 · `tools/vs0072-isolation.mjs` 23.
**113 checks total, all green.**
Sweeps worth re-running after any auth change (both in the /clear scan):
policy role-only sweep (expect exactly 3 deliberate: `users_update_staff`,
`notify_log`, `reserved_staff_usernames`), and the attribute-handler sweep
(`data-projects-role` / `data-admin-side` / `data-perm-only` values in the
markup vs. the JS that toggles them — see mistakes.md for the commands).
Not a test: `tools/proj-handover.mjs` (dry-run by default) transfers a SHARED
workflow account's uid-bound state — read state, and optionally the bell and
signature assignments — to a personal kkumail account during the migration.

**Shared → personal migration** and **passport enforcement** are pending work —
see NEXT #4 and NEXT #3. (`tools/proj-handover.mjs` moves read state; since 0095
an อาจารย์ seat needs NO sign-request handover to see the queue.)

**SAMO Shop is ONE role — the 0093 scope was REVERTED by 0094.** Every shop admin
manages every แหล่งที่มา; there is no per-source grant and the picker is gone.
`current_user_is_shop_admin()` is back to `role in (shop_admin,dev) OR
has_permission('samoshop')`, and `shop_products` writes are back on it. The
`shop_source` / `managed_shop_sources` COLUMNS remain but are inert — nothing
reads them. Drop them whenever (`alter table … drop column …`, listed in 0094's
header) and strip them from sync/recompute/users_self_update_guard. **Do not
re-add a source scope without being asked**: the reason it was declined is that
orders can't be scoped (one order holds items from several sources), so a
product-only scope isolates nothing anyone cares about.

**The READ half of the grant channel (0093 part B, KEPT).** Three policies gated
on `current_user_is_staff()` — a bare role list — excluded tree-granted accounts:
`announcements_read` (a `creator` grantee could WRITE a draft and not see it,
which is what broke เขียนประกาศ/ลำดับการแสดงประกาศ), `vs_followers` /
`vs_public_comments` (→ `current_user_is_vs_handler()`), and `analytics_events`
(→ new `current_user_has_any_grant()`). `current_user_is_staff()` itself was NOT
widened — `users_self_update_guard` trusts it for privileged-column writes, so
widening it would let any grantee self-promote to `dev`
(`tools/grant0093-reads.mjs` asserts this with a real attempt).
**Three role-only policies REMAIN BY DESIGN — do not "fix" them**:
`users_update_staff` (broadening it lets a grantee edit other people's rows),
`notify_log_select_staff` and `reserved_staff_usernames_read_staff` (internal
diagnostics / non-load-bearing reference data). Re-run the sweep after any RLS
change: flag policies matching `current_user_role|current_user_is_staff` that do
NOT also match `has_permission|managed_|_scope|_seats`; the expected count is 3.

**The อาจารย์ seat grants the อาจารย์ ROLE (0095, APPLIED).** Every prof gate used
to key on `sign_requests.prof_id = auth.uid()`, so a seat holder got a brand-new
professor with an EMPTY desk while `saprof` showed 11. อาจารย์ is one shared
institutional role (like เจ้าหน้าที่คณะ), so `prof_can_see_document/_project/_file`
+ the sign-request read/update policies + `scopeProjectsForRole` /
`docPendingSignForProf` / the file filter now ask "am I อาจารย์, and was this sent
for signature?". Verified: seat and saprof both see 11 of 26.
**Still NOT an actor** — the other 15 หนังสือ stay invisible, private drafts inside
a requested หนังสือ stay filtered, and a professor still cannot create a project or
request a signature. **Tradeoff**: every อาจารย์ sees every signature request. Right
for one shared role; if per-professor privacy is ever wanted, restore the uid check
PLUS a "which professor" dimension — a plain revert re-empties the seat.

**Public org chart (0086).** `team_nodes.is_public` (อาจารย์ + เจ้าหน้าที่คณะแพทย์ =
false). The flag is NOT the privacy boundary: `get_public_org_chart()` is a definer
PROJECTION (name/nickname/structure only, recursive so hiding a parent hides the
subtree) and is the ONLY sanctioned publisher. Never add a public SELECT policy to
`team_members` — anon reads 0 rows from it today and must keep doing so.

## NEXT — HANDOVER (nothing below is in flight; all of it is un-started)

Ordered by what will bite first. Everything named here is verified true as of
HEAD; the proof scripts and migrations referenced all exist and pass.

### 1. NOTHING from this session has had a signed-in browser run
Every server path is proven by the 8 scripts (113 checks), but no UI half was
exercised by a real login. Check these first — they are the likeliest place a
regression hides:
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

### 2. Passport `admin`/`1234` is STILL ENABLED — the scope is opt-in until it goes
While it works, ANY person with the password gets ทุกฝ่าย and the department
scope enforces nothing. To retire: set `LEGACY_PASSWORD_LOGIN = false` in
passport `js/admin-scope.js`, redeploy, confirm every admin can sign in with
Google, then delete the marked block, `handleLegacyLogin` in `admin-page.js`, and
`#admin-legacy-box` in `html/admin.html`.
**Passport admins today**: `putita.s@kkumail.com` (ทุกฝ่าย) and
`phuriphat.ma@kkumail.com` (ฝ่ายบริหารองค์กร only). Anyone else is locked out the
moment the flag flips — check with them first.

### 3. Passport RLS enforces NOTHING (the big one)
0087 gave passport an identity + scope; the `passport` schema still has 0056's
`using(true)` for anon. Proven live (rolled back): anon inserts an activity,
updates ALL 845 scans, reads all 593 profiles (name+email). So today's passport
admin scoping is a UI boundary a determined user steps around with DevTools.
Plan: `passport/SECURITY-HARDENING-PLAN.md` (separate repo, NOT applied). Its
policies must READ `public.passport_admin_context()` — do not let it invent a
second admin table. Still blocked on 4 answers: admin allowlist / bulk-scan path
/ `profiles.email` PII / cutover window.

### 4. Shared → personal account migration (partially done)
`tools/proj-handover.mjs` (dry-run by default) moves the uid-bound state a
permission grant does not.
- **DONE**: `sastaff → phuriphat.ma` read state (22 doc-view rows; verified 9/9
  unseen docs matching, 0 mismatches).
- **NOT done**: `samomdkkuvpa` (26 doc-view rows) and `saprof` (11).
- **CORRECTION to earlier guidance**: `--sign-requests` is NO LONGER needed for
  an อาจารย์ to SEE the queue — 0095 made the prof seat see every signature
  request regardless of `prof_id`. Only run it if you are retiring `saprof` and
  want the historical requests attributed to a real person. Read state
  (`project_doc_views`) is still worth handing over either way, or the new
  account's "อัปเดต" badges will not match the shared account's.
- Residual: `getDocSeenAt()` falls back to a localStorage map when the server has
  no row, so if the target account already browsed on that device a badge can
  still look wrong — clear site data there.

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

- `.env.local` holds the Supabase PAT, VM sudo pw, project-B DB creds — never commit.
- CI = Node 22 (supabase-js WebSocket). `npm run build && npm test` before every
  commit — 140 tests green at session end; isolation proof 23/23.
