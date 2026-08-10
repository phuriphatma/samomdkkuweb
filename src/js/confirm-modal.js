// ==============================================
// askConfirm() — an app-owned "are you sure?", because the browser's is not
// reliable control flow in a long-lived SPA.
//
// THE BUG THIS EXISTS FOR, TWICE OVER. Chrome shows a "Prevent this page from
// creating additional dialogs" checkbox after a few dialogs. Once it is ticked,
// every later `confirm()` returns **false** and every `prompt()` returns
// **null** — instantly, with no UI, for the whole life of that page. Code that
// reads those as "the user said no" then does nothing, silently, forever:
//
//   • ทีม SAMO's delete button ("ลบสมาชิกไม่ได้ — nothing happens at all"), and
//   • ระบบบ้าน's ปฏิเสธ on a คำขอแก้ไข, reported the same way and found to have
//     the same cause months later.
//
// An admin session reaches that checkbox easily — it is the sessions that use
// dialogs most that lose them first. So a destructive confirmation must be
// something this app draws.
//
// WHAT IT GUARANTEES
//   • It always resolves — true or false, never hangs.
//   • It cannot be suppressed by the browser.
//   • ESC / backdrop / ยกเลิก all mean false, exactly like a native confirm.
//   • It falls back to `window.confirm` ONLY when Bootstrap is absent (unit
//     tests, a stripped page). That is the one case where the native dialog is
//     better than no confirmation at all.
//
// Deliberately NOT a `prompt()` replacement: a value a user types belongs in the
// form it affects, where it is visible before they commit to it. ระบบบ้าน's
// reject-reason is an ordinary input in the request card for that reason.
// ==============================================
const MODAL_ID = 'appConfirmModal';

function ensureModal() {
  let el = document.getElementById(MODAL_ID);
  if (el) return el;
  el = document.createElement('div');
  el.id = MODAL_ID;
  el.className = 'modal fade';
  el.tabIndex = -1;
  el.setAttribute('aria-hidden', 'true');
  // `data-bs-dismiss="modal"` on the ยกเลิก button is LOAD-BEARING, not
  // decoration. Nothing in this module binds a click handler to
  // [data-confirm-no] — the promise resolves from `hidden.bs.modal`, so ESC,
  // the backdrop and the button can share one exit — but that only works if
  // something HIDES the modal. The yes button calls `modal.hide()` itself; the
  // no button has only this attribute. Without it the button is inert and the
  // caller hangs until the user discovers ESC, which is precisely the "the
  // button does nothing" failure this whole file was written to end. Pinned by
  // confirm-modal.test.js.
  //
  // (This paragraph lives out here rather than inside the template below
  // because it names attributes in backticks, and a backtick inside a template
  // literal ends the template literal — which is how the first attempt at this
  // comment turned the module into a syntax error.)
  el.innerHTML = `
    <div class="modal-dialog modal-dialog-centered modal-sm">
      <div class="modal-content">
        <div class="modal-body">
          <p class="fw-semibold mb-1" data-confirm-title></p>
          <p class="small text-muted mb-0" data-confirm-body></p>
        </div>
        <div class="modal-footer py-2">
          <button type="button" class="btn btn-sm btn-secondary"
                  data-bs-dismiss="modal" data-confirm-no>ยกเลิก</button>
          <button type="button" class="btn btn-sm btn-danger" data-confirm-yes>ยืนยัน</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(el);
  return el;
}

/**
 * @param {object} opts
 * @param {string} opts.title    the question, one line
 * @param {string} [opts.body]   the consequence, if it is not obvious
 * @param {string} [opts.yes]    label for the confirming button
 * @param {boolean} [opts.danger] red button (default true — this is for deletes)
 * @returns {Promise<boolean>}
 */
export function askConfirm({ title, body = '', yes = 'ยืนยัน', danger = true }) {
  // No Bootstrap (unit tests, or a page that did not load it): the native
  // dialog is worse, but it is not nothing.
  if (typeof document === 'undefined' || !window.bootstrap?.Modal) {
    return Promise.resolve(window.confirm?.(`${title}\n${body}`.trim()) === true);
  }

  const el = ensureModal();
  el.querySelector('[data-confirm-title]').textContent = title;
  const bodyEl = el.querySelector('[data-confirm-body]');
  bodyEl.textContent = body;
  bodyEl.hidden = !body;
  const yesBtn = el.querySelector('[data-confirm-yes]');
  yesBtn.textContent = yes;
  yesBtn.className = `btn btn-sm ${danger ? 'btn-danger' : 'btn-primary'}`;

  const modal = window.bootstrap.Modal.getOrCreateInstance(el);

  return new Promise((resolve) => {
    let answer = false;

    // STACKED-MODAL PLUMBING, copied deliberately from vs-staff.js's tag
    // manager rather than reinvented — this is the same situation and the same
    // two Bootstrap quirks. Both deletes that call this open from INSIDE an
    // already-open modal (the student editor, the advisor editor).
    //   1. Every modal and backdrop gets the same z-index, so the second
    //      backdrop lands UNDER the first modal and the confirm looks tangled
    //      with the form behind it.
    //   2. Closing the top modal makes Bootstrap drop `body.modal-open`, which
    //      kills scrolling in the modal still underneath.
    const onShown = () => {
      el.style.zIndex = '1080';
      const backdrops = document.querySelectorAll('.modal-backdrop');
      const last = backdrops[backdrops.length - 1];
      if (backdrops.length > 1 && last) last.style.zIndex = '1075';
    };
    // ONE listener per call, removed on close. The alternative — a delegated
    // listener on a node that outlives the dialog — accumulates one handler per
    // call and is the "click many times and sometimes it works" bug in
    // docs/mistakes/frontend-ui.md.
    const onYes = () => { answer = true; modal.hide(); };
    const onHidden = () => {
      if (document.querySelector('.modal.show')) {
        document.body.classList.add('modal-open');
      }
      yesBtn.removeEventListener('click', onYes);
      el.removeEventListener('shown.bs.modal', onShown);
      el.removeEventListener('hidden.bs.modal', onHidden);
      resolve(answer);          // ESC, backdrop and ยกเลิก all land here as false
    };
    yesBtn.addEventListener('click', onYes);
    el.addEventListener('shown.bs.modal', onShown);
    el.addEventListener('hidden.bs.modal', onHidden);
    modal.show();
  });
}

/** Convenience for the common shape: "delete X?" */
export function askDelete(what, consequence = '') {
  return askConfirm({
    title: `ลบ “${String(what)}” ?`,
    body: consequence || 'การลบนี้ย้อนกลับไม่ได้',
    yes: 'ลบ',
  });
}
