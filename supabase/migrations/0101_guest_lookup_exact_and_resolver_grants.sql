-- ============================================================
-- 0101 — two anon-reachable holes found by the pre-/clear scan.
--        Both PRE-DATE this session's work; neither is a regression.
--
-- ------------------------------------------------------------
-- (1) get_pr_ticket_by_id matched with ILIKE — so the ticket id was not a
--     capability at all, it was a PATTERN.
--
--     `select * from pr_tickets where id ilike p_id` — presumably to make the
--     guest lookup case-insensitive for someone typing an id by hand. But
--     ILIKE gives the CALLER pattern syntax, and the function is granted to
--     anon. Measured live with nothing but the bundled anon key:
--
--       POST /rest/v1/rpc/get_pr_ticket_by_id  {"p_id":"%"}
--         → PR-68TE3N, submitter_label "samomdkku.intraaffair@gmail.com",
--           submitter_id, brief "Title: พิธีไหว้ครู ประจำปี 2569 …"
--
--     `limit 1` bounds one call, but an attacker walks the space with
--     'PR-A%', 'PR-B%', … to enumerate every id and then reads each ticket in
--     full — submitter email, contact, brief, file_url, assignees. The whole
--     guest-lookup design (0021) rests on "the id IS the secret"; a wildcard
--     dissolves that. The VS twin uses `=` and is unaffected (verified: the
--     same '%' probe returns []).
--
--     Fix: `lower(id) = lower(btrim(p_id))` — keeps the case-insensitivity
--     ILIKE was there for, drops the pattern semantics. btrim so a pasted id
--     with whitespace still resolves.
--
-- ------------------------------------------------------------
-- (2) The ten team-resolver functions were executable by anon/PUBLIC, which
--     made them an ANONYMOUS ORACLE over the org's permission map:
--
--       POST /rest/v1/rpc/effective_team_permissions_for_email
--            {"p_email":"phuriphat.ma@kkumail.com"}
--         → ["creator","pr","projects","samoshop","team","vs"]
--
--     Anyone can confirm an address belongs to the org and read exactly which
--     grants it holds — reconnaissance that says who is worth attacking. The
--     `node_effective_*` twins leak the tree's grant shape by node id.
--
--     Nothing outside SQL calls them (grep: the frontend only NAMES them in
--     comments). Their real callers — sync_my_team_permissions,
--     recompute_team_managed_permissions, the statement triggers — are all
--     SECURITY DEFINER and execute as the owner, so they keep working with no
--     grant at all. Revoked from anon, authenticated and PUBLIC.
--
--     sync_my_team_permissions() KEEPS its authenticated grant — auth.js calls
--     it on every login (see STATE.md), and it only ever resolves the CALLER's
--     own identity.
--
-- Idempotent.
-- ============================================================

-- ---------- (1) exact, case-insensitive guest lookup ----------
create or replace function public.get_pr_ticket_by_id(p_id text)
returns setof public.pr_tickets
language sql
stable
security definer
set search_path = public
as $$
  select * from public.pr_tickets
   where lower(id) = lower(btrim(coalesce(p_id, '')))
     and deleted_at is null
   limit 1;
$$;

grant execute on function public.get_pr_ticket_by_id(text) to anon, authenticated;

comment on function public.get_pr_ticket_by_id(text) is
  '0101 — guest PR lookup. Matches the id EXACTLY (case-insensitively); it used ILIKE, which let an anon caller pass "%" and enumerate tickets. The id is the capability.';

-- ---------- (2) resolvers are server-internal ----------
do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.effective_team_passport_scopes_for_email(text)',
    'public.effective_team_permissions_for_email(text)',
    'public.effective_team_project_seats_for_email(text)',
    'public.effective_team_shop_sources_for_email(text)',
    'public.effective_team_vs_depts_for_email(text)',
    'public.node_effective_passport_scopes(uuid)',
    'public.node_effective_permissions(uuid)',
    'public.node_effective_project_seats(uuid)',
    'public.node_effective_shop_sources(uuid)',
    'public.node_effective_vs_depts(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', fn);
  end loop;
end $$;
