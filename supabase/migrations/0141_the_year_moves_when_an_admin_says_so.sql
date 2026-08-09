-- ============================================================
-- 0141 — ปีการศึกษา moves when an admin says so, not when the calendar does
--
-- WHAT WAS ASKED
--   "i don't like that it add more every august, the year doesn't change every
--    august, make the admin change manually … ชั้นปีเลื่อนให้เองทุกเดือนสิงหาคม
--    โดยคำนวณจากรหัสนักศึกษา ไม่ต้องมาไล่แก้รายคน — ใครลาพักหรือเรียนซ้ำ
--    เลือกชั้นปีที่ถูกไว้ครั้งเดียว ระบบจะจำส่วนต่างไว้ แล้วเลื่อนให้ถูกต้องในปีถัดๆ ไปเอง"
--
-- THIS REVERSES ONE HALF OF 0131 AND KEEPS THE OTHER, and the split is the
-- whole point:
--
--   KEPT — ชั้นปี is DERIVED and only the OFFSET is stored. "Someone who ลาพัก
--     picks the right year once and the system remembers the difference" is
--     exactly `year_offset`, and it is what makes the yearly move a single
--     value rather than 1,800 edits. Nothing about that changes.
--
--   REVERSED — the BASE. 0131 argued ปีการศึกษา should come from the clock,
--     because "a setting somebody must change every August is a setting that is
--     forgotten every August". The counter-argument is stronger and it is the
--     owner's: the promotion is not a calendar event. It does not happen at
--     midnight on 1 สิงหาคม, it varies, and a system that advances everybody on
--     a date the faculty did not choose is confidently wrong for however many
--     weeks lie between the two — while looking exactly like it is working.
--
--     A wrong-and-silent answer is worse than a stale one, because a stale one
--     is visible to the person who has to fix it.
--
-- SO THE FORGOTTEN-SETTING RISK IS ANSWERED RATHER THAN TRADED AWAY. The value
-- is shown on the ระบบบ้าน admin page with the year it implies, and
-- `academic_year_status()` reports when the clock has moved past สิงหาคม of a
-- later year and the setting has not — so the app SAYS it is probably due
-- instead of either acting alone or staying quiet. That is the difference
-- between a setting and a reminder.
--
-- THE COLUMN ALREADY EXISTED. `house_settings.academic_year` has been carried
-- as vestigial since 0123 dropped the first ชั้นปี implementation. It is the
-- right home and it is now read and written.
-- ============================================================

-- ------------------------------------------------------------
-- §1 — one row, one value, seeded from the clock ONCE
--
-- Seeded rather than left NULL: shipping a NULL would blank every ชั้นปี in the
-- app between deploy and whenever an admin first opens the page. Seeding from
-- today's clock reproduces exactly what the app displayed yesterday, so this
-- migration changes NO on-screen value — only who is allowed to change it next.
-- ------------------------------------------------------------
-- `house_settings.id` is a BOOLEAN singleton key (one row, `id = true`), not a
-- serial — so this reads oddly and is correct.
insert into public.house_settings (id)
select true where not exists (select 1 from public.house_settings);

update public.house_settings
   set academic_year = (
     extract(year from now())::int + 543
     - case when extract(month from now())::int >= 8 then 0 else 1 end)
 where academic_year is null;

comment on column public.house_settings.academic_year is
  'ปีการศึกษา in พ.ศ., the base every ชั้นปี is derived from (0141). An ADMIN '
  'moves it; nothing moves it on a clock. Seeded from the August rollover the '
  'clock implied on the day 0141 shipped, so the change was invisible.';

-- ------------------------------------------------------------
-- §2 — everyone may READ it; only ระบบบ้าน admins may move it
--
-- The read has to be wide: every student's own card derives their ชั้นปี from
-- it. It is one integer that is printed on a public org chart anyway, so there
-- is nothing here to protect — but it goes through a function with a named
-- return rather than a SELECT policy on the table, because `house_settings`
-- also carries `sai_self_edit_open` and `roster_visible` and a table-wide read
-- would publish those too (0086/0103: publish a PROJECTION, never a table).
-- ------------------------------------------------------------
create or replace function public.get_academic_year()
returns int language sql stable security definer set search_path = public as $$
  select academic_year from public.house_settings order by id limit 1;
$$;

revoke all on function public.get_academic_year() from public;
grant execute on function public.get_academic_year() to anon, authenticated;

comment on function public.get_academic_year() is
  'The ปีการศึกษา every ชั้นปี is derived from. Granted to anon as well: the '
  'public org chart shows ชั้นปี, and this is one integer, not a projection of '
  'anything about a person.';

-- ------------------------------------------------------------
-- §3 — is it probably due?
--
-- The honest answer to "a setting that must be changed is a setting that is
-- forgotten". Returns what is stored, what the clock would have said, and
-- whether they differ — so the admin page can show a reminder. It does NOT act
-- on that difference, which is the entire request.
-- ------------------------------------------------------------
create or replace function public.academic_year_status()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'academic_year', (select academic_year from public.house_settings order by id limit 1),
    'clock_year', extract(year from now())::int + 543
                  - case when extract(month from now())::int >= 8 then 0 else 1 end,
    'behind', greatest(
      (extract(year from now())::int + 543
       - case when extract(month from now())::int >= 8 then 0 else 1 end)
      - coalesce((select academic_year from public.house_settings order by id limit 1), 0), 0)
  );
$$;

revoke all on function public.academic_year_status() from public;
revoke all on function public.academic_year_status() from anon;
grant execute on function public.academic_year_status() to authenticated;

-- ------------------------------------------------------------
-- §4 — moving it
--
-- Takes the TARGET year, not "add one". A button that means "+1" cannot be
-- pressed twice safely, and double-advancing 1,800 students is a mistake with
-- no undo that anyone would notice — everybody would simply be a year out, in
-- the direction that looks plausible.
--
-- Bounded to ±1 of the clock's answer. Not to stop a legitimate correction —
-- going back is explicitly allowed, because the first thing anyone does after
-- advancing by accident is put it back — but a typo of 2 in the thousands
-- column would otherwise graduate the entire faculty.
-- ------------------------------------------------------------
create or replace function public.set_academic_year(p_year int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_clock int := extract(year from now())::int + 543
                 - case when extract(month from now())::int >= 8 then 0 else 1 end;
begin
  if not (public.current_user_role() = any (array['vp_admin','dev'])
          or public.current_user_has_permission('house')) then
    raise exception 'ไม่มีสิทธิ์เปลี่ยนปีการศึกษา';
  end if;
  if p_year is null then raise exception 'ต้องระบุปีการศึกษา'; end if;
  if p_year < v_clock - 1 or p_year > v_clock + 1 then
    raise exception 'ปีการศึกษา % ห่างจากปีปัจจุบัน (%) เกินไป — ตั้งได้ระหว่าง % ถึง %',
      p_year, v_clock, v_clock - 1, v_clock + 1;
  end if;

  update public.house_settings set academic_year = p_year, updated_at = now()
   where id = (select id from public.house_settings order by id limit 1);

  return public.academic_year_status();
end;
$$;

revoke all on function public.set_academic_year(int) from public;
revoke all on function public.set_academic_year(int) from anon;
grant execute on function public.set_academic_year(int) to authenticated;

comment on function public.set_academic_year(int) is
  'Move ปีการศึกษา (0141). Takes the TARGET year rather than a delta, so it is '
  'idempotent — a "+1" button pressed twice would put 1,800 people a year out '
  'in the direction that looks plausible. Bounded to ±1 of the clock, which '
  'still permits putting a mistake back.';
