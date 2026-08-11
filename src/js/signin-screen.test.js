// ==============================================
// THE SIGN-IN MODAL: BOTH ROUTES VISIBLE, NEITHER ROUTE MISDESCRIBED.
//
// TWO THINGS THIS PINS, both reported by the owner on 2026-08-12.
//
// 1. THE PASSWORD FORM IS NOT HIDDEN. It used to live inside a
//    `.collapse` opened by a text link. That made a legitimate way in look like
//    a footnote — and it silently broke the account switcher: `pickAccount()`
//    prefills `#signinLoginUsername` and focuses `#signinLoginPassword`, and
//    `.focus()` on a display:none input is a no-op, so switching back to a
//    password account opened a modal that looked empty and did nothing.
//
// 2. THE COPY DESCRIBES AUDIENCES, NOT REQUIREMENTS. "นักศึกษาและบุคลากร MDKKU
//    ใช้บัญชี Google ของมหาวิทยาลัย" + "เลือกบัญชีที่ลงท้ายด้วย @kkumail.com" read as a
//    RULE. Google sign-in accepts any Google account; anyone outside KKU who
//    read that concluded the button was not for them. The rule that must
//    survive every future edit of this copy: the Google line names บุคคลทั่วไป
//    too, and never phrases a kkumail address as the account to pick.
//
// AND THE MODAL REOPENS ON THE LOGIN SCREEN. `samoShowSigninScreen()` toggles a
// d-none between login and register and nothing ever toggled it back, so one
// visit to สมัครสมาชิก made register the permanent landing screen — including
// for the account-switcher path above, which prefills a form on the screen that
// is no longer showing. The reset lives in account-switch.js because
// mountAccountSwitch() is the one module BOTH entries import.
//
// STATIC, AND COMMENT-STRIPPED FIRST. What is at risk here is markup structure
// and wording, not runtime behaviour — and a guard that reads comments can be
// satisfied by writing about the fix instead of making it (confirm-modal.test.js
// learned that the expensive way).
// ==============================================
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const stripHtml = (s) => s.replace(/<!--[\s\S]*?-->/g, '');
const stripJs = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const HTML = stripHtml(
  readFileSync(new URL('../html/modal-signin.html', import.meta.url), 'utf8'),
);
const SWITCH = stripJs(
  readFileSync(new URL('./account-switch.js', import.meta.url), 'utf8'),
);

// The login screen's markup, from its opening div to the register screen.
const LOGIN_SCREEN = HTML.slice(
  HTML.indexOf('id="signinLoginScreen"'),
  HTML.indexOf('id="signinRegisterScreen"'),
);

// THE SLICE IS THE GUARD'S EYESIGHT, so it gets checked before anything is
// asserted about it. Reorder the two screens in the markup and this slice
// becomes the empty string — at which point every `not.toMatch` below passes
// for the worst possible reason. Other assertions in this file would still go
// red, but they would blame the wrong thing; this one names it.
describe('sign-in modal — the guard can see the markup', () => {
  it('found a login screen with something in it', () => {
    expect(LOGIN_SCREEN.length).toBeGreaterThan(500);
    expect(LOGIN_SCREEN).toContain('samoGoogleSignIn');
  });
});

describe('sign-in modal — the password route is visible', () => {
  it('has no collapse anywhere on the login screen', () => {
    expect(LOGIN_SCREEN).not.toMatch(/class="[^"]*\bcollapse\b/);
    expect(LOGIN_SCREEN).not.toMatch(/data-bs-toggle="collapse"/);
  });

  it('keeps the username and password inputs on the login screen itself', () => {
    expect(LOGIN_SCREEN).toContain('id="signinLoginUsername"');
    expect(LOGIN_SCREEN).toContain('id="signinLoginPassword"');
  });

  it('gives Google the filled button and the password form the outline one', () => {
    // Hierarchy is carried by weight, not by hiding. If this inverts, the
    // password form has been promoted over Google by accident.
    expect(LOGIN_SCREEN).toMatch(/btn btn-custom[^"]*"[^>]*onclick="samoGoogleSignIn\(\)"/);
    expect(LOGIN_SCREEN).toMatch(/id="signinLoginBtn"/);
    expect(LOGIN_SCREEN).toMatch(/btn-outline-secondary[\s\S]*id="signinLoginBtn"/);
  });
});

describe('sign-in modal — the copy does not gate Google on a KKU address', () => {
  const hint = LOGIN_SCREEN.slice(
    LOGIN_SCREEN.indexOf('signin-kku-hint'),
    LOGIN_SCREEN.indexOf('signin-divider'),
  );

  it('names บุคคลทั่วไป as an audience for Google sign-in', () => {
    expect(hint).toContain('บุคคลทั่วไป');
  });

  it('never instructs the reader to pick a kku address', () => {
    // The exact phrasings that caused the report, plus the imperative shape
    // they share. A kkumail address may be MENTIONED (KKU students scan for
    // it); it may not be presented as the account to choose.
    expect(LOGIN_SCREEN).not.toContain('เลือกบัญชีที่ลงท้ายด้วย');
    expect(LOGIN_SCREEN).not.toContain('ใช้บัญชี Google ของมหาวิทยาลัย');
  });
});

describe('sign-in modal — reopening lands on the login screen', () => {
  it('account-switch.js resets the screens when the modal hides', () => {
    const reset = SWITCH.slice(SWITCH.indexOf("getElementById('signinModal')"));
    expect(reset).toMatch(/'hidden\.bs\.modal'/);
    expect(reset).toMatch(/signinLoginScreen'\)\?\.classList\.remove\('d-none'\)/);
    expect(reset).toMatch(/signinRegisterScreen'\)\?\.classList\.add\('d-none'\)/);
  });
});
