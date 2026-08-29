// google-provider-guard.test.js — a preview must not send people to a raw
// Supabase error page, and production must not pay for that.
//
// REPORTED 2026-08-29, from a preview:
//
//   {"code":400,"error_code":"validation_failed",
//    "msg":"Unsupported provider: provider is not enabled"}
//
// `signInWithOAuth` does not validate the provider — it builds the /authorize
// URL and navigates — so by the time Supabase refuses, the browser has left our
// app and there is nothing left to catch. The only place to say anything is
// before the navigation, which is what these pin.
//
// The two properties that matter are about POLARITY, and both fail in the
// dangerous direction if inverted: a check that blocks on "unknown" would break
// sign-in for everyone the moment a network hiccup ate the settings request,
// and a check that ran on production would put a new network dependency in
// front of the live site's main sign-in button to improve a preview's wording.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from './strip-comments.js';

const ROOT = new URL('../../', import.meta.url).pathname;
const RAW = readFileSync(join(ROOT, 'src/js/auth.js'), 'utf8');
// ⚠️ ASSERT ON CODE, NOT ON PROSE. The first version of the production-bailout
// test below passed while the bailout was DELETED, because the identifier it
// looked for still appeared in a comment — this repo's own
// "satisfied by a comment" failure, reproduced in the very test written to
// prevent a different one. Strip comments first, always.
const AUTH = stripComments(RAW);

/** The body of googleSignInAvailable(), so assertions are about the guard. */
function guardBody() {
  const start = AUTH.indexOf('async function googleSignInAvailable()');
  expect(start, 'googleSignInAvailable() is gone — was it renamed?').toBeGreaterThan(-1);
  return AUTH.slice(start, AUTH.indexOf('\nexport async function signInWithGoogle', start));
}

describe('the LINK button names the right fix, not a different one', () => {
  // Found by scrutiny, 2026-08-29. linkIdentity is NOT signInWithOAuth: it GETs
  // /user/identities/authorize before navigating, so a disabled provider comes
  // back as an error we can read. It was read by ONE branch that also matched
  // "manual linking", so a preview user was told to switch on a setting that
  // was already correct and had nothing to do with the failure.
  //
  // An instruction naming the WRONG fix is worse than the raw error — the raw
  // one does not send anyone to change a production setting.
  const fn = () => {
    const at = AUTH.indexOf('export async function linkGoogleIdentity');
    expect(at, 'linkGoogleIdentity() is gone').toBeGreaterThan(-1);
    return AUTH.slice(at, AUTH.indexOf('\n}', AUTH.indexOf('throw new Error(error.message', at)));
  };

  it('a disabled provider and disabled manual-linking are separate branches', () => {
    const body = fn();
    expect(body, 'nothing distinguishes a disabled PROVIDER from manual linking')
      .toMatch(/unsupported provider|provider is not enabled/);
    expect(body, 'the manual-linking branch still swallows the provider case')
      .not.toMatch(/manual linking'\)\s*\|\|\s*msg\.includes\('not enabled'\)/);
  });

  it('the provider branch is tested BEFORE the manual-linking one', () => {
    // "not enabled" is a substring of the provider message, so order decides
    // which message a person sees.
    const body = fn();
    const provider = body.indexOf('provider is not enabled');
    const manual = body.indexOf('manual linking');
    // Both must EXIST before their order means anything. Without this the
    // assertion passed vacuously when the provider branch was deleted:
    // indexOf returned -1, and -1 is less than everything.
    expect(provider, 'no provider branch to order').toBeGreaterThan(-1);
    expect(manual, 'no manual-linking branch to order').toBeGreaterThan(-1);
    expect(provider).toBeLessThan(manual);
  });
});

describe('the Google button does not walk into a Supabase error page', () => {
  it('checks availability BEFORE handing off to signInWithOAuth', () => {
    const fn = AUTH.slice(AUTH.indexOf('export async function signInWithGoogle'));
    const guardAt = fn.indexOf('googleSignInAvailable');
    const oauthAt = fn.indexOf('signInWithOAuth');
    expect(guardAt, 'signInWithGoogle no longer consults the guard').toBeGreaterThan(-1);
    expect(guardAt, 'the guard runs AFTER the navigation, which is too late to matter')
      .toBeLessThan(oauthAt);
  });

  it('production is untouched — no extra request in front of the live sign-in', () => {
    // The first thing the guard does must be to bail out on production.
    const body = guardBody();
    const ribbonAt = body.indexOf('ribbonLabel');
    const fetchAt = body.indexOf('fetch(');
    expect(ribbonAt, 'the guard does not check whether this is production at all')
      .toBeGreaterThan(-1);
    expect(ribbonAt, 'the guard fetches before deciding it is not production')
      .toBeLessThan(fetchAt);
    expect(body).toMatch(/return true;/);
  });

  it('fails OPEN: only a definite false blocks the button', () => {
    const body = guardBody();
    // A missing key, a non-ok response, a thrown fetch — all must yield true.
    expect(body, 'a non-ok settings response does not fall through to true')
      .toMatch(/if \(!r\.ok\) return true;/);
    expect(body, 'a thrown fetch does not fall through to true')
      .toMatch(/catch \{[\s\S]*return true;[\s\S]*\}/);
    expect(body, 'the check treats a missing value as a denial — it must not')
      .toMatch(/external\?\.google !== false/);
  });

  it('the message names what to do instead, in Thai, without jargon', () => {
    const fn = AUTH.slice(AUTH.indexOf('export async function signInWithGoogle'));
    const msg = fn.slice(fn.indexOf('throw new Error('), fn.indexOf('const oauthOptions'));
    expect(msg, 'the refusal does not tell the person how to get in').toMatch(/Password/);
    expect(msg, 'the refusal is not in Thai').toMatch(/[฀-๿]/);
    // It surfaces through an alert() in signin-modal.js, and an alert that
    // states a problem without a way forward is the shape this repo has
    // already paid for once.
    const modal = readFileSync(join(ROOT, 'src/js/signin-modal.js'), 'utf8');
    expect(modal, 'signInWithGoogle errors no longer reach the person')
      .toMatch(/signInWithGoogle\(\); \} catch/);
  });
});
