# STATE — current task & latest known state

Last updated: 2026-05-31. Slim by design — "what is true right now",
not a project diary. Session narratives live in `git log`; architecture
in `docs/CONTEXT.md`; bug post-mortems in `.claude/rules/mistakes.md`.

Build green, 45 tests pass (`npm test`). Working tree clean. `main`
HEAD is `dcfd381` (pushed). Cloudflare auto-build runs on push.

## Branches

- `main` HEAD: latest production. Auto-deploys to `samomdkkuweb.pages.dev`.
- `refactor/modular`: synced to main (preview). Auto-deploys to
  `refactorsamomdkkuweb.pages.dev`.

## Pending DB migrations (Supabase `fheueuowbchsnsvbcgil`)

Apply in numeric order via the SQL editor. JS callers degrade gracefully
when missing — site keeps working but the feature behind each migration
won't function until applied.

User has confirmed 0023–0031 are applied. No pending migrations.

| Migration | What it unlocks | Status |
|---|---|---|
| 0023_shop_product_code | `<CODE>NNNN` order ids; `shop_products.code` | ✅ applied |
| 0024_shop_product_production_status | `production_status` column + cascade RPC | ✅ applied |
| 0025_shop_orders_paid_cascade | BEFORE-UPDATE trigger auto-advances on `paid` | ✅ applied |
| 0026_profile_email_and_order_contact | `lookup_email_by_username` RPC; auth.email mirror; `buyer_name`/`buyer_email` | ✅ applied |
| 0027_username_case_and_has_password | Case-insensitive username lookup; `users.has_password` mirror | ✅ applied |
| 0028_users_self_update_guard | **Security**. BEFORE-UPDATE trigger that blocks self-promotion via `PATCH /users` (column-level guard since RLS is row-level only) | ✅ applied |
| 0029_shop_preorder_price | `shop_products.preorder_price` nullable column — separate preorder price | ✅ applied |
| 0030_shop_stock_safety_and_preorder_tag | `shop_orders.is_preorder` + `shop_reserved_matrix_all()` RPC + `place_shop_order()` RPC (atomic stock check via row lock — prevents oversell). Buyer sees `max(0, stock - reserved)`. | ✅ applied |
| 0031_project_doc_views | Per-user, per-doc seenAt marker — moves inbox highlights off per-device localStorage so they sync across devices + stop leaking across accounts. RLS-gated to own rows. JS bulk-uploads existing localStorage on first run. (File made idempotent after the first apply — re-running is safe.) | ✅ applied |

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

## Pending GAS redeploy (`appscript/prform.gs`)

The local `prform.gs` is multiple commits ahead of what's deployed
to the prod /exec endpoint. See `skills/deploy-gas.md` for the deploy
procedure. Bundled changes since the last deploy:

| Area | What's new |
|---|---|
| QR + folder ops | New `getProjectFolderInfo` action (takes optional `share:true` for ANYONE_WITH_LINK view — QR sets it, rename hook doesn't). New `walkProjectsPathByCode_` + `extractProjectCode_` helpers: every project-tree path walk now matches folders by their PRJ-/DOC- code substring and self-renames stale names to the current desiredName. Used by `handleUploadProjectFile`, `handleGetProjectFolderInfo`, `handleDeleteProjectFolder` — so a project / doc rename in the app self-heals on Drive on the next upload, QR generation, or delete. Legacy `PRJ-XXXX_<slug>` folders found by code and renamed to new `<slug>_PRJ-XXXX` format transparently. |
| Discord notify | `sendProjectDiscord` does up to 3 attempts with progressive backoff (1.2s / 2.5s / 4s, Retry-After honoured, clamp bumped 5s → 9s). Detects Cloudflare 1015 in response body and bails the retry loop early (no point burning GAS time when per-IP cooldown won't clear). `doPost notifyProjectDiscord` echoes full diagnostic info in the response (`status`, `attempts`, `firstStatus`, `body`, `retried`) so the frontend can log what Discord said — GAS Cloud Logs are NOT recorded for browser-fetch calls (see `skills/deploy-gas.md` "Where the logs DO and DON'T appear"). `notifyProjectEmail` also surfaces send failures. |
| Diagnostics | New `testProjectDiscord()` function for manual editor-Run debugging — sends a labelled test embed and logs the full Discord response. Top-of-`doPost` trace log (`doPost: action=...`) for absolute-floor confirmation that the code path is being entered (visible only when called with OAuth token or from the editor). |

Until the redeploy lands, the QR button + rename hooks alert
"หา URL โฟลเดอร์ไม่สำเร็จ"; Discord notify still works but on the old
single-shot path. Everything else in the inbox is unaffected.

## Active external issue: Cloudflare 1015 cooldown on Discord webhook

The GAS server's shared egress IP is currently in Cloudflare's
penalty box for the Discord API (`/api/webhooks/*`). Caused by
sustained testing volume today (dozens of pings, many back-to-back).
Symptoms: `testProjectDiscord` returns `HTTP 429 / body "error
code: 1015"` from the editor; runtime calls all 3-retry and drop.

This is per-IP, not per-webhook — rotating the webhook URL won't
help. Recovers passively over 15-60 min of quiet. **Stop testing
Discord-firing actions** until it clears, then verify with one
`testProjectDiscord` run from the editor.

Longer-term, if this recurs frequently: move Discord notify off GAS
to a Cloudflare Worker / Supabase Edge Function (different egress
IP, dedicated to this app). See `mistakes.md` "Cloudflare 1015" for
the full writeup.

## Recent work landed today (one-line each, for context)

- per-project QR → Drive folder (frontend live, GAS pending redeploy)
- Drive folder rename on project/doc title edit (name-first naming + by-code walker, frontend live)
- JWT auto-refresh in `dbRest` on PGRST303 (single-flight)
- Account switcher a11y + dead-token cleanup
- Discord notify: serialised client queue (6s spacing), GAS 3-retry, Cloudflare 1015 detection, response-body diagnostics
- PR staff dashboard moved to `dbRest` (was supabase-js, slow under session-lock contention)
- Blue "อัปเดต" pill for comments on sent หนังสือ (separate from yellow status pill)
- New mistakes.md entries: JWT-expired-mid-modal, fire-and-forget GAS notify, async click handler concurrency, GAS Cloud Logs invisible for browser-fetch, Cloudflare 1015 vs Discord rate limit

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
