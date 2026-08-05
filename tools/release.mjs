#!/usr/bin/env node
// ==============================================
// release.mjs — cut a release: work out the version, write the stub, tag it.
//
//   npm run release              # dry run: show the bump and the draft
//   npm run release -- --write   # apply: package.json + changelog stub
//   npm run release -- --write --tag
//   npm run release -- --write --level major   # override the derived level
//
// Full policy: docs/VERSIONING.md.
//
// WHY A SCRIPT AND NOT `npm version` / semantic-release
// `npm version` only bumps a number; it knows nothing about our tier rules or
// the user-facing changelog. semantic-release publishes on every push from CI,
// which is wrong here for one specific reason: our changelog is CURATED. A
// generated one would read like a git log, which is exactly what this project's
// release notes exist not to be. So the tool does the mechanical half — read
// commits, derive the bump, prepare the stub — and a human writes the words.
//
// Everything is DRY RUN unless --write is passed. Nothing is pushed, ever.
// ==============================================

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PKG = resolve(ROOT, 'package.json');
const CHANGELOG = resolve(ROOT, 'src/data/changelog.js');

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const opt = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : null; };

const git = (...a) => execFileSync('git', a, { cwd: ROOT, encoding: 'utf8' }).trim();

// ---- 1. what has happened since the last release -------------------------

function lastTag() {
  try {
    // stderr ignored: with no tags at all `git describe` writes "fatal: No
    // names found" before exiting non-zero, and that is a normal first run.
    return execFileSync('git', ['describe', '--tags', '--abbrev=0', '--match', 'v*'],
      { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch { return null; }
}

/**
 * Conventional Commits, which this repo already writes (`feat(team): …`,
 * `fix(vs): …`, `docs(state): …`). That existing habit is what makes the bump
 * derivable at all — it is not a new convention being imposed.
 */
function commitsSince(tag) {
  const range = tag ? `${tag}..HEAD` : 'HEAD';
  const raw = git('log', range, '--format=%s%n%b%n--END--');
  return raw.split('\n--END--\n').map((c) => c.trim()).filter(Boolean);
}

const RE_TYPE = /^(\w+)(\([^)]*\))?(!)?:/;

function classify(commits) {
  const out = { breaking: [], feat: [], fix: [], other: [] };
  for (const c of commits) {
    const subject = c.split('\n')[0];
    const m = RE_TYPE.exec(subject);
    // `feat!:` and a `BREAKING CHANGE:` footer are the two documented markers.
    if ((m && m[3]) || /^BREAKING[ -]CHANGE:/m.test(c)) { out.breaking.push(subject); continue; }
    const type = m?.[1];
    if (type === 'feat') out.feat.push(subject);
    else if (type === 'fix') out.fix.push(subject);
    else out.other.push(subject);
  }
  return out;
}

/**
 * Derive the tier.
 *
 * NOTE the deliberate gap between this and classic SemVer: a `!`/BREAKING
 * commit is flagged for REVIEW, not auto-promoted to major. Our MAJOR means
 * "the portal's scope changed for users" (docs/VERSIONING.md), and a breaking
 * internal refactor is invisible to them. The script cannot judge scope, so a
 * human confirms with --level major.
 */
function deriveLevel(buckets) {
  if (buckets.feat.length) return 'minor';
  if (buckets.fix.length) return 'patch';
  return null; // docs/chore/refactor only — nothing worth a release
}

function bump(version, level) {
  const [maj, min, pat] = version.split('.').map(Number);
  if (level === 'major') return `${maj + 1}.0.0`;
  if (level === 'minor') return `${maj}.${min + 1}.0`;
  return `${maj}.${min}.${pat + 1}`;
}

// ---- 2. report ------------------------------------------------------------

const pkg = JSON.parse(readFileSync(PKG, 'utf8'));
const tag = lastTag();
const commits = commitsSince(tag);
const buckets = classify(commits);
const derived = deriveLevel(buckets);
const level = opt('--level') || derived;

console.log(`\n  current   v${pkg.version}`);
console.log(`  since     ${tag || '(no tag yet — whole history)'}  ·  ${commits.length} commits`);
console.log(`  feat ${buckets.feat.length}   fix ${buckets.fix.length}   other ${buckets.other.length}   breaking ${buckets.breaking.length}`);

if (buckets.breaking.length) {
  console.log('\n  ⚠ commits marked BREAKING — decide if the SCOPE changed for users:');
  buckets.breaking.forEach((s) => console.log(`      ${s}`));
  console.log('    if it did, re-run with --level major');
}

if (!level) {
  console.log('\n  Nothing user-facing since the last release (no feat/fix). Not cutting one.\n');
  process.exit(0);
}

// Notes staged by PENDING as the work shipped. These are already written for a
// reader — that is the whole point of writing them in the commit that ships the
// change — so they go in VERBATIM, above the TODO lines derived from commit
// subjects. Parsed out of the source rather than imported: this script runs in
// plain node, and changelog.js is an ES module the bundler owns.
function readPending() {
  const src = readFileSync(CHANGELOG, 'utf8');
  const m = src.match(/export const PENDING = \[([\s\S]*?)\n\];/);
  if (!m) return { entries: [], areas: [], audiences: [] };
  const entries = [...m[1].matchAll(/\{[^}]*\}/g)].map((e) => e[0]);
  const areas = [...new Set([...m[1].matchAll(/area:\s*'([^']+)'/g)].map((x) => x[1]))];
  const audiences = [...new Set([...m[1].matchAll(/audience:\s*'([^']+)'/g)].map((x) => x[1]))];
  return { entries, areas, audiences };
}
const pending = readPending();
if (pending.entries.length) {
  console.log(`\n  ${pending.entries.length} staged note(s) from PENDING will be folded in.`);
}

const next = bump(pkg.version, level);
const today = new Date().toISOString().slice(0, 10);
console.log(`\n  → ${level.toUpperCase()}  v${pkg.version} → v${next}\n`);

const stub = `  {
    version: '${next}',
    level: '${level}',
    date: '${today}',
    title: 'TODO — what a student would call this',
    summary: 'TODO — one or two sentences, or delete this line',
    areas: ${JSON.stringify(pending.areas.length ? pending.areas : ['portal']).replace(/"/g, "'")},
    audience: '${pending.audiences.length === 1 ? pending.audiences[0] : 'public'}',
    changes: [
${pending.entries
    .map((e) => `      ${e
      .replace(/,?\s*area:\s*'[^']*'/, '')
      .replace(/,?\s*audience:\s*'[^']*'/, '')
      .replace(/\s*\n\s*/g, ' ')},`)
    .join('\n')}
${[...buckets.feat.map((s) => ['new', s]), ...buckets.fix.map((s) => ['fixed', s])]
    .map(([t, s]) => `      { type: '${t}', text: 'TODO — ${s.replace(/'/g, "\\'")}' },`)
    .join('\n') || (pending.entries.length ? '' : "      { type: 'new', text: 'TODO' },")}
    ],
  },`;

console.log('  changelog stub (rewrite every TODO in plain Thai before shipping):\n');
console.log(stub.split('\n').map((l) => `  ${l}`).join('\n'));

// ---- 3. apply -------------------------------------------------------------

if (!has('--write')) {
  console.log('\n  dry run. re-run with --write to apply.\n');
  process.exit(0);
}

pkg.version = next;
writeFileSync(PKG, `${JSON.stringify(pkg, null, 2)}\n`);

const cl = readFileSync(CHANGELOG, 'utf8');
const anchor = 'export const RELEASES = [\n';
if (!cl.includes(anchor)) {
  console.error('  ! could not find the RELEASES array — add the stub by hand.');
  process.exit(1);
}
let out = cl.replace(anchor, anchor + stub + '\n');
// Clear the staging area in the same write — leaving it would republish every
// staged note in the NEXT release too.
out = out.replace(/export const PENDING = \[[\s\S]*?\n\];/, 'export const PENDING = [\n];');
writeFileSync(CHANGELOG, out);

console.log(`\n  ✓ package.json → ${next}`);
console.log('  ✓ changelog stub inserted at the top of RELEASES');
if (pending.entries.length) console.log(`  ✓ ${pending.entries.length} staged note(s) folded in; PENDING cleared`);
console.log('    now: rewrite the TODOs, then `npm test && npm run build`');

if (has('--tag')) {
  // Tag only. Pushing is a separate, deliberate act — `git push --tags`.
  git('tag', '-a', `v${next}`, '-m', `v${next}`);
  console.log(`  ✓ tagged v${next} (local only — push with: git push origin v${next})`);
}
console.log('');
