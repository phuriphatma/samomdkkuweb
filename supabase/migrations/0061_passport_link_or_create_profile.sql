-- 0061_passport_link_or_create_profile.sql
-- ============================================================
-- Passport merge follow-up: make the signup trigger also CREATE a passport
-- profile when the new user has none — faithfully mirroring project B's
-- `handle_new_user` (which inserted a profiles row for every signup). Without
-- this, a brand-new passport user (never in B) would sign in and have no
-- profile row, so their km wouldn't track and they'd be absent from the
-- (scan-driven) leaderboard.
--
-- Behaviour of public.passport_link_user_by_email() after this:
--   * If a passport profile already exists for this email (carried from B) and
--     is not yet linked to the new uid  -> RE-KEY it (+ scans, season_results)
--     to the new uid. [existing 0060 merge path]
--   * Else -> INSERT a fresh profile (id=new.id, email, full_name, total_km=0),
--     on conflict (id) do nothing. [mirrors B's handle_new_user]
--
-- SAFETY unchanged from 0060: whole body wrapped so it can NEVER raise (0041
-- class); writes only passport.*; SECURITY DEFINER so it works regardless of
-- the profiles RLS (which, like B, has no INSERT policy). A sameweb-only signup
-- gets a 0-km profile that never shows on the scan-driven leaderboard — the
-- same "profile per auth user" shape B always had.
-- ============================================================

create or replace function public.passport_link_user_by_email()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old_id uuid;
begin
  begin
    if new.email is null then
      return new;
    end if;

    select p.id into v_old_id
    from passport.profiles p
    where lower(p.email) = lower(new.email)
      and p.id <> new.id
    limit 1;

    if v_old_id is not null then
      -- Merge path: re-key the carried profile to the new uid.
      if exists (select 1 from passport.profiles where id = new.id) then
        raise warning 'passport_link: profile already at % — skip re-key from %',
          new.id, v_old_id;
      else
        update passport.scans          set user_id = new.id where user_id = v_old_id;
        update passport.season_results set user_id = new.id where user_id = v_old_id;
        update passport.profiles       set id      = new.id where id      = v_old_id;
      end if;
    else
      -- No carried profile for this email -> create one (mirrors B handle_new_user).
      insert into passport.profiles (id, email, full_name, total_km)
      values (new.id, new.email, new.raw_user_meta_data->>'full_name', 0)
      on conflict (id) do nothing;
    end if;

  exception when others then
    raise warning 'passport_link_user_by_email failed for % (%): %',
      new.id, new.email, sqlerrm;
  end;
  return new;
end;
$$;
