// ==============================================
// PR AUTH — Google OAuth Login/Logout for PR
// ==============================================

import { decodeJwtResponse } from './utils.js';

let isPrAccountVerified = false;

export function getIsPrAccountVerified() { return isPrAccountVerified; }
export function setIsPrAccountVerified(val) { isPrAccountVerified = val; }

export function initPrAuth() {
  const savedEmail = localStorage.getItem('prGoogleUserEmail');
  const savedName = localStorage.getItem('prGoogleUserName');
  if (savedEmail && savedName) {
    document.getElementById('prGoogleUserEmail').value = savedEmail;
    document.getElementById('prGoogleUserName').value = savedName;
    document.getElementById('prVerifiedEmail').innerText = savedEmail;
    document.getElementById('prTrackEmailDisplay').innerText = savedEmail;
    isPrAccountVerified = true;
    updateGoogleAuthUI(true);
  }
}

export function handlePrGoogleLogin(response) {
  const payload = decodeJwtResponse(response.credential);
  localStorage.setItem('prGoogleUserEmail', payload.email);
  localStorage.setItem('prGoogleUserName', payload.name);
  document.getElementById('prGoogleUserEmail').value = payload.email;
  document.getElementById('prGoogleUserName').value = payload.name;
  document.getElementById('prVerifiedEmail').innerText = payload.email;
  document.getElementById('prTrackEmailDisplay').innerText = payload.email;
  isPrAccountVerified = true;
  updateGoogleAuthUI(true);
}

export function logoutGoogle() {
  localStorage.removeItem('prGoogleUserEmail');
  localStorage.removeItem('prGoogleUserName');
  isPrAccountVerified = false;
  document.getElementById('prGoogleUserEmail').value = '';
  document.getElementById('prGoogleUserName').value = '';
  updateGoogleAuthUI(false);
}

export function updateGoogleAuthUI(isLoggedIn) {
  if (isLoggedIn) {
    document.getElementById('prNotLoggedInState').classList.add('d-none');
    document.getElementById('prLoggedInState').classList.remove('d-none');
    document.getElementById('prTrackNotLoggedIn').classList.add('d-none');
    document.getElementById('prTrackLoggedIn').classList.remove('d-none');
  } else {
    document.getElementById('prNotLoggedInState').classList.remove('d-none');
    document.getElementById('prLoggedInState').classList.add('d-none');
    document.getElementById('prTrackNotLoggedIn').classList.remove('d-none');
    document.getElementById('prTrackLoggedIn').classList.add('d-none');
  }
}

export function forceShowGoogleAuth() {
  document.getElementById('prAccGoogle').click();
  document.getElementById('prModeSubmit').click();
  setTimeout(() => {
    document.getElementById('prGoogleAuthContainer').scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, 100);
}

export function togglePrAccountFields() {
  const accMode = document.querySelector('input[name="prAccountMode"]:checked').value;
  const authContainer = document.getElementById('prGoogleAuthContainer');
  if (accMode === 'google') {
    authContainer.classList.remove('d-none');
    if (!isPrAccountVerified) {
      document.getElementById('prNotLoggedInState').classList.remove('d-none');
      document.getElementById('prLoggedInState').classList.add('d-none');
    } else {
      document.getElementById('prNotLoggedInState').classList.add('d-none');
      document.getElementById('prLoggedInState').classList.remove('d-none');
    }
  } else {
    authContainer.classList.add('d-none');
  }
}
