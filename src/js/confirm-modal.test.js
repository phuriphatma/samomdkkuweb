// ==============================================
// THE CANCEL BUTTON MUST ACTUALLY CANCEL.
//
// FOUND BY DRIVING THE REAL UI, 2026-08-10: the ยกเลิก button in `askConfirm`
// did nothing. Clicking it — by coordinate, and by element reference — left the
// dialog open. Only ESC and a backdrop click dismissed it. Every one of the 21
// askConfirm/askDelete call sites in the app was affected, which is every
// destructive confirmation there is.
//
// THE CAUSE, AND WHY IT SURVIVED REVIEW. Nothing in confirm-modal.js binds a
// click handler to `[data-confirm-no]`. The promise resolves from
// `hidden.bs.modal`, which is correct and elegant — ESC, backdrop and the button
// then all funnel through one place — but it only works if something actually
// HIDES the modal. The yes button calls `modal.hide()` explicitly; the no button
// was relying on a `data-bs-dismiss="modal"` attribute that was never written.
// The file's own header comment asserted "ESC / backdrop / ยกเลิก all mean
// false", so the intent was documented and the wiring simply absent — a comment
// is not a mechanism.
//
// THE IRONY IS THE POINT. This module exists BECAUSE Chrome's "prevent
// additional dialogs" checkbox turns native confirms into silently-false
// buttons that do nothing — reported twice, as "ลบสมาชิกไม่ได้" and as
// "ปฏิเสธ ไม่ทำงาน". The replacement shipped a button that does nothing.
//
// WHY THIS TEST IS STATIC. The dismissal is Bootstrap's, and asserting it
// end-to-end would mean loading Bootstrap into jsdom to test Bootstrap. What is
// actually at risk is the WIRING — one attribute, easy to drop in a refactor of
// the template string — so that is what is pinned, in both of the ways it can
// legitimately be satisfied.
// ==============================================
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const RAW = readFileSync(new URL('./confirm-modal.js', import.meta.url), 'utf8');

// COMMENTS ARE STRIPPED BEFORE ANY ASSERTION, and the first draft of this test
// is why. It looked for a click handler with
// `/\[data-confirm-no\][\s\S]*addEventListener\('click'/` — and the source's own
// comment contains the string `[data-confirm-no]`, while an unrelated
// `addEventListener('click', onYes)` sits further down. So the regex matched
// prose plus a different line, and the test PASSED with the bug reintroduced.
// A guard that reads comments is a guard that can be satisfied by writing about
// the fix instead of making it.
const SRC = RAW
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

/** The full <button ...> tag carrying the given marker attribute.
 *  Matched as a TAG, not by indexOf: the marker names also appear in this
 *  file's prose (and in the source's own comments), and a plain indexOf finds
 *  the comment first — which is how the first draft of this test reported "no
 *  cancel button found" against markup that was right there. */
function buttonTag(marker) {
  const m = new RegExp(`<button[^>]*\\b${marker}\\b[^>]*>`).exec(SRC);
  return m ? m[0] : null;
}

describe('askConfirm markup', () => {
  it('has both buttons to check (the instrument works)', () => {
    // A sweep that finds nothing is not evidence of nothing — mistakes.md #7.
    expect(buttonTag('data-confirm-no'), 'no cancel button found').toBeTruthy();
    expect(buttonTag('data-confirm-yes'), 'no confirm button found').toBeTruthy();
  });

  it('wires the cancel button to something that closes the dialog', () => {
    const tag = buttonTag('data-confirm-no');
    const dismisses = /data-bs-dismiss\s*=\s*["']modal["']/.test(tag || '');
    // The other legitimate implementation: bind a handler that hides it.
    const handled = /\[data-confirm-no\][\s\S]*addEventListener\(\s*['"]click['"]/.test(SRC);
    expect(dismisses || handled,
      'The ยกเลิก button neither carries data-bs-dismiss="modal" nor has a click '
      + 'handler. Nothing else hides the dialog on cancel, so the button is inert '
      + 'and every askConfirm caller hangs until the user finds ESC — the exact '
      + '"the button does nothing" failure this module was written to end.')
      .toBe(true);
  });

  it('still resolves the promise from hidden.bs.modal, so ESC and backdrop agree', () => {
    // If someone "fixes" cancel by resolving in a click handler instead, ESC and
    // the backdrop stop resolving and the caller hangs on those paths instead.
    // One exit, three ways in.
    expect(/hidden\.bs\.modal/.test(SRC)).toBe(true);
    expect(/resolve\(answer\)/.test(SRC)).toBe(true);
  });

  it('defaults the answer to false, so any dismissal means no', () => {
    expect(/let\s+answer\s*=\s*false/.test(SRC)).toBe(true);
  });
});
