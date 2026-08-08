-- ============================================================
-- 0133 — the sync goes UP as well as down, and a new row is never an orphan
--
-- WHAT WAS ASKED
--   "sync user on web with teamsamo and ระบบบ้าน, sync teamsamo with user on
--    web and ระบบบ้าน, sync ระบบบ้าน with user on web and teamsamo"
--
-- 0132 gave `people` a mirror DOWN: edit the registry and both placements
-- follow. What it did not give is the way back. Only ONE of the three editors
-- goes through the registry:
--
--   the person's own card   → update_my_identity() → people → both     ✅ (0132)
--   the ทีม SAMO admin pane  → PATCH team_members directly              ❌
--   the ระบบบ้าน admin pane   → PATCH students directly                  ❌
--
-- So an admin fixing a name in ทีม SAMO left ระบบบ้าน saying the old one, and
-- vice versa — the same two-copies-of-one-fact failure 0132 exists to end, just
-- entered from a different door. This is class 4: authorization and invariants
-- alike are per-PATH, and "the write path is fixed" is only ever true of the
-- path you were looking at.
--
-- THE FIX IS A MIRROR UP, on each placement table, so the registry is reached
-- no matter which door the edit came through. Combined with 0132's mirror down,
-- any one edit converges on all three.
--
-- WHY THIS DOES NOT LOOP. Both directions are guarded by `is distinct from`:
-- a mirror only writes when the value actually differs. So
--   team_members edit → people (differs, writes) → down-mirror → students
--                                              → down-mirror → team_members
--                                                 (now equal, NO write) → stop
-- Two hops and it is quiescent. The guard is not an optimisation; without it
-- these two triggers are an infinite recursion.
--
-- AND A NEW ROW IS LINKED AT BIRTH. 0108's contract step has been owed since it
-- shipped: `createMember` and the ทีม SAMO CSV import both write
-- `person_id = null`, so every member added since then was unlinked and the
-- 0132 backfill only fixed the ones existing that day. Same for a student
-- created by hand. A BEFORE INSERT trigger now resolves the person by kkumail —
-- creating one if this is a human nobody has met — so the registry can never
-- fall behind again.
-- ============================================================

-- ------------------------------------------------------------
-- §1 — resolve (or create) the person a placement belongs to
--
-- kkumail is the key, and ONLY kkumail. 0108: `673070332-6` is one mistyped
-- รหัสนักศึกษา worn by two humans, and two people share a name far more often
-- than they share an address. A row with no kkumail — the 16 shared department
-- accounts — gets its own person, because there is nothing to match it on and
-- guessing would merge two strangers.
-- ------------------------------------------------------------
create or replace function public.resolve_person_id(
  p_kkumail text, p_full_name text, p_first text, p_last text,
  p_student_id text, p_major text, p_nickname text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_mail text := nullif(lower(btrim(coalesce(p_kkumail, ''))), '');
  v_id   uuid;
begin
  if v_mail is not null then
    select id into v_id from public.people
     where lower(btrim(kkumail)) = v_mail;
    if found then return v_id; end if;
  end if;

  insert into public.people
    (kkumail, full_name, first_name_th, last_name_th, student_id, major, nickname)
  values (nullif(btrim(coalesce(p_kkumail, '')), ''), p_full_name, p_first, p_last,
          p_student_id, p_major, p_nickname)
  returning id into v_id;
  return v_id;
end;
$$;

comment on function public.resolve_person_id(text, text, text, text, text, text, text) is
  'Find the person with this kkumail, or create them. Matches on kkumail ONLY '
  '— never a name and never a รหัสนักศึกษา (0108). A row with no address gets '
  'its own person, because there is nothing to match on.';

-- ------------------------------------------------------------
-- §2 — every new placement is linked at birth
-- ------------------------------------------------------------
create or replace function public.team_members_link_person()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.person_id is null then
    new.person_id := public.resolve_person_id(
      new.kkumail, new.full_name, null, null, new.student_id, new.major, new.nickname);
  end if;
  return new;
end;
$$;

drop trigger if exists team_members_link_person on public.team_members;
create trigger team_members_link_person
  before insert on public.team_members
  for each row execute function public.team_members_link_person();

create or replace function public.students_link_person()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.person_id is null then
    new.person_id := public.resolve_person_id(
      new.kkumail, null, new.first_name_th, new.last_name_th,
      new.student_id, new.major, new.nickname_imported);
  end if;
  return new;
end;
$$;

drop trigger if exists students_link_person on public.students;
create trigger students_link_person
  before insert on public.students
  for each row execute function public.students_link_person();

-- ------------------------------------------------------------
-- §3 — the mirror UP, from each placement to the registry
--
-- `is distinct from` on every branch. That is what makes the pair of mirrors
-- converge instead of recursing: once the registry already holds the value, the
-- write does not happen, so the down-mirror is never triggered again.
--
-- Only fields the registry OWNS travel up. `sai_code`, `node_id`, permissions,
-- `confirmed` and the term are placement facts and stay where they are.
-- ------------------------------------------------------------
create or replace function public.team_member_mirror_up()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.person_id is null then return new; end if;
  update public.people p
     set full_name  = new.full_name,
         nickname   = new.nickname,
         student_id = new.student_id,
         major      = new.major,
         photo_url  = new.photo_url,
         photo_focus = new.photo_focus,
         kkumail    = coalesce(nullif(btrim(coalesce(new.kkumail, '')), ''), p.kkumail)
   where p.id = new.person_id
     and (p.full_name, p.nickname, p.student_id, p.major, p.photo_url, p.photo_focus)
         is distinct from
         (new.full_name, new.nickname, new.student_id, new.major,
          new.photo_url, new.photo_focus);
  return new;
end;
$$;

drop trigger if exists team_member_mirror_up on public.team_members;
create trigger team_member_mirror_up
  after update of full_name, nickname, student_id, major, photo_url,
                  photo_focus, kkumail
  on public.team_members
  for each row execute function public.team_member_mirror_up();

create or replace function public.student_mirror_up()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.person_id is null then return new; end if;
  update public.people p
     set first_name_th = new.first_name_th,
         last_name_th  = new.last_name_th,
         -- students.nickname is GENERATED from nickname_self/nickname_imported;
         -- the registry takes the effective value, which is what every screen
         -- shows anyway.
         nickname      = new.nickname,
         student_id    = new.student_id,
         major         = new.major,
         cohort_year   = new.cohort_year,
         year_offset   = new.year_offset,
         bio           = new.bio,
         photo_url     = coalesce(new.photo_url, p.photo_url),
         photo_focus   = coalesce(new.photo_focus, p.photo_focus)
   where p.id = new.person_id
     and (p.first_name_th, p.last_name_th, p.nickname, p.student_id, p.major,
          p.cohort_year, p.year_offset, p.bio)
         is distinct from
         (new.first_name_th, new.last_name_th, new.nickname, new.student_id,
          new.major, new.cohort_year, new.year_offset, new.bio);
  return new;
end;
$$;

drop trigger if exists student_mirror_up on public.students;
create trigger student_mirror_up
  after update of first_name_th, last_name_th, nickname_self, nickname_imported,
                  student_id, major, cohort_year, year_offset, bio,
                  photo_url, photo_focus
  on public.students
  for each row execute function public.student_mirror_up();

comment on function public.team_member_mirror_up() is
  'Pushes an identity edit made in the ทีม SAMO admin pane up to `people`, '
  'which 0132''s person_mirror_down then pushes to ระบบบ้าน. Guarded by '
  '`is distinct from` — without that guard this and the down-mirror recurse '
  'forever (0133).';
comment on function public.student_mirror_up() is
  'The ระบบบ้าน twin of team_member_mirror_up (0133). Same guard, same reason.';

-- ------------------------------------------------------------
-- §4 — one-time reconciliation
--
-- Rows edited between 0132 and now went into a placement without reaching the
-- registry. Written as DIRECT updates on `people`, not as a no-op touch of the
-- placement rows: the mirrors are `after update OF <columns>` and a touch of
-- `updated_at` is not in that list, so it would fire nothing and this section
-- would silently do nothing at all.
--
-- ระบบบ้าน first, ทีม SAMO second, so ทีม SAMO wins a tie — it is the
-- hand-curated one today (399 rows an admin typed, against 3 test students).
-- After this the question stops arising, because the mirrors keep them equal.
-- ------------------------------------------------------------
update public.people p
   set first_name_th = coalesce(s.first_name_th, p.first_name_th),
       last_name_th  = coalesce(s.last_name_th,  p.last_name_th),
       student_id    = coalesce(s.student_id,    p.student_id),
       major         = coalesce(s.major,         p.major),
       cohort_year   = coalesce(s.cohort_year,   p.cohort_year),
       year_offset   = coalesce(s.year_offset,   p.year_offset),
       bio           = coalesce(s.bio,           p.bio)
  from public.students s
 where s.person_id = p.id;

update public.people p
   set full_name   = coalesce(nullif(btrim(coalesce(m.full_name, '')), ''), p.full_name),
       nickname    = coalesce(m.nickname,    p.nickname),
       student_id  = coalesce(m.student_id,  p.student_id),
       major       = coalesce(m.major,       p.major),
       photo_url   = coalesce(m.photo_url,   p.photo_url),
       photo_focus = coalesce(m.photo_focus, p.photo_focus)
  from public.team_members m
 where m.person_id = p.id;
