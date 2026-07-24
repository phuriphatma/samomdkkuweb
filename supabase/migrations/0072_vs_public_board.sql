-- ============================================================
-- 0072 — VitalSound Phase 2: public "Problem" board + me-too + comments
--
-- Turns VS from a black-box intake into a help-desk-style system with a
-- CURATED public board. A "Problem" IS a 0068 canonical vs_ticket; its
-- duplicates are the individual private reports. Many reports collapse to one
-- public card with a 👥 me-too counter, and (for non-confidential categories)
-- a public discussion thread.
--
-- LOAD-BEARING SECURITY INVARIANTS (public board = new world-readable surface):
--   1. vs_tickets is NOT world-readable (no using(true) SELECT policy). Every
--      public read goes through a SECURITY DEFINER RPC that returns ONLY a
--      curated column list (public_title, category, phase, counts) — NEVER the
--      raw `problem`, submitter identity, `remarks`, or `duplicate_of`.
--   2. SE writes `public_title` (vs_set_public). A student's raw report is
--      never auto-published verbatim.
--   3. Confidential categories are hard-blocked from is_public at the DB layer
--      AND excluded from the public board / public search.
--
-- Reuses: current_user_role/_is_staff/_has_permission/_dept, touch_updated_at,
-- and the 4-phase mapping shipped client-side in vs-tracking.js (mirrored here
-- as vs_public_phase so the public surface never leaks the 9 internal statuses).
--
-- Apply via tools/apply-migration.mjs (Management API + PAT). Idempotent:
-- drop-policy-before-create, add-column-if-not-exists, seed on-conflict.
-- ============================================================

-- ============================================================
-- 1) CATEGORIES — admin-managed reference table (mirrors shop_product_types).
--    is_confidential  → sensitive lane: never public, never on the board.
--    public_eligible  → may be published to the board by SE.
--    vs_tickets.category stays loose text (no hard FK) so removing a category
--    never breaks an existing ticket (same choice as shop_products.type).
-- ============================================================

create table if not exists public.vs_categories (
  id               text primary key,               -- e.g. 'facilities'
  label            text not null,
  icon             text not null default 'bi-tag', -- bootstrap-icon class
  is_confidential  boolean not null default false, -- sensitive; never public
  public_eligible  boolean not null default true,  -- may be board-published
  sort_order       integer not null default 100,
  is_active        boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists vs_categories_active_idx
  on public.vs_categories (is_active, sort_order);

-- Seed the 6 from the design mockup. เรื่องส่วนตัว/ร้องเรียนบุคคล is the
-- confidential lane (never public, never fingerprinted for the board).
insert into public.vs_categories (id, label, icon, is_confidential, public_eligible, sort_order) values
  ('facilities',   'อาคารสถานที่',              'bi-building',        false, true,  10),
  ('amenities',    'สิ่งอำนวยความสะดวก',        'bi-cup-hot',        false, true,  20),
  ('it',           'IT / เครือข่าย',            'bi-wifi',           false, true,  30),
  ('curriculum',   'หลักสูตร',                  'bi-mortarboard',    false, true,  40),
  ('suggestion',   'ข้อเสนอแนะ',                'bi-lightbulb',      false, true,  50),
  ('personal',     'เรื่องส่วนตัว / ร้องเรียนบุคคล', 'bi-shield-lock',  true,  false, 60)
on conflict (id) do nothing;

drop trigger if exists touch_vs_categories_updated_at on public.vs_categories;
create trigger touch_vs_categories_updated_at
  before update on public.vs_categories
  for each row execute function public.touch_updated_at();

-- Categories are non-secret metadata (they drive the public board filter), so
-- readable by anyone; writable by VS staff only.
alter table public.vs_categories enable row level security;

drop policy if exists vs_categories_read_all on public.vs_categories;
create policy vs_categories_read_all on public.vs_categories
  for select to anon, authenticated using (true);

drop policy if exists vs_categories_write_staff on public.vs_categories;
create policy vs_categories_write_staff on public.vs_categories
  for all to authenticated
  using (
    public.current_user_role() in ('vs_staff', 'dev')
    or public.current_user_has_permission('vs')
  )
  with check (
    public.current_user_role() in ('vs_staff', 'dev')
    or public.current_user_has_permission('vs')
  );

-- ============================================================
-- 2) vs_tickets — public-projection columns (SE-set, canonicals only).
--    category also drives eligibility + confidential exclusion.
-- ============================================================

alter table public.vs_tickets
  add column if not exists category    text,
  add column if not exists is_public   boolean not null default false,
  add column if not exists public_title text,
  add column if not exists public_note  text;

comment on column public.vs_tickets.is_public is
  'SE-published to the public board (0072). Only canonicals (duplicate_of is null), never a confidential category.';
comment on column public.vs_tickets.public_title is
  'SE-written public headline (0072). The student raw `problem` is NEVER published verbatim.';

create index if not exists vs_tickets_public_idx
  on public.vs_tickets (is_public) where is_public = true;

-- ============================================================
-- 3) vs_followers — the "me too / +1". PK(canonical, user) dedups per student.
--    No direct table access: all reads/writes via the definer RPCs below.
-- ============================================================

create table if not exists public.vs_followers (
  canonical_id text not null references public.vs_tickets(id) on delete cascade,
  user_id      uuid not null references public.users(id) on delete cascade,
  created_at   timestamptz not null default now(),
  primary key (canonical_id, user_id)
);

create index if not exists vs_followers_user_idx on public.vs_followers (user_id);

alter table public.vs_followers enable row level security;
-- Staff may read the raw follow rows (dept dashboards); everyone else goes
-- through the RPCs. No anon/self policy => direct anon/authenticated select
-- returns nothing, but the SECURITY DEFINER RPCs still work.
drop policy if exists vs_followers_read_staff on public.vs_followers;
create policy vs_followers_read_staff on public.vs_followers
  for select to authenticated using (public.current_user_is_staff());

-- ============================================================
-- 4) vs_public_comments — public discussion on a canonical Problem.
--    author_user_id is the REAL author (staff-visible); the public RPC renders
--    a stable pseudonymous alias. `hidden` is staff moderation (soft-hide).
--    char_length caps bound the anon/kkumail-writable text (cf. notify_log 0055).
-- ============================================================

create table if not exists public.vs_public_comments (
  id             uuid primary key default gen_random_uuid(),
  canonical_id   text not null references public.vs_tickets(id) on delete cascade,
  author_user_id uuid not null references public.users(id) on delete cascade,
  is_staff       boolean not null default false,
  body           text not null,
  hidden         boolean not null default false,
  hidden_by      uuid references public.users(id) on delete set null,
  hidden_at      timestamptz,
  created_at     timestamptz not null default now(),
  constraint vs_public_comments_body_len check (char_length(body) between 1 and 2000)
);

-- Idempotent fix for tables already created by an earlier run of this file:
-- author_user_id must be ON DELETE CASCADE (a NOT NULL column can't be SET NULL,
-- so a user delete would otherwise fail). No-op when already cascade.
alter table public.vs_public_comments
  drop constraint if exists vs_public_comments_author_user_id_fkey;
alter table public.vs_public_comments
  add constraint vs_public_comments_author_user_id_fkey
  foreign key (author_user_id) references public.users(id) on delete cascade;

create index if not exists vs_public_comments_canon_idx
  on public.vs_public_comments (canonical_id, created_at);

alter table public.vs_public_comments enable row level security;
-- Staff read raw (see hidden + real author for moderation); public goes via RPC.
drop policy if exists vs_public_comments_read_staff on public.vs_public_comments;
create policy vs_public_comments_read_staff on public.vs_public_comments
  for select to authenticated using (public.current_user_is_staff());

-- ============================================================
-- 5) PHASE HELPER — mirrors vsPhaseIndex() in vs-tracking.js. The public
--    surface returns ONLY this 0..3 phase, never the raw 9 internal statuses.
-- ============================================================

create or replace function public.vs_public_phase(p_status text)
returns integer
language sql
immutable
as $$
  select case
    when p_status is null then 0
    when p_status like '%เสร็จสิ้น%' then 3
    when p_status like '%ดำเนินการ%' or p_status like '%ติดต่อคณะ%' then 2
    when p_status like '%SE รับเรื่องแล้ว%' or p_status like '%อุปนายก%' or p_status like '%ปฏิเสธ%' then 1
    else 0
  end;
$$;

-- ============================================================
-- 6) PUBLIC READ RPCs (anon + authenticated). Curated projection ONLY.
--    A confidential category can never appear (defense-in-depth: is_public is
--    already gated in vs_set_public, and we re-exclude confidential here).
-- ============================================================

-- get_public_vs_board — the board. sort: 'hot' (most affected) | 'new' | 'active'.
-- (drop first: adding the `following` OUT column changes the row type.)
drop function if exists public.get_public_vs_board(text, text, integer);
create or replace function public.get_public_vs_board(
  p_category text default null,
  p_sort     text default 'hot',
  p_limit    integer default 60
)
returns table (
  canonical_id text,
  public_title text,
  public_note  text,
  category     text,
  cat_label    text,
  cat_icon     text,
  phase        integer,
  is_resolved  boolean,
  affected     bigint,
  comment_count bigint,
  following    boolean,
  created_at   timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select t.id,
         t.public_title,
         t.public_note,
         t.category,
         c.label,
         c.icon,
         public.vs_public_phase(t.status),
         (t.status like '%เสร็จสิ้น%'),
         -- affected = the canonical (1) + its non-deleted duplicates + me-too
         -- followers who are not already a duplicate-submitter. Kept simple:
         -- 1 + duplicates + followers (small double-count if a follower also
         -- submitted a dup is acceptable for a "how many feel this" signal).
         1
           + (select count(*) from public.vs_tickets d
                where d.duplicate_of = t.id and d.deleted_at is null)
           + (select count(*) from public.vs_followers f where f.canonical_id = t.id),
         (select count(*) from public.vs_public_comments m
            where m.canonical_id = t.id and m.hidden = false),
         (auth.uid() is not null and exists (
            select 1 from public.vs_followers f2
             where f2.canonical_id = t.id and f2.user_id = auth.uid())),
         coalesce(t.created_at, t.timestamp)
  from public.vs_tickets t
  join public.vs_categories c on c.id = t.category
  where t.is_public = true
    and t.deleted_at is null
    and t.duplicate_of is null
    and c.is_confidential = false
    and (p_category is null or t.category = p_category)
  order by
    case when p_sort = 'new' then coalesce(t.created_at, t.timestamp) end desc nulls last,
    case when p_sort = 'active' then (
      select max(m.created_at) from public.vs_public_comments m
       where m.canonical_id = t.id and m.hidden = false
    ) end desc nulls last,
    -- default 'hot' = most affected, unresolved first
    (t.status like '%เสร็จสิ้น%'),
    (1
      + (select count(*) from public.vs_tickets d
           where d.duplicate_of = t.id and d.deleted_at is null)
      + (select count(*) from public.vs_followers f where f.canonical_id = t.id)) desc,
    coalesce(t.created_at, t.timestamp) desc
  limit greatest(least(coalesce(p_limit, 60), 200), 1);
$$;

grant execute on function public.get_public_vs_board(text, text, integer) to anon, authenticated;

-- search_public_vs — similarity on public_title ONLY (never the raw problem;
-- confidential reports are never fingerprinted). is_public + non-confidential.
create or replace function public.search_public_vs(p_query text, p_limit integer default 30)
returns table (
  canonical_id text,
  public_title text,
  category     text,
  cat_label    text,
  cat_icon     text,
  phase        integer,
  is_resolved  boolean,
  affected     bigint,
  sim          real
)
language sql
stable
security definer
set search_path = public, extensions
as $$
  select t.id, t.public_title, t.category, c.label, c.icon,
         public.vs_public_phase(t.status),
         (t.status like '%เสร็จสิ้น%'),
         1
           + (select count(*) from public.vs_tickets d
                where d.duplicate_of = t.id and d.deleted_at is null)
           + (select count(*) from public.vs_followers f where f.canonical_id = t.id),
         similarity(coalesce(t.public_title, ''), coalesce(p_query, ''))
  from public.vs_tickets t
  join public.vs_categories c on c.id = t.category
  where t.is_public = true
    and t.deleted_at is null
    and t.duplicate_of is null
    and c.is_confidential = false
    and coalesce(p_query, '') <> ''
    and similarity(coalesce(t.public_title, ''), coalesce(p_query, '')) > 0.08
  order by similarity(coalesce(t.public_title, ''), coalesce(p_query, '')) desc
  limit greatest(least(coalesce(p_limit, 30), 50), 1);
$$;

grant execute on function public.search_public_vs(text, integer) to anon, authenticated;

-- get_public_vs_problem — ONE public Problem detail + its (non-hidden) comments,
-- each with a stable pseudonymous alias. Returns NOTHING for a non-public /
-- confidential / missing id. NEVER returns the raw ticket text.
create or replace function public.get_public_vs_problem(p_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  t public.vs_tickets;
  v_conf boolean;
  v_result jsonb;
begin
  select * into t from public.vs_tickets
   where id = p_id and is_public = true and deleted_at is null and duplicate_of is null;
  if not found then return null; end if;

  select is_confidential into v_conf from public.vs_categories where id = t.category;
  if coalesce(v_conf, false) then return null; end if;  -- defense-in-depth

  v_result := jsonb_build_object(
    'canonical_id', t.id,
    'public_title', t.public_title,
    'public_note',  t.public_note,
    'category',     t.category,
    'phase',        public.vs_public_phase(t.status),
    'is_resolved',  (t.status like '%เสร็จสิ้น%'),
    'affected',
      1
      + (select count(*) from public.vs_tickets d where d.duplicate_of = t.id and d.deleted_at is null)
      + (select count(*) from public.vs_followers f where f.canonical_id = t.id),
    'following', (auth.uid() is not null and exists (
        select 1 from public.vs_followers f where f.canonical_id = t.id and f.user_id = auth.uid())),
    'created_at',   coalesce(t.created_at, t.timestamp),
    'comments', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', m.id,
               'is_staff', m.is_staff,
               -- pseudonymous, stable per (thread,user), unlinkable to identity
               'alias', case when m.is_staff then 'เจ้าหน้าที่'
                             else 'นศ.' || upper(substr(md5(m.canonical_id || m.author_user_id::text), 1, 4)) end,
               'body', m.body,
               'created_at', m.created_at
             ) order by m.created_at asc)
      from public.vs_public_comments m
      where m.canonical_id = t.id and m.hidden = false
    ), '[]'::jsonb)
  );
  return v_result;
end;
$$;

grant execute on function public.get_public_vs_problem(text) to anon, authenticated;

-- ============================================================
-- 7) KKUMAIL ACTION RPCs (authenticated only). Fail CLOSED on null role and on
--    a non-public / confidential target (mistakes.md "null in (...) fails open").
-- ============================================================

-- vs_add_me_too — +1 a public Problem. Idempotent. Returns the new affected count.
create or replace function public.vs_add_me_too(p_canonical text)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_ok  boolean;
begin
  if v_uid is null then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  select (t.is_public and t.deleted_at is null and t.duplicate_of is null
          and coalesce(c.is_confidential, true) = false)
    into v_ok
  from public.vs_tickets t
  join public.vs_categories c on c.id = t.category
  where t.id = p_canonical;
  if not coalesce(v_ok, false) then
    raise exception 'ไม่สามารถติดตามเรื่องนี้ได้' using errcode = 'P0001';
  end if;

  insert into public.vs_followers (canonical_id, user_id)
  values (p_canonical, v_uid)
  on conflict (canonical_id, user_id) do nothing;

  return 1
    + (select count(*) from public.vs_tickets d where d.duplicate_of = p_canonical and d.deleted_at is null)
    + (select count(*) from public.vs_followers f where f.canonical_id = p_canonical);
end;
$$;

revoke all on function public.vs_add_me_too(text) from public, anon;
grant execute on function public.vs_add_me_too(text) to authenticated;

-- vs_remove_me_too — undo. Returns new affected count.
create or replace function public.vs_remove_me_too(p_canonical text)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  delete from public.vs_followers where canonical_id = p_canonical and user_id = v_uid;
  return 1
    + (select count(*) from public.vs_tickets d where d.duplicate_of = p_canonical and d.deleted_at is null)
    + (select count(*) from public.vs_followers f where f.canonical_id = p_canonical);
end;
$$;

revoke all on function public.vs_remove_me_too(text) from public, anon;
grant execute on function public.vs_remove_me_too(text) to authenticated;

-- vs_post_public_comment — kkumail posts to a public, non-confidential Problem.
-- is_staff is computed server-side (never client-trusted). Returns the row id.
create or replace function public.vs_post_public_comment(p_canonical text, p_body text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_ok  boolean;
  v_body text := btrim(coalesce(p_body, ''));
  v_id  uuid;
  v_recent integer;
begin
  if v_uid is null then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if char_length(v_body) < 1 or char_length(v_body) > 2000 then
    raise exception 'ความคิดเห็นต้องมีความยาว 1–2000 ตัวอักษร' using errcode = 'P0001';
  end if;

  select (t.is_public and t.deleted_at is null and t.duplicate_of is null
          and coalesce(c.is_confidential, true) = false)
    into v_ok
  from public.vs_tickets t
  join public.vs_categories c on c.id = t.category
  where t.id = p_canonical;
  if not coalesce(v_ok, false) then
    raise exception 'ไม่สามารถแสดงความคิดเห็นในเรื่องนี้ได้' using errcode = 'P0001';
  end if;

  -- light anti-flood: max 5 comments per user per canonical in the last minute
  select count(*) into v_recent from public.vs_public_comments
   where canonical_id = p_canonical and author_user_id = v_uid
     and created_at > now() - interval '1 minute';
  if v_recent >= 5 then
    raise exception 'คุณแสดงความคิดเห็นบ่อยเกินไป กรุณารอสักครู่' using errcode = 'P0001';
  end if;

  insert into public.vs_public_comments (canonical_id, author_user_id, is_staff, body)
  values (p_canonical, v_uid, public.current_user_is_staff(), v_body)
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.vs_post_public_comment(text, text) from public, anon;
grant execute on function public.vs_post_public_comment(text, text) to authenticated;

-- ============================================================
-- 8) STAFF RPCs. Publish = SE only (vs_staff/dev/has-vs, NOT vp_admin).
--    Hide = any staff incl vp_admin. All fail CLOSED on null role.
-- ============================================================

-- vs_set_public — SE publishes/unpublishes a CANONICAL to the board and writes
-- the curated headline. Rejects confidential categories. NOT vp_admin.
create or replace function public.vs_set_public(
  p_id     text,
  p_public boolean,
  p_title  text default null,
  p_note   text default null,
  p_category text default null   -- optional: set/override the ticket's category
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := public.current_user_role();
  v_tk   public.vs_tickets;
  v_cat  text;
  v_conf boolean;
begin
  if v_role is null or not (
       v_role in ('vs_staff', 'dev') or public.current_user_has_permission('vs')
     ) then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  select * into v_tk from public.vs_tickets where id = p_id and deleted_at is null;
  if not found then raise exception 'VS ticket not found: %', p_id using errcode = 'P0002'; end if;
  if v_tk.duplicate_of is not null then
    raise exception 'เผยแพร่ได้เฉพาะเรื่องหลัก (ไม่ใช่เรื่องซ้ำ)' using errcode = 'P0001';
  end if;

  v_cat := coalesce(p_category, v_tk.category);

  if p_public then
    if v_cat is null then
      raise exception 'ต้องระบุหมวดหมู่ก่อนเผยแพร่' using errcode = 'P0001';
    end if;
    select is_confidential into v_conf from public.vs_categories where id = v_cat;
    if coalesce(v_conf, true) then
      raise exception 'หมวดหมู่นี้เป็นความลับ ไม่สามารถเผยแพร่สู่สาธารณะได้' using errcode = 'P0001';
    end if;
    if btrim(coalesce(p_title, '')) = '' then
      raise exception 'ต้องระบุหัวข้อสาธารณะก่อนเผยแพร่' using errcode = 'P0001';
    end if;
  end if;

  update public.vs_tickets
     set category    = v_cat,
         is_public   = p_public,
         public_title = case when p_public then btrim(p_title) else public_title end,
         public_note  = case when p_note is not null then btrim(p_note) else public_note end
   where id = p_id;
end;
$$;

revoke all on function public.vs_set_public(text, boolean, text, text, text) from public, anon;
grant execute on function public.vs_set_public(text, boolean, text, text, text) to authenticated;

-- vs_hide_public_comment — any staff (incl vp_admin) soft-hides/unhides a comment.
create or replace function public.vs_hide_public_comment(p_id uuid, p_hidden boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := public.current_user_role();
begin
  if v_role is null or not (
       v_role in ('vs_staff', 'dev')
       or public.current_user_has_permission('vs')
       or v_role = 'vp_admin'
     ) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  update public.vs_public_comments
     set hidden = p_hidden,
         hidden_by = case when p_hidden then auth.uid() else null end,
         hidden_at = case when p_hidden then now() else null end
   where id = p_id;
end;
$$;

revoke all on function public.vs_hide_public_comment(uuid, boolean) from public, anon;
grant execute on function public.vs_hide_public_comment(uuid, boolean) to authenticated;
