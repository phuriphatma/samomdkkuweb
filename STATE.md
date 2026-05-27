# STATE — current task & latest known state

Last updated: 2026-05-27 (SAMO Shop refactor — see top section)

## SAMO Shop refactor (2026-05-27)

Substantial UX + schema change pass on the SAMO Shop module. Build + tests
green (26/26). **Not yet deployed** — needs schema migration + manual smoke
test before merge.

### What changed
- **Sources** reshaped: `md`, `rt`, `mdi`, `sittikao` (replaces
  project/fund/merch). Legacy rows auto-migrated to `md` by 0007 — admin
  should re-tag them.
- **Types**: dropped `accessory` (ของแถม).
- **Fit dimension removed everywhere** (modal, cart, checkout, admin
  editor, order detail). All items default to unisex on insert; old
  `fits` column kept in DB but ignored in UI.
- **Presale → Preorder** rename across labels (DB column `is_presale`
  kept to avoid a backfill — only the UI text changed).
- **New `stock_status`** column on products: `available` | `sold_out` |
  `production_closed`. Storefront shows OOS ribbon + grays the card +
  disables Add-to-Cart. Independent of `is_active` (soft-archive).
- **Stock matrix UI**: editable size × color number grid in the admin
  product editor. Empty cell = unspecified; `0` = OOS for that combo.
- **เปิดตัวล่าสุด** is now a horizontal "big show" carousel with prev/next
  arrows + scroll-snap (mobile: swipe).
- **ประกาศการรับสินค้า** now stacks multiple active batches on the
  storefront (was single hero before). Closed batches editable +
  re-openable in admin.
- **Per-date hours**: `dates_full` jsonb `[{date, hours}]` lets each
  pickup date carry its own time window. Backfilled from legacy
  `dates[]` + shared `hours` by the migration.
- **Checkout pickup-radio block removed**: location/time come from the
  admin's pickup announcement instead.
- **Delivery workflow** (new admin tab "การส่งมอบ"):
  - One card per `ready` order, expand to per-item checklist.
  - Tick → prompts for recipient name, writes
    `shop_pickup_records` row (one per `order_item_id`, unique).
  - Issue button → captures `issue_type`
    (wrong_size/damaged/missing/other) + free-text note.
  - Resolve button on issues → adds resolution text + `resolved_at`.
  - When all items ticked, "ปิดคำสั่งซื้อ → รับสินค้าแล้ว" advances
    the order to `done`. Issues block the auto-complete.

### Files touched
- `supabase/migrations/0007_shop_refactor.sql` (new): source enum,
  stock_status, dates_full, shop_pickup_records + RLS.
- `src/js/shop/data.js`: new constants (sources, types, stock-status
  meta, stockKey helper, batchDateEntries helper).
- `src/js/shop/api.js`: pickup-record CRUD (`listPickupRecords*`,
  `upsertPickupRecord`, `resolvePickupIssue`, `deletePickupRecord`).
- `src/js/shop/products.js`: drop fit options, preorder labels,
  stock-status banner, big-card carousel, multi-batch banner stack.
- `src/js/shop/checkout.js`: removed pickup-location radio block,
  drop fit from variant display.
- `src/js/shop/cart.js`: drop fit from variant display.
- `src/js/shop/orders.js`: per-date hours via `batchDateEntries`.
- `src/js/shop/admin.js`: full rewrite of products editor (stock
  matrix, drop fits, stock_status), batches (edit anytime, per-date
  hours + remove rows), new delivery tab.
- `src/html/tab-shop.html`: launch carousel + arrows.
- `src/html/tab-admin.html`: new "การส่งมอบ" tab + refresh button.
- `src/html/modal-shop-product.html`: drop fit group, preorder label,
  stock-status banner.
- `src/css/shop.css`: launch carousel, multi-batch banner styles,
  preorder/sold-out ribbons, OOS card grayscale, stock matrix grid,
  delivery checklist styling, batch-date chips.

### Manual steps to ship
1. Apply `supabase/migrations/0007_shop_refactor.sql` (Supabase SQL editor).
2. Existing products auto-migrate `source` → `md`. Re-tag them
   (RT/MDI/Sittikao) via admin.
3. Existing pickup batches auto-build `dates_full` from `dates[]` +
   shared `hours`. Open each in admin to add per-date times.
4. Smoke test:
   - Shop tab: carousel scrolls; arrow disabled at ends; multi-batch
     banner renders if 2+ active.
   - Mark a product `sold_out` in admin → OOS ribbon shows, card
     grayscaled, Add-to-Cart disabled.
   - Set stock_matrix entry to 0 for a size/color → variant OOS
     warning in modal.
   - Place an order → admin Verify → Approve → Produce → Ready.
   - Delivery tab: tick item → enter recipient name → row turns green.
     Mark another item as issue (wrong_size) → row turns yellow. Resolve
     → green-strikethrough. Tick all → "ปิดคำสั่งซื้อ" appears →
     order goes to done.
5. No GAS redeploy needed (only DB + frontend changed).

### Follow-up: search-first delivery + standalone stock tab (same day)

Iterated on the delivery UX and added a dedicated stock-only tab after
user feedback ("fast easy access, like search customer and tick").

**Delivery tab (rewrite)**:
- Big sticky search bar at top: customer name / order ID / email — narrows live.
- Filter chips: รอส่งมอบ (default) / มีปัญหาค้าง / เสร็จสิ้นวันนี้ / ทั้งหมด.
- Each row leads with the buyer's avatar + name (order ID secondary).
- Progress pill with mini bar (e.g. "2/3").
- **No more `prompt()` popups**: tick auto-fills recipient = buyer_label;
  pencil icon reveals an inline override input.
- Issue button opens an inline form (type dropdown + note input + save),
  not a window.prompt chain.
- When all items ticked → inline green banner with "ปิดคำสั่งซื้อ"
  button (no confirm).

**Stock tab (new)**:
- Search by product name; per-product card with thumb + name + total-stock
  pill + status select.
- Inline size × color grid with −/+ steppers + direct input.
- Cells colour-coded: red `is-zero`, yellow `is-low (≤3)`, green
  `is-ok`, grey `is-unset` (empty).
- Per-card "บันทึก" + "ยกเลิก"; dirty card highlighted yellow.
- PATCH only `stock_matrix` + `stock_status` — image stays untouched.

### Not in this round (deferred)
- Discord/email notification when batch published (could reuse
  existing GAS notify actions).
- Stock auto-decrement on order placement (currently admin updates by
  hand — fine for low volume).
- Product image multi-shot gallery (today: one image_url).
- Customer-facing pickup-record badge in "คำสั่งซื้อของฉัน" — would
  let buyer see "marked picked up by admin on 28 พ.ค." inline.

---


## Branches

`main` at `3fc7cd4` (PR #7 merge). `refactor/modular` HEAD at `8459c65`
— mobile/iPad FAB fix. **Working tree clean, everything pushed.** Build
+ tests green (26/26). Branch ruleset `main-protect` active — direct
push to `main` requires Bypass list membership.

- `main` → `samomdkkuweb.pages.dev` (production)
- `refactor/modular` → `refactorsamomdkkuweb.pages.dev` (preview)

## Previous big merge

`refactor/modular` was merged to `main` (`d91a32a`) as the Supabase cutover.
Two conflicts resolved: `.gitignore` (kept both branches' rules) and
`index.html` (took the slim refactor version over main's 2700-line monolith).
`functions/api/submit.js` deleted — refactor talks to Supabase directly.

## Phase 1.x — Project Tracking UX polish round (2026-05-26 session)

Took the initial project-tracking ship (`c8584e9`) through ~7 iterations
of UX feedback in one session. Final shape locked in. Commits in this
session (newest first):

| Commit | What |
|---|---|
| `8459c65` | Mobile/iPad — adaptive FAB (folder-plus on grid, file-plus inside a project) + `เพิ่มไฟล์` promoted to primary-soft. FAB now visible up to lg (covers iPad portrait/landscape) |
| `b3c9bfd` | Bell notifications — proper `kind` per action (`file_added`, `resent` separated from `file_replaced` / `sent`); 60s → 20s poll; bell refresh on `visibilitychange` + `shown.bs.tab` |
| `180ccc7` | File-level "ใหม่"/"แทนที่ใหม่" pills + orange row background on files uploaded after viewer's last action. Skipped for VPA (they uploaded them) |
| `a3078f6` | VPA `ส่งใหม่อีกครั้ง` button on returned docs (status → sent + clears return_reason + notifies uni). "เปลี่ยนแปลงล่าสุด" banner at top of expand listing other-side actions since viewer's last move. Default labels: "พี่นิค" → "เจ้าหน้าที่" (settings.uni_staff_label override still wins). Owner pill dropped from doc card head (redundant with status pill) |
| `c85d208` | Card simplification — one big attention badge per role: "X ใหม่" (uni) / "X ตีกลับ" (vp). Dropped six per-status mini-chips and the project-status pill from the card head |
| `81a389a` | **Two-level drill-down** (Drive/Outlook/Notion pattern). Final IA. Level 1 = project grid; Level 2 = project detail with breadcrumb back, project header, list of doc cards, click to expand. Replaces the table approach below |
| `35145b5` | (superseded) Spreadsheet/table inbox — flat table of all docs with group-by toggle. Felt "too messy" per user, replaced 50 min later by `81a389a` |
| `f3245d1` | Doc-header chevron toggle + navbar active-pill green-on-green text fix |

### Final UX shape

**Level 1 — project grid**:
- Toolbar: search + 4 filter chips (ของฉัน / รออีกฝ่าย / เสร็จสิ้น / ทั้งหมด)
  with per-bucket counts. Buckets computed via `projectBucket(p, role)`.
- Each card: folder icon + name + id + clamped description + one
  attention badge (orange "X ใหม่" for uni, red "X ตีกลับ" for VPA) +
  "X หนังสือ" + relative time. Left-border colour encodes bucket.
- Mobile FAB bottom-right: green circle, `bi-folder-plus` icon →
  opens create-project modal. VPA + dev only.

**Level 2 — project detail**:
- Breadcrumb back ("← หนังสือโครงการทั้งหมด")
- Project header with id/date, name, description, status pill, action
  row (เพิ่มหนังสือ / status menu / delete / copy link — all VPA-gated)
- Doc cards stacked vertically. Each card head: mine-dot + #seq +
  title/type + "อัปเดต" pill (when applicable) + status pill + time
  + chevron. Click → expands.

**Expanded doc card**:
1. "เปลี่ยนแปลงล่าสุด" banner (orange for uni viewing a `sent` doc;
   red for VPA viewing a `returned` doc) listing other-side actions
   since viewer's last move
2. 4-step stepper (ส่งแล้ว → รับเรื่อง → ดำเนินการ → เสร็จสิ้น) with
   "ตีกลับ" overlay on step 0 if returned, or grayed/strikethrough
   if cancelled
3. doc.note (if present)
4. Files block — each file row shows "ใหม่" (orange pill) or
   "แทนที่ใหม่" (deeper amber) if uploaded after the viewer's last
   action. VPA gets a green "เพิ่มไฟล์" button here.
5. Action row — role-gated buttons. VPA on `returned` doc gets the
   green "ส่งใหม่อีกครั้ง" button.
6. Timeline (collapsible)

**Mobile FAB inside Level 2** flips to `bi-file-earmark-plus` →
adds doc to current project. Same FAB element, adaptive icon + aria.

### What was preserved from the original ship

- Hash routing: `#projects` / `#projects/PRJ-…` / `#projects/PRJ-…/doc/DOC-…`
- All notify pipelines (Discord webhook, GAS MailApp, in-app bell)
- All action handlers (status, return, comment, delete, add files,
  replace file). Notification recipients: uni gets vp's actions, vp
  gets uni's actions — you don't see your own actions in your own bell
- DB schema, RLS policies, GAS deployment — untouched

### Manual verification pending (next session)

Build + tests are green; I did not click through the running app this
session. To verify on `refactorsamomdkkuweb.pages.dev`:

1. **Two sessions needed**: VPA in one browser, sastaff in incognito
   (notifications go to the other side; you can't see your own in
   your own bell)
2. **Mobile/iPad**: FAB visible bottom-right on the grid; tap → create
   project. Drill into a project → FAB flips to file-plus icon → tap →
   add doc to this project. The green "เพิ่มไฟล์" button inside an
   expanded doc should now be obvious in the files panel.
3. **Resend flow**: VPA sends → sastaff ตีกลับ with reason → VPA opens
   → sees red "เจ้าหน้าที่ตีกลับ" banner → clicks green "ส่งใหม่อีกครั้ง"
   → enters change summary → sastaff's bell pops within 20s (or
   instantly if sastaff focuses the tab)
4. **File highlights**: VPA adds/replaces a file on a doc sastaff is
   working on → sastaff opens → file row has orange background + pill
5. **Deep links** still work: open `#projects/PRJ-xxx/doc/DOC-yyy` in
   a fresh tab → drills in to Level 2 with that doc expanded

### Caveats / open questions

- The Drive folder `Projects/` allow-list in GAS uses `uploadProjectFile`.
  GAS redeploy already happened in the original ship — no further redeploy
  needed for this session's frontend-only changes.
- `settings.uni_staff_label` in `project_settings` still overrides the
  "เจ้าหน้าที่" default — if a deployment wants a specific person's name,
  set it in the manage screen.
- Phase 2 candidates list below — none implemented this session.

## Phase 2 candidates — discussed but not built

Brief shortlist of workflow improvements from end-of-session brainstorm,
ordered by ROI (drop these into a future session by name):

1. **Inline comment thread** — replace native `prompt()` with a real
   reply box + chat-bubble thread at bottom of expand. Comments are
   the most-frequent interaction and the worst UX right now. (M effort)
2. **Drag-and-drop file upload** — drop onto the files panel uploads
   with per-file progress. Same on the send modal. (M effort)
3. **Undo toast** for status changes — 8s grace period before commit +
   notification fires. Saves face-palms on misclicks. (M effort)
4. **Due date** column on `project_documents` (nullable). VPA sets it
   on send. Overdue red flag on the card. Needs 1-line migration.
   (M-L effort)
5. Auto-create project when sending the first doc (combo box "เลือก/
   สร้างโครงการ"). Currently 2-step. (S-M effort)
6. Inline PDF/image preview in expand (Drive iframe). Today every file
   opens in a new tab. (M-L effort)

Skipped: bulk actions, "read but not acting yet" state, fuzzy search,
mobile push, reminder/nudge — all premature for current volume.

## Original Project tracking module (2026-05-26 — pre-polish ship)

Brand-new workflow between SAMO VP-Administration (sender) and a single
designated university officer "พี่นิค" (receiver). Each "โครงการ" (project)
contains one or more "หนังสือ" (documents); each document has N attached
files (Word/PDF/Excel/etc.) on Drive. Sender can send, edit, replace
files (non-destructive — old versions kept), cancel, or delete. Receiver
can mark received → in_progress → completed, return for fixes, or
comment. Notifications fan out to in-app bell + email (uni) and in-app
bell + Discord (vp).

**New roles** (CHECK constraints in 0005): `vp_admin` (samomdkkuvpa) +
`uni_staff` (sastaff / pw 1234). Both are seat-style, mirroring
samomdkkupr / samomdkkushop. `current_user_is_project_actor()` helper
gates RLS.

**New files**:
- `supabase/migrations/0005_project_tracking_schema.sql` — six tables
  (project_doc_types, projects, project_documents, project_files,
  project_notifications, project_settings) + RLS + role expansion +
  4 seeded doc types.
- `supabase/migrations/0006_seed_project_accounts.sql` — reserves the
  two usernames.
- `src/js/projects/{data,api,uploads,notify,index,inbox,send,manage,notifications}.js`
  — feature lives in one folder, lazy-loaded on first tab show.
- `src/html/tab-projects.html`, `modal-project-send.html`,
  `offcanvas-project-notify.html`.
- `src/css/projects.css` — all rules scoped under `.projects-tab` (plus
  `.nav-projects-bell` scoped to `.samo-navbar`).

**Edited files**:
- `appscript/prform.gs` — three new actions: `uploadProjectFile`
  (allow-listed to `Projects/...`), `notifyProjectEmail` (MailApp),
  `notifyProjectDiscord` (webhook URL from Script Properties
  `PROJECT_DISCORD_WEBHOOK_URL`). **GAS redeploy required** — see
  `skills/deploy-gas.md`.
- `src/html/navbar.html` — added "หนังสือโครงการ" pill (desktop +
  mobile) and a bell icon in the auth area, both role-gated.
- `index.html` — included the new partials.
- `src/main.css` — `@import './css/projects.css';`.
- `src/js/main.js` — `import { initProjects } …; initProjects();`,
  added `vp_admin` + `uni_staff` to `roleLabel` / `roleBadgeClass`.
- `src/js/auth.js` — added `samomdkkuvpa` and `sastaff` to the
  reserved-usernames list (frontend mirror of 0006).
- `README.md` "Key features" + roles list, `docs/CONTEXT.md` request
  flow, module map, schema section, migrations list.

**Drive layout** (created lazily on first upload, allow-listed to
`Projects/...`):
```
My Drive/
├── PR_Submissions/                  ← unchanged
├── SAMO_Shop/...                    ← unchanged
└── Projects/
    └── PRJ-2605-0001_<safe-name>/
        └── DOC-260526-1430-XXXX_<type>/
            └── <file>.pdf
```

**Hash routing** (new behaviour in main.js / projects/index.js):
- `#projects` — open the tab
- `#projects/PRJ-2605-0001` — open + auto-open that project
- `#projects/PRJ-2605-0001/doc/DOC-…` — open + jump to that doc
- A "คัดลอกลิงก์" button on every project detail head exposes the URL.

**Manual steps to ship**:
1. Apply `0005_project_tracking_schema.sql` + `0006_seed_project_accounts.sql`
   in the Supabase SQL editor (in that order).
2. Supabase Dashboard → Authentication → Add user:
   - `samomdkkuvpa@samomdkku.app` (pick a strong password — you'll use it)
   - `sastaff@samomdkku.app` with password `1234`
   Then run:
   ```sql
   update public.users set role='vp_admin'  where email='samomdkkuvpa@samomdkku.app';
   update public.users set role='uni_staff' where email='sastaff@samomdkku.app';
   ```
3. In the `prform` GAS project → Project Settings → Script Properties,
   add `PROJECT_DISCORD_WEBHOOK_URL` = (the `notify-samodocument`
   webhook URL — given in chat; do NOT commit it).
4. Redeploy `prform` GAS so the three new actions go live (see
   `skills/deploy-gas.md`).
5. Sign in as `samomdkkuvpa` → "หนังสือโครงการ" tab → "การตั้งค่า"
   sub-tab → fill in p'nick's real email + adjust labels if needed.
6. Smoke test: create a test project, send a doc with 1 file, sign in
   as `sastaff` in another browser/incognito, mark received → check
   Discord channel for the webhook ping + check VP-Admin's in-app bell.

**Security note**: the Discord webhook URL was exposed once in chat.
Rotate it after smoke testing (Discord channel → Integrations →
Webhooks → Regenerate) and update the GAS Script Property.

**Not in scope this round** (deferred to Phase 2 UI pass):
- Holistic nav/IA refresh across the whole portal.
- "My bookmarks/favorites" personal home panel for staff.
- Real-time updates (uses refetch-on-open like the rest of the portal).
- Mobile push / browser notifications.

## Previously working — SAMO Shop feature (2026-05-26)

Ported the Claude Design SAMO Shop handoff bundle into the portal as a
new tab + admin section. Vanilla JS + Bootstrap (matches the rest of the
codebase), real Supabase backend, slip + product images uploaded to
organised Drive folders via a new GAS action.

**New files**:
- `supabase/migrations/0003_samoshop_schema.sql` — shop_products,
  shop_orders, shop_order_items, shop_pickup_batches, shop_settings;
  RLS policies; new `shop_admin` role; helper
  `current_user_is_shop_admin()`.
- `supabase/migrations/0004_seed_shop_admin.sql` — reserves
  `samomdkkushop` username (mirrors the 0002 pattern).
- `src/js/shop/{data,api,state,uploads,products,cart,checkout,orders,admin,index}.js`
  — feature lives in one folder, lazy-loaded on first tab show.
- `src/html/tab-shop.html`, `modal-shop-product.html`,
  `offcanvas-shop-cart.html`, `modal-shop-order-detail.html`.
- `src/css/shop.css` — all rules scoped under `.shop-tab`.

**Edited files**:
- `appscript/prform.gs` — new `uploadShopFile` action with `folderPath`
  param, walks/creates nested folders under My Drive, allow-listed to
  `SAMO_Shop/...`. **GAS redeploy required** — see
  `skills/deploy-gas.md`.
- `src/html/tab-admin.html` — added SAMO Shop landing card +
  `#adminShopSection` (orders / verify / batches / products / QR).
- `src/html/navbar.html` — added "ร้านค้า" pill (desktop + mobile).
- `index.html` — included the new partials.
- `src/main.css` — `@import './css/shop.css';`.
- `src/js/main.js` — `import { initShop, openShopAdmin } …`; broadened
  `isStaffRole` to include `shop_admin`; admin auto-route handles
  `shop_admin`; `openAdminSection('shop')` calls `openShopAdmin()`.
- `src/js/auth.js` — added `samomdkkushop` to reserved usernames list.
- `README.md` "Key features" + `docs/CONTEXT.md` (architecture, schema,
  RLS, Drive folder layout).

**Drive layout** (created lazily on first upload):
```
My Drive/
├── PR_Submissions/                 ← unchanged
└── SAMO_Shop/
    ├── Slips/YYYY-MM/<buyerId>_<ts>.jpg
    ├── Products/<productId>/<name>_<ts>.jpg
    └── QR/promptpay_<ts>.png
```

**Manual steps to ship**:
1. Apply `0003_samoshop_schema.sql` + `0004_seed_shop_admin.sql` in the
   Supabase SQL editor (in that order).
2. Create `samomdkkushop` in Supabase Dashboard → Authentication → Add
   user (synthetic email `samomdkkushop@samomdkku.app`), then
   `update public.users set role='shop_admin' where email='samomdkkushop@samomdkku.app';`.
3. Redeploy the `prform` GAS project so `uploadShopFile` is live (see
   `skills/deploy-gas.md`).
4. Sign in as `samomdkkushop` → Admin → SAMO Shop → set PromptPay name,
   id, instructions, and upload a QR image. Add a few products. Then
   smoke a guest flow (browse → add to cart → checkout → upload slip →
   appears in admin Verify queue).

**Not in scope this round**:
- Discord notification on new order — easy to add later via the existing
  GAS `notifyPROnly` shape.
- Real PromptPay EMVCo dynamic QR — admin uploads a static PNG instead;
  cheaper to maintain and matches the design.

## Most recent merge

PR #9 (`ui/font+color`, by Kita) → `refactor/modular` as **squash commit
`b4d7048`** on 2026-05-25. Branch carried 11 iterative WIP commits;
collapsed into one entry. Two best-practice passes were layered on top
of her work before merge:

- **Critical**: scoped the new `.dropdown-menu` opacity/visibility rule to
  `#toolsDropdown`/`#aboutDropdown` only. The original blanket selector
  hid the signed-in user-profile dropdown (still on Bootstrap's `.show`
  class which doesn't touch opacity).
- Restored the font fallback chain so the body stays readable if
  Google Fonts is blocked: `"Noto Sans Thai", "Prompt", system-ui,
  -apple-system, "Segoe UI", sans-serif`.
- De-duplicated `--dept-hover-media` (was identical to
  `--dept-hover-external`); media now gets `#176581`.
- Introduced `--vs-accent: #2C8F8A` token; replaced three hardcoded
  hex copies in navbar.html + tab-home.html (VS keeps its teal
  identity even though `--dept-quality` shifted to a light green).
- Fixed yellow-on-white contrast on `.policy-category-header.creative`
  — header text and count badge now use `var(--brand-primary)` on
  yellow.
- Closed two missing `;` in tab-home.html dept-card style attrs.
- Removed dead `aboutOpened` / `toolsOpened` refs from
  `resetDropdownStates()` (never declared anywhere).
- Trailing newlines on `src/css/navbar.css` and
  `src/html/footer.html`.

Second pass on the same branch — closed the items I previously left
in place:

- Deleted ~100 lines of bespoke dropdown JS in `main.js` (the
  `show-dropdown` class, `closeAllDropdowns` /
  `resetDropdownStates`, the about/tools click+touch handlers, the
  global outside-click handler, the DOMContentLoaded #pills-tab
  handler). The dropdowns now rely on Bootstrap's native `.show`
  class. The existing `shown.bs.tab` handler was upgraded to also
  strip `.show` from the dropdown-toggle (Bootstrap leaves it
  attached after a tab-JS-driven activation) and to clear the
  `.active` we set on `#aboutDropdown` when a non-about tab takes
  over.
- `goToAbout` is back to its compact pre-PR form plus an explicit
  `.active` add on `#aboutDropdown` (because `#pills-about-tab` is
  hidden — Bootstrap can't visibly mark it).
- Replaced `.show-dropdown` selectors in `navbar.css` with `.show`;
  restored `.dropdown-toggle.show` to the green-pill highlight rule
  so the trigger lights up while the menu is open. Fade is now a
  simple opacity transition on `.show`, scoped to the two managed
  menus only.
- Moved per-tab shadow tokens (`--form-shadow`, `--btn-shadow`,
  `--btn-hover-shadow`) out of inline `style=""` and into scoped
  CSS in `base.css` under `.vs-tab` and `.an-tab`. `forms.css`
  carries the pink defaults via `var(..., default)` fallback, so
  the PR form (no tab class) renders the default without any inline
  override.
- Removed the hardcoded `5 ข้อ` / `4 ข้อ` / `3 ข้อ` policy badges +
  their CSS — counts were drift-prone and the numbered `01, 02, 03…`
  prefix already shows the size implicitly.
- Fixed a stray `</div>` near the end of the policy section in
  `tab-about.html` and lifted the `<h3>` policy title to `<h2>`
  to match the other about-sections' heading level.
- Declared `.about-hero-title { font-weight: 700 }` instead of `800`
  — only weights 300–700 are loaded from Google Fonts, so 800 was
  silently falling back.
- Consolidated the duplicate `.policy-ordered-list` rule in
  `cards.css` (the PR had two — declarations and counter-reset
  separated).

New about-page copy + 3-card 3C mission + policy section content
are Kita's authored decisions and are accepted as-is.

Previously: The multi-project engine refactor proposed in
`docs/PROJECT-ARCHITECTURE.md` is **deferred** — the user wants
readable/maintainable improvements opportunistically (as we touch each
module) rather than a multi-week planned refactor. The proposal doc
stays as future reference.

Last small feature: delete-announcement button (modal-announcement.html
+ announcements.js `deleteCurrentAnnouncement`, RLS-gated, dbRest with
return=representation + length check).

Collaboration scaffold: added `CONTRIBUTING.md` (branch model, touch-zone
table for what a colleague can self-merge vs. what needs review, hard
"don'ts" mirrored from `mistakes.md`). README + CLAUDE.md cross-link to
it.

Unit tests (Vitest, 26 tests across `src/js/utils.test.js` and
`src/js/uploads.test.js`) cover the security-critical pure helpers:
`escHtml`, `safeUrl`, `convertDriveUrl`, `formatThaiDate`,
`decodeJwtResponse`. `npm test` now runs in CI before `npm run build`.
~150 ms total. No DOM mocking, no network — pure functions only.

Most recent change: second audit pass closed XSS class across ticket
renderers + dead-code admin auto-routing bug. See `2nd audit` row
below.
1. Closed six RLS-silent-success sites + announcement button label +
   VS ticket-ID collision + fragile selector.
2. Cleanup pass: partial-upload state in error message, `fileInput.value=''`
   after reset (latent), `decodeJwtResponse` input guards, `escHtml` helper
   in utils.js applied to announcement renderers (title/dept/snippet only —
   `post.content` stays raw Quill HTML), two stale "sendBeacon" comments,
   one unused import.
3. Dead-code removal: deleted `supabase/functions/notify-pr/` and
   `notify-vs/` (~300 LOC of Deno code that was returning 502 — Discord
   stays on GAS by design now). Trimmed 8 stale references across docs
   and agent rules; net -411 LOC.
4. Migration-tool removal: deleted `tools/migrate-from-sheets.mjs`
   (529 LOC), `sheetexample/` (~800 KB student data dumps; already
   gitignored so never on GitHub), `skills/migrate-data.md`,
   `skills/recover-ticket.md`. Removed `npm run migrate` from
   package.json + the unused `dotenv` dep. Updated 6 doc files to
   remove the now-dead references.

## Recent fixes (latest first, last ~10 commits)

| Commit | What |
|---|---|
| _(this commit)_ | 2nd audit pass: close XSS class across 6 ticket renderers (escHtml + safeUrl applied), fix admin auto-route reading stale `localStorage('samoUser')`, fix `convertDriveUrl` regex on no-trailing-slash URLs, consolidate the duplicate `escapeHtml` helper in pr-staff into utils.js, strip one more stale "sendBeacon" comment |
| `f309955` | Remove one-shot migration tool: tools/migrate-from-sheets.mjs, sheetexample/, two skills, dotenv dep, npm run migrate, 11 references |
| `49d4ca1` | Remove dead Edge Function source (notify-pr, notify-vs) + 8 stale doc references. Discord stays on GAS by design |
| `a91fa17` | Audit cleanup pass: partial-upload state in pr-form error msg; `fileInput.value=''` after reset; `decodeJwtResponse` guards; `escHtml` helper + applied to announcement renderers; stale comments; unused import |
| `6a8193e` | Audit pass: close 6 RLS-silent-success sites (pr-staff status/delete/agents, vs-staff status, vs-tracking remarks, auth.setDepartment); fix announcement publish-btn label after edit; VS ticket-ID collision; selector |
| `acc3ef1` | Docs pass 2: rewrite stale `README.md`, add Developer workflows section to `docs/CONTEXT.md`, add conditional rule 4 to CLAUDE.md auto-update loop |
| `ca20e10` | Memory system: CLAUDE.md router + STATE.md + `.claude/rules/` + `skills/` + `docs/CONTEXT.md` + CI build |
| `edaacc1` | Sort PR/VS tickets by `timestamp` (not `created_at`) — avoids needing a backfill |
| `5df7f65` | Migrate script writes `created_at` from CSV timestamp (defense in depth) |
| `92c039b` | Gate auth-subscriber side-effects (showAdminLanding, modal close, VS form autofill) on real transitions only — fixes "kanban resets when switching tabs" |
| `4779c88` | Migrate other_platforms + other_platform_reason (silently dropped, CSV cols 21/22 have empty headers) |
| `074d653` | Migrate assignees from CSV col 20 via positional `_raw[20]` access |
| `5493c11` | THE big one — wrap onAuthStateChange body in `setTimeout(0)` to escape supabase-js auth-lock deadlock (issue #762) |
| `d97756f` | Add `dbRest()` raw-fetch helper in `db.js`; convert PR tracking calls |
| `58d1ead` | Bypass supabase-js for PR/VS inserts using raw fetch + AbortController |

## Open / deferred

- **Phase 4 file storage**: deliberately staying on Drive (2 TB) instead of
  Supabase Storage (1 GB free tier). Documented in `docs/SUPABASE-MIGRATION.md`.

## Known caveats

- Discord notifications travel through GAS `notifyPROnly` / `notifyVSOnly` /
  `notifyVSConsult` actions. Both prod GAS deployments must have the slim
  `appscript/*.gs` (104 + 154 lines) code live.
- Drive uploads also go through GAS `uploadPRFile`. Same redeploy requirement.
- Synthetic email domain is `samomdkku.app` (NOT `.local`). Supabase Auth
  rejects RFC-reserved TLDs. Don't switch back.
- Supabase auto-refresh is **disabled** in `db.js`; a 25-min `setInterval`
  calls `refreshSession()` instead. Don't re-enable `autoRefreshToken` without
  reading `.claude/rules/mistakes.md` first.

## Reproducible smoke tests

After any deploy:

1. Sign in with Google + a fresh password account
2. Submit a PR ticket — Discord pings, row in Supabase
3. Submit a second PR ticket without reloading — must succeed (regression test for the deadlock)
4. Submit a VS ticket — Discord pings target dept
5. Admin → PR Management → kanban shows tickets in correct chrono order, dept filter works
6. Edit an announcement (as `samomdkkupr` or `samomdkkudev`) — changes persist
