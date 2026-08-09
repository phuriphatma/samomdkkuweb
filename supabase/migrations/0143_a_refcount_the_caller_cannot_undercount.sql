-- ============================================================
-- 0143 — the portrait refcount has to run where it can SEE every reference
--
-- FOUND BY AN AUDIT, before it destroyed anything, but it was live.
--
-- THE ORIGINAL BUG. `deleteTeamPhotoIfUnused` (team/api.js) counted
-- `team_members` + `team_archive_members` before trashing a Drive file. That
-- list was complete until 0132: the registry now holds `people.photo_url`, and
-- its mirror copies the same URL to `students.photo_url`. Measured on a rollback
-- transaction — delete a ทีม SAMO member whose portrait had mirrored, and:
--
--   count the app checks (team_members + archive) : 0
--   people still points at the file               : 1
--   students still points at the file             : 1
--
-- …so the file was deleted and both the person's own card and ระบบบ้าน were left
-- showing a broken image, permanently, by a cleanup that believed nothing
-- referenced it.
--
-- THE SECOND BUG, which is the one worth the migration. The obvious fix — query
-- the two extra tables from the client — DOES NOT WORK, and fails in the
-- direction that destroys data:
--
--   students_admin_all  →  house / vp_admin / dev
--   advisors_admin_all  →  house / vp_admin / dev
--   people_read         →  team / team_edit / house / vp_admin / dev
--
-- The admin who deletes ทีม SAMO members holds `team_edit`, NOT `house`. RLS
-- does not raise; it returns ZERO ROWS. So for exactly the caller who triggers
-- this cleanup, the extra queries answer "no references" — indistinguishable
-- from the truth, and the file is deleted anyway.
--
-- This is the RLS half of the entry already in docs/mistakes/tooling-proofs.md
-- ("RLS does not RAISE — a proof that asks 'did it throw?' scores a fully
-- blocked write as permitted"), met on a READ: a fully blocked read scores as
-- "nothing is using it".
--
-- THE FIX IS TO MOVE THE COUNT, not to widen anybody's grants. A SECURITY
-- DEFINER function counts all five tables with the owner's rights and returns
-- an INTEGER. That leaks nothing: the caller already holds the URL — they are
-- asking "may I delete this file", and the answer is a number.
-- ============================================================

create or replace function public.photo_reference_count(p_url text)
returns int language sql stable security definer set search_path = public as $$
  select case
    when nullif(btrim(coalesce(p_url, '')), '') is null then 1   -- see below
    else (select count(*)::int from public.team_members       where photo_url = btrim(p_url))
       + (select count(*)::int from public.team_archive_members where photo_url = btrim(p_url))
       + (select count(*)::int from public.people             where photo_url = btrim(p_url))
       + (select count(*)::int from public.students           where photo_url = btrim(p_url))
       + (select count(*)::int from public.advisors           where photo_url = btrim(p_url))
  end;
$$;

-- A BLANK URL RETURNS 1, NOT 0. It is nonsense input, and the one thing this
-- function must never do is answer "nothing references this" for a question it
-- did not understand — the caller's next move on a 0 is an irreversible delete.
-- Every failure mode here is pinned to the direction that keeps the file.

revoke all on function public.photo_reference_count(text) from public;
revoke all on function public.photo_reference_count(text) from anon;
grant execute on function public.photo_reference_count(text) to authenticated;

comment on function public.photo_reference_count(text) is
  'How many rows still reference this portrait, across ALL FIVE tables that '
  'hold a photo_url (0143). SECURITY DEFINER because the caller who deletes a '
  'ทีม SAMO member holds `team_edit` and cannot read `students` or `advisors` — '
  'and RLS answers that with zero rows rather than an error, so a client-side '
  'count reports "unreferenced" and the cleanup destroys a file that is in use. '
  'Returns 1 for a blank URL: every ambiguous case keeps the file.';
