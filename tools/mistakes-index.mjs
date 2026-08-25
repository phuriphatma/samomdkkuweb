#!/usr/bin/env node
/**
 * Regenerate the symptom index from the headings of `docs/mistakes/*.md`.
 *
 *   node tools/mistakes-index.mjs           # rewrite both files
 *   node tools/mistakes-index.mjs --check   # exit 1 if either is stale
 *
 * IT WRITES TWO FILES, AND THE SPLIT IS THE WHOLE POINT.
 *
 *   docs/mistakes/INDEX.md     the FULL list — one scannable symptom line per
 *                              entry, grouped by area. Read on demand.
 *   .claude/rules/mistakes.md  a NINE-LINE directory: area, what it covers,
 *                              how many entries. Loaded into every session.
 *
 * It used to write the full list into the always-loaded file, and by August
 * 2026 that list was 18,533 of the file's 30,000-byte budget — larger than the
 * recurring CLASSES it sits under, growing by construction with every bug this
 * repo fixes, and blocking the next write-up from being added at all. Two
 * sessions tried to buy room by shaving English prose out of the classes; that
 * buys ~100 bytes an hour and spends the part that actually generalises.
 *
 * The full list is not lost, and that matters: `grep -rin "<symptom>"
 * docs/mistakes/` searches the WRITE-UPS, which is strictly better than
 * searching their titles, and INDEX.md is one Read away for anyone who wants
 * to scan headings. What every session now pays for is the directory — which
 * area to open — and that is the only part of it a cold agent uses before it
 * knows what it is looking for.
 *
 * WHY IT IS GENERATED AT ALL: a hand-maintained index of 100+ items rots
 * within a week (the previous "what's in the archive" blurb did exactly that).
 * The heading in the topic file IS the index line: if a line reads badly, fix
 * the heading there.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.join(ROOT, 'docs/mistakes');
const HOT = path.join(ROOT, '.claude/rules/mistakes.md');
const FULL = path.join(DIR, 'INDEX.md');
const BEGIN = '<!-- BEGIN GENERATED INDEX — npm run mistakes:index -->';
const END = '<!-- END GENERATED INDEX -->';

/** Display order + the one-line "when do I open this file?" hint. */
export const TOPICS = [
  ['supabase-client.md', 'supabase-js, PostgREST & the session lifecycle', 'auth.js · db.js · anything calling supabase-js'],
  ['authz-rls.md', 'RLS policies, SECURITY DEFINER & read paths', 'any policy, `current_user_*` helper, or definer RPC'],
  ['authz-grants.md', 'The permission / seat / scope channel', 'adding an access channel, a scope, or a seat'],
  ['postgres-schema.md', 'Migrations, DDL, triggers & constraints', 'writing a migration'],
  ['frontend-ui.md', 'Bootstrap, CSS, DOM & the browser', 'markup, modals, layout, touch, icons'],
  ['app-state.md', 'Routing, read-state, caches & serialization', 'URL state, per-user "seen", import/export'],
  ['integrations.md', 'Notifications, Apps Script & Google Drive', 'notify, GAS handlers, Drive URLs'],
  ['deploy-hosting.md', 'Deploy, nginx & caching', 'deploy.sh, nginx, cache headers'],
  ['tooling-proofs.md', 'Proof scripts & verification discipline', 'writing or trusting a `tools/*.mjs` proof'],
];

const MAX = 120;

/**
 * The heading, trimmed to a scannable symptom line. Deterministic.
 *
 * ALWAYS cut at the ` — ` separator, not only when the line is over MAX.
 * Headings here are "<claim> — <elaboration>", the file's own rule is to LEAD
 * with the symptom as reported because that is what the next reader greps for,
 * and the elaboration is in the write-up two seconds away. Keeping it in the
 * always-loaded layer charges every future session for a sentence nobody
 * searches on.
 *
 * ⚠️ THE CUT IS AT A SEPARATOR, NEVER AT A BYTE COUNT. A byte cap on this index
 * was tried once and REVERTED, because `check-context-budget.mjs` measures
 * BYTES, Thai costs 3 per character, and the truncation landed mid-word in
 * exactly the Thai symptom lines the index exists for. A word boundary has no
 * such failure mode. `claim.length >= 36` keeps the elaboration whenever the
 * claim alone is too short to identify the entry.
 */
export function shorten(heading) {
  const full = heading.trim();
  const claim = full.split(' — ')[0].trim();
  const s = claim.length >= 36 ? claim : full;
  if (s.length <= MAX) return s;
  return s.slice(0, MAX - 1).replace(/[\s,(—-]+$/, '') + '…';
}

export function headingsOf(file) {
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter((l) => l.startsWith('## '))
    .map((l) => l.slice(3).trim());
}

/**
 * The DIRECTORY, for the always-loaded file: which area holds what, and how
 * big it is. Nine lines, no per-entry lines.
 *
 * The count is kept because it is the one number that tells a reader whether a
 * grep returning nothing means "not a known problem" or "you searched the
 * wrong file" — `frontend-ui.md` at 76 entries and `deploy-hosting.md` at 7
 * are very different silences.
 */
export function buildIndex() {
  const out = [];
  let total = 0;
  for (const [file, title, when] of TOPICS) {
    const full = path.join(DIR, file);
    if (!fs.existsSync(full)) throw new Error(`missing topic file: docs/mistakes/${file}`);
    const heads = headingsOf(full);
    total += heads.length;
    out.push(`- \`${file}\` *(${heads.length})* — ${title}. Open when: ${when}.`);
  }
  return { body: out.join('\n'), total };
}

/**
 * The FULL list, for `docs/mistakes/INDEX.md`. One scannable symptom line per
 * entry — what the always-loaded file used to carry, now read on demand.
 */
export function buildFullIndex() {
  const out = [
    '# Mistakes — every entry, by area',
    '',
    '**GENERATED — do not hand-edit.** `npm run mistakes:index` rewrites this from',
    'the `##` headings in the files beside it. If a line here reads badly, fix the',
    'HEADING in the write-up, not this file.',
    '',
    'Scan for a line resembling your symptom, then open that file. Usually faster:',
    '`grep -rin "<phrase>" docs/mistakes/` — it searches the write-ups themselves,',
    'not just their titles. Read near-matches; most of these recurred elsewhere in',
    'different clothes.',
    '',
    'The recurring CLASSES — the part that generalises to code not yet written —',
    'are in `.claude/rules/mistakes.md`, which every session already has.',
    '',
  ];
  let total = 0;
  for (const [file, title, when] of TOPICS) {
    const heads = headingsOf(path.join(DIR, file));
    total += heads.length;
    out.push(`## \`${file}\` — ${title} *(${heads.length})*`);
    out.push('');
    out.push(`Open when: ${when}.`);
    out.push('');
    for (const h of heads) out.push(`- ${shorten(h)}`);
    out.push('');
  }
  out.push(`_${total} entries across ${TOPICS.length} files._`);
  return out.join('\n').trimEnd() + '\n';
}

function main() {
  const check = process.argv.includes('--check');
  const { body, total } = buildIndex();
  const src = fs.readFileSync(HOT, 'utf8');
  const a = src.indexOf(BEGIN);
  const b = src.indexOf(END);
  if (a === -1 || b === -1) {
    console.error(`✖ ${path.relative(ROOT, HOT)} is missing the ${BEGIN} / ${END} markers.`);
    process.exit(1);
  }
  const nextHot = src.slice(0, a + BEGIN.length) + '\n\n' + body + '\n\n' + src.slice(b);
  const nextFull = buildFullIndex();
  const curFull = fs.existsSync(FULL) ? fs.readFileSync(FULL, 'utf8') : null;

  if (nextHot === src && nextFull === curFull) {
    console.log(`✔ mistakes index up to date (${total} entries across ${TOPICS.length} files)`);
    return;
  }
  if (check) {
    console.error('✖ mistakes index is STALE. Run: npm run mistakes:index');
    process.exit(1);
  }
  fs.writeFileSync(HOT, nextHot);
  fs.writeFileSync(FULL, nextFull);
  console.log(`✔ rewrote mistakes index (${total} entries across ${TOPICS.length} files)`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
