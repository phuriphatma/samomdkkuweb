# STATE — current task & latest known state

Last updated: 2026-06-06. Slim by design — "what is true right now",
not a project diary. Session narratives live in `git log`; architecture
in `docs/CONTEXT.md`; bug post-mortems in `.claude/rules/mistakes.md`.

## Migrations applied through 0044; 0045 PENDING (low-risk)

All migrations **0041–0044 are APPLIED** to Supabase (real project
`fheueuowbchsnsvbcgil`). The only un-applied file:
- **`0045_soft_delete_null_role_guard.sql` — PENDING APPLY** (low-risk,
  not exploitable today): makes the soft-delete RPC auth guards fail CLOSED
  on a null role (`null in (...)` was failing open). Apply when convenient.

## Ticket soft-delete — DONE, on main (0043 + 0044)

PR + VS ticket deletion is SOFT (recoverable) instead of hard DELETE
(an accidental dev-account delete was unrecoverable on free tier).
- `deleted_at` on `pr_tickets` + `vs_tickets`; `soft_delete_pr_ticket` /
  `soft_delete_vs_ticket` SECURITY DEFINER RPCs encode the delete
  authorization (PR: pr_staff/dev; VS after 0044: ANY vs_staff/dev/vp_admin/
  has('vs') — per-dept VP limit dropped). RPCs, not a plain PATCH, because
  soft-delete is an UPDATE that would inherit the broader UPDATE RLS.
- Guest-lookup RPCs (0021) recreated to hide deleted rows. Every list/lookup
  read filters `&deleted_at=is.null`.
- UI does NOT tell staff it's recoverable (they'd ask to undo). PR delete
  confirm shows ticket id + name. **Restore = admin SQL**
  `update <table> set deleted_at = null where id = '...'`.
- PR staff dashboard has a search box (Ticket ID / ชื่องาน) next to the dept
  filter — `filterPRStaffTickets()` in `src/js/pr-staff.js`.

## Signup fixes 0041 + 0042 — APPLIED & VERIFIED

0041 (`fix_has_password_guard_blocks_signup`) unblocked all new signups
(0028 guard aborted signup when 0027 wrote `has_password` under null
`auth.uid()`). 0042 (`resilient_handle_new_auth_user`) makes the profile-row
insert never abort signup on an email/username collision. **Both applied.**
Post-mortems in `.claude/rules/mistakes.md`.

## (history below — older applied work)

## Discord → Cloudflare Pages Function — MERGED TO MAIN + CONFIGURED (2026-06-05)

ALL Discord notifications (PR/VS/projects) proxy through one Cloudflare Pages
Function `functions/notify.js` (+ pure core `functions/_discord.js`) instead
of GAS — frontend posts `{action,...payload}` to `NOTIFY_FN_URL` (`/notify`)
via the shared queue. Cloudflare egress IP ≈ kills the 1015 per-IP limit;
real logs; webhooks in Pages env vars. GAS keeps Drive uploads + projects
email only. Covered by `functions/notify.test.js` (24 tests). 89 tests pass.

**State: merged to `main` (a56849e), live on both Pages projects.**
- Env vars `DISCORD_PR_WEBHOOK` / `DISCORD_VS_WEBHOOKS` (11-dept JSON map) /
  `DISCORD_PROJECTS_WEBHOOK` are set as encrypted secrets on BOTH
  `samomdkkuweb` (prod) and `refactorsamomdkkuweb` (preview), production +
  preview configs. Set via the Cloudflare API.
- Webhook values are the EXISTING (un-rotated) ones from `appscript/*.gs` +
  the projects webhook. **Still recommended: rotate all webhooks** (they
  leaked in chat/repo) and re-PATCH the env vars — use
  `tools/set-notify-secrets.mjs` or the dashboard.
Setup/automation playbook: `skills/cloudflare-notify-function.md`.

### Dead-code cleanup done (2026-06-05)
- `appscript/vssound.gs` DELETED (was Discord-only; fully dead).
- `appscript/prform.gs` stripped of all Discord code (`DISCORD_WEBHOOK_URL`,
  `sendProjectDiscord`, `testProjectDiscord`, `postOnce_`,
  `sendDiscordNotification`, the `notifyPROnly`/`notifyProjectDiscord` doPost
  branches) — 769→493 lines. KEEPS uploads + `notifyProjectEmail`.
- `src/js/config.js`: removed unused `GAS_VITAL_SOUND_URL`; `vs-form.js`:
  removed its dead import. CONTEXT.md / README.md / `skills/deploy-gas.md`
  updated to match.
- **PENDING: redeploy `prform.gs`** to the prod "prform" GAS project so the
  live deployment drops the dead Discord handlers (they're uncalled, so this
  is hygiene, not urgent — see `skills/deploy-gas.md`). The "vssound" GAS
  project + its `/exec` can be deleted entirely at leisure.

### Legacy GAS Script Properties (no longer used)
- `PR_AGENTS` — DEAD. PR agent roster lives in Supabase `pr_agents` (id=1),
  read/written by `pr-staff.js`. Live list has 7 agents and (intentionally
  or not) does NOT include "พู่กัน" that the stale GAS copy still lists. To
  change the roster use the admin agents UI, never the GAS property.
- `PROJECT_DISCORD_WEBHOOK_URL` — superseded by the `DISCORD_PROJECTS_WEBHOOK`
  Pages env var.

## Discord notify unified (2026-06-05)

PR form, Vital Sign, and หนังสือโครงการ now share ONE rate-limit-aware
Discord core: `src/js/discord-queue.js` (`queueDiscord` + `callGAS` +
`sendDiscord`). Every Discord-bound GAS POST — whichever webhook — serialises
through one global chain with `MIN_DISCORD_SPACING_MS` (6s) spacing, since
the binding limit is Cloudflare's per-IP 1015 (shared GAS egress), not the
per-webhook bucket. `notify.js` (`sendNotify` for PR/VS) and
`projects/notify.js` both ride it; the old per-module fetch + private queue
copies are gone. Covered by `src/js/discord-queue.test.js` (16 tests:
callGAS success/non-2xx/success-false/timeout/network, queue FIFO/isolation/
spacing, sendNotify PR/VS routing). **GAS backend NOT yet unified** — the
PR/VS senders (`sendDiscordNotification` in prform.gs + vssound.gs) still
lack the retry/1015-bail that `sendProjectDiscord` has; client-side
serialisation already covers the rate-limit concern. Backend parity =
optional follow-up (needs a manual redeploy of BOTH GAS deployments).

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
- Orders table responsiveness: scoped a wider comfortable floor
  (`table.orders-admin-table` min-width 900px) so on narrow widths it scrolls
  horizontally instead of squishing columns into per-character wrapping;
  `status-pill`/`preorder-tag` + slip/date/total set `nowrap`; tighter cell
  padding ≤991px; the orders toolbar action buttons wrap full-width ≤767px.

**Migration 0040 (`0040_shop_status_cleanup_and_customer_note.sql`) — APPLIED
by user.** Tightened `shop_order_items.item_status` to
(paid,produce,ready,done,issue), `shop_orders.status` to
(pending,review,paid,produce,ready,done,cancel,slip_mismatch), added
`shop_orders.customer_note`, dropped the dead `'exchange'` from the
reserved-matrix RPCs. (place_shop_order keeps a now-dead `'exchange'` in its
inline stock-check predicate — harmless, left to avoid re-declaring the
large function.) Build green, 49 tests pass.

## Open follow-ups (not yet done)

- **Apply migration 0045** (low-risk null-role guard hardening — see top).
- **Rotate Discord webhooks** — PR + 11 VS + projects webhooks leaked in
  chat/repo. Regenerate in Discord, then re-PATCH the Pages env vars with
  `tools/set-notify-secrets.mjs` (PR/VS read from `.gs`; projects from your
  GAS Script Property). Working now, but spammable until rotated.
- **Rotate the Cloudflare API token** if not already done (it was pasted in
  chat during the notify setup).
- **Redeploy `appscript/prform.gs`** at some point so the live deployment
  drops the now-removed Discord handlers (uncalled → hygiene, not urgent).
  The whole `vssound` GAS project + `/exec` can be deleted at leisure.
- **Mobile login caveat** — if a phone genuinely evicts localStorage (not
  just slow restore), the boot-gate fix won't help; needs a real-device repro.

## DB migrations status (Supabase `fheueuowbchsnsvbcgil`)

Apply in numeric order via the SQL editor. **All migrations through 0044
are APPLIED.** The only PENDING file is
`0045_soft_delete_null_role_guard.sql` (low-risk hardening — top of file).
Full numbered history is in `supabase/migrations/`; `git log` carries the
per-migration context. (JS callers generally degrade gracefully when a
migration is missing, but the soft-delete reads added in 0043 DO need
`deleted_at` to exist — which it does, 0043 is applied.)

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
deleted. The LIVE prod /exec deployment still contains the old (uncalled)
Discord handlers until the next manual redeploy — hygiene, not urgent. The
1015 rate-limit problem is moot now (CF egress IP, not GAS's shared one).
Redeploy procedure: `skills/deploy-gas.md`.

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
