-- ============================================================
-- 0041 — Fix: users_self_update_guard blocks ALL new signups
--
-- Symptom: brand-new Google sign-in fails. The Supabase OAuth
-- callback redirects back with
--   error_code=unexpected_failure
--   error_description=Database error saving new user
-- The same failure bricks the profile-modal "set password" flow.
--
-- Root cause: two triggers fire when a user is created:
--   * 0027 `handle_auth_user_password_sync` — AFTER INSERT / AFTER
--     UPDATE OF encrypted_password on auth.users — mirrors
--     "does this auth user have a password" into
--     public.users.has_password (a server-managed UI hint).
--   * 0028 `users_self_update_guard` — BEFORE UPDATE on
--     public.users — raises if a NON-STAFF caller changes a
--     privileged column, including has_password ("server-managed").
--
-- During a GoTrue signup the sync trigger's UPDATE runs with
-- auth.uid() = NULL, so current_user_is_staff() = false, so the
-- guard takes its has_password branch and aborts the whole
-- signup transaction. The guard cannot tell the legitimate
-- server-side sync trigger apart from a malicious client PATCH —
-- both execute in a non-staff context.
--
-- Confirmed by reproduction: POST /auth/v1/admin/users (with or
-- without a password) returns
--   P0001  users_self_update_guard: has_password is server-managed
-- and no user row is created.
--
-- Fix: keep the guard protective against client spoofing, but
-- allow a has_password change when it AGREES with the
-- authoritative auth.users.encrypted_password state. The sync
-- trigger always writes the correct mirror value, so it passes;
-- a client trying to set a value that contradicts reality (e.g.
-- has_password=true with no password) is still rejected. Setting
-- it to the already-correct value is a harmless no-op.
--
-- Everything else in the guard (id / role / permissions / method /
-- username-once) is unchanged.
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

  -- has_password is a server-managed mirror of
  -- auth.users.encrypted_password (the 0027 sync trigger). Allow the
  -- change ONLY when it matches the authoritative auth state — this
  -- lets the SECURITY DEFINER sync trigger through (it always writes
  -- the correct value, including during signup when auth.uid() is
  -- null) while still blocking a client PATCH that tries to set a
  -- value contradicting reality. Setting it to the already-correct
  -- value is a harmless no-op.
  if new.has_password is distinct from old.has_password then
    if new.has_password is distinct from exists (
         select 1 from auth.users au
          where au.id = new.id
            and au.encrypted_password is not null
       ) then
      raise exception 'users_self_update_guard: has_password is server-managed';
    end if;
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

-- Trigger binding is unchanged from 0028; create or replace above is
-- sufficient. (Re-stating the binding here is harmless and idempotent.)
drop trigger if exists users_self_update_guard on public.users;
create trigger users_self_update_guard
  before update on public.users
  for each row execute function public.users_self_update_guard();
