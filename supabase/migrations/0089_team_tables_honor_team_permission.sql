-- ============================================================
-- 0089 — the `team` permission must actually let you manage ทีม SAMO
--
-- BUG (reported live): phuriphat.ma@kkumail.com was granted the ทีม SAMO
-- permission through the tree, switched to that account, and every tree edit
-- failed with "บันทึกไม่สำเร็จ (สิทธิ์ไม่พอ)" — including the edit that would have
-- granted เขียนประกาศ to someone, which is why that looked like a second,
-- separate failure. It is one bug: the account could not write to the tree AT
-- ALL, so no grant could be made from it.
--
-- Cause: 0046 gated both team tables on ROLE only —
--   using (current_user_role() = any(array['vp_admin','dev']))
-- — with no `current_user_has_permission('team')` branch. Meanwhile
-- `userCanAccess('team')` (UI) and ADMIN_FEATURES both honour the permission,
-- so the section rendered, the tree loaded (reads are the same policy… see
-- below), and only the writes died. Exactly the class already logged in
-- mistakes.md twice this cycle: "a new access channel must be threaded through
-- EVERY gate the old one used" — 0081 introduced managed_permissions and every
-- OTHER feature's policy was updated (announcements honours 'creator',
-- pr_agents honours 'pr', current_user_is_shop_admin honours 'samoshop'), but
-- the team tables themselves were missed. The permission that manages the
-- grant engine was the one permission the grant engine did not honour.
--
-- ⚠️ PRIVILEGE NOTE, deliberate: `team` is effectively root. Whoever holds it
-- can grant any permission — including `team` — to anyone, themselves included.
-- That is inherent to "may manage the org tree" and matches what a vp_admin
-- could already do; it is not widened here. Grant `team` accordingly.
-- ============================================================

drop policy if exists "team_nodes_all_vp_dev" on public.team_nodes;
create policy "team_nodes_all_vp_dev" on public.team_nodes
  for all to authenticated
  using (
    public.current_user_role() = any (array['vp_admin', 'dev'])
    or public.current_user_has_permission('team')
  )
  with check (
    public.current_user_role() = any (array['vp_admin', 'dev'])
    or public.current_user_has_permission('team')
  );

drop policy if exists "team_members_all_vp_dev" on public.team_members;
create policy "team_members_all_vp_dev" on public.team_members
  for all to authenticated
  using (
    public.current_user_role() = any (array['vp_admin', 'dev'])
    or public.current_user_has_permission('team')
  )
  with check (
    public.current_user_role() = any (array['vp_admin', 'dev'])
    or public.current_user_has_permission('team')
  );

comment on policy "team_nodes_all_vp_dev" on public.team_nodes is
  'Manage ทีม SAMO: role vp_admin/dev, or the `team` permission from either '
  'channel (manual permissions[] or the tree''s managed_permissions[]) — 0089. '
  'current_user_has_permission() uses EXISTS, so it is false (never null) for '
  'anon; the policy fails closed.';
