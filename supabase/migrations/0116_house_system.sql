-- ============================================================
-- 0116 — ระบบบ้าน (House) + the student directory.
--
-- WHAT THIS IS
-- Every student in the faculty (~1,800, ปี 1–6) gets a record they can see by
-- signing in with their kkumail, and a HOUSE. Design doc: docs/HOUSE-SYSTEM.md.
-- Handover spec for the data we import: docs/house-data-spec-th.md.
--
-- THE ONE RULE EVERYTHING HANGS OFF
--   house = the LAST DIGIT of สายรหัส
-- สายรหัส is 3 digits, '001'–'100' → 100 สาย → exactly 10 houses × 10 สาย.
-- (Verified: the last digit partitions 001..100 into ten groups of ten, with
-- '100' landing in house 0 alongside '010'..'090'.)
--
-- สายรหัส is the UNIVERSITY's อาจารย์ที่ปรึกษา assignment, handed out at random.
-- It is NOT derivable from รหัสนักศึกษา and nothing here may compute, infer or
-- "repair" one. It is imported data; a row without one is blank, never guessed.
--
-- WHY NOT team_people
-- team_people is the SAMO org roster (~285 rows) and every row is
-- permission-bearing: ten resolvers (effective_team_*_for_email) join through
-- team_members to decide what someone may do. Putting 1,800 ordinary students
-- inside the permission engine's blast radius buys nothing and breaks every
-- proof script's row counts. Separate tables; the join to a SAMO posting is
-- kkumail, the same key 0108 already treats as identity because it is the only
-- one the user PROVES (Google login) rather than types.
--
-- PRIVACY POSTURE (this is the part that has to be right)
-- students holds 1,800 kkumail addresses and รหัสนักศึกษา. This repo has the
-- rule written down twice (0086, 0103) and paid for it once (0108): a table
-- holding kkumail/รหัส gets NO public SELECT policy, ever. Anything published
-- is a hand-built PROJECTION naming its columns, so a column added by a future
-- migration is not published by accident.
-- ============================================================

-- ------------------------------------------------------------
-- §1 — Settings (exactly one row)
-- ------------------------------------------------------------
create table if not exists public.house_settings (
  id             boolean primary key default true check (id),
  -- ปีการศึกษาปัจจุบัน (พ.ศ.). ชั้นปี is DERIVED from this and cohort_year, never
  -- stored per student: a stored ชั้นปี is wrong for everyone the moment the
  -- academic year rolls over, and wrong immediately for anyone who ลาพัก.
  academic_year  smallint not null default 2569,
  -- NO reveal flag, deliberately. A house has no name until an admin types one,
  -- so before the จับฉลาก there is simply nothing to hide — `name is null` is
  -- already the whole "not revealed yet" state, and the UI falls back to
  -- "บ้าน N". A revealed_at column would have been a second source of truth for
  -- a fact the data already carries.
  -- While set (and in the future), a student may correct their OWN สายรหัส.
  -- After it passes, corrections go through student_change_requests instead.
  -- The point is timing, not permission: before the reveal a สาย change is not
  -- a house transfer in anyone's mind, so corrections are free. See §7 of the
  -- design doc.
  sai_edit_until timestamptz,
  -- Whether students may see the name-only roster of their own house.
  roster_visible boolean not null default true,
  updated_at     timestamptz not null default now()
);
insert into public.house_settings (id) values (true) on conflict (id) do nothing;

-- ------------------------------------------------------------
-- §2 — The ten houses. Seeded, never created, never deleted.
--
-- The house set is defined by the DIGIT, not by an admin: an 11th house is
-- unreachable by the rule above and a deleted house would orphan ten สาย. So
-- there is no INSERT and no DELETE policy anywhere below — only UPDATE. The
-- admin UI offers edit + "reset to placeholder", which covers everything the
-- feature actually needs (set a name, upload a logo, change them later).
-- ------------------------------------------------------------
create table if not exists public.houses (
  id          smallint primary key check (id between 0 and 9),
  name        text,
  slogan      text,
  color       text,
  icon_url    text,
  icon_focus  text check (icon_focus is null or icon_focus in ('top','center','bottom')),
  updated_at  timestamptz not null default now()
);

insert into public.houses (id)
select g from generate_series(0, 9) g
on conflict (id) do nothing;

comment on table public.houses is
  'Exactly ten rows, 0–9, seeded by migration 0116. house = last digit of '
  'สายรหัส, so the set is fixed by the rule: no create, no delete.';

-- ------------------------------------------------------------
-- §3 — สายรหัส. house_id is GENERATED, so the rule cannot drift.
--
-- A stored generated column means the house rule lives in exactly ONE place and
-- JS never computes it — it reads house_id off the row. "Two implementations of
-- one rule drift" is the single most repeated bug in this repo; this is the
-- cheapest possible way to have exactly one implementation.
--
-- right(text,int) and the text→smallint cast are both IMMUTABLE, which is what
-- a generated column requires.
--
-- The width is checked (exactly 3 digits) rather than the range, because the
-- failure this actually has to catch is Excel eating a leading zero — '001'
-- arriving as '1' would silently become a DIFFERENT สาย in a different house.
-- ------------------------------------------------------------
create table if not exists public.sais (
  code       text primary key check (code ~ '^[0-9]{3}$'),
  house_id   smallint generated always as ((right(code, 1))::smallint) stored,
  label      text,
  note       text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists sais_house_idx on public.sais (house_id);

comment on column public.sais.house_id is
  'GENERATED from code — the last digit. Never write this column; never compute '
  'the house anywhere else. Changing the rule means changing it here only.';

-- ------------------------------------------------------------
-- §4 — อาจารย์ที่ปรึกษา, and which สาย they advise.
--
-- Two tables, not one: an อาจารย์ may advise several สาย, and "อาจารย์ทั้งหมด
-- ในบ้าน" has to de-duplicate them. Storing the person on the link row would
-- make the same human three rows that drift apart — 0108 all over again.
-- ------------------------------------------------------------
create table if not exists public.advisors (
  id            uuid primary key default gen_random_uuid(),
  -- Academic title kept OUT of the name, so it can be rendered or not.
  title         text,
  first_name_th text not null,
  last_name_th  text,
  full_name     text generated always as (
                  btrim(coalesce(first_name_th,'') || ' ' || coalesce(last_name_th,''))
                ) stored,
  email         text,
  dept          text,
  photo_url     text,
  photo_focus   text check (photo_focus is null or photo_focus in ('top','center','bottom')),
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Partial, so advisors without a known address coexist.
create unique index if not exists advisors_email_uniq
  on public.advisors (lower(btrim(email)))
  where email is not null and btrim(email) <> '';

create table if not exists public.sai_advisors (
  sai_code   text not null references public.sais(code) on update cascade on delete cascade,
  advisor_id uuid not null references public.advisors(id) on delete cascade,
  role       text not null default 'primary' check (role in ('primary','secondary')),
  position   smallint not null default 0,
  created_at timestamptz not null default now(),
  primary key (sai_code, advisor_id)
);

create index if not exists sai_advisors_advisor_idx on public.sai_advisors (advisor_id);

-- ------------------------------------------------------------
-- §5 — Import batches, so an import is auditable and identifiable.
-- ------------------------------------------------------------
create table if not exists public.student_import_batches (
  id              uuid primary key default gen_random_uuid(),
  file_name       text,
  uploaded_by     uuid references auth.users(id) on delete set null,
  uploaded_at     timestamptz not null default now(),
  row_count       integer not null default 0,
  inserted_count  integer not null default 0,
  updated_count   integer not null default 0,
  unchanged_count integer not null default 0,
  problem_count   integer not null default 0,
  notes           text
);

-- ------------------------------------------------------------
-- §6 — The students.
--
-- THE IMPORT/SELF-EDIT SPLIT, which is the property that makes this table safe
-- to re-import into forever:
--   • identity columns  → written by the IMPORT only
--   • photo/bio/…       → written by the STUDENT only (import has no source)
--   • nickname          → contested, so it is TWO columns and a generated third
-- The import can therefore run any number of times and can never destroy what a
-- student typed. That is what lets you accept a corrected file in October
-- without auditing what 1,800 people changed in September.
-- ------------------------------------------------------------
create table if not exists public.students (
  id                uuid primary key default gen_random_uuid(),

  -- ---- identity: IMPORT-ONLY ----
  kkumail           text not null,
  student_id        text,
  first_name_th     text not null,
  last_name_th      text,
  full_name         text generated always as (
                      btrim(coalesce(first_name_th,'') || ' ' || coalesce(last_name_th,''))
                    ) stored,
  major             text,
  -- No FK cascade to a house: the house comes from sais.house_id by join, never
  -- copied here. A denormalised house column is the drift class waiting to
  -- happen — and it would go stale the moment a สาย is corrected.
  sai_code          text references public.sais(code) on update cascade on delete set null,
  cohort_year       smallint,
  status            text not null default 'active'
                    check (status in ('active','leave','withdrawn','graduated')),

  -- ---- nickname: the one contested field ----
  nickname_imported text,
  nickname_self     text,
  nickname          text generated always as (
                      coalesce(nullif(btrim(coalesce(nickname_self,'')), ''), nickname_imported)
                    ) stored,

  -- ---- SELF-ONLY: the import must never write these ----
  photo_url         text,
  photo_focus       text check (photo_focus is null or photo_focus in ('top','center','bottom')),
  bio               text,
  -- The escape hatch for ลาพัก / เรียนซ้ำ / จบช้า, so "what year are you" never
  -- needs an admin.
  year_override     smallint check (year_override between 1 and 12),
  -- PDPA-shaped opt-out of the house roster. Defaults to listed, which is the
  -- point of the roster, but one switch turns it off.
  is_listed         boolean not null default true,

  -- ---- bookkeeping ----
  user_id           uuid references auth.users(id) on delete set null,
  verified_at       timestamptz,
  sai_locked        boolean not null default false,
  sai_self_edits    smallint not null default 0,
  last_import_batch uuid references public.student_import_batches(id) on delete set null,
  -- Set when a row is absent from the newest import. The importer NEVER deletes
  -- — a blind sync would wipe self-edits and anyone the source happened to omit.
  missing_since     timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- kkumail IS the identity (0108's lesson: it is proven, รหัส is typed).
create unique index if not exists students_kkumail_uniq
  on public.students (lower(btrim(kkumail)));
create unique index if not exists students_sid_uniq
  on public.students (student_id)
  where student_id is not null and btrim(student_id) <> '';
create index if not exists students_sai_idx on public.students (sai_code);
create index if not exists students_user_idx on public.students (user_id);

comment on table public.students is
  'One row per student in the faculty. Identity columns are import-only, '
  'photo/bio/year_override/is_listed are self-only, nickname is both (see the '
  'nickname_imported/nickname_self pair). NEVER add a public SELECT policy: '
  'every row carries a kkumail and a รหัสนักศึกษา.';

-- ------------------------------------------------------------
-- §7 — The correction queue.
-- ------------------------------------------------------------
create table if not exists public.student_change_requests (
  id            uuid primary key default gen_random_uuid(),
  student_ref   uuid not null references public.students(id) on delete cascade,
  field         text not null check (field in
                  ('sai_code','student_id','kkumail','first_name_th',
                   'last_name_th','major','cohort_year')),
  current_value text,
  requested_value text,
  reason        text,
  status        text not null default 'pending'
                check (status in ('pending','approved','rejected')),
  decided_by    uuid references auth.users(id) on delete set null,
  decided_at    timestamptz,
  decision_note text,
  created_at    timestamptz not null default now()
);

create index if not exists scr_status_idx on public.student_change_requests (status, created_at desc);
-- One OPEN request per field per student — the queue must not be floodable.
create unique index if not exists scr_one_open_per_field
  on public.student_change_requests (student_ref, field)
  where status = 'pending';

-- ------------------------------------------------------------
-- §8 — touch triggers
-- ------------------------------------------------------------
create or replace function public.touch_house_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end;
$$;

do $$
declare t text;
begin
  foreach t in array array['house_settings','houses','sais','advisors','students']
  loop
    execute format('drop trigger if exists touch_%1$s on public.%1$s', t);
    execute format(
      'create trigger touch_%1$s before update on public.%1$s '
      'for each row execute function public.touch_house_updated_at()', t);
  end loop;
end $$;

-- ------------------------------------------------------------
-- §9 — RLS. One new permission key: `house`.
--
-- `master` (0111) already answers true for any key via
-- current_user_has_permission(), so nothing extra is needed for it.
--
-- `revoke all from anon` on every table EXPLICITLY. RLS with no anon policy
-- already returns zero rows, but Supabase's default privileges hand `anon` a
-- SELECT grant on new public tables, and the passport lockdown is the entry in
-- mistakes.md that says a revoke you can SEE beats a denial you have to reason
-- about.
-- ------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['house_settings','houses','sais','advisors',
                           'sai_advisors','students','student_change_requests',
                           'student_import_batches']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('drop policy if exists "%1$s_admin_all" on public.%1$s', t);
    -- FOR ALL: read and write together. There is no view/edit split here yet —
    -- one rung on purpose (design doc §5). A second rung later is a policy edit,
    -- not a redesign.
    execute format($f$
      create policy "%1$s_admin_all" on public.%1$s
        for all to authenticated
        using (public.current_user_role() = any (array['vp_admin','dev'])
               or public.current_user_has_permission('house'))
        with check (public.current_user_role() = any (array['vp_admin','dev'])
               or public.current_user_has_permission('house'))
    $f$, t);
  end loop;
end $$;

-- houses is seeded and fixed at ten: no INSERT, no DELETE, for anybody. The
-- FOR ALL policy above would otherwise permit both.
revoke insert, delete on public.houses from authenticated;
revoke delete on public.house_settings from authenticated;
revoke insert on public.house_settings from authenticated;

-- NOTE there is deliberately NO self-UPDATE policy on students. A per-row
-- UPDATE policy is a ROW filter, never a COLUMN policy — this repo has been
-- bitten by exactly that on users (0028), vs_tickets (0096) and shop_orders
-- (0100). Self-writes go through update_my_student_record() below, which has a
-- hard column allow-list inside the function. Not having the policy is stronger
-- than guarding it.

-- ------------------------------------------------------------
-- §10 — ชั้นปี, derived in ONE place.
-- ------------------------------------------------------------
-- STABLE, not IMMUTABLE: it reads house_settings.academic_year, and an
-- immutable function that reads a table can be constant-folded to a stale value.
create or replace function public.student_year(p_cohort smallint, p_override smallint)
returns smallint language sql stable as $$
  select case
    when p_override is not null then p_override
    when p_cohort is null then null
    else greatest(1, (select academic_year from public.house_settings where id) - p_cohort + 1)::smallint
  end;
$$;

-- ------------------------------------------------------------
-- §11 — The caller's OWN record.
--
-- Same shape as get_my_team_seat() (0109): SECURITY DEFINER, takes NO argument
-- so there is no address to probe with, and returns a hand-built jsonb
-- allow-list rather than `returns setof public.students` — the latter would
-- auto-expose every column a future migration adds (the 0079/0080 trap).
--
-- The house name/slogan/icon are returned as-is. There is no reveal gate:
-- an unnamed house IS the un-revealed state, so the "hidden" case needs no
-- mechanism — the UI renders "บ้าน N" whenever name is null.
-- ------------------------------------------------------------
create or replace function public.get_my_student_record()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_uid      uuid := auth.uid();
  v_email    text;
  s          public.students%rowtype;
  v_house    public.houses%rowtype;
  v_sai      public.sais%rowtype;
  v_settings public.house_settings%rowtype;
  v_advisors jsonb := '[]'::jsonb;
  v_house_advisors jsonb := '[]'::jsonb;
begin
  if v_uid is null then return null; end if;
  select email into v_email from public.users where id = v_uid;
  -- A blank email must not match `lower(kkumail) = ''`.
  if v_email is null or length(btrim(v_email)) = 0 then return null; end if;

  select * into s from public.students
   where lower(btrim(kkumail)) = lower(btrim(v_email));
  if not found then return null; end if;

  select * into v_settings from public.house_settings where id;

  if s.sai_code is not null then
    select * into v_sai from public.sais where code = s.sai_code;
    select * into v_house from public.houses where id = v_sai.house_id;

    -- This student's own สาย advisors.
    select coalesce(jsonb_agg(jsonb_build_object(
             'title', a.title, 'name', a.full_name, 'email', a.email,
             'dept', a.dept, 'photo_url', a.photo_url, 'role', sa.role)
             order by sa.position, a.full_name), '[]'::jsonb)
      into v_advisors
      from public.sai_advisors sa
      join public.advisors a on a.id = sa.advisor_id
     where sa.sai_code = s.sai_code and a.is_active;

    -- Every advisor in the house, de-duplicated across its ten สาย.
    select coalesce(jsonb_agg(x order by x->>'name'), '[]'::jsonb)
      into v_house_advisors
      from (
        select distinct jsonb_build_object(
                 'title', a.title, 'name', a.full_name,
                 'dept', a.dept, 'photo_url', a.photo_url, 'sai', sa.sai_code) as x
          from public.sai_advisors sa
          join public.advisors a on a.id = sa.advisor_id
          join public.sais sx on sx.code = sa.sai_code
         where sx.house_id = v_sai.house_id and a.is_active
      ) d;
  end if;

  return jsonb_build_object(
    'kkumail',     s.kkumail,
    'student_id',  s.student_id,
    'full_name',   s.full_name,
    'first_name',  s.first_name_th,
    'last_name',   s.last_name_th,
    'nickname',    s.nickname,
    'nickname_self', s.nickname_self,
    'major',       s.major,
    'cohort_year', s.cohort_year,
    'year',        public.student_year(s.cohort_year, s.year_override),
    'year_override', s.year_override,
    'status',      s.status,
    'photo_url',   s.photo_url,
    'photo_focus', s.photo_focus,
    'bio',         s.bio,
    'is_listed',   s.is_listed,
    'verified_at', s.verified_at,
    'sai',         s.sai_code,
    'sai_label',   v_sai.label,
    'sai_locked',  s.sai_locked,
    -- Can this person still fix their own สายรหัส without asking anyone?
    'sai_editable', (not s.sai_locked)
                    and v_settings.sai_edit_until is not null
                    and v_settings.sai_edit_until > now(),
    'sai_edit_until', v_settings.sai_edit_until,
    'house_id',    case when s.sai_code is not null then v_sai.house_id end,
    -- Null until an admin names the house. The UI renders "บ้าน N" then.
    'house_name',  v_house.name,
    'house_slogan',v_house.slogan,
    'house_color', v_house.color,
    'house_icon',  v_house.icon_url,
    'advisors',    v_advisors,
    'house_advisors', v_house_advisors,
    'roster_visible', v_settings.roster_visible
  );
end;
$$;

revoke all on function public.get_my_student_record() from public;
revoke all on function public.get_my_student_record() from anon;
grant execute on function public.get_my_student_record() to authenticated;

-- ------------------------------------------------------------
-- §12 — The caller edits their OWN record.
--
-- The column allow-list is INSIDE the function and spelled out one field at a
-- time. There is no `update students set ... = p_patch` anywhere, because that
-- shape is how a self-edit becomes a self-promotion.
--
-- สายรหัส is handled separately and deliberately: allowed only while the
-- verification window is open, only if the row is not locked, and capped — so
-- a genuine typo self-resolves while it is free, and house-shopping does not.
-- ------------------------------------------------------------
create or replace function public.update_my_student_record(p_patch jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid      uuid := auth.uid();
  v_email    text;
  s          public.students%rowtype;
  v_settings public.house_settings%rowtype;
  v_new_sai  text;
begin
  if v_uid is null then raise exception 'ต้องเข้าสู่ระบบก่อน'; end if;
  select email into v_email from public.users where id = v_uid;
  if v_email is null or length(btrim(v_email)) = 0 then
    raise exception 'บัญชีนี้ไม่มีอีเมล';
  end if;

  select * into s from public.students
   where lower(btrim(kkumail)) = lower(btrim(v_email));
  if not found then raise exception 'ไม่พบข้อมูลนักศึกษาของบัญชีนี้'; end if;

  select * into v_settings from public.house_settings where id;

  -- The self-only columns. Every one named; nothing derived from the patch's
  -- key set.
  update public.students set
    nickname_self = case when p_patch ? 'nickname_self'
                         then nullif(btrim(coalesce(p_patch->>'nickname_self','')), '')
                         else nickname_self end,
    photo_url     = case when p_patch ? 'photo_url'
                         then nullif(btrim(coalesce(p_patch->>'photo_url','')), '')
                         else photo_url end,
    photo_focus   = case when p_patch ? 'photo_focus'
                         then nullif(btrim(coalesce(p_patch->>'photo_focus','')), '')
                         else photo_focus end,
    bio           = case when p_patch ? 'bio'
                         then nullif(btrim(coalesce(p_patch->>'bio','')), '')
                         else bio end,
    year_override = case when p_patch ? 'year_override'
                         then nullif(p_patch->>'year_override','')::smallint
                         else year_override end,
    is_listed     = case when p_patch ? 'is_listed'
                         then coalesce((p_patch->>'is_listed')::boolean, is_listed)
                         else is_listed end,
    verified_at   = case when coalesce((p_patch->>'verify')::boolean, false)
                         then now() else verified_at end
  where id = s.id;

  -- สายรหัส — its own gate, because it moves the house.
  if p_patch ? 'sai_code' then
    v_new_sai := nullif(btrim(coalesce(p_patch->>'sai_code','')), '');
    if v_new_sai is distinct from s.sai_code then
      if s.sai_locked then
        raise exception 'สายรหัสของคุณถูกล็อกไว้ กรุณาแจ้งผู้ดูแลระบบ';
      end if;
      if v_settings.sai_edit_until is null or v_settings.sai_edit_until <= now() then
        raise exception 'หมดช่วงเวลาแก้ไขสายรหัสด้วยตนเองแล้ว กรุณาส่งคำขอแก้ไขแทน';
      end if;
      if s.sai_self_edits >= 1 then
        raise exception 'คุณแก้ไขสายรหัสด้วยตนเองไปแล้ว หากยังไม่ถูกต้องกรุณาส่งคำขอแก้ไข';
      end if;
      if v_new_sai is not null and not exists (select 1 from public.sais where code = v_new_sai) then
        raise exception 'ไม่พบสายรหัส % ในระบบ', v_new_sai;
      end if;
      update public.students
         set sai_code = v_new_sai,
             sai_self_edits = sai_self_edits + 1
       where id = s.id;
    end if;
  end if;

  return public.get_my_student_record();
end;
$$;

revoke all on function public.update_my_student_record(jsonb) from public;
revoke all on function public.update_my_student_record(jsonb) from anon;
grant execute on function public.update_my_student_record(jsonb) to authenticated;

-- ------------------------------------------------------------
-- §13 — A student files a correction request for themselves.
-- ------------------------------------------------------------
create or replace function public.request_my_change(
  p_field text, p_requested text, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid   uuid := auth.uid();
  v_email text;
  s       public.students%rowtype;
  v_cur   text;
  v_id    uuid;
begin
  if v_uid is null then raise exception 'ต้องเข้าสู่ระบบก่อน'; end if;
  -- Allow-list, NOT `p_field` straight into the insert: the check constraint
  -- would catch a bad value, but an explicit list is what makes the SET of
  -- requestable fields reviewable in one place.
  if p_field not in ('sai_code','student_id','first_name_th','last_name_th',
                     'major','cohort_year') then
    raise exception 'ไม่รองรับการขอแก้ไขช่องนี้';
  end if;

  select email into v_email from public.users where id = v_uid;
  if v_email is null or length(btrim(v_email)) = 0 then
    raise exception 'บัญชีนี้ไม่มีอีเมล';
  end if;
  select * into s from public.students
   where lower(btrim(kkumail)) = lower(btrim(v_email));
  if not found then raise exception 'ไม่พบข้อมูลนักศึกษาของบัญชีนี้'; end if;

  v_cur := case p_field
    when 'sai_code'      then s.sai_code
    when 'student_id'    then s.student_id
    when 'first_name_th' then s.first_name_th
    when 'last_name_th'  then s.last_name_th
    when 'major'         then s.major
    when 'cohort_year'   then s.cohort_year::text
  end;

  insert into public.student_change_requests
    (student_ref, field, current_value, requested_value, reason)
  values (s.id, p_field, v_cur, nullif(btrim(coalesce(p_requested,'')),''),
          nullif(btrim(coalesce(p_reason,'')),''))
  on conflict (student_ref, field) where status = 'pending'
  do update set requested_value = excluded.requested_value,
                reason          = excluded.reason,
                created_at      = now()
  returning id into v_id;

  return jsonb_build_object('id', v_id, 'status', 'pending');
end;
$$;

revoke all on function public.request_my_change(text, text, text) from public;
revoke all on function public.request_my_change(text, text, text) from anon;
grant execute on function public.request_my_change(text, text, text) to authenticated;

-- ------------------------------------------------------------
-- §14 — The house roster: a PROJECTION, never a policy.
--
-- "Publishing a table-backed directory must be a PROJECTION, never a public
-- SELECT policy" is already an entry in docs/mistakes/authz-rls.md. This names
-- its six columns; kkumail, รหัสนักศึกษา, bio and status are not among them and
-- cannot become among them by a future ALTER TABLE.
--
-- authenticated only — anon has no business enumerating 180 students.
-- ------------------------------------------------------------
create or replace function public.get_house_roster(p_house smallint)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_settings public.house_settings%rowtype;
begin
  if auth.uid() is null then raise exception 'ต้องเข้าสู่ระบบก่อน'; end if;
  select * into v_settings from public.house_settings where id;
  if not v_settings.roster_visible then return '[]'::jsonb; end if;
  if p_house is null or p_house < 0 or p_house > 9 then return '[]'::jsonb; end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'name',     st.full_name,
             'nickname', st.nickname,
             'year',     public.student_year(st.cohort_year, st.year_override),
             'major',    st.major,
             'sai',      st.sai_code,
             'photo_url', st.photo_url)
             order by st.sai_code, st.full_name)
      from public.students st
      join public.sais sx on sx.code = st.sai_code
     where sx.house_id = p_house
       and st.is_listed
       and st.status in ('active','leave')
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.get_house_roster(smallint) from public;
revoke all on function public.get_house_roster(smallint) from anon;
grant execute on function public.get_house_roster(smallint) to authenticated;

-- ------------------------------------------------------------
-- §15 — The ten houses at a glance, for the landing card.
-- ------------------------------------------------------------
create or replace function public.get_house_summary()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'ต้องเข้าสู่ระบบก่อน'; end if;

  return jsonb_build_object(
    'houses', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', h.id,
               'name',   h.name,
               'slogan', h.slogan,
               'color',  h.color,
               'icon',   h.icon_url,
               'members', (select count(*) from public.students st
                            join public.sais sx on sx.code = st.sai_code
                           where sx.house_id = h.id and st.status in ('active','leave')),
               'sais',    (select count(*) from public.sais sx where sx.house_id = h.id))
               order by h.id)
        from public.houses h), '[]'::jsonb));
end;
$$;

revoke all on function public.get_house_summary() from public;
revoke all on function public.get_house_summary() from anon;
grant execute on function public.get_house_summary() to authenticated;

-- ------------------------------------------------------------
-- §16 — Seed the 100 สาย, '001'..'100'.
--
-- Seeded rather than created on import: the set is known in advance, and having
-- all 100 present means the admin สายรหัส pane can show which สาย have no
-- members and which have no อาจารย์ — both of which are the questions actually
-- being asked in September.
-- ------------------------------------------------------------
insert into public.sais (code)
select lpad(g::text, 3, '0') from generate_series(1, 100) g
on conflict (code) do nothing;

-- Sanity, checked at migration time rather than trusted: the last-digit rule
-- must put exactly ten สาย in each of the ten houses.
do $$
declare v_bad int;
begin
  select count(*) into v_bad from (
    select house_id, count(*) c from public.sais group by house_id
  ) d where d.c <> 10;
  if v_bad > 0 or (select count(distinct house_id) from public.sais) <> 10 then
    raise exception 'สาย→บ้าน mapping is not 10×10 — check the code width';
  end if;
end $$;
