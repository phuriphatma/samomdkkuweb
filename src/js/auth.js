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

import { db } from './db.js';
import { decodeJwtResponse } from './utils.js';

// ============================================================
// Username convention for password accounts
//
// Supabase Auth requires an email. Our app supports username-only sign-up
// for users who don't want to share an email. We synthesize an email
// internally: "<username>@samomdkku.local". The user only ever sees /
// types their username; the synthetic email is transparent.
// ============================================================

const PASSWORD_EMAIL_DOMAIN = 'samomdkku.local';

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
  const { data: profile } = await db
    .from('users')
    .select('id, email, username, display_name, method, role, department')
    .eq('id', authUser.id)
    .maybeSingle();

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
    // Password field intentionally absent — Supabase manages auth state.
  };
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
  db.auth.onAuthStateChange(async (_event, session) => {
    currentUser = await buildCurrentUser(session);
    notify();
  });
}

/**
 * Google One Tap callback handler — receives the GSI credential and
 * exchanges it with Supabase for a session. The GSI client embeds a nonce
 * we don't have, so we use the legacy ID-token flow with the raw JWT.
 */
export async function signInWithCredential(credential) {
  const payload = decodeJwtResponse(credential);
  const { error } = await db.auth.signInWithIdToken({
    provider: 'google',
    token: credential,
    // nonce: omitted — only required when using Supabase's own GSI helper.
  });
  if (error) {
    console.error('[auth] Google sign-in failed:', error.message);
    throw new Error(error.message);
  }
  // onAuthStateChange will fire and update currentUser; meanwhile, update
  // the public.users row with Google profile info on first sign-in.
  // We defer to onAuthStateChange to avoid duplicating buildCurrentUser logic.
  return payload;
}

export async function signInWithPassword(rawUsername, rawPassword) {
  const username = (rawUsername || '').trim();
  const password = (rawPassword || '').trim();
  if (!username || !password) throw new Error('กรุณากรอก Username และ Password');

  const email = usernameToEmail(username);
  const { error } = await db.auth.signInWithPassword({ email, password });
  if (error) {
    // Supabase returns generic "Invalid login credentials". Translate.
    throw new Error('Username หรือ Password ไม่ถูกต้อง');
  }
  return currentUser;
}

export async function registerWithPassword(rawUsername, rawPassword) {
  const username = (rawUsername || '').trim();
  const password = (rawPassword || '').trim();
  if (!username || !password) throw new Error('กรุณากรอก Username และ Password');
  if (username.length < 3) throw new Error('Username ต้องมีอย่างน้อย 3 ตัวอักษร');
  if (password.length < 6) throw new Error('Password ต้องมีอย่างน้อย 6 ตัวอักษร');
  // Block reserved staff usernames (frontend check; backend enforces via
  // unique-username constraint in public.users too).
  if (['samomdkkupr', 'samomdkkuvssound', 'samomdkkudev'].includes(username.toLowerCase())) {
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
  await db.auth.signOut();
  currentUser = null;
  notify();
}

export function getUser() { return currentUser; }
export function isSignedIn() { return currentUser !== null; }
export function getRole() { return currentUser?.role || null; }
export function getDepartment() { return currentUser?.department || ''; }

export async function setDepartment(dept) {
  if (!currentUser) return;
  const { error } = await db
    .from('users')
    .update({ department: dept || null })
    .eq('id', currentUser.id);
  if (error) {
    console.error('[auth] setDepartment failed:', error.message);
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
