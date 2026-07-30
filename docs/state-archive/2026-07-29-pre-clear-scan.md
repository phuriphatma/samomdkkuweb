# Pre-/clear security scan — 2026-07-29

Moved out of `STATE.md` on 2026-07-30 (all four fixes are shipped, deployed, and
carry their own `mistakes.md` entries; this is the narrative record). Migrations
`0100` + `0101`, commit `397ff56`.

A deliberate sweep, not a spot-check. Everything below was proven against the
live DB in rolled-back transactions before being fixed, and re-proven after.

1. **A buyer could zero their own order's total** (0100). `shop_orders_update_self_early`
   is row-level with no column guard: `total=0, subtotal=0, fee=0` ACCEPTED,
   plus `admin_note` and a `timeline` entry forged as `by:"admin"`. They could
   NOT escape the pending/review window (the USING doubles as the CHECK), which
   is the only thing that contained it. **Third table with this exact defect**
   after `users` (0028) and `vs_tickets` (0096). Proof:
   `tools/shop0100-buyer-guard.mjs` (12 checks — 5 attacks blocked, and the 3
   real buyer call sites in `src/js/shop/api.js` replayed to prove checkout
   still works).
2. **`get_pr_ticket_by_id` matched with `ILIKE`** (0101) — so the ticket id was
   a PATTERN, not a capability. `{"p_id":"%"}` with the public anon key
   returned a real ticket incl. the submitter's email and brief; pattern-walking
   enumerates all of them. Now `lower(id) = lower(btrim(p_id))`. The VS twin
   already used `=` and was verified unaffected with the same probe.
3. **The ten team resolvers were anon-callable** (0101) — an anonymous oracle:
   `effective_team_permissions_for_email` returned any address's exact grant
   set. Revoked from `anon`/`authenticated`/PUBLIC; nothing outside SQL called
   them and their real callers are SECURITY DEFINER.
   `sync_my_team_permissions()` KEPT its `authenticated` grant — `auth.js` calls
   it every login and it only resolves the caller's own identity.
4. **The `vis` ladder's SQL and JS implementations disagreed** on 3 of 26
   inputs (`'t'`, `'1'`, `1` for the legacy `internal` flag). Failed SAFE (the
   server stripped an entry the client would also have hidden), but it is the
   drift "keep them in step" was supposed to prevent.
   `tools/vs-remark-vis-mirror.mjs` now diffs them mechanically over every legal
   and malformed shape.

The two live conclusions from this scan — the knowingly-accepted pair of
unguarded owner UPDATE policies, and the XSS re-audit that was NOT done — stay
in `STATE.md`, because a future change still has to respect them.
