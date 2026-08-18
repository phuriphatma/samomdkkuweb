-- ============================================================
-- 0165 — ปีงบประมาณ becomes a FACT you can correct, and a CHOICE you can keep.
--
-- TWO problems, one shape: the fiscal year a โครงการ belongs to was a
-- DERIVED value with no way to disagree with it, and the year you wanted to
-- LOOK at was a click you had to repeat every visit.
--
-- 1) `projects.fiscal_year_be` — an OVERRIDE, never a copy.
--    Until now the ปีงบ of a โครงการ was computed in JS from `created_at`
--    (1 ต.ค. – 30 ก.ย., named for the year it ENDS in). That derivation is
--    right for almost every row and wrong for the ones that matter: a
--    ผู้ส่งหนังสือ sends a หนังสือ in ก.ย. 2569 that the faculty books
--    against ปีงบ 2570. The office's answer, not the clock's, is the one
--    people search by.
--
--    NULL means "ask the clock" — the same answer the app gave before this
--    column existed, for every row that predates it. A number means a human
--    said otherwise. Deliberately NOT a stored copy of the derived value:
--    a filled-once mirror of an expression is the shape that made a
--    corrected รหัสนักศึกษา never re-derive its รุ่น (0128). Nothing
--    backfills this column; a row only gets a number when someone sets one.
--
--    Who may set it is NOT a new gate: `projects_update` is already
--    `current_user_is_project_actor()` = the vpa (ผู้ส่งหนังสือ) and staff
--    (เจ้าหน้าที่คณะ) roles/seats, which is exactly the audience asked for.
--
-- 2) `project_user_prefs` — the ปีงบ filter a person opens on.
--    Per-ACCOUNT, not per-browser, because the people using this move
--    between a phone, an iPad and an office PC and a setting that only
--    holds on one of them reads as broken. Three shapes:
--      'all'      ทุกปีงบ (the app's behaviour before this table existed,
--                 and what an ABSENT row still means — nothing changes for
--                 anyone who never opens the setting)
--      'current'  ปีงบปัจจุบัน, resolved at OPEN time — the one that
--                 survives 1 ต.ค. 2570 without anybody touching it
--      '2569'     a fixed year, for someone who wants to stay put
--
--    RLS is own-row-only in BOTH directions, and the GRANT is here in the
--    same migration: a table with policies and no grant denies everyone and
--    reads exactly like the policy working (0138).
-- ============================================================

-- ---------- 1. the override ----------

alter table public.projects
  add column if not exists fiscal_year_be smallint;

comment on column public.projects.fiscal_year_be is
  'ปีงบประมาณ (พ.ศ.) override. NULL = derive from created_at (1 ต.ค.–30 ก.ย., named for the ending year). Set by a vpa/staff actor when the office books the โครงการ against a different budget year.';

alter table public.projects
  drop constraint if exists projects_fiscal_year_be_range;
alter table public.projects
  add constraint projects_fiscal_year_be_range
  check (fiscal_year_be is null or fiscal_year_be between 2500 and 2700);

-- ---------- 2. the per-person default filter ----------

create table if not exists public.project_user_prefs (
  user_id             uuid primary key references public.users(id) on delete cascade,
  default_fiscal_year text        not null default 'all',
  updated_at          timestamptz not null default now()
);

comment on table public.project_user_prefs is
  'Per-account preferences for the หนังสือโครงการ inbox. One row per person, written only by that person.';
comment on column public.project_user_prefs.default_fiscal_year is
  '''all'' | ''current'' (resolved at open time) | a 4-digit พ.ศ. year. An ABSENT row means ''all''.';

alter table public.project_user_prefs
  drop constraint if exists project_user_prefs_default_fy_shape;
alter table public.project_user_prefs
  add constraint project_user_prefs_default_fy_shape
  check (default_fiscal_year in ('all', 'current')
         or default_fiscal_year ~ '^[0-9]{4}$');

alter table public.project_user_prefs enable row level security;

-- Postgres has no `create or replace policy` — drop first (mistakes.md).
drop policy if exists project_user_prefs_read   on public.project_user_prefs;
drop policy if exists project_user_prefs_insert on public.project_user_prefs;
drop policy if exists project_user_prefs_update on public.project_user_prefs;
drop policy if exists project_user_prefs_delete on public.project_user_prefs;

create policy project_user_prefs_read on public.project_user_prefs
  for select using (user_id = auth.uid());

create policy project_user_prefs_insert on public.project_user_prefs
  for insert with check (user_id = auth.uid());

-- USING gates which row you may touch; WITH CHECK stops you from moving it
-- onto someone else's uid. A per-row UPDATE policy without the second half
-- is the most repeated bug in this repo (class 1).
create policy project_user_prefs_update on public.project_user_prefs
  for update using (user_id = auth.uid())
          with check (user_id = auth.uid());

create policy project_user_prefs_delete on public.project_user_prefs
  for delete using (user_id = auth.uid());

grant select, insert, update, delete on public.project_user_prefs to authenticated;
-- anon gets nothing: the public mirror has no identity, so it has no prefs.
revoke all on public.project_user_prefs from anon;
