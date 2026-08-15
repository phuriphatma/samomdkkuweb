#!/usr/bin/env node
// ============================================================
// team0153-tier-parity.mjs — the conversion must REDRAW NOTHING.
//
// 0153 flattens eight ตำแหน่ง out from under other ตำแหน่ง and gives them a
// `tier` instead. The claim is that the public chart looks exactly the same
// afterwards. This is the differential that checks it, in the shape
// `house0144-delete-impact.sql` established: predict, act, compare.
//
//   BEFORE  a snapshot of team_nodes taken before the migration
//   AFTER   the live tree now
//   both    -> chartParentage(), the SAME function the page renders through
//
// Comparing the two DRAWINGS rather than the two tables is the whole point: the
// rows are supposed to differ. What must not differ is who ends up under whom.
//
// The one case that could genuinely have diverged is ฝ่าย ComArt, which has two
// tier-2 heads — the tier model hangs tier 3 off the FIRST of them while the
// nesting named one explicitly. They coincide only because Art/Graphic is
// position 0, and "coincide" is exactly the kind of thing that stops being true
// after somebody drags a row. Hence a check that can be re-run.
//
//   node tools/team0153-tier-parity.mjs tools/fixtures/team-tree-before-0153.json
//
// NOT in `npm run proofs`, deliberately. The snapshot is a MOMENT — the tree as
// it stood on 2026-08-15, immediately before 0153 — so once the owner
// legitimately adds a ฝ่าย or re-ranks a seat this will report a difference
// that is not a bug. It is a one-shot verification kept re-runnable, not a
// standing invariant, and putting it in the sweep would train the next reader
// to explain a red proof away. The fixture is committed because a proof whose
// input lives in someone's /tmp cannot be re-run at all.
//
// The snapshot holds only what `get_public_team_chart` already publishes to
// anonymous readers — id, parent_id, name, kind, position. No member data.
//
// The snapshot is an array of {id, parent_id, name, kind, position}. Without
// one this exits NON-ZERO rather than passing vacuously — a parity check with
// nothing to compare against is the "its control finds nothing either" failure
// from skills/write-a-guard.md.
// ============================================================
import { readFileSync } from 'node:fs';
import { chartParentage, tierOf } from '../src/js/org-rung.js';

const snapPath = process.argv[2];
if (!snapPath) {
  console.error('usage: node tools/team0153-tier-parity.mjs <before-snapshot.json>');
  process.exit(2);
}

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
const ref = (env.VITE_SUPABASE_URL || '').match(/https:\/\/([a-z0-9]+)\.supabase\.co/)?.[1];
const token = env.SUPABASE_ACCESS_TOKEN;
if (!ref || !token) { console.error('need VITE_SUPABASE_URL + SUPABASE_ACCESS_TOKEN in .env.local'); process.exit(2); }

async function query(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${(await r.text()).slice(0, 400)}`);
  return r.json();
}

/** id -> display parent id, through the same code the page uses. */
function drawing(nodes) {
  const byParent = new Map();
  const nodeById = new Map();
  for (const n of nodes) {
    const k = n.parent_id || '';
    if (!byParent.has(k)) byParent.set(k, []);
    byParent.get(k).push(n);
    nodeById.set(n.id, n);
  }
  // The projection orders by (position, name); the snapshot and the live read
  // must be sorted identically or the "first seat of the rung above" is decided
  // by whichever order the rows happened to arrive in.
  for (const kids of byParent.values()) {
    kids.sort((a, b) => (a.position ?? 0) - (b.position ?? 0)
      || String(a.name).localeCompare(String(b.name)));
  }
  const out = new Map();
  for (const [k, kids] of chartParentage(byParent, nodeById)) {
    for (const n of kids) out.set(n.id, k);
  }
  return out;
}

const before = JSON.parse(readFileSync(snapPath, 'utf8'));
const after = await query(
  'select id, parent_id, name, kind, position, tier from public.team_nodes',
);

const A = drawing(before);
const B = drawing(after);

console.log(`  before: ${before.length} nodes   after: ${after.length} nodes`);

const fails = [];
if (!before.length || !after.length) fails.push('one side is EMPTY — nothing was compared');
if (before.length !== after.length) fails.push(`node COUNT changed: ${before.length} -> ${after.length}`);

// THE CONTROL: the tables must actually differ, or "the drawing is unchanged"
// is the trivial truth that nothing ran.
const nameOf = new Map(after.map((n) => [n.id, n.name]));
const moved = after.filter((n) => {
  const b = before.find((x) => x.id === n.id);
  return b && (b.parent_id || '') !== (n.parent_id || '');
});
const tiered = after.filter((n) => tierOf(n) > 1);
console.log(`  control: ${moved.length} rows re-parented, ${tiered.length} rows now tier > 1`);
if (!moved.length) fails.push('CONTROL FAILED: no row was re-parented, so this compared nothing');
if (moved.length !== tiered.length) {
  fails.push(`re-parented (${moved.length}) != tiered (${tiered.length}) — a row moved without a rank, or gained one without moving`);
}

// THE ASSERTION: same display parent for every node, both directions.
for (const id of new Set([...A.keys(), ...B.keys()])) {
  const a = A.get(id);
  const b = B.get(id);
  if (a !== b) {
    fails.push(`${nameOf.get(id) || id}: drawn under ${nameOf.get(a) || a || '(root)'} `
      + `before, ${nameOf.get(b) || b || '(root)'} after`);
  }
}

// And nothing may hang off a node that is not itself drawn.
for (const [id, parent] of B) {
  if (parent && !nameOf.has(parent)) fails.push(`${nameOf.get(id)}: drawn under a node that does not exist`);
}

if (fails.length) {
  console.log(`\n  ✗ FAIL — ${fails.length} problem(s):`);
  for (const f of fails.slice(0, 25)) console.log(`      ${f}`);
  process.exit(1);
}
console.log(`  ✓ ALL PASS — ${A.size} nodes, identical display parentage before and after`);
