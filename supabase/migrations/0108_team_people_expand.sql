-- ============================================================
-- 0108 — team_people: store each person ONCE. EXPAND STEP ONLY.
--
-- THE PROBLEM THIS SOLVES
-- A person is currently stored once per ตำแหน่ง. 403 team_members rows describe
-- ~285 humans, and every copy carries its own prefix / ชื่อเล่น / ชั้นปี /
-- สาขา / รูป / kkumail with nothing keeping them in step. Measured on live data:
-- 81 people hold 2–4 placements and 9 of them already DISAGREE with themselves
-- (วรวลัญช์ is "ปรายฟ้า" under one ฝ่าย and "ปลายฟ้า" under another). Two people
-- carry different kkumail on different rows, which is a live permission bug —
-- effective_team_permissions_for_email resolves by email, so they get different
-- สิทธิ์ depending on which address they sign in with.
--
-- It also makes the yearly import destructive-by-default: every year creates 403
-- fresh strangers, so a returning member re-uploads their portrait and re-types
-- their details. With identity separate from placement, next year's import
-- matches existing people and only creates the genuinely new ones.
--
-- WHY EXPAND-ONLY, AND WHAT IS DELIBERATELY NOT DONE HERE
-- Ten resolver functions (effective_team_*_for_email, node_effective_*,
-- sync_my_team_permissions) join on team_members.kkumail, and every proof script
-- in tools/ asserts against that shape. Repointing them in the same migration
-- that introduces the table would mean the permission engine and the identity
-- model both changing in one un-bisectable step.
--
-- So: this migration ADDS team_people, backfills it, links team_members.person_id,
-- and mirrors identity DOWNWARD (person → its placements). Nothing reads
-- team_people yet. Every existing query, policy, resolver and proof script sees
-- exactly the data it saw before. The contract step — switching writes to the
-- person and dropping the duplicated columns — is a later migration.
--
-- THE MIRROR IS ONE-DIRECTIONAL ON PURPOSE. A two-way mirror between a table and
-- its own denormalised copy is the "two implementations of one rule drift"
-- entry in mistakes.md wearing a trigger. Person → members only; while the UI
-- still writes to team_members, a person row simply goes stale, which is
-- harmless because nothing reads it.
--
-- THE RESOLUTION RULE (identical to src/js/team/health.js and
-- tools/team-identity-dryrun.mjs — three implementations, so the differential
-- test in tools/team0108-people.mjs is not optional):
--   1. rows sharing a valid kkumail        → one person
--   2. rows with NO kkumail sharing a รหัส → one person
--   3. anything else                        → its own person
-- NEVER on name. Live data has zero same-name-different-person cases, but
-- 673070332-6 is ONE mistyped รหัสนักศึกษา shared by two humans whose emails are
-- correct and distinct — merging on รหัส would fuse two people irreversibly once
-- สิทธิ์ flowed through the joined record. Email wins because it is the only key
-- the user PROVES (Google login) rather than types.
-- ============================================================

-- ------------------------------------------------------------
-- 1. The person
-- ------------------------------------------------------------
create table if not exists public.team_people (
  id          uuid primary key default gen_random_uuid(),
  -- The identity. Nullable: 10 live rows have neither email nor รหัส and must
  -- not be blocked from existing — they are exactly the rows ตรวจสอบข้อมูล
  -- surfaces for a human to complete.
  kkumail     text,
  student_id  text,
  prefix      text,
  full_name   text not null,
  nickname    text,
  year        text,
  major       text,
  photo_url   text,
  photo_focus text,
  -- Set at login by the sync RPC, same as team_members.user_id today.
  -- Nullable + ON DELETE SET NULL agree; a NOT NULL column with SET NULL is the
  -- latent contradiction logged in mistakes.md (the FK cleanup fails at delete
  -- time and blocks the parent delete).
  user_id     uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.team_people
  drop constraint if exists team_people_photo_focus_chk;
alter table public.team_people
  add constraint team_people_photo_focus_chk
  check (photo_focus is null or photo_focus in ('top', 'center', 'bottom'));

-- One address, one person. This is the constraint that makes "kkumail is the
-- identity" true rather than aspirational. Partial so the keyless rows coexist.
create unique index if not exists team_people_kkumail_uniq
  on public.team_people (lower(btrim(kkumail)))
  where kkumail is not null and btrim(kkumail) <> '';

comment on table public.team_people is
  'One row per human. team_members is their PLACEMENT in the org tree. '
  'Identity is keyed on kkumail (proven by Google login); student_id is an '
  'attribute, not a key — 673070332-6 was one mistyped id on two people.';

-- ------------------------------------------------------------
-- 2. The link
-- ------------------------------------------------------------
alter table public.team_members
  add column if not exists person_id uuid references public.team_people(id) on delete set null;

create index if not exists team_members_person_id_idx on public.team_members (person_id);

comment on column public.team_members.person_id is
  '0108 expand step. The identity columns beside it (full_name, nickname, '
  'kkumail, …) are still the ones every resolver and policy reads; person_id is '
  'the forward path. Do not read one and write the other.';

-- ------------------------------------------------------------
-- 3. Backfill
-- ------------------------------------------------------------
-- Idempotent: only rows not already linked are considered, so a re-run is a
-- no-op rather than a second set of duplicate people.
--
-- The touch trigger is off for the duration. Stamping person_id is bookkeeping,
-- not an edit, but `updated_at` is READ: team_term_status (0105) derives
-- "ผังสดเปลี่ยนแล้ว · ควรเผยแพร่ซ้ำ" from max(updated_at) across the team
-- tables, so leaving it on would flag every published ปีการศึกษา as stale and
-- invite a pointless re-publish of all of them. Caught by the 0108 proof.
--
-- Safe because the whole file runs as one transaction: a failure rolls the
-- DISABLE back too, and ALTER TABLE … DISABLE TRIGGER takes an ACCESS EXCLUSIVE
-- lock, so no other session ever observes it off. Same pattern as the
-- users_self_update_guard note in mistakes.md.
--
-- team_members_recompute_perms is deliberately left ENABLED: it fires on
-- `update of permissions, inherit_permissions, node_id, kkumail, vs_dept,
-- project_seat` (0086) and person_id is in none of those, so it will not fire —
-- and if that column list ever grows to include it, the recompute is the
-- behaviour we want, not something to suppress.
alter table public.team_members disable trigger touch_team_members_updated_at;

with src as (
  select
    m.id,
    m.updated_at,
    nullif(btrim(m.prefix), '')     as prefix,
    nullif(btrim(m.full_name), '')  as full_name,
    nullif(btrim(m.nickname), '')   as nickname,
    nullif(btrim(m.year::text), '') as year,
    nullif(btrim(m.major), '')      as major,
    nullif(btrim(m.photo_url), '')  as photo_url,
    nullif(btrim(m.photo_focus), '') as photo_focus,
    nullif(btrim(m.student_id), '') as sid,
    -- A value with no @ is not an address. One live row holds '-', which is
    -- what splits ชญาภา into two people until someone fixes it.
    case when position('@' in coalesce(m.kkumail, '')) > 0
         then lower(btrim(m.kkumail)) end as em,
    m.user_id
  from public.team_members m
  where m.person_id is null
),
keyed as (
  select *,
         case when em  is not null then 'e:' || em
              when sid is not null then 's:' || sid
              else 'r:' || id::text end as pkey
    from src
),
-- One row per person. Each field takes the most recently updated NON-NULL
-- value: "newest row wins" alone would blank a field that only an older
-- placement ever filled in. Where two rows genuinely disagree the loser is not
-- lost — both values are still on the placements, and ตรวจสอบข้อมูล shows them
-- side by side for a human (usually the person themselves) to choose.
picked as (
  select
    pkey,
    (array_agg(full_name  order by updated_at desc) filter (where full_name  is not null))[1] as full_name,
    (array_agg(prefix     order by updated_at desc) filter (where prefix     is not null))[1] as prefix,
    (array_agg(nickname   order by updated_at desc) filter (where nickname   is not null))[1] as nickname,
    (array_agg(year       order by updated_at desc) filter (where year       is not null))[1] as year,
    (array_agg(major      order by updated_at desc) filter (where major      is not null))[1] as major,
    (array_agg(photo_url  order by updated_at desc) filter (where photo_url  is not null))[1] as photo_url,
    (array_agg(photo_focus order by updated_at desc) filter (where photo_focus is not null))[1] as photo_focus,
    (array_agg(sid        order by updated_at desc) filter (where sid        is not null))[1] as student_id,
    (array_agg(em         order by updated_at desc) filter (where em         is not null))[1] as kkumail,
    (array_agg(user_id    order by updated_at desc) filter (where user_id    is not null))[1] as user_id
  from keyed group by pkey
),
made as (
  insert into public.team_people
    (full_name, prefix, nickname, year, major, photo_url, photo_focus,
     student_id, kkumail, user_id)
  select
    -- full_name is NOT NULL on the table; two live rows have no name at all
    -- (the "hi" test node), and dropping them silently would be worse than a
    -- placeholder the health pane already lists.
    coalesce(p.full_name, '(ไม่มีชื่อ)'),
    p.prefix, p.nickname, p.year, p.major, p.photo_url, p.photo_focus,
    p.student_id, p.kkumail, p.user_id
  from picked p
  returning id, lower(btrim(coalesce(kkumail, ''))) as em, coalesce(student_id, '') as sid, full_name
)
update public.team_members m
   set person_id = made.id
  from keyed k
  join picked p on p.pkey = k.pkey
  join made on made.em = coalesce(p.kkumail, '')
           and made.sid = coalesce(p.student_id, '')
           and made.full_name = coalesce(p.full_name, '(ไม่มีชื่อ)')
 where m.id = k.id
   and m.person_id is null;

alter table public.team_members enable trigger touch_team_members_updated_at;

-- ------------------------------------------------------------
-- 4. Mirror: person → its placements
-- ------------------------------------------------------------
-- So that switching the UI to write to the person is a one-line change per form
-- rather than a rewrite: every resolver keeps reading team_members and sees the
-- new value immediately. Fires the existing recompute trigger on team_members
-- when kkumail changes, which is correct — a changed address SHOULD re-resolve
-- สิทธิ์.
create or replace function public.team_person_mirror_down()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.team_members m
     set prefix      = new.prefix,
         full_name   = new.full_name,
         nickname    = new.nickname,
         year        = new.year,
         major       = new.major,
         photo_url   = new.photo_url,
         photo_focus = new.photo_focus,
         student_id  = new.student_id,
         kkumail     = new.kkumail,
         user_id     = coalesce(new.user_id, m.user_id)
   where m.person_id = new.id
     and (m.prefix, m.full_name, m.nickname, m.year, m.major, m.photo_url,
          m.photo_focus, m.student_id, m.kkumail)
         is distinct from
         (new.prefix, new.full_name, new.nickname, new.year, new.major,
          new.photo_url, new.photo_focus, new.student_id, new.kkumail);
  return new;
end;
$$;

drop trigger if exists team_people_mirror_down on public.team_people;
create trigger team_people_mirror_down
  after update of prefix, full_name, nickname, year, major, photo_url,
                  photo_focus, student_id, kkumail, user_id
  on public.team_people
  for each row execute function public.team_person_mirror_down();

create or replace function public.touch_team_people_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end;
$$;
drop trigger if exists touch_team_people on public.team_people;
create trigger touch_team_people before update on public.team_people
  for each row execute function public.touch_team_people_updated_at();

-- ------------------------------------------------------------
-- 5. RLS
-- ------------------------------------------------------------
-- Same gate as team_members (0089): role vp_admin/dev OR the `team` permission
-- granted through the tree. NO public read policy, ever — a person row carries
-- every student's kkumail and รหัสนักศึกษา, and 0086 records why the public org
-- chart must stay a hand-built projection rather than a row-level filter.
alter table public.team_people enable row level security;

-- Explicit, not implied. Supabase's default privileges hand `anon` a SELECT
-- grant on new public tables; RLS with no anon-facing policy already returns
-- zero rows, but the passport lockdown (mistakes.md) is the entry that says a
-- revoke you can see beats a denial you have to reason about.
revoke all on public.team_people from anon;

drop policy if exists "team_people_all_manage" on public.team_people;
create policy "team_people_all_manage" on public.team_people
  for all to authenticated
  using (public.current_user_role() = any (array['vp_admin', 'dev'])
         or public.current_user_has_permission('team'))
  with check (public.current_user_role() = any (array['vp_admin', 'dev'])
         or public.current_user_has_permission('team'));
