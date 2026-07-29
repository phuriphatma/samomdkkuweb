-- ============================================================
-- 0098 — an UNKNOWN vs_categories id must fail CLOSED on the public detail
--
-- Prompted by making หมวดหมู่ deletable in the category manager (the same
-- affordance vs_tags just got). Deleting a category leaves every ticket that
-- referenced it pointing at an id with no row — `vs_tickets.category` is loose
-- text with NO foreign key, chosen deliberately in 0072 so retiring a category
-- can never break a ticket. That is fine as long as every reader treats the
-- dangling reference as "unknown, therefore not publishable".
--
-- Three of the four readers already did:
--   get_public_vs_board       inner join vs_categories        → row vanishes ✔
--   vs_post_public_comment    coalesce(c.is_confidential,true) → refused    ✔
--   vs_add_me_too             coalesce(c.is_confidential,true) → refused    ✔
--   vs_set_public             coalesce(v_conf, true)           → refused    ✔
--
-- get_public_vs_problem was the odd one out:
--     select is_confidential into v_conf from vs_categories where id = t.category;
--     if coalesce(v_conf, FALSE) then return null; end if;
--                        ^^^^^ a missing row is NULL → false → gate PASSES
--
-- Measured live, in a rolled-back transaction, on a confidential ticket left
-- at is_public = true (a state the app reaches on purpose: staff may move an
-- already-published ticket into a ความลับ category — the modal confirms "จะ
-- ซ่อนจากกระดานทันที" — which relies entirely on the read layer to exclude it,
-- and 0072's isolation test asserts exactly that shape):
--
--   BEFORE deleting the category  on_board=0  detail=NULL (hidden)   ✔
--   AFTER  deleting the category  on_board=0  detail='ไม่ควรแสดง'    ✗ SERVED
--
-- So deleting a confidential category would un-hide the curated projection AND
-- the public comment thread of every ticket in it. The raw `problem` text is
-- never in that projection, so this is not a full disclosure — but it is
-- exactly the "hidden thing comes back" failure the confidential lane exists
-- to prevent, and it would have been triggered by an ordinary admin action.
--
-- Fix: coalesce(v_conf, TRUE) — an id we cannot resolve is treated as
-- confidential. This also makes the detail agree with the LIST for the first
-- time; before, a dangling category meant "not on the board, but reachable by
-- direct id", which is a difference no caller could have predicted.
--
-- Note this is a real (if narrow) behaviour change for any EXISTING dangling
-- category: such a ticket stops being publicly readable. Live count of public
-- tickets whose category does not resolve is 0, so nothing changes today.
--
-- Based on the LIVE body (0096's, which carries 0078's staff_only rule and
-- 0084's v_scope branches) — see mistakes.md, "Recreating a function from the
-- migration that FIRST defined it silently reverts every later one".
-- Idempotent.
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
  -- 0098: NULL means "no such category" (deleted, or never set) — fail CLOSED,
  -- matching the board list's inner join and vs_set_public's own coalesce.
  if coalesce(v_conf, true) then return null; end if;

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

comment on function public.get_public_vs_problem(text) is
  '0098 — public Problem detail. An unresolvable category fails CLOSED (returns null), matching get_public_vs_board''s inner join. Never returns the raw problem text.';
