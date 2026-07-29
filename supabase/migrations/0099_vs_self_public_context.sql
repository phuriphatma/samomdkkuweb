-- ============================================================
-- 0099 — tell a CANONICAL's submitter that their report is on the board,
--        and close the last unknown-category fail-open.
--
-- FEATURE. Since 0075 a DUPLICATE's submitter gets a banner on their tracking
-- view — "เรื่องของคุณตรงกับปัญหาสาธารณะ: <title>" + a ติดตามบนกระดานปัญหา
-- button. The submitter of the CANONICAL — the person whose report actually
-- BECAME the public problem — got nothing. They had no way to know their
-- report was published, let alone follow the discussion on it.
--
-- get_vs_linked_context() already answers "is there a public thing to link to,
-- and is it safe to name it?" for the duplicate case, with the confidentiality
-- re-check in one place. Rather than adding is_public/public_title to the
-- submitter read (a second path to keep sanitized — see the SUBMITTER_COLS
-- history in mistakes.md), this teaches the SAME function the self case:
--
--   duplicate, canonical public      → {linked:true,  public:true,  public_id, public_title, related_count}
--   duplicate, canonical private     → {linked:true,  public:false, related_count}
--   canonical, itself on the board   → {linked:false, self_public:true, public_id:<self>, public_title, related_count}   ← NEW
--   otherwise                        → {linked:false}
--
-- Safe: `public_id` in the self case is the caller's OWN id — the very
-- capability they used to call — and `public_title` is SE-written text already
-- world-readable through get_public_vs_board / get_public_vs_problem. Nothing
-- is disclosed that the board does not already publish.
--
-- ============================================================
-- BUG FIX (this is the load-bearing half).
--
-- 0075 computed "is the canonical publishable" over a LEFT JOIN as:
--     coalesce(c.is_confidential, false) or not coalesce(c.public_eligible, true)
-- Both defaults point the WRONG way. When the category row is missing — which
-- became reachable the moment 0098 shipped a ลบ button for หมวดหมู่ — c.* is
-- NULL, so `blocked` computes FALSE and the function reports the canonical as
-- public. Measured live, in a rolled-back transaction, on a confidential
-- canonical + its duplicate:
--
--   BEFORE deleting the category  {"linked":true,"public":false,"related_count":2}
--   AFTER  deleting the category  {"linked":true,"public":true,
--                                  "public_id":"VS-TSTCTXA",
--                                  "public_title":"หัวข้อลับของเรื่องหลัก",...}
--
-- i.e. it hands the duplicate's submitter the CONFIDENTIAL canonical's id and
-- title — precisely the disclosure 0071/0074/0075 exist to prevent, and the id
-- is a lookup capability (get_vs_ticket_by_id is granted to anon).
--
-- 0098 fixed this exact shape in get_public_vs_problem and its header told the
-- next person to "grep every reader of the referencing column". Seven functions
-- read is_confidential / public_eligible; the four board readers were checked
-- and this fifth one was not. For the record, the full audit now reads:
--
--   get_public_vs_board      inner join                        closed ✔
--   search_public_vs         inner join                        closed ✔
--   vs_add_me_too            coalesce(is_confidential, true)   closed ✔
--   vs_post_public_comment   coalesce(is_confidential, true)   closed ✔
--   vs_set_public            coalesce(v_conf, true)            closed ✔
--   get_public_vs_problem    coalesce(v_conf, true)   (0098)   closed ✔
--   get_vs_linked_context    ← THIS FILE                       closed ✔
--
-- Both defaults are flipped: coalesce(is_confidential, TRUE) and
-- coalesce(public_eligible, FALSE). A ticket with no category at all (never
-- classified) is now also treated as not-publishable, which matches the board
-- list's inner join.
--
-- Idempotent.
-- ============================================================

create or replace function public.get_vs_linked_context(p_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_dup      text;
  v_count    int;
  v_is_public boolean;
  v_title    text;
  v_blocked  boolean;   -- target is confidential / not public-eligible / unknown
  v_target   text;
begin
  select duplicate_of into v_dup
    from public.vs_tickets where id = p_id and deleted_at is null;

  -- Which ticket's public state are we describing? A duplicate points at its
  -- canonical; a canonical describes ITSELF (0099).
  v_target := coalesce(v_dup, p_id);
  if v_target is null then
    return jsonb_build_object('linked', false);   -- no such ticket
  end if;

  -- Cluster size = the canonical + its non-deleted duplicates. For a duplicate
  -- this counts itself among them; for a canonical it is 1 + its duplicates.
  select count(*) + 1 into v_count
    from public.vs_tickets
   where duplicate_of = v_target and deleted_at is null;

  -- Target's public state + confidential re-check via the category ref.
  -- 0099: a NULL category row (deleted, or never classified) is BLOCKED. The
  -- 0075 defaults (false / true) let a deleted category unblock a confidential
  -- canonical and leak its id + title — see the header.
  select t.is_public, t.public_title,
         (coalesce(c.is_confidential, true) or not coalesce(c.public_eligible, false))
    into v_is_public, v_title, v_blocked
    from public.vs_tickets t
    left join public.vs_categories c on c.id = t.category
   where t.id = v_target and t.deleted_at is null;

  if v_dup is null then
    -- ---- CANONICAL: is this person's own report on the board? ----
    if coalesce(v_is_public, false) and not coalesce(v_blocked, true) then
      return jsonb_build_object(
        'linked', false,
        'self_public', true,
        'public_id', p_id,          -- their own id; no new capability
        'public_title', v_title,
        'related_count', v_count);
    end if;
    return jsonb_build_object('linked', false);
  end if;

  -- ---- DUPLICATE: describe the canonical, safely (0075) ----
  if coalesce(v_is_public, false) and not coalesce(v_blocked, true) then
    return jsonb_build_object(
      'linked', true,
      'public', true,
      'public_id', v_target,
      'public_title', v_title,
      'related_count', v_count);
  end if;

  -- Confidential / unpublished canonical: acknowledge the private link + scale
  -- only. NEVER the id/title.
  return jsonb_build_object('linked', true, 'public', false, 'related_count', v_count);
end;
$$;

revoke all on function public.get_vs_linked_context(text) from public;
grant execute on function public.get_vs_linked_context(text) to anon, authenticated;

comment on function public.get_vs_linked_context(text) is
  'Submitter-safe board context (0075 + 0099). Duplicate → the canonical''s public id+title when it is on the board, else linked+count only. Canonical → self_public + its own id/title when the report itself is on the board. An unresolvable category is treated as CONFIDENTIAL.';
