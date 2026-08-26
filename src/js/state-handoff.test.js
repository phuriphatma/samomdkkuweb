// state-handoff.test.js — the handoff must not name something that is not there.
//
// WHY THIS EXISTS. STATE.md is the first thing every session reads, and it is
// the one file whose whole value is being TRUE. On 2026-08-26 a single audit of
// it found six stale claims, and five shared one shape:
//
//   the same fact lived in TWO places, and only ONE was corrected.
//
//   · the context budget: one paragraph said "29,725 of 30,000, the next
//     write-up may turn `npm test` red", four hundred lines below a paragraph
//     saying that exact claim was false and had been deleted;
//   · `claude0157` was called RED in three places and had been green for a day;
//   · the test count read 1309 in one place and 1312 in another;
//   · "still owed: grant the `claude` permission" sat above a section recording
//     it as granted eight days earlier;
//   · the deployed sha named a commit two deploys behind, which reads exactly
//     like "there is a deploy owed" and costs a VPN session to disprove.
//
// A file that contradicts itself is worse than a file that is silent: the reader
// cannot tell which half to trust, so they re-derive the work anyway, which is
// the one thing the handoff exists to prevent.
//
// WHAT THIS CAN AND CANNOT DO. It cannot judge whether a sentence is TRUE —
// "claude0157 is red" is a claim about the world and no offline test can settle
// it. What it can do is pin the claims that are mechanically checkable, and
// insist the file agree with the repository and with ITSELF. The rest is the
// standing rule, which belongs in prose because it is a habit:
//
//   ⛔ WHEN YOU CORRECT A CLAIM IN STATE.md, GREP THE WHOLE FILE FOR ITS OTHER
//      HOMES BEFORE YOU COMMIT. Every one of the five above was one grep away.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('../../', import.meta.url).pathname;
const STATE = readFileSync(join(ROOT, 'STATE.md'), 'utf8');

/**
 * Backticked strings STATE.md names that LOOK like a file in this repo.
 *
 * The `/` requirement is what keeps served bundle hashes out — `public-*.js` is
 * recorded as EVIDENCE of a past deploy, not as a file anyone can open, and a
 * guard that demanded those exist would be wrong on purpose.
 */
function namedPaths(md) {
  const out = new Set();
  for (const m of md.matchAll(/`([^`\n]+)`/g)) {
    const t = m[1].trim();
    if (t.includes('/') && /^[\w./-]+\.(md|js|sql|mjs|sh|conf|html|css|json|gs|py)$/.test(t)) out.add(t);
  }
  return [...out].sort();
}

/**
 * Named, but deliberately absent. Each entry must say WHY — an unexplained
 * exemption is how a real broken pointer gets parked here and forgotten.
 */
const ABSENT_ON_PURPOSE = {
  '.claude/rules/mistakes-archive.md':
    'deleted; STATE.md names it only to say "do not re-create it" — it lived in the auto-loaded directory, so archiving into it saved nothing',
  'docs/state-archive/YYYY-MM-DD.md':
    'a filename PATTERN for the archive convention, not a file',
  'scratchpad/disprove.mjs':
    'an ephemeral ~30-line WebKit harness; STATE.md names it as a SHAPE worth rebuilding and says so',
  'assets/admin-CPiyOZWb.js':
    'a served bundle hash from a past deploy, recorded as evidence; it has a slash only because the URL path does',
  'docs/INVARIANTS.md':
    'PLANNED, not written — the destination for STATE.md\'s durable rules in the split designed in docs/TEAM-WORKFLOW.md §6.5. Named here so the target of that move has one agreed name; DELETE this exemption in the same commit that creates the file',
};

describe('STATE.md is a handoff, not a memory', () => {
  it('reads the file at all (a sweep that finds nothing must prove it looked)', () => {
    expect(STATE.length).toBeGreaterThan(20000);
    expect(namedPaths(STATE).length).toBeGreaterThan(30);
  });

  it('names no file that is not there', () => {
    const broken = namedPaths(STATE).filter((p) => {
      if (p in ABSENT_ON_PURPOSE) return false;
      // Module paths are often written relative to src/js — `team/index.js`
      // means `src/js/team/index.js`. Both spellings resolve.
      return !existsSync(join(ROOT, p)) && !existsSync(join(ROOT, 'src/js', p));
    });
    expect(broken, [
      'STATE.md points at files that do not exist. A cold session follows these',
      'pointers first, and a dead one costs more than the sentence saved.',
      'Fix the path, or add it to ABSENT_ON_PURPOSE with the reason.',
    ].join('\n')).toEqual([]);
  });

  it('every exemption gives a reason', () => {
    for (const [p, why] of Object.entries(ABSENT_ON_PURPOSE)) {
      expect(typeof why === 'string' && why.length > 30,
        `${p}: an exemption needs a written reason, not a placeholder`).toBe(true);
    }
  });

  it('its "migrations through NNNN" matches the migrations on disk', () => {
    const claimed = [...STATE.matchAll(/Migrations through \*{0,2}(\d{4})\*{0,2}/gi)].map((m) => m[1]);
    expect(claimed.length, 'STATE.md no longer states a migration high-water mark').toBeGreaterThan(0);

    const onDisk = readdirSync(join(ROOT, 'supabase/migrations'))
      .filter((f) => /^\d{4}_.*\.sql$/.test(f))
      .map((f) => f.slice(0, 4))
      .sort()
      .pop();

    // EVERY spelling, not just the first: the whole point is that a fact with
    // two homes gets corrected in one of them.
    for (const c of claimed) {
      expect(c, `STATE.md says migrations through ${c}; the highest on disk is ${onDisk}`).toBe(onDisk);
    }
    expect(new Set(claimed).size, 'STATE.md states two different migration numbers').toBe(1);
  });

  it('its live-proof count matches what npm run proofs actually runs', () => {
    const runner = readFileSync(join(ROOT, 'tools/run-proofs.mjs'), 'utf8');
    // The runner is itself invoked through db-query.mjs, which is not a proof.
    const registered = new Set(
      [...runner.matchAll(/['"]([\w-]+\.(?:sql|mjs))['"]/g)].map((m) => m[1]),
    );
    registered.delete('db-query.mjs');

    const claimed = [...STATE.matchAll(/(?:ALL |all )(\d+)(?: LIVE)? [Pp][Rr][Oo][Oo][Ff][Ss]/g)].map((m) => Number(m[1]));
    expect(claimed.length, 'STATE.md no longer states a proof count').toBeGreaterThan(0);
    for (const c of claimed) {
      expect(c, `STATE.md claims ${c} proofs; run-proofs.mjs registers ${registered.size}`)
        .toBe(registered.size);
    }
  });

  it('does not state two different test counts', () => {
    const counts = new Set([...STATE.matchAll(/\*\*(\d{3,5}) tests/g)].map((m) => m[1]));
    expect([...counts], 'STATE.md states more than one test count — correct BOTH homes')
      .toHaveLength(1);
  });
});
