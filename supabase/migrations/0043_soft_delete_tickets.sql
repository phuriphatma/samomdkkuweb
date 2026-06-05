-- ============================================================
-- 0043 — Soft-delete for pr_tickets + vs_tickets (recoverable deletes)
--
-- Why: ticket deletion was a hard DELETE with no recovery (free-tier
-- Supabase has no backups/PITR). An accidental delete from the staff
-- dashboard was unrecoverable. Soft-delete makes deletes reversible and
-- gives an implicit audit trail (deleted_at = when, row content = what).
--
-- Design note — why RPCs, not "PATCH deleted_at":
-- Soft-delete is technically an UPDATE, so doing it as a plain PATCH would
-- make it inherit the UPDATE row policies, which are BROADER and different
-- from the DELETE policies:
--   * pr_tickets: UPDATE adds has('pr') (0014); DELETE is pr_staff/dev only.
--   * vs_tickets: UPDATE has an owner policy (0009) + a vp_admin own-dept
--     policy whose WITH CHECK is about target_dept, not deletion; DELETE
--     (0015/0016) is vs_staff/dev/has('vs') + vp_admin own-dept.
-- To preserve the EXACT current delete authorization, deletion goes through
-- SECURITY DEFINER functions that re-check the same predicates as the
-- DELETE policies, then stamp deleted_at. Reads filter `deleted_at is null`
-- in-app; a deleted row stays visible to a direct admin query for restore.
--
-- Restore (admin): the rows are never removed —
--   update public.pr_tickets set deleted_at = null where id = 'PR-XXXXXX';
--   update public.vs_tickets set deleted_at = null where id = 'VS-XXXXXX';
-- run from the Supabase SQL editor (postgres role, bypasses RLS).
-- ============================================================

alter table public.pr_tickets add column if not exists deleted_at timestamptz;
alter table public.vs_tickets add column if not exists deleted_at timestamptz;

-- Partial indexes for the common "active tickets, newest first" list read.
create index if not exists pr_tickets_active_idx
  on public.pr_tickets (timestamp desc) where deleted_at is null;
create index if not exists vs_tickets_active_idx
  on public.vs_tickets (timestamp desc) where deleted_at is null;

-- ------------------------------------------------------------
-- PR soft-delete — mirrors pr_tickets_delete_staff (pr_staff / dev).
-- ------------------------------------------------------------
create or replace function public.soft_delete_pr_ticket(p_id text)
returns public.pr_tickets language plpgsql security definer set search_path = public as $$
declare r public.pr_tickets;
begin
  if public.current_user_role() not in ('pr_staff', 'dev') then
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

-- ------------------------------------------------------------
-- VS soft-delete — mirrors vs_tickets_delete_staff (0015/0016):
-- vs_staff / dev / has('vs') delete any; vp_admin own-dept only.
-- ------------------------------------------------------------
create or replace function public.soft_delete_vs_ticket(p_id text)
returns public.vs_tickets language plpgsql security definer set search_path = public as $$
declare r public.vs_tickets; t public.vs_tickets;
begin
  select * into t from public.vs_tickets where id = p_id;
  if not found then
    raise exception 'VS ticket not found: %', p_id using errcode = 'P0002';
  end if;
  if not (
       public.current_user_role() in ('vs_staff', 'dev')
    or public.current_user_has_permission('vs')
    or (public.current_user_role() = 'vp_admin' and t.target_dept = public.current_user_dept())
  ) then
    raise exception 'not authorized to delete this VS ticket' using errcode = '42501';
  end if;
  update public.vs_tickets set deleted_at = now()
    where id = p_id and deleted_at is null
    returning * into r;
  if not found then
    raise exception 'VS ticket already deleted: %', p_id using errcode = 'P0002';
  end if;
  return r;
end $$;

revoke all on function public.soft_delete_pr_ticket(text) from public;
revoke all on function public.soft_delete_vs_ticket(text) from public;
grant execute on function public.soft_delete_pr_ticket(text) to authenticated;
grant execute on function public.soft_delete_vs_ticket(text) to authenticated;

-- ------------------------------------------------------------
-- Guest lookup RPCs (0021) must also hide soft-deleted tickets, else a
-- deleted ticket stays trackable by its exact id. Re-create with the
-- `deleted_at is null` filter (grants are preserved across replace).
-- ------------------------------------------------------------
create or replace function public.get_vs_ticket_by_id(p_id text)
returns setof public.vs_tickets
language sql stable security definer set search_path = public as $$
  select * from public.vs_tickets where id = p_id and deleted_at is null limit 1;
$$;

create or replace function public.get_pr_ticket_by_id(p_id text)
returns setof public.pr_tickets
language sql stable security definer set search_path = public as $$
  select * from public.pr_tickets where id ilike p_id and deleted_at is null limit 1;
$$;
