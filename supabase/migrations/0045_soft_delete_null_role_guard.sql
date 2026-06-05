-- ============================================================
-- 0045 — soft-delete RPCs must fail CLOSED on a null role
--
-- 0043/0044's auth guards used `current_user_role() in (...)` /
-- `not in (...)`. When current_user_role() is NULL, `null in (...)` is
-- NULL (not false), `not NULL` is NULL, and `IF NULL THEN raise` does
-- NOT fire — so the guard fails OPEN for a null role.
--
-- Not exploitable today: the RPCs are granted to `authenticated` only
-- (anon can't call them), and public.users.role is NOT NULL default
-- 'user', so any real signed-in user has a non-null role and is checked
-- correctly. The only caller with a null role is the server-side
-- service_role. But make it fail CLOSED for defense-in-depth (and in
-- case a user ever exists without a public.users row).
--
-- Fix: capture the role into a variable and add an explicit
-- `v_role is null` guard. Behaviour for real users is unchanged.
-- ============================================================

create or replace function public.soft_delete_pr_ticket(p_id text)
returns public.pr_tickets language plpgsql security definer set search_path = public as $$
declare r public.pr_tickets; v_role text := public.current_user_role();
begin
  if v_role is null or v_role not in ('pr_staff', 'dev') then
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

create or replace function public.soft_delete_vs_ticket(p_id text)
returns public.vs_tickets language plpgsql security definer set search_path = public as $$
declare r public.vs_tickets; v_role text := public.current_user_role();
begin
  if v_role is null or not (
       v_role in ('vs_staff', 'dev', 'vp_admin')
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
