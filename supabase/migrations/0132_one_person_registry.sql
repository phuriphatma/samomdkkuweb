-- ============================================================
-- 0132 — ONE account system: `people` is the registry, placements point at it
--
-- WHAT WAS ASKED
--   "integrate teamsamo and house system to use one database account"
--   "i want a single database that all account information holds, like single
--    account system, because teamsamo and house system is very similar"
--   "is it a good idea, if not do the best practice"
--
-- IT IS A GOOD IDEA FOR IDENTITY, AND ONLY FOR IDENTITY. A person's name,
-- ชื่อเล่น, รหัสนักศึกษา, kkumail, สาขา and photo are ONE fact about ONE human and
-- belong in one row. What must NOT join them is the placements: a person can
-- hold two ทีม SAMO postings across two terms and a house placement at the same
-- time, so a single flat row would have to pick one and lose the rest. Identity
-- in one table, placements in their own, each pointing back — that is the shape
-- this migration builds, and it is the standard one.
--
-- THE REGISTRY ALREADY EXISTED, DORMANT. 0108 created `team_people` for exactly
-- this and stopped one step short: 303 rows, all 399 `team_members` linked by
-- `person_id`, and NOTHING in src/ reads it (verified by grep — only four
-- tools/*.mjs proof scripts mention it). So this does not invent a table. It
-- promotes the one that is already correct and already populated, and folds
-- ระบบบ้าน into it.
--
-- WHY NOW. `students` holds THREE rows. The ~1,800-row faculty roster has not
-- landed, and exactly TWO humans currently exist in both tables. Every day this
-- waits, the backfill gets harder and the number of conflicting duplicate
-- identities grows from two to hundreds. This is the cheapest this merge will
-- ever be.
--
-- EXPAND ONLY — deliberately, and this is the discipline the merge lives or
-- dies by. Nothing is dropped here. `students` and `team_members` keep every
-- identity column they have, a trigger keeps them in step with `people`, and
-- every existing reader keeps working untouched. The CONTRACT step (drop the
-- duplicated columns, point the ten resolvers at `people`) is a later migration
-- taken one reader at a time. A big-bang cutover of ten resolvers, two archives
-- and an org tree is how this repo would earn its next outage.
--
-- THE MERGE KEY IS kkumail, NEVER A NAME. 0108 is the entry: `673070332-6` is
-- one mistyped รหัสนักศึกษา worn by two different humans, and two people share a
-- name far more often than they share an address. 16 `team_members` rows carry
-- no kkumail at all (shared department accounts) — they already have their own
-- `people` row from 0108 and keep it; they simply never match a student.
-- ============================================================

-- ------------------------------------------------------------
-- §1 — `team_people` becomes `people`
--
-- The name is not cosmetic. A student who has never been in ทีม SAMO now has a
-- row here, and "why is my house record in team_people" is a question that
-- would be asked forever. Postgres rewrites the FK from `team_members` and the
-- triggers automatically; the policies and the touch function are renamed by
-- hand so nothing is left pointing at a name that no longer describes it.
-- ------------------------------------------------------------
alter table if exists public.team_people rename to people;

alter index if exists team_people_pkey rename to people_pkey;

drop policy if exists "team_people_read" on public.people;
drop policy if exists "team_people_write" on public.people;

-- Read widened to the `house` permission: ระบบบ้าน admins now manage people who
-- are in this table. Write is still the narrower `team_edit` set plus `house` —
-- both systems' admins may correct a person, which is the point of one registry.
create policy "people_read" on public.people
  for select to authenticated
  using (public.current_user_role() = any (array['vp_admin','dev'])
         or public.current_user_has_permission('team_edit')
         or public.current_user_has_permission('team')
         or public.current_user_has_permission('house'));

create policy "people_write" on public.people
  for all to authenticated
  using (public.current_user_role() = any (array['vp_admin','dev'])
         or public.current_user_has_permission('team_edit')
         or public.current_user_has_permission('house'))
  with check (public.current_user_role() = any (array['vp_admin','dev'])
         or public.current_user_has_permission('team_edit')
         or public.current_user_has_permission('house'));

-- anon has no business enumerating every human in the faculty.
revoke all on public.people from anon;

comment on table public.people is
  'THE person registry (0132, promoted from team_people). One row per human, '
  'keyed on kkumail where there is one. Holds IDENTITY only — name, ชื่อเล่น, '
  'รหัสนักศึกษา, สาขา, cohort, photo. PLACEMENTS live in their own tables and '
  'point here: team_members.person_id (org posting) and students.person_id '
  '(house placement). Never merge two rows on a NAME — 0108.';

-- ------------------------------------------------------------
-- §2 — the columns ระบบบ้าน needs, added to the registry
--
-- THE NAME SHAPE, and why `full_name` is not simply replaced. `team_people`
-- carries a single `full_name` for 303 people; `students` carries the split
-- `first_name_th` / `last_name_th`. The split is the stricter and correct form
-- (PERSON-REGISTRY.md), but the 303 existing names CANNOT be split to get
-- there: "สมชาย ณ อยุธยา" and "สมชาย ใจดี ดีมาก" both have three tokens and
-- different answers, and guessing renames a real person irreversibly. The CSV
-- importer already refuses a combined column for exactly this reason, and it
-- would be absurd for a migration to do what the importer refuses.
--
-- So both shapes coexist and a trigger decides: when the split is present it is
-- authoritative and `full_name` is derived from it; when it is absent
-- `full_name` stands on its own. A row acquires the split when a human supplies
-- it — from the faculty roster, or from the person editing their own name.
--
-- `full_name` also becomes NULLABLE: 0126 established that a row may arrive
-- with no name at all (the minimum useful import file is kkumail + สาย), and
-- the registry has to be able to hold such a person.
-- ------------------------------------------------------------
alter table public.people
  add column if not exists first_name_th text,
  add column if not exists last_name_th  text,
  add column if not exists cohort_year   smallint,
  add column if not exists year_offset   smallint,
  add column if not exists bio           text;

alter table public.people alter column full_name drop not null;

comment on column public.people.full_name is
  'The name as displayed. DERIVED from first_name_th + last_name_th whenever '
  'those are present (people_sync_full_name); stands alone for the 303 rows '
  'inherited from ทีม SAMO, whose combined names must never be split — '
  'guessing the boundary renames a real person (0108, and the CSV importer '
  'refuses the same thing).';
comment on column public.people.year is
  'LEGACY ชั้นปี as text, inherited from team_people. Superseded by '
  'cohort_year + year_offset (0131), which need no yearly maintenance. Kept '
  'only until team_members.year is repointed; do not write it in new code.';
comment on column public.people.year_offset is
  'A DIFFERENCE, never a ชั้นปี — see students.year_offset and 0131.';

create or replace function public.people_sync_full_name()
returns trigger language plpgsql as $$
begin
  -- Only when the split is actually there. A row that has only a combined name
  -- must come through untouched, or the 303 inherited names get blanked.
  if nullif(btrim(coalesce(new.first_name_th, '')), '') is not null
     or nullif(btrim(coalesce(new.last_name_th, '')), '') is not null then
    new.full_name := nullif(btrim(
      coalesce(btrim(new.first_name_th), '') || ' ' || coalesce(btrim(new.last_name_th), '')), '');
  end if;
  return new;
end;
$$;

drop trigger if exists people_sync_full_name on public.people;
create trigger people_sync_full_name
  before insert or update of first_name_th, last_name_th on public.people
  for each row execute function public.people_sync_full_name();

-- kkumail identifies the person, so it may not be held twice. Partial, because
-- the 16 shared department accounts legitimately have none.
create unique index if not exists people_kkumail_uniq
  on public.people (lower(btrim(kkumail)))
  where kkumail is not null and btrim(kkumail) <> '';

-- ------------------------------------------------------------
-- §3 — `students` points at the registry
-- ------------------------------------------------------------
alter table public.students
  add column if not exists person_id uuid references public.people(id) on delete set null;

create index if not exists students_person_idx on public.students (person_id);

comment on column public.students.person_id is
  'The human this house placement belongs to (0132). The identity columns '
  'beside it are still written and still read — this migration is EXPAND-only '
  'and the contract step retires them one reader at a time.';

-- ------------------------------------------------------------
-- §4 — the backfill, in the one order that cannot create a duplicate human
--
--   a. every student whose kkumail ALREADY has a person → link, and give that
--      person the split name / cohort the student row carries;
--   b. every student with no match → create the person, then link.
--
-- Doing (b) first would insert a second row for someone ทีม SAMO already knows,
-- which is the exact duplicate this whole migration exists to remove.
-- ------------------------------------------------------------
update public.students s
   set person_id = p.id
  from public.people p
 where s.person_id is null
   and s.kkumail is not null and btrim(s.kkumail) <> ''
   and lower(btrim(p.kkumail)) = lower(btrim(s.kkumail));

-- The identity a matched student brings with them. ระบบบ้าน is closer to the
-- university's own record for these four, and `students.self_edited` already
-- means the person's own correction has beaten the import — so this never
-- overwrites a human's answer with a machine's. Only fills what is EMPTY on the
-- registry side, so an existing ทีม SAMO value is never silently replaced.
update public.people p
   set first_name_th = coalesce(p.first_name_th, s.first_name_th),
       last_name_th  = coalesce(p.last_name_th,  s.last_name_th),
       student_id    = coalesce(nullif(btrim(coalesce(p.student_id, '')), ''), s.student_id),
       major         = coalesce(nullif(btrim(coalesce(p.major, '')), ''), s.major),
       cohort_year   = coalesce(p.cohort_year, s.cohort_year),
       year_offset   = coalesce(p.year_offset, s.year_offset),
       bio           = coalesce(p.bio, s.bio)
  from public.students s
 where s.person_id = p.id;

-- Students the registry has never heard of.
with fresh as (
  insert into public.people
    (kkumail, first_name_th, last_name_th, full_name, nickname, student_id,
     major, cohort_year, year_offset, bio, photo_url, photo_focus)
  select s.kkumail, s.first_name_th, s.last_name_th, s.full_name, s.nickname,
         s.student_id, s.major, s.cohort_year, s.year_offset, s.bio,
         s.photo_url, s.photo_focus
    from public.students s
   where s.person_id is null
     and s.kkumail is not null and btrim(s.kkumail) <> ''
  returning id, kkumail
)
update public.students s
   set person_id = f.id
  from fresh f
 where s.person_id is null
   and lower(btrim(s.kkumail)) = lower(btrim(f.kkumail));

-- ------------------------------------------------------------
-- §5 — one edit, both placements
--
-- The mirror `team_people` already had (0108/0113) pushed a registry edit down
-- to `team_members`. It now pushes to `students` as well, so the identity
-- columns the contract step has not yet retired cannot drift while they exist.
--
-- THIS IS THE POINT OF THE MIGRATION, not a side effect: from here there is one
-- place a person's name is written, and the two copies are downstream of it.
-- Rebuilt from the LIVE 0113 body, never from 0108 which first defined it.
-- ------------------------------------------------------------
create or replace function public.person_mirror_down()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.team_members m
     set full_name   = new.full_name,
         nickname    = new.nickname,
         year        = new.year,
         major       = new.major,
         photo_url   = new.photo_url,
         photo_focus = new.photo_focus,
         student_id  = new.student_id,
         kkumail     = new.kkumail,
         user_id     = coalesce(new.user_id, m.user_id)
   where m.person_id = new.id
     and (m.full_name, m.nickname, m.year, m.major, m.photo_url,
          m.photo_focus, m.student_id, m.kkumail)
         is distinct from
         (new.full_name, new.nickname, new.year, new.major,
          new.photo_url, new.photo_focus, new.student_id, new.kkumail);

  -- The house half. `sai_code` is NOT here and never will be: it is the
  -- university's advisor assignment and it decides the house, so it belongs to
  -- the placement, not to the identity. Neither is `nickname` — `students`
  -- generates it from nickname_self/nickname_imported, and writing the
  -- generated column would 428C9.
  update public.students s
     set first_name_th = new.first_name_th,
         last_name_th  = new.last_name_th,
         student_id    = new.student_id,
         major         = new.major,
         year_offset   = new.year_offset,
         photo_url     = new.photo_url,
         photo_focus   = new.photo_focus,
         bio           = new.bio
   where s.person_id = new.id
     and (s.first_name_th, s.last_name_th, s.student_id, s.major,
          s.year_offset, s.photo_url, s.photo_focus, s.bio)
         is distinct from
         (new.first_name_th, new.last_name_th, new.student_id, new.major,
          new.year_offset, new.photo_url, new.photo_focus, new.bio);
  return new;
end;
$$;

drop trigger if exists team_people_mirror_down on public.people;
drop trigger if exists people_mirror_down on public.people;
create trigger people_mirror_down
  after update of full_name, first_name_th, last_name_th, nickname, year, major,
                  photo_url, photo_focus, student_id, kkumail, user_id,
                  cohort_year, year_offset, bio
  on public.people
  for each row execute function public.person_mirror_down();

-- The old function is left in place but unused — dropping it would cascade to
-- nothing now, and keeping it one migration longer makes a revert trivial.
comment on function public.team_person_mirror_down() is
  'SUPERSEDED by person_mirror_down() (0132), which also mirrors to students. '
  'No trigger references this. Safe to drop once 0132 has settled.';

-- ------------------------------------------------------------
-- §6 — ONE read for "who am I"
--
-- Replaces two round trips that answered overlapping questions: the home page
-- called get_my_team_seat() AND get_my_student_record() and rendered two cards
-- that repeated ชื่อ, ชื่อเล่น, รหัสนักศึกษา and สาขา at each other.
--
-- Composed from the two existing functions rather than reimplementing either.
-- That is deliberate: every gate, every allow-list and every "which columns are
-- published" decision in them stays in exactly one place, and this cannot drift
-- from what the individual cards would have shown.
--
-- `identity` is the merged answer. On a conflict between the two sources,
-- ระบบบ้าน wins on name / รหัสนักศึกษา / สาขา (it descends from the university
-- roster, and self_edited already means the person's own correction beat the
-- import) and ทีม SAMO wins on the photo (it has the crop pipeline). Recorded
-- here rather than in the client so a future Discord bot reads the same answer.
-- ------------------------------------------------------------
create or replace function public.get_my_profile()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_uid   uuid := auth.uid();
  v_house jsonb;
  v_seat  jsonb;
  v_has_seat boolean;
begin
  if v_uid is null then return null; end if;

  v_house := public.get_my_student_record();          -- null when not a student
  v_seat  := public.get_my_team_seat();               -- an EMPTY shape, not null
  v_has_seat := coalesce(jsonb_array_length(v_seat->'postings'), 0) > 0;

  -- Neither system knows this person. An ordinary visitor, and the honest
  -- answer is nothing at all — not an empty card, not an explanation.
  if v_house is null and not v_has_seat then return null; end if;

  return jsonb_build_object(
    'identity', jsonb_build_object(
      'kkumail',     coalesce(v_house->>'kkumail',    v_seat->>'email'),
      'full_name',   coalesce(v_house->>'full_name',  v_seat->>'name'),
      'first_name',  v_house->>'first_name',
      'last_name',   v_house->>'last_name',
      'nickname',    coalesce(v_house->>'nickname',   v_seat->>'nickname'),
      'student_id',  coalesce(v_house->>'student_id',
                              v_seat->'postings'->0->>'student_id'),
      'major',       coalesce(v_house->>'major',
                              v_seat->'postings'->0->>'major'),
      'cohort_year', (v_house->>'cohort_year')::int,
      'year_offset', (v_house->>'year_offset')::int,
      -- ทีม SAMO owns the portrait: it is the only one with a crop pipeline.
      'photo_url',   coalesce(v_seat->'postings'->0->>'photo_url',
                              v_house->>'photo_url'),
      'photo_focus', coalesce(v_seat->'postings'->0->>'photo_focus',
                              v_house->>'photo_focus'),
      -- The LEGACY typed ชั้นปี, for a person ระบบบ้าน does not know. Where
      -- there is a cohort the client derives the year instead (0131) and
      -- ignores this.
      'team_year',   v_seat->'postings'->0->>'year',
      'in_house',    v_house is not null,
      'in_team',     v_has_seat
    ),
    'house', v_house,
    'team',  case when v_has_seat then v_seat else null end
  );
end;
$$;

revoke all on function public.get_my_profile() from public;
revoke all on function public.get_my_profile() from anon;
grant execute on function public.get_my_profile() to authenticated;

comment on function public.get_my_profile() is
  'The caller''s whole record — identity + house placement + ทีม SAMO postings '
  '— in one call. Takes NO argument: identity comes from auth.uid(), so it '
  'cannot be pointed at anyone else and cannot become a directory lookup.';

-- ------------------------------------------------------------
-- §7 — ONE write for the shared identity
--
-- Before this, the same four fields had two editors: the ระบบบ้าน card wrote
-- `students` through update_my_student_record(), and the ทีม SAMO card PATCHed
-- every `team_members` row carrying the caller's kkumail. Editing your name in
-- one place left the other saying something else — two implementations of one
-- fact, which is the failure class this repo pays for most.
--
-- Now there is one entry point and it writes both, so they cannot diverge even
-- while both columns still exist. Note what it does NOT do: it never touches
-- sai_code (the house is not the person's to choose, 0125) and never touches a
-- posting, a permission or a node.
-- ------------------------------------------------------------
create or replace function public.update_my_identity(p_patch jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid   uuid := auth.uid();
  v_email text;
  v_full  text;
begin
  if v_uid is null then raise exception 'ต้องเข้าสู่ระบบก่อน'; end if;
  select email into v_email from public.users where id = v_uid;
  if v_email is null or length(btrim(v_email)) = 0 then
    raise exception 'บัญชีนี้ไม่มีอีเมล';
  end if;

  -- The house half FIRST, because it owns the validation: the รหัสนักศึกษา
  -- format, the uniqueness race, the สาขา vocabulary and the "you may not erase
  -- a name that exists" rule all live in update_my_student_record (0125/0126/
  -- 0131). Running it first means a rejected patch raises before anything at
  -- all has been written, instead of after ทีม SAMO already took it.
  if exists (select 1 from public.students
              where lower(btrim(kkumail)) = lower(btrim(v_email))) then
    perform public.update_my_student_record(p_patch);
  end if;

  -- The ทีม SAMO half. Every posting the person holds, because a member with
  -- two postings has two rows and writing one is how the `drift` finding this
  -- card exists to clear gets created.
  --
  -- `app.team_sync` is the documented server-writer exemption (0110): this runs
  -- as a definer with the member's own auth.uid(), and team_members_self_update_guard
  -- would otherwise refuse a write it should allow. A client cannot set it.
  perform set_config('app.team_sync', '1', true);

  select full_name into v_full from public.students
   where lower(btrim(kkumail)) = lower(btrim(v_email));

  update public.team_members m
     set full_name  = case
           -- Prefer what ระบบบ้าน now holds (it was just validated); fall back to
           -- the patch for a person with no students row at all.
           when v_full is not null and btrim(v_full) <> '' then v_full
           when p_patch ? 'first_name_th' or p_patch ? 'last_name_th'
             then nullif(btrim(coalesce(p_patch->>'first_name_th', '') || ' '
                             || coalesce(p_patch->>'last_name_th', '')), '')
           else m.full_name end,
         nickname   = case when p_patch ? 'nickname_self'
                           then nullif(btrim(coalesce(p_patch->>'nickname_self','')), '')
                           else m.nickname end,
         student_id = case when p_patch ? 'student_id'
                           then nullif(btrim(coalesce(p_patch->>'student_id','')), '')
                           else m.student_id end,
         major      = case when p_patch ? 'major'
                           then nullif(btrim(coalesce(p_patch->>'major','')), '')
                           else m.major end
   where lower(btrim(m.kkumail)) = lower(btrim(v_email));

  perform set_config('app.team_sync', '', true);

  -- …and the registry itself, so `people` is not the one copy left stale.
  update public.people p
     set first_name_th = coalesce(s.first_name_th, p.first_name_th),
         last_name_th  = coalesce(s.last_name_th,  p.last_name_th),
         nickname      = coalesce(s.nickname,      p.nickname),
         student_id    = coalesce(s.student_id,    p.student_id),
         major         = coalesce(s.major,         p.major),
         cohort_year   = coalesce(s.cohort_year,   p.cohort_year),
         year_offset   = s.year_offset
    from public.students s
   where s.person_id = p.id
     and lower(btrim(s.kkumail)) = lower(btrim(v_email));

  return public.get_my_profile();
end;
$$;

revoke all on function public.update_my_identity(jsonb) from public;
revoke all on function public.update_my_identity(jsonb) from anon;
grant execute on function public.update_my_identity(jsonb) to authenticated;

comment on function public.update_my_identity(jsonb) is
  'The ONE writer for a person''s shared identity (0132). Writes the house '
  'placement, every ทีม SAMO posting, and the registry row, so the copies that '
  'still exist cannot drift while the contract step retires them. Never writes '
  'sai_code, a posting, a permission or a node.';
