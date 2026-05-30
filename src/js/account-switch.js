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

import { onAuthChange, onBeforeSignOut, signOut, signInWithGoogle, getUser } from './auth.js';
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

/** Key used to dedupe a saved entry. Prefer the auth UUID (`id`) which
 *  is always present on a built user object — username/email can be
 *  empty on partial profiles (e.g. profile fetch raced) and would lead
 *  to a "" key colliding across accounts. Fall back to username then
 *  email for entries written before the `id` was tracked. */
function keyFor(acct) {
  return (acct.id || '').toLowerCase()
      || (acct.username || '').toLowerCase()
      || (acct.email || '').toLowerCase();
}

/** Remember (or update) an account after a successful sign-in. */
export function rememberAccount(user) {
  if (!user) return;
  // Require either an auth id or a usable secondary key. Without either
  // we'd save a row that we can never reliably re-identify, which is
  // exactly the bug that surfaced as "old account disappears after a
  // second sign-in".
  if (!user.id && !user.username && !user.email) return;
  const entry = {
    id:          user.id || '',
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

function renderAccountAvatar(acct) {
  return acct.picture
    ? `<img src="${escHtml(acct.picture)}" alt="" class="samo-account-avatar" />`
    : `<span class="samo-account-avatar samo-account-avatar-initials">${escHtml(renderInitials(acct.displayName))}</span>`;
}

function renderAccountRow(acct) {
  const key = keyFor(acct);
  const sub = acct.method === 'google' ? acct.email : (acct.username ? `@${acct.username}` : '');
  return `
    <li class="samo-account-row">
      <button type="button" class="samo-account-pick" data-account-key="${escHtml(key)}">
        ${renderAccountAvatar(acct)}
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

/** "You are signed in as …" card at the top of the chooser, with a
 *  Sign-out CTA. Matches Google's chooser pattern — clear separation
 *  between "current" and "switch to". */
function renderCurrentAccountCard(user) {
  if (!user) return '';
  const sub = user.method === 'google'
    ? (user.email || '')
    : (user.username ? `@${user.username}` : (user.email || ''));
  const avatar = user.picture
    ? `<img src="${escHtml(user.picture)}" alt="" class="samo-account-avatar" />`
    : `<span class="samo-account-avatar samo-account-avatar-initials">${escHtml(renderInitials(user.name || user.username || sub))}</span>`;
  return `
    <div class="samo-account-current">
      <div class="samo-account-current-head">
        ${avatar}
        <div class="samo-account-text">
          <span class="samo-account-name">${escHtml(user.name || user.username || 'ฉัน')}</span>
          ${sub ? `<span class="samo-account-sub">${escHtml(sub)}</span>` : ''}
        </div>
        <span class="samo-account-current-pill">บัญชีปัจจุบัน</span>
      </div>
      <button type="button" class="samo-account-current-signout" id="samoAccountSignOutBtn">
        <i class="bi bi-box-arrow-right me-1"></i>ออกจากระบบบัญชีนี้
      </button>
    </div>
  `;
}

function refreshList() {
  const currentWrap = document.getElementById('samoAccountCurrent');
  const wrap  = document.getElementById('samoAccountList');
  const empty = document.getElementById('samoAccountEmpty');
  const heading = document.getElementById('samoAccountOtherHeading');
  if (!wrap) return;

  // Current account at top.
  const user = getUser();
  if (currentWrap) currentWrap.innerHTML = renderCurrentAccountCard(user);

  // "Other accounts" — everything saved EXCEPT the current one.
  // Match by the same key precedence as keyFor() so partial profiles
  // (no username/email) still de-dupe by auth UUID.
  const currentKey = user
    ? ((user.id || '').toLowerCase()
       || (user.username || '').toLowerCase()
       || (user.email || '').toLowerCase())
    : '';
  const others = readSaved().filter((a) => keyFor(a) !== currentKey);

  if (others.length === 0) {
    wrap.innerHTML = '';
    if (heading) heading.classList.add('d-none');
    if (empty) empty.classList.toggle('d-none', !!user);  // hide empty msg when current is shown
    return;
  }
  if (heading) heading.classList.remove('d-none');
  if (empty) empty.classList.add('d-none');
  wrap.innerHTML = others.map(renderAccountRow).join('');
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
  // Snapshot the current user into the saved list BEFORE sign-out.
  // The onAuthChange subscriber would normally do this when the user
  // first signed in, but if that fire was dropped (subscriber not yet
  // mounted, partial profile, race with init) we'd lose them after
  // switching away. Belt-and-braces: write now so the next chooser
  // open still shows the previous account.
  try { rememberAccount(getUser()); } catch {}
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
  // Same belt-and-braces save as pickAccount: write the current user
  // into the saved list BEFORE the sign-out clears them, so the next
  // open of the chooser still lists them under "บัญชีอื่นที่บันทึกไว้".
  try { rememberAccount(getUser()); } catch {}
  signOut().catch(() => {});
  setTimeout(() => {
    const signinEl = document.getElementById('signinModal');
    if (signinEl && window.bootstrap) {
      // Clear any pre-filled username from a prior switch so the form
      // is genuinely empty for the "add another account" path.
      const u = document.getElementById('signinLoginUsername');
      const p = document.getElementById('signinLoginPassword');
      if (u) u.value = '';
      if (p) p.value = '';
      window.bootstrap.Modal.getOrCreateInstance(signinEl).show();
    }
  }, 80);
}

/** Open the switcher modal. Shows the current account on top + saved
 *  accounts below it. Falls back to "sign out + open sign-in" when
 *  nobody is signed in AND no accounts are saved (first-time user). */
export function openSwitcher() {
  const user = getUser();
  const list = readSaved();
  if (!user && list.length === 0) {
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
    modalEl.addEventListener('click', async (e) => {
      const forget = e.target.closest('[data-account-forget]');
      if (forget) {
        forgetAccount(forget.dataset.accountForget);
        refreshList();
        return;
      }
      const signOutBtn = e.target.closest('#samoAccountSignOutBtn');
      if (signOutBtn) {
        const bs = window.bootstrap;
        if (bs && modalEl) bs.Modal.getOrCreateInstance(modalEl).hide();
        try { await signOut(); } catch {}
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
  // Belt-and-braces: snapshot the outgoing user just before the global
  // signOut flips currentUser to null. The onAuthChange subscriber
  // would otherwise see only the post-clear `null` state and have no
  // way to record who just left, which manifested as "old account
  // disappears after a second sign-in" because the onAuthChange
  // snapshot path raced with the supabase-js token refresh.
  onBeforeSignOut((user) => {
    if (user) rememberAccount(user);
  });
}
