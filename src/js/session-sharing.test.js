// ============================================================
// session-sharing.test.js — one sign-in covers both apps, and nothing asserts
// that but this file.
//
// THE PROPERTY THE WHOLE REPO MERGE EXISTS FOR. A Supabase session is stored in
// localStorage under a key derived from the project ref, and localStorage is
// scoped to the ORIGIN. So the moment samoweb and passport are served from one
// origin — `/` and `/passport/` — they read the SAME token and a student signs
// in once. There is no code that "does" single sign-on; it is a consequence of
// three things all staying true:
//
//   1. both clients point at the same Supabase project,
//   2. NEITHER main client sets a custom `storageKey`, and
//   3. they are served from one origin (the build + _redirects tests cover that).
//
// (2) is the fragile one. Adding `storageKey` to either client — which reads
// like sensible isolation — silently gives each app its own session and
// restores the two-login behaviour the merge removed. Nothing else in the suite
// would notice: both apps would still work perfectly, separately.
//
// Read as SOURCE on purpose. Importing passport/js/app.js would construct a
// real client and reach the network.
// ============================================================

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('../../', import.meta.url).pathname;
const WEB = readFileSync(join(ROOT, 'src/js/db.js'), 'utf8');
const PASS = readFileSync(join(ROOT, 'passport/js/app.js'), 'utf8');

/**
 * The `createClient(...)` call that builds an app's MAIN client — its ARGUMENT
 * LIST exactly, found by balancing parentheses.
 *
 * ⚠️ A fixed-size slice does not work here and the first draft of this file got
 * it wrong: passport declares its legacy-admin client — which correctly DOES set
 * a storageKey — a few hundred characters after the main one, so a 600-char
 * window read the wrong client's options and failed on correct code. Balance
 * the parens; the call ends where it ends.
 */
function mainClientCall(src, marker) {
  const i = src.indexOf(marker);
  expect(i, `could not find the main createClient call (${marker}) — did it move?`)
    .toBeGreaterThan(-1);
  const open = src.indexOf('(', i);
  let depth = 0;
  for (let j = open; j < src.length; j += 1) {
    if (src[j] === '(') depth += 1;
    else if (src[j] === ')') {
      depth -= 1;
      if (depth === 0) return src.slice(open, j + 1);
    }
  }
  throw new Error(`${marker}: unbalanced parentheses — could not find the end of the call`);
}

describe('single sign-on across / and /passport/', () => {
  it('read both clients (a sweep that finds nothing must prove it looked)', () => {
    expect(WEB).toContain('createClient');
    expect(PASS).toContain('createClient');
  });

  it('neither MAIN client sets a storageKey', () => {
    const web = mainClientCall(WEB, 'export const db = createClient(');
    const pass = mainClientCall(PASS, 'supabase = createClient(');
    for (const [name, call] of [['samoweb src/js/db.js', web], ['passport js/app.js', pass]]) {
      expect(call, [
        `${name}'s main client sets a storageKey.`,
        'That gives it a PRIVATE session, so signing in on one app no longer signs',
        'you in on the other — the single sign-on this repo was merged to get.',
        'Both apps keep working, separately, so nothing else here would fail.',
      ].join('\n')).not.toMatch(/storageKey/);
    }
  });

  it('both point at the same Supabase project', () => {
    // Different projects = different tokens = two logins, regardless of origin.
    expect(WEB).toContain('VITE_SUPABASE_URL');
    expect(PASS).toContain('VITE_SUPABASE_URL');
  });

  it('passport\'s LEGACY-ADMIN client keeps its own storageKey — the exception', () => {
    // The admin/1234 door signs into a shared account. It must NOT share the
    // default key, or opening the admin panel would silently replace an
    // organiser's own Google session with the shared one. This is the mirror of
    // the rule above and is asserted so a future "tidy up the storage keys"
    // cannot delete it along with the ones that must be absent.
    expect(PASS, [
      'passport\'s legacy-admin client lost its own storageKey.',
      'It signs into a SHARED account; without a separate key it would overwrite',
      'the signed-in student/organiser session on the same origin.',
    ].join('\n')).toContain('sb-passport-legacy-admin');
  });

  it('passport keeps routing its tables to the passport schema', () => {
    // Same project, same session — but passport's data must stay in its own
    // schema. If this is dropped, passport's queries hit `public` and read
    // samoweb's tables with a student's token.
    expect(PASS).toMatch(/schema:\s*['"]passport['"]/);
  });
});
