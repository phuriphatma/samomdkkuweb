-- ============================================================
-- 0080 — Strip internal per-dept tags (0079) from the guest ticket lookup
--
-- Bug: get_vs_ticket_by_id (0021, sanitized in 0071) returns
-- `setof public.vs_tickets` via `select *`. When 0079 added the
-- `vs_tickets.tags text[]` column, that `select *` began emitting `tags`
-- in the RPC's response to `anon` — violating the 0079 invariant that
-- internal tags are staff-only and NEVER returned by any guest RPC.
--
-- The leak is opaque tag ids (a guest can't read vs_tags to resolve labels),
-- and rowToTicket never renders them, so nothing is VISIBLE — but the ids
-- ride in the wire JSON, which is exactly the "select * re-leaks a
-- newly-added column" trap (cf. the 0071 duplicate_of sanitization and the
-- SUBMITTER_COLS allow-list on the owner read path).
--
-- Fix: sanitize the returned row like duplicate_of — blank `tags` to the
-- empty array before returning. (Return-only mutation of a record variable;
-- the base row is untouched. Staff read the raw table on the dashboard, so
-- they still see every tag.)
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
  r.remarks := (
    select coalesce(jsonb_agg(e), '[]'::jsonb)
    from jsonb_array_elements(coalesce(r.remarks, '[]'::jsonb)) e
    where coalesce((e ->> 'internal')::boolean, false) = false
  );
  return next r;
end;
$$;

grant execute on function public.get_vs_ticket_by_id(text) to anon, authenticated;
