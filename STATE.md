# STATE — current task & latest known state

Last updated: 2026-06-08. Slim by design — "what is true right now",
not a project diary. Session narratives live in `git log`; architecture
in `docs/CONTEXT.md`; bug post-mortems in `.claude/rules/mistakes.md`.

## Migrations through 0049 APPLIED — 0050 PENDING

All migrations through **0049 are APPLIED** to Supabase (real project
`fheueuowbchsnsvbcgil`). SAMO Team: 0046 (tables) + 0047 (seed: 218 nodes,
351 member rows) + 0048 (realtime publication + replica identity full) +
0049 (year normalize).

**0050 (professor signing workflow) is NOT yet applied** — see next section.

## Professor (saprof) signing workflow — built, NOT yet deployed (this session)

New third seat in หนังสือโครงการ: **`saprof` / role `sa_prof`** signs documents.
sastaff sends a chosen SUBSET of a หนังสือ's files to the professor; he accepts
(in-browser e-sign on the PDF, or upload an externally-signed file) or rejects
(back to sastaff). vpa sees all progress. sastaff also got file add/replace/remove
parity with vpa (file ops now notify the other seat + the prof if shown to him).

**Three deploy steps remain (in order):**
1. **Apply `supabase/migrations/0050_prof_sign_requests.sql`** in the SQL editor
   (real project). Adds `sa_prof` role, `project_sign_requests` table,
   `project_files.sign_request_id`/`is_signed`, prof RLS, prof settings cols.
2. **Seed the account**: `CONFIRM=1 node tools/saprof-account.mjs seed`
   (saprof / password `1234`). **Must run AFTER step 1** — the role check
   constraint needs `sa_prof` to exist. (Password is weak but user-requested;
   synthetic email never delivers.)
3. **Redeploy GAS** (`appscript/prform.gs` gained `getProjectFileData` for the
   in-browser e-sign Drive-bytes round-trip). The REUPLOAD fallback works
   without this; only the draw-on-PDF e-sign needs it. See `skills/deploy-gas.md`.

After deploy: set the prof email in การตั้งค่า (admin manage tab). Key insight
this session — the project tables are world-readable (0032 `*_read_public`), so
the prof's "only docs sent to him" scope is a UI/query filter
(`scopeProjectsForRole`), not RLS; the real signal is that
`project_sign_requests` has no public policy. New deps: `pdf-lib`, `pdfjs-dist`
(e-sign is a lazy-loaded chunk, kept out of the public bundle).

## Shipped features (detail archived)

These are live on main + applied; full per-feature write-ups moved to
`docs/state-archive/2026-06-08.md` to keep this file lean (git log is the
authoritative history):
- **SAMO Team management** (ทีม SAMO admin section, migrations 0046–0049) —
  org tree (divisions→departments→roles→people), drag + picker move,
  multi-select bulk ops, per-node permissions (org metadata only, NOT wired to
  live auth yet), live Realtime multi-editor sync, JSON/CSV import-export with a
  per-conflict resolver. Files: `src/js/team/*`, `src/html/tab-team.html`,
  `src/css/team.css`.
- **President account + นายกสโม VS dept** — `samomdkkupresident` (role=dev,
  dept=นายกสโม) via `tools/president-account.mjs seed`; นายกสโม added as a VS
  target dept across form/dashboard/transfer/Discord, with its own VS webhook.

## หนังสือโครงการ email — works; channel config is the only switch (this session)

GAS MailApp email is the deliberate, best free choice (see GAS section below
for the CF-Worker comparison). Plumbing is verified working; it only sends when
`project_settings.notify_uni_email = true` AND `uni_staff_email` is non-empty —
both were off/blank, which is the whole "email doesn't work" story (the
uni_staff account email is synthetic `@samomdkku.app`, never delivers → a
curated recipient field exists for a real address). **Admin sets the recipient
in การตั้งค่า** (left for the user to fill — live DB still has it blank/off).
Manage UI now has a "ทดสอบ" send-test button, an enabled-but-empty warning, and
multi-recipient support (`normalizeRecipients` in `src/js/projects/notify.js`,
splits on `,;`+whitespace, validates, dedupes; unit-tested in
`projects/notify.test.js`). MailApp quota = GAS owner's Gmail: ~100
recipients/day consumer, 1,500/day Workspace; counts recipients not emails; no
documented per-minute/hour throttle; no separate monthly cap.

## Branches

- `main` HEAD: latest production (`053a01b`). Auto-deploys to
  `samomdkkuweb.pages.dev`.
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
`.env.local` also carries `SUPABASE_SERVICE_ROLE_KEY` (used for live DB
inspection / provisioning scripts — NEVER bundle to `src/`).
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

**หนังสือโครงการ email = GAS MailApp, by design (NOT moving to Cloudflare).**
The live `/exec` `notifyProjectEmail` path is verified working (test POST →
`{"success":true}`, real Gmail delivered). MailApp sends *as the owner's
Gmail* → correct SPF/DKIM, best deliverability, free, no card, no domain,
~100/day. A CF Worker can't beat this with no custom domain: MailChannels'
free CF tier is dead; Resend/MailerSend need domain verification to email
arbitrary recipients; Brevo-from-Gmail fails SPF alignment → spam. The 1015
per-IP limit that moved *Discord* to CF does NOT apply to MailApp.

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
