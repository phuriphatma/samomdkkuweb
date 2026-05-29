// ==============================================
// AUTH — Global Supabase-backed sign-in
//
// Single source of truth for the signed-in user across the site.
// Wraps Supabase Auth (Google JWT, email/password) and maintains an
// app-level "currentUser" object enriched from public.users (role,
// department, username, method).
//
// Subscribers via onAuthChange react to user changes.
// ==============================================

import { db, dbRest } from './db.js';
import { decodeJwtResponse } from './utils.js';

// ============================================================
// Username convention for password accounts
//
// Supabase Auth requires an email. Our app supports username-only sign-up
// for users who don't want to share an email. We synthesize an email
// internally: "<username>@samomdkku.app". The user only ever sees /
// types their username; the synthetic email is transparent.
//
// Note: we use .app (not .local) because Supabase Auth rejects RFC 6762
// reserved TLDs like .local with "Email address is invalid". .app is a
// real public TLD (owned by Google); we never actually deliver mail to
// it — the format just needs to validate.
// ============================================================

const PASSWORD_EMAIL_DOMAIN = 'samomdkku.app';

function usernameToEmail(username) {
  return `${username.toLowerCase().trim()}@${PASSWORD_EMAIL_DOMAIN}`;
}

// ============================================================
// State + subscribers
// ============================================================

let currentUser = null;
const subscribers = new Set();

function notify() {
  for (const cb of subscribers) {
    try { cb(currentUser); } catch (e) { console.error('auth subscriber error', e); }
  }
}

// ============================================================
// User profile assembly
//
// `currentUser` = auth session info + public.users row, flattened.
// ============================================================

async function buildCurrentUser(session) {
  if (!session?.user) return null;
  const authUser = session.user;
  // Called from inside an onAuthStateChange callback (deferred via the
  // setTimeout(0) wrapper in initAuth). On some browsers — notably
  // Android Chrome — the supabase-js .from(...).select(...) path here
  // hangs even after the session lock is supposed to be released,
  // leaving the sign-in modal open with no error: the spinner returns
  // to "เข้าสู่ระบบ" because db.auth.signInWithPassword has resolved,
  // but currentUser is never populated so the auth subscriber never
  // closes the modal. See mistakes.md "supabase-js gets into a bad
  // state — bypass with dbRest()". Use dbRest here so the auth wake-
  // up never depends on supabase-js's PostgREST client state.
  const baseSelect = 'id,email,username,display_name,method,role,department';
  const idEsc = encodeURIComponent(authUser.id);
  let profile = null;
  {
    let { data, error } = await dbRest(
      `/users?id=eq.${idEsc}&select=${baseSelect},permissions&limit=1`,
    );
    if (error && error.status === 400 && /permissions/i.test(error.message || '')) {
      if (!window.__samoWarnedAuthPermissions) {
        window.__samoWarnedAuthPermissions = true;
        console.warn('[auth] permissions column missing — apply migration 0010_vp_accounts_permissions.sql to enable per-account feature gates.');
      }
      ({ data, error } = await dbRest(
        `/users?id=eq.${idEsc}&select=${baseSelect}&limit=1`,
      ));
    }
    if (Array.isArray(data) && data.length > 0) profile = data[0];
  }

  // Profile may be null briefly right after signup if the create-on-trigger
  // hasn't fired (or for unusual race conditions). Fall back to auth data.
  return {
    id: authUser.id,
    method: profile?.method || (authUser.app_metadata?.provider === 'google' ? 'google' : 'password'),
    username: profile?.username || authUser.user_metadata?.username || '',
    email: profile?.email || authUser.email || '',
    name: profile?.display_name || authUser.user_metadata?.display_name || authUser.user_metadata?.name || '',
    picture: authUser.user_metadata?.picture || authUser.user_metadata?.avatar_url || '',
    sub: authUser.user_metadata?.sub || authUser.id,
    role: profile?.role || 'user',
    department: profile?.department || '',
    permissions: Array.isArray(profile?.permissions) ? profile.permissions : [],
    // Password field intentionally absent — Supabase manages auth state.
  };
}

/**
 * Does the current user have access to a given feature key?
 * - Role-based defaults:
 *     pr_staff    → 'pr'
 *     vs_staff    → 'vs' (super; see all depts)
 *     shop_admin  → 'samoshop'
 *     vp_admin    → 'vs' only (own dept; DB RLS gates per-dept).
 *                   Projects is NOT a vp_admin default — only the
 *                   account(s) with 'projects' in permissions[] see it.
 *     uni_staff   → 'projects'
 *     dev         → everything
 * - Plus anything in user.permissions stacks on top.
 *
 * Use this for UI gating; the database RLS is the real boundary.
 */
export function userCanAccess(feature, user = currentUser) {
  if (!user) return false;
  if (user.role === 'dev') return true;
  const roleDefaults = {
    pr_staff:   ['pr'],
    vs_staff:   ['vs'],
    shop_admin: ['samoshop'],
    vp_admin:   ['vs'],
    uni_staff:  ['projects'],
  }[user.role] || [];
  if (roleDefaults.includes(feature)) return true;
  if (Array.isArray(user.permissions) && user.permissions.includes(feature)) return true;
  return false;
}

// ============================================================
// Public API
// ============================================================

export async function initAuth() {
  // Pull current session (Supabase restores from storage automatically).
  const { data: { session } } = await db.auth.getSession();
  currentUser = await buildCurrentUser(session);
  notify();

  // React to auth state changes (sign in / out / token refresh).
  //
  // CRITICAL: any async supabase-js call made INSIDE this callback will
  // deadlock the session lock and hang every subsequent supabase call.
  // This is a known supabase-js bug, ~2 years old:
  //   https://github.com/supabase/auth-js/issues/762
  //
  // The official workaround is to defer the work with setTimeout(0) so
  // it runs after the auth-state callback has returned and released
  // the lock. We MUST keep this wrapper — removing it brings back the
  // "form submit stuck on loading" hang.
  db.auth.onAuthStateChange((_event, session) => {
    setTimeout(async () => {
      currentUser = await buildCurrentUser(session);
      notify();
    }, 0);
  });
}

/**
 * Sign in with Google via Supabase's OAuth redirect flow. The browser
 * navigates to Google's consent screen, then to the Supabase callback,
 * then back to the app with a session attached to the URL (Supabase
 * client picks it up automatically via detectSessionInUrl).
 *
 * Returns a thenable: callers don't actually await the resolution since
 * the navigation happens immediately. onAuthStateChange fires when the
 * user lands back on the app.
 */
export async function signInWithGoogle() {
  const { error } = await db.auth.signInWithOAuth({
    provider: 'google',
    options: {
      // Land back on the current page after Google returns.
      redirectTo: window.location.origin + window.location.pathname,
    },
  });
  if (error) {
    console.error('[auth] Google OAuth start failed:', error.message);
    throw new Error(error.message);
  }
}

/**
 * Legacy Google One Tap credential handler. Kept for the existing
 * data-callback="handlePrGoogleLogin" wiring; in the new flow this is
 * unused but harmless if invoked. Prefer signInWithGoogle().
 */
export async function signInWithCredential(credential) {
  const payload = decodeJwtResponse(credential);
  const { error } = await db.auth.signInWithIdToken({
    provider: 'google',
    token: credential,
  });
  if (error) {
    console.error('[auth] ID-token sign-in failed:', error.message);
    throw new Error(error.message);
  }
  return payload;
}

export async function signInWithPassword(rawUsername, rawPassword) {
  const username = (rawUsername || '').trim();
  const password = (rawPassword || '').trim();
  if (!username || !password) throw new Error('กรุณากรอก Username และ Password');

  const email = usernameToEmail(username);
  const { data, error } = await db.auth.signInWithPassword({ email, password });
  if (error) {
    // Supabase returns generic "Invalid login credentials". Translate.
    throw new Error('Username หรือ Password ไม่ถูกต้อง');
  }
  // Belt-and-braces: explicitly populate currentUser and notify
  // subscribers right here instead of relying purely on the
  // onAuthStateChange listener. On Android Chrome the supabase-js
  // client occasionally drops the SIGNED_IN event after a previous
  // logout cycle (in-memory state goes stale; fresh tab fixes it).
  // When the listener does fire, this is idempotent.
  if (data?.session) {
    currentUser = await buildCurrentUser(data.session);
    notify();
  }
  return currentUser;
}

export async function registerWithPassword(rawUsername, rawPassword) {
  const username = (rawUsername || '').trim();
  const password = (rawPassword || '').trim();
  if (!username || !password) throw new Error('กรุณากรอก Username และ Password');
  if (username.length < 3) throw new Error('Username ต้องมีอย่างน้อย 3 ตัวอักษร');
  if (password.length < 6) throw new Error('Password ต้องมีอย่างน้อย 6 ตัวอักษร');
  // Block reserved staff usernames. All staff accounts in this app
  // follow the `samomdkku*` convention (samomdkkupr, samomdkkuvssound,
  // samomdkkushop, the 10 VP accounts samomdkkuvpa / samomdkkudigital /
  // samomdkkumdi / …) plus the legacy `sastaff` / `samomdkkudev`.
  // Use a prefix check so a brand-new dept account (e.g. a future
  // samomdkku<x>) can't be squatted before the admin seeds it.
  // Backend uniqueness on public.users.username is the second line of defence.
  const lc = username.toLowerCase();
  if (/^samomdkku/.test(lc) || lc === 'sastaff') {
    throw new Error('Username นี้สงวนไว้สำหรับเจ้าหน้าที่');
  }

  const email = usernameToEmail(username);
  const { error } = await db.auth.signUp({
    email,
    password,
    options: {
      data: {
        method: 'password',
        username,
        display_name: username,
      },
    },
  });
  if (error) {
    if (error.message?.toLowerCase().includes('already')) {
      throw new Error('Username นี้มีผู้ใช้งานแล้ว');
    }
    throw new Error(error.message || 'สมัครสมาชิกไม่สำเร็จ');
  }
  return currentUser;
}

export async function signOut() {
  // Optimistic local clear so the UI updates immediately, even if the
  // server-side revoke call hangs or fails. onAuthStateChange will also
  // fire when the actual signOut completes — currentUser is already null
  // so it's effectively a no-op then.
  currentUser = null;
  notify();
  try {
    await db.auth.signOut();
  } catch (e) {
    console.warn('[auth] signOut server call failed (local session already cleared):', e);
  }
}

export function getUser() { return currentUser; }
export function isSignedIn() { return currentUser !== null; }
export function getRole() { return currentUser?.role || null; }
export function getDepartment() { return currentUser?.department || ''; }

export async function setDepartment(dept) {
  if (!currentUser) return;
  // dbRest + return=representation: supabase-js would report success
  // even when zero rows update (RLS or id mismatch), and our local
  // currentUser would drift from the server (mistakes.md).
  const idEsc = encodeURIComponent(currentUser.id);
  const { data, error } = await dbRest(
    `/users?id=eq.${idEsc}`,
    { method: 'PATCH', body: { department: dept || null }, prefer: 'return=representation' },
  );
  if (error) {
    console.error('[auth] setDepartment failed:', error.message);
    return;
  }
  if (!Array.isArray(data) || data.length === 0) {
    console.error('[auth] setDepartment: no row updated (RLS or id mismatch)');
    return;
  }
  currentUser = { ...currentUser, department: dept || '' };
  notify();
}

/**
 * Subscribe to auth changes. The callback is invoked immediately with the
 * current state, then again on every sign-in / sign-out / profile update.
 * Returns an unsubscribe function.
 */
export function onAuthChange(cb) {
  subscribers.add(cb);
  try { cb(currentUser); } catch (e) { console.error('auth subscriber error', e); }
  return () => subscribers.delete(cb);
}
