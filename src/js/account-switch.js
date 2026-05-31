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

import {
  onAuthChange,
  onBeforeSignOut,
  signOut,
  signInWithGoogle,
  getUser,
  getCurrentSessionTokens,
  setAuthSession,
} from './auth.js';
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
  // Preserve any previously-stored session tokens for this account so
  // a stale-but-non-empty rememberAccount call doesn't blow them away.
  // The async token capture below will overwrite with fresh tokens
  // once getSession() resolves.
  const prev = readSaved();
  const existing = prev.find((a) => keyFor(a) === key);
  if (existing?.access_token)  entry.access_token  = existing.access_token;
  if (existing?.refresh_token) entry.refresh_token = existing.refresh_token;
  const list = prev.filter((a) => keyFor(a) !== key);
  list.unshift(entry);
  list.sort((a, b) => new Date(b.lastUsed) - new Date(a.lastUsed));
  writeSaved(list);
  // Diagnostic: lets us verify in DevTools that every sign-in cycle
  // grows the saved-account list as expected. Surface via console
  // (debug level) so a normal user doesn't see noise but a tester
  // can flip "Verbose" on and trace the path.
  try {
    console.debug('[samo.account-switch] remember',
      { key, in: prev.map(keyFor), out: list.map(keyFor) });
  } catch {}
  // Async-capture the current session's tokens and stitch them onto the
  // saved entry. We can't await this in a sync subscriber, but the
  // tokens land in localStorage before the user has had time to open
  // the switcher again — and the entry exists from the line above so
  // the chooser already shows the account during the brief window.
  getCurrentSessionTokens().then((tokens) => {
    if (!tokens?.refresh_token) return;
    const after = readSaved();
    const idx = after.findIndex((a) => keyFor(a) === key);
    if (idx < 0) return;
    after[idx] = { ...after[idx], ...tokens };
    writeSaved(after);
  }).catch(() => {});
}

/** Drop one saved account (the "x" on each chooser row). */
export function forgetAccount(key) {
  const list = readSaved().filter((a) => keyFor(a) !== String(key).toLowerCase());
  writeSaved(list);
}

/** Strip cached tokens (but KEEP the account row) for one saved entry.
 *  Used after a fast-switch attempt fails — the refresh_token Supabase
 *  rejected is dead, so replaying it again would just produce the same
 *  console-noise 400. The entry stays in the chooser so the user can
 *  still pick it via the password path; only the stale tokens go. */
function clearSavedTokens(key) {
  const list = readSaved();
  const idx = list.findIndex((a) => keyFor(a) === key);
  if (idx < 0) return;
  const { access_token, refresh_token, ...rest } = list[idx];
  list[idx] = rest;
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

// Re-entrancy guard. The bootstrap modal hide animation runs ~150ms,
// during which a second tap on a different (or the same) row would
// kick off a parallel pickAccount → setSession would race itself.
// The flag stays set until either the fast-switch resolves or the
// slow-path sign-in modal is on screen.
let switchInFlight = false;

/** Visually mark the row the user picked: replace the role pill with
 *  a tiny spinner + Thai status text, and dim the rest of the chooser.
 *  Gives the user a clear "yes, I heard you" signal during the round-
 *  trip — without this, taps that take 1–2s feel broken. */
function markRowBusy(row) {
  if (!row) return null;
  const pill = row.querySelector('.samo-account-method-pill');
  const prevHtml = pill?.innerHTML;
  if (pill) {
    pill.innerHTML = '<span class="spinner-border spinner-border-sm me-1" style="width:.8em; height:.8em;"></span>กำลังสลับ…';
  }
  row.setAttribute('aria-busy', 'true');
  row.classList.add('is-switching');
  return () => {
    if (pill && prevHtml !== undefined) pill.innerHTML = prevHtml;
    row.removeAttribute('aria-busy');
    row.classList.remove('is-switching');
  };
}

async function pickAccount(key, originRow) {
  if (switchInFlight) {
    console.debug('[samo.account-switch] pickAccount ignored — already switching');
    return;
  }
  const acct = readSaved().find((a) => keyFor(a) === key);
  if (!acct) {
    console.warn('[samo.account-switch] pickAccount: no saved account for key', key);
    return;
  }
  switchInFlight = true;
  const undoRowBusy = markRowBusy(originRow);
  const releaseBusy = () => { switchInFlight = false; undoRowBusy?.(); };

  // Snapshot the current user into the saved list BEFORE we switch
  // away — captures fresh tokens and shields against any timing-race
  // that could lose the prior account from the chooser.
  try { rememberAccount(getUser()); } catch {}
  // Give the snapshot a microtask + a beat to flush its async token
  // capture before we replace the current session — otherwise we'd
  // race ourselves and lose the outgoing account's refresh_token.
  await new Promise((r) => setTimeout(r, 80));

  // Fast path: if we have the target account's saved refresh_token,
  // replay the session directly. supabase-js auto-refreshes the
  // access_token when needed, so an hours/days-old token still works
  // as long as the refresh_token is valid. No password needed.
  const refreshed = readSaved().find((a) => keyFor(a) === key);
  if (refreshed?.refresh_token && refreshed?.access_token) {
    console.debug('[samo.account-switch] fast-switching to', key);
    // Bumped to 10s — at 5s, slower connections were timing out on
    // the supabase-js setSession round-trip and falling silently
    // through to a slow path the user couldn't see (modal already
    // hidden). 10s is still under any reasonable user patience.
    const swapped = await setAuthSession({
      access_token:  refreshed.access_token,
      refresh_token: refreshed.refresh_token,
    }, { timeoutMs: 10000 });
    if (swapped) {
      console.debug('[samo.account-switch] fast switch ok');
      // Hide the switcher modal AFTER the swap so the auth subscriber's
      // UI updates happen on the visible app, not behind a closing
      // modal — that's what made "tap, modal closes, looks like
      // nothing happened" feel intermittent.
      const switcher = document.getElementById('samoSwitchAccountModal');
      if (switcher && window.bootstrap) {
        window.bootstrap.Modal.getOrCreateInstance(switcher).hide();
      }
      releaseBusy();
      return;
    }
    console.warn('[samo.account-switch] fast switch failed (timeout / revoked refresh) — falling back to sign-in form');
    // The saved refresh_token is dead (rotated past its grace window,
    // global-signOut revoked it, or supabase wedged setSession). Drop it
    // so future opens of the chooser go straight to the password path
    // instead of replaying the same 400 every time.
    clearSavedTokens(key);
  }

  // Slow path / first-time switch / Google: hide the switcher,
  // sign out, open the sign-in flow.
  const switcher = document.getElementById('samoSwitchAccountModal');
  if (switcher && window.bootstrap) {
    window.bootstrap.Modal.getOrCreateInstance(switcher).hide();
  }
  try { await signOut(); } catch {}
  releaseBusy();

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
  // 'local' scope: clear THIS device's session but DON'T revoke the
  // refresh_token on the server. That refresh_token stays valid so a
  // later "switch back" via the saved-account chooser can replay it
  // (setAuthSession) without forcing the user through the form again.
  signOut({ scope: 'local' }).catch(() => {});
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
  // Snapshot the current user on EVERY chooser open — this is the
  // last-line-of-defence belt-and-suspenders against any code path
  // (sync race, missed subscriber fire, third-party tab event) that
  // could have left the current user out of the saved list. The
  // user's reported repro ("old account is gone after I add a new
  // one") only matters from the moment they re-open this modal, so
  // catching them here is sufficient.
  try { rememberAccount(user); } catch {}
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

/** Diagnostic helper exposed on window so a tester can paste the
 *  current saved-accounts state from DevTools console without having
 *  to dig through localStorage by hand. */
if (typeof window !== 'undefined') {
  window.samoDebugAccounts = () => ({
    currentUser: getUser(),
    saved: readSaved(),
  });
}

/** Mount: wire one-time DOM handlers + the auth subscriber that records
 *  every successful sign-in into the saved-accounts list. */
export function mountAccountSwitch() {
  // Global a11y fix for Bootstrap modals: Bootstrap stamps aria-hidden=
  // "true" on a modal while a descendant (the picked account button, the
  // signin password input, etc.) still holds focus. Chrome / Edge now
  // log "Blocked aria-hidden on an element because its descendant
  // retained focus" for that combo. Bootstrap's recommended escape is
  // to move focus out before hide completes — do that once here so every
  // modal in the app is covered.
  document.addEventListener('hide.bs.modal', (e) => {
    const modal = e.target;
    if (!modal || !modal.contains?.(document.activeElement)) return;
    try { document.activeElement.blur(); } catch {}
  });

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
      if (pick) pickAccount(pick.dataset.accountKey, pick.closest('.samo-account-row') || pick);
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
