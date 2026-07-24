-- ============================================================
-- 0075 — VS duplicate: submitter-safe "linked context" for the tracking view
--
-- Refines 0074. A duplicate B's submitter should learn as much as is SAFE
-- about the link, keyed on the CANONICAL's visibility:
--   * canonical is PUBLIC (+ non-confidential) → return its public id + title so
--     B's submitter can open the board entry and follow/me-too/discuss. Safe:
--     a public canonical's id + title are already world-exposed via the board
--     RPCs (get_public_vs_board / get_public_vs_problem, granted anon).
--   * canonical is CONFIDENTIAL → return ONLY that a private link exists + the
--     cluster size ("รวม N เรื่องที่เกี่ยวข้อง เก็บเป็นความลับ"). Never the id,
--     title, content, or submitter of the canonical or any sibling.
--
-- Keyed by B's id (a capability, same trust model as get_vs_ticket_by_id 0021):
-- whoever holds B's id can already read B in full, so exposing "B links to a
-- PUBLIC problem X" (X public anyway) or "B links to something private + count"
-- adds no new disclosure. Confidential-category re-check included (defense in
-- depth, matching the board invariant) so a mis-flagged confidential ticket can
-- never be surfaced as public here.
-- ============================================================

create or replace function public.get_vs_linked_context(p_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_dup text;
  v_count int;
  v_is_public boolean;
  v_title text;
  v_blocked boolean;   -- canonical is confidential / not public-eligible
begin
  select duplicate_of into v_dup
    from public.vs_tickets where id = p_id and deleted_at is null;
  if v_dup is null then
    return jsonb_build_object('linked', false);
  end if;

  -- Cluster size = the canonical + its non-deleted duplicates (includes B).
  select count(*) + 1 into v_count
    from public.vs_tickets
   where duplicate_of = v_dup and deleted_at is null;

  -- Canonical's public state + confidential re-check via the category ref.
  select t.is_public, t.public_title,
         (coalesce(c.is_confidential, false) or not coalesce(c.public_eligible, true))
    into v_is_public, v_title, v_blocked
    from public.vs_tickets t
    left join public.vs_categories c on c.id = t.category
   where t.id = v_dup and t.deleted_at is null;

  if coalesce(v_is_public, false) and not coalesce(v_blocked, false) then
    return jsonb_build_object(
      'linked', true,
      'public', true,
      'public_id', v_dup,
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
  'Submitter-safe linked context for a duplicate ticket: public canonical id+title when the canonical is public, else just linked+related_count. Never exposes a confidential canonical. See 0075.';
