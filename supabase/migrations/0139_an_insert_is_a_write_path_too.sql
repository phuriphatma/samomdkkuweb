-- ============================================================
-- 0139 — an INSERT is a write path too, and a person with no placements is
--        not a person
--
-- WHAT WAS ASKED
--   "shouldn't there be information of นักศึกษา in house system of all people of
--    teamsamo, but will there be an issue when data from dataanalytic come, or
--    people edit their names, what's the best practice"
--   "ฝ่ายเอิง(test) have been remove a while ago but it still shows suggestion"
--
-- The first question has a short answer and a bug behind it.
--
-- SHORT ANSWER: no, and the question dissolves once `people` exists. A
-- `students` row is a HOUSE PLACEMENT — it exists to carry `sai_code`, which
-- decides the บ้าน — and ทีม SAMO has no สายรหัส to give it. Pre-creating ~380
-- rows with an empty สาย would put those people in a house-less state the UI has
-- to explain, for a week, for nothing: the identity is ALREADY shared, because
-- every ทีม SAMO member has a `people` row, and when the faculty file lands each
-- of them acquires a placement by kkumail automatically.
--
-- THE BUG BEHIND IT. "Automatically" was doing a lot of work. Measured:
--
--   people   : ชื่อที่เจ้าตัวกรอก นามสกุลจริง     ← what the person typed
--   students : ชื่อจากไฟล์ นามสกุลจากไฟล์          ← what the file said
--   linked   : yes
--   conflicts: 0
--
-- 0138 taught the import not to overwrite a self-edit — on UPDATE. The path
-- that matters for every one of the ~380 ทีม SAMO members is the INSERT that
-- CREATES their house placement, and it was unguarded: the new row takes the
-- file's spelling, `self_edited` is empty because the row is new, and the
-- registry quietly disagrees with the placement that points at it. The person's
-- own card reads `students`, so their edit is simply gone and nothing says so.
--
-- This is class 4 — a fix applied to one PATH is not a fix — and it is the
-- fourth time in this repo. `students_keep_self_edits` and both 0138 hooks are
-- `before update`.
--
-- THE RULE, unchanged from 0138 and now applied on both paths:
--   • an IMPORT (a write stamping `last_import_batch`) may not overwrite a
--     value a human already supplied. It keeps the registry's value and records
--     the disagreement.
--   • a HUMAN creating the row is the newer human answer, so it wins — and now
--     travels UP to the registry, which an INSERT never did either.
--
-- AND THE GHOSTS. `resolve_person_id` creates a `people` row for every new
-- placement (0133). Deleting the placement left the person behind, so a
-- deleted test ฝ่าย kept offering its members in the ทีม SAMO picker. Three such
-- rows exist today ("นาย", "ชื่อเอิง นามสกุลเอิง", "Ung") — all test junk, none
-- with a login. §3 refcounts them away.
-- ============================================================

-- ------------------------------------------------------------
-- §1 — reconcile a new placement against the person it belongs to
--
-- Folded INTO `students_link_person` rather than added as a second BEFORE
-- INSERT trigger, deliberately: two triggers on the same event fire in NAME
-- order, and a rule whose correctness depends on somebody never renaming a
-- trigger is not a rule. This one resolves the person and then reconciles
-- against them, in that order, in one function.
-- ------------------------------------------------------------
create or replace function public.students_link_person()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  p public.people%rowtype;
  v_import boolean := new.last_import_batch is not null;
begin
  if new.person_id is null then
    new.person_id := public.resolve_person_id(
      new.kkumail, null, new.first_name_th, new.last_name_th,
      new.student_id, new.major, new.nickname_imported);
  end if;

  select * into p from public.people where id = new.person_id;
  if not found then return new; end if;

  -- An IMPORT may not overwrite what a human already put in the registry. Only
  -- where the registry HAS a value and the file disagrees; where the registry is
  -- empty the file is the only answer anyone has, and it is written.
  if v_import then
    if nullif(btrim(coalesce(p.first_name_th, '')), '') is not null
       and coalesce(new.first_name_th, '') is distinct from coalesce(p.first_name_th, '') then
      perform public.record_identity_conflict(
        p.id, 'first_name_th', p.first_name_th, new.first_name_th, new.last_import_batch);
      new.first_name_th := p.first_name_th;
    end if;
    if nullif(btrim(coalesce(p.last_name_th, '')), '') is not null
       and coalesce(new.last_name_th, '') is distinct from coalesce(p.last_name_th, '') then
      perform public.record_identity_conflict(
        p.id, 'last_name_th', p.last_name_th, new.last_name_th, new.last_import_batch);
      new.last_name_th := p.last_name_th;
    end if;
    if nullif(btrim(coalesce(p.student_id, '')), '') is not null
       and coalesce(new.student_id, '') is distinct from coalesce(p.student_id, '') then
      perform public.record_identity_conflict(
        p.id, 'student_id', p.student_id, new.student_id, new.last_import_batch);
      new.student_id := p.student_id;
    end if;
    if nullif(btrim(coalesce(p.major, '')), '') is not null
       and coalesce(new.major, '') is distinct from coalesce(p.major, '') then
      perform public.record_identity_conflict(
        p.id, 'major', p.major, new.major, new.last_import_batch);
      new.major := p.major;
    end if;

    -- The columns the file does NOT carry are filled from the registry, so a
    -- ทีม SAMO member arrives in ระบบบ้าน complete rather than half-named. This
    -- is the "should there be นักศึกษา information for all of ทีม SAMO" answer
    -- in one line: there is, and it arrives with the placement.
    new.first_name_th := coalesce(new.first_name_th, p.first_name_th);
    new.last_name_th  := coalesce(new.last_name_th,  p.last_name_th);
    new.student_id    := coalesce(new.student_id,    p.student_id);
    new.major         := coalesce(new.major,         p.major);
    new.nickname_imported := coalesce(new.nickname_imported, p.nickname);
  end if;

  return new;
end;
$$;

-- ------------------------------------------------------------
-- §2 — a HUMAN-created placement travels UP
--
-- The mirrors are `after update`. An admin hand-creating a student, or the
-- ทีม SAMO picker creating a posting, wrote a name the registry never heard —
-- and the next edit anywhere would resolve the disagreement arbitrarily.
--
-- Import inserts are excluded: §1 has already made them agree with the registry
-- by construction, so mirroring them up is at best a no-op and at worst
-- undoes §1.
-- ------------------------------------------------------------
create or replace function public.student_insert_mirror_up()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.person_id is null or new.last_import_batch is not null then return new; end if;
  update public.people p
     set first_name_th = coalesce(new.first_name_th, p.first_name_th),
         last_name_th  = coalesce(new.last_name_th,  p.last_name_th),
         nickname      = coalesce(new.nickname,      p.nickname),
         student_id    = coalesce(new.student_id,    p.student_id),
         major         = coalesce(new.major,         p.major),
         cohort_year   = coalesce(new.cohort_year,   p.cohort_year)
   where p.id = new.person_id
     and (p.first_name_th, p.last_name_th, p.nickname, p.student_id, p.major, p.cohort_year)
         is distinct from
         (coalesce(new.first_name_th, p.first_name_th),
          coalesce(new.last_name_th,  p.last_name_th),
          coalesce(new.nickname,      p.nickname),
          coalesce(new.student_id,    p.student_id),
          coalesce(new.major,         p.major),
          coalesce(new.cohort_year,   p.cohort_year));
  return new;
end;
$$;

drop trigger if exists student_insert_mirror_up on public.students;
create trigger student_insert_mirror_up
  after insert on public.students
  for each row execute function public.student_insert_mirror_up();

create or replace function public.team_member_insert_mirror_up()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.person_id is null then return new; end if;
  -- `coalesce` throughout: a new posting created with only a name must not
  -- blank the รหัส / สาขา / photo the registry already holds for this human.
  update public.people p
     set full_name     = coalesce(nullif(btrim(coalesce(new.full_name, '')), ''), p.full_name),
         first_name_th = coalesce(new.first_name_th, p.first_name_th),
         last_name_th  = coalesce(new.last_name_th,  p.last_name_th),
         nickname      = coalesce(new.nickname,      p.nickname),
         student_id    = coalesce(new.student_id,    p.student_id),
         major         = coalesce(new.major,         p.major),
         photo_url     = coalesce(new.photo_url,     p.photo_url),
         photo_focus   = coalesce(new.photo_focus,   p.photo_focus)
   where p.id = new.person_id
     and (p.full_name, p.first_name_th, p.last_name_th, p.nickname,
          p.student_id, p.major, p.photo_url, p.photo_focus)
         is distinct from
         (coalesce(nullif(btrim(coalesce(new.full_name, '')), ''), p.full_name),
          coalesce(new.first_name_th, p.first_name_th),
          coalesce(new.last_name_th,  p.last_name_th),
          coalesce(new.nickname,      p.nickname),
          coalesce(new.student_id,    p.student_id),
          coalesce(new.major,         p.major),
          coalesce(new.photo_url,     p.photo_url),
          coalesce(new.photo_focus,   p.photo_focus));
  return new;
end;
$$;

drop trigger if exists team_member_insert_mirror_up on public.team_members;
create trigger team_member_insert_mirror_up
  after insert on public.team_members
  for each row execute function public.team_member_insert_mirror_up();

-- ------------------------------------------------------------
-- §3 — a person with no placements, no login and no confirmation is a leftover
--
-- REPORTED: "ฝ่ายเอิง(test) have been remove a while ago but it still shows
-- suggestion". `resolve_person_id` creates a registry row for every new
-- placement; deleting the placement left the person, and search_people (0137)
-- reads the registry, so a deleted test ฝ่าย kept offering its members.
--
-- REFCOUNTING, not a cascade — the same pattern the Drive photo delete already
-- uses, and for the same reason: the person is shared, so it goes only when the
-- LAST thing pointing at it goes. Three conditions, all necessary:
--   • no team_members row and no students row  → nothing references them;
--   • `user_id is null`                        → nobody has ever signed in as
--     them, so there is no account to orphan;
--   • `identity_confirmed_at is null`          → they have never told us this
--     record is theirs.
-- A student in the roster always has a `students` row, so the 1,800 are
-- untouchable by construction. What this can remove is exactly what created it:
-- a placement that was typed and then deleted.
--
-- The cost if it is ever wrong is a registry id, not data: a row meeting all
-- three conditions has no conflicts (those come from a students row), no
-- confirmation and no login, and re-adding the person recreates them by
-- kkumail.
-- ------------------------------------------------------------
create or replace function public.prune_orphan_person()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.person_id is null then return null; end if;
  delete from public.people p
   where p.id = old.person_id
     and p.user_id is null
     and p.identity_confirmed_at is null
     and not exists (select 1 from public.team_members m where m.person_id = p.id)
     and not exists (select 1 from public.students s where s.person_id = p.id);
  return null;
end;
$$;

drop trigger if exists team_members_prune_person on public.team_members;
create trigger team_members_prune_person
  after delete on public.team_members
  for each row execute function public.prune_orphan_person();

drop trigger if exists students_prune_person on public.students;
create trigger students_prune_person
  after delete on public.students
  for each row execute function public.prune_orphan_person();

comment on function public.prune_orphan_person() is
  'Refcount for public.people (0139): removes a registry row when its LAST '
  'placement is deleted, and only when nobody has signed in as them and they '
  'have never confirmed their record. A roster student always has a students '
  'row, so the import population cannot be reached by this.';

-- The three that already exist. Same three conditions, written out rather than
-- delegated, so this statement is readable on its own in the migration log.
delete from public.people p
 where p.user_id is null
   and p.identity_confirmed_at is null
   and not exists (select 1 from public.team_members m where m.person_id = p.id)
   and not exists (select 1 from public.students s where s.person_id = p.id);

-- ------------------------------------------------------------
-- §4 — the picker ranks a person nothing knows about LAST
--
-- §3 makes a placement-less person impossible to create going forward, but the
-- registry legitimately holds people with no ทีม SAMO posting (every one of the
-- 1,800 students, once the file lands) — and `in_house` is what distinguishes
-- "a student who is not on the team" from "a leftover". Ranking on it means the
-- real candidates come first without hiding anything.
--
-- Rebuilt from 0137 with one added ORDER BY term and the `in_house` flag now
-- feeding it. Nothing else changed.
-- ------------------------------------------------------------
create or replace function public.search_people(p_q text, p_limit int default 20)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_q     text;
  v_pat   text;
  v_pre   text;
  v_digits text;
  v_limit int;
  v_out   jsonb;
begin
  if auth.uid() is null then raise exception 'ต้องเข้าสู่ระบบก่อน'; end if;
  if not (public.current_user_role() = any (array['vp_admin','dev'])
          or public.current_user_has_permission('team')
          or public.current_user_has_permission('team_edit')
          or public.current_user_has_permission('house')) then
    raise exception 'ไม่มีสิทธิ์ค้นข้อมูลบุคคล';
  end if;

  v_q := btrim(coalesce(p_q, ''));
  if length(v_q) < 2 then return '[]'::jsonb; end if;

  -- ESCAPE FIRST. Without this the argument is a pattern the caller controls,
  -- which is 0101 exactly. Backslash first, or it re-escapes the escapes.
  v_q := replace(v_q, '\', '\\');
  v_q := replace(v_q, '%', '\%');
  v_q := replace(v_q, '_', '\_');
  v_pat := '%' || v_q || '%';
  v_pre := v_q || '%';
  v_digits := nullif(regexp_replace(coalesce(p_q, ''), '\D', '', 'g'), '');
  v_limit := least(greatest(coalesce(p_limit, 20), 1), 50);

  -- ⚠️ `rank` BEFORE `stale`, and the 0137 proof is why. Ordering on staleness
  -- first buried an EXACT kkumail match — the strongest signal there is, since
  -- the admin typed the whole address — underneath every ordinary substring hit
  -- that happened to hold a placement. Staleness breaks ties WITHIN a relevance
  -- band; it does not outrank relevance.
  select coalesce(jsonb_agg(r order by r.rank, r.stale, r.full_name), '[]'::jsonb)
    into v_out
    from (
      select p.id, p.kkumail, p.full_name, p.first_name_th, p.last_name_th,
             p.nickname, p.student_id, p.major,
             coalesce(p.cohort_year, public.cohort_from_student_id(p.student_id))
               as cohort_year,
             exists (select 1 from public.team_members m where m.person_id = p.id)
               as in_team,
             coalesce((select string_agg(distinct n.name, ' · ')
                         from public.team_members m
                         join public.team_nodes n on n.id = m.node_id
                        where m.person_id = p.id), '') as team_nodes,
             exists (select 1 from public.students s where s.person_id = p.id)
               as in_house,
             -- Nothing in either system knows this person. §3 stops new ones
             -- appearing; this keeps any survivor at the bottom of the list
             -- instead of beside the real candidates.
             case when exists (select 1 from public.team_members m where m.person_id = p.id)
                    or exists (select 1 from public.students s where s.person_id = p.id)
                  then 0 else 1 end as stale,
             case
               when lower(btrim(coalesce(p.kkumail, ''))) = lower(btrim(p_q)) then 0
               when p.student_id is not null and v_digits is not null
                    and regexp_replace(p.student_id, '\D', '', 'g') = v_digits then 0
               when coalesce(p.first_name_th, '') ilike v_pre
                 or coalesce(p.full_name, '')     ilike v_pre
                 or coalesce(p.nickname, '')      ilike v_pre then 1
               else 2
             end as rank
        from public.people p
       where coalesce(p.full_name, '')     ilike v_pat
          or coalesce(p.first_name_th, '') ilike v_pat
          or coalesce(p.last_name_th, '')  ilike v_pat
          or coalesce(p.nickname, '')      ilike v_pat
          or coalesce(p.kkumail, '')       ilike v_pat
          or coalesce(p.major, '')         ilike v_pat
          or (v_digits is not null and p.student_id is not null
              and regexp_replace(p.student_id, '\D', '', 'g') like '%' || v_digits || '%')
       order by rank, stale, p.full_name
       limit v_limit
    ) r;

  return v_out;
end;
$$;
