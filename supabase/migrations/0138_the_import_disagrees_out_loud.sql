-- ============================================================
-- 0138 — when the faculty file disagrees with a person, say so instead of
--        picking a winner in silence
--
-- WHAT WAS ASKED
--   "when the data from dataanalytic comes maybe you should show what mismatch,
--    or use what data, because i'll let user check their data in about a week to
--    change their data to be correct, some will check, some won't, how will you
--    decide, make the best, best practice"
--
-- ---------------------------------------------------------------
-- THE ANSWER, STATED BEFORE THE CODE
--
-- Three rules, and the third is the one that makes the other two work.
--
-- 1. AUTHORITY IS PER FIELD, NOT PER ACTOR. "Trust the file" and "trust the
--    student" are both wrong, because they are answers to the wrong question.
--    The สายรหัส is the university's own advisor assignment and a student
--    cannot know it better — the file wins, and 0125 already removed the
--    student's ability to write it at all. A person's own ชื่อเล่น is not
--    something a roster export can be right about. Between those sit
--    รหัสนักศึกษา, ชื่อ, นามสกุล and สาขา, where either side can hold the typo.
--
-- 2. SILENCE IS NOT AGREEMENT. This is the whole of "some will check, some
--    won't". A person who never opened the page has claimed nothing, so there
--    is nothing to overrule: the file simply writes, and that is the vast
--    majority of the 1,800 rows. A person who TYPED something has made a claim
--    about their own name, and an import must not quietly delete it. The
--    system already knows the difference — `students.self_edited` records which
--    columns a person has taken over (0125) — so the rule needs no new
--    guesswork, only that the existing distinction stop being invisible.
--
-- 3. A DISAGREEMENT IS A THING, NOT A DROPPED WRITE. Today `students_keep_self_edits`
--    silently discards the file's value for a self-edited column. That is the
--    right OUTCOME and the wrong BEHAVIOUR: nobody ever learns the faculty
--    thinks this person's name is spelled differently, so the mismatch is
--    invisible until it matters (an exam list, a certificate). This migration
--    keeps the outcome and records the disagreement as a row somebody can act
--    on.
--
-- WHO RESOLVES IT. The person, first. 1,800 potential conflicts against one
-- admin is not a workflow; 1,800 people each answering one question about their
-- own name is. The admin list exists for whoever is left. Both write through
-- the same RPC, so "which value won" is recorded the same way either way.
--
-- AND `identity_confirmed_at`, which is the operational half of the question.
-- Without it there is no way to tell "looked at it and it is right" from "never
-- opened the page", and those need completely different follow-up. It is set
-- when a person presses ข้อมูลถูกต้อง, and it is what lets someone ask "who
-- still has not checked" a week later — which is the actual question behind
-- "some will check, some won't".
--
-- WHAT THIS MIGRATION DOES **NOT** DO. It does not auto-merge, does not pick a
-- winner by recency, and does not let an import overwrite a self-edit "because
-- the file is newer". Recency is not authority: the file is a snapshot of a
-- registry that was already stale when it was exported.
-- ============================================================

-- ------------------------------------------------------------
-- §1 — did this person ever actually look?
-- ------------------------------------------------------------
alter table public.people
  add column if not exists identity_confirmed_at timestamptz;

comment on column public.people.identity_confirmed_at is
  'When this person last pressed ข้อมูลถูกต้อง on their own card (0138). NULL '
  'means they have never checked — which is NOT the same as agreeing, and is '
  'the difference the whole reconciliation rests on. An edit is a stronger '
  'signal and also sets it.';

-- ------------------------------------------------------------
-- §2 — the disagreements themselves
--
-- Keyed on the PERSON, not on the students row: the registry is the account
-- (0132), and a conflict about someone's name is a fact about the human rather
-- than about one of their placements.
--
-- `mine` / `theirs` are stored as TEXT even for `student_id`, deliberately: the
-- point of the row is to show two strings to a human and ask which is right,
-- and a typed column would refuse to hold the malformed value that is very
-- often the actual problem.
-- ------------------------------------------------------------
create table if not exists public.identity_conflicts (
  id          uuid primary key default gen_random_uuid(),
  person_id   uuid not null references public.people(id) on delete cascade,
  field       text not null,
  mine        text,
  theirs      text,
  -- The REAL batch, not a label. `students.last_import_batch` is a uuid with a
  -- foreign key into student_import_batches, so anything looser here would be a
  -- second, weaker spelling of an identifier that already exists — and the
  -- first cut of this migration proved the point by declaring it `text`, which
  -- made the trigger's call fail to resolve (plpgsql does not implicitly cast a
  -- uuid argument to a text parameter, so it was a 42883 on the first import
  -- rather than a silent mismatch).
  batch_id    uuid references public.student_import_batches(id) on delete set null,
  status      text not null default 'open',
  resolution  text,
  resolved_at timestamptz,
  resolved_by uuid references public.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  constraint identity_conflicts_field_ck
    check (field in ('first_name_th', 'last_name_th', 'student_id', 'major')),
  constraint identity_conflicts_status_ck check (status in ('open', 'resolved')),
  constraint identity_conflicts_resolution_ck
    check (resolution is null or resolution in ('mine', 'theirs'))
);

-- ONE open conflict per person per field. A re-import that disagrees again must
-- UPDATE the standing question rather than stack a second copy of it — a person
-- opening their card to four identical rows about their surname will resolve
-- none of them.
create unique index if not exists identity_conflicts_open_uniq
  on public.identity_conflicts (person_id, field) where status = 'open';

create index if not exists identity_conflicts_person_idx
  on public.identity_conflicts (person_id);

-- Replay safety for the one environment that already took the first cut of this
-- file, where batch_id was created as text. Empty in every case (nothing had
-- imported yet), so the cast is free; written as a conditional rather than
-- assumed, because a migration that only works on a fresh database is not a
-- migration.
do $$
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'identity_conflicts'
                and column_name = 'batch_id' and data_type = 'text') then
    alter table public.identity_conflicts
      alter column batch_id type uuid using nullif(btrim(batch_id), '')::uuid;
    alter table public.identity_conflicts
      add constraint identity_conflicts_batch_fk
      foreign key (batch_id) references public.student_import_batches(id) on delete set null;
  end if;
end
$$;

-- The text-parameter version, if it was ever created. An overload left beside
-- the uuid one would resolve differently depending on the caller's argument
-- type, which is a coin toss nobody would think to check.
drop function if exists public.record_identity_conflict(uuid, text, text, text, text);

comment on table public.identity_conflicts is
  'A field where the faculty import disagreed with what the person themselves '
  'typed (0138). Recorded rather than resolved: the person''s value stays '
  'effective and this row is the question. NOT an error log — a resolved row '
  'is the record of who chose which value.';

alter table public.identity_conflicts enable row level security;

-- ⚠️ THE GRANT, WITHOUT WHICH EVERY POLICY BELOW IS DEAD. RLS narrows a
-- privilege that has to exist first; a table with policies and no GRANT refuses
-- everyone, and it refuses them in a way that looks exactly like the policies
-- working. The 0138 proof caught this: the person's own-read step returned 0
-- rows while the definer RPC beside it returned 1, and every DENY step was
-- passing vacuously.
grant select, insert, update, delete on public.identity_conflicts to authenticated;

-- Admins of either system may see and resolve any of them. `team` (read-only)
-- is deliberately absent: a conflict names two spellings of a real person's
-- name, which is more than a roster viewer needs.
-- Postgres has no `create or replace policy`, so a partial replay 42710s
-- without these (docs/mistakes/postgres-schema.md).
drop policy if exists "identity_conflicts_admin" on public.identity_conflicts;
create policy "identity_conflicts_admin" on public.identity_conflicts
  for all to authenticated
  using (public.current_user_role() = any (array['vp_admin','dev'])
         or public.current_user_has_permission('house')
         or public.current_user_has_permission('team_edit'))
  with check (public.current_user_role() = any (array['vp_admin','dev'])
         or public.current_user_has_permission('house')
         or public.current_user_has_permission('team_edit'));

-- Which registry row the CALLER is, resolved by a definer.
--
-- ⚠️ It has to be a definer, and this is the first entry in
-- docs/mistakes/authz-rls.md: an RLS policy's inline subquery is itself subject
-- to the referenced table's RLS. The obvious spelling of the own-read policy —
-- `exists (select 1 from public.people p join public.users u ...)` — reads
-- `people`, whose `people_read` policy requires team/team_edit/house. So for an
-- ordinary student, the person this whole feature is FOR, the subquery found
-- nothing and the policy denied them their own record. Shipped and caught by
-- the proof: the definer RPC beside it returned the conflict while the direct
-- read returned zero.
create or replace function public.my_person_id()
returns uuid language sql stable security definer set search_path = public as $$
  select p.id from public.people p
   where nullif(btrim(coalesce(public.current_user_email(), '')), '') is not null
     and lower(btrim(p.kkumail)) = lower(btrim(public.current_user_email()))
   limit 1;
$$;

revoke all on function public.my_person_id() from public;
revoke all on function public.my_person_id() from anon;
grant execute on function public.my_person_id() to authenticated;

comment on function public.my_person_id() is
  'The caller''s row in the person registry, or null. SECURITY DEFINER because '
  'it is used inside an RLS policy, where an inline subquery would be subject '
  'to people_read and would deny an ordinary student their own record (0138).';

-- The PERSON's own read path. Without it the form that collects a decision from
-- a named person is a promise that person cannot see — the same gap 0128 found
-- when an admin's verdict was written to a table no student could read.
drop policy if exists "identity_conflicts_own_read" on public.identity_conflicts;
create policy "identity_conflicts_own_read" on public.identity_conflicts
  for select to authenticated
  using (person_id = public.my_person_id());

-- No self-UPDATE policy on purpose: a person resolves through
-- resolve_identity_conflict(), which also has to write `students` and clear the
-- self_edited flag. A direct UPDATE would let them close the question without
-- either, leaving the record saying "resolved: theirs" beside a row that still
-- holds theirs. One writer.
revoke all on public.identity_conflicts from anon;

-- ------------------------------------------------------------
-- §3 — record the disagreement instead of dropping it
--
-- The keep-the-self-edit behaviour is UNCHANGED and stays exactly where 0125
-- put it: on the table, so no writer can forget it. What is added is that the
-- discarded value is written down.
--
-- The recorder is its own SECURITY DEFINER function because the trigger runs as
-- whoever is doing the import, and that caller has no business holding a direct
-- INSERT grant on identity_conflicts.
-- ------------------------------------------------------------
create or replace function public.record_identity_conflict(
  p_person uuid, p_field text, p_mine text, p_theirs text, p_batch uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_person is null then return; end if;

  -- Nothing to say when the file is simply silent about a field. An import that
  -- omits a column must not read as "the faculty says you have no surname" —
  -- that is the same "an upsert that sends every column wipes the ones the file
  -- did not have" trap, wearing a conflict row instead of a NULL.
  if p_theirs is null or btrim(p_theirs) = '' then return; end if;
  if coalesce(p_mine, '') = coalesce(p_theirs, '') then return; end if;

  insert into public.identity_conflicts (person_id, field, mine, theirs, batch_id)
  values (p_person, p_field, p_mine, p_theirs, p_batch)
  on conflict (person_id, field) where status = 'open'
  do update set mine = excluded.mine, theirs = excluded.theirs,
                batch_id = excluded.batch_id, created_at = now();
end;
$$;

revoke all on function public.record_identity_conflict(uuid, text, text, text, uuid) from public;
revoke all on function public.record_identity_conflict(uuid, text, text, text, uuid) from anon;
revoke all on function public.record_identity_conflict(uuid, text, text, text, uuid) from authenticated;

comment on function public.record_identity_conflict(uuid, text, text, text, uuid) is
  'Writes down a field where the import disagreed with a self-edit (0138). '
  'Called ONLY from students_keep_self_edits; no role holds EXECUTE, so it '
  'cannot be used to fabricate a conflict against somebody.';

-- Rebuilt from the LIVE 0125 body. The keeping logic is byte-identical; the
-- only change is the call added inside the loop.
create or replace function public.students_keep_self_edits()
returns trigger language plpgsql as $$
declare
  v_col  text;
  v_keep jsonb := '{}'::jsonb;
  v_mine text;
  v_file text;
begin
  -- Only an IMPORT is restrained. An import is the write that stamps a new
  -- batch id; admin edits and the student's own writes leave it alone.
  if new.last_import_batch is not distinct from old.last_import_batch then
    return new;
  end if;
  if old.self_edited is null or array_length(old.self_edited, 1) is null then
    return new;
  end if;

  foreach v_col in array old.self_edited loop
    -- Allow-list, not `format('new.%I := ...')`: self_edited is written by a
    -- definer RPC today, but a column name that reaches dynamic SQL is the kind
    -- of thing that becomes an injection the day someone adds a second writer.
    if v_col in ('first_name_th', 'last_name_th', 'student_id', 'major') then
      v_keep := v_keep || jsonb_build_object(v_col, to_jsonb(old) -> v_col);
      -- …and SAY SO (0138). Discarding the file's value silently is why nobody
      -- ever learns the faculty spells this person's name differently.
      v_mine := to_jsonb(old) ->> v_col;
      v_file := to_jsonb(new) ->> v_col;
      perform public.record_identity_conflict(
        old.person_id, v_col, v_mine, v_file, new.last_import_batch);
    end if;
  end loop;

  if v_keep = '{}'::jsonb then return new; end if;
  return jsonb_populate_record(new, to_jsonb(new) || v_keep);
end;
$$;

-- ------------------------------------------------------------
-- §4 — resolving one, from either end
--
-- 'mine'  — the person's value stands. The question closes and the self_edited
--           flag STAYS, so the next import will not silently re-open it.
-- 'theirs'— the file was right. The value is written AND the column is released
--           from self_edited, because the person's claim has been withdrawn and
--           a future import should own that field again. Forgetting the second
--           half is how "I fixed it, it changed back" becomes "I fixed it, it
--           never changes again".
--
-- The write goes through a normal UPDATE on `students`, not around it, so the
-- 0132/0133 mirrors carry the corrected value to the registry and to ทีม SAMO.
-- ------------------------------------------------------------
create or replace function public.resolve_identity_conflict(p_id uuid, p_use text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  c public.identity_conflicts%rowtype;
  v_uid uuid := auth.uid();
  v_is_admin boolean;
  v_is_owner boolean;
begin
  if v_uid is null then raise exception 'ต้องเข้าสู่ระบบก่อน'; end if;
  if p_use not in ('mine', 'theirs') then
    raise exception 'ต้องเลือกว่าจะใช้ข้อมูลของใคร';
  end if;

  select * into c from public.identity_conflicts where id = p_id;
  if not found then raise exception 'ไม่พบรายการนี้'; end if;
  if c.status <> 'open' then raise exception 'รายการนี้ถูกตัดสินไปแล้ว'; end if;

  v_is_admin := public.current_user_role() = any (array['vp_admin','dev'])
                or public.current_user_has_permission('house')
                or public.current_user_has_permission('team_edit');
  select exists (select 1 from public.people p
                   join public.users u on lower(btrim(u.email)) = lower(btrim(p.kkumail))
                  where p.id = c.person_id and u.id = v_uid)
    into v_is_owner;
  if not (v_is_admin or v_is_owner) then
    raise exception 'ไม่มีสิทธิ์ตัดสินรายการนี้';
  end if;

  if p_use = 'theirs' then
    -- Named branches rather than dynamic SQL. `field` is CHECK-constrained to
    -- these four, but a column name reaching `format('update ... %I')` is the
    -- shape that becomes an injection the day the constraint is relaxed.
    if c.field = 'first_name_th' then
      update public.students set first_name_th = c.theirs,
             self_edited = array_remove(self_edited, 'first_name_th')
       where person_id = c.person_id;
    elsif c.field = 'last_name_th' then
      update public.students set last_name_th = c.theirs,
             self_edited = array_remove(self_edited, 'last_name_th')
       where person_id = c.person_id;
    elsif c.field = 'student_id' then
      update public.students set student_id = c.theirs,
             self_edited = array_remove(self_edited, 'student_id')
       where person_id = c.person_id;
    elsif c.field = 'major' then
      update public.students set major = c.theirs,
             self_edited = array_remove(self_edited, 'major')
       where person_id = c.person_id;
    end if;
  end if;

  update public.identity_conflicts
     set status = 'resolved', resolution = p_use,
         resolved_at = now(), resolved_by = v_uid
   where id = p_id;

  return jsonb_build_object('id', p_id, 'resolution', p_use);
end;
$$;

revoke all on function public.resolve_identity_conflict(uuid, text) from public;
revoke all on function public.resolve_identity_conflict(uuid, text) from anon;
grant execute on function public.resolve_identity_conflict(uuid, text) to authenticated;

comment on function public.resolve_identity_conflict(uuid, text) is
  'Decide one import disagreement, as the person themselves or as an admin '
  '(0138). Choosing the file''s value ALSO releases the column from '
  'self_edited — without that, the person''s withdrawn claim would keep '
  'shadowing every future import of that field.';

-- ------------------------------------------------------------
-- §5 — "I have checked, it is right"
--
-- The other half of the reported problem, and the cheap half: one timestamp
-- separates the people who looked from the people who did not. An EDIT sets it
-- too — someone who corrects their สาขา has plainly looked, and asking them to
-- also press a button would make the count measure button-pressing.
-- ------------------------------------------------------------
create or replace function public.confirm_my_identity()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_email text; v_n int;
begin
  if v_uid is null then raise exception 'ต้องเข้าสู่ระบบก่อน'; end if;
  select email into v_email from public.users where id = v_uid;
  if v_email is null or btrim(v_email) = '' then raise exception 'บัญชีนี้ไม่มีอีเมล'; end if;

  update public.people set identity_confirmed_at = now()
   where lower(btrim(kkumail)) = lower(btrim(v_email));
  get diagnostics v_n = row_count;
  -- Zero rows is not an error: an ordinary visitor the registry has never heard
  -- of pressing a button they should not have been shown is a UI bug, not a
  -- reason to show them a Postgres message.
  return jsonb_build_object('confirmed', v_n > 0, 'at', now());
end;
$$;

revoke all on function public.confirm_my_identity() from public;
revoke all on function public.confirm_my_identity() from anon;
grant execute on function public.confirm_my_identity() to authenticated;

-- ------------------------------------------------------------
-- §6 — the person's own open questions, and their confirmation state
--
-- A dedicated read rather than letting the card select from the table: the
-- person needs the FIELD LABEL and both values, not a row shape, and this is
-- the one place that decides what a conflict looks like to a human.
-- ------------------------------------------------------------
create or replace function public.get_my_identity_status()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_email text;
  v_person uuid;
  v_at timestamptz;
begin
  if v_uid is null then return null; end if;
  select email into v_email from public.users where id = v_uid;
  if v_email is null or btrim(v_email) = '' then return null; end if;

  select id, identity_confirmed_at into v_person, v_at
    from public.people where lower(btrim(kkumail)) = lower(btrim(v_email));
  if v_person is null then return null; end if;

  return jsonb_build_object(
    'confirmed_at', v_at,
    'conflicts', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', c.id, 'field', c.field, 'mine', c.mine, 'theirs', c.theirs,
               'since', c.created_at) order by c.created_at)
        from public.identity_conflicts c
       where c.person_id = v_person and c.status = 'open'), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.get_my_identity_status() from public;
revoke all on function public.get_my_identity_status() from anon;
grant execute on function public.get_my_identity_status() to authenticated;

comment on function public.get_my_identity_status() is
  'The caller''s open import disagreements plus when they last confirmed their '
  'own record (0138). Takes NO argument — identity comes from auth.uid(), so '
  'it cannot be pointed at anyone else and cannot become a directory lookup.';

-- ------------------------------------------------------------
-- §7 — how the check is going, for whoever has to chase it
--
-- The question behind "some will check, some won't" is operational: a week
-- later, WHO has not looked? Counts only — a list of names would be a roster
-- projection, and publishing one of those by accident is its own entry
-- (0086/0103/0108). The admin pane already has per-row tools for the names.
-- ------------------------------------------------------------
create or replace function public.identity_check_summary()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.current_user_role() = any (array['vp_admin','dev'])
          or public.current_user_has_permission('house')
          or public.current_user_has_permission('team_edit')) then
    raise exception 'ไม่มีสิทธิ์ดูสรุปนี้';
  end if;
  return jsonb_build_object(
    'people',        (select count(*) from public.people),
    'confirmed',     (select count(*) from public.people where identity_confirmed_at is not null),
    -- "Edited something" is a weaker but real signal, and counting it
    -- separately is what stops someone reading 'confirmed' as 'checked'.
    'self_edited',   (select count(*) from public.students
                       where array_length(self_edited, 1) > 0),
    'open_conflicts', (select count(*) from public.identity_conflicts where status = 'open'),
    'resolved',      (select count(*) from public.identity_conflicts where status = 'resolved')
  );
end;
$$;

revoke all on function public.identity_check_summary() from public;
revoke all on function public.identity_check_summary() from anon;
grant execute on function public.identity_check_summary() to authenticated;
