// ==============================================
// THE SIGN-IN MODAL: BOTH ROUTES VISIBLE, NEITHER ROUTE MISDESCRIBED.
//
// This screen has now been reported by the owner THREE times, and every report
// was about the same thing wearing different clothes: the markup or the wording
// quietly told a reader that a route was not for them.
//
// 1. THE PASSWORD FORM IS NOT HIDDEN. It used to live inside a `.collapse`
//    opened by a text link. That made a legitimate way in look like a footnote
//    — and it silently broke the account switcher: `pickAccount()` prefills
//    `#signinLoginUsername` and focuses `#signinLoginPassword`, and `.focus()`
//    on a display:none input is a no-op, so switching back to a password
//    account opened a modal that looked empty and did nothing.
//
// 2. THE COPY DESCRIBES AUDIENCES, NOT REQUIREMENTS. "นักศึกษาและบุคลากร MDKKU
//    ใช้บัญชี Google ของมหาวิทยาลัย" + "เลือกบัญชีที่ลงท้ายด้วย @kkumail.com" read
//    as a RULE. Google sign-in accepts any Google account.
//
// 3. AND SO DOES EMPHASIS. The fix for (2) named บุคคลทั่วไป but set the two KKU
//    domains in bold brand green — the only emphasis on the line — and the
//    owner read the button as KKU-only again ("it also gmail.com email etc.").
//    Bold is a claim. The caption must NAME GMAIL, and must not make the KKU
//    domains the loudest thing on the line.
//
// 4. THE SIGNUP LINK NEVER SAID WHAT THE ACCOUNT WAS FOR. "ยังไม่มีบัญชีชื่อ
//    ผู้ใช้? สมัครสมาชิก" — the one fact about that route (it is the anonymous
//    one) was on the screen the reader was leaving, never on the one where they
//    made the choice. Both panels now sit under a heading that names the route.
//
// PLUS ONE DEFECT THAT WAS NOT A WORDING PROBLEM: the register form advertised
// `minlength="4"` and "อย่างน้อย 4 ตัวอักษร" while `registerWithPassword()`
// rejects anything under 6. The form invited a password the code then refused.
// That is pinned DIFFERENTIALLY below — the number is read out of auth.js, so
// changing one side without the other fails.
//
// STATIC, AND COMMENT-STRIPPED FIRST. What is at risk here is markup structure
// and wording, not runtime behaviour — and a guard that reads comments can be
// satisfied by writing about the fix instead of making it (confirm-modal.test.js
// learned that the expensive way). This file's own comments describe the bad
// copy verbatim, so an un-stripped scan would find every forbidden phrase in
// the guard that forbids it.
// ==============================================
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { stripComments, stripHtmlComments } from './strip-comments.js';

// NOT a local regex. Every guard here used to carry its own, and every one was
// blind wherever a module contained `'image/*'` — the `/*` opened a "comment"
// that ran to the next `*​/` in the file and deleted 13,839 characters of
// main.js. That is how the duplicate-handler assertion below passed with a
// duplicate handler sitting in main.js. See strip-comments.js.
const stripHtml = stripHtmlComments;
const stripJs = (s) => stripComments(s);

const HTML = stripHtml(
  readFileSync(new URL('../html/modal-signin.html', import.meta.url), 'utf8'),
);
const SIGNIN_JS = stripJs(
  readFileSync(new URL('./signin-modal.js', import.meta.url), 'utf8'),
);
const AUTH_JS = stripJs(
  readFileSync(new URL('./auth.js', import.meta.url), 'utf8'),
);

// THE SLICE IS THE GUARD'S EYESIGHT, so it is checked before anything is
// asserted about it. If the markup is reordered so a slice comes back empty,
// every `not.toMatch` below passes for the worst possible reason.
const ANON = HTML.slice(HTML.indexOf('signin-anon'), HTML.indexOf('</section>'));
const HINT = HTML.slice(HTML.indexOf('signin-kku-hint'), HTML.indexOf('signin-divider'));

describe('sign-in modal — the guard can see the markup', () => {
  it('found the anonymous panel and the Google caption', () => {
    expect(ANON.length).toBeGreaterThan(500);
    expect(HINT.length).toBeGreaterThan(40);
    expect(HTML).toContain('samoGoogleSignIn');
  });
});

describe('sign-in modal — both routes are visible at once', () => {
  it('has no collapse anywhere in the modal', () => {
    expect(HTML).not.toMatch(/class="[^"]*\bcollapse\b/);
    expect(HTML).not.toMatch(/data-bs-toggle="collapse"/);
  });

  it('keeps the username and password inputs in the markup, not behind a link', () => {
    expect(ANON).toContain('id="signinLoginUsername"');
    expect(ANON).toContain('id="signinLoginPassword"');
  });

  it('offers สร้างบัญชีใหม่ as a full control, not a text link', () => {
    // The signup route was a ~14px anchor — the only way to create an account.
    // It is now one half of the segmented control, so it is a real target.
    expect(ANON).toMatch(/<button[^>]*signin-seg-btn[^>]*>[\s\S]*?สร้างบัญชีใหม่/);
    expect(ANON).not.toMatch(/<a[^>]*samoShowSigninScreen\('register'\)/);
  });

  it('names the anonymous route where the choice is made', () => {
    // Both panels live under this heading, so it is on screen whichever one is
    // showing — which is the whole point of the restructure.
    expect(ANON).toContain('ไม่เปิดเผยตัวตน');
  });

  it('gives Google the filled button and the anonymous form the outline one', () => {
    // Hierarchy is carried by weight, not by hiding. If this inverts, the
    // password form has been promoted over Google by accident.
    expect(HTML).toMatch(/btn btn-custom[^"]*"[^>]*onclick="samoGoogleSignIn\(\)"/);
    expect(ANON).toMatch(/class="btn signin-submit"[^>]*id="signinLoginBtn"/);
  });
});

describe('sign-in modal — the copy does not gate Google on a KKU address', () => {
  it('names Gmail, the account a non-KKU reader is looking for', () => {
    expect(HINT).toContain('Gmail');
    expect(HINT).toContain('บุคคลทั่วไป');
  });

  it('never instructs the reader to pick a kku address', () => {
    // The exact phrasings that caused reports 1 and 2, plus the imperative
    // shape they share. A kkumail address may be MENTIONED (KKU students scan
    // for it); it may not be presented as the account to choose.
    expect(HTML).not.toContain('เลือกบัญชีที่ลงท้ายด้วย');
    expect(HTML).not.toContain('ใช้บัญชี Google ของมหาวิทยาลัย');
  });

  it('does not emphasise the KKU domains — report 3 was about the bold', () => {
    // `<strong>`/`<b>` anywhere in the caption re-creates exactly the visual
    // claim the owner read as "these are the addresses that count".
    expect(HINT).not.toMatch(/<(strong|b)[\s>]/);
  });
});

describe('sign-in modal — the form asks for what the code accepts', () => {
  // A DIFFERENTIAL, because the alternative is two numbers that agree by
  // memory. The form said 4 for months while auth.js rejected 5.
  const minPassword = Number(
    AUTH_JS.match(/password\.length\s*<\s*(\d+)/)?.[1],
  );
  const minUsername = Number(
    AUTH_JS.match(/username\.length\s*<\s*(\d+)/)?.[1],
  );

  it('read both minimums out of auth.js (the control)', () => {
    expect(minPassword).toBeGreaterThan(0);
    expect(minUsername).toBeGreaterThan(0);
  });

  it('uses auth.js\'s password minimum in minlength AND in the help text', () => {
    expect(HTML).toContain(`id="signinRegisterPassword"`);
    const field = HTML.slice(
      HTML.indexOf('id="signinRegisterPassword"'),
      HTML.indexOf('id="signinRegisterConfirm"'),
    );
    expect(field).toContain(`minlength="${minPassword}"`);
    expect(field).toContain(`อย่างน้อย ${minPassword} ตัวอักษร`);
  });

  it('uses auth.js\'s username minimum in minlength AND in the help text', () => {
    const field = HTML.slice(
      HTML.indexOf('id="signinRegisterUsername"'),
      HTML.indexOf('id="signinRegisterPassword"'),
    );
    expect(field).toContain(`minlength="${minUsername}"`);
    expect(field).toContain(`อย่างน้อย ${minUsername} ตัวอักษร`);
  });

  it('keeps the rules in text that stays, not in a placeholder', () => {
    // A placeholder vanishes at the first keystroke — which is when the rule
    // starts to matter. Both hints are <p class="signin-help">.
    expect(ANON).not.toMatch(/placeholder="อย่างน้อย/);
    expect(ANON).toMatch(/class="signin-help"/);
  });
});

describe('sign-in modal — one implementation, and it resets', () => {
  it('defines the handlers exactly once, in signin-modal.js', () => {
    // They were duplicated verbatim in main.js and admin-main.js.
    for (const entry of ['main.js', 'admin-main.js']) {
      const src = stripJs(readFileSync(new URL(`./${entry}`, import.meta.url), 'utf8'));
      expect(src, `${entry} must import the sign-in behaviour, not restate it`)
        .not.toMatch(/window\.samo(PasswordSignIn|PasswordRegister|ShowSigninScreen|GoogleSignIn)\s*=/);
      expect(src).toContain('mountSigninModal');
    }
    expect(SIGNIN_JS).toMatch(/window\.samoPasswordSignIn\s*=/);
    expect(SIGNIN_JS).toMatch(/window\.samoShowSigninScreen\s*=/);
  });

  it('reopens on the sign-in panel', () => {
    const reset = SIGNIN_JS.slice(SIGNIN_JS.indexOf("$('signinModal')"));
    expect(reset).toMatch(/'hidden\.bs\.modal'/);
    expect(reset).toMatch(/showSigninScreen\('login'\)/);
  });

  it('re-hides a revealed password when the modal closes', () => {
    const reset = SIGNIN_JS.slice(SIGNIN_JS.indexOf("$('signinModal')"));
    expect(reset).toMatch(/type = 'password'/);
  });

  it('keeps the segmented control in step with the panel it labels', () => {
    // One function sets both. A second one that flipped only the buttons is how
    // a tab strip ends up disagreeing with the panel underneath it.
    const fn = SIGNIN_JS.slice(
      SIGNIN_JS.indexOf('export function showSigninScreen'),
      SIGNIN_JS.indexOf('function pickScreen'),
    );
    expect(fn).toContain("classList.toggle('d-none'");
    expect(fn).toContain('is-active');
    expect(fn).toContain('aria-selected');
  });
});
