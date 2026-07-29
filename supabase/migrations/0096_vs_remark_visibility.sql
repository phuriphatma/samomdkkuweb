-- ============================================================
-- 0096 — VS บันทึกข้อความ: an explicit VISIBILITY LADDER, + the column guard
--        that makes it enforceable.
--
-- WHAT THE USER ASKED FOR
--   A staff note on a stacked (duplicate) ticket should be able to say who it
--   reaches: only staff, only this ticket's submitter, everyone in the
--   duplicate group, or the public board. And public-visible progress notes
--   should render on the board SEPARATELY from the discussion comments.
--
-- THE LADDER — one ordered `vis` field on each remark entry. Each level
-- includes the audience of the level above it:
--
--   'staff'   เฉพาะเจ้าหน้าที่        staff only (what `internal: true` meant)
--   'ticket'  ผู้แจ้งเรื่องนี้         + this ticket's submitter      ← the default
--   'thread'  ทุกคนในกลุ่มเรื่องซ้ำ    + every submitter in the duplicate group
--   'public'  สาธารณะ                + the public board (anyone)
--
-- Back-compat: an entry with no `vis` reads as 'ticket' (today's plain remark);
-- an entry with `internal: true` reads as 'staff'. No data migration needed —
-- vs_remark_vis() normalizes both shapes on read.
--
-- ============================================================
-- WHY A COLUMN GUARD SHIPS IN THE SAME FILE (do not split them)
--
-- `vs_tickets_update_owner` (0009) is `using/with check (submitter_id =
-- auth.uid())`. PostgreSQL RLS is ROW-level only — once the row check passes,
-- PostgREST writes ANY column in the body. There is no column guard on
-- vs_tickets (the one on public.users is 0028/0041). Proven live against the
-- production DB in a rolled-back transaction, as a real submitter's uid:
--
--   update vs_tickets set is_public = true,
--          public_title = 'SELF-PUBLISHED — NOT SE-CURATED',
--          public_note  = 'arbitrary text from a student',
--          category     = 'facilities'
--    where id = <their own ticket>;                        → UPDATE ACCEPTED
--   select … from get_public_vs_board(null,'new',200)      → 1 row
--   get_public_vs_problem(id)  → 'SELF-PUBLISHED — NOT SE-CURATED'
--
-- i.e. ANY signed-in student can publish arbitrary text to the student-facing
-- กระดานปัญหา, and self-close/reroute/retag their ticket. That defeats 0072's
-- invariant #2 ("SE writes public_title; a student's raw report is NEVER
-- published verbatim") — which was only ever enforced inside vs_set_public(),
-- a function the owner UPDATE policy routes straight around.
--
-- Without this guard the ladder above would be worse than useless: a submitter
-- could append `{"vis":"public","by":"เจ้าหน้าที่","text":…}` to their own
-- remarks and have it rendered on the board as a staff progress update. The
-- ladder is only meaningful if the write path is constrained, so both land
-- together.
--
-- The guard follows the 0028 pattern (BEFORE UPDATE, raise on a disallowed
-- change) with the 0041 lesson applied: it fires ONLY on the owner
-- self-update path (`auth.uid() = old.submitter_id`), never for a server
-- context. A superuser / service_role / Management-API caller has a null
-- auth.uid() and is left alone, so migrations, the definer RPCs (merge,
-- cascade, soft-delete) and tools/vs00*.mjs are unaffected.
--
-- Idempotent (create-or-replace, drop-trigger-before-create).
-- ============================================================


-- ============================================================
-- 1) VOCABULARY — normalize an entry's visibility, filter, and merge.
-- ============================================================

-- Normalize any remark entry (legacy or new) to one ladder level.
-- Deliberately NO ::boolean cast on `internal`: the remarks array is written
-- by clients, so a forged {"internal":"yes"} would raise 22P02 inside every
-- read path and take the whole tracking page down. Compare as text instead.
create or replace function public.vs_remark_vis(e jsonb)
returns text
language sql
immutable
as $$
  select case
    when e ->> 'vis' in ('staff', 'ticket', 'thread', 'public') then e ->> 'vis'
    when lower(coalesce(e ->> 'internal', '')) in ('true', 't', '1') then 'staff'
    else 'ticket'
  end
$$;

comment on function public.vs_remark_vis(jsonb) is
  '0096 — remark visibility ladder: staff < ticket < thread < public. Legacy internal:true => staff; missing vis => ticket.';

-- Keep only the entries an audience at `p_level` may see.
--   'staff'  → everything            (the staff dashboard reads the raw column)
--   'ticket' → this ticket''s submitter: everything except staff-only
--   'thread' → a SIBLING ticket''s submitter: only thread/public entries
--   'public' → the board: only public entries
create or replace function public.vs_visible_remarks(p_remarks jsonb, p_level text)
returns jsonb
language sql
immutable
as $$
  select coalesce(jsonb_agg(z.e order by z.ord), '[]'::jsonb)
    from jsonb_array_elements(coalesce(p_remarks, '[]'::jsonb)) with ordinality as z(e, ord)
   where case p_level
           when 'staff'  then true
           when 'ticket' then public.vs_remark_vis(z.e) <> 'staff'
           when 'thread' then public.vs_remark_vis(z.e) in ('thread', 'public')
           when 'public' then public.vs_remark_vis(z.e) = 'public'
           else false                              -- unknown level → fail CLOSED
         end
$$;

-- Merge two remark lists into one chronological timeline.
-- Sort key is the ISO `at` stamp written by every 0096-era writer. Legacy
-- entries have no `at` (their `time` is a display string like '24/07, 18:58'
-- — no year, not sortable), so they sort FIRST, which is chronologically
-- right: everything without `at` predates this migration.
create or replace function public.vs_merge_remarks(p_own jsonb, p_extra jsonb)
returns jsonb
language sql
immutable
as $$
  select coalesce(jsonb_agg(s.e order by s.at_key nulls first, s.grp, s.ord), '[]'::jsonb)
  from (
    select z.e, z.e ->> 'at' as at_key, 0 as grp, z.ord
      from jsonb_array_elements(coalesce(p_own, '[]'::jsonb)) with ordinality as z(e, ord)
    union all
    select z.e, z.e ->> 'at' as at_key, 1 as grp, z.ord
      from jsonb_array_elements(coalesce(p_extra, '[]'::jsonb)) with ordinality as z(e, ord)
  ) s
$$;

-- Thread-scoped entries contributed by the OTHER tickets in this ticket's
-- duplicate group (the canonical + its siblings). Each is tagged
-- `from_thread: true` so the UI can label it "จากเรื่องที่เกี่ยวข้อง".
--
-- SECURITY DEFINER because the caller (a submitter) cannot read a sibling
-- ticket. It returns ONLY entries a staff member explicitly marked thread/
-- public — never the sibling's id, submitter, or raw problem text.
create or replace function public.vs_thread_remarks(p_id text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with me as (
    select coalesce(t.duplicate_of, t.id) as cid
      from public.vs_tickets t
     where t.id = p_id and t.deleted_at is null
  )
  select coalesce(jsonb_agg(s.x order by s.at_key nulls first, s.sib, s.ord), '[]'::jsonb)
  from (
    select z.e || jsonb_build_object('from_thread', true) as x,
           z.e ->> 'at' as at_key,
           t.id         as sib,
           z.ord        as ord
      from public.vs_tickets t
      join me on true
      cross join lateral jsonb_array_elements(
             public.vs_visible_remarks(t.remarks, 'thread')) with ordinality as z(e, ord)
     where t.deleted_at is null
       and t.id <> p_id
       and (t.id = me.cid or t.duplicate_of = me.cid)
  ) s
$$;

comment on function public.vs_thread_remarks(text) is
  '0096 — thread/public remarks contributed by the OTHER tickets in this ticket''s duplicate group. Never exposes a sibling id or its raw text.';

grant execute on function public.vs_remark_vis(jsonb)          to anon, authenticated;
grant execute on function public.vs_visible_remarks(jsonb, text) to anon, authenticated;
grant execute on function public.vs_merge_remarks(jsonb, jsonb)  to anon, authenticated;
grant execute on function public.vs_thread_remarks(text)         to anon, authenticated;


-- ============================================================
-- 2) GUEST LOOKUP — same sanitization as 0071/0080, now ladder-aware and
--    carrying the thread's shared progress.
-- ============================================================

create or replace function public.get_vs_ticket_by_id(p_id text)
returns setof public.vs_tickets
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  r public.vs_tickets;
begin
  select * into r from public.vs_tickets where id = p_id and deleted_at is null limit 1;
  if not found then return; end if;
  r.duplicate_of := null;                 -- 0071: never hand a submitter another ticket's id
  r.tags := '{}';                         -- 0080: internal per-dept tags are staff-only
  -- 0096: drop staff-only entries, then fold in the duplicate group's shared
  -- (thread/public) progress notes.
  r.remarks := public.vs_merge_remarks(
    public.vs_visible_remarks(r.remarks, 'ticket'),
    public.vs_thread_remarks(p_id));
  return next r;
end;
$$;

grant execute on function public.get_vs_ticket_by_id(text) to anon, authenticated;


-- ============================================================
-- 3) OWNER READ — a sanitizing RPC replacing the raw `select=…,remarks,…`.
--
-- BUG THIS CLOSES (live, 8 rows today): vs-tracking.js loginToViewHistory
-- selected `remarks` straight off the table. RLS lets an owner SELECT their
-- own row, so the RAW array — INCLUDING the 0071 `internal: true` entries
-- whose text is literally 'รวมเป็นเรื่องซ้ำของ VS-XXXXXXXX-XXXX' — was on the
-- wire. The client filtered them in rowToTicket(), which is cosmetic: one
-- DevTools Network tab away is the canonical ticket's id, and
-- get_vs_ticket_by_id() is granted to anon — so the submitter of a duplicate
-- could read ANOTHER student's confidential complaint.
--
-- Exactly the failure 0074 fixed for the `duplicate_of` COLUMN and missed for
-- the same id embedded in `remarks` TEXT. See mistakes.md, "Sanitizing ONE
-- read path of a confidential column leaves parallel read paths leaking".
--
-- The submitter-safe projection is an explicit allow-list (never `select *`),
-- so a future `alter table vs_tickets` cannot silently widen it.
-- ============================================================

create or replace function public.get_my_vs_tickets()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_label text;
  v_out   jsonb;
begin
  if v_uid is null then return '[]'::jsonb; end if;

  -- The legacy label match (pre-submitter_id rows). Derived from the caller's
  -- own users row — NEVER a parameter, or this definer function would hand
  -- anyone another person's tickets.
  select coalesce(u.email, case when u.username is not null then '@' || u.username end)
    into v_label
    from public.users u where u.id = v_uid;

  select coalesce(jsonb_agg(s.obj order by s.ts desc), '[]'::jsonb)
    into v_out
  from (
    select jsonb_build_object(
             'id',              t.id,
             'timestamp',       t.timestamp,
             'created_at',      t.created_at,
             'problem',         t.problem,
             'target_dept',     t.target_dept,
             'status',          t.status,
             'resolution',      t.resolution,
             'resolution_note', t.resolution_note,
             'is_duplicate',    t.is_duplicate,
             'remarks',         public.vs_merge_remarks(
                                  public.vs_visible_remarks(t.remarks, 'ticket'),
                                  public.vs_thread_remarks(t.id))
           ) as obj,
           coalesce(t.timestamp, t.created_at) as ts
      from public.vs_tickets t
     where t.deleted_at is null
       and (t.submitter_id = v_uid
            or (v_label is not null and t.submitter_label = v_label))
  ) s;

  return v_out;
end;
$$;

revoke all on function public.get_my_vs_tickets() from public, anon;
grant execute on function public.get_my_vs_tickets() to authenticated;

comment on function public.get_my_vs_tickets() is
  '0096 — the signed-in submitter''s own tickets, submitter-safe projection (no duplicate_of, no tags, no staff-only remarks). Replaces the raw owner select.';


-- ============================================================
-- 4) SUBMITTER REPLY — through an RPC, so the client neither reads nor
--    rewrites the raw remarks array.
--
-- The old path was read-modify-write from the browser: select remarks (raw,
-- staff-only entries included — the same leak as §3) → push → PATCH the whole
-- array back. Two concurrent replies also silently clobbered each other.
-- ============================================================

create or replace function public.vs_add_submitter_remark(p_id text, p_text text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid := auth.uid();
  v_body text := btrim(coalesce(p_text, ''));
  v_own  boolean;
  v_n    integer;
begin
  if v_uid is null then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if char_length(v_body) < 1 or char_length(v_body) > 2000 then
    raise exception 'ข้อความต้องมีความยาว 1–2000 ตัวอักษร' using errcode = 'P0001';
  end if;

  select (t.submitter_id = v_uid), coalesce(jsonb_array_length(t.remarks), 0)
    into v_own, v_n
    from public.vs_tickets t
   where t.id = p_id and t.deleted_at is null;

  if not coalesce(v_own, false) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if v_n >= 500 then
    raise exception 'เรื่องนี้มีข้อความมากเกินไปแล้ว' using errcode = 'P0001';
  end if;

  update public.vs_tickets
     set remarks = coalesce(remarks, '[]'::jsonb) || jsonb_build_object(
           'type', 'remark',
           'by',   'ผู้แจ้งปัญหา',
           'time', to_char(now() at time zone 'Asia/Bangkok', 'DD/MM, HH24:MI'),
           -- Milliseconds included so this is byte-comparable with the staff
           -- client's Date.toISOString(); `at` is sorted as TEXT, and
           -- '…:35Z' vs '…:35.123Z' would order by '.' < 'Z' instead of time.
           'at',   to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
           'vis',  'ticket',
           'text', v_body)
   where id = p_id;
end;
$$;

revoke all on function public.vs_add_submitter_remark(text, text) from public, anon;
grant execute on function public.vs_add_submitter_remark(text, text) to authenticated;


-- ============================================================
-- 5) PUBLIC BOARD — progress updates, rendered SEPARATELY from comments.
--
-- `updates` is the thread's 'public' remarks (canonical + its duplicates),
-- oldest first. Only staff can produce them: §6's guard rejects any submitter
-- write above 'ticket'. Alias is the staff-written `by` label — untrusted
-- text, escHtml'd on render like every other board string.
--
-- BASED ON 0084's BODY, not 0072/0078's. This function has been redefined
-- three times; the comment-visibility predicate carries 0078's staff_only
-- rule AND 0084's per-ฝ่าย scope branches (v_scope). Rebuilding it from the
-- migration that first created it silently reverts every later one — which is
-- exactly what a first cut of this file did, caught by tools/vs0083-scope.mjs
-- ("board: reads staff-only comment on OWN dept" went red). Always diff
-- against pg_get_functiondef() before re-creating a function.
-- ============================================================

create or replace function public.get_public_vs_problem(p_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  t public.vs_tickets;
  v_conf boolean;
  v_staff boolean := public.current_user_is_staff();
  v_scope text[]  := public.current_user_vs_scope();   -- 0084
  v_result jsonb;
begin
  select * into t from public.vs_tickets
   where id = p_id and is_public = true and deleted_at is null and duplicate_of is null;
  if not found then return null; end if;

  select is_confidential into v_conf from public.vs_categories where id = t.category;
  if coalesce(v_conf, false) then return null; end if;  -- defense-in-depth

  v_result := jsonb_build_object(
    'canonical_id', t.id,
    'public_title', t.public_title,
    'public_note',  t.public_note,
    'category',     t.category,
    'phase',        public.vs_public_phase(t.status),
    'is_resolved',  (t.status like '%เสร็จสิ้น%'),
    'affected',
      1
      + (select count(*) from public.vs_tickets d where d.duplicate_of = t.id and d.deleted_at is null)
      + (select count(*) from public.vs_followers f where f.canonical_id = t.id),
    'following', (auth.uid() is not null and exists (
        select 1 from public.vs_followers f where f.canonical_id = t.id and f.user_id = auth.uid())),
    'created_at',   coalesce(t.created_at, t.timestamp),
    -- 0096: staff progress notes marked สาธารณะ, across the whole duplicate
    -- group. A separate stream from `comments` — this is the team talking, not
    -- the discussion thread.
    'updates', coalesce((
      select jsonb_agg(jsonb_build_object(
               'by',   u.e ->> 'by',
               'text', u.e ->> 'text',
               'time', u.e ->> 'time',
               'at',   u.e ->> 'at')
             order by (u.e ->> 'at') nulls first, u.mid, u.ord)
      from (
        select z.e, m.id as mid, z.ord
          from public.vs_tickets m
          cross join lateral jsonb_array_elements(
                 public.vs_visible_remarks(m.remarks, 'public')) with ordinality as z(e, ord)
         where m.deleted_at is null
           and (m.id = t.id or m.duplicate_of = t.id)
      ) u
    ), '[]'::jsonb),
    'comments', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', m.id,
               'is_staff', m.is_staff,
               'staff_only', m.staff_only,
               -- pseudonymous, stable per (thread,user), unlinkable to identity
               'alias', case when m.is_staff then 'เจ้าหน้าที่'
                             else 'นศ.' || upper(substr(md5(m.canonical_id || m.author_user_id::text), 1, 4)) end,
               'body', m.body,
               'created_at', m.created_at
             ) order by m.created_at asc)
      from public.vs_public_comments m
      where m.canonical_id = t.id and m.hidden = false
        -- 0078: staff-only comments reach staff + their own author only.
        -- 0084: …plus a full-VS grant (scope NULL = SE-equivalent) and a
        -- per-ฝ่าย handler, the latter ONLY on their own dept's problem.
        and (m.staff_only = false
             or v_staff
             or v_scope is null
             or t.target_dept = any (v_scope)
             or (auth.uid() is not null and m.author_user_id = auth.uid()))
    ), '[]'::jsonb)
  );
  return v_result;
end;
$$;

grant execute on function public.get_public_vs_problem(text) to anon, authenticated;


-- Board list gains update_count so a card can advertise that the team has
-- posted progress. Adding an OUT column changes the row type → DROP first
-- (mistakes.md: "create or replace function CANNOT change the return type").
drop function if exists public.get_public_vs_board(text, text, integer);
create or replace function public.get_public_vs_board(
  p_category text default null,
  p_sort     text default 'hot',
  p_limit    integer default 60
)
returns table (
  canonical_id text,
  public_title text,
  public_note  text,
  category     text,
  cat_label    text,
  cat_icon     text,
  phase        integer,
  is_resolved  boolean,
  affected     bigint,
  comment_count bigint,
  update_count  bigint,
  following    boolean,
  created_at   timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select t.id,
         t.public_title,
         t.public_note,
         t.category,
         c.label,
         c.icon,
         public.vs_public_phase(t.status),
         (t.status like '%เสร็จสิ้น%'),
         1
           + (select count(*) from public.vs_tickets d
                where d.duplicate_of = t.id and d.deleted_at is null)
           + (select count(*) from public.vs_followers f where f.canonical_id = t.id),
         (select count(*) from public.vs_public_comments m
            where m.canonical_id = t.id and m.hidden = false and m.staff_only = false),
         (select coalesce(sum(jsonb_array_length(
                   public.vs_visible_remarks(m.remarks, 'public'))), 0)
            from public.vs_tickets m
           where m.deleted_at is null and (m.id = t.id or m.duplicate_of = t.id)),
         (auth.uid() is not null and exists (
            select 1 from public.vs_followers f2
             where f2.canonical_id = t.id and f2.user_id = auth.uid())),
         coalesce(t.created_at, t.timestamp)
  from public.vs_tickets t
  join public.vs_categories c on c.id = t.category
  where t.is_public = true
    and t.deleted_at is null
    and t.duplicate_of is null
    and c.is_confidential = false
    and (p_category is null or t.category = p_category)
  order by
    case when p_sort = 'new' then coalesce(t.created_at, t.timestamp) end desc nulls last,
    case when p_sort = 'active' then (
      select max(m.created_at) from public.vs_public_comments m
       where m.canonical_id = t.id and m.hidden = false and m.staff_only = false
    ) end desc nulls last,
    -- default 'hot' = most affected, unresolved first
    (t.status like '%เสร็จสิ้น%'),
    (1
      + (select count(*) from public.vs_tickets d
           where d.duplicate_of = t.id and d.deleted_at is null)
      + (select count(*) from public.vs_followers f where f.canonical_id = t.id)) desc,
    coalesce(t.created_at, t.timestamp) desc
  limit greatest(least(coalesce(p_limit, 60), 200), 1);
$$;

grant execute on function public.get_public_vs_board(text, text, integer) to anon, authenticated;


-- ============================================================
-- 6) THE COLUMN GUARD — see the header for the live proof.
--
-- Scope: fires ONLY when the caller is the row's own submitter and is not a
-- VS handler. That is precisely the `vs_tickets_update_owner` path; every
-- other writer (staff via vs_tickets_update_staff, the definer RPCs, the
-- cascade trigger, service_role, the Management API) has either a handler
-- role or a null auth.uid() and returns early — the 0041 lesson (a guard that
-- cannot tell a server writer from a client PATCH takes the whole
-- transaction down).
--
-- Column comparison is `to_jsonb(row) - allowed_keys` rather than a hand
-- written column list, so a column added by a FUTURE migration is guarded by
-- default (fails CLOSED). Three keys are excluded:
--   remarks      — the one thing a submitter may append to (checked below)
--   updated_at   — written by the touch_vs_tickets_updated_at trigger, which
--                  fires before this one ('t' < 'v', same timing → name order)
--   is_duplicate — GENERATED ALWAYS; Postgres computes it AFTER before-row
--                  triggers, so NEW.is_duplicate is NULL here while OLD holds
--                  the stored value. Comparing them would reject every write.
--                  Safe to skip: it is derived from duplicate_of, which IS
--                  compared.
-- ============================================================

create or replace function public.vs_tickets_self_update_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_old_r jsonb;
  v_new_r jsonb;
  v_n     integer;
  i       integer;
  e       jsonb;
begin
  -- Staff / any VS-scoped handler: their own RLS policy is the boundary.
  if public.current_user_is_vs_handler() then
    return new;
  end if;
  -- Not the owner self-update path (server contexts have a null auth.uid()).
  if v_uid is null or v_uid is distinct from old.submitter_id then
    return new;
  end if;

  -- A submitter may change NOTHING but their own remarks.
  if (to_jsonb(old) - 'remarks' - 'updated_at' - 'is_duplicate')
     is distinct from
     (to_jsonb(new) - 'remarks' - 'updated_at' - 'is_duplicate') then
    raise exception 'ผู้แจ้งแก้ไขได้เฉพาะข้อความของตนเองเท่านั้น'
      using errcode = 'P0001',
            detail  = 'vs_tickets_self_update_guard: only `remarks` is submitter-writable';
  end if;

  v_old_r := coalesce(old.remarks, '[]'::jsonb);
  v_new_r := coalesce(new.remarks, '[]'::jsonb);
  if v_new_r = v_old_r then
    return new;
  end if;

  if jsonb_typeof(v_new_r) <> 'array' then
    raise exception 'รูปแบบข้อความไม่ถูกต้อง' using errcode = 'P0001';
  end if;

  v_n := jsonb_array_length(v_old_r);

  -- Append-only: the existing entries must survive untouched, in order. Stops
  -- a submitter rewriting or deleting the staff timeline on their own ticket.
  if jsonb_array_length(v_new_r) < v_n then
    raise exception 'ไม่สามารถลบข้อความเดิมได้' using errcode = 'P0001';
  end if;
  for i in 0 .. v_n - 1 loop
    if (v_new_r -> i) is distinct from (v_old_r -> i) then
      raise exception 'ไม่สามารถแก้ไขข้อความเดิมได้' using errcode = 'P0001';
    end if;
  end loop;

  if jsonb_array_length(v_new_r) > 500 then
    raise exception 'เรื่องนี้มีข้อความมากเกินไปแล้ว' using errcode = 'P0001';
  end if;

  -- Every appended entry: submitter-authored, 'ticket' visibility, bounded.
  -- Without the vis check a submitter could append {"vis":"public"} and have
  -- it rendered on the กระดานปัญหา as a staff progress update (§5).
  for i in v_n .. jsonb_array_length(v_new_r) - 1 loop
    e := v_new_r -> i;
    if public.vs_remark_vis(e) <> 'ticket' then
      raise exception 'ผู้แจ้งไม่สามารถกำหนดการมองเห็นของข้อความได้' using errcode = 'P0001';
    end if;
    if coalesce(e ->> 'by', '') <> 'ผู้แจ้งปัญหา' then
      raise exception 'ไม่สามารถระบุผู้เขียนเป็นบุคคลอื่นได้' using errcode = 'P0001';
    end if;
    if char_length(coalesce(e ->> 'text', '')) > 2000 then
      raise exception 'ข้อความยาวเกิน 2000 ตัวอักษร' using errcode = 'P0001';
    end if;
  end loop;

  return new;
end;
$$;

drop trigger if exists vs_tickets_self_update_guard on public.vs_tickets;
create trigger vs_tickets_self_update_guard
  before update on public.vs_tickets
  for each row execute function public.vs_tickets_self_update_guard();

comment on function public.vs_tickets_self_update_guard() is
  '0096 — column guard for the vs_tickets_update_owner RLS path. RLS is row-level; without this a submitter can PATCH is_public/public_title and self-publish to the กระดานปัญหา (proven live). Fires only when auth.uid() = submitter_id and the caller is not a VS handler.';
