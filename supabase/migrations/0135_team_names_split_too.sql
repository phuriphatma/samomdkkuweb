-- ============================================================
-- 0135 — ทีม SAMO gets ชื่อ / นามสกุล, and nothing anywhere guesses a boundary
--
-- WHAT WAS ASKED
--   "please split the name and surname from teamsamo. and should user on the web
--    edit their name like fullname like currently, shouldn't they be edit like
--    name and surname, wouldn't that be an issue for the database"
--
-- Yes to both, and the second one was already a live bug, not a hypothetical.
--
-- THE BUG. `src/js/my-seat.js` saved the person's own ชื่อ-สกุล as ONE box and
-- then did this on the way to ระบบบ้าน:
--
--     const [first, ...rest] = body.full_name.trim().split(/\s+/);
--     ...(rest.length ? { first_name_th: first, last_name_th: rest.join(' ') } : {})
--
-- …and `update_my_identity` passes that patch straight into
-- `update_my_student_record`, which writes both columns unconditionally. So a
-- person whose ระบบบ้าน record correctly said
--   first = 'สมชาย ใจดี'   last = 'ดีมาก'
-- had it rewritten to
--   first = 'สมชาย'        last = 'ใจดี ดีมาก'
-- the first time they touched their own card — silently, irreversibly, and with
-- `self_edited` then claiming the person had chosen it. This is the exact guess
-- the CSV importer REFUSES a file for making (house/io.js, '_combined_name'),
-- reimplemented three modules away. Two implementations of one rule drift; here
-- one of them was the negation of the other.
--
-- THE SHAPE OF THE FIX, and the rule it follows everywhere:
--   store the PARTS, derive the WHOLE, and never split an existing whole.
--
-- `team_members` gets `first_name_th` / `last_name_th`. `full_name` stays as a
-- real column and becomes DERIVED whenever the parts are present — the same
-- trigger `people` has had since 0132 — so every existing reader keeps working
-- and no row is rewritten by this migration. BACKFILL NOTHING: a row acquires
-- the split when a HUMAN types it, which is the only source that can know where
-- "ณ อยุธยา" begins.
--
-- After this, all three editors speak the split, so 0132/0133's mirrors carry a
-- name edit in either direction and the one documented sync gap closes.
-- ============================================================

-- ------------------------------------------------------------
-- §1 — the columns, and full_name as a derivation
--
-- `full_name` also drops NOT NULL, matching `people` (0132 §2). A placement can
-- exist for a person the roster knows only as an address (0126), and more
-- immediately: `person_mirror_down` writes `people.full_name` into this column,
-- so leaving it NOT NULL means a nameless registry row makes an unrelated edit
-- fail with a 23502 raised from inside a trigger. The app still requires a name
-- at the door (`createMember`, and the member form) — that is where a refusal
-- can say something a human can read.
-- ------------------------------------------------------------
alter table public.team_members
  add column if not exists first_name_th text,
  add column if not exists last_name_th  text;

alter table public.team_members alter column full_name drop not null;

comment on column public.team_members.first_name_th is
  'ชื่อจริง. NULL on every row that predates 0135 — a row acquires the split '
  'when a human types it, never by splitting full_name on whitespace.';
comment on column public.team_members.last_name_th is
  'นามสกุล. See first_name_th. Thai surnames contain spaces ("ณ อยุธยา"), so '
  'whitespace does not mark the boundary and a guess renames a real person.';
comment on column public.team_members.full_name is
  'The name as displayed. DERIVED from first_name_th + last_name_th whenever '
  'those are present (team_members_sync_full_name, 0135); stands alone for '
  'rows that only ever had a combined name. Never split it to fill the parts.';

create or replace function public.team_members_sync_full_name()
returns trigger language plpgsql as $$
begin
  -- Only when the split is actually there. A row carrying only a combined name
  -- must pass through untouched, or every pre-0135 member gets blanked.
  if nullif(btrim(coalesce(new.first_name_th, '')), '') is not null
     or nullif(btrim(coalesce(new.last_name_th, '')), '') is not null then
    new.full_name := nullif(btrim(
      coalesce(btrim(new.first_name_th), '') || ' ' || coalesce(btrim(new.last_name_th), '')), '');
  end if;
  return new;
end;
$$;

drop trigger if exists team_members_sync_full_name on public.team_members;
create trigger team_members_sync_full_name
  before insert or update of first_name_th, last_name_th on public.team_members
  for each row execute function public.team_members_sync_full_name();

-- ------------------------------------------------------------
-- §2 — a new placement is linked with its split, not just its whole
--
-- `resolve_person_id` already takes p_first / p_last; the ทีม SAMO caller was
-- passing NULL for both because the table had nothing to give it. It does now.
-- ------------------------------------------------------------
create or replace function public.team_members_link_person()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.person_id is null then
    new.person_id := public.resolve_person_id(
      new.kkumail, new.full_name, new.first_name_th, new.last_name_th,
      new.student_id, new.major, new.nickname);
  end if;
  return new;
end;
$$;

-- ------------------------------------------------------------
-- §3 — the mirror UP now carries the split
--
-- AND IT STOPS OVERWRITING A SPLIT WITH A WHOLE. That is the gap 0133 recorded
-- and deliberately left open: a legacy row whose only name is combined must not
-- be able to replace `people.first_name_th` / `last_name_th`, because the only
-- way to do that is to guess where the surname starts.
--
-- So `full_name` travels up ONLY when neither side holds a split. Where either
-- side does, the split is authoritative and the combined value is downstream of
-- it. With the member form now offering two boxes (this migration's other half),
-- an admin who wants to change such a name types the split and this branch is
-- what makes their edit the authoritative one.
-- ------------------------------------------------------------
create or replace function public.team_member_mirror_up()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_has_split boolean;
  v_person_split boolean;
begin
  if new.person_id is null then return new; end if;

  v_has_split := nullif(btrim(coalesce(new.first_name_th, '')), '') is not null
              or nullif(btrim(coalesce(new.last_name_th, '')), '') is not null;

  select nullif(btrim(coalesce(p.first_name_th, '')), '') is not null
      or nullif(btrim(coalesce(p.last_name_th, '')), '') is not null
    into v_person_split
    from public.people p where p.id = new.person_id;

  update public.people p
     set first_name_th = case when v_has_split then new.first_name_th else p.first_name_th end,
         last_name_th  = case when v_has_split then new.last_name_th  else p.last_name_th  end,
         -- Derived from the parts when there are any; otherwise the combined
         -- value, but never over a person who already has a split.
         full_name  = case
           when v_has_split then new.full_name
           when coalesce(v_person_split, false) then p.full_name
           else new.full_name end,
         nickname   = new.nickname,
         student_id = new.student_id,
         major      = new.major,
         photo_url  = new.photo_url,
         photo_focus = new.photo_focus,
         kkumail    = coalesce(nullif(btrim(coalesce(new.kkumail, '')), ''), p.kkumail)
   where p.id = new.person_id
     and (p.first_name_th, p.last_name_th, p.full_name, p.nickname, p.student_id,
          p.major, p.photo_url, p.photo_focus)
         is distinct from
         (case when v_has_split then new.first_name_th else p.first_name_th end,
          case when v_has_split then new.last_name_th  else p.last_name_th  end,
          case when v_has_split then new.full_name
               when coalesce(v_person_split, false) then p.full_name
               else new.full_name end,
          new.nickname, new.student_id, new.major, new.photo_url, new.photo_focus);
  return new;
end;
$$;

-- The trigger's column list has to grow with the function, or an edit that
-- touches ONLY the new columns fires nothing at all — the same silent-no-op
-- 0133 §4 had to work around when it wrote its reconciliation as direct updates.
drop trigger if exists team_member_mirror_up on public.team_members;
create trigger team_member_mirror_up
  after update of full_name, first_name_th, last_name_th, nickname, student_id,
                  major, photo_url, photo_focus, kkumail
  on public.team_members
  for each row execute function public.team_member_mirror_up();

comment on function public.team_member_mirror_up() is
  'Pushes an identity edit made in the ทีม SAMO admin pane up to `people` '
  '(0133), now including ชื่อ / นามสกุล (0135). A row holding only a COMBINED '
  'name never overwrites a person who has the split — that would require '
  'guessing the boundary. Guarded by `is distinct from`: without it this and '
  'person_mirror_down recurse forever.';

-- ------------------------------------------------------------
-- §4 — the mirror DOWN now carries the split into ทีม SAMO
--
-- This is the direction that closes the reported gap: an edit made on the
-- person's own card or in the ระบบบ้าน admin pane reaches the ทีม SAMO roster as
-- two columns, and `team_members_sync_full_name` rebuilds what every existing
-- reader of `full_name` shows.
--
-- Rebuilt from the LIVE 0134 body. Recreating it from 0132 (which first defined
-- it) would silently revert the ชื่อเล่น fix — that is its own entry in
-- docs/mistakes/postgres-schema.md.
-- ------------------------------------------------------------
create or replace function public.person_mirror_down()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.team_members m
     set full_name     = new.full_name,
         first_name_th = new.first_name_th,
         last_name_th  = new.last_name_th,
         nickname    = new.nickname,
         year        = new.year,
         major       = new.major,
         photo_url   = new.photo_url,
         photo_focus = new.photo_focus,
         student_id  = new.student_id,
         kkumail     = new.kkumail,
         user_id     = coalesce(new.user_id, m.user_id)
   where m.person_id = new.id
     and (m.full_name, m.first_name_th, m.last_name_th, m.nickname, m.year,
          m.major, m.photo_url, m.photo_focus, m.student_id, m.kkumail)
         is distinct from
         (new.full_name, new.first_name_th, new.last_name_th, new.nickname,
          new.year, new.major, new.photo_url, new.photo_focus, new.student_id,
          new.kkumail);

  -- The house half. `sai_code` is NOT here and never will be: it is the
  -- university's advisor assignment and it decides the house, so it belongs to
  -- the placement, not to the identity.
  --
  -- `nickname_self` carries the nickname (0134) — `students.nickname` itself is
  -- GENERATED and writing it would 428C9. The guard compares the GENERATED
  -- value, because that is what a reader sees and therefore what "already in
  -- sync" has to mean; comparing `nickname_self` would keep firing forever for
  -- a row whose value comes from `nickname_imported`.
  update public.students s
     set first_name_th = new.first_name_th,
         last_name_th  = new.last_name_th,
         nickname_self = coalesce(new.nickname, s.nickname_self),
         student_id    = new.student_id,
         major         = new.major,
         year_offset   = new.year_offset,
         photo_url     = new.photo_url,
         photo_focus   = new.photo_focus,
         bio           = new.bio
   where s.person_id = new.id
     and (s.first_name_th, s.last_name_th, s.nickname, s.student_id, s.major,
          s.year_offset, s.photo_url, s.photo_focus, s.bio)
         is distinct from
         (new.first_name_th, new.last_name_th, new.nickname, new.student_id,
          new.major, new.year_offset, new.photo_url, new.photo_focus, new.bio);
  return new;
end;
$$;

-- ------------------------------------------------------------
-- §5 — the person's own card stops guessing
--
-- `update_my_identity` used to hand ทีม SAMO a `full_name` assembled from
-- ระบบบ้าน (or, failing that, from the client's whitespace split). It now writes
-- the PARTS and lets §1's trigger derive the whole — so the two systems hold the
-- same two strings rather than one string and a guess at how to cut it.
--
-- The client no longer sends a guessed `first_name_th`/`last_name_th` pair
-- either; the card has two boxes. A patch that carries only one of them is still
-- honoured, because `update_my_student_record` treats an absent key as "leave
-- it" and a present-but-empty ชื่อ as an error rather than an erasure (0126).
-- ------------------------------------------------------------
create or replace function public.update_my_identity(p_patch jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid   uuid := auth.uid();
  v_email text;
  v_full  text;
  v_first text;
  v_last  text;
  v_has_house boolean;
begin
  if v_uid is null then raise exception 'ต้องเข้าสู่ระบบก่อน'; end if;
  select email into v_email from public.users where id = v_uid;
  if v_email is null or length(btrim(v_email)) = 0 then
    raise exception 'บัญชีนี้ไม่มีอีเมล';
  end if;

  -- The house half FIRST, because it owns the validation: the รหัสนักศึกษา
  -- format, the uniqueness race, the สาขา vocabulary and the "you may not erase
  -- a name that exists" rule all live in update_my_student_record (0125/0126/
  -- 0131). Running it first means a rejected patch raises before anything at
  -- all has been written, instead of after ทีม SAMO already took it.
  select exists (select 1 from public.students
                  where lower(btrim(kkumail)) = lower(btrim(v_email)))
    into v_has_house;
  if v_has_house then perform public.update_my_student_record(p_patch); end if;

  -- The ทีม SAMO half. Every posting the person holds, because a member with
  -- two postings has two rows and writing one is how the `drift` finding this
  -- card exists to clear gets created.
  --
  -- `app.team_sync` is the documented server-writer exemption (0110): this runs
  -- as a definer with the member's own auth.uid(), and team_members_self_update_guard
  -- would otherwise refuse a write it should allow. A client cannot set it.
  perform set_config('app.team_sync', '1', true);

  -- Prefer what ระบบบ้าน now holds — it was just validated, and for a person in
  -- both systems it is the same two strings. Fall back to the patch for someone
  -- with no students row at all.
  select full_name, first_name_th, last_name_th into v_full, v_first, v_last
    from public.students
   where lower(btrim(kkumail)) = lower(btrim(v_email));

  if not v_has_house then
    v_first := case when p_patch ? 'first_name_th'
                    then nullif(btrim(coalesce(p_patch->>'first_name_th','')), '') end;
    v_last  := case when p_patch ? 'last_name_th'
                    then nullif(btrim(coalesce(p_patch->>'last_name_th','')), '') end;
    v_full  := nullif(btrim(coalesce(v_first, '') || ' ' || coalesce(v_last, '')), '');
  end if;

  update public.team_members m
     set first_name_th = case when v_first is not null then v_first else m.first_name_th end,
         last_name_th  = case when v_last  is not null then v_last  else m.last_name_th  end,
         -- Only when there is no split to derive it from. NEVER a split of
         -- m.full_name — see this migration's header.
         full_name  = case
           when v_first is not null or v_last is not null then m.full_name
           when v_full is not null and btrim(v_full) <> '' then v_full
           else m.full_name end,
         nickname   = case when p_patch ? 'nickname_self'
                           then nullif(btrim(coalesce(p_patch->>'nickname_self','')), '')
                           else m.nickname end,
         student_id = case when p_patch ? 'student_id'
                           then nullif(btrim(coalesce(p_patch->>'student_id','')), '')
                           else m.student_id end,
         major      = case when p_patch ? 'major'
                           then nullif(btrim(coalesce(p_patch->>'major','')), '')
                           else m.major end,
         photo_url  = case when p_patch ? 'photo_url'
                           then nullif(btrim(coalesce(p_patch->>'photo_url','')), '')
                           else m.photo_url end,
         photo_focus = case when p_patch ? 'photo_focus'
                           then nullif(btrim(coalesce(p_patch->>'photo_focus','')), '')
                           else m.photo_focus end
   where lower(btrim(m.kkumail)) = lower(btrim(v_email));

  perform set_config('app.team_sync', '', true);

  -- …and the registry itself, so `people` is not the one copy left stale.
  update public.people p
     set first_name_th = coalesce(s.first_name_th, p.first_name_th),
         last_name_th  = coalesce(s.last_name_th,  p.last_name_th),
         nickname      = coalesce(s.nickname,      p.nickname),
         student_id    = coalesce(s.student_id,    p.student_id),
         major         = coalesce(s.major,         p.major),
         cohort_year   = coalesce(s.cohort_year,   p.cohort_year),
         year_offset   = s.year_offset
    from public.students s
   where s.person_id = p.id
     and lower(btrim(s.kkumail)) = lower(btrim(v_email));

  return public.get_my_profile();
end;
$$;

revoke all on function public.update_my_identity(jsonb) from public;
revoke all on function public.update_my_identity(jsonb) from anon;
grant execute on function public.update_my_identity(jsonb) to authenticated;

-- ------------------------------------------------------------
-- §6 — the ทีม SAMO member form can now be filled with a SPLIT
--
-- `lookup_student_by_kkumail` already returned `first_name` / `last_name`; the
-- form had nowhere to put them. It does now, and this comment is the only
-- change the function needs — recorded so the next reader knows the two boxes
-- are fed from here rather than from a split of `full_name`.
-- ------------------------------------------------------------
comment on function public.lookup_student_by_kkumail(text) is
  'Resolve ONE exact kkumail against ระบบบ้าน, for the ทีม SAMO member form. '
  'Exact match only (never ILIKE — see 0101), hand-built column allow-list, '
  'gated on team/house/vp_admin/dev, never granted to anon. Its first_name / '
  'last_name are what fill the form''s two name boxes since 0135.';

-- ------------------------------------------------------------
-- §7 — the seat payload carries the split
--
-- `get_my_team_seat()` is what paints ข้อมูลของฉัน. Its postings carried
-- `full_name` and nothing else, so a card offering two name boxes would have
-- had to fill them by splitting that string — the very thing this migration
-- removes. Two keys, everything else byte-identical.
--
-- Rebuilt from 0113, which is the ONLY definition of this function in the
-- migration tree (verified: `grep -n get_my_team_seat supabase/migrations/`
-- finds a definition only there). `tools/team0135-name-split.mjs` compares the
-- live body against this one before applying, because "recreating a function
-- from the migration that first defined it silently reverts every later one" is
-- its own entry in docs/mistakes/postgres-schema.md.
-- ------------------------------------------------------------
create or replace function public.get_my_team_seat()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_uid        uuid := auth.uid();
  v_email      text;
  v_postings   jsonb := '[]'::jsonb;
  v_sid_shared int := 0;
  v_term       int;
  m            public.team_members%rowtype;
  v_node       public.team_nodes%rowtype;
  v_name       text;
  v_nick       text;
  v_empty      jsonb := jsonb_build_object(
                  'email', null, 'name', null, 'nickname', null,
                  'postings', '[]'::jsonb,
                  'permissions', '[]'::jsonb, 'vs_depts', '[]'::jsonb,
                  'project_seats', '[]'::jsonb, 'passport_scopes', '[]'::jsonb,
                  'can_view_team', false, 'can_edit_team', false,
                  'student_id_shared_with', 0, 'term_year', null);
begin
  if v_uid is null then return v_empty; end if;
  select email into v_email from public.users where id = v_uid;
  -- NOTE `is null or length(btrim()) = 0` rather than a bare null check: a
  -- blank email would match `lower(kkumail) = ''` on any member row whose
  -- kkumail is the empty string, which is 10 live rows.
  if v_email is null or length(btrim(v_email)) = 0 then return v_empty; end if;

  select year into v_term from public.team_terms where is_current limit 1;

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
      'member_id', m.id,
      'node_id',  v_node.id,
      'node',     v_node.name,
      'path',     to_jsonb(public.team_node_path(v_node.id)),
      'is_board', coalesce(v_node.is_board, false),
      'full_name',  m.full_name,
      -- The SPLIT (0135). The person's own card edits ชื่อ and นามสกุล as two
      -- boxes; without these two keys it would have to read them back off
      -- `full_name`, i.e. split on whitespace, which is the bug 0135 exists to
      -- remove. A pre-0135 row returns null for both and the card's boxes are
      -- empty with the combined name shown beside them.
      'first_name_th', m.first_name_th,
      'last_name_th',  m.last_name_th,
      'nickname',   m.nickname,
      'student_id', m.student_id,
      'year',       m.year,
      'major',      m.major,
      'kkumail',    m.kkumail,
      'photo_url',  m.photo_url,
      'photo_focus', m.photo_focus,
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

  -- How many OTHER identities hold one of this person's รหัสนักศึกษา.
  -- An "identity" is the kkumail when it is a real address, else the row itself
  -- — a row with no address cannot be matched to anyone, so it counts as its
  -- own person. That mirrors the email-first grouping the JS rule uses, without
  -- restating the rule: this answers only "how many others", never "who".
  select count(*) into v_sid_shared from (
    select distinct case when kkumail like '%@%' then lower(btrim(kkumail))
                         else 'row:' || id::text end as who
      from public.team_members
     where student_id is not null and btrim(student_id) <> ''
       and student_id in (
             select student_id from public.team_members
              where lower(kkumail) = lower(btrim(v_email))
                and student_id is not null and btrim(student_id) <> '')
       and (kkumail is null or lower(btrim(kkumail)) <> lower(btrim(v_email)))
  ) s;

  return jsonb_build_object(
    'email',           v_email,
    'name',            v_name,
    'nickname',        v_nick,
    'postings',        v_postings,
    'permissions',     to_jsonb(public.effective_team_permissions_for_email(v_email)),
    'vs_depts',        to_jsonb(public.effective_team_vs_depts_for_email(v_email)),
    'project_seats',   to_jsonb(public.effective_team_project_seats_for_email(v_email)),
    'passport_scopes', to_jsonb(public.effective_team_passport_scopes_for_email(v_email)),
    'can_view_team',   public.current_user_has_permission('team')
                        or public.current_user_has_permission('team_edit')
                        or public.current_user_role() = any (array['vp_admin','dev']),
    'can_edit_team',   public.current_user_has_permission('team_edit')
                        or public.current_user_role() = any (array['vp_admin','dev']),
    'student_id_shared_with', v_sid_shared,
    'term_year',       v_term
  );
end;
$$;

-- ------------------------------------------------------------
-- §8 — the self-edit column guard learns the two new columns
--
-- WITHOUT THIS THE WHOLE MIGRATION IS DEAD ON ARRIVAL for anyone who is not an
-- admin. `team_members_self_update_guard` (0110, rewritten 0113) is an
-- allow-LIST: it diffs `to_jsonb(old) - v_allowed` against the same of `new`
-- and raises when anything outside the list moved. Two brand-new columns are
-- outside it by construction, so:
--
--   • a member saving their own ชื่อ / นามสกุล would get P0001, and
--   • `person_mirror_down` — which now writes the split into `team_members` —
--     would raise the same thing from inside a trigger on an edit made in a
--     completely different pane, because that mirror runs with the caller's
--     auth.uid() and outside the `app.team_sync` window.
--
-- This is class 5: a new access channel must be threaded through EVERY gate the
-- old one used. The columns are the channel here; the guard is the gate.
--
-- Rebuilt from the LIVE 0113 body (the 0110 original differs — it still lists
-- `prefix`), with two entries added and nothing else touched.
-- ------------------------------------------------------------
create or replace function public.team_members_self_update_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  -- Columns a person may set on their own row. Everything else is admin-owned.
  -- `updated_at` is excluded from the DIFF (not granted): touch_updated_at is a
  -- BEFORE trigger on the same table and the two orderings are decided by name,
  -- so comparing it would reject every write depending on which fired first.
  v_allowed text[] := array[
    'full_name', 'first_name_th', 'last_name_th',
    'nickname', 'student_id', 'year', 'major',
    'photo_url', 'photo_focus', 'updated_at'
  ];
  v_old jsonb;
  v_new jsonb;
begin
  -- THE SERVER-WRITER EXEMPTION (0110). sync_my_team_permissions() runs on every
  -- login and writes user_id — a guarded column — from a definer function with
  -- the member's OWN auth.uid(). The first cut of this guard therefore locked
  -- out every member without `team_edit`. `app.team_sync` is the signal the
  -- server writer sets about itself; a client cannot set it.
  if coalesce(current_setting('app.team_sync', true), '') = '1' then return new; end if;

  -- Other server contexts (migrations, tools/*.mjs over the Management API,
  -- the recompute trigger) run with auth.uid() = null and must pass untouched.
  if auth.uid() is null then return new; end if;
  if public.current_user_role() = any (array['vp_admin', 'dev'])
     or public.current_user_has_permission('team_edit') then
    return new;
  end if;

  v_old := to_jsonb(old) - v_allowed;
  v_new := to_jsonb(new) - v_allowed;
  if v_old is distinct from v_new then
    raise exception 'team_members_self_update_guard: you may only edit your own name, nickname, student id, year, major and photo'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;
