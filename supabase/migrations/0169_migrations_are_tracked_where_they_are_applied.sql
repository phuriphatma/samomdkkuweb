-- ============================================================
-- 0169 — the database records which migrations it has, so several people can
--        write migrations without guessing.
--
-- WHY
-- There are 168 migration files and NOTHING that says which of them a given
-- database has run. With one developer that is survivable — the answer is "all
-- of them, probably". With several it is not: two people take the same number
-- on the same afternoon, a migration is applied by hand and forgotten, or a
-- branch is reviewed against a schema the reviewer cannot see.
--
-- `docs/TEAM-WORKFLOW.md` §4 designed `npm run migrate:status` around a
-- `public.schema_migrations` table. This is that table.
--
-- HONESTY ABOUT THE BACKFILL — this is the part that would otherwise rot
-- Every file that exists today is recorded as `backfilled`, NOT as applied at a
-- known time, because nobody measured when each ran and inventing a timestamp
-- would make a guess look like a record. A backfilled row means exactly one
-- thing: "this file predates tracking, and this database is believed to carry
-- it". Only rows written by tools/apply-migration.mjs from now on carry a real
-- `applied_at` and a real `applied_by`.
--
-- This repo has been bitten by fill-once columns that could never be corrected
-- (0128's cohort_year, 0145's yearBasis). The defence here is that `source`
-- names the difference, so a reader can never mistake the two.
--
-- WHY DENY-ALL RLS IS THE POINT, NOT AN OVERSIGHT
-- Nothing in the browser reads this table. It is written and read by
-- tools/*.mjs over the Management API, which runs as the database owner and is
-- not subject to RLS. So RLS is enabled with NO policy and the table-level
-- grants are revoked: anon and authenticated get nothing, deliberately.
-- (0138 was the reverse mistake — a table whose policies could never fire
-- because the GRANT was missing, which read like the policy working. Here the
-- denial IS the design, and this comment is the record of that.)
-- ============================================================

create table if not exists public.schema_migrations (
  version     text primary key,                    -- '0169'
  name        text not null,                       -- full filename
  source      text not null
                check (source in ('applied', 'backfilled')),
  applied_at  timestamptz,                         -- null for backfilled rows
  applied_by  text,                                -- null for backfilled rows
  checksum    text,                                -- sha256 of the file at apply time
  created_at  timestamptz not null default now()
);

comment on table public.schema_migrations is
  'Which migration files this database has. source=applied means observed by '
  'tools/apply-migration.mjs; source=backfilled means it predates tracking and '
  'has no known apply time. Never write a timestamp you did not observe.';

alter table public.schema_migrations enable row level security;

-- No policy on purpose. Revoke the default grants so the denial is explicit
-- rather than accidental.
revoke all on public.schema_migrations from anon, authenticated;
