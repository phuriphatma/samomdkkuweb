# STATE — current task & latest known state

Last updated: 2026-06-17. Slim by design — "what is true right now",
not a project diary. Session narratives live in `git log`; architecture
in `docs/CONTEXT.md`; bug post-mortems in `.claude/rules/mistakes.md`.

## Migrations through 0054 APPLIED — none pending

All migrations through **0054 are APPLIED** to Supabase (real project
`fheueuowbchsnsvbcgil`). SAMO Team: 0046–0049. Professor signing: 0050
(workflow) + 0051 (prof comment via column-guarded project_documents UPDATE)
+ 0052 (`signs_file_id` link for inline signed-file UI) + 0053 (sa_prof may
delete his own signed files for re-sign). 0054 (`announcements.pinned` flag —
home featured post). The latest signing-UX round (return/resend persistence +
batching, comment notify-scope, collapsible sign status, multi-page e-sign) is
**client-only — no migration**.

`refactor/modular` is **ahead of `main`** by three feature PRs (all
client-only, no migration): PR #14 (MDKKU Self Exam Bank link on ฝ่ายวิชาการ),
PR #13 (ฝ่ายบริหารองค์กร announcement-style resource cards + base
`.launcher-tool` accent-bar curve fix — `overflow:hidden`), PR #12 (mobile
top-bar login/logout buttons). Before these, main and refactor were in sync at
the same commit (PR #11 fast-forwarded into both). `announcements.pinned`
(0054) is live — verified
queryable via anon PostgREST (`select=pinned` → 200). The loader self-heals if
the column is ever absent (warns once, disables pin), and `baseSelect` excludes
`pinned` so the excerpt/display_order fallbacks never re-request it. No new RLS
policy (announcements_write already covers staff/dev/creator UPDATE).

## Vital Sound emergency toggle — TEMPORARILY HIDDEN on customer view (main + refactor, 88de664)

The 🚨 "กรณีฉุกเฉิน (ส่งเรื่องตรงถึงอุปนายกทันที ข้ามทีม SE)" checkbox is
commented out in `src/html/tab-vitalsound.html` per request (temporary).
`toggleEmergency()` in `src/js/vs-form.js` is now null-safe (early-returns when
`#vsEmergency` is absent), so submits default to non-emergency routing (→ SE,
status "รอ SE รับเรื่อง"). **To restore: un-comment the HTML block** — no other
change needed; staff-side `is_emergency` rendering is untouched. Live on main.

## Vital Sound PDPA consent gate — client-only, SHIPPED (main + refactor)

Sending a Vital Sound report pops a non-dismissible PDPA consent modal on
EVERY send (`src/html/modal-vs-consent.html`, included in `index.html`;
`vs-tab` teal accent; `data-bs-backdrop="static"` + no keyboard/X so the
visitor must choose ยินยอม / ไม่ยินยอม). Flow: `handleVsFormSubmit` validates
the form first (account/content), then parks the real send in `pendingSubmit`
and shows the popup; ยินยอม runs `sendVsReport(form)`, ไม่ยินยอม clears it and
shows a "การส่งถูกยกเลิก" notice. Nothing is persisted — consent is asked every
time. Wiring: `initVsConsent` in `src/js/vs-form.js`, called from `main.js`
after `initVsForm`. No migration — no personal data stored beyond the existing
problem text. Public bundle only (absent from admin build).

## Professor (saprof) signing workflow — SHIPPED (main, ab3cb89)

Third seat in หนังสือโครงการ: **`saprof` / role `sa_prof`** signs documents.
sastaff sends a chosen SUBSET of a หนังสือ's files to the professor; he accepts
(in-browser e-sign on the PDF, or upload an externally-signed file) or rejects
(back to sastaff). vpa sees all progress. sastaff also got file add/replace/remove
parity with vpa (file ops now notify the other seat + the prof if shown to him).
The prof can also COMMENT (0051) and is wired into the inbox highlight system
(permanent "รอลงนาม" pill + seenAt "อัปเดต"). Accepting does NOT require a signed
file (it's an approval; signing is optional). Signing status is shown INLINE on
each attached file with the signed version nested beneath it (renderFileCard) —
the old separate "การลงนาม" section is now a collapsible request-status bar
(auto-expands + "ใหม่" indicator on a new decision, like the comments thread).

Latest UX round (client-only): (1) **ส่งกลับ persistence** — the ตีกลับ reason
persists for vpa until ส่งใหม่, and the resend summary + the files vpa changed
stay highlighted for sastaff until they change status (status-keyed, NOT
clear-on-view — `renderReturnContextBanner` + `persistIds` in loadFilesForDoc).
(2) **Notification batching** — during the ส่งกลับ phase (status=returned) vpa's
per-file edits do NOT ping sastaff each time; they're consolidated into the one
ส่งใหม่ notification (`fanFileOp` skip + `summarizeFileOpsSince`). Other statuses
still notify per edit. (3) **Comment notify-scope** — author picks "ทุกคน"
(default) or a single seat (`commentTargetSeats` + the prompt's new select; entry
carries `notify`). (4) **Sign picker** defaults to no files + เลือก PDF/ทั้งหมด/
ล้าง buttons. (5) **Multi-page e-sign** — stamp the signature on any/all pages
(per-page `placements` Map + "ทุกหน้า"); high-DPI pad capture so the embedded
signature is crisp, not pixelated. (6) **Signing audit log** — every prof
sign / re-sign / signed-file upload writes a timestamped `signed_file` entry to
the doc timeline (หนังสือ + original file + output + method + replaced flag) via
`logSignToDoc`; surfaced to the actors' update banner. (7) UI: หนังสือโครงการ
defaults to LIST view, project names wrap (no truncation), and long-Thai text
blocks wrap instead of overflowing on mobile/iPad.

Live: migration 0050 applied, `saprof` seeded (password `1234`; synthetic email
never delivers), GAS redeployed with `getProjectFileData` (e-sign Drive-bytes
round-trip; the reupload fallback works without it). **Remaining setup:** set the
prof email in การตั้งค่า (admin manage tab) if email-to-prof is wanted.

Key design note — the project tables are world-readable (0032 `*_read_public`),
so the prof's "only docs sent to him" scope is a UI/query filter
(`scopeProjectsForRole` in `index.js`, file filter in `loadFilesForDoc`), NOT
RLS; the real signal is that `project_sign_requests` has no public policy (see
`.claude/rules/mistakes.md`). New deps: `pdf-lib`, `pdfjs-dist` (e-sign is a
lazy-loaded chunk, kept out of the public bundle). Modules:
`src/js/projects/{sign,esign}.js`, `src/html/modal-project-{sign,esign}.html`,
`tools/saprof-account.mjs`.
## Announcement pinning + home featured + card manage page (feat/announcement-pin-cards)

The home featured (large) card is now driven by an explicit `pinned` flag,
NOT list position. The **"ลำดับการแสดงประกาศ" admin section** is its own sidebar tab below
เขียนประกาศ (`data-admin-side="order"` → pane `data-admin-pane="order"`,
`src/html/tab-announcement-order.html`, gated same as creator via
`SIDE_FEATURE.order = 'creator'`, rendered by `enterAnnouncementOrder()`). It
renders each announcement as an **editorial card** (reuses the public
`news-grid--archive` look) via `renderAnnouncementOrderList` → `renderOrderCard`:
drag handle + pin chip overlay the image, click the card to edit. SortableJS
reorders (handle `.order-card-handle`, items `.order-card`); pin chip →
`togglePinAnnouncement` (unpins others, at most one pinned).

**Editing is a popup overlay, not a redirect.** Clicking a card calls
`editAnnouncementById` → `editAnnouncement(id)` + `openEditorOverlay()`, which
floats the SINGLE existing creator editor (the `#creatorPane`) on top via the
`.editor-overlay` class (z-index 1040, below Bootstrap modals so the cover
cropper still stacks). No duplicate editor / Quill instance. Close via the X
or cancel (`window.closeAnnouncementEditor`), or automatically after
publish/delete: `announcements.js` dispatches `announcement:changed`, and
admin-main's listener closes the overlay + re-renders the cards. เขียนประกาศ
sidebar tab still shows the same editor inline for NEW posts (`enterCreator`
calls `cancelEdit()` for a clean form); `#creator/{id}` deep links also edit
inline.

CSS bundling note: `src/admin.css` now imports `news.css` (so the manage
cards reuse the public news-card system) + a new `css/announcements-admin.css`
(the `.order-card*` + `.editor-overlay*` styles, moved out of the public-only
`article.css`). Previously admin.css excluded news/article as "public-only".
Home render: **pinned post = big card on top + the 2 most recent others as
small cards**; if nothing is pinned, all posts render small (no featured).
Also this session: announcement archive page (`news-grid--archive`) switched
to side-by-side cards (3:4 image left, text right, 3 per row desktop / 2
tablet / 1 mobile); home grid is 2-up horizontal (`news-grid--home`); a
`/welcome-banner.svg` home banner was added; archive + manage cards show 2 per
row on phones. Files: `src/js/announcements.js`, `src/js/admin-main.js`,
`src/css/news.css`, `src/css/article.css`, `src/css/cards.css`,
`src/css/announcements-admin.css`, `src/html/tab-home.html`,
`src/html/tab-announcement-order.html`.

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
