// ==============================================
// PROJECTS UI-PROMPT — Bootstrap-modal-based replacements for
// window.prompt() / window.confirm() used inside the projects module.
//
// Native prompt()/confirm() are unreliable on iPad inside webviews
// (e.g. the in-app Google App / Mail browser silently swallows them on
// some routes), and on Android they're slow / look out-of-place. This
// gives the comment / return-reason / resend-summary / delete flows a
// consistent UX across desktop, iPad, and mobile.
//
// Both helpers return a Promise. openProjectPrompt resolves to the
// trimmed string the user typed, or null if they cancelled.
// openProjectConfirm resolves to true on confirm, false on cancel.
// ==============================================

function getBootstrap() {
  return (typeof window !== 'undefined' && window.bootstrap) ? window.bootstrap : null;
}

/** @typedef {{
 *    title?: string,
 *    label?: string,
 *    placeholder?: string,
 *    hint?: string,
 *    initial?: string,
 *    okLabel?: string,
 *    required?: boolean,
 *    selectLabel?: string,
 *    selectOptions?: { value: string, label: string }[],
 *    selectInitial?: string,
 * }} ProjectPromptOpts */

/**
 * Open the universal prompt modal and wait for the user to submit or
 * cancel it. Returns a Promise that resolves to the trimmed string the
 * user typed, or `null` if they dismissed the dialog without confirming.
 *
 * When `selectOptions` is supplied the modal also shows a <select> and the
 * resolved value becomes `{ text, select }` instead of a bare string (still
 * `null` on cancel). Callers that don't pass `selectOptions` keep the old
 * string contract.
 * @param {ProjectPromptOpts} [opts]
 */
export function openProjectPrompt(opts = {}) {
  const hasSelect = Array.isArray(opts.selectOptions) && opts.selectOptions.length > 0;
  const bs = getBootstrap();
  const modalEl = document.getElementById('projectPromptModal');
  if (!bs || !modalEl) {
    // Fallback for any context where the modal partial wasn't loaded.
    const v = window.prompt(opts.title || opts.label || '');
    const text = v == null ? null : v.trim();
    if (text == null) return Promise.resolve(null);
    return Promise.resolve(hasSelect ? { text, select: opts.selectInitial || opts.selectOptions[0].value } : text);
  }
  const titleEl  = document.getElementById('projectPromptTitle');
  const labelEl  = document.getElementById('projectPromptLabel');
  const inputEl  = document.getElementById('projectPromptInput');
  const hintEl   = document.getElementById('projectPromptHint');
  const okLabel  = document.getElementById('projectPromptOkLabel');
  const formEl   = document.getElementById('projectPromptForm');
  const okBtn    = document.getElementById('projectPromptOk');
  const selWrap  = document.getElementById('projectPromptSelectWrap');
  const selLabel = document.getElementById('projectPromptSelectLabel');
  const selEl    = document.getElementById('projectPromptSelect');

  if (titleEl) titleEl.textContent = opts.title || 'กรอกข้อความ';
  if (labelEl) labelEl.textContent = opts.label || 'ข้อความ';
  if (inputEl) {
    inputEl.value = opts.initial || '';
    inputEl.placeholder = opts.placeholder || '';
  }
  if (hintEl) hintEl.textContent = opts.hint || '';
  if (okLabel) okLabel.textContent = opts.okLabel || 'บันทึก';
  if (okBtn) okBtn.disabled = false;
  if (selWrap && selEl) {
    if (hasSelect) {
      if (selLabel) selLabel.textContent = opts.selectLabel || 'แจ้งเตือนถึง';
      selEl.innerHTML = opts.selectOptions
        .map((o) => `<option value="${String(o.value).replace(/"/g, '&quot;')}">${String(o.label).replace(/</g, '&lt;')}</option>`)
        .join('');
      selEl.value = opts.selectInitial != null ? opts.selectInitial : opts.selectOptions[0].value;
      selWrap.classList.remove('d-none');
    } else {
      selWrap.classList.add('d-none');
      selEl.innerHTML = '';
    }
  }

  const modal = bs.Modal.getOrCreateInstance(modalEl);
  return new Promise((resolve) => {
    let result = null;
    let settled = false;

    const onSubmit = (e) => {
      e.preventDefault();
      const v = (inputEl?.value || '').trim();
      if (opts.required && !v) {
        inputEl?.focus();
        inputEl?.classList.add('is-invalid');
        return;
      }
      result = hasSelect ? { text: v, select: selEl?.value || '' } : v;
      settled = true;
      modal.hide();
    };
    const onHidden = () => {
      formEl?.removeEventListener('submit', onSubmit);
      modalEl.removeEventListener('hidden.bs.modal', onHidden);
      inputEl?.classList.remove('is-invalid');
      if (selWrap) selWrap.classList.add('d-none');
      resolve(settled ? result : null);
    };

    formEl?.addEventListener('submit', onSubmit);
    modalEl.addEventListener('hidden.bs.modal', onHidden);
    modal.show();
    // Defer focus until after the modal transition lays the field out;
    // immediate focus inside .show() races with Bootstrap's own focus.
    setTimeout(() => inputEl?.focus(), 200);
  });
}

/** @typedef {{
 *    title?: string,
 *    body: string,
 *    okLabel?: string,
 *    okVariant?: 'danger' | 'success' | 'primary',
 * }} ProjectConfirmOpts */

/**
 * Open the universal confirm modal. Returns true on confirm, false on
 * cancel/dismiss.
 * @param {ProjectConfirmOpts} opts
 */
export function openProjectConfirm(opts) {
  const bs = getBootstrap();
  const modalEl = document.getElementById('projectConfirmModal');
  if (!bs || !modalEl) {
    return Promise.resolve(window.confirm(opts?.body || ''));
  }
  const titleEl = document.getElementById('projectConfirmTitle');
  const bodyEl  = document.getElementById('projectConfirmBody');
  const okBtn   = document.getElementById('projectConfirmOk');
  const okLabel = document.getElementById('projectConfirmOkLabel');

  if (titleEl) titleEl.textContent = opts.title || 'ยืนยัน';
  if (bodyEl)  bodyEl.textContent  = opts.body  || 'คุณแน่ใจหรือไม่?';
  if (okLabel) okLabel.textContent = opts.okLabel || 'ยืนยัน';
  if (okBtn) {
    okBtn.classList.remove('btn-danger', 'btn-success', 'btn-primary');
    okBtn.classList.add(`btn-${opts.okVariant || 'danger'}`);
  }

  const modal = bs.Modal.getOrCreateInstance(modalEl);
  return new Promise((resolve) => {
    let confirmed = false;
    const onClick = () => {
      confirmed = true;
      modal.hide();
    };
    const onHidden = () => {
      okBtn?.removeEventListener('click', onClick);
      modalEl.removeEventListener('hidden.bs.modal', onHidden);
      resolve(confirmed);
    };
    okBtn?.addEventListener('click', onClick);
    modalEl.addEventListener('hidden.bs.modal', onHidden);
    modal.show();
  });
}
