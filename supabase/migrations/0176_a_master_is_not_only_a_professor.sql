-- ============================================================
-- 0176 — a master holder is a professor AND a sender; the prof column
--        guard treated them as ONLY a professor
--
-- REPORTED: "my friend has permission master with ผู้ส่งคณะ but can't
-- ซ่อนจากเว็บ on each หนังสือ of หนังสือโครงการ", and the error text:
--   {"code":"P0001", … "message":"project_documents_prof_guard: professor
--    may only add comments"}
--
-- CAUSE. 0111 §2 folds `master` into current_user_project_seats() as
-- array['vpa','staff','prof'] — deliberately, so a master can work at any of
-- the three desks. current_user_is_prof() therefore answers TRUE for all 41
-- master holders. Every OTHER caller of that helper is a GRANT (an OR branch
-- in a read/update/insert policy), where an extra `true` only widens. These
-- two BEFORE UPDATE triggers are the exceptions: they are RESTRICTIONS, and a
-- restriction keyed on "is a prof" reads a master's extra desk as a
-- disqualification.
--
-- 0051 wrote the doc guard because it had just WIDENED
-- project_documents_update to admit the professor, and a row-level UPDATE
-- policy grants every column in the row (class 1). The guard's subject was
-- always meant to be "someone who is here ONLY because of the prof branch" —
-- it just spelled that "is a prof", which was the same set until 0111.
--
-- MEASURED ON PROD BEFORE THE FIX (rolled-back transaction, tools/db-query):
--   master     seats={vpa,staff,prof} actor=t prof=t publish=t
--              status ✗  title ✗  note ✗  is_public ✗  timeline ✓
--   vpa-only   seats={vpa}            actor=t prof=f publish=t   all ✓
--   staff-only seats={staff}          actor=t prof=f publish=f
--              is_public correctly refused by project_public_flag_guard
--   prof-only  seats={prof}           actor=f prof=t publish=f   correctly denied
-- So the reporter's plain-seat colleagues were never affected — only master.
-- `projects` has no prof guard, which is exactly why the โครงการ-level
-- ซ่อนจากเว็บ worked and the per-หนังสือ one did not.
--
-- BLAST RADIUS: a master could change NOTHING on a หนังสือ except comments —
-- not ซ่อนจากเว็บ, not รับเรื่อง/กำลังดำเนินการ/เสร็จสิ้น/ส่งกลับให้แก้/ย้อนสถานะ,
-- not แก้ไขชื่อ/โน้ต, not drive_folder. §3 repairs the one silent casualty.
--
-- WHY NOT FIX current_user_project_seats() INSTEAD: master must keep the prof
-- seat — it is what lets a master read project_settings, sign, and be listed
-- as a signer. Narrowing the helper would break every GRANT to fix two
-- RESTRICTIONS. The bug is at the two restriction sites, so that is where it
-- is fixed.
--
-- THE SHAPE OF THE FIX: exempt anyone the policy would have admitted WITHOUT
-- the prof branch. The doc policy is
--   `actor OR (prof AND prof_can_see_document(id))`
-- so `prof AND NOT actor` is precisely "here only as a professor". The guard
-- and the policy it backstops now name the same predicate instead of two
-- spellings of one rule (class 6).
--
-- Function bodies only — no DDL, no column, nothing the frontend reads. Safe
-- to apply before the deploy. Live bodies read with pg_get_functiondef and
-- confirmed identical to 0114 / 0050 before this republish.
--
-- Apply AFTER 0175. Re-runnable.
-- ============================================================

-- ------------------------------------------------------------
-- 1. project_documents — the reported failure
--    Column list is 0114's, unchanged and re-verified against the live
--    body. Only the outer `if` moves.
-- ------------------------------------------------------------
create or replace function public.project_documents_prof_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- ONLY a professor. An actor (vp_admin / uni_staff / dev, or a vpa/staff
  -- seat — which `master` carries) reaches this row through
  -- project_documents_update's own actor branch, and that branch has never
  -- restricted a column. 0111 gave master all three seats, so a guard keyed
  -- on `is_prof` alone locked 41 accounts out of their own desk.
  if public.current_user_is_prof() and not public.current_user_is_project_actor() then
    if new.id            is distinct from old.id
       or new.project_id    is distinct from old.project_id
       or new.type_id       is distinct from old.type_id
       or new.title         is distinct from old.title
       or new.note          is distinct from old.note
       or new.sequence_no   is distinct from old.sequence_no
       or new.status        is distinct from old.status
       or new.return_reason is distinct from old.return_reason
       or new.sent_at       is distinct from old.sent_at
       or new.received_at   is distinct from old.received_at
       or new.completed_at  is distinct from old.completed_at
       or new.drive_folder  is distinct from old.drive_folder
       or new.is_public     is distinct from old.is_public
       or new.created_by    is distinct from old.created_by
       or new.created_at    is distinct from old.created_at then
      raise exception 'project_documents_prof_guard: professor may only add comments';
    end if;
  end if;
  return new;
end;
$$;

comment on function public.project_documents_prof_guard() is
  'Column guard for the prof branch of project_documents_update: someone who '
  'is a professor AND NOT a project actor may change only `timeline` (0051, '
  'is_public added 0114, actor exemption 0176). The actor test is what keeps '
  'a `master` — who holds all three seats since 0111 — out of it.';

-- ------------------------------------------------------------
-- 2. project_sign_requests — the same guard, the same defect
--
--    Not currently reachable from the app (the UI only ever patches
--    status / reject_reason / decided_at / timeline, none of which this
--    lists), so this half is LATENT, not a live break. Fixed in the same
--    commit because "check the SECOND twin" is the lesson 0149 paid for:
--    the first fix landing alone is how these two drift apart.
-- ------------------------------------------------------------
create or replace function public.sign_requests_prof_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.current_user_is_prof() and not public.current_user_is_project_actor() then
    if new.document_id  is distinct from old.document_id
       or new.prof_id   is distinct from old.prof_id
       or new.file_ids  is distinct from old.file_ids
       or new.note      is distinct from old.note
       or new.requested_by is distinct from old.requested_by then
      raise exception 'sign_requests_prof_guard: professor may only set the decision';
    end if;
  end if;
  return new;
end;
$$;

comment on function public.sign_requests_prof_guard() is
  'Column guard for the prof branch of project_sign_requests_update: a '
  'professor who is NOT a project actor may set only the decision columns '
  '(0050, actor exemption 0176 — see project_documents_prof_guard).';

-- ------------------------------------------------------------
-- 3. Repair the silent casualty: three หนังสือ whose Drive path lost its id
--
-- send.js creates the row, THEN patches drive_folder with the real doc id
-- (the folder segment is built before the id exists) — inside `catch {}`.
-- For a master that PATCH has been raising since 0111, silently, so the row
-- kept the placeholder `…/<slug>_` while the files were uploaded to the
-- correct `…/<slug>_DOC-XXXXX`. Found by asking which rows do NOT end in
-- their own id: exactly 3, all master-created, all 2026-08-24, 1 file each.
--
-- The repair is EXACT, not a guess: the stored value is the same string with
-- an empty id appended, so appending the id reproduces byte-for-byte what
-- send.js would have written. Both conditions are required — a row must end
-- in `_` (so the concatenation is exact) AND not already carry its id.
-- ------------------------------------------------------------
update public.project_documents
   set drive_folder = drive_folder || id
 where drive_folder is not null
   and right(drive_folder, 1) = '_'
   and drive_folder !~ ('_' || id || '$');
