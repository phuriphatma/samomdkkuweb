-- ============================================================
-- 0021_guest_ticket_lookup_rpcs.sql
--
-- Guests need to be able to look up a single VS or PR ticket by the
-- exact id printed on their success card. The existing RLS on
-- vs_tickets / pr_tickets only allows reads when the row's
-- submitter_id matches auth.uid() OR the caller is staff — that's
-- the right default (don't expose all tickets via a public read),
-- but it locks out the guest tracking flow.
--
-- Pattern: a SECURITY DEFINER function that scopes the result to the
-- supplied id. The function bypasses RLS to fetch the row, but it
-- can ONLY return the single row whose id matches the parameter,
-- which means an anonymous caller can read their own ticket if they
-- know the id but can't dump the whole table.
-- ============================================================

create or replace function public.get_vs_ticket_by_id(p_id text)
returns setof public.vs_tickets
language sql stable security definer set search_path = public as $$
  select * from public.vs_tickets where id = p_id limit 1;
$$;

grant execute on function public.get_vs_ticket_by_id(text) to anon, authenticated;

comment on function public.get_vs_ticket_by_id(text) is
  'Guest-facing VS ticket lookup. Returns the single ticket whose id matches the supplied parameter; bypasses RLS via SECURITY DEFINER so anyone with the id can fetch their own ticket.';


-- PR ticket lookup mirrors the same pattern. The existing client uses
-- `ilike` for case-insensitive matching (PR IDs are commonly entered
-- in lower case); the RPC keeps that semantic.
create or replace function public.get_pr_ticket_by_id(p_id text)
returns setof public.pr_tickets
language sql stable security definer set search_path = public as $$
  select * from public.pr_tickets where id ilike p_id limit 1;
$$;

grant execute on function public.get_pr_ticket_by_id(text) to anon, authenticated;

comment on function public.get_pr_ticket_by_id(text) is
  'Guest-facing PR ticket lookup. Returns the single ticket whose id matches the supplied parameter (ilike); bypasses RLS via SECURITY DEFINER so anyone with the id can fetch their own ticket.';
