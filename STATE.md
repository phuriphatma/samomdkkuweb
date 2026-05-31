# STATE — current task & latest known state

Last updated: 2026-05-30. Slim by design — answers "what is true right
now". Past session narratives live in `git log`; architecture lives in
`docs/CONTEXT.md`; bug post-mortems live in `.claude/rules/mistakes.md`.

Build green, 45 tests pass (`npm test`).

If you want history: `git log --oneline -50`.

## Branches

- `main` HEAD: latest production. Auto-deploys to
  `samomdkkuweb.pages.dev`.
- `refactor/modular` HEAD: synced to main (preview branch). Auto-deploys
  to `refactorsamomdkkuweb.pages.dev`.
- Working tree clean unless this file says otherwise below.

## Pending DB migrations (Supabase `fheueuowbchsnsvbcgil`)

Apply in numeric order via the SQL editor. JS callers degrade gracefully
when missing, so the site keeps working — but features behind each
migration won't function until it's applied.

| Migration | What it unlocks | Status |
|---|---|---|
| 0008–0022 | (everything up to + including 'exchange' status) | **applied** |
| 0023_shop_product_code.sql | `<CODE>NNNN` order ids; `shop_products.code` column + backfill | ❌ pending |
| 0024_shop_product_production_status.sql | `production_status` column + `apply_product_production_status()` RPC (cascades on product toggle) | ❌ pending |
| 0025_shop_orders_paid_cascade.sql | BEFORE-UPDATE trigger: order INTO 'paid' auto-advances per product status | ❌ pending |
| 0026_profile_email_and_order_contact.sql | `lookup_email_by_username` RPC (username login keeps working after a real email is verified); auth.users.email → public.users.email mirror trigger; `shop_orders.buyer_name` + `buyer_email` | ❌ pending |
| 0027_username_case_and_has_password.sql | Case-insensitive `lookup_email_by_username`; `users.has_password` column + trigger mirror of `auth.users.encrypted_password` (reliable UI gate for "Set password" vs "Change password" — supabase-js's identity array lies for Google-only users who added a password via `updateUser({password})`) | ❌ pending |
| 0028_users_self_update_guard.sql | **Security fix**. BEFORE-UPDATE trigger that blocks non-staff from changing `role`, `permissions`, `method`, `id`, `has_password`, or `username` (after first set) on their own profile row. Without this, any signed-in user could PATCH `/users` and self-promote to `dev` since `users_update_self` is row-level only, not column-level. | ❌ pending |
| 0029_shop_preorder_price.sql | `shop_products.preorder_price` column (nullable). Pairs with the existing `is_presale` flag: when true and the column is set, buyers see the preorder price; when null, falls back to `price`. Behaviour (unlimited buying + hidden stock counts in preorder mode) is JS-only, so this migration is the ONLY schema piece needed for the new mode. Pre-apply, `upsertProduct` drops the field on a 400 and warns once. | ❌ pending |
| 0030_shop_stock_safety_and_preorder_tag.sql | Stock safety + preorder tag. Adds `shop_orders.is_preorder` (frozen at order time → admin can filter "show only preorders"). Adds `shop_reserved_matrix_all()` RPC so the buyer sees `available = max(0, stock - reserved)` instead of the raw admin number. Adds `place_shop_order()` RPC that locks the relevant product rows + re-reads reservations under the lock + inserts header + items atomically — concurrent buyers serialise behind the lock so the last one in line gets OUT_OF_STOCK instead of an oversell. Pre-apply, JS falls back to the legacy 2-step createOrder (no atomic check) and the reserved-matrix fetch returns {} (buyer sees raw stock_matrix again). | ❌ pending |

Verify after applying:

```sql
-- 0023
select column_name from information_schema.columns
  where table_schema='public' and table_name='shop_products' and column_name='code';

-- 0024
select pg_get_functiondef('public.apply_product_production_status(text,text)'::regprocedure);

-- 0025
select tgname from pg_trigger
  where tgrelid='public.shop_orders'::regclass and not tgisinternal;

-- 0026
select pg_get_functiondef('public.lookup_email_by_username(text)'::regprocedure);
select column_name from information_schema.columns
  where table_schema='public' and table_name='shop_orders'
    and column_name in ('buyer_name','buyer_email');

-- 0027 (case-insensitive lookup; has_password column + trigger)
select column_name from information_schema.columns
  where table_schema='public' and table_name='users' and column_name='has_password';
select tgname from pg_trigger
  where tgrelid='auth.users'::regclass and tgname like '%password_sync%';

-- 0028 (self-update guard)
select tgname from pg_trigger
  where tgrelid='public.users'::regclass and tgname='users_self_update_guard';
```

After 0028 — verify the privilege-escalation hole is closed. Sign in
as a regular user and try via the browser console (replace `<uid>`):
```js
fetch(`${supabaseUrl}/rest/v1/users?id=eq.<uid>`, {
  method: 'PATCH',
  headers: { apikey, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: '{"role":"dev"}'
}).then(r => r.text()).then(console.log)
```
Should respond with the `users_self_update_guard` error, not a 200.

## Supabase config for the profile email-add flow (0026)

**Do NOT flip "Confirm email" ON.** Earlier guidance in this file got
it backwards — see `.claude/rules/mistakes.md` "Email confirmation
must be OFF in Supabase for synthetic emails". With confirmation ON,
Supabase tries to email-verify the synthetic `<user>@samomdkku.app`
address at signup, bounces, and after 3 attempts the entire project
hits the email rate-limit and registration breaks for everyone.

Keep:
- Authentication → Providers → Email → **Confirm email: OFF**
- Authentication → URL Configuration → Redirect URLs include both
  `https://samomdkkuweb.pages.dev/**` and
  `https://refactorsamomdkkuweb.pages.dev/**`.

Consequence — and what the code accommodates:

- `db.auth.updateUser({email})` updates `auth.users.email`
  *immediately* without sending a verification link (because Confirm
  email is OFF). The profile UI reflects this: the success message
  reads "บันทึกอีเมลแล้ว" instead of "ส่งลิงก์ยืนยัน".
- The actual proof-of-ownership step for "add email and use it to
  sign in via Google" is the `linkIdentity` Google OAuth round-trip
  — Supabase only links a Google identity whose OAuth email matches
  the user's auth email. Someone who saves an email they don't own
  cannot complete the link step.
- For users who only need a contact email (no Google link), the
  email is taken on trust. Acceptable for this app's threat model.

If true email-verification is needed later (gap noted in TODO below),
the path is: add a server-side OTP via Apps Script (uses Gmail
daily quota, not Supabase's 3/hour SMTP) + a `verify_email_otp` RPC
that admin-updates `auth.users.email`. Out of scope this round.

## Identity linking — quirks worth knowing

Manual linking (the API the profile modal's "เชื่อมต่อ Google" /
"ยกเลิกการเชื่อม" use) is marked **beta** by Supabase. Behaviors that
have bitten this codebase:

- **Unlink requires ≥2 identity rows**, not just "another way in".
  `updateUser({password})` adds a password column but doesn't
  reliably create an `email` identity. See mistakes.md "Supabase
  `unlinkIdentity` requires ≥2 identities" — the UI gates on both
  `hasPassword` AND `identities.length >= 2`.
- **Automatic linking** is enabled by default: signing in via Google
  for the *first* time with an email that already matches an
  existing user auto-links the new identity to that user and
  removes any *unconfirmed* identities. Confirm-email is OFF in this
  project, so all our identities are auto-confirmed — the removal
  step doesn't bite. Don't flip Confirm-email ON without thinking
  about this.
- **SAML SSO users are excluded from linking.** Not relevant — we
  don't use SAML.

## Active work / TODO

Nothing in flight on the working tree.

### Apps Script — redeploy needed
`appscript/prform.gs` now exposes:
- `deleteShopFile` (admin shop order-delete trashes the slip image)
- `deleteProjectFile` (VPA can delete a single หนังสือ file from Drive)

Redeploy the GAS web app once: see `skills/deploy-gas.md`. Until
redeployed, shop-order/หนังสือ file delete still works on the DB side
— but the files orphan in Drive (30-day Trash auto-purges them
anyway).

Next-session candidates (priority order):

1. **Apply 0023–0028 on prod**. 0028 closes a privilege-escalation
   hole (any authenticated user could PATCH `/users` to set
   `role='dev'`); apply it ASAP. Do NOT flip "Confirm email" ON — see
   the "Supabase config for the profile email-add flow" section below.
   Also enable Authentication → "Manual linking" so `linkIdentity` /
   `unlinkIdentity` work for the profile Google-connect flow.
2. **(Optional, when needed) True email-verification for profile-add**:
   send a 6-digit OTP from Apps Script (uses Gmail's daily quota,
   not Supabase's rate-limited SMTP); verify server-side; admin-update
   `auth.users.email`. See the "Supabase config" section for the
   gap this would close.
3. **Editable internal product id**: deferred. Needs a FK cascade
   migration on `shop_order_items.product_id` (currently
   `on delete restrict`, no `on update cascade`).
4. **9arm-skills install**: optional — install via
   `npx skills add thananon/9arm-skills` if/when needed.
5. **Discord nudge for VP idle tickets**: scheduled cron / Edge
   Function pinging Discord when a VS ticket sits in รออุปนายก >3 days.
   Spec only, no code.

## Smoke test after deploy

After Cloudflare rebuilds both pages projects:

1. Public `samomdkkuweb.pages.dev` returns 200 at `/`, `/pr`,
   `/vssound`, `/shop`, `/tools`, `/about`, `/news`, `/news/{id}`,
   `/admin/`.
2. Submit a VS ticket as guest → success card shows → copy button
   copies → paste into "ค้นหาสถานะ" finds it (RPC `get_vs_ticket_by_id`).
3. Sign in as a staff account on Android Chrome → modal closes, avatar
   appears (no spinner-then-nothing regression).
4. `/admin/` as dev → orders tab → open an old order → status chips
   show product **names** (not raw ids) → change status → "อัปเดต"
   button writes it.
5. After 0023 applied: place a new order; id format `<CODE><NNNN>`.
6. After 0024 + 0025 applied: set a product's production_status to
   announced → existing 'paid' orders cascade; newly approved 'paid'
   orders auto-advance to 'ready'.
7. After 0026 applied + Supabase email-confirm ON: open user dropdown
   → "จัดการบัญชี" → add a real email → click the link in inbox →
   refresh; badge flips to "ยืนยันแล้ว". "เชื่อมต่อ Google" button
   enables. Sign out, sign back in with username/password — it still
   works (RPC now points to the real email). Sign in with that
   email's Google — same account.
8. Customer order card → "แสดง QR" → SVG QR shows. Admin → orders
   tab → "สแกน QR" → camera opens → scan the customer's QR → admin
   order modal opens with that order. Manual entry below the
   viewfinder still works if camera permission is denied.
9. iPad scanner: the camera dropdown should appear with both
   front/back lenses; back camera selected by default; if
   getUserMedia is refused, the "อัปโหลดรูป QR" + manual entry
   fallbacks remain usable.
10. Admin orders tab: facet dropdowns ("สถานะ", "สินค้า") let you
    pick multiple values per facet (within-facet OR), badge shows
    the count. Combining facets is AND. "ล้างตัวกรอง" wipes all at
    once.
11. Admin "ส่งออก CSV" downloads the currently-filtered orders
    with Thai chars rendering correctly in Excel (UTF-8 BOM).
12. Admin deletes an order whose slip is on Drive → the row
    deletes immediately, the slip is moved to Drive Trash within
    a few seconds (best-effort; check
    https://drive.google.com/drive/trash if you don't see it).
    Requires the GAS redeploy noted above.
13. Admin deletes one order → toast → opens another order's modal:
    the "ลบคำสั่งซื้อ" button should be in idle state (not stuck on
    "กำลังลบ…"). Was a state-leak bug.
14. Admin orders table: tapping the copy icon next to an order id
    copies, briefly flips to a check, but does NOT also open the
    detail modal. The chip used to bubble; now stopped.
15. Customer order in `pending` / `review` / `slip_mismatch` shows
    an "อัปโหลดสลิป" / "เปลี่ยนสลิป" affordance with status-appropriate
    copy. Replacing the slip trashes the previous file from Drive.
    Hidden once the order passes verification.
16. Customer product card + modal show "เหลือ N ชิ้น" when admin
    has filled the stock matrix. Low (≤5) gets warning tint; 0 gets
    "หมดแล้ว" red. NOTE: this reads the matrix as-is — orders do
    NOT auto-decrement. Admin must maintain the matrix; the stock
    view summary helps with the math.
17. Admin stock view: each product card now shows
    "บนเว็บ X · จองแล้ว Y · ส่งมอบแล้ว Z · ค้างส่ง W · คาดว่าจะคงเหลือ
    หลังส่งทั้งหมด V" so admin can decide how much to produce/order
    next without doing arithmetic. Also includes the "สถานะผลิต
    สินค้านี้" cascade dropdown (same control as the product editor),
    so admin can flip production status straight from stock view.
18. Customer can't add an out-of-stock variant. With the matrix
    configured: missing key OR value ≤ 0 blocks. Size/color buttons
    for fully-OOS variants are greyed + strikethrough + disabled.
    The product modal defaults to the first IN-STOCK combo when
    matrix is configured.
19. Admin stock view also shows per-cell reservation: under each
    matrix input you'll see "เหลือ K" (= matrix value − reserved)
    plus "จอง N" only when N > 0. The whole cell-wrap goes red-bordered
    when over-sold. Cancellation / refund / slip_mismatch / no_show /
    exchange DO NOT count toward "จอง" — so admin marking an order
    cancelled automatically frees that qty.
20. Stock card has a single big "พร้อมขาย N ชิ้น" headline (green /
    yellow / red / dark-red bands depending on the number), a one-
    line condensed subline (ในคลังรวม · ลูกค้าจองอยู่ · ส่งมอบแล้ว),
    and the production-status dropdown is just the dropdown plus an
    (i) tooltip (no more long paragraph under it).

## Routing — what to read for what

| Looking for | Read |
|---|---|
| Project rules, file placement, end-of-turn loop | `CLAUDE.md` |
| Architecture, RLS, schema, deploy plumbing | `docs/CONTEXT.md` |
| Anti-patterns / bug post-mortems / sharp edges | `.claude/rules/mistakes.md` |
| API key hygiene | `.claude/rules/security.md` |
| Merge checklist (refactor → main) | `docs/MERGE-CHECKLIST.md` |
| Multi-step workflows | `skills/*.md` |
| History of any feature | `git log --oneline --grep='<topic>'` |
| Who shipped what when | `git log --since=YYYY-MM-DD --until=YYYY-MM-DD --oneline` |

## When STATE.md gets bloated again

If a future session lands big work and this file balloons past ~200
lines, prune aggressively:

- **Past session narratives** → move the current contents to
  `docs/state-archive/YYYY-MM-DD.md` so the rich detail is preserved
  for whoever wants to read it, then rewrite STATE.md fresh.
  (Archive dir is gitignored from Cloudflare's build but tracked in
  git — see `docs/state-archive/2026-05-30-pre-slim.md` for the
  example we kept from the day this rule was written.)
- Big architecture write-ups → move to `docs/CONTEXT.md`
- Reusable workflows → move to `skills/*.md`
- New bug classes → append to `.claude/rules/mistakes.md`
- Cross-conversation user facts → save to auto-memory (see
  `/Users/xeno/.claude/projects/.../memory/`)

This file's job is to answer "what is true right now" in under 200
lines, not to be a project diary.
