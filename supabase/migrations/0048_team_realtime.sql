-- 0048_team_realtime.sql
-- Enable Supabase Realtime for the SAMO Team tables so concurrent VP editors
-- see each other's changes live (last-write-wins propagation, RLS-filtered —
-- only vp_admin/dev sessions receive events because realtime re-checks the
-- subscriber's RLS the same as a SELECT).
--
-- replica identity full → UPDATE/DELETE events carry the complete OLD row, so
-- the client can reconcile a deleted/moved row without a refetch.

alter table public.team_nodes   replica identity full;
alter table public.team_members replica identity full;

-- Add both tables to the supabase_realtime publication. `add table` has no
-- IF NOT EXISTS, so guard against a re-run (42710) with a catalog check.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public' and tablename = 'team_nodes'
  ) then
    alter publication supabase_realtime add table public.team_nodes;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public' and tablename = 'team_members'
  ) then
    alter publication supabase_realtime add table public.team_members;
  end if;
end $$;
