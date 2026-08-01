// ==============================================
// MODAL STACK — make a Bootstrap modal opened ON TOP of another one actually
// appear on top.
//
// Bootstrap's docs say "multiple open modals not supported", and it means it:
// every `.modal` gets z-index 1055 and every `.modal-backdrop` 1050, with no
// per-instance adjustment. Equal z-index means DOM order decides the painting
// order — so a second modal declared EARLIER in the HTML renders BEHIND the one
// it was opened from. That is exactly what happened to the ทีม SAMO ตำแหน่ง
// picker (`#teamPickerModal`, line ~149 of tab-team.html) when opened from the
// member editor (`#teamMemberModal`, line ~372): the picker opened, the backdrop
// dimmed, and the picker itself was invisible underneath the member modal.
//
// The fix is one delegated listener, not a per-modal patch: on `show.bs.modal`,
// count the modals ALREADY showing and lift this one (and the backdrop Bootstrap
// is about to append for it) above them.
//
// Also re-asserts `modal-open` on <body> when an inner modal closes — Bootstrap
// strips it on any hide, unlocking page scroll behind a modal that is still up.
// ==============================================

/** Bootstrap's own `$zindex-modal`. Kept in sync with the CSS variable-free
 *  default; a stacked modal is lifted in STEP increments above it. */
const BASE_Z = 1055;
const STEP = 20;

let wired = false;

export function initModalStack() {
  if (wired) return;
  wired = true;

  document.addEventListener('show.bs.modal', (e) => {
    const el = e.target;
    if (!el?.classList?.contains('modal')) return;
    // `show.bs.modal` fires BEFORE Bootstrap adds `.show` to this element and
    // before it appends this modal's backdrop, so the query counts exactly the
    // modals that are already up.
    const depth = document.querySelectorAll('.modal.show').length;
    if (!depth) { el.style.zIndex = ''; return; }
    const z = BASE_Z + depth * STEP;
    el.style.zIndex = String(z);
    // The backdrop is appended synchronously later in the same show() call, so
    // it exists by the next frame — before the browser paints, hence no flash.
    requestAnimationFrame(() => {
      const backdrops = document.querySelectorAll('.modal-backdrop');
      const mine = backdrops[backdrops.length - 1];
      if (mine && !mine.dataset.stacked) {
        mine.dataset.stacked = '1';
        mine.style.zIndex = String(z - 10);
      }
    });
  });

  document.addEventListener('hidden.bs.modal', (e) => {
    if (e.target?.style) e.target.style.zIndex = '';
    // An inner modal closing takes `modal-open` off <body> even though the outer
    // one is still shown, which unlocks scrolling behind it.
    if (document.querySelector('.modal.show')) document.body.classList.add('modal-open');
  });
}
