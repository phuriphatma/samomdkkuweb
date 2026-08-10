-- ============================================================================
-- 0146 — photo_reference_count() can see `houses.icon_url`.
--
-- CARRIED OVER FROM 2026-08-09's handoff, where it was found and scoped but not
-- shipped. Quoting it, because the reasoning is still exactly right:
--
--   "`photo_reference_count()` cannot see `houses.icon_url`. The house-crest
--    cleanup (house/index.js → deleteTeamPhotoIfUnused(prevIcon)) therefore
--    decides on a count that always answers 0. Safe today by coincidence — the
--    row is repointed first — but two houses sharing a crest means replacing one
--    trashes the other's, and since deletes now REVOKE SHARING first the victim
--    breaks instantly rather than lingering."
--
-- THE SHAPE. `photo_reference_count` counts five tables, all of which spell the
-- column `photo_url`. A house crest is a Drive file uploaded through the same
-- uploader, retired by the same `photoToRetire` rule, and deleted by the same
-- `deleteTeamPhotoIfUnused` — it just happens to be stored in a column called
-- `icon_url`. The count did not know it existed, so for a crest it returned 0
-- every single time, and 0 is the answer that authorises an irreversible delete.
--
-- WHY IT HAS NOT BITTEN YET, AND WHY THAT IS NOT SAFETY. The one caller repoints
-- `houses.icon_url` BEFORE asking, so the count is 0 and the answer "nobody uses
-- the old file" is right by accident. It stops being right the moment two houses
-- point at one file — which is one drag-and-drop away, and 0143 made the
-- consequence immediate: deletes revoke Drive sharing first, so the other house's
-- crest 404s the same second rather than surviving in the trash.
--
-- ⚠️ AND THE TEST SAID GREEN. `src/js/photo-refcount.test.js` scans the migration
-- tree for columns literally named `photo_url`, so it never looked for this one.
-- A guard that cannot see the hazard reports the hazard as absent — mistakes
-- class 7, on the instrument this time rather than on the query. Widened in the
-- same commit; that is the actual fix, and this migration is half of it.
-- ============================================================================

create or replace function public.photo_reference_count(p_url text)
returns integer
language sql
stable security definer
set search_path to 'public'
as $$
  select case
    -- A blank URL answers ONE, never zero. Nonsense input must not read as
    -- "nothing uses this file": the caller's next move on a 0 is an
    -- irreversible delete, so the safe direction is "I could not check" (0143).
    when nullif(btrim(coalesce(p_url, '')), '') is null then 1
    else (select count(*)::int from public.team_members        where photo_url = btrim(p_url))
       + (select count(*)::int from public.team_archive_members where photo_url = btrim(p_url))
       + (select count(*)::int from public.people              where photo_url = btrim(p_url))
       + (select count(*)::int from public.students            where photo_url = btrim(p_url))
       + (select count(*)::int from public.advisors            where photo_url = btrim(p_url))
       -- The house CREST (0146). Same Drive file, same uploader, same cleanup —
       -- the only thing that made it invisible was a column named `icon_url`
       -- instead of `photo_url`. A refcount is only as true as its list of
       -- referrers, and the list was built by grepping for a column name.
       + (select count(*)::int from public.houses              where icon_url  = btrim(p_url))
  end;
$$;

comment on function public.photo_reference_count(text) is
  '0143, widened in 0146. Counts every row in every table that points at a Drive '
  'file, SERVER-SIDE — a client-side count over an RLS-gated table returns zero '
  'rows for the very caller that triggered the delete, which reads as '
  '"unreferenced" and destroys the file. `houses.icon_url` is counted even though '
  'it is not called photo_url: the column name is not the fact. A blank URL '
  'answers 1, because the caller acts irreversibly on 0.';
