// master (ทุกระบบ) must reach the maintenance affordances the `dev` ROLE has.
//
// REPORTED (2026-08-17): a master holder (phuriphat.ma, master inherited from
// ฝ่าย IT) opened the app and found features "stripped off" versus the shared
// `samomdkkudev` (role=dev): no "ไม่ส่งแจ้งเตือน Discord" toggle on the PR/VS
// forms, and the VS workspace hid its full-department controls.
//
// CAUSE — the master≠role gap. `master` is honored by PERMISSION gates
// (userCanAccess, the DB has_permission which folds master) but a master holder
// is role='user', so any gate written as `role === 'dev'` (or a literal role
// list) skips them. The DB already treated master as VS-super
// (current_user_vs_scope() = null for has_permission('vs') ← master), so the
// frontend was hiding controls the database grants — the frontend/DB-mismatch
// class.
//
// These two gates were the reported sites. Guarding the SOURCE because both are
// DOM-coupled (main.js runs the whole app at import). Comments are stripped so a
// mention in prose cannot satisfy the assertion (the confirm-modal.test.js trap).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { stripComments } from './strip-comments.js';

const MAIN = stripComments(readFileSync(new URL('./main.js', import.meta.url), 'utf8'));
const VS = stripComments(readFileSync(new URL('./vs-staff.js', import.meta.url), 'utf8'));

describe('master reaches the dev-role maintenance features', () => {
  it('the "ไม่ส่งแจ้งเตือน Discord" toggle is shown to dev OR master, never dev alone', () => {
    // The .dev-only-feature gate must not hide the toggle from a master holder.
    // Asserting the whole predicate: dropping the holdsMaster() term reverts the
    // bug, and requiring `role !== 'dev'` keeps the dev role working.
    expect(MAIN).toMatch(/\.dev-only-feature['"]\)[\s\S]{0,120}toggle\('d-none',\s*role !== 'dev' && !holdsMaster\(/);
    // holdsMaster must actually be imported, not re-derived (the 0111 drift class).
    expect(MAIN).toMatch(/import \{[^}]*holdsMaster[^}]*\} from '\.\/auth\.js'/);
  });

  it('VS full-access (isVsSuper) honours master, matching the DB', () => {
    // isVsSuper mirrors current_user_vs_scope(): a master holder is VS-super at
    // the DB, so the frontend control set must not be narrower.
    expect(VS).toMatch(/function isVsSuper\([\s\S]*?return !!u &&[\s\S]{0,120}holdsMaster\(u\)/);
    expect(VS).toMatch(/import \{[^}]*holdsMaster[^}]*\} from '\.\/auth\.js'/);
  });
});
