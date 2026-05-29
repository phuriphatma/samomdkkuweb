# STATE — current task & latest known state

Last updated: 2026-05-30. Slim by design — answers "what is true right
now". Past session narratives live in `git log`; architecture lives in
`docs/CONTEXT.md`; bug post-mortems live in `.claude/rules/mistakes.md`.

If you want history: `git log --oneline -50`.

## Branches

- `main` HEAD: latest production. Auto-deploys to
  `samomdkkuweb.pages.dev`.
- `refactor/modular` HEAD: synced to main (preview branch). Auto-deploys
  to `refactorsamomdkkuweb.pages.dev`.
- Build green, 53 tests pass (`npm test`).
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
```

## Active work / TODO

Nothing in flight on the working tree.

Next-session candidates (priority order):

1. **Apply 0023–0025 on prod** before exercising the new shop flows in
   anger.
2. **Editable internal product id**: deferred. Needs a FK cascade
   migration on `shop_order_items.product_id` (currently
   `on delete restrict`, no `on update cascade`).
3. **9arm-skills install**: optional — install via
   `npx skills add thananon/9arm-skills` if/when needed.
4. **Discord nudge for VP idle tickets**: scheduled cron / Edge
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
