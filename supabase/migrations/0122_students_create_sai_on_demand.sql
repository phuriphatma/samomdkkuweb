-- ============================================================
-- 0122 — create the สายรหัส on demand, for EVERY writer, not just the importer.
--
-- SYMPTOM (reported): setting a student's สาย to 200 in the admin form fails with
--   23503 insert or update on table "students" violates foreign key constraint
--   "students_sai_code_fkey" — Key is not present in table "sais"
--
-- CAUSE. 0121 correctly made `sais` a DERIVED set — สาย are created from what the
-- data contains rather than seeded from a guessed range — and its own write-up
-- ended with the rule: "a foreign key onto a seeded observation converts every
-- unforeseen real value into a hard failure — prefer creating the parent on
-- demand."
--
-- That rule was then applied in exactly ONE place: the CSV importer, which calls
-- ensure_sais() before it writes students. THREE other paths write
-- students.sai_code and none of them did:
--   • the admin สมาชิก form (createStudent / updateStudent)   ← what was reported
--   • approving a สายรหัส change request
--   • any future writer, including a hand-written SQL fix
--
-- This is the repo's most repeated shape, logged as class 4 ("authorization is
-- per-PATH, not per-table") and class 5 ("a new channel must be threaded through
-- EVERY gate"). Here it is not authorization but the same geometry: a rule
-- enforced at one call site instead of at the thing all call sites share.
--
-- FIX. Put it where every writer must pass: a BEFORE trigger on `students`. The
-- foreign key stays — referential integrity is still enforced — but the parent
-- row is materialised the moment a student needs it. There is now no way to
-- write a valid สาย and have it fail, and no way for a future path to forget.
--
-- WHAT THIS DOES NOT DO. It does not let a STUDENT invent a สาย.
-- update_my_student_record() keeps its explicit "ไม่พบสายรหัส … ในระบบ" check,
-- which runs before the UPDATE and therefore before this trigger. That check is
-- worth keeping precisely because it is the one path where the writer is
-- guessing: by the time students self-edit, the import has created every real
-- สาย, so a code that does not exist is a typo, and silently creating a house
-- placement from a typo is worse than refusing it.
--
-- The importer's ensure_sais() call is kept as an OPTIMISATION, not as the
-- mechanism: one statement for ~300 distinct codes beats ~1,800 trigger firings.
-- Correctness no longer depends on it.
-- ============================================================

create or replace function public.students_ensure_sai()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.sai_code is not null then
    -- Normalise defensively. Every JS writer already goes through
    -- normalizeSai(), but this trigger is the last line before the FK and must
    -- not depend on a caller having done it.
    new.sai_code := btrim(new.sai_code);
    if new.sai_code !~ '^[0-9]{3}$' then
      raise exception 'สายรหัส "%" ไม่ถูกต้อง — ต้องเป็นตัวเลข 3 หลัก (001–999)', new.sai_code;
    end if;
    insert into public.sais (code) values (new.sai_code)
      on conflict (code) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists students_ensure_sai on public.students;
-- BEFORE, and before the cohort trigger has any bearing — they touch different
-- columns, so order between them does not matter.
create trigger students_ensure_sai
  before insert or update of sai_code on public.students
  for each row execute function public.students_ensure_sai();

comment on function public.students_ensure_sai() is
  'Creates the สายรหัส row a student is being assigned to, if it does not exist '
  'yet. sais is a DERIVED set (0121), so the FK must never be the thing that '
  'rejects a real สาย. Lives on the table rather than in the importer because '
  'four separate paths write students.sai_code and one of them was missed (0122).';

-- Backfill: any สาย already referenced by a student but somehow absent. Should
-- be empty — the FK would have blocked it — but this makes the invariant true by
-- construction rather than by assumption.
insert into public.sais (code)
select distinct st.sai_code
  from public.students st
 where st.sai_code is not null
   and not exists (select 1 from public.sais s where s.code = st.sai_code)
on conflict (code) do nothing;
