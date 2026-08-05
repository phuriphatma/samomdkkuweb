#!/usr/bin/env node
/**
 * Regenerate the symptom index inside `.claude/rules/mistakes.md` from the
 * headings of `docs/mistakes/*.md`.
 *
 *   node tools/mistakes-index.mjs           # rewrite the index in place
 *   node tools/mistakes-index.mjs --check   # exit 1 if it is stale
 *
 * WHY THIS IS GENERATED: `.claude/rules/mistakes.md` is loaded into every
 * agent session, so it must stay small — it carries the recurring CLASSES and
 * one line per entry, not the entries themselves. A hand-maintained index of
 * 100+ items rots within a week (the previous "what's in the archive" blurb
 * did exactly that). The heading in the topic file IS the index line: if a
 * line reads badly here, fix the heading there.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.join(ROOT, 'docs/mistakes');
const HOT = path.join(ROOT, '.claude/rules/mistakes.md');
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

/** The heading, trimmed to a scannable symptom line. Deterministic. */
export function shorten(heading) {
  const full = heading.trim();
  if (full.length <= MAX) return full;
  // Too long: headings are "<claim> — <elaboration>", and the claim is the symptom.
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

export function buildIndex() {
  const out = [];
  let total = 0;
  for (const [file, title, when] of TOPICS) {
    const full = path.join(DIR, file);
    if (!fs.existsSync(full)) throw new Error(`missing topic file: docs/mistakes/${file}`);
    const heads = headingsOf(full);
    total += heads.length;
    out.push(`### \`docs/mistakes/${file}\` — ${title}`);
    out.push(`*Open when:* ${when}. *(${heads.length} entries)*`);
    out.push('');
    for (const h of heads) out.push(`- ${shorten(h)}`);
    out.push('');
  }
  return { body: out.join('\n').trimEnd(), total };
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
  const next = src.slice(0, a + BEGIN.length) + '\n\n' + body + '\n\n' + src.slice(b);
  if (next === src) {
    console.log(`✔ mistakes index up to date (${total} entries across ${TOPICS.length} files)`);
    return;
  }
  if (check) {
    console.error('✖ mistakes index is STALE. Run: npm run mistakes:index');
    process.exit(1);
  }
  fs.writeFileSync(HOT, next);
  console.log(`✔ rewrote mistakes index (${total} entries across ${TOPICS.length} files)`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
