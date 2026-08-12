// ==============================================
// signin-modal.js — the ONE implementation of the sign-in modal's behaviour.
//
// WHY THIS MODULE EXISTS. `samoShowSigninScreen`, `samoPasswordSignIn` and
// `samoPasswordRegister` were defined VERBATIM TWICE — once in main.js and once
// in admin-main.js — and the reset-on-close lived in a third file
// (account-switch.js) because that was "the one module both entries import".
// Three homes for one screen's behaviour is this repo's most expensive shape
// (two implementations of one rule drift), and the moment the screens grew a
// segmented control that has to stay in step with them, the duplication would
// have had to be edited in both places or silently diverge in one entry.
//
// Both entries import mountSigninModal() now. Nothing about this screen is
// defined anywhere else.
// ==============================================
import { signInWithGoogle, signInWithPassword, registerWithPassword } from './auth.js';

const $ = (id) => document.getElementById(id);

/**
 * Show one of the two anonymous-route panels.
 *
 * This also swaps the dialog title. The panel and its title are two views of
 * ONE piece of state, so they are set in one place — a second function that
 * moved only one of them is how a screen ends up labelled as the other.
 */
export function showSigninScreen(screen) {
  const login = $('signinLoginScreen');
  const register = $('signinRegisterScreen');
  if (!login || !register) return;

  const showRegister = screen === 'register';
  login.classList.toggle('d-none', showRegister);
  register.classList.toggle('d-none', !showRegister);

  // The dialog's TITLE names the screen you are on. The register screen's title
  // is where "this is the anonymous account" is stated — the old flow put that
  // fact only on the screen the reader was leaving.
  $('signinTitleLogin')?.classList.toggle('d-none', showRegister);
  $('signinTitleRegister')?.classList.toggle('d-none', !showRegister);

  // Clear stale alerts — an error from the other panel is about a form the
  // reader can no longer see.
  $('signinLoginAlert')?.classList.add('d-none');
  $('signinRegisterAlert')?.classList.add('d-none');

  // NOTE: no focus move here. Focus belongs to pickScreen(), which the switch
  // LINKS call — the reset that runs when the modal closes goes through this
  // function instead, and focusing an input inside a dialog that is going away
  // pulls the phone keyboard up over the page behind it.
}

/** Same as showSigninScreen, plus focus. Wired to the switch links. */
function pickScreen(screen) {
  showSigninScreen(screen);
  const first = screen === 'register' ? $('signinRegisterUsername') : $('signinLoginUsername');
  // A phone keyboard opening over the panel the reader just chose is helpful;
  // one opening because a modal closed is not.
  first?.focus();
}

async function submitPasswordSignIn() {
  const alertEl = $('signinLoginAlert');
  const btn = $('signinLoginBtn');
  alertEl.classList.add('d-none');
  btn.disabled = true;
  const original = btn.innerHTML;
  btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>กำลังตรวจสอบ...';
  try {
    await signInWithPassword($('signinLoginUsername').value, $('signinLoginPassword').value);
    // The auth subscriber closes the modal.
  } catch (e) {
    alertEl.textContent = e.message || 'เข้าสู่ระบบไม่สำเร็จ';
    alertEl.classList.remove('d-none');
  } finally {
    btn.disabled = false;
    btn.innerHTML = original;
  }
}

async function submitPasswordRegister() {
  const alertEl = $('signinRegisterAlert');
  const btn = $('signinRegisterBtn');
  alertEl.classList.add('d-none');
  const password = $('signinRegisterPassword').value;
  if (password !== $('signinRegisterConfirm').value) {
    alertEl.textContent = 'รหัสผ่านไม่ตรงกัน';
    alertEl.classList.remove('d-none');
    return;
  }
  btn.disabled = true;
  const original = btn.innerHTML;
  btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>กำลังสมัคร...';
  try {
    await registerWithPassword($('signinRegisterUsername').value, password);
  } catch (e) {
    alertEl.textContent = e.message || 'สมัครสมาชิกไม่สำเร็จ';
    alertEl.classList.remove('d-none');
  } finally {
    btn.disabled = false;
    btn.innerHTML = original;
  }
}

export function mountSigninModal() {
  window.samoGoogleSignIn = async () => {
    try { await signInWithGoogle(); } catch (e) {
      alert('เปิดหน้า Google ไม่สำเร็จ: ' + (e.message || e));
    }
  };
  window.samoShowSigninScreen = pickScreen;
  window.samoPasswordSignIn = submitPasswordSignIn;
  window.samoPasswordRegister = submitPasswordRegister;

  // Password reveal. Delegated, so it covers both panels with one listener and
  // survives any future field being added with the same attribute.
  document.addEventListener('click', (e) => {
    const btn = e.target.closest?.('[data-signin-reveal]');
    if (!btn) return;
    const input = $(btn.dataset.signinReveal);
    if (!input) return;
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    btn.setAttribute('aria-pressed', String(show));
    btn.setAttribute('aria-label', show ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน');
    btn.querySelector('i')?.classList.toggle('bi-eye', !show);
    btn.querySelector('i')?.classList.toggle('bi-eye-slash', show);
  });

  // The modal always REOPENS on the sign-in panel with the password hidden.
  // Without this, one visit to สร้างบัญชีใหม่ made register the permanent
  // landing panel — including for the account switcher, which prefills
  // #signinLoginUsername and focuses #signinLoginPassword, so it opened a modal
  // that looked empty and did nothing. A revealed password persisting into the
  // next open is its own small leak.
  $('signinModal')?.addEventListener('hidden.bs.modal', () => {
    showSigninScreen('login');
    document.querySelectorAll('[data-signin-reveal]').forEach((btn) => {
      const input = $(btn.dataset.signinReveal);
      if (input) input.type = 'password';
      btn.setAttribute('aria-pressed', 'false');
      btn.setAttribute('aria-label', 'แสดงรหัสผ่าน');
      btn.querySelector('i')?.classList.add('bi-eye');
      btn.querySelector('i')?.classList.remove('bi-eye-slash');
    });
  });
}
