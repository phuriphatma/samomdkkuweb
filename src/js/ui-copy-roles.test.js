// ui-copy-roles.test.js — a message a PERSON reads must not name a database
// role.
//
// WHY THIS IS A TEST AND NOT A NOTE. Three ประกาศ errors said "ต้องเป็น
// pr_staff หรือ dev". They were written when that WAS the rule; 0014 taught
// `announcements_write` the `creator` permission, which a ทีม SAMO node grants
// as เขียนประกาศ and which `master` answers yes to. The copy never learned.
// Nobody was blocked — the gate was correct the whole time — so nothing ever
// forced the sentence to be re-read. That is the shape: user-facing copy that
// restates an authorization rule drifts SILENTLY, because it is only shown to
// someone who has already failed, and a person who is refused rarely reports
// the wording of the refusal.
//
// It is the same class as `definer-authz.test.js` one layer up: a rule
// restated in a second place drifts from the place that enforces it. There the
// second place was SQL; here it is a sentence.
//
// THE RULE. A string literal that contains Thai — i.e. something a person is
// meant to read — must not contain a raw role identifier. Two reasons, and the
// weaker one is the drift:
//
//   1. `pr_staff` is not a word. It is a column value. Nobody outside this repo
//      can act on it, so it fails the standing copy rule in memory: name the
//      CONSEQUENCE (what you cannot do) or the AUDIENCE (who this is for),
//      never the mechanism.
//   2. Naming one channel makes the sentence a claim about ALL of them, and the
//      permission channel is the one that keeps being added later.
//
// Say the permission the way the ทีม SAMO admin says it — เขียนประกาศ, PR,
// VitalSound — because that is the word the reader will look for when they go
// and ask for it.
//
// WHAT IT CANNOT SEE. Copy that lives in `src/html` attributes, in the database,
// or in Apps Script. And it cannot tell a WRONG sentence from a right one — only
// that no role identifier appears in it. `announcements.js` could still promise
// the wrong thing in perfectly plain Thai.
//
// Comments are stripped with the shared scanner, never a fresh regex: a
// hand-rolled block-comment regex opened on `'image/*'` and blanked 13,839
// characters before any assertion ran (see strip-comments.js).
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from './strip-comments.js';

const SRC = new URL('.', import.meta.url).pathname;

/** Every `users.role` value the schema allows, as it is spelled in the column. */
const ROLE_IDS = ['pr_staff', 'vs_staff', 'shop_admin', 'vp_admin', 'uni_staff', 'sa_prof'];

// Thai is the tell for "a person reads this". An English-only string in this
// codebase is a key, a class name, a URL or a console message.
const THAI = /[฀-๿]/;

/**
 * String literals in a JS source, comments already gone.
 *
 * Deliberately three separate simple patterns rather than one clever one: this
 * is an INSTRUMENT, and the control below proves it can see a planted
 * violation. A pattern that silently stopped matching would make this guard
 * pass by finding nothing, which is the failure mode it exists to avoid.
 */
function stringLiterals(code) {
  const out = [];
  for (const re of [/'(?:[^'\\\n]|\\.)*'/g, /"(?:[^"\\\n]|\\.)*"/g, /`(?:[^`\\]|\\.)*`/g]) {
    for (const m of code.matchAll(re)) out.push(m[0]);
  }
  return out;
}

function offenders(code, file) {
  return stringLiterals(stripComments(code))
    .filter((s) => THAI.test(s) && ROLE_IDS.some((r) => s.includes(r)))
    .map((s) => `${file}: ${s.slice(0, 90)}`);
}

const FILES = readdirSync(SRC)
  .filter((f) => f.endsWith('.js') && !f.endsWith('.test.js'))
  .map((f) => ({ file: f, code: readFileSync(join(SRC, f), 'utf8') }));

describe('user-facing copy does not name a database role', () => {
  it('reads the modules at all (a sweep that finds nothing must prove it looked)', () => {
    expect(FILES.length).toBeGreaterThan(20);
    // The control that matters: the sweep must be able to SEE Thai strings.
    // If the literal patterns broke, this drops to 0 and every assertion below
    // passes vacuously.
    const thai = FILES.flatMap(({ code }) => stringLiterals(stripComments(code)))
      .filter((s) => THAI.test(s));
    expect(thai.length).toBeGreaterThan(300);
  });

  it('finds a planted violation (the instrument, not the codebase)', () => {
    expect(offenders(`const m = 'ต้องเป็น pr_staff หรือ dev';`, 'planted.js')).toHaveLength(1);
    // ...and is not satisfied by the same sentence in a COMMENT. A guard that
    // prose can satisfy has already failed once here (confirm-modal.test.js).
    expect(offenders(`// ต้องเป็น pr_staff หรือ dev\nconst m = 'ok';`, 'planted.js')).toHaveLength(0);
    // An English-only mention is a key or a label, not a sentence to a person.
    expect(offenders(`const ROLES = ['pr_staff', 'dev'];`, 'planted.js')).toHaveLength(0);
  });

  it('no shipped module tells a person to "be pr_staff"', () => {
    const found = FILES.flatMap(({ file, code }) => offenders(code, file));
    expect(found, [
      'A message a person reads names a database role. They cannot act on it,',
      'and it is a claim about the gate that will drift the moment another',
      'channel is added — which is exactly what happened to the ประกาศ errors:',
      'they said "ต้องเป็น pr_staff หรือ dev" for 154 migrations after the',
      'policy learned current_user_has_permission(\'creator\').',
      '',
      'Say the permission the way ทีม SAMO says it — เขียนประกาศ, PR,',
      'VitalSound — or say what the person cannot do.',
    ].join('\n')).toEqual([]);
  });
});
