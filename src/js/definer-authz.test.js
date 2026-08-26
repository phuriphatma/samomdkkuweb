// definer-authz.test.js — a SECURITY DEFINER function that refuses somebody
// must not decide on the ROLE channel alone.
//
// WHY THIS IS A TEST AND NOT A NOTE IN mistakes.md.
// `soft_delete_pr_ticket` gated deletion on `current_user_role() in
// ('pr_staff','dev')`. It was written in 0043 as a deliberate hand-copy of the
// DELETE policy — the header even says it re-checks "the EXACT current delete
// authorization" — but it copied 0001's version of that rule, when 0014 had
// already taught the policy `or current_user_has_permission('pr')` twenty-nine
// migrations earlier. The copy was stale ON THE DAY IT WAS WRITTEN, and stayed
// invisible for 106 migrations because:
//   1. everybody who tested held the ROLE, which satisfies both spellings; and
//   2. the VS twin in the SAME migration (`soft_delete_vs_ticket`) DID consult
//      the permission, so the pair read as permission-aware on review.
// The person it blocked was a ทีม SAMO member who could read and edit PR
// tickets and was refused on delete alone (0149).
//
// The repo already knew this class — it is the most-repeated one here, "a new
// access channel must be threaded through EVERY gate the old one used", with
// five prior entries. Knowing it did not catch this one. This test does.
//
// THE RULE: if a SECURITY DEFINER function raises 42501 (not authorized) and
// brings the ROLE into that decision — `current_user_role()`,
// `current_user_is_staff()` (itself just a role list), or a staff role name —
// then it must ALSO consult the permission channel. 85 accounts currently hold
// a permission while carrying a non-staff role; every one of them is invisible
// to a role list.
//
// WHAT THIS TEST CHECKS AND WHAT IT CANNOT.
// It reads the MIGRATION FILES, so it sees what the next author is about to
// commit — the point is to fail in review, before it reaches a person. It
// cannot see whether the predicate is CORRECT, only that the channel is
// consulted; the live differential for the pair 0149 fixed is
// `tools/pr0149-delete-permission.sql`, which asks the policy and the RPC the
// same question and fails if they disagree. Both exist on purpose: this one is
// cheap and runs on every commit, that one is true and needs the database.
//
// Comments are STRIPPED before matching. A guard that a mention in prose can
// satisfy is the failure mode this repo has already paid for once —
// confirm-modal.test.js passed with the bug present because its pattern matched
// inside a comment.
//
// IT FOLLOWS ONE LEVEL OF HELPER CALLS (0168). Extracting a guard into a shared
// predicate is the RIGHT fix for the drift class — it is what the VS side has
// done since 0083 — but it silently moved the decision out of the body this
// sweep reads. `soft_delete_pr_ticket` went from spelling the rule itself to
// calling `current_user_can_manage_pr()`, and a body-only sweep would then skip
// it at "it decides some other way": clean-looking, and blind. A cleanup must
// not cost a guard its eyesight, so the bodies of called public functions are
// appended before matching, and `sees through a helper` below is the control
// that proves the expansion is actually happening.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const MIGRATIONS = new URL('../../supabase/migrations/', import.meta.url).pathname;

/**
 * Functions that legitimately decide on a role alone. Each entry must say WHY,
 * and the reason must be about the AUTHORIZATION, not about convenience.
 *
 * It is empty, and that is the finding: after 0149 there is no function in this
 * schema that both refuses somebody and decides on the role alone. An entry
 * added here is a claim that a permission holder SHOULD be refused — make it
 * out loud, in the migration too.
 */
const ROLE_ONLY_BY_DESIGN = Object.create(null);

/** Anything that reads the permission channel, directly or through a helper. */
const PERMISSION_CHANNEL = /current_user_has_permission|current_user_vs_scope|current_user_vs_depts|current_user_project_seats|current_user_is_shop_admin|managed_permissions/i;

/**
 * Anything that brings the ROLE into the decision — including the staff role
 * NAMES themselves, for a function that reads `users.role` directly.
 *
 * This began as a pattern for the role-list SYNTAX
 * (`current_user_role() in (…)`), and it was BLIND: 0045 had already captured
 * the call into `v_role` and tested the VARIABLE, so re-introducing the exact
 * bug this test exists for left it green. The lesson is the repo's own — match
 * the CHANNEL, not one spelling of it. Anything that consults the role at all
 * and refuses somebody has to answer for the permission holders too.
 */
const ROLE_CHANNEL = /current_user_role|current_user_is_staff|'(?:pr_staff|vs_staff|shop_admin|vp_admin|uni_staff|dev)'/i;

const stripComments = (sql) => sql
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/--[^\n]*/g, ' ');

/**
 * The LIVE definition of every function: migrations replay in order, so the
 * last `create or replace` wins and a `drop function` un-defines it. Checking
 * every historical body instead would flag 0043 and 0045 forever — history is
 * not something a future commit can fix, and a test that cannot go green gets
 * deleted rather than heeded.
 */
function liveFunctions() {
  const live = new Map();
  const files = readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith('.sql'))
    .sort((a, b) => parseInt(a, 10) - parseInt(b, 10));

  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS, file), 'utf8');

    for (const m of sql.matchAll(/drop\s+function\s+(?:if\s+exists\s+)?(?:public\.)?([a-z0-9_]+)/gi)) {
      live.delete(m[1].toLowerCase());
    }

    // header up to the body delimiter, then the body up to its matching close.
    const re = /create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?([a-z0-9_]+)\s*\(([\s\S]*?)\)([\s\S]*?)(\$[a-z_]*\$)([\s\S]*?)\4/gi;
    for (const m of sql.matchAll(re)) {
      const [, name, , header, , body] = m;
      live.set(name.toLowerCase(), { name, file, header, body });
    }
  }
  return [...live.values()];
}

const FUNCTIONS = liveFunctions();

/** Live body of every function in the schema, by name, comments already gone. */
const BODIES = new Map(FUNCTIONS.map((f) => [f.name.toLowerCase(), stripComments(f.body)]));

/**
 * A function's body PLUS the bodies of the public functions it calls, one level
 * deep. Appended, never substituted: this feeds two channel REGEXES, and for
 * "is the role consulted anywhere in this decision" appending is exactly right
 * and cannot mangle the SQL the way a textual substitution would.
 *
 * One level, not transitive, and deliberately so — the helpers this schema
 * actually uses (`current_user_role`, `current_user_has_permission`,
 * `current_user_vs_scope`, `current_user_can_manage_pr`) are all leaves over
 * `public.users`. A cycle would loop; `name !== self` stops the only one that
 * can occur in a single level, and a deeper chain is a shape worth noticing by
 * hand rather than following automatically.
 */
function withHelpers(fn) {
  const self = fn.name.toLowerCase();
  const body = stripComments(fn.body);
  const seen = new Set();
  let out = body;
  for (const m of body.matchAll(/(?:public\.)?([a-z0-9_]+)\s*\(/gi)) {
    const name = m[1].toLowerCase();
    if (name === self || seen.has(name)) continue;
    const helper = BODIES.get(name);
    if (!helper) continue;
    seen.add(name);
    out += `\n/* inlined ${name}() */ ${helper}`;
  }
  return out;
}

describe('SECURITY DEFINER authorization', () => {
  it('parses the migrations at all (a sweep that finds nothing must prove it looked)', () => {
    expect(FUNCTIONS.length).toBeGreaterThan(40);
    const names = FUNCTIONS.map((f) => f.name);
    expect(names).toContain('soft_delete_pr_ticket');
    expect(names).toContain('soft_delete_vs_ticket');
    // The live body is the LAST one, not 0043's or 0149's.
    const pr = FUNCTIONS.find((f) => f.name === 'soft_delete_pr_ticket');
    expect(pr.file).toMatch(/^0168_/);
  });

  it('actually examines the functions that refuse people (the control)', () => {
    // A sweep whose CONTROL also finds nothing cannot tell "no offenders" from
    // "the parse broke". On 2026-08-12 this set matched `pg_proc` in the live
    // database EXACTLY — 14 functions, same names — so if a regex change here
    // drops the count, the sweep has gone blind rather than clean.
    const refusers = FUNCTIONS.filter((f) => /security\s+definer/i.test(stripComments(f.header))
      && stripComments(f.body).includes('42501'));
    expect(refusers.length).toBeGreaterThanOrEqual(12);
    expect(refusers.map((f) => f.name)).toContain('soft_delete_pr_ticket');
    expect(refusers.map((f) => f.name)).toContain('vs_transfer_dept');
  });

  it('refuses nobody on the ROLE channel alone', () => {
    const offenders = [];

    for (const fn of FUNCTIONS) {
      const header = stripComments(fn.header);
      const body = withHelpers(fn);                   // sees through a shared predicate
      if (!/security\s+definer/i.test(header)) continue;
      if (!body.includes('42501')) continue;          // it never refuses anyone
      if (!ROLE_CHANNEL.test(body)) continue;         // it decides some other way
      if (PERMISSION_CHANNEL.test(body)) continue;    // it consults the channel
      if (fn.name in ROLE_ONLY_BY_DESIGN) continue;

      offenders.push(`${fn.name} (${fn.file})`);
    }

    expect(offenders, [
      'These SECURITY DEFINER functions refuse a caller on the ROLE channel and',
      'never ask whether they hold the matching PERMISSION. 85 accounts hold a',
      'permission with a non-staff role — a ทีม SAMO node grant produces exactly',
      'that shape — and every one of them is refused by a role list.',
      '',
      'Fix: add `or public.current_user_has_permission(\'<key>\')` to the guard,',
      'mirroring the policy for the same table. If the refusal is deliberate,',
      'add the function to ROLE_ONLY_BY_DESIGN with the reason.',
      '',
      'See docs/mistakes/authz-grants.md — the โมนา entry (0149).',
    ].join('\n')).toEqual([]);
  });

  it('sees through a helper (the control for the expansion itself)', () => {
    // THE INSTRUMENT'S OWN GUARD. Without this, `withHelpers` could quietly
    // stop expanding — a typo in the call regex, a rename — and the sweep would
    // go back to reading bodies only. It would still be GREEN, because a
    // function whose decision it can no longer see is skipped, not flagged.
    //
    // soft_delete_pr_ticket is the case that motivated the change: after 0168
    // its own body names NEITHER channel, and both appear only inside the
    // predicate it calls. So raw-vs-expanded is a direct measurement of whether
    // the expansion happened.
    const pr = FUNCTIONS.find((f) => f.name === 'soft_delete_pr_ticket');
    const raw = stripComments(pr.body);
    const expanded = withHelpers(pr);

    expect(raw).toContain('current_user_can_manage_pr');
    expect(PERMISSION_CHANNEL.test(raw),
      'the RPC body itself must NOT name the permission channel — if it does, '
      + 'the rule has been copied back out of the predicate').toBe(false);
    expect(PERMISSION_CHANNEL.test(expanded),
      'the expansion is not reaching the predicate; the sweep is blind').toBe(true);
    expect(ROLE_CHANNEL.test(expanded),
      'the expansion is not reaching the predicate; the sweep is blind').toBe(true);
  });

  it('every entry claiming to be role-only by design gives a reason', () => {
    for (const [name, reason] of Object.entries(ROLE_ONLY_BY_DESIGN)) {
      expect(typeof reason === 'string' && reason.length > 30,
        `${name}: an exemption needs a written reason, not a placeholder`).toBe(true);
    }
  });
});
