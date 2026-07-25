-- ============================================================
-- 0092 — หนังสือโครงการ seats: make a seat behave like the role it stands for,
--        and make an EXPLICIT seat beat an INHERITED one.
--
-- Reported symptom: "I gave myself หนังสือโครงการ as คณะ, but it shows many
-- new notifications / many updates — it should look like samomdkkuvpa."
-- Four separate defects behind it, three of which also bite the dedicated
-- sastaff / saprof accounts.
--
-- (A) An inherited WIDER seat silently overrode an explicitly chosen narrower
--     one. effective_team_project_seats_for_email() UNIONed the person's own
--     seat with everything inherited from their ตำแหน่ง, and the frontend
--     (projectSeatRole, SEAT_ORDER = vpa,staff,prof — "widest first") then
--     picked the widest. So a member under the `vpa` node who picks
--     "เจ้าหน้าที่คณะ" resolves to {staff,vpa} → vp_admin, and gets the
--     sender's see-everything inbox instead of the คณะ one. Proven live:
--     setting member.project_seat='staff' returned {staff,vpa}.
--     Same family as the 0083 VS lesson — a narrower grant added next to a
--     broad one is decorative until the broad one is made to yield.
--     FIX: nearest explicit seat wins. A person's own seat replaces
--     inheritance; walking up the tree stops at the first ตำแหน่ง that names
--     one. Union still happens ACROSS several team_members rows (genuinely
--     two postings), where SEAT_ORDER remains the tiebreak.
--
-- (B) project_sign_requests INSERT/UPDATE/DELETE were role-only
--     (`uni_staff`/`dev`), so a tree-granted `staff` seat could act on a
--     document but could NOT ส่งให้อาจารย์ลงนาม — the one thing เจ้าหน้าที่คณะ
--     exists to do. Proven live: the INSERT fails 42501 for a staff seat.
--     Third instance of the 0089/0090/0091 class; the rule in mistakes.md is
--     to enumerate EVERY table a feature writes, and this one was missed
--     because 0090 only looked at projects/project_documents.
--
-- (C) project_settings write was role-only (`vp_admin`/`dev`) — the `vpa` seat
--     opens การตั้งค่า and cannot save.
--
-- (D) REGRESSION FROM 0091, affecting the real saprof account in production:
--     list_project_seat_users() guards on current_user_is_project_actor(),
--     which is deliberately FALSE for a professor (0086 — a prof must not see
--     every project). But notifySignDecision() runs AS the professor and asks
--     for the staff + vpa audiences, so both came back EMPTY and the
--     professor's sign/reject notified nobody. It returns zero rows rather
--     than an error, so api.js's role-only fallback never fired either.
--     Proven live: as saprof, staff=0 vpa=0; as sastaff, staff=1 vpa=11.
--     FIX: admit a prof as a READER of the audience list (same predicate
--     project_settings_read already uses). Reading "who is the คณะ" is not
--     the same capability as being an actor, and the function still exposes
--     only id + display name.
-- ============================================================

-- ------------------------------------------------------------
-- A. Nearest explicit seat wins.
-- ------------------------------------------------------------

/** Walk up from p_node and return the FIRST ตำแหน่ง that names a seat.
 *  Nearest wins: a child that says "เจ้าหน้าที่คณะ" is not widened by a parent
 *  that says "ผู้ส่งหนังสือ". `inherit_permissions = false` still stops the walk. */
create or replace function public.node_effective_project_seats(p_node uuid)
returns text[] language plpgsql stable security definer set search_path = public as $$
declare
  v_cur  uuid := p_node;
  v_node public.team_nodes%rowtype;
  v_hops int := 0;
begin
  loop
    v_hops := v_hops + 1;
    exit when v_cur is null or v_hops > 100;
    select * into v_node from public.team_nodes where id = v_cur;
    exit when not found;
    -- First explicit seat on the chain is the answer.
    if v_node.project_seat is not null then
      return array[v_node.project_seat];
    end if;
    exit when not coalesce(v_node.inherit_permissions, true);
    v_cur := v_node.parent_id;
  end loop;
  return '{}';
end;
$$;

/** A person's own seat REPLACES what their ตำแหน่ง would have given them.
 *  Only when they haven't chosen one does inheritance apply. (Contrast
 *  permissions, which are genuinely additive — you can hold PR *and* inherit
 *  ประกาศ. A seat is a single role in one workflow; holding two is not a
 *  wider grant, it is an ambiguous one.) */
create or replace function public.effective_team_project_seats_for_email(p_email text)
returns text[] language plpgsql stable security definer set search_path = public as $$
declare
  v_out text[] := '{}';
  m     public.team_members%rowtype;
begin
  if p_email is null or length(btrim(p_email)) = 0 then
    return '{}';
  end if;
  for m in
    select * from public.team_members where lower(kkumail) = lower(btrim(p_email))
  loop
    if m.project_seat is not null then
      v_out := v_out || m.project_seat;                       -- explicit: stop here
    elsif coalesce(m.inherit_permissions, true) then
      v_out := v_out || public.node_effective_project_seats(m.node_id);
    end if;
  end loop;
  return (select coalesce(array_agg(distinct s), '{}') from unnest(v_out) as s);
end;
$$;

-- ------------------------------------------------------------
-- B. The `staff` seat may run the signature workflow.
--
--    Deliberately NOT current_user_is_project_actor() — that helper also
--    admits vpa, and the sender is not the one who requests a signature.
--    Mirror the existing role list exactly, plus the seat that stands for it.
-- ------------------------------------------------------------
create or replace function public.current_user_is_project_uni_staff()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.current_user_role() in ('uni_staff', 'dev'), false)
      or coalesce('staff' = any (public.current_user_project_seats()), false)
$$;

comment on function public.current_user_is_project_uni_staff() is
  'เจ้าหน้าที่คณะ by role OR by ทีม SAMO seat (0092). Use this — not a role '
  'list — in any policy that gates the uni_staff half of หนังสือโครงการ.';

revoke all on function public.current_user_is_project_uni_staff() from public;
grant execute on function public.current_user_is_project_uni_staff() to anon, authenticated;

drop policy if exists "project_sign_requests_insert" on public.project_sign_requests;
create policy "project_sign_requests_insert" on public.project_sign_requests
  for insert with check (public.current_user_is_project_uni_staff());

drop policy if exists "project_sign_requests_update" on public.project_sign_requests;
create policy "project_sign_requests_update" on public.project_sign_requests
  for update using (prof_id = auth.uid() or public.current_user_is_project_uni_staff());

drop policy if exists "project_sign_requests_delete" on public.project_sign_requests;
create policy "project_sign_requests_delete" on public.project_sign_requests
  for delete using (public.current_user_is_project_uni_staff());

-- ------------------------------------------------------------
-- C. The `vpa` seat may save settings, like the role it stands for.
-- ------------------------------------------------------------
drop policy if exists "project_settings_write" on public.project_settings;
create policy "project_settings_write" on public.project_settings
  for all
  using (coalesce(public.current_user_role() in ('vp_admin', 'dev'), false)
      or coalesce('vpa' = any (public.current_user_project_seats()), false))
  with check (coalesce(public.current_user_role() in ('vp_admin', 'dev'), false)
      or coalesce('vpa' = any (public.current_user_project_seats()), false));

-- ------------------------------------------------------------
-- D. A professor may RESOLVE an audience (so his signature notifies someone).
--     Still id + display_name only — no email leaves this function.
-- ------------------------------------------------------------
create or replace function public.list_project_seat_users(p_seat text)
returns table (id uuid, display_name text)
language sql stable security definer set search_path = public as $$
  select u.id,
         coalesce(nullif(btrim(u.display_name), ''),
                  nullif(btrim(u.username), ''),
                  'ผู้ใช้') as display_name
    from public.users u
   where (public.current_user_is_project_actor() or public.current_user_is_prof())
     and p_seat in ('vpa', 'staff', 'prof')
     and (
       u.role = case p_seat when 'vpa'  then 'vp_admin'
                            when 'staff' then 'uni_staff'
                            when 'prof'  then 'sa_prof' end
       or p_seat = any (coalesce(u.managed_project_seats, '{}'))
     )
   order by 2
$$;

revoke all on function public.list_project_seat_users(text) from public, anon;
grant execute on function public.list_project_seat_users(text) to authenticated;

-- ------------------------------------------------------------
-- E. Re-resolve everyone, so (A) takes effect without waiting for a tree edit.
-- ------------------------------------------------------------
do $$
declare
  u record;
begin
  perform set_config('app.team_sync', '1', true);
  for u in
    select id, email from public.users
     where email is not null
       and exists (select 1 from public.team_members tm where lower(tm.kkumail) = lower(users.email))
  loop
    update public.users
       set managed_project_seats = public.effective_team_project_seats_for_email(u.email)
     where id = u.id;
  end loop;
end $$;
