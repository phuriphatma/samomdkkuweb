-- 0064_passport_kkumail_migrate.sql
-- ============================================================
-- SAMO Passport: enforce @kkumail.com-only + migrate 5 students' points/
-- activity/stamps/certificates from a gmail account to their kkumail account.
--
-- CONTEXT: passport data lives in project A's `passport` schema (email-keyed,
-- see 0059–0063). Login was never restricted to kkumail before launch, so a few
-- students scanned with a personal gmail. This migration (a) carries those 5
-- accounts' data to the correct kkumail identity, and (b) records the move in a
-- new `account_migrations` table so the app can show a notice on BOTH the old
-- gmail login ("your data moved to X") and the new kkumail login ("received
-- data from Y"). The app enforces the kkumail-only gate at runtime.
--
-- The 5 accounts NEVER logged into project A (they scanned in old project B,
-- data was copied over), so their profiles are still email-keyed with an old
-- B uuid. For the 4 whose kkumail profile does NOT yet exist, we simply RE-KEY
-- the profile's email gmail→kkumail; the existing login trigger
-- (public.passport_link_user_by_email, 0063) then re-keys the uuid on their
-- first kkumail login. For kedsaraporn the kkumail profile ALREADY exists, so
-- we MERGE (its one gmail scan is a duplicate of an existing kkumail scan → no
-- double-count; total_km is recomputed from scans as the source of truth).
--
-- Certificates are generated client-side from scans (nothing stored per user),
-- so moving scans moves the certificates too. season_results are all 0 here.
--
-- Idempotent + defensive: renames only fire when the target profile is absent;
-- re-running finds the gmail profiles already gone → no-op.
-- ============================================================

-- ── 1. account_migrations: the record the app reads for both-side notices ────
create table if not exists passport.account_migrations (
    id         uuid primary key default gen_random_uuid(),
    from_email text not null,
    to_email   text not null,
    moved_at   timestamptz not null default now(),
    note       text
);
create unique index if not exists account_migrations_from_email_key
    on passport.account_migrations (lower(from_email));
create index if not exists account_migrations_to_email_idx
    on passport.account_migrations (lower(to_email));

alter table passport.account_migrations enable row level security;
-- Read-all (the app needs to look up by from/to email under the anon key).
-- NO insert/update/delete policy → only service_role / Management API can write.
drop policy if exists account_migrations_read on passport.account_migrations;
create policy account_migrations_read on passport.account_migrations
    for select using (true);

insert into passport.account_migrations (from_email, to_email, note) values
    ('wariikung@gmail.com',         'ingwer.s@kkumail.com',      'kkumail cutover 2026-07-23'),
    ('phuri8980@gmail.com',         'phurichaya.bo@kkumail.com', 'kkumail cutover 2026-07-23'),
    ('kenkunchai50@gmail.com',      'kenkunchai.ch@kkumail.com', 'kkumail cutover 2026-07-23'),
    ('sirikanrayamasena@gmail.com', 'sirikanraya.m@kkumail.com', 'kkumail cutover 2026-07-23'),
    ('kedsaraporn2007@gmail.com',   'kedsaraporn.t@kkumail.com', 'kkumail cutover 2026-07-23 (merged into existing kkumail profile)')
on conflict ((lower(from_email))) do nothing;

-- ── 2. Four simple moves: re-key the profile email gmail → kkumail ───────────
-- Only when the kkumail target profile does not already exist. The profile id
-- (and its scans, via scans.user_id) is unchanged; the login trigger re-keys
-- the uuid on first kkumail sign-in.
update passport.profiles p
   set email = v.to_email, updated_at = now()
  from (values
    ('wariikung@gmail.com',         'ingwer.s@kkumail.com'),
    ('phuri8980@gmail.com',         'phurichaya.bo@kkumail.com'),
    ('kenkunchai50@gmail.com',      'kenkunchai.ch@kkumail.com'),
    ('sirikanrayamasena@gmail.com', 'sirikanraya.m@kkumail.com')
  ) as v(from_email, to_email)
 where lower(p.email) = v.from_email
   and not exists (
       select 1 from passport.profiles x where lower(x.email) = v.to_email
   );

-- ── 3. kedsaraporn: MERGE gmail profile into the existing kkumail profile ────
do $$
declare
    gm uuid;  -- gmail (source) profile id
    kk uuid;  -- kkumail (target) profile id
begin
    select id into gm from passport.profiles where lower(email) = 'kedsaraporn2007@gmail.com';
    select id into kk from passport.profiles where lower(email) = 'kedsaraporn.t@kkumail.com';

    if gm is not null and kk is not null then
        -- Move only scans for activities the kkumail account does NOT already
        -- have (the unique (user_id, activity_id) makes duplicates a no-move).
        update passport.scans s
           set user_id = kk
         where s.user_id = gm
           and not exists (
               select 1 from passport.scans k
               where k.user_id = kk and k.activity_id = s.activity_id
           );

        -- Drop the leftover duplicate gmail scans (their activity is already on
        -- the kkumail account, so no points are lost).
        delete from passport.scans where user_id = gm;

        -- Season results (0 here, but keep the merge general).
        update passport.season_results set user_id = kk where user_id = gm;

        -- Recompute the kkumail total from its scans (authoritative → no drift).
        update passport.profiles
           set total_km   = coalesce((select sum(points_awarded)
                                        from passport.scans where user_id = kk), 0),
               updated_at = now()
         where id = kk;

        -- Remove the now-empty gmail profile.
        delete from passport.profiles where id = gm;
    end if;
end $$;

-- ── 4. Verify ────────────────────────────────────────────────────────────────
-- Returned in the Management API response for a quick sanity check.
select 'migrations' as what, count(*)::text as n from passport.account_migrations
union all
select 'remaining_gmail_of_the_5',
       count(*)::text
  from passport.profiles
 where lower(email) in ('wariikung@gmail.com','phuri8980@gmail.com','kenkunchai50@gmail.com',
                        'sirikanrayamasena@gmail.com','kedsaraporn2007@gmail.com')
union all
select p.email, p.total_km::text
  from passport.profiles p
 where lower(p.email) in ('ingwer.s@kkumail.com','phurichaya.bo@kkumail.com',
                          'kenkunchai.ch@kkumail.com','sirikanraya.m@kkumail.com','kedsaraporn.t@kkumail.com')
 order by 1;
