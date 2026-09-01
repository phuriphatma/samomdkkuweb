#!/usr/bin/env node
// ============================================================
// check-embeds.mjs — does every ฝ่าย tool folder still satisfy the rules?
//
//   npm run check:embeds
//
// The rules live in src/js/embed-checks.js and are shared with the CI test
// (src/js/tool-frame.test.js). This is the one-command version a contributor
// can run without knowing what Vitest is.
//
// SUBJECT: the registry, not the directory. A folder with no kind:'embed'
// entry in src/data/tools.js is unreachable — the entry is the review gate
// (docs/DEPT-TOOLS.md §8) — so checking directories would report on pages
// nobody can open, and miss an entry whose folder was never created.
// ============================================================

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { embedTools } from '../src/data/tools.js';
import { checkEmbedFolder } from '../src/js/embed-checks.js';
import { readEmbedFolder } from './embed-fs.mjs';

const ROOT = new URL('..', import.meta.url).pathname;

const tools = embedTools();
let problems = [];

if (!tools.length) {
  console.log('– no kind:\'embed\' tools in src/data/tools.js; nothing to check.');
  process.exit(0);
}

for (const t of tools) {
  const dir = join(ROOT, 'public', 'embed', t.slug);
  if (!existsSync(dir)) {
    problems.push(`${t.slug}: src/data/tools.js routes /tools/${t.slug} but `
      + `public/embed/${t.slug}/ does not exist — the page would 404`);
    continue;
  }
  problems = problems.concat(checkEmbedFolder({ slug: t.slug, files: readEmbedFolder(dir) }));
}

for (const t of tools) console.log(`  checked  public/embed/${t.slug}/`);
if (!problems.length) {
  console.log(`\n✔ ${tools.length} embed folder(s) pass.`);
  process.exit(0);
}
console.log('');
for (const p of problems) console.log(`✗ ${p}`);
console.log(`\n${problems.length} problem(s). Rules: docs/DEPT-TOOLS.md §3 and the `
  + `README.md in public/embed/starter/.`);
process.exit(1);
