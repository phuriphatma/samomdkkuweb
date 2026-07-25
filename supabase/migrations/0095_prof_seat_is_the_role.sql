-- ============================================================
-- 0095 — The อาจารย์ SEAT grants the อาจารย์ ROLE, not a separate professor.
--
-- Reported: "on saprof there are 11 shown in ทั้งหมด, but on my kkumail
-- (granted อาจารย์ in ทีม SAMO) it shows 0."
--
-- Both accounts resolve to sa_prof; the difference was that every prof gate keys
-- on `sign_requests.prof_id = auth.uid()`, and all 11 requests name saprof's uid.
-- So the seat produced a BRAND-NEW professor with an empty inbox rather than
-- access to the professor's desk.
--
-- That is inconsistent with the other two seats and with how this org works:
--   · the `staff` seat sees exactly what sastaff sees (uni_staff is not
--     per-person filtered)
--   · the `vpa`   seat sees exactly what samomdkkuvpa sees
--   · SAMO runs SHARED accounts — one per department, no individual rosters, and
--     the repo's standing rule is not to build per-person assignee features.
-- อาจารย์ is one institutional role that several people may hold, exactly like
-- เจ้าหน้าที่คณะ. A seat holder must therefore see the professor's desk, not a
-- private one.
--
-- WHAT CHANGES: the three prof_can_see_* helpers and the two sign-request
-- policies stop asking "is this request addressed to ME?" and ask "am I an
-- อาจารย์, and was this sent for signature at all?".
--
-- WHAT DOES NOT CHANGE — this is still much narrower than being a project actor:
-- a professor sees ONLY documents/files/projects that have a signature request.
-- The 15 หนังสือ never sent to อาจารย์ stay invisible (26 total, 11 with
-- requests), and the private drafts inside a requested หนังสือ stay filtered to
-- the requested + signed files. Making prof an actor would expose all 26; that
-- was rejected in 0086 and is still rejected.
--
-- THE TRADEOFF, STATED: every อาจารย์ now sees every signature request, so two
-- professors could see each other's. That is correct for one shared role and
-- WRONG the day SAMO wants per-professor privacy. If that day comes, the fix is
-- to reintroduce the uid check here plus a "which professor am I" dimension —
-- do not simply revert, or seat holders lose the desk again.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Visibility helpers: "am I อาจารย์, and was this sent for signature?"
--    current_user_is_prof() must stay INSIDE each helper — the policies OR
--    these in, so a helper that ignored the caller would hand every document
--    with a signature request to any authenticated user.
-- ------------------------------------------------------------
create or replace function public.prof_can_see_document(p_doc_id text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.current_user_is_prof()
     and exists (
       select 1 from public.project_sign_requests r
        where r.document_id = p_doc_id
     )
$$;

create or replace function public.prof_can_see_project(p_project_id text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.current_user_is_prof()
     and exists (
       select 1
         from public.project_sign_requests r
         join public.project_documents d on d.id = r.document_id
        where d.project_id = p_project_id
     )
$$;

create or replace function public.prof_can_see_file(p_file_id bigint)
returns boolean language sql stable security definer set search_path = public as $$
  select public.current_user_is_prof()
     and (
       exists (
         select 1 from public.project_sign_requests r
          where p_file_id = any (r.file_ids)
       )
       or exists (
         select 1
           from public.project_files f
           join public.project_sign_requests r on r.id = f.sign_request_id
          where f.id = p_file_id
       )
     )
$$;

-- ------------------------------------------------------------
-- 2. The sign-request rows themselves.
--    READ  — a professor sees the whole signature queue (this is what makes the
--            seat's inbox non-empty; the frontend filters off the same rows).
--    UPDATE — and can act on any of them (accept / reject). Previously only the
--            named prof could, so a seat holder could see a request after (1)
--            and still not sign it.
-- ------------------------------------------------------------
drop policy if exists "project_sign_requests_read" on public.project_sign_requests;
create policy "project_sign_requests_read" on public.project_sign_requests
  for select
  using (public.current_user_is_project_actor()
      or public.current_user_is_prof()
      or prof_id = auth.uid());

drop policy if exists "project_sign_requests_update" on public.project_sign_requests;
create policy "project_sign_requests_update" on public.project_sign_requests
  for update
  using (public.current_user_is_prof()
      or prof_id = auth.uid()
      or public.current_user_is_project_uni_staff());

-- project_files_delete keeps `uploaded_by = auth.uid()`: a professor may remove
-- a signed file THEY uploaded. Sharing the role does not mean deleting a
-- colleague's upload, and nothing in the workflow needs it.
