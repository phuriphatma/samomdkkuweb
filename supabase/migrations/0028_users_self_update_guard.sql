-- ============================================================
-- 0028 — Lock privileged columns on public.users self-updates
--
-- The 0001 RLS policy `users_update_self` allows any signed-in user
-- to UPDATE their own row. With Supabase's PostgREST, that means a
-- logged-in user could PATCH `/users?id=eq.<their_uid>` with
-- `{"role":"dev"}` and silently self-promote — the policy has no
-- column-level gate. This was missed for a while because the JS
-- only ever wrote `display_name`, `email`, `department`, etc.; a
-- malicious user with `curl` was the path nobody walked.
--
-- A BEFORE-UPDATE trigger is the right tool here: PostgreSQL's RLS
-- doesn't support WITH CHECK constraints on individual columns.
-- Staff (`current_user_is_staff()` — broadened in 0005 to include
-- pr_staff, vs_staff, shop_admin, vp_admin, uni_staff, dev) can
-- still change anything via the admin UIs.
--
-- Self-allowed: display_name, email, department, has_password,
-- username (only when going from NULL → first value, i.e. a Google-
-- only user setting their initial username via the profile modal).
-- Self-blocked: role, permissions, method, id, and any later
-- username change.
-- ============================================================

create or replace function public.users_self_update_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  is_staff boolean := public.current_user_is_staff();
begin
  -- Staff bypass the guard entirely. Admin tools (per-dept set,
  -- permissions edit, role grant) need the freedom.
  if is_staff then
    return new;
  end if;

  -- id is the auth FK — never mutable from the client side.
  if new.id is distinct from old.id then
    raise exception 'users_self_update_guard: id is immutable';
  end if;

  -- Privileged columns.
  if new.role is distinct from old.role then
    raise exception 'users_self_update_guard: role can only be changed by staff';
  end if;
  if new.permissions is distinct from old.permissions then
    raise exception 'users_self_update_guard: permissions can only be changed by staff';
  end if;
  if new.method is distinct from old.method then
    raise exception 'users_self_update_guard: method can only be changed by staff';
  end if;

  -- Server-managed by trigger from migration 0027.
  if new.has_password is distinct from old.has_password then
    raise exception 'users_self_update_guard: has_password is server-managed';
  end if;

  -- Username: settable once (NULL → value), then locked. Lets a
  -- Google-only user pick their initial username in the profile
  -- modal without allowing a later rename that would break history.
  if old.username is not null and new.username is distinct from old.username then
    raise exception 'users_self_update_guard: username can only be set once';
  end if;

  return new;
end;
$$;

drop trigger if exists users_self_update_guard on public.users;
create trigger users_self_update_guard
  before update on public.users
  for each row execute function public.users_self_update_guard();
