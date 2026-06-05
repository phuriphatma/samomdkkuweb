-- ============================================================
-- 0042 — Make handle_new_auth_user resilient (never abort signup)
--
-- Companion to 0041. Same bug class: a trigger on the signup path
-- that raises takes the WHOLE auth signup down with
-- "Database error saving new user".
--
-- 0001's handle_new_auth_user inserts the public.users profile row
-- with `on conflict (id) do nothing` — but that only covers an `id`
-- collision. The `email` and `username` columns are UNIQUE too, so
-- if any existing row already claims this user's email/username, the
-- INSERT raises unique_violation and the entire signup rolls back.
--
-- Not biting today (password accounts use synthetic @samomdkku.app
-- emails, so a real Google email can't collide), but it's the exact
-- footgun 0041 fixed: a profile-row hiccup must never break auth.
--
-- Fix: on unique_violation, fall back to inserting the profile row
-- keyed ONLY by id (PK, guaranteed unique here) with the conflicting
-- natural keys left NULL — so a usable row always exists and the
-- signup completes. email/username can be reconciled later. Any other
-- unexpected error is logged (raise warning) and swallowed so it can
-- never abort the signup either.
-- ============================================================

create or replace function public.handle_new_auth_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_display text := coalesce(
    new.raw_user_meta_data->>'display_name',
    new.raw_user_meta_data->>'name',
    new.raw_user_meta_data->>'username',
    split_part(new.email, '@', 1)
  );
  v_method text := coalesce(new.raw_user_meta_data->>'method', 'password');
begin
  insert into public.users (id, email, username, display_name, method)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'username', null),
    v_display,
    v_method
  )
  on conflict (id) do nothing;
  return new;
exception
  when unique_violation then
    -- An existing row already claims this email or username. Keep the
    -- signup alive: create the profile row without the conflicting
    -- natural keys (id is the PK and is unique for a brand-new user).
    begin
      insert into public.users (id, display_name, method)
      values (new.id, v_display, v_method)
      on conflict (id) do nothing;
    exception when others then
      raise warning 'handle_new_auth_user: fallback insert failed for %: %', new.id, sqlerrm;
    end;
    return new;
  when others then
    -- Never let an unexpected profile-row error abort auth signup.
    raise warning 'handle_new_auth_user: profile insert failed for %: %', new.id, sqlerrm;
    return new;
end;
$$;

-- Trigger binding unchanged from 0001 (create or replace above suffices).
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();
