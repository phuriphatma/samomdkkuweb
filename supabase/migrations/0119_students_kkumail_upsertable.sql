-- ============================================================
-- 0119 — make the student import actually work.
--
-- SYMPTOM (found by scanning, before any data existed — the import had never
-- been run): every import chunk would have failed with
--   42P10 there is no unique or exclusion constraint matching the ON CONFLICT
--   specification
-- i.e. the entire ระบบบ้าน import feature was dead on arrival.
--
-- CAUSE. 0116 made kkumail unique with an EXPRESSION index:
--     create unique index students_kkumail_uniq on students (lower(btrim(kkumail)))
-- which is the right rule — 'A@kku' and 'a@kku' are one person. But the importer
-- upserts through PostgREST with `?on_conflict=kkumail`, and that renders
-- `ON CONFLICT (kkumail)`, which can only bind to a unique index on the BARE
-- column. An expression index does not match, so Postgres refuses the statement
-- outright.
--
-- This is the "two implementations of one rule" class wearing a new hat: the
-- uniqueness rule was expressed as an expression index, while the WRITE PATH
-- expressed it as a plain column conflict target. Both were reasonable alone.
--
-- FIX — normalise on the way IN, then a plain unique constraint says the same
-- thing. A BEFORE trigger lowercases and trims kkumail on every insert/update,
-- which makes `unique (kkumail)` exactly equivalent to the expression index it
-- replaces, and gives ON CONFLICT (kkumail) something to bind to. Normalising at
-- the boundary is strictly better than matching case at every reader anyway:
-- get_my_student_record() and the RLS helpers all compare `lower(btrim(...))`
-- precisely because the stored value could not be trusted. Now it can.
--
-- The same treatment is given to advisors.email for the same reason (nothing
-- upserts it today, but it is the identical shape and the next person to write
-- an advisor import would hit the identical wall).
-- ============================================================

-- ------------------------------------------------------------
-- §1 — Normalise on write.
-- ------------------------------------------------------------
create or replace function public.normalize_kkumail()
returns trigger language plpgsql as $$
begin
  new.kkumail := nullif(lower(btrim(coalesce(new.kkumail, ''))), '');
  return new;
end;
$$;

drop trigger if exists students_normalize_kkumail on public.students;
create trigger students_normalize_kkumail
  before insert or update of kkumail on public.students
  for each row execute function public.normalize_kkumail();

-- Existing rows (there are none in production yet, but a re-run must be safe
-- and a dev database may have some).
update public.students
   set kkumail = lower(btrim(kkumail))
 where kkumail is distinct from lower(btrim(kkumail));

-- ------------------------------------------------------------
-- §2 — A plain unique constraint ON CONFLICT can bind to.
--
-- Drop the expression index only AFTER the constraint exists, so uniqueness is
-- never unenforced in between.
-- ------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_constraint
                  where conname = 'students_kkumail_key'
                    and conrelid = 'public.students'::regclass) then
    alter table public.students add constraint students_kkumail_key unique (kkumail);
  end if;
end $$;

drop index if exists public.students_kkumail_uniq;

comment on constraint students_kkumail_key on public.students is
  'Plain column uniqueness so PostgREST ?on_conflict=kkumail can bind (0119). '
  'Equivalent to the lower(btrim()) index it replaced ONLY because '
  'students_normalize_kkumail lowercases and trims on write — do not drop that '
  'trigger.';

-- ------------------------------------------------------------
-- §3 — Same shape on advisors.email.
-- ------------------------------------------------------------
create or replace function public.normalize_advisor_email()
returns trigger language plpgsql as $$
begin
  new.email := nullif(lower(btrim(coalesce(new.email, ''))), '');
  return new;
end;
$$;

drop trigger if exists advisors_normalize_email on public.advisors;
create trigger advisors_normalize_email
  before insert or update of email on public.advisors
  for each row execute function public.normalize_advisor_email();

update public.advisors
   set email = lower(btrim(email))
 where email is not null and email is distinct from lower(btrim(email));

do $$
begin
  if not exists (select 1 from pg_constraint
                  where conname = 'advisors_email_key'
                    and conrelid = 'public.advisors'::regclass) then
    -- NULLs are allowed and do not collide, so this keeps the "advisors without
    -- a known address coexist" property the partial index had.
    alter table public.advisors add constraint advisors_email_key unique (email);
  end if;
end $$;

drop index if exists public.advisors_email_uniq;
