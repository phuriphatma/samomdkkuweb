-- ============================================================
-- 0091 — notification recipients must be seat-aware too
--
-- 0086 gave หนังสือโครงการ a seat dimension and 0090 let the `vpa` seat create.
-- But the notify fan-out still resolved every audience by ROLE:
--   notifyUniStaff → listUsersByRole('uni_staff')
--   notifyVpAdmin  → listUsersByRole('vp_admin')
--   notifyProf     → listUsersByRole('sa_prof')
-- so a tree-seat holder could be sent a document, act on it, and never receive
-- a single in-app notification. This fails silently in the worst way: the
-- workflow works, the bell just stays empty, and nobody reports a missing
-- notification they never knew to expect.
--
-- One function replaces all three lookups. Returns id + display name ONLY —
-- an email is not the caller's to read (same rule as list_project_profs,
-- which this generalises; that function stays for its existing callers).
-- ============================================================

create or replace function public.list_project_seat_users(p_seat text)
returns table (id uuid, display_name text)
language sql stable security definer set search_path = public as $$
  select u.id,
         coalesce(nullif(btrim(u.display_name), ''),
                  nullif(btrim(u.username), ''),
                  'ผู้ใช้') as display_name
    from public.users u
   where public.current_user_is_project_actor()
     and p_seat in ('vpa', 'staff', 'prof')
     and (
       u.role = case p_seat when 'vpa'  then 'vp_admin'
                            when 'staff' then 'uni_staff'
                            when 'prof'  then 'sa_prof' end
       or p_seat = any (coalesce(u.managed_project_seats, '{}'))
     )
   order by 2
$$;

comment on function public.list_project_seat_users(text) is
  'Everyone occupying a หนังสือโครงการ seat — by role OR by ทีม SAMO grant (0091). '
  'Used to address notifications. Actor-gated; never returns an email.';

revoke all on function public.list_project_seat_users(text) from public, anon;
grant execute on function public.list_project_seat_users(text) to authenticated;
