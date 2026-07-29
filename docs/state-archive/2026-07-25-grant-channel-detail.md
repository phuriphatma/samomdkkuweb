# Grant-channel detail — 0093 / 0094 / 0095 (archived 2026-07-29)

Pruned out of `STATE.md` to hold it under the ~200-line budget. All of it is
still true and still applied; it is just settled enough not to need the hot
path. The rules it carries are also in `.claude/rules/mistakes.md`.

**SAMO Shop is ONE role — the 0093 scope was REVERTED by 0094.** Every shop admin
manages every แหล่งที่มา; there is no per-source grant and the picker is gone.
`current_user_is_shop_admin()` is back to `role in (shop_admin,dev) OR
has_permission('samoshop')`, and `shop_products` writes are back on it. The
`shop_source` / `managed_shop_sources` COLUMNS remain but are inert — nothing
reads them. Drop them whenever (`alter table … drop column …`, listed in 0094's
header) and strip them from sync/recompute/users_self_update_guard. **Do not
re-add a source scope without being asked**: the reason it was declined is that
orders can't be scoped (one order holds items from several sources), so a
product-only scope isolates nothing anyone cares about.

**The READ half of the grant channel (0093 part B, KEPT).** Three policies gated
on `current_user_is_staff()` — a bare role list — excluded tree-granted accounts:
`announcements_read` (a `creator` grantee could WRITE a draft and not see it,
which is what broke เขียนประกาศ/ลำดับการแสดงประกาศ), `vs_followers` /
`vs_public_comments` (→ `current_user_is_vs_handler()`), and `analytics_events`
(→ new `current_user_has_any_grant()`). `current_user_is_staff()` itself was NOT
widened — `users_self_update_guard` trusts it for privileged-column writes, so
widening it would let any grantee self-promote to `dev`
(`tools/grant0093-reads.mjs` asserts this with a real attempt).
**Three role-only policies REMAIN BY DESIGN — do not "fix" them**:
`users_update_staff` (broadening it lets a grantee edit other people's rows),
`notify_log_select_staff` and `reserved_staff_usernames_read_staff` (internal
diagnostics / non-load-bearing reference data). Re-run the sweep after any RLS
change: flag policies matching `current_user_role|current_user_is_staff` that do
NOT also match `has_permission|managed_|_scope|_seats`; the expected count is 3.

**The อาจารย์ seat grants the อาจารย์ ROLE (0095, APPLIED).** Every prof gate used
to key on `sign_requests.prof_id = auth.uid()`, so a seat holder got a brand-new
professor with an EMPTY desk while `saprof` showed 11. อาจารย์ is one shared
institutional role (like เจ้าหน้าที่คณะ), so `prof_can_see_document/_project/_file`
+ the sign-request read/update policies + `scopeProjectsForRole` /
`docPendingSignForProf` / the file filter now ask "am I อาจารย์, and was this sent
for signature?". Verified: seat and saprof both see 11 of 26.
**Still NOT an actor** — the other 15 หนังสือ stay invisible, private drafts inside
a requested หนังสือ stay filtered, and a professor still cannot create a project or
request a signature. **Tradeoff**: every อาจารย์ sees every signature request. Right
for one shared role; if per-professor privacy is ever wanted, restore the uid check
PLUS a "which professor" dimension — a plain revert re-empties the seat.

