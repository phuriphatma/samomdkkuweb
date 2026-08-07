-- ============================================================
-- 0118 — cohort_from_student_id() must actually fail closed.
--
-- SYMPTOM (caught by the verification probe, not by a user): a รหัสนักศึกษา
-- beginning '99' returned ปีที่เข้า 2599 rather than null. 0117 claimed the
-- function "fails CLOSED to null rather than guessing", and its window
-- (2540..2599) let every two-digit prefix through — 2500 + 99 = 2599 is inside
-- it, so the guard excluded nothing at the top end. The visible effect is a
-- confidently wrong card: student_year() computes 2569 - 2599 + 1 = -29, and
-- greatest(1, …) turns that into a cheerful "ปี 1".
--
-- This is the "an unresolvable reference fails OPEN" class (mistakes.md #2) in
-- miniature: a bound that admits everything is not a bound, and the failure is
-- silent because the downstream clamp makes the nonsense look plausible.
--
-- FIX: bound the window to years that can actually be enrolled. 2540 is well
-- before any living student, 2580 is eleven years past the current academic
-- year — generous enough never to reject a real รหัส, tight enough that '99'
-- and other malformed prefixes land on null and simply show no ชั้นปี.
--
-- Deliberately still IMMUTABLE and still not reading house_settings: a function
-- that reads a settings row cannot be immutable, and the alternative (recompute
-- the window from academic_year on every call) buys nothing for a bound that
-- only has to reject impossible input.
-- ============================================================

create or replace function public.cohort_from_student_id(p_sid text)
returns smallint language sql immutable as $$
  select case
    when p_sid is null then null
    when substring(regexp_replace(p_sid, '\D', '', 'g') from 1 for 2) ~ '^\d{2}$'
     and (2500 + substring(regexp_replace(p_sid, '\D', '', 'g') from 1 for 2)::int)
         between 2540 and 2580
    then (2500 + substring(regexp_replace(p_sid, '\D', '', 'g') from 1 for 2)::int)::smallint
  end;
$$;

comment on function public.cohort_from_student_id(text) is
  'ปีการศึกษาที่เข้า (พ.ศ.) from the first two digits of รหัสนักศึกษา. The ONE '
  'implementation — never recompute this in JS. Returns null for a malformed id '
  'or a year outside 2540–2580, so a bad รหัส shows NO ชั้นปี rather than a '
  'plausible-looking wrong one (0118).';

-- Anything already stored from the too-wide window goes back to null.
update public.students
   set cohort_year = null
 where cohort_year is not null and cohort_year not between 2540 and 2580;
