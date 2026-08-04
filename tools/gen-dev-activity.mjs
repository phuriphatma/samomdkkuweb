#!/usr/bin/env node
// ==============================================
// gen-dev-activity.mjs — freeze the repo's development history into
// `src/data/dev-activity.json`.
//
// WHAT THE PUBLIC PAGE ACTUALLY USES: only `range` (the build window) and
// `contributors` (the credit line). The commit totals, churn and the daily
// heatmap series are still generated — they are the honest record and the file
// is a few KB — but they are deliberately NOT rendered on the landing page.
// Commit counts, lines-of-code and streaks measure effort rather than result,
// and to a SAMO member they read as noise or as grinding; the panel shows
// systems delivered instead. See the header of src/js/dev-activity.js.
// A test asserts those numbers stay off the page, so bringing the heatmap back
// is a deliberate act, not an accident.
//
//   node tools/gen-dev-activity.mjs          # write the file
//   node tools/gen-dev-activity.mjs --check  # fail if it is stale (CI)
//
// WHY A GENERATED FILE AND NOT THE GITHUB API
// The panel is on the landing page of a site served from the KKU VM. Calling
// api.github.com at render time would add a third-party dependency to the first
// paint, a rate limit we do not control, and a failure mode that shows an empty
// box to every visitor. A committed JSON is deterministic, costs one bundled
// asset, and renders offline. Re-run this script when you want the numbers to
// move; it is intentionally NOT wired into `npm run build`, because a build
// should not rewrite a tracked source file.
//
// WHAT IS DELIBERATELY NOT IN THE OUTPUT
// No email addresses. `git log` carries them and this repo is PUBLIC — the
// output is bundled to the browser, so committer emails would be republished on
// the landing page. Display names only. No commit subjects either: the curated
// story lives in src/data/changelog.js, written for readers; raw subjects are
// written for us.
// ==============================================

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'src/data/dev-activity.json');

const git = (...args) =>
  execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

/** ISO date (UTC-naive, matching git's --date=short) → day index, and back. */
const DAY = 86400000;
const toDate = (iso) => new Date(`${iso}T00:00:00Z`);
const toIso = (d) => d.toISOString().slice(0, 10);

function dailyCounts() {
  const out = new Map();
  for (const line of git('log', '--format=%ad', '--date=short').trim().split('\n')) {
    if (!line) continue;
    out.set(line, (out.get(line) || 0) + 1);
  }
  return out;
}

/** Contributors by commit count. Names only — see the header. */
function contributors() {
  const rows = git('shortlog', '-sn', '--all', 'HEAD').trim().split('\n');
  const seen = new Map();
  for (const row of rows) {
    const m = row.trim().match(/^(\d+)\s+(.*)$/);
    if (!m) continue;
    // One human can commit under several git identities (a GitHub noreply
    // address and a laptop one). Fold on the display name so the panel does not
    // claim more contributors than there are people.
    const name = m[2].trim();
    seen.set(name, (seen.get(name) || 0) + Number(m[1]));
  }
  return [...seen].map(([name, commits]) => ({ name, commits }))
    .sort((a, b) => b.commits - a.commits);
}

function churn() {
  let insertions = 0; let deletions = 0;
  for (const line of git('log', '--shortstat', '--format=').split('\n')) {
    const ins = line.match(/(\d+) insertion/);
    const del = line.match(/(\d+) deletion/);
    if (ins) insertions += Number(ins[1]);
    if (del) deletions += Number(del[1]);
  }
  return { insertions, deletions };
}

/**
 * Bucket thresholds for the heatmap, from the quantiles of the NON-ZERO days.
 *
 * Fixed thresholds would be wrong the moment the pace changes: a run of quiet
 * weeks would paint the whole calendar level 1 and the graph would stop saying
 * anything. Quantiles keep the ramp spending its five steps on the distribution
 * that actually exists. They are emitted into the JSON so the legend can state
 * them instead of showing an unexplained "น้อย → มาก".
 */
function levelThresholds(counts) {
  const nz = counts.filter((c) => c > 0).sort((a, b) => a - b);
  if (!nz.length) return [1, 2, 3, 4];
  const q = (p) => nz[Math.min(nz.length - 1, Math.floor(nz.length * p))];
  // Strictly increasing, so two thresholds can never collide on a flat
  // distribution and silently collapse two ramp steps into one.
  const raw = [q(0.2), q(0.4), q(0.6), q(0.8)];
  const out = [];
  raw.forEach((v, i) => out.push(i === 0 ? Math.max(1, v) : Math.max(v, out[i - 1] + 1)));
  return out;
}

const levelOf = (count, t) => {
  if (count <= 0) return 0;
  if (count <= t[0]) return 1;
  if (count <= t[1]) return 2;
  if (count <= t[2]) return 3;
  if (count <= t[3]) return 4;
  return 5;
};

/** Counts of things that exist in the tree right now, not in history. */
function inventory() {
  const ls = (glob) => git('ls-files', glob).trim().split('\n').filter(Boolean);
  return {
    migrations: ls('supabase/migrations/*.sql').length,
    tests: ls('src/**/*.test.js').length,
    modules: ls('src/js/**/*.js').filter((f) => !f.endsWith('.test.js')).length,
    styles: ls('src/css/*.css').length,
  };
}

function build() {
  const daily = dailyCounts();
  const dates = [...daily.keys()].sort();
  const first = dates[0];
  const last = dates[dates.length - 1];

  // Fill every calendar day between the first and last commit, zeros included —
  // the gaps ARE the signal (they are what make the dense stretches read as
  // sprints rather than as a uniform wash).
  const series = [];
  for (let d = toDate(first); d <= toDate(last); d = new Date(d.getTime() + DAY)) {
    const iso = toIso(d);
    series.push({ date: iso, count: daily.get(iso) || 0 });
  }

  const counts = series.map((s) => s.count);
  const thresholds = levelThresholds(counts);
  const total = counts.reduce((a, b) => a + b, 0);
  const activeDays = counts.filter((c) => c > 0).length;
  const peak = series.reduce((a, b) => (b.count > a.count ? b : a), series[0]);

  // Longest run of consecutive days with at least one commit.
  let streak = 0; let best = 0; let bestEnd = null;
  for (const s of series) {
    if (s.count > 0) { streak += 1; if (streak > best) { best = streak; bestEnd = s.date; } }
    else streak = 0;
  }

  const { insertions, deletions } = churn();

  return {
    // Regenerate with: node tools/gen-dev-activity.mjs
    generatedAt: new Date().toISOString().slice(0, 10),
    range: { first, last, calendarDays: series.length },
    totals: {
      commits: total,
      activeDays,
      busiestDay: { date: peak.date, commits: peak.count },
      longestStreak: { days: best, endedOn: bestEnd },
      insertions,
      deletions,
    },
    inventory: inventory(),
    contributors: contributors(),
    heatmap: {
      thresholds,
      // [date, count, level] — a tuple per day rather than an object, because at
      // ~100 days the key repetition is most of the file's weight.
      days: series.map((s) => [s.date, s.count, levelOf(s.count, thresholds)]),
    },
  };
}

const json = `${JSON.stringify(build(), null, 2)}\n`;

if (process.argv.includes('--check')) {
  const current = existsSync(OUT) ? readFileSync(OUT, 'utf8') : '';
  // `generatedAt` moves every day; compare everything else.
  const strip = (s) => s.replace(/"generatedAt": "[^"]*",\n/, '');
  if (strip(current) !== strip(json)) {
    console.error('dev-activity.json is stale — run: node tools/gen-dev-activity.mjs');
    process.exit(1);
  }
  console.log('dev-activity.json is up to date');
} else {
  writeFileSync(OUT, json);
  const d = JSON.parse(json);
  console.log(
    `wrote ${OUT}\n  ${d.totals.commits} commits · ${d.totals.activeDays}/${d.range.calendarDays} active days`
    + ` · peak ${d.totals.busiestDay.commits} on ${d.totals.busiestDay.date}`
    + ` · streak ${d.totals.longestStreak.days}d · thresholds ${d.heatmap.thresholds.join('/')}`,
  );
}
