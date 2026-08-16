#!/usr/bin/env node
// ============================================================
// run-proofs.mjs — run every live proof and print ONE verdict per proof.
//
// WHY THIS EXISTS. STATE.md tells each session to "run the proof covering what
// you touch", and the proofs are worth running — but they emit FOUR different
// shapes:
//
//   `verdict` column ......... authz-sweep-identity, pr0149
//   `result` column .......... house0144, shop0150
//   `status` column + a final `ALL PASS` SCORE row ... house0145, house0146,
//                                                     team0145 ×2
//   a single JSON blob ....... house0116
//   plain text from a .mjs ... house0132, proj0092, team0135, team0137,
//                              grant0093, team0143
//
// On 2026-08-12 a session tried to check them all with an ad-hoc parser and
// reported "0/23 FAIL" on a proof that was fully green, then reported four more
// as N-1/N because it counted each file's own summary row as a failure. Two
// false alarms in a row. A verification step that cries wolf gets ignored, and
// this repo has already written that down twice
// (docs/mistakes/tooling-proofs.md).
//
// THE PROPERTY THAT MATTERS: an output this cannot interpret is reported as
// UNKNOWN and exits non-zero. It must never score "I could not read this" as a
// pass — that is the failure mode every guard here has been bitten by.
//
//   node tools/run-proofs.mjs            # all of them
//   node tools/run-proofs.mjs team       # only proofs whose name matches
// ============================================================
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));

/** Every proof STATE.md claims coverage from. Adding one here is the point. */
const PROOFS = [
  ['authz-sweep-identity.sql', 'the identity boundary for anon AND an ungranted student'],
  ['pr0149-delete-permission.sql', 'PR delete: the RPC must agree with the policy'],
  ['shop0150-buyer-contact.sql', 'what a buyer may change on their own order'],
  ['house0116-authz.sql', 'ระบบบ้าน read boundary'],
  ['house0144-delete-impact.sql', 'the delete dialog predicts what a delete does'],
  ['house0145-duplicate-person.sql', 'a second placement links, never duplicates'],
  ['house0146-crest-refcount.sql', 'the crest refcount can see the crest'],
  ['team0145-one-chan-pi.sql', 'ชั้นปี survives a registry touch'],
  ['team0145-save-as-the-member.sql', 'saving as the member keeps the mirror'],
  ['claude0154-quota-guard.sql', 'the Claude quota caps hold, and the board is gated'],
  ['claude0155-free-now.sql', 'how much Claude quota may be used right now, and until when'],
  ['claude0157-rail-segments.sql', "the calendar rail's bands are constant and its edges are deadlines"],
  ['claude0159-window-share.sql', 'a 5-hour Claude window is shared by everyone it covers'],
  ['house0132-registry.mjs', 'public.people is the registry'],
  ['proj0092-seat-parity.mjs', 'project seats resolve identically both ways'],
  ['team0135-name-split.mjs', 'name splitting round-trips'],
  ['team0137-search.mjs', 'search_people boundary'],
  ['grant0093-reads.mjs', 'a grant channel reaches the READS too'],
  ['team0143-photo-refcount.mjs', 'portrait refcount'],
];

/**
 * Decide a proof's verdict from its stdout.
 * @returns {{ state: 'PASS'|'FAIL'|'UNKNOWN', detail: string }}
 */
function judge(file, out) {
  if (file.endsWith('.mjs')) {
    const m = out.match(/(\d+)\s+passed,\s+(\d+)\s+failed/i);
    if (m) {
      return Number(m[2]) === 0
        ? { state: 'PASS', detail: `${m[1]}/${Number(m[1]) + Number(m[2])}` }
        : { state: 'FAIL', detail: `${m[2]} failed` };
    }
    if (/all\s+\d*\s*pass/i.test(out)) return { state: 'PASS', detail: 'all pass' };
    if (/\bFAIL\b|✗|✘/.test(out)) return { state: 'FAIL', detail: 'FAIL in output' };
    return { state: 'UNKNOWN', detail: 'no recognised summary line' };
  }

  let rows;
  try { rows = JSON.parse(out); } catch { return { state: 'UNKNOWN', detail: 'stdout is not JSON' }; }
  if (!Array.isArray(rows) || rows.length === 0) {
    return { state: 'UNKNOWN', detail: 'no rows' };
  }

  // Single-blob proofs (house0116): no per-case column to read, so fall back to
  // scanning the text — and say so, rather than implying per-case coverage.
  const key = ['verdict', 'status', 'result'].find(
    (k) => k in rows[0] && typeof rows[0][k] === 'string' && rows[0][k].length < 40,
  );
  if (!key) {
    const text = JSON.stringify(rows);
    if (/FAIL|DENIED_UNEXPECTED/i.test(text)) return { state: 'FAIL', detail: 'FAIL in blob' };
    return { state: 'PASS', detail: 'blob, no FAIL marker (not per-case)' };
  }

  // A trailing "ALL PASS"/SCORE row is a SUMMARY, not a case — counting it as a
  // case is what produced the false N-1/N reports this tool exists to prevent.
  const cases = rows.filter((r) => !/^ALL\s+PASS$/i.test(String(r[key])));
  const summary = rows.find((r) => /^ALL\s+PASS$/i.test(String(r[key])));
  const passed = cases.filter((r) => String(r[key]).toUpperCase().startsWith('PASS'));
  const failed = cases.filter((r) => !String(r[key]).toUpperCase().startsWith('PASS'));

  if (failed.length) {
    const first = failed[0];
    const label = first.step || first.name || first.case || JSON.stringify(first).slice(0, 60);
    return { state: 'FAIL', detail: `${failed.length} failed — ${label}` };
  }
  return {
    state: 'PASS',
    detail: `${passed.length}/${cases.length}${summary ? ' (+summary)' : ''}`,
  };
}

const filter = process.argv[2];
const chosen = PROOFS.filter(([f]) => !filter || f.includes(filter));
if (chosen.length === 0) {
  console.error(`no proof matches "${filter}"`);
  process.exit(2);
}

let bad = 0;
for (const [file, what] of chosen) {
  process.stdout.write(`${file.padEnd(34)}`);
  let out = '';
  let verdict;
  try {
    out = file.endsWith('.mjs')
      ? execFileSync('node', [join(HERE, file)], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
      : execFileSync('node', [join(HERE, 'db-query.mjs'), join(HERE, file)], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    verdict = judge(file, out);
  } catch (e) {
    // A proof that ERRORS is absent, not passing (docs/mistakes/tooling-proofs.md).
    verdict = { state: 'FAIL', detail: `errored: ${String(e.stderr || e.message).trim().slice(0, 90)}` };
  }
  if (verdict.state !== 'PASS') bad += 1;
  const mark = { PASS: '✓', FAIL: '✗', UNKNOWN: '?' }[verdict.state];
  console.log(`${mark} ${verdict.state.padEnd(7)} ${verdict.detail}   — ${what}`);
}

console.log(bad === 0
  ? `\nall ${chosen.length} proofs green`
  : `\n${bad} of ${chosen.length} proofs NOT green — an UNKNOWN counts, on purpose`);
process.exit(bad === 0 ? 0 : 1);
