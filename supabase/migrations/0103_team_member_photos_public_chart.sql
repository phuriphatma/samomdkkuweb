-- 0103 — member photos, and the public org chart learns to publish them.
--
-- Adds `team_members.photo_url` and extends get_public_org_chart() to include it.
-- Nothing else about the projection changes.
--
-- WHY THE PROJECTION AND NOT A POLICY: team_members holds kkumail, student_id,
-- year, major, permissions, vs_dept, project_seat and user_id. RLS is row-level, so
-- a "public" flag would publish whole ROWS — and a `using (true)` policy can never
-- be narrowed afterwards because permissive policies are OR'd. So
-- get_public_org_chart() stays the ONLY sanctioned publisher: a SECURITY DEFINER
-- function with a hand-built jsonb whose keys are an explicit allow-list.
-- team_members still has NO public SELECT policy and anon must keep reading 0 rows
-- from it. (mistakes.md: "Publishing a table-backed directory must be a PROJECTION".)
--
-- BASED ON THE LIVE BODY (pg_get_functiondef), not on 0086 — recreating a function
-- from the migration that first defined it silently reverts every later one.
-- Verified before writing: 0086 is still the only definition, but the rule stands.

alter table public.team_members
  add column if not exists photo_url text;

-- Cap it: the column is written by the admin UI but the value ends up in a public
-- projection, so bound the row size the same way notify_log / analytics_events do.
alter table public.team_members
  drop constraint if exists team_members_photo_url_len;
alter table public.team_members
  add constraint team_members_photo_url_len
  check (photo_url is null or char_length(photo_url) <= 500);

comment on column public.team_members.photo_url is
  'Public portrait URL (Drive lh3 form via uploads.js convertDriveUrl). PUBLISHED by
   get_public_org_chart() for members of is_public nodes — treat it as public data.';

create or replace function public.get_public_org_chart()
returns jsonb
language sql stable security definer set search_path = public as $$
  with recursive visible as (
    select n.id, n.parent_id, n.name, n.kind, n.position
      from public.team_nodes n
     where n.parent_id is null and n.is_public
    union all
    select c.id, c.parent_id, c.name, c.kind, c.position
      from public.team_nodes c
      join visible v on c.parent_id = v.id
     where c.is_public
  )
  select jsonb_build_object(
    'nodes', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', v.id, 'parent_id', v.parent_id,
               'name', v.name, 'kind', v.kind, 'position', v.position)
             order by v.position, v.name)
        from visible v), '[]'::jsonb),
    -- name + nickname + photo + order ONLY. Never kkumail / student_id / year /
    -- major / permissions / vs_dept / project_seat / passport_* / user_id /
    -- confirmed. A new column on team_members is NOT published until it is named
    -- here, which is the entire point of building the object key by key.
    'members', coalesce((
      select jsonb_agg(jsonb_build_object(
               'node_id', m.node_id,
               'name', m.full_name,
               'nickname', m.nickname,
               'photo_url', m.photo_url,
               'position', m.position)
             order by m.position, m.full_name)
        from public.team_members m
        join visible v on v.id = m.node_id), '[]'::jsonb)
  )
$$;

-- Unchanged from 0086, restated because the grants travel with the definition when
-- a signature changes; harmless when it does not.
grant execute on function public.get_public_org_chart() to anon, authenticated;
