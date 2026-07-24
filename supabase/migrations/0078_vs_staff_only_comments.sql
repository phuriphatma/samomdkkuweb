-- ============================================================
-- 0078 — VS board: staff-only comment visibility
--
-- The detail composer gains "ส่งถึงเจ้าหน้าที่เท่านั้น": any signed-in
-- commenter may mark a comment staff-only (a private note to the team —
-- e.g. details they don't want public). Enforced HERE, not in the client:
--   * vs_public_comments.staff_only boolean (default false)
--   * get_public_vs_problem returns a staff_only comment ONLY to staff
--     (current_user_is_staff() — any staff role) or its own author (so the
--     author sees their note after posting, with a badge).
--   * get_public_vs_board's comment_count counts PUBLIC comments only.
--
-- The old 2-arg vs_post_public_comment is DROPPED (not overloaded): keeping
-- both signatures would make a named-args PostgREST call ambiguous (PGRST203).
-- The new 3rd param defaults false, so any stale client still posts fine.
-- Idempotent (re-runnable).
-- ============================================================

alter table public.vs_public_comments
  add column if not exists staff_only boolean not null default false;

comment on column public.vs_public_comments.staff_only is
  'Visible only to staff (any staff role) + the author. Set at post time; see 0078.';

-- ---------- post: gains p_staff_only ----------
drop function if exists public.vs_post_public_comment(text, text);

create or replace function public.vs_post_public_comment(
  p_canonical text, p_body text, p_staff_only boolean default false)
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

  insert into public.vs_public_comments (canonical_id, author_user_id, is_staff, body, staff_only)
  values (p_canonical, v_uid, public.current_user_is_staff(), v_body, coalesce(p_staff_only, false))
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.vs_post_public_comment(text, text, boolean) from public, anon;
grant execute on function public.vs_post_public_comment(text, text, boolean) to authenticated;

-- ---------- detail: staff_only comments only for staff/author ----------
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
  v_staff boolean := public.current_user_is_staff();
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
               'staff_only', m.staff_only,
               -- pseudonymous, stable per (thread,user), unlinkable to identity
               'alias', case when m.is_staff then 'เจ้าหน้าที่'
                             else 'นศ.' || upper(substr(md5(m.canonical_id || m.author_user_id::text), 1, 4)) end,
               'body', m.body,
               'created_at', m.created_at
             ) order by m.created_at asc)
      from public.vs_public_comments m
      where m.canonical_id = t.id and m.hidden = false
        -- 0078: staff-only comments reach staff + their own author only
        and (m.staff_only = false or v_staff
             or (auth.uid() is not null and m.author_user_id = auth.uid()))
    ), '[]'::jsonb)
  );
  return v_result;
end;
$$;

grant execute on function public.get_public_vs_problem(text) to anon, authenticated;

-- ---------- board count: public comments only ----------
-- (recreate get_public_vs_board with the count filtered; body otherwise 0072)
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
         1
           + (select count(*) from public.vs_tickets d
                where d.duplicate_of = t.id and d.deleted_at is null)
           + (select count(*) from public.vs_followers f where f.canonical_id = t.id),
         (select count(*) from public.vs_public_comments m
            where m.canonical_id = t.id and m.hidden = false and m.staff_only = false),
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
       where m.canonical_id = t.id and m.hidden = false and m.staff_only = false
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
