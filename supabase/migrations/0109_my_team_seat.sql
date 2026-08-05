-- ============================================================
-- 0109 — get_my_team_seat(): tell a signed-in person what they are.
--
-- THE PROBLEM
-- A ทีม SAMO grant is invisible to the person who holds it. Someone whose
-- kkumail sits in the tree signs in and the app silently gains abilities —
-- a sidebar section appears, a tab starts saving — with nothing anywhere
-- naming their ตำแหน่ง or listing what they may now do. Every diagnosis of
-- "why can't I…" so far has needed a developer with SQL access, because the
-- resolvers that answer it (effective_team_*_for_email) were revoked from
-- authenticated in 0101 — correctly: they answer about ANY email, which made
-- them an oracle over the whole roster.
--
-- WHAT THIS ADDS
-- One SECURITY DEFINER function that answers the same question about the
-- CALLER ONLY. It never takes an email argument — the identity comes from
-- auth.uid() → public.users.email — so there is no address to probe with. It
-- is the same shape as sync_my_team_permissions() (0081→0093), which is the
-- existing precedent for "resolve my own grants", and it deliberately does
-- NOT write anything: the login sync already owns that side.
--
-- WHAT IT MAY EXPOSE, AND TO WHOM
--   • ตำแหน่ง names on the caller's own postings, plus the ancestor path up to
--     the root ฝ่าย. Node names are already public through
--     get_public_team_chart() for every is_public branch; for a NON-public
--     branch this shows the name to the one person who holds the posting,
--     which is the whole point.
--   • The caller's own display name / ชื่อเล่น, which they typed.
--   • The caller's effective permission keys and scopes — their own grants.
-- It exposes NOTHING about any other person: no member list, no other
-- kkumail, no รหัสนักศึกษา, no photo, no user_id. The projection is a
-- hand-built jsonb allow-list, never `select *` / `returns setof <table>`,
-- because a `returns setof public.team_members` would auto-expose every
-- column a future migration adds (the 0079/0080 trap).
-- ============================================================

-- ------------------------------------------------------------
-- The ancestor path of a node, root first, EXCLUDING the node itself.
-- Bounded by the same 100-hop runaway guard the other tree walkers use.
-- ------------------------------------------------------------
create or replace function public.team_node_path(p_node uuid)
returns text[] language plpgsql stable security definer set search_path = public as $$
declare
  v_out  text[] := '{}';
  v_cur  uuid;
  v_node public.team_nodes%rowtype;
  v_hops int := 0;
begin
  select parent_id into v_cur from public.team_nodes where id = p_node;
  loop
    v_hops := v_hops + 1;
    exit when v_cur is null or v_hops > 100;
    select * into v_node from public.team_nodes where id = v_cur;
    exit when not found;
    -- prepend: we are climbing, the caller wants root-first
    v_out := array[v_node.name] || v_out;
    v_cur := v_node.parent_id;
  end loop;
  return v_out;
end;
$$;

-- Called only from get_my_team_seat() below, which is itself definer, so nobody
-- needs to call it directly — and a bare node id would otherwise let any signed-in
-- user walk the private branches of the tree by uuid.
--
-- `revoke ... from public` is NOT enough. This database has
-- ALTER DEFAULT PRIVILEGES granting EXECUTE on new functions to anon AND
-- authenticated, and those are separate grantees from PUBLIC — verified here:
-- the first apply of this migration left `authenticated=X` on proacl despite the
-- revoke below it. Revoke each role BY NAME and check pg_proc.proacl afterwards.
revoke all on function public.team_node_path(uuid) from public;
revoke all on function public.team_node_path(uuid) from anon;
revoke all on function public.team_node_path(uuid) from authenticated;

-- ------------------------------------------------------------
-- The caller's own postings + effective grants.
-- ------------------------------------------------------------
create or replace function public.get_my_team_seat()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_uid      uuid := auth.uid();
  v_email    text;
  v_postings jsonb := '[]'::jsonb;
  m          public.team_members%rowtype;
  v_node     public.team_nodes%rowtype;
  v_name     text;
  v_nick     text;
  v_empty    jsonb := jsonb_build_object(
                'email', null, 'name', null, 'nickname', null,
                'postings', '[]'::jsonb,
                'permissions', '[]'::jsonb, 'vs_depts', '[]'::jsonb,
                'project_seats', '[]'::jsonb, 'passport_scopes', '[]'::jsonb);
begin
  if v_uid is null then return v_empty; end if;
  select email into v_email from public.users where id = v_uid;
  -- NOTE `is null or length(btrim()) = 0` rather than a bare null check: a
  -- blank email would match `lower(kkumail) = ''` on any member row whose
  -- kkumail is the empty string, which is 10 live rows.
  if v_email is null or length(btrim(v_email)) = 0 then return v_empty; end if;

  for m in
    select * from public.team_members
     where lower(kkumail) = lower(btrim(v_email))
     order by created_at
  loop
    select * into v_node from public.team_nodes where id = m.node_id;
    if not found then continue; end if;      -- posting on a deleted ตำแหน่ง
    v_name := coalesce(v_name, nullif(btrim(coalesce(m.full_name, '')), ''));
    v_nick := coalesce(v_nick, nullif(btrim(coalesce(m.nickname,  '')), ''));
    v_postings := v_postings || jsonb_build_object(
      'node_id',  v_node.id,
      'node',     v_node.name,
      'path',     to_jsonb(public.team_node_path(v_node.id)),
      'is_board', coalesce(v_node.is_board, false),
      -- Per-posting, so a person holding two seats can see which one carries
      -- which ability rather than one merged pile.
      'permissions', to_jsonb((
        select coalesce(array_agg(distinct p), '{}') from unnest(
          coalesce(m.permissions, '{}') ||
          case when coalesce(m.inherit_permissions, true)
               then public.node_effective_permissions(v_node.id)
               else '{}'::text[] end
        ) as p)),
      'confirmed', coalesce(m.confirmed, false)
    );
  end loop;

  return jsonb_build_object(
    'email',           v_email,
    'name',            v_name,
    'nickname',        v_nick,
    'postings',        v_postings,
    -- The union, i.e. exactly what the RLS helpers will answer for this caller.
    'permissions',     to_jsonb(public.effective_team_permissions_for_email(v_email)),
    'vs_depts',        to_jsonb(public.effective_team_vs_depts_for_email(v_email)),
    'project_seats',   to_jsonb(public.effective_team_project_seats_for_email(v_email)),
    'passport_scopes', to_jsonb(public.effective_team_passport_scopes_for_email(v_email))
  );
end;
$$;

revoke all on function public.get_my_team_seat() from public;
-- Anon has no identity to resolve, and the passport schema's default ACLs have
-- burned us before (0010 hardening) — revoke explicitly, by name, not just
-- from PUBLIC.
revoke all on function public.get_my_team_seat() from anon;
grant execute on function public.get_my_team_seat() to authenticated;

comment on function public.get_my_team_seat() is
  'The CALLER''s own ทีม SAMO postings and effective grants. Takes no argument '
  'on purpose: identity comes from auth.uid(), so it cannot be used to probe '
  'another person''s address.';
