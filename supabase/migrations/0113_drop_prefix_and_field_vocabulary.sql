-- ============================================================
-- 0113 — retire คำนำหน้า, and give ชั้นปี / สาขา / รหัสนักศึกษา one spelling each
--
-- WHAT THE USER ASKED FOR
--   5.  "i don't think คำนำหน้า is necessary, remove it from the data structure"
--   6.  "รหัสนักศึกษา should tell user to use format of like 653070317-0 or
--        6530703170, choose what's the best practice"
--   12. "i think there will be error with some people putting in ชั้นปี ปี5, 5
--        with space, handle input like that also. and สาขา someone will be like
--        md, m.d., MD etc i think you should make them choose instead, and add
--        crud operation that can add, edit, remove สาขา names"
--
-- THE THREAD RUNNING THROUGH ALL THREE: these columns are typed by hand in
-- three places (the admin สมาชิก form, the CSV import, and — since 0110 — by
-- the person themselves on the ตำแหน่งของฉัน card), and a field with four
-- spellings makes ตรวจสอบข้อมูล report `drift` findings about nothing: two rows
-- for one human reading `MD` and `md` are not a disagreement anyone can fix.
-- The canonical form now lives in ONE place, `src/js/team/fields.js`, and this
-- migration makes the stored data agree with it.
--
-- ⚠️ DESTRUCTIVE, EXPLICITLY AUTHORISED. §1 drops `prefix` from both
-- `team_members` (380 non-null values: นางสาว 236, นาย 143, one typo "นาวสาว")
-- and `team_people`. The user was shown that count and the wording "gone for
-- good" and chose it. It is not archived anywhere: the whole point is that the
-- field is not worth carrying, and a dormant copy would be the thing that rots.
-- ============================================================

-- ------------------------------------------------------------
-- §1 — คำนำหน้า is gone
--
-- ORDER MATTERS. `prefix` is named in four places that would break if the
-- column vanished under them, so each is rewritten BEFORE the drop:
--   a. team_person_mirror_down() writes it (0108) — and its trigger names it in
--      `after update of …`, which is a hard error once the column is dropped;
--   b. team_members_self_update_guard() lists it as self-writable (0110);
--   c. get_my_team_seat() publishes it (0109 → 0110 → 0112);
--   d. `alter table … drop column` itself.
-- A `drop column` would in fact cascade-drop the trigger, which is exactly the
-- failure mode to avoid: the mirror would silently stop firing on the OTHER
-- eight columns. So the trigger is recreated explicitly.
-- ------------------------------------------------------------

-- (a) the person → placements mirror, without prefix.
-- BASED ON THE LIVE BODY (0108 is the only definition; verified with
-- pg_get_functiondef before editing, per the "recreating a function from the
-- migration that FIRST defined it" entry in docs/mistakes/postgres-schema.md).
create or replace function public.team_person_mirror_down()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.team_members m
     set full_name   = new.full_name,
         nickname    = new.nickname,
         year        = new.year,
         major       = new.major,
         photo_url   = new.photo_url,
         photo_focus = new.photo_focus,
         student_id  = new.student_id,
         kkumail     = new.kkumail,
         user_id     = coalesce(new.user_id, m.user_id)
   where m.person_id = new.id
     and (m.full_name, m.nickname, m.year, m.major, m.photo_url,
          m.photo_focus, m.student_id, m.kkumail)
         is distinct from
         (new.full_name, new.nickname, new.year, new.major,
          new.photo_url, new.photo_focus, new.student_id, new.kkumail);
  return new;
end;
$$;

drop trigger if exists team_people_mirror_down on public.team_people;
create trigger team_people_mirror_down
  after update of full_name, nickname, year, major, photo_url,
                  photo_focus, student_id, kkumail, user_id
  on public.team_people
  for each row execute function public.team_person_mirror_down();

-- (b) the self-update column guard, without prefix.
-- A stale entry in the allow-list would be harmless (`to_jsonb(row) - key` on a
-- key that no longer exists is a no-op) — it is rewritten anyway so the list
-- reads as the truth about what a member may write, which is the only reason
-- anyone opens this function.
create or replace function public.team_members_self_update_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  -- Columns a person may set on their own row. Everything else is admin-owned.
  -- `updated_at` is excluded from the DIFF (not granted): touch_updated_at is a
  -- BEFORE trigger on the same table and the two orderings are decided by name,
  -- so comparing it would reject every write depending on which fired first.
  v_allowed text[] := array[
    'full_name', 'nickname', 'student_id', 'year', 'major',
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

drop trigger if exists team_members_self_update_guard on public.team_members;
create trigger team_members_self_update_guard
  before update on public.team_members
  for each row execute function public.team_members_self_update_guard();

-- (c) the card payload, without prefix and WITH the live ปีการศึกษา.
--
-- BASED ON 0112's BODY (the latest definition — 0109 created it, 0110 and 0112
-- redefined it). Two changes: `prefix` is gone from each posting, and
-- `term_year` is added.
--
-- WHY term_year IS HERE. The card's self-edit can now replace the person's
-- photo, and uploadTeamPhoto() files it under Team/<ปีการศึกษา>/<ฝ่าย>/ so the
-- Drive folder stays browsable. The admin app reads that year from
-- `team_terms`, but `team_terms_read` requires `team`/`team_edit`… which every
-- member does hold — and yet a second round trip from the PUBLIC bundle to
-- learn one integer is worse than returning it here, where the caller's own
-- record is already being assembled. The alternative considered and rejected
-- was deriving it in JS from today's date: the ปีการศึกษา rolls over on a date
-- nobody agrees about, and a wrong guess files photos into a folder for a year
-- that does not exist.
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

revoke all on function public.get_my_team_seat() from public, anon;
grant execute on function public.get_my_team_seat() to authenticated;

-- (d) and now the columns themselves.
alter table public.team_members drop column if exists prefix;
alter table public.team_people  drop column if exists prefix;

-- ------------------------------------------------------------
-- §2 — สาขา becomes a managed vocabulary
--
-- ⚠️ THE COLUMN STAYS FREE TEXT. `team_members.major` is deliberately NOT
-- converted to a foreign key onto this table, and that is the most important
-- decision in this file.
--
-- The recurring class (docs/mistakes/authz-rls.md, "adding a DELETE to
-- reference data turns every coalesce(flag,false) lookup into a live
-- fail-open") is about what a reference row's DISAPPEARANCE does to everything
-- that resolves through it. The user asked for exactly that hazard — "add crud
-- operation that can add, edit, remove สาขา names" — so removing a สาขา is now
-- a real input. With an FK, `on delete set null` silently blanks 348 people's
-- สาขา and `on delete restrict` makes the delete button fail 23503 for reasons
-- the admin cannot see. With plain text, deleting `MD` from the vocabulary
-- removes it from the PICKER and touches no member row: the data survives, the
-- ตรวจสอบข้อมูล pane can report "not in the list", and a human decides.
--
-- So this table is a VOCABULARY, not a foreign key. `code` is what gets stored
-- on the member row; renaming a code backfills the rows that carry it (done in
-- the app, under `team_edit`), which is a data edit rather than a schema
-- relationship.
-- ------------------------------------------------------------
create table if not exists public.team_majors (
  id         uuid primary key default gen_random_uuid(),
  -- What lands in team_members.major. Short code, because that is what the live
  -- data already holds (MD / MDI / RT) and what fits on a portrait card.
  code       text not null,
  -- Optional Thai/long name for the picker. Display only.
  label      text,
  position   integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.team_majors drop constraint if exists team_majors_code_len;
alter table public.team_majors
  add constraint team_majors_code_len
  check (char_length(btrim(code)) between 1 and 40);

alter table public.team_majors drop constraint if exists team_majors_label_len;
alter table public.team_majors
  add constraint team_majors_label_len
  check (label is null or char_length(label) <= 120);

-- Case-insensitive uniqueness: `MD` and `md` in the picker is the exact problem
-- this table exists to end, and a plain unique index would allow both.
drop index if exists team_majors_code_uniq;
create unique index team_majors_code_uniq on public.team_majors (lower(btrim(code)));

drop trigger if exists touch_team_majors on public.team_majors;
create trigger touch_team_majors before update on public.team_majors
  for each row execute function public.touch_team_people_updated_at();

alter table public.team_majors enable row level security;

-- READ: every authenticated caller. Not `team`/`team_edit` — the picker is
-- rendered by the ตำแหน่งของฉัน self-edit form in the PUBLIC bundle, and a
-- person editing their own row needs the list before they hold any grant
-- (a member DOES hold `team` implicitly, but gating a public form on that
-- couples this list to the grant chain for no benefit — it is three
-- non-confidential codes). It carries no personal data by construction.
drop policy if exists "team_majors_read" on public.team_majors;
create policy "team_majors_read" on public.team_majors
  for select to authenticated using (true);

-- WRITE: the ทีม SAMO editors only — same gate as the tree itself (0110).
-- `team_edit`, never `team`: since 0110 every person in the tree holds the view
-- rung, so gating a write on it would let all ~285 of them rename สาขา.
drop policy if exists "team_majors_write" on public.team_majors;
create policy "team_majors_write" on public.team_majors
  for all to authenticated
  using (
    public.current_user_role() = any (array['vp_admin', 'dev'])
    or public.current_user_has_permission('team_edit')
  )
  with check (
    public.current_user_role() = any (array['vp_admin', 'dev'])
    or public.current_user_has_permission('team_edit')
  );

comment on table public.team_majors is
  'Picker vocabulary for team_members.major (0113). NOT a foreign key: the '
  'member column stays free text so removing a สาขา from the list can never '
  'blank or block a person row. Renaming a code backfills the members that '
  'carry it, from the app, under team_edit.';

-- Seed from what the live rows actually say, so the picker starts complete and
-- no existing member becomes "not in the list" the moment this ships.
insert into public.team_majors (code, label, position)
select code, label, position from (values
  ('MD',  'แพทยศาสตร์', 1),
  ('MDI', 'เวชนิทัศน์', 2),
  ('RT',  'รังสีเทคนิค', 3)
) as v(code, label, position)
where not exists (
  select 1 from public.team_majors t where lower(btrim(t.code)) = lower(btrim(v.code))
);

-- Anything else a live row holds, kept as a code with no label rather than
-- silently excluded — a member whose สาขา is missing from the picker would have
-- it rewritten by the next save of their row.
insert into public.team_majors (code, position)
select distinct btrim(m.major), 90
  from public.team_members m
 where m.major is not null and btrim(m.major) <> ''
   and not exists (
     select 1 from public.team_majors t
      where lower(btrim(t.code)) = lower(btrim(m.major)));

-- ------------------------------------------------------------
-- §3 — make the stored data agree with the canonical forms
--
-- Mirrors src/js/team/fields.js. This is the "two implementations of one rule"
-- risk, accepted for a ONE-OFF backfill: it runs once, and the JS is the
-- implementation from here on (tools/team0113-fields.mjs re-checks the outcome
-- against the JS rule rather than against this SQL).
--
-- Deliberately NOT a check constraint. 22 rows have no รหัสนักศึกษา, one holds
-- `66666666-2` (9 digits — unfixable without asking the human which digit is
-- missing), and a constraint would turn every unrelated edit to those rows into
-- a 23514 the admin cannot clear. The form refuses bad NEW input; the data
-- keeps its unfixable cases visible in ตรวจสอบข้อมูล instead of hiding them
-- behind a write nobody can complete.
-- ------------------------------------------------------------

-- รหัสนักศึกษา → 9 digits + dash + check digit, when exactly 10 digits are
-- present after dropping every non-digit. `ุ693070229-1` (a stray Thai vowel
-- mark) and the one bare `6530703170` both land here; `66666666-2` does not.
update public.team_members
   set student_id = substring(regexp_replace(student_id, '\D', '', 'g') from 1 for 9)
                    || '-' || substring(regexp_replace(student_id, '\D', '', 'g') from 10 for 1)
 where student_id is not null
   and length(regexp_replace(student_id, '\D', '', 'g')) = 10
   and student_id <> substring(regexp_replace(student_id, '\D', '', 'g') from 1 for 9)
                     || '-' || substring(regexp_replace(student_id, '\D', '', 'g') from 10 for 1);

-- ชั้นปี → the bare digit. Live data is already clean; this catches whatever a
-- past import left and makes the column agree with the new chooser's values.
update public.team_members
   set year = (regexp_match(year, '\d+'))[1]
 where year is not null
   and (regexp_match(year, '\d+'))[1] is not null
   and (regexp_match(year, '\d+'))[1] between '1' and '6'
   and year <> (regexp_match(year, '\d+'))[1];

-- สาขา → the vocabulary's spelling of it.
update public.team_members m
   set major = t.code
  from public.team_majors t
 where m.major is not null
   and lower(btrim(m.major)) = lower(btrim(t.code))
   and m.major <> t.code;

-- Same three, on the person register, so team_people does not drift back down
-- through the mirror.
update public.team_people
   set student_id = substring(regexp_replace(student_id, '\D', '', 'g') from 1 for 9)
                    || '-' || substring(regexp_replace(student_id, '\D', '', 'g') from 10 for 1)
 where student_id is not null
   and length(regexp_replace(student_id, '\D', '', 'g')) = 10
   and student_id <> substring(regexp_replace(student_id, '\D', '', 'g') from 1 for 9)
                     || '-' || substring(regexp_replace(student_id, '\D', '', 'g') from 10 for 1);

update public.team_people
   set year = (regexp_match(year, '\d+'))[1]
 where year is not null
   and (regexp_match(year, '\d+'))[1] is not null
   and (regexp_match(year, '\d+'))[1] between '1' and '6'
   and year <> (regexp_match(year, '\d+'))[1];

update public.team_people p
   set major = t.code
  from public.team_majors t
 where p.major is not null
   and lower(btrim(p.major)) = lower(btrim(t.code))
   and p.major <> t.code;
