-- ============================================================
-- 0178 — photo_reference_count must count a ฝ่าย page's cover and video.
--
-- 0177 gave `dept_content` a `cover_url` and a `video_url`, and
-- `photo-refcount.test.js` failed the build on the same commit. That is the
-- guard doing exactly what it was written for: it does not ask whether the new
-- column is a portrait, it FORCES A DECISION about every `*_url` in the schema,
-- because the hole it was written for (0132's mirror, then 0146's `icon_url`)
-- was invisible precisely to people who had decided it did not apply.
--
-- THE DECISION, and why it is to COUNT rather than to exempt:
--
--   A 0 from this function authorises an irreversible delete. Counting a table
--   can only ever make a delete LESS likely, never more — the failure it can
--   cause is a leaked Drive file, and the failure it prevents is a destroyed
--   one. Where those two are the options, the answer is not close.
--
--   And the case is real, not theoretical: covers are chosen by people, and
--   nothing stops someone pasting the URL of a photo that is ALSO a portrait.
--   Uncounted, deleting that person from ทีม SAMO would silently break a ฝ่าย
--   page nobody was looking at.
--
-- ⚠️ WHAT THIS DOES NOT FIX, recorded rather than implied: there is still no
-- cleanup for a ฝ่าย cover that is REPLACED. The old file leaks in Drive. That
-- is a known, bounded cost (2 TB quota, `docs/EMAIL.md`), and it is the safe
-- side of the trade above. It is not a reason to delay counting.
-- ============================================================
create or replace function public.photo_reference_count(p_url text)
returns integer language sql stable security definer set search_path = public as $$
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
       -- A ฝ่าย page's own card media (0177/0178). Two columns, because a card
       -- carries either a still or a looping video and both are files a person
       -- uploaded.
       + (select count(*)::int from public.dept_content        where cover_url = btrim(p_url))
       + (select count(*)::int from public.dept_content        where video_url = btrim(p_url))
  end;
$$;
