-- ============================================================
-- 0084 — a SAMO-Team VitalSound handler IS เจ้าหน้าที่ on the public board
--
-- Product decision: a person granted VitalSound through the SAMO Team tree
-- (ทีม SAMO → จัดการสิทธิ์ → VitalSound → เฉพาะ <แผนก>) represents SAMO on the
-- public Problem board, exactly like a VP or SE. Two consequences, and they
-- are NOT symmetric:
--
--   * WRITE (the badge): their board comments are stamped is_staff = true, so
--     they render as "เจ้าหน้าที่" instead of the "นศ.XXXX" pseudonym. Global —
--     a badge carries no data, so there is nothing to scope.
--
--   * READ (staff-only comments): a student's "ส่งถึงเจ้าหน้าที่เท่านั้น" message
--     (vs_public_comments.staff_only, 0078) is CONFIDENTIAL. 0078 served it to
--     `current_user_is_staff()`, which is a GLOBAL predicate — reusing it here
--     would let a person scoped to วิชาการ read private messages on every other
--     department's problems, i.e. exactly the "broad OR-branch swallows the
--     narrow one" bug that 0083 just fixed, recreated one layer up. So the read
--     is gated on current_user_vs_scope() AND the canonical ticket's
--     target_dept: a scoped handler reads staff-only comments on THEIR OWN
--     dept's problems only.
--
-- Existing readers are unchanged: vs_staff / dev / any staff role keep the
-- global view (v_staff), a full-`vs` grant (scope NULL) keeps the global view,
-- and an author always reads their own comment back.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Who counts as เจ้าหน้าที่ for VitalSound surfaces.
--    Deliberately UNION-shaped, not a replacement: every role that
--    current_user_is_staff() already covered still qualifies, so no existing
--    badge changes. `current_user_vs_scope()` is NULL for full-VS (SE-
--    equivalent) and '{}' for someone with no VS access at all — see 0083.
-- ------------------------------------------------------------
create or replace function public.current_user_is_vs_handler()
returns boolean language sql stable security definer set search_path = public as $$
  select public.current_user_is_staff()
      or public.current_user_vs_scope() is null
      or cardinality(public.current_user_vs_scope()) > 0
$$;

comment on function public.current_user_is_vs_handler() is
  'True when the caller acts for SAMO on VitalSound: any staff role, a full '
  '`vs` grant, or a per-ฝ่าย SAMO Team scope (0083/0084). Use for IDENTITY '
  '(the เจ้าหน้าที่ badge) — NEVER for reading dept-scoped confidential data, '
  'which must additionally test target_dept against current_user_vs_scope().';

grant execute on function public.current_user_is_vs_handler() to anon, authenticated;

-- ------------------------------------------------------------
-- 2. Post a board comment — body identical to 0078 except the is_staff stamp.
-- ------------------------------------------------------------
create or replace function public.vs_post_public_comment(
  p_canonical text, p_body text, p_staff_only boolean default false)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_ok     boolean;
  v_body   text := btrim(coalesce(p_body, ''));
  v_id     uuid;
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
  values (p_canonical, v_uid, public.current_user_is_vs_handler(), v_body,
          coalesce(p_staff_only, false))
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.vs_post_public_comment(text, text, boolean) from public, anon;
grant execute on function public.vs_post_public_comment(text, text, boolean) to authenticated;

-- ------------------------------------------------------------
-- 3. Problem detail — body identical to 0078 except the staff_only read gate.
--    Granted to anon, so the added branches must fail closed for a guest:
--    current_user_vs_scope() returns '{}' when there is no users row, and
--    `x = any('{}')` is false.
-- ------------------------------------------------------------
create or replace function public.get_public_vs_problem(p_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  t        public.vs_tickets;
  v_conf   boolean;
  v_staff  boolean := public.current_user_is_staff();
  v_scope  text[]  := public.current_user_vs_scope();
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
        -- 0078: staff-only comments reach staff + their own author only.
        -- 0084: …plus a full-VS grant (scope NULL = SE-equivalent) and a
        -- per-ฝ่าย handler, the latter ONLY on their own dept's problem.
        and (m.staff_only = false
             or v_staff
             or v_scope is null
             or t.target_dept = any (v_scope)
             or (auth.uid() is not null and m.author_user_id = auth.uid()))
    ), '[]'::jsonb)
  );
  return v_result;
end;
$$;

grant execute on function public.get_public_vs_problem(text) to anon, authenticated;
