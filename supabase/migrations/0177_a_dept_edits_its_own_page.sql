-- ============================================================
-- 0177 — a ฝ่าย edits its OWN page, with no commit and no deploy.
--
-- THE PROBLEM THIS CLOSES. Every ฝ่าย page's content lived in `DEPT_DEFS`, a
-- hardcoded object in src/js/departments.js: six ฝ่าย, of which exactly ONE
-- had any content (four cards, typed into JS). Changing a link, a title or a
-- cover image was a commit plus a deploy by the owner. That is the bottleneck
-- docs/DEPT-TOOLS.md exists to remove, and §12 named this migration in advance:
--
--   "Content is DATA. Tools are CODE. …If instead cards stay hardcoded in
--    departments.js, the editor's first task is un-hardcoding them."
--
-- So this un-hardcodes them.
--
-- TWO KINDS OF CONTENT, ON PURPOSE:
--   'card' — structured. Title, link, cover. What most ฝ่าย need, editable in
--            a form by someone who has never seen HTML.
--   'html' — a ฝ่าย that wants to design its own page writes HTML and it is
--            rendered VERBATIM, inside the same sandboxed frame that Lane B
--            tools use (src/js/tool-frame.js, docs/DEPT-TOOLS.md §3).
--
-- ⛔ WHY THE HTML IS NOT SANITISED, AND MUST NOT BE. It is rendered into an
-- iframe with `sandbox` and NO `allow-same-origin`, i.e. an opaque origin: it
-- cannot read the session, the parent DOM, cookies or localStorage. Isolation
-- is a property of the container; sanitising is a guess about the content, and
-- an HTML sanitiser is a permanent losing race. If anybody ever "improves" this
-- by rendering a row's html into the page directly, THAT is the vulnerability —
-- not the absence of a filter. Guarded by dept-content.test.js.
--
-- ⚠️ WHAT THE SANDBOX DOES NOT STOP, so it is written down rather than
-- discovered: an editor can still publish a convincing FAKE sign-in form on a
-- real samo.md.kku.ac.th page. The frame cannot read the real session, but a
-- reader can be persuaded to type into it. The controls are that editing is a
-- granted capability held by known staff, and that every row records
-- `updated_by`. Consider that before widening the grant.
--
-- THE GRANT — a SIXTH scope dimension, mirroring vs_dept exactly (0082/0083).
--
-- ⛔ THE TRAP THAT KILLED THE FIRST VS SCOPE (docs/mistakes/authz-grants.md):
-- a narrowing scope added ALONGSIDE an unconditional permission is DEAD,
-- because permissive policies are OR'd and the broad grant always wins. So the
-- blanket key and the per-ฝ่าย list are EXCLUSIVE by construction, exactly as
-- `current_user_vs_scope()` does it: `dept_pages` (or vp_admin/dev/master)
-- ⇒ NULL, meaning every ฝ่าย; otherwise the explicit list; `{}` = no access.
-- One fail-closed predicate, asked by every surface.
--
-- Class 5 says a new access channel must be threaded through EVERY gate the
-- old one used. The five it touches are named at each site below:
--   node_effective_* · effective_team_*_for_email · sync_my_team_permissions
--   · recompute_team_managed_permissions · users_self_update_guard
-- ============================================================

-- ------------------------------------------------------------
-- 1. The content itself.
-- ------------------------------------------------------------
create table if not exists public.dept_content (
  id          uuid primary key default gen_random_uuid(),
  -- A DEPT_DEFS key ('admin', 'digital', …). Deliberately NOT a check
  -- constraint listing them: a hardcoded list in a migration rots the day a
  -- ฝ่าย is added, and this repo has paid for guards whose subject rotted.
  -- The set is asserted against the app's own list by dept-content.test.js and
  -- by tools/dept0177-page-scope.sql, which read DEPT_DEFS rather than a copy.
  dept        text        not null,
  kind        text        not null check (kind in ('card', 'html')),
  position    integer     not null default 0,
  visible     boolean     not null default true,

  -- kind='card'
  title       text,
  eyebrow     text,
  description text,
  href        text,
  cover_url   text,
  video_url   text,
  cta         text,

  -- kind='html' — rendered verbatim into a sandboxed frame. See the ⛔ above.
  html        text,

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  updated_by  uuid references public.users(id) on delete set null,

  -- A row must actually carry what its kind renders, or it is an invisible
  -- blank on a public page that nobody can explain.
  constraint dept_content_has_body check (
    (kind = 'card' and title is not null and length(btrim(title)) > 0)
    or (kind = 'html' and html is not null and length(btrim(html)) > 0)
  )
);

create index if not exists dept_content_dept_pos_idx
  on public.dept_content (dept, position, created_at);

comment on table public.dept_content is
  'Per-ฝ่าย page content, editable in the app by whoever holds that ฝ่าย''s '
  'page grant. Replaces the hardcoded DEPT_DEFS.cards. kind=html is rendered '
  'in a sandboxed opaque-origin frame and is deliberately NOT sanitised — see '
  'migration 0177.';

create or replace function public.dept_content_touch()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$;

drop trigger if exists dept_content_touch on public.dept_content;
create trigger dept_content_touch
  before insert or update on public.dept_content
  for each row execute function public.dept_content_touch();

-- ------------------------------------------------------------
-- 2. The grant dimension.
-- ------------------------------------------------------------
alter table public.team_nodes   add column if not exists dept_page text;
alter table public.team_members add column if not exists dept_page text;
alter table public.users        add column if not exists managed_dept_pages text[] not null default '{}';

comment on column public.team_nodes.dept_page is
  'A DEPT_DEFS key. Whoever sits at or under this node may edit that ฝ่าย page.';
comment on column public.users.managed_dept_pages is
  'Server-managed, resolved from the ทีม SAMO tree. Never write it from a client.';

create or replace function public.node_effective_dept_pages(p_node uuid)
returns text[] language plpgsql stable security definer set search_path = public as $$
declare
  v_out  text[] := '{}';
  v_cur  uuid := p_node;
  v_node public.team_nodes%rowtype;
  v_hops int := 0;
begin
  loop
    v_hops := v_hops + 1;
    -- The hop ceiling is not defensive dressing: a parent_id cycle introduced
    -- by an editor would otherwise hang every login. Same bound as its four
    -- siblings.
    exit when v_cur is null or v_hops > 100;
    select * into v_node from public.team_nodes where id = v_cur;
    exit when not found;
    if v_node.dept_page is not null and length(btrim(v_node.dept_page)) > 0 then
      v_out := v_out || array[btrim(v_node.dept_page)];
    end if;
    exit when not coalesce(v_node.inherit_permissions, true);
    v_cur := v_node.parent_id;
  end loop;
  return v_out;
end;
$$;

create or replace function public.effective_team_dept_pages_for_email(p_email text)
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
    if m.dept_page is not null and length(btrim(m.dept_page)) > 0 then
      v_out := v_out || array[btrim(m.dept_page)];
    end if;
    if coalesce(m.inherit_permissions, true) then
      v_out := v_out || public.node_effective_dept_pages(m.node_id);
    end if;
  end loop;
  return (select coalesce(array_agg(distinct t), '{}') from unnest(v_out) as t);
end;
$$;

-- ⚠️ ADDITIVE, and that is the right call here — unlike `project_seat`, which
-- 0092 had to make EXCLUSIVE. A seat is one role in one workflow, so two seats
-- is ambiguous; a page grant is a set of pages, so holding two is simply
-- holding two. Decide this before making any dimension inheritable.

create or replace function public.current_user_dept_pages()
returns text[] language sql stable security definer set search_path = public as $$
  select coalesce(
    (select coalesce(u.managed_dept_pages, '{}') from public.users u where u.id = auth.uid()),
    '{}'
  )
$$;

-- THE ONE PREDICATE every surface asks.
--   null = every ฝ่าย   ·   '{}' = none   ·   else exactly these
create or replace function public.current_user_dept_page_scope()
returns text[] language sql stable security definer set search_path = public as $$
  select case
    when public.current_user_role() in ('vp_admin', 'dev')
      or public.current_user_has_permission('dept_pages')
    then null::text[]
    else (
      select coalesce(array_agg(distinct d), '{}')
        from unnest(public.current_user_dept_pages()) as d
       where d is not null and length(btrim(d)) > 0
    )
  end
$$;

comment on function public.current_user_dept_page_scope() is
  'NULL = all ฝ่าย, {} = none, else the ฝ่าย this account may edit. The blanket '
  'key and the per-ฝ่าย list are EXCLUSIVE — see 0083, where a narrowing scope '
  'beside an unconditional permission was dead on arrival.';

revoke all on function public.current_user_dept_pages()      from public, anon;
revoke all on function public.current_user_dept_page_scope() from public, anon;
grant execute on function public.current_user_dept_pages()      to authenticated;
grant execute on function public.current_user_dept_page_scope() to authenticated;

-- ------------------------------------------------------------
-- 3. Thread the dimension through the three functions that carry the other
--    five. Each is restated IN FULL from its LIVE body (read with
--    pg_get_functiondef, not from the migration that first defined it — the
--    live guard already carried `managed_shop_sources`, which 0087's text does
--    not). Missing one of these is class 5: the grant resolves at login and is
--    then silently wiped by the next recompute, or vice versa.
-- ------------------------------------------------------------
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
  v_pages     text[];
  v_prev      text := coalesce(current_setting('app.team_sync', true), '');
  v_empty     jsonb := jsonb_build_object(
                'permissions', '[]'::jsonb, 'vs_depts', '[]'::jsonb,
                'project_seats', '[]'::jsonb, 'passport_scopes', '[]'::jsonb,
                'shop_sources', '[]'::jsonb, 'dept_pages', '[]'::jsonb);
begin
  if v_uid is null then return v_empty; end if;
  select email into v_email from public.users where id = v_uid;
  if v_email is null then return v_empty; end if;

  v_perms    := public.effective_team_permissions_for_email(v_email);
  v_vs_depts := public.effective_team_vs_depts_for_email(v_email);
  v_seats    := public.effective_team_project_seats_for_email(v_email);
  v_passport := public.effective_team_passport_scopes_for_email(v_email);
  v_shop     := public.effective_team_shop_sources_for_email(v_email);
  v_pages    := public.effective_team_dept_pages_for_email(v_email);

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
         managed_shop_sources    = v_shop,
         managed_dept_pages      = v_pages
   where id = v_uid
     and (managed_permissions     is distinct from v_perms
       or managed_vs_depts        is distinct from v_vs_depts
       or managed_project_seats   is distinct from v_seats
       or managed_passport_scopes is distinct from v_passport
       or managed_shop_sources    is distinct from v_shop
       or managed_dept_pages      is distinct from v_pages);

  -- Put it back BEFORE the return, or the early-return paths above and this one
  -- disagree about what the caller is left holding.
  perform set_config('app.team_sync', v_prev, true);

  return jsonb_build_object(
    'permissions',     to_jsonb(v_perms),
    'vs_depts',        to_jsonb(v_vs_depts),
    'project_seats',   to_jsonb(v_seats),
    'passport_scopes', to_jsonb(v_passport),
    'shop_sources',    to_jsonb(v_shop),
    'dept_pages',      to_jsonb(v_pages)
  );
end;
$$;

grant execute on function public.sync_my_team_permissions() to authenticated;

create or replace function public.recompute_team_managed_permissions()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  u          record;
  v_perms    text[];
  v_vs_depts text[];
  v_seats    text[];
  v_passport text[];
  v_shop     text[];
  v_pages    text[];
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
          or managed_dept_pages      <> '{}'
          or exists (select 1 from public.team_members tm
                      where lower(tm.kkumail) = lower(users.email)) )
  loop
    v_perms    := public.effective_team_permissions_for_email(u.email);
    v_vs_depts := public.effective_team_vs_depts_for_email(u.email);
    v_seats    := public.effective_team_project_seats_for_email(u.email);
    v_passport := public.effective_team_passport_scopes_for_email(u.email);
    v_shop     := public.effective_team_shop_sources_for_email(u.email);
    v_pages    := public.effective_team_dept_pages_for_email(u.email);
    update public.users
       set managed_permissions     = v_perms,
           managed_vs_depts        = v_vs_depts,
           managed_project_seats   = v_seats,
           managed_passport_scopes = v_passport,
           managed_shop_sources    = v_shop,
           managed_dept_pages      = v_pages
     where id = u.id
       and (managed_permissions     is distinct from v_perms
         or managed_vs_depts        is distinct from v_vs_depts
         or managed_project_seats   is distinct from v_seats
         or managed_passport_scopes is distinct from v_passport
         or managed_shop_sources    is distinct from v_shop
         or managed_dept_pages      is distinct from v_pages);
  end loop;
  perform set_config('app.team_sync', v_prev, true);
  return null;
end;
$$;

create or replace function public.users_self_update_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  is_staff boolean := public.current_user_is_staff();
begin
  if is_staff then
    return new;
  end if;

  if new.id is distinct from old.id then
    raise exception 'users_self_update_guard: id is immutable';
  end if;
  if new.role is distinct from old.role then
    raise exception 'users_self_update_guard: role can only be changed by staff';
  end if;
  if new.permissions is distinct from old.permissions then
    raise exception 'users_self_update_guard: permissions can only be changed by staff';
  end if;

  if new.managed_permissions is distinct from old.managed_permissions
     or new.managed_vs_depts is distinct from old.managed_vs_depts
     or new.managed_project_seats is distinct from old.managed_project_seats
     or new.managed_passport_scopes is distinct from old.managed_passport_scopes
     or new.managed_shop_sources is distinct from old.managed_shop_sources
     or new.managed_dept_pages is distinct from old.managed_dept_pages then
    if coalesce(current_setting('app.team_sync', true), '') <> '1' then
      raise exception 'users_self_update_guard: tree-managed columns are server-managed';
    end if;
  end if;

  if new.method is distinct from old.method then
    raise exception 'users_self_update_guard: method can only be changed by staff';
  end if;
  if new.has_password is distinct from old.has_password then
    if new.has_password is distinct from exists (
         select 1 from auth.users au
          where au.id = new.id and au.encrypted_password is not null
       ) then
      raise exception 'users_self_update_guard: has_password is server-managed';
    end if;
  end if;
  if old.username is not null and new.username is distinct from old.username then
    raise exception 'users_self_update_guard: username can only be set once';
  end if;

  return new;
end;
$$;

-- ------------------------------------------------------------
-- 4. RLS. Both directions, and the GRANT that makes them mean anything.
--
-- ⚠️ A table with policies and no GRANT denies everyone, and reads exactly like
-- the policy working (0138). The grants come first, on purpose.
-- ------------------------------------------------------------
alter table public.dept_content enable row level security;

grant select on public.dept_content to anon, authenticated;
grant insert, update, delete on public.dept_content to authenticated;

-- ⚠️ AND TAKE BACK WHAT SUPABASE HANDS OUT BY DEFAULT. Measured on samo-dev:
-- an anonymous insert was refused with a ROW-LEVEL failure, not "permission
-- denied" — because Supabase's default privileges on `public` already give
-- `anon` insert/update/delete on every new table. The table was safe (no
-- policy admits anon, so nothing matched), but its only defence was RLS. One
-- permissive policy written later without `to authenticated` would open writes
-- to the whole internet, and nothing here would have said so.
revoke insert, update, delete on public.dept_content from anon;

drop policy if exists dept_content_read_public on public.dept_content;
drop policy if exists dept_content_read_editor on public.dept_content;
drop policy if exists dept_content_insert      on public.dept_content;
drop policy if exists dept_content_update      on public.dept_content;
drop policy if exists dept_content_delete      on public.dept_content;

-- READ. A ฝ่าย page is public — that is the point of it.
create policy dept_content_read_public on public.dept_content
  for select to anon, authenticated
  using (visible = true);

-- An editor also sees their own ฝ่าย's HIDDEN rows, or "ซ่อนไว้ก่อน" would mean
-- "deleted, and you cannot get it back".
create policy dept_content_read_editor on public.dept_content
  for select to authenticated
  using (
    public.current_user_dept_page_scope() is null
    or dept = any(public.current_user_dept_page_scope())
  );

create policy dept_content_insert on public.dept_content
  for insert to authenticated
  with check (
    public.current_user_dept_page_scope() is null
    or dept = any(public.current_user_dept_page_scope())
  );

-- ⛔ BOTH `using` AND `with check`. A per-row UPDATE policy gates WHICH ROW and
-- then hands over every column in it (class 1) — including `dept`, so without a
-- check on the NEW row an editor scoped to ฝ่ายวิชาการ could take one of their
-- own rows and set dept='admin', landing their content on another ฝ่าย's page.
--
-- ⚠️ Writing it out is belt-and-braces, not the mechanism, and the first draft
-- of this comment said otherwise: Postgres reuses the USING expression as the
-- check when WITH CHECK is omitted, so `using` alone is already safe here. The
-- real hazard is a check that is WEAKER than the using — which is exactly what
-- someone adds when they want to allow one extra case. Stating it explicitly
-- means the weakening is visible in the diff, and
-- tools/dept0177-page-scope.sql §30 goes red for it.
create policy dept_content_update on public.dept_content
  for update to authenticated
  using (
    public.current_user_dept_page_scope() is null
    or dept = any(public.current_user_dept_page_scope())
  )
  with check (
    public.current_user_dept_page_scope() is null
    or dept = any(public.current_user_dept_page_scope())
  );

create policy dept_content_delete on public.dept_content
  for delete to authenticated
  using (
    public.current_user_dept_page_scope() is null
    or dept = any(public.current_user_dept_page_scope())
  );

-- ------------------------------------------------------------
-- 5. Move the hardcoded cards in, so nothing on the live site changes shape.
--
-- These four are ฝ่ายบริหารองค์กร's, and they were the ONLY content any ฝ่าย
-- page had. Idempotent on href so re-running cannot double them.
-- ------------------------------------------------------------
insert into public.dept_content (dept, kind, position, eyebrow, title, description, href, cover_url, video_url, cta)
select v.dept, 'card', v.position, v.eyebrow, v.title, v.description, v.href, v.cover_url, v.video_url, v.cta
  from (values
    ('admin', 10, 'Guidebook', 'Guidebook เหรัญญิก SAMO69', null::text,
     'https://canva.link/vjavei9c6thy5wl', '/dept-admin/treasurer-guidebook.png', null::text, 'เปิดใน Canva'),
    ('admin', 20, 'Guidebook', 'Guidebook ฝ่ายเอกสาร SAMO69', null,
     'https://canva.link/hlmz649y2e7se85', '/dept-admin/document-guidebook.png', null, 'เปิดใน Canva'),
    ('admin', 30, 'Workflow', 'Project Workflow SAMO69', null,
     'https://canva.link/1ej1lt111zjy079', null, '/dept-admin/project-workflow.mp4', 'เปิดใน Canva'),
    ('admin', 40, 'Google Form', 'Project 1st Step SAMO69', 'Google form แจ้งการทำโครงการ',
     'https://docs.google.com/forms/d/e/1FAIpQLSc2J4O7sUcUYjNpPeFhbRZMreIBaAAVggUS7U0oFMX7KF_fxQ/viewform?pli=1',
     '/dept-admin/project-1st-step.png', null, 'เปิดฟอร์ม')
  ) as v(dept, position, eyebrow, title, description, href, cover_url, video_url, cta)
 where not exists (
   select 1 from public.dept_content d where d.dept = v.dept and d.href = v.href
 );

-- ------------------------------------------------------------
-- 6. Backfill the new scope for everyone who already has a tree row, so the
--    column is not empty until each person's next login.
-- ------------------------------------------------------------
do $$
begin
  perform set_config('app.team_sync', '1', true);
  update public.users u
     set managed_dept_pages = public.effective_team_dept_pages_for_email(u.email)
   where u.email is not null
     and u.managed_dept_pages is distinct from public.effective_team_dept_pages_for_email(u.email);
  perform set_config('app.team_sync', '', true);
end $$;
