-- ============================================================
-- 0149 — soft_delete_pr_ticket() must honour the 'pr' PERMISSION, not just the
--        pr_staff/dev ROLE
--
-- Symptom: a ทีม SAMO member granted PR through her node could open the PR staff
-- dashboard, read tickets and edit them, but ลบ returned
--   {"code":"42501", "message":"not authorized to delete PR tickets"}
--
-- Cause: 0043 moved ticket deletion behind a SECURITY DEFINER RPC so the soft
-- delete (an UPDATE at the storage level) would not inherit the broader UPDATE
-- policy, and re-checked "the EXACT current delete authorization" by hand. But
-- it re-checked 0001's version of that rule — `current_user_role() in
-- ('pr_staff','dev')` — when 0014 had already taught `pr_tickets_delete_staff`
-- the permission channel. The policy and its restatement had diverged BEFORE the
-- restatement was written, and the divergence was invisible because a role-based
-- account (the only kind anyone tested with) satisfies both.
--
-- The VS twin, `soft_delete_vs_ticket`, took the same treatment in the same
-- migration and DID carry `current_user_has_permission('vs')` — so this was one
-- gate of a pair, which is why nothing looked wrong on review.
--
-- Fix: mirror the live policy exactly. `current_user_has_permission` already
-- reads the UNION of `permissions` and `managed_permissions` (0081) and answers
-- yes to everything for `master` (0111), so a ทีม SAMO node grant, a directly
-- assigned permission and a master account all resolve through one call.
--
-- The null-role guard from 0045 is kept and still fails CLOSED: `v_role is null`
-- is checked before the role test, and the permission branch is a separate
-- `exists`, never a `null in (...)`.
--
-- Guard: `node tools/db-query.mjs tools/pr0149-delete-permission.sql` — a
-- DIFFERENTIAL test that asks the POLICY and the RPC the same question about
-- three subjects (permission-only, role-only, ungranted) and fails if they
-- disagree. It reproduced this bug before the fix (B1 FAIL / C1 2-of-3) and is
-- the mechanism that would have caught it in 0043.
-- ============================================================

create or replace function public.soft_delete_pr_ticket(p_id text)
returns public.pr_tickets language plpgsql security definer set search_path = public as $$
declare r public.pr_tickets; v_role text := public.current_user_role();
begin
  -- Mirrors policy pr_tickets_delete_staff. Change one, change the other, and
  -- run tools/pr0149-delete-permission.sql — it compares them.
  if v_role is null or not (
       v_role in ('pr_staff', 'dev')
    or public.current_user_has_permission('pr')
  ) then
    raise exception 'not authorized to delete PR tickets' using errcode = '42501';
  end if;
  update public.pr_tickets set deleted_at = now()
    where id = p_id and deleted_at is null
    returning * into r;
  if not found then
    raise exception 'PR ticket not found or already deleted: %', p_id using errcode = 'P0002';
  end if;
  return r;
end $$;
