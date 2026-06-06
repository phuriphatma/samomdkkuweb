-- 0049_team_year_normalize.sql
-- ชั้นปี was seeded inconsistently ("ปี 5" vs "5"). Normalize every
-- team_members.year to a bare number (strip all non-digits); rows that end up
-- empty become NULL. Idempotent — rows already numeric are untouched.

update public.team_members
   set year = nullif(regexp_replace(year, '\D', '', 'g'), '')
 where year is not null
   and year <> nullif(regexp_replace(year, '\D', '', 'g'), '');
