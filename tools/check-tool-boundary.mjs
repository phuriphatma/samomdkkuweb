#!/usr/bin/env node
// ============================================================
// check-tool-boundary.mjs — a `tool/*` branch may only reach the tool lane.
//
//   node tools/check-tool-boundary.mjs <base-ref>     # default: origin/main
//
// docs/DEPT-TOOLS.md §8.3. Run from the REQUIRED `build` job (not its own
// workflow) so that it actually blocks a merge: this repo already learned that
// a required check with nothing to report it blocks every OTHER pull request
// for ever (tools/repo-protection.mjs, the sibling-repo check). One required
// check that is a no-op on branches this does not apply to is the shape that
// works.
//
// It exits 0 — loudly — on any branch that is not `tool/*`. That is not a
// weakness: the lane exists to make a CONTRIBUTOR's pull request reviewable by
// a peer, and the owner pushing `main` is a different situation with a
// different gate (CODEOWNERS).
// ============================================================

import { execFileSync } from 'node:child_process';
import { filesOutsideToolLane } from '../src/js/embed-checks.js';

const base = process.argv[2] || process.env.SAMO_BASE_REF || 'origin/main';
const branch = process.env.SAMO_HEAD_REF
  || execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { encoding: 'utf8' }).trim();

if (!/^tool\//.test(branch)) {
  console.log(`– not a tool/* branch (${branch}); the boundary does not apply.`);
  process.exit(0);
}

let changed;
try {
  changed = execFileSync('git', ['diff', '--name-only', `${base}...HEAD`], { encoding: 'utf8' })
    .split('\n').filter(Boolean);
} catch (e) {
  // Cannot see the diff = UNKNOWN, never PASS. A shallow checkout is the usual
  // cause and it must not read as "nothing outside the lane changed".
  console.error(`✗ could not diff against ${base}: ${String(e.message).slice(0, 160)}`);
  console.error('  (a shallow checkout cannot see the base — use fetch-depth: 0)');
  process.exit(1);
}

const outside = filesOutsideToolLane(changed);
if (!outside.length) {
  console.log(`✔ ${branch}: ${changed.length} changed file(s), all inside the tool lane.`);
  process.exit(0);
}

console.error(`✗ ${branch} changes ${outside.length} file(s) outside the tool lane:\n`);
for (const f of outside) console.error(`    ${f}`);
console.error(`
A tool/* branch may change ONLY:
    public/embed/<slug>/*     your tool's own folder
    src/data/tools.js         the one line that puts it on the site

That limit is what lets a teammate approve your pull request in thirty seconds
instead of the owner reading every line. If your tool genuinely needs something
outside it, that is a different request — open an issue and ask, rather than
widening the branch.  docs/DEPT-TOOLS.md §8`);
process.exit(1);
