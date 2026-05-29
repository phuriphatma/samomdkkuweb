-- ============================================================
-- 0013_vs_vp_send_back_to_se.sql
--
-- Bug fix: VPs got "new row violates RLS policy" (42501) when they
-- tried to โอนคืน SE. Migration 0010's vs_tickets_update_staff
-- only set USING; PostgreSQL defaults WITH CHECK = USING, so
-- updating target_dept = 'SE' violated the "must match own dept"
-- check on the post-update row.
--
-- Fix: split USING (which rows can I touch) from WITH CHECK
-- (what shape can the new row take). VPs can:
--   - Update tickets currently routed to their dept (status, remarks)
--   - Re-route to SE (โอนคืน) — the only allowed dept change
-- VPs CANNOT directly transfer to another VP — the UI also catches
-- this earlier with a friendly Thai message.
-- ============================================================

drop policy if exists "vs_tickets_update_staff" on public.vs_tickets;
create policy "vs_tickets_update_staff" on public.vs_tickets
  for update using (
    public.current_user_role() in ('vs_staff', 'dev')
    or (
      public.current_user_role() = 'vp_admin'
      and target_dept = (select department from public.users where id = auth.uid())
    )
  ) with check (
    public.current_user_role() in ('vs_staff', 'dev')
    or (
      public.current_user_role() = 'vp_admin'
      and target_dept in (
        (select department from public.users where id = auth.uid()),  -- own dept (status/remark)
        'SE'                                                            -- send back to SE
      )
    )
  );

comment on policy "vs_tickets_update_staff" on public.vs_tickets is
  'vs_staff/dev: full update. vp_admin: USING limits to tickets in own dept; WITH CHECK allows the new target_dept to be own dept OR SE only (no VP→VP direct transfer).';
