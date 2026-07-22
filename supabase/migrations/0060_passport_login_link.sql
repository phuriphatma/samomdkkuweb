-- 0060_passport_login_link.sql
-- ============================================================
-- Passport → samoweb merge: login-time lazy link (Option B).
--
-- Passport rows were copied into A keyed by EMAIL, with each row still carrying
-- the student's OLD project-B auth uuid (0059 dropped the auth FKs so that was
-- allowed). When that student first signs into project A they get a BRAND-NEW A
-- auth uuid — different from their B uuid — so `where user_id = auth.uid()`
-- would find none of their history. This trigger fixes that at signup: it looks
-- up the passport profile by email and re-keys profile.id + scans.user_id +
-- season_results.user_id from the old B uuid to the new A uuid.
--
-- SAFETY (0041 class): this fires on EVERY auth signup — sameweb AND passport.
-- The entire body is wrapped so it can NEVER raise; a raise here would abort the
-- whole signup transaction and brick ALL sign-ups (exactly the 0041 bug). For a
-- sameweb-only email (not in passport.profiles) it is a pure no-op. It only ever
-- WRITES to passport.* — never public.* — so it cannot affect sameweb accounts.
--
-- Idempotent + reversible: drop the trigger to disable; re-running is safe.
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

    -- The passport profile carried by this email, not yet linked to the new uid.
    -- passport.profiles.email is UNIQUE, so at most one row.
    select p.id into v_old_id
    from passport.profiles p
    where lower(p.email) = lower(new.email)
      and p.id <> new.id
    limit 1;

    if v_old_id is null then
      return new;  -- not a passport user (or already linked) → no-op
    end if;

    -- Never clobber a profile already sitting at the new uid.
    if exists (select 1 from passport.profiles where id = new.id) then
      raise warning 'passport_link: profile already at % — skip re-key from %',
        new.id, v_old_id;
      return new;
    end if;

    -- Re-key child rows first, then the profile PK. These columns have no FKs
    -- (0059 dropped them), so the UPDATEs are plain and non-cascading.
    update passport.scans          set user_id = new.id where user_id = v_old_id;
    update passport.season_results set user_id = new.id where user_id = v_old_id;
    update passport.profiles       set id      = new.id where id      = v_old_id;

  exception when others then
    -- Absolutely never abort the signup — log and move on.
    raise warning 'passport_link_user_by_email failed for % (%): %',
      new.id, new.email, sqlerrm;
  end;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_passport_link on auth.users;
create trigger on_auth_user_created_passport_link
  after insert on auth.users
  for each row execute function public.passport_link_user_by_email();
