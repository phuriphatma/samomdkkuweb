# STATE — current task & latest known state

Last updated: 2026-05-26

## Branches

`main` at `3fc7cd4` (PR #7 merge). `refactor/modular` at `b4d7048`
(PR #9 merge — UI/font/colour refresh) **plus uncommitted SAMO Shop
work** (see "Currently working" below). Branch ruleset `main-protect`
is active — direct push to `main` requires you to be in the Bypass
list; otherwise opens a PR (which is what the colleague will do).

- `main` → `samomdkkuweb.pages.dev` (production)
- `refactor/modular` → `refactorsamomdkkuweb.pages.dev` (preview)

## Previous big merge

`refactor/modular` was merged to `main` (`d91a32a`) as the Supabase cutover.
Two conflicts resolved: `.gitignore` (kept both branches' rules) and
`index.html` (took the slim refactor version over main's 2700-line monolith).
`functions/api/submit.js` deleted — refactor talks to Supabase directly.

## Currently working — SAMO Shop feature (2026-05-26)

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
