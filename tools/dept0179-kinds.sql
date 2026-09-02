-- ============================================================
-- dept0179-kinds.sql — the four kinds, and the body rule for each.
--
-- BOTH DIRECTIONS. A probe that only inserts the rows it expects to succeed
-- cannot tell a working constraint from a dropped one — and this migration
-- DROPS and RECREATES two constraints, which is exactly the operation that can
-- leave a table with neither.
--
-- Rolls back. Nothing here survives the transaction.
-- ============================================================
begin;

create temporary table probe(case_name text, expected text, got text);

-- ── ALLOW: each kind, carrying what it renders ──────────────────────────────
do $$
declare k text; body text;
begin
  foreach k in array array['card', 'html', 'section', 'text'] loop
    begin
      insert into public.dept_content (dept, kind, title, description, html)
      values ('digital', k,
              case when k in ('card', 'section') then 'proof0179' end,
              case when k = 'text' then 'proof0179 paragraph' end,
              case when k = 'html' then '<p>proof0179</p>' end);
      insert into probe values (k || ' with its own body', 'accepted', 'accepted');
    exception when check_violation then
      insert into probe values (k || ' with its own body', 'accepted', 'REFUSED');
    end;
  end loop;
end $$;

-- ── DENY: each kind, missing the one field it renders ───────────────────────
-- The control that must find something. If these are accepted, the body
-- constraint is gone and the ALLOW half above proves nothing.
do $$
declare k text;
begin
  foreach k in array array['card', 'html', 'section', 'text'] loop
    begin
      insert into public.dept_content (dept, kind) values ('digital', k);
      insert into probe values (k || ' with NO body', 'refused', 'ACCEPTED');
    exception when check_violation then
      insert into probe values (k || ' with NO body', 'refused', 'refused');
    end;
  end loop;
end $$;

-- ── DENY: a kind that is not in the list ────────────────────────────────────
do $$
begin
  insert into public.dept_content (dept, kind, title) values ('digital', 'canvas', 'x');
  insert into probe values ('kind=canvas (not a kind)', 'refused', 'ACCEPTED');
exception when check_violation then
  insert into probe values ('kind=canvas (not a kind)', 'refused', 'refused');
end $$;

-- ── DENY: a section whose title is only whitespace ──────────────────────────
-- length(btrim(...)) > 0, not `is not null`. A blank heading is an unexplained
-- gap on a public page, which is the failure the constraint exists for.
do $$
begin
  insert into public.dept_content (dept, kind, title) values ('digital', 'section', '   ');
  insert into probe values ('section titled "   "', 'refused', 'ACCEPTED');
exception when check_violation then
  insert into probe values ('section titled "   "', 'refused', 'refused');
end $$;

select case_name as step,
       case when expected = got then 'PASS' else 'FAIL' end as result,
       expected, got
  from probe order by case_name;

rollback;
