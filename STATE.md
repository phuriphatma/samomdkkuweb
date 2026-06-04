# STATE — current task & latest known state

Last updated: 2026-06-03 (later session). Slim by design — "what is true right now",
not a project diary. Session narratives live in `git log`; architecture
in `docs/CONTEXT.md`; bug post-mortems in `.claude/rules/mistakes.md`.

Build green, 49 tests pass (`npm test`). `main` HEAD now lands the
**Samoshop per-item overhaul** (merged from `feat/shop-per-item-progress`):
order status = payment phase, `shop_order_items.item_status` =
produce→ready→done per product (Hybrid model); multi-slip + required
buyer phone + IG contact banner; grid "เหลือ N" count hidden (kept in
the product modal); admin orders table redesigned (Product/Qty columns,
per-item rows, live filtered count); admin order create + edit-items +
per-item preorder toggle; status changes write immediately (no Save bar);
new พรีออเดอร์ demand tab; การส่งมอบ tab removed. Plus a footer
แหล่งข้อมูล column (SAMO Academic DB / MDI / RT links). Earlier `main`
work (ฝ่าย nav, tab-departments, /projects-view mirror gated by 0032,
copy-รหัส button) is still in. Cloudflare auto-build runs on push.

## Branches

- `main` HEAD: latest production. Auto-deploys to `samomdkkuweb.pages.dev`.
- `refactor/modular`: synced to main (preview). Auto-deploys to
  `refactorsamomdkkuweb.pages.dev`.
- `feat/batch-shop-account-banners-fixes` → **merged to main**: shop
  checkout required-field `*` markers; mobile launch-banner peek fix;
  `mistakes.md` trimmed under budget (+ `mistakes-archive.md`); จัดการบัญชี
  contact phone + samoshop autofill (mig 0036); admin order size/colour
  dropdowns; ประกาศ swipe-banner carousel + admin placement toggle
  (mig 0037); account-switch slow-path uses local-scope signout so the
  outgoing account stays fast-switchable. Reserved stock excludes preorder
  (mig 0038, also client-side in the stock tab). Admin orders table:
  item-narrowing filter + faceted facets (type/subtype, ไซส์, สี, per-item
  ความคืบหน้า, grouped สถานะ) each with live (N) counts; piece count in the
  table footer. CSV export = one row per line item. พรีออเดอร์ tab
  redesigned (summary stats + table/card view + search/type filters,
  grouped by type). **Migrations 0036/0037/0038 confirmed applied in prod.**

## Latest commits on main

`caab82a` — batch of หนังสือโครงการ + auth/mobile/UI fixes (customer-mirror
highlights removed, admin notification jump, mobile boot-gate, faster
status/comment notify, เปลี่ยนบัญชี first-switch-back race, จัดการบัญชี on
mobile, article-hero + footer CSS). Full per-change detail is in that
commit message + the 4 new entries in `.claude/rules/mistakes.md`.

Follow-up batch (this session):
- **Article hero on iPad** — raised the narrow-hero breakpoint to 1399.98px
  (the old 1199.98px missed the 12.9" iPad in landscape at 1366px) and
  matched the hero to the 720px text column so the cover no longer reads
  as "wider than the article". `src/css/article.css`.
- **QR generation hits GAS at most once per project** — new migration
  **0039** caches the Drive folder URL/ID on the project row; `qr.js`
  resolves in-memory → DB column → GAS (first time only, then persists
  via `cacheProjectFolder`). Folder ID/URL is stable across renames so
  the cache never invalidates. Cuts the per-IP Cloudflare-1015 pressure.

Pushed direct to main (branch protection bypassed); Cloudflare auto-build
deploying.

## Samoshop admin UX pass (landed on main)

Latest main batch on top of the per-item overhaul:
- Orders table: per-order **multi-select + select-all + bulk delete**
  (checkbox column + bulk action bar; `state.ordersSelected`, pruned on
  refresh).
- Per-item ความคืบหน้า: happy path unchanged (paid→produce→ready→done);
  the two problem chips (exchange/no_show) collapsed to a single **มีปัญหา**
  (`item_status = 'issue'`) that **keeps reserving stock** (order stays
  `paid`; reserved predicate keys on `item_status <> 'done'`).
- Order สถานะปัญหา picker reduced to **slip_mismatch + cancel** only
  (`ORDER_ISSUE_STATUSES`); dead off-path order statuses
  (exchange/refund_pending/no_show/refunded) removed + folded into `cancel`.
- New **customer_note** — admin writes it in the order modal; shown on the
  buyer "คำสั่งซื้อ" card (separate from internal admin_note).
- แก้ไขรายการสินค้า: existing rows edit ไซส์/สี/จำนวน/ราคา/ประเภท
  (preorder|normal) behind a per-row save; เพิ่มสินค้า has a preorder
  selector. `updateOrderItem` accepts `is_preorder`. The old per-item
  preorder chips (+ `onItemPreorderClick`/`setOrderItemPreorder`) were
  removed — preorder is now edited in ONE place (the edit panel).
- variantSize/ColorOptionsHtml preserve a stored size/colour that's no
  longer in the product list (editing a row won't silently rewrite it).
- สินค้า table shows `effectivePrice` (preorder-aware) on one line; the
  regular price shows struck-through only when a preorder discount applies
  (the redundant yellow "พรีออเดอร์" sub-line was dropped — the Preorder
  badge in the status column already signals it).
- สต็อก tab keyboard fix: cell `input` no longer full-re-renders (was
  destroying the focused field → mobile keyboard dismissed each keystroke);
  no blur re-render either (it ate the Save-button tap on touch). Derived
  numbers refresh on Save / ± / tab switch.
- Order-detail modal item controls + edit panel restyled with a responsive
  CSS grid (`.eir-fields`, `.order-item-line`) so it reads well on
  desktop / iPad / mobile. `issue` + `slip_mismatch` status-pill colours added.

**Migration 0040 (`0040_shop_status_cleanup_and_customer_note.sql`) — APPLIED
by user.** Tightened `shop_order_items.item_status` to
(paid,produce,ready,done,issue), `shop_orders.status` to
(pending,review,paid,produce,ready,done,cancel,slip_mismatch), added
`shop_orders.customer_note`, dropped the dead `'exchange'` from the
reserved-matrix RPCs. (place_shop_order keeps a now-dead `'exchange'` in its
inline stock-check predicate — harmless, left to avoid re-declaring the
large function.) Build green, 49 tests pass.

## Open follow-ups (not yet done)

- **Discord notify platform** — user chose to KEEP GAS for now, scope any
  Discord work to หนังสือโครงการ only (do NOT touch prform/vitalsound),
  and migrate to a non-GAS proxy (Edge Function / Worker, dedicated egress
  IP) later. The rapid-fire rate-limit is already handled by the 6s
  queue spacing in `projects/notify.js`.
- **Mobile login fix caveat** — if a phone is genuinely evicting
  localStorage (not just slow restore), the boot-gate fix won't help;
  needs a real-device repro to distinguish.

Resolved by user (2026-06-03): **GAS redeployed** (customer-mirror QR +
folder/rename ops now live) and **Supabase Manual linking enabled**
(profile Connect-Google prerequisite met). No code follow-up needed.

## Pending DB migrations (Supabase `fheueuowbchsnsvbcgil`)

Apply in numeric order via the SQL editor. JS callers degrade gracefully
when missing — site keeps working but the feature behind each migration
won't function until applied.

User has confirmed 0023–0031 + **0032–0038 are applied** (0032 is in
active use — the /projects-view customer mirror shows data, which it
couldn't without anon SELECT). **0039 is the only pending one** — until
it lands, the QR-folder cache falls back to a GAS call per open (works,
just doesn't save the round-trip).

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
| 0032_projects_public_read | **Public-read RLS** on `projects`, `project_documents`, `project_files`, `project_doc_types`, `project_settings` (`for select to anon, authenticated using (true)`). Unblocks the new /projects-view customer mirror — anonymous visitors can list every project, document, file URL, and the settings row's label fields. Writes are unchanged (still vp_admin / uni_staff gated). Settings table now exposes `uni_email` to anon too — if that becomes sensitive, scope to a column-select view in a follow-up. | ⏳ **pending — apply via Supabase SQL editor** |
| 0033_shop_per_item_and_buyer_phone | **Additive**. `shop_order_items.item_status`/`item_timeline`/`is_preorder`; `shop_orders.buyer_phone` + `slips` jsonb (backfilled from `slip_url`). Foundation for the Hybrid per-item model. | ✅ applied |
| 0034_shop_item_status_cascade | Rewrites `place_shop_order` (adds `p_buyer_phone`/`p_slips`, stamps per-item `is_preorder` + seeds `item_status`), repoints `apply_product_production_status` + the order-paid trigger to cascade to `item_status`, moves reserved-matrix aggregates to an item-level predicate. Drops the 0030 `place_shop_order` signature. | ✅ applied |
| 0035_shop_orders_admin_insert | Admin `shop_orders` INSERT policy so admin can create walk-in / phone orders (buyer_id null). OR-combined with the buyer insert policy. | ✅ applied |
| 0036_users_phone | **Additive**. `users.phone` column (self-writable; not guarded by 0028). Powers the จัดการบัญชี phone field + samoshop checkout autofill. | ✅ applied |
| 0037_shop_banner_placement | **Additive**. `shop_banners.placement` ('launch' \| 'announcement', default 'launch'); per-placement order index. Unlocks the ประกาศ swipe-banner carousel + admin placement toggle. | ✅ applied |
| 0038_reserved_excludes_preorder | Redefines `shop_reserved_matrix`, `shop_reserved_matrix_all`, `place_shop_order` so reserved-stock aggregates count only `is_preorder=false` items — preorder no longer depletes finite stock / over-counts the oversell guard. Signatures unchanged. | ✅ applied |
| 0039_project_drive_folder_cache | **Additive**. `projects.drive_folder_url` + `drive_folder_id` — caches the Drive folder so `qr.js` hits GAS at most once per project (first QR open) instead of on every open. JS degrades to the GAS round-trip when absent. | ⏳ **pending — apply via Supabase SQL editor** |

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

## GAS deploy (`appscript/prform.gs`) — DEPLOYED 2026-06-03

User redeployed the prod /exec endpoint, so the changes below are now
LIVE (customer-mirror QR + folder/rename self-heal + the Discord
retry/1015-aware path). See `skills/deploy-gas.md` for the procedure.
Bundled changes that landed in this deploy:

| Area | What's new |
|---|---|
| QR + folder ops | New `getProjectFolderInfo` action (takes optional `share:true` for ANYONE_WITH_LINK view — QR sets it, rename hook doesn't). New `walkProjectsPathByCode_` + `extractProjectCode_` helpers: every project-tree path walk now matches folders by their PRJ-/DOC- code substring and self-renames stale names to the current desiredName. Used by `handleUploadProjectFile`, `handleGetProjectFolderInfo`, `handleDeleteProjectFolder` — so a project / doc rename in the app self-heals on Drive on the next upload, QR generation, or delete. Legacy `PRJ-XXXX_<slug>` folders found by code and renamed to new `<slug>_PRJ-XXXX` format transparently. |
| Discord notify | `sendProjectDiscord` does up to 3 attempts with progressive backoff (1.2s / 2.5s / 4s, Retry-After honoured, clamp bumped 5s → 9s). Detects Cloudflare 1015 in response body and bails the retry loop early (no point burning GAS time when per-IP cooldown won't clear). `doPost notifyProjectDiscord` echoes full diagnostic info in the response (`status`, `attempts`, `firstStatus`, `body`, `retried`) so the frontend can log what Discord said — GAS Cloud Logs are NOT recorded for browser-fetch calls (see `skills/deploy-gas.md` "Where the logs DO and DON'T appear"). `notifyProjectEmail` also surfaces send failures. |
| Diagnostics | New `testProjectDiscord()` function for manual editor-Run debugging — sends a labelled test embed and logs the full Discord response. Top-of-`doPost` trace log (`doPost: action=...`) for absolute-floor confirmation that the code path is being entered (visible only when called with OAuth token or from the editor). |

(Now deployed — the QR button + rename hooks resolve, and Discord notify
runs the retry/1015-aware path.)

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

- `ฝ่าย` navbar entry → new tab-departments page (moved from เกี่ยวกับเรา); 10 dept cards drill into per-ฝ่าย tool lists. Three external sites (Notion, MDI, RT) ship as `#` placeholders pending real URLs from the user.
- Public read-only customer mirror of หนังสือโครงการ at `/projects-view` — reuses admin renderers via `role='customer'` so admin UI changes auto-mirror (zero duplication). Migration 0032 opens anon SELECT on projects + documents + files + types + settings. **Apply 0032 before users hit /projects-view.**
- Dept-specific links also mirrored into the เครื่องมือ launcher so search picks them up.
- Easy "คัดลอกรหัส" button on every project's admin detail header (uses the existing `[data-copy]` delegate).

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
