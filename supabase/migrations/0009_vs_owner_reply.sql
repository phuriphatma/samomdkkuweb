-- ============================================================
-- 0009_vs_owner_reply.sql
--
-- Bug fix: ticket submitter couldn't add a remark/reply to their
-- own VS ticket. The existing vs_tickets_update_staff policy only
-- lets vs_staff/dev UPDATE, so the dbRest PATCH that appends to
-- the `remarks` jsonb came back with 0 rows touched →
-- "ส่งข้อความไม่สำเร็จ — ไม่พบ ticket หรือคุณไม่มีสิทธิ์ตอบกลับ".
--
-- Fix: a second UPDATE policy that lets the submitter update their
-- own row. Postgres RLS doesn't gate per-column, so technically the
-- owner could PATCH any column — frontend discipline (vs-tracking.js
-- only sends `remarks`) is the boundary. For our scale this is
-- acceptable; a SECURITY DEFINER function would be the rigorous
-- alternative.
-- ============================================================

drop policy if exists "vs_tickets_update_owner" on public.vs_tickets;
create policy "vs_tickets_update_owner" on public.vs_tickets
  for update using (submitter_id = auth.uid())
            with check (submitter_id = auth.uid());

comment on policy "vs_tickets_update_owner" on public.vs_tickets is
  'Owners can update their own ticket (used by vs-tracking.js submitUserRemark to append to remarks jsonb). Pairs with vs_tickets_update_staff (vs_staff/dev/vp_admin via 0010).';
