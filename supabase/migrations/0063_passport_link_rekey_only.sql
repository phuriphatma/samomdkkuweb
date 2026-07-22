-- 0063_passport_link_rekey_only.sql
-- ============================================================
-- Passport merge cleanup: revert the signup trigger to RE-KEY ONLY.
--
-- 0061 had the trigger also CREATE a passport profile for any signup with no
-- existing profile. That was needed before the app could self-provision, but it
-- creates a passport profile for EVERY samoweb portal signup — including
-- portal-only users who never touch passport (undesired: passport.profiles then
-- counts non-participants). Now that the passport app calls ensureProfile() on
-- dashboard load AND before a scan insert (gated by the 0062 profiles_insert_own
-- RLS policy), profile creation happens on demand, only for users who actually
-- open passport. So the trigger no longer needs the create branch.
--
-- After this, public.passport_link_user_by_email() only RE-KEYS an existing
-- passport profile (carried from project B) to the new A auth uid on first
-- login — the merge path that must stay server-side. It creates nothing.
-- Safety unchanged: body wrapped so it can never raise (0041 class); writes
-- only passport.*; no-op for a signup whose email has no passport profile.
-- Reversible; idempotent (create or replace).
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

    if v_old_id is null then
      return new;  -- no carried passport profile → nothing to re-key (app self-provisions on open)
    end if;

    if exists (select 1 from passport.profiles where id = new.id) then
      raise warning 'passport_link: profile already at % — skip re-key from %',
        new.id, v_old_id;
      return new;
    end if;

    update passport.scans          set user_id = new.id where user_id = v_old_id;
    update passport.season_results set user_id = new.id where user_id = v_old_id;
    update passport.profiles       set id      = new.id where id      = v_old_id;

  exception when others then
    raise warning 'passport_link_user_by_email failed for % (%): %',
      new.id, new.email, sqlerrm;
  end;
  return new;
end;
$$;
