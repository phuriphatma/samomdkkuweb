// ==============================================
// PR AUTH — PR-form-specific reactions to the
// global auth state. The actual sign-in/out logic
// lives in auth.js; this module reflects the
// current user into the PR form DOM.
// ==============================================

import { onAuthChange, signOut as authSignOut, signInWithCredential } from './auth.js';

let isPrAccountVerified = false;

export function getIsPrAccountVerified() { return isPrAccountVerified; }
export function setIsPrAccountVerified(val) { isPrAccountVerified = val; }

export function initPrAuth() {
  onAuthChange((user) => {
    if (user) {
      isPrAccountVerified = true;
      // PR tickets are stored with a single "submitter" string in the sheet
      // (col 18). We need a stable identifier per user so history lookups
      // work for both Google sign-in (has email) AND username/password
      // sign-in (no email). Convention:
      //   - Google users → their email
      //   - Password users → "@<username>"
      const identifier = user.email || (user.username ? `@${user.username}` : '');
      const displayName = user.name || user.username || identifier;
      setVal('prGoogleUserEmail', identifier);
      setVal('prGoogleUserName', displayName);
      setText('prVerifiedEmail', identifier);
      setText('prTrackEmailDisplay', identifier);
      updateGoogleAuthUI(true);
    } else {
      isPrAccountVerified = false;
      setVal('prGoogleUserEmail', '');
      setVal('prGoogleUserName', '');
      updateGoogleAuthUI(false);
    }
  });
}

// Google Identity Services callback. Retained as a named export so the
// existing window.handlePrGoogleLogin binding keeps working for any HTML
// that still references it via data-callback.
export function handlePrGoogleLogin(response) {
  signInWithCredential(response.credential);
}

export function logoutGoogle() {
  authSignOut();
}

export function updateGoogleAuthUI(isLoggedIn) {
  toggleHidden('prNotLoggedInState', isLoggedIn);
  toggleHidden('prLoggedInState', !isLoggedIn);
  toggleHidden('prTrackNotLoggedIn', isLoggedIn);
  toggleHidden('prTrackLoggedIn', !isLoggedIn);
}

export function forceShowGoogleAuth() {
  document.getElementById('prAccGoogle')?.click();
  document.getElementById('prModeSubmit')?.click();
  setTimeout(() => {
    document.getElementById('prGoogleAuthContainer')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, 100);
}

export function togglePrAccountFields() {
  const accMode = document.querySelector('input[name="prAccountMode"]:checked')?.value;
  const authContainer = document.getElementById('prGoogleAuthContainer');
  if (!authContainer) return;
  if (accMode === 'google') {
    authContainer.classList.remove('d-none');
    toggleHidden('prNotLoggedInState', isPrAccountVerified);
    toggleHidden('prLoggedInState', !isPrAccountVerified);
  } else {
    authContainer.classList.add('d-none');
  }
}

function setVal(id, v) { const el = document.getElementById(id); if (el) el.value = v; }
function setText(id, v) { const el = document.getElementById(id); if (el) el.innerText = v; }
function toggleHidden(id, hide) { document.getElementById(id)?.classList.toggle('d-none', hide); }
