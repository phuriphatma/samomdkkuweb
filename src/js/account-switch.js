// ==============================================
// ACCOUNT-SWITCH — multi-account chooser (Gmail-style)
//
// We remember every account that has successfully signed in on this
// browser (no password — just enough to identify them and offer a one-
// tap re-sign-in). The chooser modal lists them; tapping one signs out
// the current session and pre-fills the sign-in modal with the chosen
// username, so the browser's saved-password autofill (or a single key-
// stroke from the user) lands them back into that account.
//
// Storage: localStorage key `samo.savedAccounts` — an array sorted by
// `lastUsed` desc. Capped at 6 to keep the chooser scannable.
// ==============================================

import { onAuthChange, signOut, signInWithGoogle } from './auth.js';
import { escHtml } from './utils.js';

const STORAGE_KEY = 'samo.savedAccounts';
const MAX_SAVED   = 6;

function readSaved() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch { return []; }
}

function writeSaved(list) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(list.slice(0, MAX_SAVED))); }
  catch {}
}

/** Key used to dedupe a saved entry. Prefer username (stable & short),
 *  fall back to email (for Google-only accounts that never set one). */
function keyFor(acct) {
  return (acct.username || '').toLowerCase() || (acct.email || '').toLowerCase();
}

/** Remember (or update) an account after a successful sign-in. */
export function rememberAccount(user) {
  if (!user) return;
  const entry = {
    username:    user.username || '',
    displayName: user.name || user.username || (user.email || '').split('@')[0] || 'บัญชี',
    email:       user.email || '',
    method:      user.method || 'password',
    picture:     user.picture || '',
    lastUsed:    new Date().toISOString(),
  };
  const key = keyFor(entry);
  if (!key) return;
  const list = readSaved().filter((a) => keyFor(a) !== key);
  list.unshift(entry);
  list.sort((a, b) => new Date(b.lastUsed) - new Date(a.lastUsed));
  writeSaved(list);
}

/** Drop one saved account (the "x" on each chooser row). */
export function forgetAccount(key) {
  const list = readSaved().filter((a) => keyFor(a) !== String(key).toLowerCase());
  writeSaved(list);
}

export function listSavedAccounts() {
  return readSaved();
}

function renderInitials(name) {
  const parts = String(name || '').trim().split(/\s+/).slice(0, 2);
  const initials = parts.map((p) => p.charAt(0).toUpperCase()).join('') || '?';
  return initials;
}

function renderAccountRow(acct) {
  const key = keyFor(acct);
  const sub = acct.method === 'google' ? acct.email : (acct.username ? `@${acct.username}` : '');
  return `
    <li class="samo-account-row">
      <button type="button" class="samo-account-pick" data-account-key="${escHtml(key)}">
        ${acct.picture
          ? `<img src="${escHtml(acct.picture)}" alt="" class="samo-account-avatar" />`
          : `<span class="samo-account-avatar samo-account-avatar-initials">${escHtml(renderInitials(acct.displayName))}</span>`
        }
        <span class="samo-account-text">
          <span class="samo-account-name">${escHtml(acct.displayName || 'บัญชี')}</span>
          ${sub ? `<span class="samo-account-sub">${escHtml(sub)}</span>` : ''}
        </span>
        <span class="samo-account-method-pill">${acct.method === 'google' ? 'Google' : 'รหัสผ่าน'}</span>
      </button>
      <button type="button" class="samo-account-forget" data-account-forget="${escHtml(key)}" aria-label="ลบบัญชีนี้ออกจากรายการ" title="ลบจากรายการ">
        <i class="bi bi-x-lg"></i>
      </button>
    </li>
  `;
}

function refreshList() {
  const wrap = document.getElementById('samoAccountList');
  const empty = document.getElementById('samoAccountEmpty');
  if (!wrap) return;
  const list = readSaved();
  if (list.length === 0) {
    wrap.innerHTML = '';
    if (empty) empty.classList.remove('d-none');
    return;
  }
  if (empty) empty.classList.add('d-none');
  wrap.innerHTML = list.map(renderAccountRow).join('');
}

async function pickAccount(key) {
  const acct = readSaved().find((a) => keyFor(a) === key);
  if (!acct) return;
  // Hide the switcher modal first so the sign-in modal can take the
  // stage without a backdrop fight.
  const switcher = document.getElementById('samoSwitchAccountModal');
  if (switcher && window.bootstrap) {
    window.bootstrap.Modal.getOrCreateInstance(switcher).hide();
  }
  try { await signOut(); } catch {}
  if (acct.method === 'google') {
    try { await signInWithGoogle({ loginHint: acct.email || undefined }); }
    catch (e) { alert('เปิดหน้า Google ไม่สำเร็จ: ' + (e.message || e)); }
    return;
  }
  // Password path: prefill the sign-in modal and let the browser's
  // password manager (or the user) handle the rest.
  setTimeout(() => {
    const signinEl = document.getElementById('signinModal');
    const uInput = document.getElementById('signinLoginUsername');
    const pInput = document.getElementById('signinLoginPassword');
    if (uInput) uInput.value = acct.username || '';
    if (pInput) pInput.value = '';
    if (signinEl && window.bootstrap) {
      window.bootstrap.Modal.getOrCreateInstance(signinEl).show();
      setTimeout(() => pInput?.focus(), 200);
    }
  }, 80);
}

function openAddAccountFlow() {
  const switcher = document.getElementById('samoSwitchAccountModal');
  if (switcher && window.bootstrap) {
    window.bootstrap.Modal.getOrCreateInstance(switcher).hide();
  }
  signOut().catch(() => {});
  setTimeout(() => {
    const signinEl = document.getElementById('signinModal');
    if (signinEl && window.bootstrap) {
      window.bootstrap.Modal.getOrCreateInstance(signinEl).show();
    }
  }, 80);
}

/** Open the switcher modal. Falls back to "sign out + open sign-in"
 *  when no saved accounts exist (first-time user). */
export function openSwitcher() {
  const list = readSaved();
  if (list.length === 0) {
    openAddAccountFlow();
    return;
  }
  const el = document.getElementById('samoSwitchAccountModal');
  if (!el || !window.bootstrap) {
    openAddAccountFlow();
    return;
  }
  refreshList();
  window.bootstrap.Modal.getOrCreateInstance(el).show();
}

/** Mount: wire one-time DOM handlers + the auth subscriber that records
 *  every successful sign-in into the saved-accounts list. */
export function mountAccountSwitch() {
  const modalEl = document.getElementById('samoSwitchAccountModal');
  if (modalEl) {
    modalEl.addEventListener('click', (e) => {
      const forget = e.target.closest('[data-account-forget]');
      if (forget) {
        forgetAccount(forget.dataset.accountForget);
        refreshList();
        return;
      }
      const pick = e.target.closest('[data-account-key]');
      if (pick) pickAccount(pick.dataset.accountKey);
    });
    document.getElementById('samoAccountAddBtn')?.addEventListener('click', openAddAccountFlow);
  }
  // Persist any successful sign-in. The subscriber fires immediately
  // with the current user on subscribe; rememberAccount is idempotent
  // (dedupes by key + sorts by lastUsed) so this is safe.
  onAuthChange((user) => {
    if (user) rememberAccount(user);
  });
}
