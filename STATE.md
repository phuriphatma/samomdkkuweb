# STATE — current task & latest known state

Last updated: 2026-05-31. Slim by design — "what is true right now",
not a project diary. Session narratives live in `git log`; architecture
in `docs/CONTEXT.md`; bug post-mortems in `.claude/rules/mistakes.md`.

Build green, 45 tests pass (`npm test`). Working tree dirty: account-
switch + dbRest + projects inbox UI fixes pending commit.

## Branches

- `main` HEAD: latest production. Auto-deploys to `samomdkkuweb.pages.dev`.
- `refactor/modular`: synced to main (preview). Auto-deploys to
  `refactorsamomdkkuweb.pages.dev`.
- Working tree clean unless this file says otherwise below.

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

## Pending GAS redeploy

`appscript/prform.gs` has unshipped changes that need a redeploy
(see `skills/deploy-gas.md`):

1. New `getProjectFolderInfo` action — used by the per-project QR
   feature AND by the new "rename Drive folder on project/doc edit"
   hook. Now takes `share` boolean (QR sets true, rename hook leaves
   default false to avoid quietly exposing folders).
2. New `walkProjectsPathByCode_` + `extractProjectCode_` helpers that
   match folders by their PRJ-/DOC- code substring and self-rename
   them to the current desiredName from the path. Used by
   `handleUploadProjectFile`, `handleGetProjectFolderInfo`, and
   `handleDeleteProjectFolder` so a rename in the app self-heals on
   Drive on the next upload / QR / delete.
3. `notifyProjectDiscord` and `notifyProjectEmail` now return real
   send-result status (was: always `success: true` even on Discord
   429 / expired webhook / mail-quota failure). The frontend
   `notify.js` `callGAS` helper awaits the Discord ping and logs the
   actual failure mode — fixes the "sometimes Discord doesn't fire
   for VPA" intermittent drop. The bell write was always reliable;
   the Discord channel is the one this redeploy unblocks.
4. `sendProjectDiscord` now retries ONCE on Discord 429 (per-route
   rate limit; honours the Retry-After header, clamped 0.4–5s) or
   on transport-level errors. Addresses "two rapid actions, only
   one Discord ping" where the second was rate-limited before this
   fix. Retry status flows back to the frontend in the response
   payload (`retried: true`) for diagnostics.

Until the redeploy lands: the QR button + rename-on-edit hooks both
alert / log warnings; the rest of the inbox keeps working. After
deploy, existing folders (legacy `PRJ-XXXX_<slug>` format) get found
by code and renamed to the new `<slug>_PRJ-XXXX` format on the next
access — transparent migration, no manual move-files step needed.

## What's in flight (carry-over from this session)

- **iPad cached HTML** — `_headers` ships `Cache-Control: no-cache,
  must-revalidate` for HTML so future deploys self-heal via the
  build-check (src/js/build-check.js). A currently-stuck iPad cache
  still needs one `?v=<anything>` bust to load the bundle that contains
  build-check; from then on every deploy auto-reloads.
- **Account switcher** — pickAccount has a re-entrancy guard, per-row
  spinner, 10s setSession timeout, post-swap modal hide. When the saved
  refresh_token is rejected on a fast switch, those cached tokens are
  now wiped from the saved entry so we don't keep replaying them every
  open (was a noisy 400 + console.warn loop). aria-hidden a11y warning
  on focused descendants is handled globally via a `hide.bs.modal` blur
  installed in `mountAccountSwitch`.
- **JWT auto-refresh on PostgREST writes** — `dbRest()` now detects
  `PGRST303 JWT expired` on a 401/403 response, refreshes the session,
  and retries once (single-flight to avoid N concurrent refreshes when N
  writes were in flight). Closes the "user typed in a modal for >1hr →
  submit fails with JWT expired" hole the 25-min proactive interval
  can't cover when the tab is throttled/backgrounded.

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
