# STATE — current task & latest known state

Last updated: 2026-08-05. **577 → 272 lines this session** — past-session
sections pruned to `docs/state-archive/2026-08-04-shipped.md`, the un-started
backlog moved to `docs/NEXT.md`. Keep it under ~200; it is read on every cold start. Slim by design — "what is true right now". Shipped
detail pruned out of here most recently:
`docs/state-archive/2026-08-04-shipped.md` (the GAS/Drive migration, the
article-cover fix and the earlier shipped list),
`docs/state-archive/2026-07-31-team-0104-detail.md` and
`docs/state-archive/2026-07-30-pre-clear.md`; earlier narrative:
`docs/state-archive/2026-07-24-full.md`;
chronology: `git log --oneline`; architecture/RLS: `docs/CONTEXT.md`; bug
post-mortems: **`docs/mistakes/*.md`** (indexed by `.claude/rules/mistakes.md`
— see Housekeeping at the bottom; the corpus moved out of `.claude/rules/` on
2026-08-05 and the archive file is gone).

## Org chart collapse + "ตำแหน่งของฉัน" (2026-08-05 — SHIPPED to prod)

**LIVE.** `main` at `12f93e3` (+ a follow-up commit for the proof scripts),
pushed; KKU VM deployed and verified **against the SERVED bundle**
(`buildId ff617f917f9b`). Behaviour re-run against `https://samo.md.kku.ac.th/team`
in headless Chrome — identical to local. 279 tests green; every proof script in
`tools/` green.

**Rendered and driven in a real browser this time** (the previous session could
not). No Chrome extension — the extension was not connected — so it was done
with headless Chrome + CDP over a raw WebSocket:
`/private/tmp/.../scratchpad/cdp.mjs` in that session. Node 22 has a global
`WebSocket`, so a ~40-line driver gets navigate / evaluate / screenshot with no
dependency. Worth rebuilding if you need to SEE a change; `--dump-dom` alone
cannot click.

- **โครงสร้างองค์กร is now an accordion.** It rendered all 279 ตำแหน่ง / 402
  people at once — **63,912px** measured; collapsed it lands at ~3,000px. Each
  root ฝ่าย is a card showing its subtree counts ("65 ตำแหน่ง · 81 คน").
  ARIA accordion pattern (heading wraps button). Toggling mutates the DOM, it
  does not re-render — a repaint would drop the scroll position.
  **Collapsed bodies use `hidden`, deliberately NOT a `0fr` height animation:**
  that is what stops 400 lazy portraits being fetched for branches nobody opened.
  A ตำแหน่ง with ≤3 people and no children stays inline (106 hold exactly one).
  Search results are always fully expanded with no toggles. Station rows are a
  named CSS **grid** — flex-wrap stranded the count pill and the chevron on
  their own lines at 390px.
- **ตำแหน่งของฉันในทีม SAMO** — new card under the home greeting and in the
  โปรไฟล์ modal. A ทีม SAMO grant used to be invisible to the person holding it.
  Fed by `public.get_my_team_seat()` (migration **0109**, applied): definer,
  **takes NO argument** so identity comes from `auth.uid()` and it cannot be
  aimed at anyone else; hand-built jsonb allow-list, never `returns setof`.
  Proof: `tools/seat0109-my-seat.mjs` (17 checks, incl. anon refused over real
  HTTPS and "the payload carries no other person's kkumail / รหัส").
  The CTA respects the door it opens: a `passport`-only grantee is sent to
  `/passport/`, not `/admin/`, which would bounce them (`ADMIN_FEATURES`).
- **`src/js/team-vocab.js` is new** — PERM_CATALOG / VS_DEPTS / PROJECT_SEATS /
  ADMIN_FEATURES moved out of the admin-only `team/index.js` + `admin-main.js`
  so the public card names things the same way. Behaviour unchanged on both
  sides; the user asked for **no changes to the admin ทีม SAMO UI** and there are
  none.

**Two bugs found by the scan, both now in `.claude/rules/mistakes.md`:**
1. `revoke ... from public` did NOT strip the `authenticated` grant that this
   database's DEFAULT PRIVILEGES hand every new function — **in the `public`
   schema, not just `passport`**. `team_node_path` shipped world-callable on the
   first apply. Verify ACLs from `pg_proc.proacl`, never from the migration text.
2. Two proof scripts were failing/mis-reporting for CORRECT reasons
   (`prof0095` assumed the probe account is never a named `prof_id`; `seat0109`
   substring-matched a placeholder `kkumail = '-'` against uuids). Both fixed.

**Known, NOT fixed — needs the user's call:**
- **`ฝ่ายเอิงtest` is live on the public org chart** (root ฝ่าย, 7 ตำแหน่ง,
  5 people, one ตำแหน่ง literally named `hi`). It is test data visible to the
  world at `/team`. Deleting it is a data change in ทีม SAMO, so it was left
  alone — ask before removing.
- One `team_members` row carries `kkumail = '-'` (ชญาภา เลาหะตานนท์). Harmless
  today; ตรวจสอบข้อมูล should be showing it.

## Release notes + versioning + the IT panel (2026-08-04 — SHIPPED to prod)

**LIVE.** `main` at `28fa020`, pushed; tag `v4.4.0` pushed; KKU VM deployed and
verified against the SERVED bundle (`buildId 9f65ec53b172`, `/build.json` now
reports `{"buildId":…,"version":"4.4.0"}`, `/updates` → 200). 265 tests green.

**STILL NEVER RENDERED IN A BROWSER BY AN AGENT** — the Chrome extension was not
connected for this whole session, so every layout/animation decision was
reasoned about and unit-tested, never seen. The user reviewed it by screenshot
and caught one thing tests cannot (the sticky bar reading as a cut-off
rectangle). If anything looks wrong on `/` or `/updates`, that is why.

- **`/updates`** — the public changelog. Content is `src/data/changelog.js`
  (22 curated releases, 2026-04-30 → 2026-08-01, condensed before July because
  that stretch ran ~13 commits/day). Reached from the footer's เกี่ยวกับเรา
  column and from the version chip in the footer bar; off-tablist tab like
  `pills-article-tab`, path route `/updates` in `PATH_ROUTES`.
- **A real version system — `docs/VERSIONING.md` is the policy, read it first.**
  `MAJOR.MINOR.PATCH` with MAJOR redefined as "the portal's SCOPE changed"
  (SemVer's "breaking API change" can never fire on a website, so it would pin
  us at 1.x forever). 4 majors / 18 minors → **current v4.4.0**, assigned
  retroactively. `npm run release` derives the bump from Conventional Commits,
  drafts the changelog stub, and optionally tags; it never pushes.
  `v4.4.0` is tagged LOCALLY and **not pushed** — push it when you next push.
  `package.json` is the single source of truth; `/build.json` now carries
  `{buildId, version}` and `__APP_VERSION__` is defined at build time.
  Tests enforce that each bump matches its tier and that package.json agrees.
- **"เบื้องหลังการพัฒนา"** on the landing page (`#devActivity`) — THREE tiles
  (7 ระบบ · 22 เวอร์ชัน · 14 สัปดาห์) over a timeline of when each system opened
  (`SYSTEMS` in `src/data/changelog.js`). A fourth tile ("91 รายการที่อัปเดต")
  was removed: the user twice said it communicated nothing, and they were right
  — a count of changelog bullet points is a number only we can judge. The
  version and last-update date moved into the lead sentence instead.
  **Home order is deliberate and was set by the user**: banner → sign-in →
  ประกาศ → เบื้องหลังการพัฒนา → สถิติการใช้งาน → quick actions.
- **Two claims are BANNED from the panel and both have guard tests.** (1) No
  "100% built in-house / ไม่ได้จ้าง" — this project is built with AI assistance
  and the claim overstated it; the user asked for it gone. (2) No cadence
  promise ("ทุกสัปดาห์") — real gaps run to weeks. Credit line reads
  **"ดูแลโดย IT SAMO'69"**, not individual names.
- **Thai copy — four rules the user gave, learned the slow way over ~5 rounds.**
  (1) No literal translations of English idiom: "SAMO Portal ในตัวเลข" (from "by
  the numbers") and "ชุมชน…ที่กำลังเติบโตและให้บริการทุกวัน" both read as AI
  output. (2) **Professional register, not casual** — "เว็บนี้ยังพัฒนาต่อเรื่อย ๆ"
  was rejected; think professional web agency. (3) **Do not mix languages inside
  one group** — a row reading "22 เวอร์ชันทั้งหมด / 4 Major release" is the
  complaint; the changelog hero is now all-English (Releases · Major releases ·
  Changes · Weeks) because its eyebrow already says "Release notes", while the
  landing panel stays all-Thai. (4) `LEVELS` labels stay English
  (Major/Minor/Patch) — "รุ่นใหญ่/รุ่นย่อย" is a translation nobody says.
  **I cannot reliably judge natural Thai — get the user to read new copy.**
  Every string I own is listed in the git log for this session's final commit.
- **`npm run check:icons` is new — run it before using a Bootstrap icon.**
  `bi-passport` / `bi-passport-fill` / `bi-envelope-arrow-up` were all added in
  bootstrap-icons **1.11** and both entries pin **1.10.5**, so they rendered as
  empty boxes — silently, for months, in the ทีม SAMO permission modal and the
  profile "รอยืนยัน" badge. A missing glyph is not a 404 and not a console
  error. Full write-up in `.claude/rules/mistakes.md`. Passport now uses a
  plane, which is both correct and on-theme ("Life is a Journey").
- **`SYSTEMS` dates are LAUNCH dates.** SAMO Passport was first dated 2026-07-22
  — the day its DATABASE merged into this project, which no student experienced.
  Its real launch is 2026-05-12, in its own repo
  (`phuriphatma/samomdkkupassport`, cloned at `~/development/samodevmdkku69/passport`).
  Every other entry was verified with `git log --diff-filter=A` on the module or
  migration that introduced it. **Known gap:** Passport's launch has no release
  entry in `changelog.js` — adding one means renumbering every version after it,
  so it was left for a deliberate pass.
- **The sticky filter bar on `/updates` is a FLOATING ROUNDED bar**, matching
  `.samo-navbar`. A plain white rectangle inside the 900px column reads as "a
  rectangle that got cut off" (the user's words) because its hard edges stop
  mid-page against the body gradient. Full-bleed was the other fix and was
  REJECTED: it needs `overflow-x: clip` to contain the width, which older iOS
  Safari does not support and would degrade to a horizontal scrollbar. It is
  also opaque, not frosted — blur over the green spine went muddy.
- **`npm run gen:activity`** regenerates `src/data/dev-activity.json` from git.
  Not wired into `build` on purpose. `--check` fails when stale. It publishes
  **no email addresses** (repo is public, JSON is bundled) — a test asserts it.

**The first version of the panel was wrong and was rebuilt — do not put it
back.** It showed commits (549), active days, lines added/deleted, longest
streak and a GitHub-style commit heatmap. The user's objection was correct and
is the general rule: those measure EFFORT, not outcome; lines-of-code and commit
counts are discredited even inside engineering; and to a SAMO member a dense
heatmap of nights and weekends reads as grinding, not competence. The panel now
measures what exists that did not exist before. `changelog.test.js` has a guard
test ("publishes no effort metrics") that fails if any of it creeps back.
The heatmap data is still generated (a few KB, the honest record) and the
validated 5-step green ramp is preserved in git history if it is ever wanted for
an internal-only page.

**Still needs a human, same reason as the item below:** the Chrome extension was
not connected, so none of this has been rendered. Check on `/` and `/updates`:
the launch timeline flips from a vertical spine to a horizontal track at 768px
and the connecting line lands on the nodes in both; the changelog hero aurora
does not bleed sideways (it is margin-negative to full-bleed past
`.container-fluid px-4`); the sticky filter bar's sliding pill sits under the
active button after a resize; and the per-release spine segments join up rather
than leaving gaps.

## ทีม SAMO — shipped 2026-08-01, still true

Crop-on-upload, stacked modals, real Drive photo deletes (a REFCOUNT — an
archived year shares the live photo's file id), and the ตรวจสอบข้อมูล pane
(24 findings, flags WHO on each member row and rolls counts up the tree).
Migration **0108 `team_people`** is applied but EXPAND-ONLY: nothing reads it,
all ten resolvers still join `team_members.kkumail`.

**The rule that governs it: kkumail is the identity, รหัสนักศึกษา is a field.**
Never merge on name — `673070332-6` is one mistyped รหัส shared by two humans.

**0108's contract step is still owed, and its first job is the INSERT gap:**
`createMember` and the CSV import write `person_id = null`, so rows added since
0108 are already unlinked. Fix with a BEFORE INSERT trigger or re-run the
(idempotent) backfill. Full reasoning: `docs/state-archive/2026-08-01-team-identity.md`.

## NEXT — hardening `notifyProjectEmail` beyond the allow-list

The recipient allow-list closes the broad case. What it does NOT constrain is
the **content**: `subject` and `htmlBody` still come from the caller, so the
endpoint can still be made to send an arbitrary-looking message to an allowed
address, and repeated calls still consume the MailApp daily quota that the real
notifications depend on. Ranked options, best first:

1. **Template the content server-side** (recommended, cheapest). Stop accepting
   `subject`/`htmlBody`; accept structured fields (doc id, action, actor) and
   render them into a fixed template in `prform.gs`, escaping the values. The
   caller then chooses only *what the notification is about*, never its wording.
   No new OAuth scope, no re-consent, no infrastructure. Touches
   `src/js/projects/notify.js` and the GAS handler together.
2. **Move email off GAS entirely**, to the `samo-notify` service on the VM —
   the same move already made for Discord, and for the same reasons. A Node
   service can hold a real secret and verify a Supabase JWT cheaply, which GAS
   cannot do without widening its scopes. Leaves GAS doing only Drive.
3. **Add the caller-identity gate** (`requireSupabaseUser_`, already written and
   reverted — see the GAS section). Requires the owner to re-consent FIRST.
4. **Rate-limit per hour** via `CacheService` in GAS. Protects the quota only;
   does nothing about content. Cheap, but do not add it untested at the end of a
   session — a wrong threshold silently drops real notifications.

1 + 3 together would leave very little: a fixed recipient set, templated
wording, and a signed-in caller.

## CURRENT DEPLOY

- Prod host = KKU VM `samo.md.kku.ac.th` (pages.dev retired → splash-redirects).
- **samoweb**: `28fa020`, **deployed 2026-08-04**, `buildId 9f65ec53b172`.
  Latest change: public release notes at `/updates`, the `MAJOR.MINOR.PATCH`
  version system (**v4.4.0**, tag pushed), and the เบื้องหลังการพัฒนา panel on
  the landing page. Verified against the SERVED artifacts: `/build.json` returns
  `{"buildId":"9f65ec53b172","version":"4.4.0"}`, `/updates` → 200 carrying
  `id="clList"` / `id="devActivity"` / `cl-hero-aurora`, and `IT SAMO` appears
  twice in `/assets/public-*.js`. The 2026-08-01 ทีม SAMO deploy (`28c757c`,
  `buildId e74de393eebd`) is included in this one.
- **passport** (separate repo): code `b57eb1e` **deployed 2026-07-30** (pulled
  + built by `deploy.sh` alongside samoweb). Served bundles
  verified by grep: `stamp_scan` in the scan chunk, `leaderboard_names` in
  dashboard, `admin_leaderboard` + the shared-admin email in admin,
  `sb-passport-legacy-admin` in the shared chunk, and no `from('scans').insert`.
- Migrations: samoweb `public` 0081–**0108**; passport `db/0010` + `db/0011` + `db/0012`
  ALL applied — passport authorization is now enforced server-side (NEXT #3).
- Verify any deploy by grepping the served bundle for feature strings — NOT by
  hash (Mac vs VM hashes differ). For samoweb the shared `analytics-*.js` chunk
  carries auth.js.
- Deploy method: `ssh samo-vm` → `cd ~/samo-projects/samomdkkuweb` →
  `./server/deploy.sh` (pull → `npm ci` → build → `sudo rsync dist/` →
  `/var/www/samo-web` → chown → restart notify → `nginx -t` + reload; also builds
  passport with `PASSPORT_BASE=/passport/`). `deploy.sh` uses BARE `sudo`, which
  needs a tty. **The `ssh -tt` + `sudo -S -v` priming recipe previously recorded
  here does NOT work** — the cred cache does not carry into deploy.sh's own sudo
  calls and it still dies "A terminal is required to authenticate", AFTER both
  vite builds have run. Use an askpass helper instead (no tty needed, verified
  2026-07-31, PW = `.env.local` `SAMO_VM_SUDO_PASSWORD`):
  ```sh
  PW=$(grep '^SAMO_VM_SUDO_PASSWORD=' .env.local | cut -d= -f2- | tr -d '"'"'"'"')
  printf '%s\n' "$PW" | ssh samo-vm 'read -r PW;
    printf "#!/bin/sh\nprintf %%s \"\$SAMO_PW\"\n" > /tmp/askpass.sh; chmod +x /tmp/askpass.sh
    cd ~/samo-projects/samomdkkuweb && git pull --ff-only &&
    SAMO_PW="$PW" SUDO_ASKPASS=/tmp/askpass.sh bash -c "
      sudo() { command sudo -A \"\$@\"; }; export -f sudo; bash server/deploy.sh"
    rm -f /tmp/askpass.sh'
  ```
  Pull manually first (as above) — deploy.sh re-execs itself after its own pull,
  and the manual pull keeps that transition honest. Bundle content-hashes differ Mac vs VM
  (dep/Node deltas) — verify a deploy by grepping the served bundle for feature
  strings, not by hash-matching.
- One Supabase project `fheueuowbchsnsvbcgil` (web `public` + passport in `passport`
  schema). Migrations applied through `tools/apply-migration.mjs` (Management-API PAT).
  **To INVESTIGATE the DB, use `tools/db-query.mjs <file.sql>`, not
  apply-migration** — the latter truncates its echoed result at 2000 chars
  without saying so, which turns any introspection query (policy dumps,
  `pg_get_functiondef` sweeps, column lists) into a confidently wrong answer.
  **`db-query.mjs` COMMITS** — "READ-ONLY" in its header is intent, not an
  enforced mode. Any write probe you run through it lands in production, and a
  plpgsql `exception when others` block only rolls back the FAILING sub
  transaction, so the probes that SUCCEED persist. End every investigative file
  with `rollback;`, and snapshot what you are about to disturb
  (`select <col>, count(*) … group by 1`) before the first write probe — that
  diff is what caught a real ticket being moved on 2026-07-31. Details in
  `.claude/rules/mistakes.md`.
  Both run as the Postgres SUPERUSER: `auth.uid()` is null and RLS is bypassed,
  so to see what a REAL user sees you must `set_config('role', …)` +
  `set_config('request.jwt.claims', …)` inside `begin; … rollback;` — every
  `tools/*` proof script is built that way and is the template to copy.

## NEXT — un-started work → `docs/NEXT.md`

Nothing is in flight. The backlog (with the reasoning behind each item) lives in
**`docs/NEXT.md`**; the roles/permissions + member-photo design is a separate,
fuller document at **`docs/TEAM-ROLES-AND-PHOTOS.md`** (written 2026-08-04,
nothing built, and it ends with five decisions the user has to make).

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

## Housekeeping — the memory system (2026-08-05, RESTRUCTURED)

**The old prune-and-archive loop is retired. Do not re-create
`.claude/rules/mistakes-archive.md`.**

Everything in `.claude/rules/` plus `CLAUDE.md` is injected into EVERY agent
session. That had reached **251k chars ≈ 63k tokens — a quarter of the context
window, spent before the user types anything** — because 118 full write-ups
lived there. The archive file did not help: it is in the same auto-loaded
directory, so it loaded too. It had been split along a *budget* axis
("stable/niche") rather than a *topic* axis, which also made it useless for
retrieval.

Now **26k chars ≈ 6.5k tokens** (a 90% cut), split by what each layer is for:

| | where | loaded |
|---|---|---|
| recurring **classes** (now seven) + a 1-line index of all 117 entries | `.claude/rules/mistakes.md` | every session |
| the 117 **write-ups**, nine files by area | `docs/mistakes/*.md` | on demand |

- **The index is GENERATED** — `npm run mistakes:index` rebuilds it from the
  `## ` headings in `docs/mistakes/`. Never hand-edit it; if a line reads badly,
  fix the heading. The previous hand-written "what's in the archive" blurb had
  already rotted, which is why this one is mechanical.
- **The budget is ENFORCED** — `npm run check:context` fails when an
  auto-loaded file exceeds its cap or a new undeclared `.md` appears in
  `.claude/rules/`. `npm test` runs it (`tools/memory-system.test.js`, 10
  tests: budget, index freshness, no duplicate entry across the nine files, no
  write-up shape back in the hot file). All three guards were verified to FAIL
  when deliberately broken, per class 7.
- **When a file breaches its budget, move detail into `docs/`. Never raise the
  cap.** That is the lever the old loop reached for and it is what got us here.
- `AGENTS.md` was a stale copy of `CLAUDE.md` naming a `.Codex/rules/`
  directory that has never existed (and pages.dev as prod). Collapsed to a
  pointer — one router, no mirror.

- **STATE.md is ~350 lines against CLAUDE.md's ~200 budget.** Prune by moving
  COMPLETED items to `docs/state-archive/`, and leave `NEXT` as only what is
  genuinely un-started. `NEXT` is the actual handover — prune it as items are
  completed, not to hit the number.

- `.env.local` holds the Supabase PAT, VM sudo pw, project-B DB creds — never commit.
- CI = Node 22 (supabase-js WebSocket). `npm run build && npm test` before every
  commit — 140 tests green at session end; isolation proof 23/23.
