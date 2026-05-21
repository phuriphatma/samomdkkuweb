// ==============================================
// AUTH — Global sign-in state
// Single source of truth for the signed-in user
// across the whole site. Supports three credential
// methods: Google OAuth (JWT), username/password
// (regular user), and username/password (staff).
//
// Subscribers wire up via onAuthChange and react
// to user changes.
// ==============================================

import { decodeJwtResponse } from './utils.js';
import { GAS_API_URL, GAS_VITAL_SOUND_URL } from './config.js';

const STORAGE_KEY = 'samoUser';

// Legacy keys used by pr-auth.js before the global auth refactor.
// Kept in sync so any old code reading them keeps working.
const LEGACY_EMAIL_KEY = 'prGoogleUserEmail';
const LEGACY_NAME_KEY = 'prGoogleUserName';

// Magic usernames trigger a role on successful login. The backend still
// verifies the password against its own staff endpoint; we use the username
// only to route the verification request.
const STAFF_ACCOUNTS = {
  samomdkkupr: 'pr_staff',
  samomdkkuvssound: 'vs_staff',
  samomdkkudev: 'dev',
};

// Dev credentials are client-side because this is an internal toggle for
// the maintainer (not a security boundary). Change to suit.
const DEV_USERNAME = 'samomdkkudev';
const DEV_PASSWORD = 'samo69dev';

let currentUser = null;
const subscribers = new Set();

function persist() {
  if (currentUser) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(currentUser));
    localStorage.setItem(LEGACY_EMAIL_KEY, currentUser.email || '');
    localStorage.setItem(LEGACY_NAME_KEY, currentUser.name || '');
  } else {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(LEGACY_EMAIL_KEY);
    localStorage.removeItem(LEGACY_NAME_KEY);
  }
}

function notify() {
  for (const cb of subscribers) {
    try { cb(currentUser); } catch (e) { console.error('auth subscriber error', e); }
  }
}

function setUser(next) {
  currentUser = next;
  persist();
  notify();
}

function defaultUser() {
  return {
    method: 'google',  // 'google' | 'password' | 'staff'
    username: '',
    // Password is persisted only for method='password' so the VS form can
    // re-submit the user's identity (the VS backend writes username+password
    // alongside each ticket so the user can later see history). Pattern
    // matches the existing pr-staff / vs-staff "Remember Me" remember of
    // raw credentials in localStorage. Not a security boundary.
    password: '',
    email: '',
    name: '',
    picture: '',
    sub: '',
    role: 'user',      // 'user' | 'pr_staff' | 'vs_staff' | 'dev'
    department: '',
  };
}

export function initAuth() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      // Backfill role/method for users stored before the role field existed.
      currentUser = { ...defaultUser(), ...parsed };
    } catch {
      currentUser = null;
    }
  } else {
    // Migrate from legacy PR-scoped keys if present
    const email = localStorage.getItem(LEGACY_EMAIL_KEY);
    const name = localStorage.getItem(LEGACY_NAME_KEY);
    if (email && name) {
      currentUser = { ...defaultUser(), email, name };
      persist();
    }
  }
  notify();
}

export function signInWithCredential(credential) {
  const payload = decodeJwtResponse(credential);
  const prevDept = currentUser?.department || '';
  setUser({
    ...defaultUser(),
    method: 'google',
    email: payload.email || '',
    name: payload.name || '',
    picture: payload.picture || '',
    sub: payload.sub || '',
    department: prevDept,
  });
  return currentUser;
}

export async function signInWithPassword(rawUsername, rawPassword) {
  const username = (rawUsername || '').trim();
  const password = (rawPassword || '').trim();
  if (!username || !password) throw new Error('กรุณากรอก Username และ Password');

  const staffRole = STAFF_ACCOUNTS[username];

  if (staffRole === 'pr_staff') {
    const res = await postJson(GAS_API_URL, {
      action: 'verifyPRStaffLogin', username, password,
    });
    if (!res.success) throw new Error(res.message || 'Username หรือ Password ไม่ถูกต้อง');
    setUser({ ...defaultUser(), method: 'staff', username, role: 'pr_staff', name: 'PR Staff' });
    return currentUser;
  }

  if (staffRole === 'vs_staff') {
    const res = await postJson(GAS_VITAL_SOUND_URL, {
      action: 'verifyStaffLogin', username, password,
    });
    if (!res.success) throw new Error(res.message || 'Username หรือ Password ไม่ถูกต้อง');
    setUser({ ...defaultUser(), method: 'staff', username, role: 'vs_staff', name: 'VitalSound Staff' });
    return currentUser;
  }

  if (staffRole === 'dev') {
    if (username !== DEV_USERNAME || password !== DEV_PASSWORD) {
      throw new Error('Username หรือ Password ไม่ถูกต้อง');
    }
    setUser({ ...defaultUser(), method: 'staff', username, role: 'dev', name: 'Developer' });
    return currentUser;
  }

  // Regular user — verify against the VS backend's account check.
  // The VS sheet doubles as the user store (rows hold username/password
  // alongside Vital Sound tickets), so VS verifyAccount mode=login is the
  // canonical user-account check.
  const res = await postJson(GAS_VITAL_SOUND_URL, {
    action: 'verifyAccount', mode: 'login', username, password,
  });
  if (!res.success) throw new Error(res.message || 'ไม่พบบัญชี');
  setUser({ ...defaultUser(), method: 'password', username, password, role: 'user', name: username });
  return currentUser;
}

export async function registerWithPassword(rawUsername, rawPassword) {
  const username = (rawUsername || '').trim();
  const password = (rawPassword || '').trim();
  if (!username || !password) throw new Error('กรุณากรอก Username และ Password');
  if (username.length < 3) throw new Error('Username ต้องมีอย่างน้อย 3 ตัวอักษร');
  if (password.length < 4) throw new Error('Password ต้องมีอย่างน้อย 4 ตัวอักษร');
  if (STAFF_ACCOUNTS[username]) throw new Error('Username นี้สงวนไว้สำหรับเจ้าหน้าที่');

  // Backend verifyAccount mode=create checks for username collision only;
  // the account is actually written to the sheet on first VS submission.
  const res = await postJson(GAS_VITAL_SOUND_URL, {
    action: 'verifyAccount', mode: 'create', username, password,
  });
  if (!res.success) throw new Error(res.message || 'ไม่สามารถสมัครสมาชิกได้');
  setUser({ ...defaultUser(), method: 'password', username, password, role: 'user', name: username });
  return currentUser;
}

export function signOut() {
  setUser(null);
}

export function getUser() { return currentUser; }
export function isSignedIn() { return currentUser !== null; }
export function getRole() { return currentUser?.role || null; }
export function getDepartment() { return currentUser?.department || ''; }

export function setDepartment(dept) {
  if (!currentUser) return;
  setUser({ ...currentUser, department: dept || '' });
}

/**
 * Subscribe to auth changes. The callback is invoked immediately with the
 * current state, then again on every sign-in / sign-out / department change.
 * Returns an unsubscribe function.
 */
export function onAuthChange(cb) {
  subscribers.add(cb);
  try { cb(currentUser); } catch (e) { console.error('auth subscriber error', e); }
  return () => subscribers.delete(cb);
}

async function postJson(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error('เชื่อมต่อล้มเหลว');
  return res.json();
}
