-- ============================================================
-- 0012_vs_delete.sql
--
-- Add DELETE policy for vs_tickets — until now, only INSERT,
-- SELECT, and UPDATE policies existed. SE staff (vs_staff) and
-- dev can delete tickets (spam, test entries, accidental dupes).
-- VPs intentionally CANNOT delete — their workflow is to mark
-- ปฏิเสธ / โอนคืน SE if they want a ticket removed from their queue.
-- ============================================================

drop policy if exists "vs_tickets_delete_staff" on public.vs_tickets;
create policy "vs_tickets_delete_staff" on public.vs_tickets
  for delete using (public.current_user_role() in ('vs_staff', 'dev'));

comment on policy "vs_tickets_delete_staff" on public.vs_tickets is
  'SE staff + dev can delete VS tickets. VPs cannot — they reject or transfer instead.';
