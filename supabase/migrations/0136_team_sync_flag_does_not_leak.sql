-- ============================================================
-- 0136 — the server-writer exemption stops leaking into the rest of the
--        transaction
--
-- FOUND BY A PROOF, not by a report. `tools/team0135-name-split.mjs` asks both
-- halves of the self-update guard: may a member edit their own ชื่อ (yes), and
-- may they edit an admin-owned column (no). The deny half came back **ALLOWED**.
--
-- WHAT IS ACTUALLY WRONG. `app.team_sync` is the documented server-writer
-- exemption (0081/0110): a definer function that must write a guarded column
-- while running with the member's own auth.uid() sets it, and
-- `team_members_self_update_guard` returns early when it sees '1'. A client
-- cannot set it, which is what makes it safe.
--
-- But two functions set it and never put it back:
--
--   recompute_team_managed_permissions()   — an AFTER STATEMENT trigger on
--                                            team_members
--   sync_my_team_permissions()             — called on every login
--
-- `set_config(..., is_local := true)` is TRANSACTION-scoped, not
-- statement-scoped, and a `SET search_path` clause does not save it back
-- either. So the flag survives the function that set it and stays '1' until
-- COMMIT. Measured, on a plain transaction:
--
--   before:                             (unset)
--   after ONE `update public.students`: 1        ← via the 0132/0133 mirrors,
--                                                  which write team_members
--                                                  and fire the recompute
--
-- From that point on, in that transaction, `team_members_self_update_guard` is
-- a no-op: the allow-list that stops a member rewriting their own `position`,
-- `node_id` or `permissions` simply does not run.
--
-- HOW BAD IS IT TODAY. Not exploitable through PostgREST as it stands, and the
-- reason is luck rather than design: each request is its own transaction and a
-- PATCH is one statement, and within one statement the BEFORE ROW guard fires
-- before the AFTER STATEMENT recompute that would have disabled it. What that
-- means is that the protection currently rests on nobody ever putting two
-- statements in one transaction — a definer RPC that touches `students` and
-- then updates `team_members`, say, which is a completely ordinary thing to
-- write and is exactly what `update_my_identity` already does.
--
-- This is the fail-open class (mistakes class 2) wearing a different coat: an
-- unresolvable-or-stale reference answering "allowed". A bypass flag must be
-- scoped to the thing that needs it, so:
--
-- THE FIX. Save the previous value, set '1', restore. `set_config` returns the
-- new value and a plain local variable survives the loop, so this is three
-- lines per function and no behaviour change for the callers.
--
-- Both bodies rebuilt from the LIVE definitions (`pg_get_functiondef`), never
-- from the migrations that first defined them — 0093/0094 and several others
-- have edited these since, and recreating from the original would silently
-- revert all of it.
-- ============================================================

create or replace function public.recompute_team_managed_permissions()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  u          record;
  v_perms    text[];
  v_vs_depts text[];
  v_seats    text[];
  v_passport text[];
  v_shop     text[];
  -- The value to put back. NOT a boolean "did I set it": a nested caller may
  -- legitimately already be inside the exemption, and clobbering it to '' on
  -- the way out would re-arm the guard underneath a writer that still needs it.
  v_prev     text := coalesce(current_setting('app.team_sync', true), '');
begin
  perform set_config('app.team_sync', '1', true);
  for u in
    select id, email
      from public.users
     where email is not null
       and ( managed_permissions     <> '{}'
          or managed_vs_depts        <> '{}'
          or managed_project_seats   <> '{}'
          or managed_passport_scopes <> '{}'
          or managed_shop_sources    <> '{}'
          or exists (select 1 from public.team_members tm
                      where lower(tm.kkumail) = lower(users.email)) )
  loop
    v_perms    := public.effective_team_permissions_for_email(u.email);
    v_vs_depts := public.effective_team_vs_depts_for_email(u.email);
    v_seats    := public.effective_team_project_seats_for_email(u.email);
    v_passport := public.effective_team_passport_scopes_for_email(u.email);
    v_shop     := public.effective_team_shop_sources_for_email(u.email);
    update public.users
       set managed_permissions     = v_perms,
           managed_vs_depts        = v_vs_depts,
           managed_project_seats   = v_seats,
           managed_passport_scopes = v_passport,
           managed_shop_sources    = v_shop
     where id = u.id
       and (managed_permissions     is distinct from v_perms
         or managed_vs_depts        is distinct from v_vs_depts
         or managed_project_seats   is distinct from v_seats
         or managed_passport_scopes is distinct from v_passport
         or managed_shop_sources    is distinct from v_shop);
  end loop;
  perform set_config('app.team_sync', v_prev, true);
  return null;
end;
$$;

create or replace function public.sync_my_team_permissions()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid       uuid := auth.uid();
  v_email     text;
  v_perms     text[];
  v_vs_depts  text[];
  v_seats     text[];
  v_passport  text[];
  v_shop      text[];
  v_prev      text := coalesce(current_setting('app.team_sync', true), '');
  v_empty     jsonb := jsonb_build_object(
                'permissions', '[]'::jsonb, 'vs_depts', '[]'::jsonb,
                'project_seats', '[]'::jsonb, 'passport_scopes', '[]'::jsonb,
                'shop_sources', '[]'::jsonb);
begin
  if v_uid is null then return v_empty; end if;
  select email into v_email from public.users where id = v_uid;
  if v_email is null then return v_empty; end if;

  v_perms    := public.effective_team_permissions_for_email(v_email);
  v_vs_depts := public.effective_team_vs_depts_for_email(v_email);
  v_seats    := public.effective_team_project_seats_for_email(v_email);
  v_passport := public.effective_team_passport_scopes_for_email(v_email);
  v_shop     := public.effective_team_shop_sources_for_email(v_email);

  perform set_config('app.team_sync', '1', true);

  update public.team_members
     set user_id = v_uid
   where lower(kkumail) = lower(v_email)
     and user_id is distinct from v_uid;

  update public.users
     set managed_permissions     = v_perms,
         managed_vs_depts        = v_vs_depts,
         managed_project_seats   = v_seats,
         managed_passport_scopes = v_passport,
         managed_shop_sources    = v_shop
   where id = v_uid
     and (managed_permissions     is distinct from v_perms
       or managed_vs_depts        is distinct from v_vs_depts
       or managed_project_seats   is distinct from v_seats
       or managed_passport_scopes is distinct from v_passport
       or managed_shop_sources    is distinct from v_shop);

  -- Put it back BEFORE the return, or the early-return paths above and this one
  -- disagree about what the caller is left holding.
  perform set_config('app.team_sync', v_prev, true);

  return jsonb_build_object(
    'permissions',     to_jsonb(v_perms),
    'vs_depts',        to_jsonb(v_vs_depts),
    'project_seats',   to_jsonb(v_seats),
    'passport_scopes', to_jsonb(v_passport),
    'shop_sources',    to_jsonb(v_shop)
  );
end;
$$;

-- `update_my_identity` (0135 §5) already restores it — it sets '' rather than
-- the previous value, which is correct there because it is only ever called at
-- the top of a request and never from inside another exemption. Left alone so
-- this migration is exactly two functions.

comment on function public.recompute_team_managed_permissions() is
  'Recomputes users.managed_* from the ทีม SAMO tree. Sets the app.team_sync '
  'server-writer exemption and RESTORES IT (0136) — it used to leave it set '
  'for the whole transaction, which turned team_members_self_update_guard off '
  'for every later statement in that transaction.';
comment on function public.sync_my_team_permissions() is
  'Login-time permission sync. Restores app.team_sync on exit (0136); see '
  'recompute_team_managed_permissions.';
