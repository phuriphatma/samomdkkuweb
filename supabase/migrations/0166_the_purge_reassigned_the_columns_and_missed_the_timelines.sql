-- ============================================================
-- 0166 — the shared-account purge reassigned every uid COLUMN and left every
-- uid inside the JSONB timelines alone. That was DELIBERATE — and the owner
-- reversed it on 2026-08-18 once the cost was counted.
--
-- THE DECISION IT REVERSES. `tools/purge-shared-project-accounts.mjs` says in
-- its own header that rewriting history to say someone did something they did
-- not do is worse than "the two people no longer being able to edit an old
-- shared-account comment". Sound reasoning, unmeasured cost: it was not two
-- people, it was 42 of the 43 comments in the system, uneditable by every
-- account. Shown the number, the owner chose the remap.
--
-- WHAT WAS LEFT. When `samomdkkuvpa` / `sastaff` / `saprof` were deleted
-- (2026-08-17/18) their work was reassigned to the named people who now hold
-- the seats. That pass covered the columns — `projects.created_by`,
-- `project_documents.created_by`, `project_files.uploaded_by`,
-- `project_sign_requests.requested_by` / `.prof_id` — and every one of them
-- resolves today (proj0165 §D4/§D5 assert exactly that, which is why the gap
-- survived: the proof's subject was the columns).
--
-- `project_documents.timeline` and `project_sign_requests.timeline` are JSONB
-- arrays whose entries carry their own `by` uid, and nothing rewrote them.
-- Measured before this migration:
--
--     old uid        role        events   was
--     2f84f268-…     uni_staff     175    sastaff
--     6cf1cc03-…     vp_admin       63    samomdkkuvpa
--     92d9f725-…     sa_prof        60    saprof
--
-- WHAT IT COSTS THE USER. `isMineComment` in `src/js/projects/inbox.js` is
-- `c.by === myId`, and it is the only thing that renders the แก้ไข / ลบ
-- buttons on a comment. 42 of the 43 comments in the system were written
-- through a shared account, so no live account could edit or delete any of
-- them — the buttons simply were not there. The same comparison in the
-- signing section (`e.by !== myId`) counted a person's own past actions as
-- someone else's, so the section could flag "new" activity that was theirs.
--
-- Roles were NOT affected: every timeline entry still carries a valid
-- `role` ('vp_admin' | 'uni_staff' | 'sa_prof'), and every highlight that
-- keys off the role — the blue "อัปเดต" badge, the "ใหม่"/"ตีกลับ" status
-- badges, comment unread, the ของฉัน / รอลงนาม buckets — kept working
-- throughout. Only the per-PERSON comparisons broke.
--
-- THE MAPPING is not invented here: it is the one the column pass already
-- chose, read back out of the columns.
--
--     6cf1cc03-f45d-43f8-9e8b-07c97315e712  →  jinjutha.t@kkumail.com   (vpa)
--     2f84f268-c5f8-425b-b492-b5a7cf4299aa  →  woratho@kku.ac.th        (staff)
--     92d9f725-9de9-48b5-94c3-3ef17c8e936b  →  prakasa@kku.ac.th        (prof)
--
-- A shared desk was several humans, so attributing its whole history to one
-- person is a simplification — but it is the SAME simplification the columns
-- already assert, and leaving the two disagreeing is what produced the bug.
--
-- REVERSIBLE. Both timelines are copied to `public._timeline_backup_0166`
-- first, and the rollback is at the bottom of this file. The table is left in
-- place deliberately; drop it once the behaviour has been confirmed in prod.
-- ============================================================

-- ── the snapshot, before anything is touched ────────────────────────────────
create table if not exists public._timeline_backup_0166 (
  src         text not null,
  row_id      text not null,   -- project_documents.id / project_sign_requests.id are TEXT (PRJ-…/DOC-… ids), not uuid
  timeline    jsonb,
  taken_at    timestamptz not null default now(),
  primary key (src, row_id)
);
revoke all on public._timeline_backup_0166 from public, anon, authenticated;

insert into public._timeline_backup_0166 (src, row_id, timeline)
select 'project_documents', id, timeline from public.project_documents
on conflict (src, row_id) do nothing;

insert into public._timeline_backup_0166 (src, row_id, timeline)
select 'project_sign_requests', id, timeline from public.project_sign_requests
on conflict (src, row_id) do nothing;

-- ── the remap ───────────────────────────────────────────────────────────────
-- Rewrites ONLY the `by` key, and only when it equals one of the three retired
-- uids. Every other key of every entry is carried through untouched, and the
-- array ORDER is preserved (`with ordinality` + `order by`) — a timeline that
-- re-sorted itself would change what "the last action" is.
create or replace function pg_temp.remap_timeline(tl jsonb) returns jsonb
language sql immutable as $$
  select coalesce(
    (select jsonb_agg(
              case
                when e->>'by' = '6cf1cc03-f45d-43f8-9e8b-07c97315e712'
                  then jsonb_set(e, '{by}', to_jsonb('7c47a597-06ef-45c5-84a6-20623a700848'::text))
                when e->>'by' = '2f84f268-c5f8-425b-b492-b5a7cf4299aa'
                  then jsonb_set(e, '{by}', to_jsonb('c4bc587a-bc5f-475f-9357-aa3b6a460d40'::text))
                when e->>'by' = '92d9f725-9de9-48b5-94c3-3ef17c8e936b'
                  then jsonb_set(e, '{by}', to_jsonb((select id::text from public.users where email = 'prakasa@kku.ac.th')))
                else e
              end
              order by ord)
     from jsonb_array_elements(tl) with ordinality t(e, ord)),
    tl);
$$;

update public.project_documents
   set timeline = pg_temp.remap_timeline(timeline)
 where timeline @> '[{"by":"6cf1cc03-f45d-43f8-9e8b-07c97315e712"}]'
    or timeline @> '[{"by":"2f84f268-c5f8-425b-b492-b5a7cf4299aa"}]'
    or timeline @> '[{"by":"92d9f725-9de9-48b5-94c3-3ef17c8e936b"}]';

update public.project_sign_requests
   set timeline = pg_temp.remap_timeline(timeline)
 where timeline @> '[{"by":"6cf1cc03-f45d-43f8-9e8b-07c97315e712"}]'
    or timeline @> '[{"by":"2f84f268-c5f8-425b-b492-b5a7cf4299aa"}]'
    or timeline @> '[{"by":"92d9f725-9de9-48b5-94c3-3ef17c8e936b"}]';

-- ── assert, in the same transaction ─────────────────────────────────────────
-- BOTH directions: nothing unresolvable is left, AND the events are still
-- there (a remap that emptied every timeline would satisfy the first half).
do $$
declare orphans bigint; events bigint; entries_lost bigint;
begin
  select count(*) into orphans from (
    select e->>'by' by from public.project_documents d,
           jsonb_array_elements(coalesce(d.timeline,'[]'::jsonb)) e
    union all
    select e->>'by' from public.project_sign_requests r,
           jsonb_array_elements(coalesce(r.timeline,'[]'::jsonb)) e
  ) t where by ~ '^[0-9a-f-]{36}$'
      and not exists (select 1 from public.users u where u.id = by::uuid);

  select count(*) into events from (
    select 1 from public.project_documents d,
           jsonb_array_elements(coalesce(d.timeline,'[]'::jsonb)) e
    union all
    select 1 from public.project_sign_requests r,
           jsonb_array_elements(coalesce(r.timeline,'[]'::jsonb)) e
  ) t;

  select coalesce(sum(before_n) - sum(after_n), 0) into entries_lost from (
    select jsonb_array_length(coalesce(b.timeline,'[]'::jsonb)) before_n,
           jsonb_array_length(coalesce(d.timeline,'[]'::jsonb)) after_n
      from public._timeline_backup_0166 b
      join public.project_documents d on d.id = b.row_id and b.src = 'project_documents'
    union all
    select jsonb_array_length(coalesce(b.timeline,'[]'::jsonb)),
           jsonb_array_length(coalesce(r.timeline,'[]'::jsonb))
      from public._timeline_backup_0166 b
      join public.project_sign_requests r on r.id = b.row_id and b.src = 'project_sign_requests'
  ) x;

  if orphans > 0 then
    raise exception '0166: % timeline uid(s) still resolve to nobody', orphans;
  end if;
  if events < 300 then
    raise exception '0166: only % timeline events left — the remap ate entries', events;
  end if;
  if entries_lost <> 0 then
    raise exception '0166: % timeline entries lost against the snapshot', entries_lost;
  end if;
end $$;

-- ── rollback, if it is ever needed ──────────────────────────────────────────
-- update public.project_documents d
--    set timeline = b.timeline
--   from public._timeline_backup_0166 b
--  where b.src = 'project_documents' and b.row_id = d.id;
-- update public.project_sign_requests r
--    set timeline = b.timeline
--   from public._timeline_backup_0166 b
--  where b.src = 'project_sign_requests' and b.row_id = r.id;
