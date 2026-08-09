-- ============================================================
-- 0140 — giving a placement somebody's address MOVES it to that person
--
-- REPORTED: pressing "เป็นคนเดียวกับ ปวีณ์ธิดา สัชญูกร" in ตรวจสอบข้อมูล →
--   23505 duplicate key value violates unique constraint
--   "team_people_kkumail_uniq"  Key (lower(btrim(kkumail)))=(…) already exists.
--
-- WHAT THE ACTION MEANS, and what it did. The button says "this posting belongs
-- to that human". What the code did was write the address onto the row, which
-- `team_member_mirror_up` then pushed to THIS row's own registry person — trying
-- to make a SECOND `people` row hold an address a first one already holds. The
-- unique index refused, correctly: kkumail identifies a person (0108), so two
-- rows holding one address is the exact thing it exists to prevent.
--
-- The row's person was created by `resolve_person_id` precisely BECAUSE it had
-- no address (0133: "a row with no kkumail gets its own person, because there is
-- nothing to match it on"). So the merge the admin asked for is not a rename of
-- that person — it is a RE-POINT of the placement at the person who already
-- holds the address. Nothing about the target changes; the placeholder person is
-- what should go.
--
-- WHY THE FIRST TWO REPRO ATTEMPTS PASSED, recorded because it is the useful
-- part. Writing only `kkumail` did not fail. The mirror is guarded by
-- `is distinct from` over the OTHER identity columns, and a freshly resolved
-- person is a copy of the row that made it — so the guard was false and the
-- kkumail write never happened at all. It takes a second changed column to make
-- the mirror fire, and the real handler sends `student_id` alongside. That also
-- means the registry was silently NOT learning addresses in that case, which
-- §2 fixes as well.
--
-- ============================================================

-- ------------------------------------------------------------
-- §1 — one unique index, not two
--
-- 0132 renamed `team_people` to `people` and created `people_kkumail_uniq` with
-- `if not exists` — which is true of the NAME, not of the expression, so 0108's
-- `team_people_kkumail_uniq` survived alongside it. Two identical unique indexes
-- on one expression: twice the write cost, and the error message names whichever
-- one Postgres happened to check, which is how a report arrives quoting a table
-- that no longer exists.
-- ------------------------------------------------------------
drop index if exists public.team_people_kkumail_uniq;

-- ------------------------------------------------------------
-- §2 — an address change RE-POINTS the placement
--
-- BEFORE UPDATE, so `person_id` is already correct by the time the AFTER mirror
-- runs and there is nothing to collide with.
--
-- The incoming row's EMPTY identity columns are filled from the person it is
-- joining. That is not a nicety: without it the mirror would push this row's
-- sparse values onto the target and blank the nickname / รหัส / photo that the
-- person already had — turning "use the same data" into "lose the data". It is
-- the same shape as 0139 §1, and the same reason.
-- ------------------------------------------------------------
create or replace function public.team_members_repoint_person()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_mail text := nullif(lower(btrim(coalesce(new.kkumail, ''))), '');
  v_target uuid;
  p public.people%rowtype;
begin
  if v_mail is null then return new; end if;
  if new.kkumail is not distinct from old.kkumail then return new; end if;

  select id into v_target from public.people
   where lower(btrim(kkumail)) = v_mail;
  if v_target is null or v_target = new.person_id then return new; end if;

  new.person_id := v_target;

  -- Take what this row does not have from the person it is joining, so the
  -- mirror cannot blank the target's fields with this row's nulls.
  select * into p from public.people where id = v_target;
  new.full_name     := coalesce(nullif(btrim(coalesce(new.full_name, '')), ''), p.full_name);
  new.first_name_th := coalesce(new.first_name_th, p.first_name_th);
  new.last_name_th  := coalesce(new.last_name_th,  p.last_name_th);
  new.nickname      := coalesce(new.nickname,      p.nickname);
  new.student_id    := coalesce(new.student_id,    p.student_id);
  new.major         := coalesce(new.major,         p.major);
  new.photo_url     := coalesce(new.photo_url,     p.photo_url);
  new.photo_focus   := coalesce(new.photo_focus,   p.photo_focus);
  return new;
end;
$$;

drop trigger if exists team_members_repoint_person on public.team_members;
create trigger team_members_repoint_person
  before update of kkumail on public.team_members
  for each row execute function public.team_members_repoint_person();

-- The ระบบบ้าน twin. An admin correcting a student's kkumail to one the registry
-- already knows is the same merge, and would 23505 in the same place.
create or replace function public.students_repoint_person()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_mail text := nullif(lower(btrim(coalesce(new.kkumail, ''))), '');
  v_target uuid;
  p public.people%rowtype;
begin
  if v_mail is null then return new; end if;
  if new.kkumail is not distinct from old.kkumail then return new; end if;

  select id into v_target from public.people
   where lower(btrim(kkumail)) = v_mail;
  if v_target is null or v_target = new.person_id then return new; end if;

  new.person_id := v_target;
  select * into p from public.people where id = v_target;
  new.first_name_th := coalesce(new.first_name_th, p.first_name_th);
  new.last_name_th  := coalesce(new.last_name_th,  p.last_name_th);
  new.student_id    := coalesce(new.student_id,    p.student_id);
  new.major         := coalesce(new.major,         p.major);
  -- NOT sai_code, and never. The house is a placement fact (0132).
  return new;
end;
$$;

drop trigger if exists students_repoint_person on public.students;
create trigger students_repoint_person
  before update of kkumail on public.students
  for each row execute function public.students_repoint_person();

-- ------------------------------------------------------------
-- §3 — the placeholder person left behind
--
-- 0139 refcounts a person away when its last placement is DELETED. A re-point
-- is not a delete — the placement moved — so the same leftover appears by a
-- different door, and a picker offering a duplicate of somebody is exactly the
-- report 0139 was fixing. Same three conditions, same reasoning.
-- ------------------------------------------------------------
create or replace function public.prune_person_after_repoint()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.person_id is null or old.person_id is not distinct from new.person_id then
    return null;
  end if;
  delete from public.people p
   where p.id = old.person_id
     and p.user_id is null
     and p.identity_confirmed_at is null
     and not exists (select 1 from public.team_members m where m.person_id = p.id)
     and not exists (select 1 from public.students s where s.person_id = p.id);
  return null;
end;
$$;

-- ⚠️ NO COLUMN LIST, and the proof is why. `after update of person_id` fires on
-- the columns named in the UPDATE STATEMENT, not on what a BEFORE trigger
-- changed — and `person_id` here is changed by §2, never by the caller, whose
-- statement says `set kkumail = …, student_id = …`. So the column list matched
-- nothing and the placeholder person survived every re-point. The guard lives
-- inside the function instead, where it can see both tuples.
drop trigger if exists team_members_prune_after_repoint on public.team_members;
create trigger team_members_prune_after_repoint
  after update on public.team_members
  for each row execute function public.prune_person_after_repoint();

drop trigger if exists students_prune_after_repoint on public.students;
create trigger students_prune_after_repoint
  after update on public.students
  for each row execute function public.prune_person_after_repoint();

comment on function public.team_members_repoint_person() is
  'Giving a posting an address that another person already holds MOVES the '
  'posting to that person (0140), instead of trying to give two registry rows '
  'one address — which is a 23505 on people_kkumail_uniq and was the reported '
  'failure of ตรวจสอบข้อมูล''s "เป็นคนเดียวกับ …" button.';
