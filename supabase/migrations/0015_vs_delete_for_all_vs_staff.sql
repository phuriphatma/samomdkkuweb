-- ============================================================
-- 0015_vs_delete_for_all_vs_staff.sql
--
-- Bug: VPs (vp_admin) clicked "ลบ ticket" and got
--   "ลบไม่สำเร็จ — ไม่พบ ticket หรือคุณไม่มีสิทธิ์ลบ
--    (ต้องเป็น vs_staff หรือ dev)"
-- Policy 0012 only allowed vs_staff / dev. Extend to mirror the
-- READ/UPDATE shape: any VS staff (vs_staff, dev, anyone with the
-- 'vs' permission) can delete any ticket; VPs (vp_admin) can delete
-- tickets routed to their own dept (RLS already filters reads for
-- them so they can't even see other depts' tickets).
-- ============================================================

drop policy if exists "vs_tickets_delete_staff" on public.vs_tickets;
create policy "vs_tickets_delete_staff" on public.vs_tickets
  for delete using (
    public.current_user_role() in ('vs_staff', 'dev')
    or public.current_user_has_permission('vs')
    or (
      public.current_user_role() = 'vp_admin'
      and target_dept = (select department from public.users where id = auth.uid())
    )
  );

comment on policy "vs_tickets_delete_staff" on public.vs_tickets is
  'Any VS staff (vs_staff / dev / has(''vs'')) delete any. vp_admin delete tickets in own dept only.';
