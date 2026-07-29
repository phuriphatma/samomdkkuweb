#!/usr/bin/env node
// ============================================================
// db-query.mjs — run a READ-ONLY SQL file and print the full JSON result.
//
// WHY THIS EXISTS SEPARATELY FROM apply-migration.mjs:
// apply-migration.mjs echoes the response with `.slice(0, 2000)`, which
// silently truncates any result bigger than that — and it does so WITHOUT
// saying it truncated. Introspection queries (pg_get_functiondef over every
// function, a policy dump, a column list) blow past 2000 chars constantly, so
// using it to investigate produces confidently wrong answers. This prints
// everything.
//
// Same credential path as apply-migration.mjs: SUPABASE_ACCESS_TOKEN (a
// Management-API PAT) from .env.local, project ref derived from
// VITE_SUPABASE_URL. It runs as the Postgres SUPERUSER — auth.uid() is null
// and RLS is bypassed, so to observe what a real user sees you must
// `set_config('role', …)` + `set_config('request.jwt.claims', …)` inside a
// transaction, the way tools/*-proof scripts do.
//
// USE FOR READS. It will happily run DDL/DML — that is what
// apply-migration.mjs is for, and migrations belong in supabase/migrations/
// so they are reviewable and re-runnable. If you must mutate to investigate,
// wrap it in `begin; … rollback;` (every proof script in this directory is
// built that way) so production is never left changed.
//
//   node tools/db-query.mjs path/to/query.sql
//   node tools/db-query.mjs path/to/query.sql | python3 -m json.tool
// ============================================================
import { readFileSync } from 'node:fs';

const file = process.argv[2];
if (!file) {
  console.error('usage: node tools/db-query.mjs <path-to-.sql>');
  process.exit(1);
}

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')];
    }));

const REF = (env.VITE_SUPABASE_URL || '').match(/https:\/\/([^.]+)\.supabase\.co/)?.[1];
if (!REF || !env.SUPABASE_ACCESS_TOKEN) {
  console.error('need VITE_SUPABASE_URL + SUPABASE_ACCESS_TOKEN in .env.local');
  process.exit(1);
}

const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ query: readFileSync(file, 'utf8') }),
});

const body = await r.text();
if (!r.ok) { console.error(`HTTP ${r.status}:`, body); process.exit(1); }
process.stdout.write(body);
