-- ============================================================================
-- 0145 — ชั้นปี is ONE fact, derived, in ทีม SAMO too.
--
-- REPORTED, three symptoms, one cause:
--   "when i change ชั้นปี in the main web, nothing happens"
--   "when i change รหัสนักศึกษา the รุ่น does change, but ปี doesn't change"
--   "i've tested changing my student id to 603070316-0 — it shows ชั้นปี 5 on
--    main web, จบแล้ว in ระบบบ้าน (ปี10), ปี5 in teamsamo. the data become not
--    syncing"
--
-- ---------------------------------------------------------------------------
-- CAUSE 1 — THE EDIT WAS REVERTED BY OUR OWN MIRROR (the "nothing happens").
--
-- `person_mirror_down()` pushes `people.year` into `team_members.year`.
-- `team_member_mirror_up()` does NOT carry `year` the other way. The mirror is
-- therefore ONE-WAY on this one column, and the my-seat save does exactly this:
--
--   1. PATCH team_members  → year = '3'        (the person's edit lands)
--   2. update_my_identity  → UPDATE people …   (its own last statement)
--   3. person_mirror_down fires → team_members.year = people.year = '5'
--
-- Proved live in a rolled-back transaction before this migration was written:
--   A. before                        tm_year=5  people_year=5
--   B. after PATCH year=3            tm_year=3  people_year=5
--   C. after update_my_identity tail tm_year=5  people_year=5
--
-- This is class 6 in .claude/rules/mistakes.md wearing new clothes: a
-- bidirectional mirror that is bidirectional on eight columns and one-way on
-- the ninth. The `is distinct from` guard cannot catch it — the guard is a
-- TERMINATION condition, not a completeness check, and a column that is only
-- ever written downhill looks perfectly settled to it.
--
-- ---------------------------------------------------------------------------
-- CAUSE 2 — TWO IMPLEMENTATIONS OF ONE FACT (the three different answers).
--
-- ระบบบ้าน DERIVES ชั้นปี: `ปีการศึกษา − ปีที่เข้า + 1 + year_offset` (0131), where
-- ปีที่เข้า is read off the รหัสนักศึกษา and re-derived whenever the รหัส moves
-- (0128). ทีม SAMO STORES it, in `team_members.year`, and nothing has ever
-- bumped it — src/js/house/fields.js has carried a comment predicting this
-- exact failure since 0131:
--
--   "`team_members.year` is still that column (399 rows, and nothing anywhere in
--    this repo has ever bumped it — verified by grep, so every August all 399
--    quietly become last year's answer)."
--
-- It is now that August. Measured on the live data at ปีการศึกษา 2569:
--   371 rows  stored = derived
--    10 rows  stored ≠ derived  ← nine of them are exactly ONE year behind
--    13 rows  stored, but no รหัสนักศึกษา to derive from
--     3 rows  no stored value, derivable
--
-- ---------------------------------------------------------------------------
-- THE ANSWER TO "SHOULD CHANGING รหัสนักศึกษา CHANGE ชั้นปี?"
--
-- Yes — because it is not a side effect, it is the same fact said once. The
-- รหัส encodes ปีที่เข้า; ชั้นปี is ปีการศึกษา minus ปีที่เข้า. Correcting a mistyped
-- รหัส and NOT moving the ชั้นปี would leave the record asserting that someone
-- who entered in 2560 is in their fifth year in 2569.
--
-- What must NOT be recomputed is the part that is genuinely about the person:
-- ลาพัก / เรียนซ้ำ / จบช้า. That is `year_offset`, a DIFFERENCE, and a difference
-- survives a corrected รหัส unchanged — which is the whole reason 0131 chose it
-- over an absolute year. So the intuition behind "it shouldn't change" is right;
-- it is satisfied by keeping the OFFSET, not by freezing the YEAR.
--
-- ---------------------------------------------------------------------------
-- WHAT THIS MIGRATION DOES
--
--   §1  people.cohort_year re-derives when the รหัส moves (0128's rule, which
--       students has had since 0128 and the REGISTRY never got).
--   §2  Backfill people.cohort_year — from the รหัส where there is one, and
--       otherwise CONVERTED from the stored ชั้นปี. Converting rather than
--       discarding is the point: 13 members have a ชั้นปี and no รหัส, and
--       blanking their card to punish them for a missing field would be a
--       regression they can see and cannot fix.
--   §3  team_members gains `cohort_year` + `year_offset`, mirrored DOWN from the
--       registry. They are the two ingredients `studyYear()` already takes, so
--       the ทีม SAMO surfaces can compute the same answer ระบบบ้าน computes
--       without a join and without a second rule.
--   §4  person_mirror_down stops carrying `year` and starts carrying those two.
--   §5  update_my_identity learns `year_offset` for a member with NO students
--       row, so the ชั้นปี chooser on the seat card works for everyone.
--
-- `team_members.year` and `people.year` are LEFT IN PLACE. The served bundle
-- still names `year`, and 0129 took ระบบบ้าน's admin tab down for 20 minutes by
-- dropping a column the served bundle still named. They are dropped in a later
-- migration, AFTER the bundle that stopped reading them is confirmed served.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- §1 — a corrected รหัสนักศึกษา re-derives ปีที่เข้า ON THE REGISTRY TOO.
--
-- `students_fill_cohort` (0128) has done this for `public.students` since the
-- owner reported "เปลี่ยนรหัสนักศึกษาเป็น 59… หรือ 64… แล้วรุ่นไม่เปลี่ยนตาม".
-- `public.people` — which is now THE person table, and the only one a ทีม SAMO
-- member without a house placement has — never got it. Without this, `people`
-- would become the new fill-once column the moment ทีม SAMO started reading it.
-- ---------------------------------------------------------------------------
create or replace function public.people_fill_cohort()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    if new.cohort_year is null and new.student_id is not null then
      new.cohort_year := public.cohort_from_student_id(new.student_id);
    end if;
    return new;
  end if;

  -- The caller set cohort_year themselves in this statement: their value wins.
  -- (This is also what lets §2's backfill stand, and what keeps a deliberate
  -- correction from being undone by the next unrelated update.)
  if new.cohort_year is distinct from old.cohort_year then
    return new;
  end if;

  if new.student_id is distinct from old.student_id then
    -- The รหัส moved, so the รุ่น it encodes moved with it. An unreadable รหัส
    -- gives NULL, which renders as no รุ่น — better than the รุ่น of a number
    -- the row no longer holds.
    new.cohort_year := public.cohort_from_student_id(new.student_id);
  elsif new.cohort_year is null and new.student_id is not null then
    new.cohort_year := public.cohort_from_student_id(new.student_id);
  end if;
  return new;
end;
$$;

drop trigger if exists people_fill_cohort on public.people;
create trigger people_fill_cohort
  before insert or update on public.people
  for each row execute function public.people_fill_cohort();

comment on function public.people_fill_cohort() is
  '0145 — re-derives people.cohort_year whenever student_id moves. The registry '
  'twin of students_fill_cohort (0128). A derived column filled once and never '
  're-derived is the "fill-once means never-correct" failure that report named.';

-- ---------------------------------------------------------------------------
-- §2 — the two ingredients, on the placement.
--
-- WHY MIRROR RATHER THAN JOIN. Every ทีม SAMO read path already selects
-- `team_members.*` and every identity field on it is already a mirror of the
-- registry (student_id, major, nickname, the name split, the portrait). Adding a
-- join for two smallints would make ชั้นปี the one field that needs a different
-- read shape, on paths whose RLS was written for the flat select. Mirroring is
-- the pattern this table already IS.
--
-- WHY DOWN ONLY. These are registry facts. `cohort_year` is derived from the
-- รหัส by §1, and `year_offset` is the person's own ลาพัก / เรียนซ้ำ fact, set on
-- their own card. Nothing in ทีม SAMO owns either, so nothing in ทีม SAMO writes
-- either — and `team_members_self_update_guard` does not list them, so a member
-- cannot PATCH them directly.
-- ---------------------------------------------------------------------------
alter table public.team_members
  add column if not exists cohort_year smallint,
  add column if not exists year_offset smallint;

comment on column public.team_members.cohort_year is
  '0145 — ปีที่เข้า, MIRRORED DOWN from people.cohort_year. Read-only here: the '
  'registry owns it and people_fill_cohort re-derives it from the รหัส. One of '
  'the two ingredients studyYear() needs, so ทีม SAMO computes the same ชั้นปี '
  'ระบบบ้าน computes instead of storing a second answer.';

comment on column public.team_members.year_offset is
  '0145 — the GAP between the computed ชั้นปี and the real one (ลาพัก / เรียนซ้ำ / '
  'จบช้า), MIRRORED DOWN from people.year_offset. A difference stays correct in '
  '2570 and 2575; an absolute year does not, which is what team_members.year '
  'proved by drifting one year behind on nine rows.';

comment on column public.team_members.year is
  'DEAD as of 0145 — ชั้นปี is derived from cohort_year + year_offset now. Kept '
  'only until the bundle that stopped reading it is confirmed SERVED (0129 took '
  'prod down for 20 min by dropping first). Do not add a reader.';

comment on column public.people.year is
  'DEAD as of 0145 — see team_members.year. Never mirrored UP from the posting, '
  'which is exactly how it came to overwrite a person edit with a stale value.';

-- ---------------------------------------------------------------------------
-- §3 — the mirror carries the ingredients, and stops carrying the answer.
--
-- ⚠️ THIS COMES BEFORE THE BACKFILL, AND THE ORDER IS THE WHOLE POINT.
-- The backfill in §4 UPDATEs `people`, which fires this trigger. Run against the
-- OLD body — the one that pushes `people.year` into `team_members.year` — it
-- would blank the ชั้นปี of the 109 postings whose registry row never received a
-- `year`, and it would blank them for the bundle that is still SERVED at the
-- moment the migration runs. Redefining the trigger first makes the backfill
-- inert on that column.
--
-- ⚠️ THE `app.team_sync` SAVE/RESTORE IS LOAD-BEARING, NOT TIDINESS.
-- `team_members_self_update_guard` (0110) refuses a non-admin write that touches
-- any column outside its allow-list, and `cohort_year` / `year_offset` are
-- deliberately outside it. This function is a SERVER writer — precisely what the
-- `app.team_sync` exemption exists for — so it sets the flag around its own
-- statement.
--
-- It RESTORES the previous value rather than blanking it. `set_config(…, true)`
-- is TRANSACTION-scoped, and this trigger runs nested inside writers that set the
-- same flag: update_my_identity PATCHes several postings in one statement, so the
-- BEFORE guard fires per row while this AFTER trigger fires between them. Blanking
-- the flag here would let row 1's mirror disarm the guard exemption for row 2, and
-- the save would fail with a permissions error on a person who has two postings —
-- a bug that only appears for members with more than one ตำแหน่ง.
-- ---------------------------------------------------------------------------
create or replace function public.person_mirror_down()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_prev text := coalesce(current_setting('app.team_sync', true), '');
begin
  perform set_config('app.team_sync', '1', true);

  -- `year` is NOT here any more, and must never come back: ชั้นปี is derived
  -- from the two columns below it. What travels is the INGREDIENTS.
  update public.team_members m
     set full_name     = new.full_name,
         first_name_th = new.first_name_th,
         last_name_th  = new.last_name_th,
         nickname    = new.nickname,
         major       = new.major,
         photo_url   = new.photo_url,
         photo_focus = new.photo_focus,
         student_id  = new.student_id,
         cohort_year = new.cohort_year,
         year_offset = new.year_offset,
         kkumail     = new.kkumail,
         user_id     = coalesce(new.user_id, m.user_id)
   where m.person_id = new.id
     and (m.full_name, m.first_name_th, m.last_name_th, m.nickname,
          m.major, m.photo_url, m.photo_focus, m.student_id,
          m.cohort_year, m.year_offset, m.kkumail)
         is distinct from
         (new.full_name, new.first_name_th, new.last_name_th, new.nickname,
          new.major, new.photo_url, new.photo_focus, new.student_id,
          new.cohort_year, new.year_offset, new.kkumail);

  perform set_config('app.team_sync', v_prev, true);

  -- The house half. `sai_code` is NOT here and never will be: it is the
  -- university's advisor assignment and it decides the house, so it belongs to
  -- the placement, not to the identity.
  --
  -- `nickname_self` carries the nickname (0134) — `students.nickname` itself is
  -- GENERATED and writing it would 428C9. The guard compares the GENERATED
  -- value, because that is what a reader sees and therefore what "already in
  -- sync" has to mean; comparing `nickname_self` would keep firing forever for
  -- a row whose value comes from `nickname_imported`.
  --
  -- `cohort_year` travels here too (0145). students has its own fill trigger,
  -- but a REGISTRY-side correction — the seat card is now a writer of the
  -- รหัสนักศึกษา for a person who also has a house placement — has to reach it,
  -- or ระบบบ้าน keeps the รุ่น of a number the row no longer holds.
  update public.students s
     set first_name_th = new.first_name_th,
         last_name_th  = new.last_name_th,
         nickname_self = coalesce(new.nickname, s.nickname_self),
         student_id    = new.student_id,
         major         = new.major,
         cohort_year   = new.cohort_year,
         year_offset   = new.year_offset,
         photo_url     = new.photo_url,
         photo_focus   = new.photo_focus,
         bio           = new.bio
   where s.person_id = new.id
     and (s.first_name_th, s.last_name_th, s.nickname, s.student_id, s.major,
          s.cohort_year, s.year_offset, s.photo_url, s.photo_focus, s.bio)
         is distinct from
         (new.first_name_th, new.last_name_th, new.nickname, new.student_id,
          new.major, new.cohort_year, new.year_offset, new.photo_url,
          new.photo_focus, new.bio);
  return new;
end;
$$;

comment on function public.person_mirror_down() is
  '0145 — carries the ชั้นปี INGREDIENTS (cohort_year, year_offset) to both '
  'placements and no longer carries `year`, which it used to push downhill only. '
  'That one-way column is what reverted a person''s own ชั้นปี edit: the seat '
  'card PATCHed team_members, update_my_identity then touched people, and this '
  'trigger wrote the stale registry value straight back over it.';

-- ---------------------------------------------------------------------------
-- §4 — backfill ปีที่เข้า, CONVERTING the stored ชั้นปี rather than dropping it.
--
-- Three sources, in this order:
--   a) whatever the house placement already worked out;
--   b) the รหัสนักศึกษา — authoritative, and what the 10 disagreeing rows will
--      now show (nine of them are exactly one year stale, which IS the bug);
--   c) for a row with a ชั้นปี and NO readable รหัส, the ชั้นปี itself, read
--      against the CURRENT ปีการศึกษา: ปีที่เข้า = ปีการศึกษา − ชั้นปี + 1.
--
-- (c) is a one-time reading of a value we are about to stop maintaining, taken
-- at the last moment we still know what it meant. 371 of 394 stored values agree
-- with ปีการศึกษา 2569, so the corpus is current and the reading is sound. The
-- alternative — deriving only from the รหัส — would blank the ชั้นปี of the 13
-- members who have one and no รหัส, which is a regression they can see and
-- cannot fix. Converting is also self-correcting: it surfaces as a รุ่น on their
-- own card, next to the รหัสนักศึกษา box that would fix it properly.
-- ---------------------------------------------------------------------------
update public.people p
   set cohort_year = s.cohort_year
  from public.students s
 where s.person_id = p.id
   and p.cohort_year is null
   and s.cohort_year is not null;

update public.people p
   set cohort_year = public.cohort_from_student_id(p.student_id)
 where p.cohort_year is null
   and public.cohort_from_student_id(p.student_id) is not null;

update public.people p
   set cohort_year = (public.get_academic_year() - (btrim(p.year))::int + 1)
 where p.cohort_year is null
   and p.year ~ '^[1-6]$'
   and public.get_academic_year() is not null;

-- A member whose REGISTRY row carries no ชั้นปี but whose POSTING does. `people`
-- only ever received `year` from 0132's one-off backfill and team_member_mirror_up
-- has never carried it, so 109 postings hold a ชั้นปี the registry never saw —
-- the same asymmetry, seen from the other end.
update public.people p
   set cohort_year = (public.get_academic_year() - (btrim(m.year))::int + 1)
  from public.team_members m
 where m.person_id = p.id
   and p.cohort_year is null
   and m.year ~ '^[1-6]$'
   and public.get_academic_year() is not null;

-- The registry now owns the ingredients — hand the placements the current values
-- once, so nothing waits for the next unrelated edit to look right.
update public.team_members m
   set cohort_year = p.cohort_year,
       year_offset = p.year_offset
  from public.people p
 where p.id = m.person_id
   and (m.cohort_year, m.year_offset) is distinct from (p.cohort_year, p.year_offset);

-- ---------------------------------------------------------------------------
-- §5 — a member with NO house placement can still say "I am ลาพัก".
--
-- `update_my_identity` delegates every validated field to
-- `update_my_student_record`, which raises when there is no `students` row —
-- so it only runs it for someone who has one. `year_offset` was reachable ONLY
-- through that path, which meant the ชั้นปี chooser on the seat card would have
-- silently done nothing for every ทีม SAMO member who is not in ระบบบ้าน. That is
-- the same "a fix on one path is not a fix" shape as the report that started this.
--
-- For a person WITH a students row the offset still goes through
-- update_my_student_record (it owns self_edited, which is what stops the next
-- import overwriting the choice) and mirrors up to people from there. This branch
-- is only for the ones that path cannot reach.
-- ---------------------------------------------------------------------------
create or replace function public.update_my_identity(p_patch jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
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
         -- m.full_name — see 0135's header.
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
  --
  -- NOTE the year_offset branch. For a person with a students row that row is
  -- authoritative (update_my_student_record has already validated and stamped
  -- self_edited), so the registry takes its value. For a ทีม SAMO member with no
  -- house placement there is no students row to have taken it, and the patch is
  -- the only thing carrying it — without this branch their ชั้นปี chooser would
  -- post successfully and change nothing, which is the exact symptom 0145 exists
  -- to remove. 0 and NULL both mean "exactly as computed" (0131).
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

  if not v_has_house and p_patch ? 'year_offset' then
    update public.people p
       set year_offset = nullif(
             nullif(btrim(coalesce(p_patch->>'year_offset','')), '')::smallint, 0)
     where p.id in (select person_id from public.team_members
                     where lower(btrim(kkumail)) = lower(btrim(v_email))
                       and person_id is not null);
  end if;

  return public.get_my_profile();
end;
$$;

-- ---------------------------------------------------------------------------
-- §6 — get_my_team_seat() hands the card the ingredients.
--
-- The seat card renders ชั้นปี and offers the chooser, so it needs exactly what
-- studyYear() takes. `year` still travels for one release: the SERVED bundle
-- reads it, and this RPC ships before that bundle does.
-- ---------------------------------------------------------------------------
create or replace function public.get_my_team_seat()
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $$
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
                  'student_id_shared_with', 0, 'term_year', null,
                  'academic_year', null);
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
      -- DEAD (0145), still sent for one release so the currently-served bundle
      -- keeps rendering. The new bundle ignores it and derives from the two
      -- ingredients below.
      'year',       m.year,
      'cohort_year', m.cohort_year,
      'year_offset', m.year_offset,
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
    'term_year',       v_term,
    -- The ปีการศึกษา this card must compute ชั้นปี against (0141). Sent WITH the
    -- payload rather than fetched separately because the card is rendered from
    -- one await: a second, racing fetch is how the ชั้นปี would paint against the
    -- clock fallback and then never repaint.
    'academic_year',   public.get_academic_year()
  );
end;
$$;
