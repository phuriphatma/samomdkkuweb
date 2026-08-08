-- ============================================================
-- 0127 — `000` is not a สายรหัส, at the table as well as in the app.
--
-- THE INPUT THIS EXISTS FOR. สาย run 001–999. `000` is not one of them, and it is
-- precisely what a spreadsheet writes into an EMPTY numeric cell: a blank สาย
-- column comes back as `0`, which the importer padded to `000`, which the check
-- constraint accepted (`^[0-9]{3}$` matches it), which the 0122 trigger then
-- happily CREATED a `sais` row for — filing a student into บ้าน 0 under a สาย the
-- university does not have, from a cell that said nothing at all.
--
-- It is the same failure `auditSaiWidths` was built for, arriving from the other
-- direction. That one is a zero REMOVED, and left-padding puts it back exactly
-- (the house is the last digit, which padding cannot touch) — recoverable, so it
-- warns. This one is a zero ADDED, and nothing downstream can tell it from a real
-- สาย — not recoverable, so it is refused.
--
-- บ้าน 0 loses nothing: it is fed by 010, 020, … 100, all still legal.
--
-- ENFORCED IN BOTH PLACES ON PURPOSE. `normalizeSai()` refuses it so the import
-- preview can explain what happened ("this looks like a blank cell a spreadsheet
-- filled in") on the row where a human can act. The constraint below refuses it
-- so that no writer — a future SQL script, a hand-edit, a path nobody has
-- written yet — can put one in behind the app's back. The app's copy is the
-- message; the table's copy is the guarantee.
-- ============================================================

-- Nothing to migrate: verified `sais` holds no '000' row before this ran.
alter table public.sais drop constraint if exists sais_code_check;
alter table public.sais
  add constraint sais_code_check
  check (code ~ '^[0-9]{3}$' and code <> '000');

comment on column public.sais.code is
  'สายรหัส, exactly three digits, 001–999. NOT derived from รหัสนักศึกษา — it is '
  'the university''s own อาจารย์ที่ปรึกษา assignment. `000` is excluded because it '
  'is what a spreadsheet writes into an empty numeric cell, not a สาย.';

-- The on-demand creator (0122) must refuse it too, with a message that names the
-- real cause. Without this it would raise the FK/check error from underneath,
-- which reads as a database fault rather than as "that cell was blank".
create or replace function public.students_ensure_sai()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.sai_code is not null then
    -- Normalise defensively. Every JS writer already goes through
    -- normalizeSai(), but this trigger is the last line before the FK and must
    -- not depend on a caller having done it.
    new.sai_code := btrim(new.sai_code);
    if new.sai_code !~ '^[0-9]{3}$' then
      raise exception 'สายรหัส "%" ไม่ถูกต้อง — ต้องเป็นตัวเลข 3 หลัก (001–999)', new.sai_code;
    end if;
    if new.sai_code = '000' then
      raise exception 'สายรหัส "000" ไม่มีอยู่จริง — สายเริ่มที่ 001 '
        '(ค่านี้มักเกิดจากช่องว่างที่โปรแกรมตารางเติมเลข 0 ให้)';
    end if;
    insert into public.sais (code) values (new.sai_code)
      on conflict (code) do nothing;
  end if;
  return new;
end;
$$;
