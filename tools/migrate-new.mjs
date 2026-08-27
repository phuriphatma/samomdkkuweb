#!/usr/bin/env node
// ============================================================
// migrate-new.mjs — take the next migration number without colliding.
//
//   npm run migrate:new "the pr desk rule is one predicate"
//
// The number comes from the HIGHEST of: the working tree, and origin/main.
// Taking it from the working tree alone is how two people on two branches both
// get 0170 — the second one only finds out at merge, when the number is already
// applied to a database somewhere.
// ============================================================

import { writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { listMigrationFiles, MIGRATIONS_DIR, versionOf } from './migrations-lib.mjs';

const slug = process.argv.slice(2).join(' ').trim();
if (!slug) {
  console.error('usage: npm run migrate:new "what this migration does"');
  process.exit(1);
}

function highestOnOriginMain() {
  try {
    execFileSync('git', ['fetch', 'origin', 'main', '--quiet'], { stdio: 'ignore' });
    const out = execFileSync('git', ['ls-tree', '--name-only', 'origin/main', `${MIGRATIONS_DIR}/`], {
      encoding: 'utf8',
    });
    const versions = out.split('\n')
      .map((p) => versionOf(p.replace(/^.*\//, '')))
      .filter(Boolean);
    return versions.length ? versions.sort().at(-1) : null;
  } catch {
    console.warn('! could not read origin/main (offline?) — numbering from the working tree only.');
    console.warn('  Check the number against the remote before you open the pull request.');
    return null;
  }
}

const localMax = listMigrationFiles().at(-1)?.version ?? '0000';
const remoteMax = highestOnOriginMain() ?? '0000';
const next = String(Math.max(Number(localMax), Number(remoteMax)) + 1).padStart(4, '0');

const name = `${next}_${slug.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')}.sql`;
const path = join(MIGRATIONS_DIR, name);
if (existsSync(path)) {
  console.error(`${path} already exists`);
  process.exit(1);
}

writeFileSync(path, `-- ============================================================
-- ${next} — ${slug}
--
-- WHY
-- <What was reported, in the words it was reported in. Then the cause, then
--  why THIS shape and not the smaller one.>
--
-- ORDER — read skills/ship-a-migration.md before applying
-- ADD before the code that reads it ships. DROP only after the new bundle is
-- confirmed SERVED. Reversing that took production down for ~20 minutes (0129).
-- ============================================================

`);

console.log(`✓ ${path}`);
if (localMax !== remoteMax) {
  console.log(`  (working tree was at ${localMax}, origin/main at ${remoteMax} — took the higher)`);
}
