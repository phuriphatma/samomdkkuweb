-- ============================================================
-- 0121 — สายรหัส is NOT a fixed range of 100. Stop pretending it is.
--
-- SYMPTOM (would have hit on the first real import): `students.sai_code`
-- references `sais(code)`, and 0116 seeded exactly 100 rows, '001'–'100', on the
-- belief that there were 100 สาย of ~18 people. The real range runs to roughly
-- 001–287 — as high as the largest year's headcount, because a สาย is the
-- running number within a cohort and the สาย links one student per year across
-- six years. Every imported student with สาย 101 or above would have failed the
-- foreign key, i.e. about two thirds of the faculty, and the import would have
-- died partway with a 23503 rather than doing anything useful.
--
-- THE DEEPER MISTAKE was hardcoding a range at all. Nobody knows the exact
-- maximum — it moves with enrolment every year — so any number written into a
-- migration is a guess that goes stale silently. The set of สาย is not
-- reference data we own; it is an OBSERVATION of what the university assigned,
-- and the only honest source for it is the import file.
--
-- FIX: `sais` becomes derived, not seeded. The importer upserts every distinct
-- สาย it sees before it upserts students, so the table always contains exactly
-- the สาย that exist and no others. This migration removes the arbitrary seed —
-- but ONLY rows nothing references, so it cannot destroy anything real.
--
-- WHAT DOES NOT CHANGE: the house rule. `house_id` is still the last digit and
-- still a GENERATED column. Checked over the plausible range: at 287 สาย the ten
-- houses get 28–29 สาย each (a spread of one, ~3.5% of the average), ≈170 people
-- per house. The rule degrades gracefully at any size — it only produces a
-- lopsided house if the maximum สาย is small, which it is not.
-- ============================================================

-- ------------------------------------------------------------
-- §1 — Drop the arbitrary seed, but only what is genuinely unused.
-- ------------------------------------------------------------
delete from public.sais s
 where not exists (select 1 from public.students st where st.sai_code = s.code)
   and not exists (select 1 from public.sai_advisors sa where sa.sai_code = s.code);

comment on table public.sais is
  'The สายรหัส that actually exist, DERIVED from the import — not a seeded range. '
  'สาย run from 001 to roughly the size of the largest year (~287 and moving), '
  'so any hardcoded maximum is a guess that goes stale. The importer upserts '
  'every distinct code it sees before writing students. house_id is GENERATED '
  'from the last digit and is the one implementation of the house rule.';

-- ------------------------------------------------------------
-- §2 — Let the import create สาย without needing a separate round trip.
--
-- SECURITY DEFINER + an explicit permission re-check: the function writes to
-- `sais`, so it must not be a way around the RLS on that table. It re-applies
-- exactly the policy predicate rather than trusting the caller.
--
-- Idempotent by construction (ON CONFLICT DO NOTHING), so the importer can call
-- it on every chunk without thinking about ordering.
-- ------------------------------------------------------------
create or replace function public.ensure_sais(p_codes text[])
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_added integer := 0;
begin
  if not (public.current_user_role() = any (array['vp_admin','dev'])
          or public.current_user_has_permission('house')) then
    raise exception 'ไม่มีสิทธิ์จัดการสายรหัส';
  end if;

  with wanted as (
    select distinct btrim(c) as code
      from unnest(coalesce(p_codes, '{}')) as c
     where btrim(c) ~ '^[0-9]{3}$'
  ), ins as (
    insert into public.sais (code)
    select code from wanted
    on conflict (code) do nothing
    returning 1
  )
  select count(*) into v_added from ins;

  return v_added;
end;
$$;

revoke all on function public.ensure_sais(text[]) from public;
revoke all on function public.ensure_sais(text[]) from anon;
grant execute on function public.ensure_sais(text[]) to authenticated;

comment on function public.ensure_sais(text[]) is
  'Create any สายรหัส in the array that does not exist yet. Called by the '
  'importer before it writes students, so a student never fails the sai_code '
  'foreign key. Re-checks the `house` permission because it is SECURITY DEFINER.';
