-- ============================================================
-- 0044 — VS soft-delete: any VS staff or VP may delete any ticket
--
-- 0043's soft_delete_vs_ticket mirrored the old per-dept rule (vp_admin
-- could only delete own-dept tickets). Product decision: drop that
-- restriction — any VS-side staff or VP deletes any VS ticket. Still
-- staff-only (submitters / guests cannot delete; that's why deletion
-- stays an RPC and not a plain PATCH, which would inherit the owner
-- UPDATE policy 0009 and let submitters delete their own).
--
-- `create or replace` — re-running is safe. The `t` lookup + the
-- current_user_dept() dependency are gone (no per-dept check anymore).
-- ============================================================

create or replace function public.soft_delete_vs_ticket(p_id text)
returns public.vs_tickets language plpgsql security definer set search_path = public as $$
declare r public.vs_tickets;
begin
  if not (
       public.current_user_role() in ('vs_staff', 'dev', 'vp_admin')
    or public.current_user_has_permission('vs')
  ) then
    raise exception 'not authorized to delete this VS ticket' using errcode = '42501';
  end if;
  update public.vs_tickets set deleted_at = now()
    where id = p_id and deleted_at is null
    returning * into r;
  if not found then
    raise exception 'VS ticket not found or already deleted: %', p_id using errcode = 'P0002';
  end if;
  return r;
end $$;
