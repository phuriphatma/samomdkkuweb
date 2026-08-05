#!/usr/bin/env node
/**
 * Guard the agent context budget.
 *
 *   node tools/check-context-budget.mjs          # report + fail on breach
 *   node tools/check-context-budget.mjs --report # report only, never fails
 *
 * WHY: everything under `.claude/rules/` plus `CLAUDE.md` is injected into
 * EVERY agent session, before the user types anything. On 2026-08-05 that came
 * to 251k chars (~63k tokens, a quarter of the window) because 118 full bug
 * write-ups lived in `.claude/rules/mistakes.md` and `-archive.md`. The
 * write-ups moved to `docs/mistakes/` (read on demand); this check is what
 * stops them drifting back.
 *
 * The budget is deliberately tight. When a file breaches it, the fix is to
 * move detail into a read-on-demand file under `docs/`, never to raise the cap.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Files the harness auto-loads into every session, with a per-file cap. */
const BUDGETS = [
  ['CLAUDE.md', 12_000],
  ['.claude/rules/mistakes.md', 30_000],
  ['.claude/rules/security.md', 12_000],
];
const TOTAL_BUDGET = 60_000; // ~15k tokens for the always-on layer

/** Auto-loaded dirs — a NEW file appearing here must be declared above. */
const WATCHED_DIRS = ['.claude/rules'];

function main() {
  const reportOnly = process.argv.includes('--report');
  const declared = new Set(BUDGETS.map(([f]) => f));
  const problems = [];
  let total = 0;

  console.log('Agent context budget — files loaded into EVERY session\n');
  for (const [rel, cap] of BUDGETS) {
    const full = path.join(ROOT, rel);
    if (!fs.existsSync(full)) {
      problems.push(`missing declared file: ${rel}`);
      continue;
    }
    const size = fs.statSync(full).size;
    total += size;
    const pct = Math.round((size / cap) * 100);
    const flag = size > cap ? '✖' : pct > 85 ? '!' : '✔';
    console.log(`  ${flag} ${rel.padEnd(32)} ${String(size).padStart(7)} / ${cap} chars (${pct}%)`);
    if (size > cap) problems.push(`${rel} is ${size - cap} chars over its ${cap} budget — move detail into docs/, don't raise the cap`);
  }

  // Anything undeclared in a watched dir is auto-loaded weight nobody accounted for.
  for (const dir of WATCHED_DIRS) {
    const full = path.join(ROOT, dir);
    if (!fs.existsSync(full)) continue;
    for (const name of fs.readdirSync(full)) {
      if (!name.endsWith('.md')) continue;
      const rel = path.posix.join(dir, name);
      if (!declared.has(rel)) {
        const size = fs.statSync(path.join(ROOT, rel)).size;
        total += size;
        console.log(`  ✖ ${rel.padEnd(32)} ${String(size).padStart(7)} / UNDECLARED`);
        problems.push(`${rel} is auto-loaded but has no declared budget — add it to BUDGETS in tools/check-context-budget.mjs, or move it under docs/`);
      }
    }
  }

  const totalPct = Math.round((total / TOTAL_BUDGET) * 100);
  console.log(`\n  total ${total} / ${TOTAL_BUDGET} chars (${totalPct}%) ≈ ${Math.round(total / 4)} tokens per session`);
  if (total > TOTAL_BUDGET) problems.push(`total auto-loaded context is ${total - TOTAL_BUDGET} chars over the ${TOTAL_BUDGET} budget`);

  if (!problems.length) {
    console.log('\n✔ within budget');
    return;
  }
  console.error('\n✖ context budget breached:');
  for (const p of problems) console.error(`  - ${p}`);
  console.error('\n  The always-loaded layer holds CLASSES and an index. Write-ups go in docs/mistakes/.');
  if (!reportOnly) process.exit(1);
}

main();
