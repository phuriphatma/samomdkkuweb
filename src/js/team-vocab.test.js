// The ทีม SAMO grant vocabulary — and specifically the view/edit split (0110).
//
// These are contracts with the database: PERM_CATALOG keys are matched by
// `current_user_has_permission('…')` inside RLS, so a typo here is a silently
// dead grant, not a crash.
import { describe, it, expect } from 'vitest';
import {
  PERM_CATALOG, PERM_LABEL, ADMIN_FEATURES, TEAM_VIEW, TEAM_EDIT, MASTER, canEditTeam,
  IMPLICIT_PERMS,
} from './team-vocab.js';
import { permTicked } from './team/index.js';
import { readFileSync } from 'node:fs';

const keys = PERM_CATALOG.map((p) => p.key);

describe('permission catalogue', () => {
  it('carries both ทีม SAMO rungs, and the keys the RLS policies name', () => {
    // Named literally: migration 0110's policies test for exactly these two
    // strings. Renaming a key is a migration, not a refactor.
    expect(TEAM_VIEW).toBe('team');
    expect(TEAM_EDIT).toBe('team_edit');
    expect(keys).toContain('team');
    expect(keys).toContain('team_edit');
  });

  it('has no duplicate keys and labels every one of them', () => {
    expect(new Set(keys).size).toBe(keys.length);
    for (const k of keys) expect(PERM_LABEL[k]).toBeTruthy();
  });

  it('distinguishes the two rungs in the label, so a grid of checkboxes is readable', () => {
    expect(PERM_LABEL.team).not.toBe(PERM_LABEL.team_edit);
    expect(PERM_LABEL.team).toContain('ดู');
    expect(PERM_LABEL.team_edit).toContain('แก้ไข');
  });

  it('lets either rung open /admin/ — viewing is the whole point of the view rung', () => {
    expect(ADMIN_FEATURES).toContain('team');
    expect(ADMIN_FEATURES).toContain('team_edit');
    // passport is deliberately NOT here: it opens /passport/, and listing it
    // would send a passport-only grantee to a door that bounces them.
    expect(ADMIN_FEATURES).not.toContain('passport');
  });
});

describe('canEditTeam', () => {
  it('is true for the edit permission', () => {
    expect(canEditTeam(['team_edit'])).toBe(true);
  });

  it('is FALSE for the view permission — that is the entire split', () => {
    expect(canEditTeam(['team'])).toBe(false);
  });

  it('is true for the roles whose RLS branch grants write by role', () => {
    // team_nodes_write admits vp_admin and dev by role, with no permission at
    // all. A UI that asked only about permissions would render the tree
    // read-only for someone the database lets write.
    expect(canEditTeam([], 'vp_admin')).toBe(true);
    expect(canEditTeam([], 'dev')).toBe(true);
  });

  it('is false for everyone else, including other staff roles', () => {
    expect(canEditTeam([])).toBe(false);
    expect(canEditTeam(['pr', 'creator', 'samoshop'], 'pr_staff')).toBe(false);
    expect(canEditTeam(undefined, undefined)).toBe(false);
  });
});

describe('master (migration 0111)', () => {
  it('is in the catalogue, flagged as the dangerous one', () => {
    expect(MASTER).toBe('master');
    const m = PERM_CATALOG.find((p) => p.key === 'master');
    expect(m).toBeTruthy();
    expect(m.danger).toBe(true);   // drives the confirm + the styling
    expect(PERM_LABEL.master).toBeTruthy();
  });

  it('grants ทีม SAMO write without needing team_edit spelled out', () => {
    expect(canEditTeam(['master'])).toBe(true);
  });

  it('is the LAST entry, so the grid never leads with the strongest grant', () => {
    // Same principle as the VS scope picker, where "ทุกแผนก" at index 0 meant
    // "the admin did not touch this control" and "maximum privilege" were the
    // same input. Here the risk is only visual, but the ordering is deliberate.
    expect(PERM_CATALOG[PERM_CATALOG.length - 1].key).toBe('master');
  });

  it('mirrors the SQL: userCanAccess() checks BOTH permission channels', () => {
    // current_user_has_permission() tests `permissions` OR `managed_permissions`
    // for 'master'. A JS mirror that read only one of them would let a
    // tree-granted master be bounced by the UI while RLS let them write — the
    // exact UI/DB mismatch that made the `team` permission look broken in 0089.
    const src = readFileSync(new URL('./auth.js', import.meta.url), 'utf8');
    const block = src.slice(src.indexOf('export function userCanAccess'),
      src.indexOf('export function userCanAccess') + 1200);
    expect(block).toContain("permissions.includes('master')");
    expect(block).toContain("managedPermissions.includes('master')");
  });

  it('does NOT appear in ADMIN_FEATURES — it is a grant, not a feature tab', () => {
    expect(ADMIN_FEATURES).not.toContain('master');
  });
});

describe('the "ไปยัง Admin Dashboard" link is gated by ADMIN_FEATURES', () => {
  // REPORTED: "when i got permission ทีม SAMO (ดู), it should show admin
  // dashboard drop down from the topright of my account".
  //
  // main.js had its own hand-written list of five permission keys, written before
  // ทีม SAMO had rungs. So a member whose only grant was `team` — which, since
  // 0110, is EVERY person with a posting in the tree — could reach /admin/ by
  // typing the URL but was never shown the link. The fix is not "add two more
  // keys to that list", it is to stop having a second list: the door and the
  // doorman (admin-main.js canUseAdmin) now read the same array.
  const main = readFileSync(new URL('./main.js', import.meta.url), 'utf8');

  it('main.js derives it from ADMIN_FEATURES rather than naming keys', () => {
    const block = main.slice(main.indexOf('const canAccessAdmin'),
      main.indexOf('const canAccessAdmin') + 300);
    expect(block).toContain('ADMIN_FEATURES.some');
  });

  it('and therefore covers the ทีม SAMO rungs', () => {
    expect(ADMIN_FEATURES).toContain('team');
    expect(ADMIN_FEATURES).toContain('team_edit');
  });

  it('admin-main.js still gates the door on the SAME array', () => {
    const admin = readFileSync(new URL('./admin-main.js', import.meta.url), 'utf8');
    expect(admin).toContain('ADMIN_FEATURES.some');
  });
});

describe('IMPLICIT_PERMS — grants the server hands out, which no form may claim', () => {
  it('is exactly ทีม SAMO (ดู)', () => {
    // 0110 appends `team` in effective_team_permissions_for_email() for anyone
    // with a posting. Anything else added here must have the same property, or
    // the grid will show a locked tick for a permission nobody actually holds.
    expect(IMPLICIT_PERMS).toEqual([TEAM_VIEW]);
  });

  it('team_edit is NOT implicit — it is the write rung and must be granted', () => {
    expect(IMPLICIT_PERMS).not.toContain(TEAM_EDIT);
    expect(IMPLICIT_PERMS).not.toContain(MASTER);
  });

  it('permTicked reports an implicit key as ON even though no row stores it', () => {
    // The row correctly does not store `team`; the box is still ticked, because
    // the person does hold it. Miss this and the pane says a member cannot view
    // ทีม SAMO while they are looking at ทีม SAMO.
    expect(permTicked(TEAM_VIEW, new Set(), { permissions: [] })).toBe(true);
  });

  it('readPermInputs filters implicit keys out of what gets SAVED', () => {
    // `input:checked` matches a DISABLED checkbox too, so the locked tick would
    // otherwise be written onto every row the modal saves — turning an implicit
    // grant into an explicit one that someone can later untick.
    const src = readFileSync(new URL('./team/index.js', import.meta.url), 'utf8');
    const block = src.slice(src.indexOf('function readPermInputs('),
      src.indexOf('function readPermInputs(') + 900);
    expect(block).toContain('IMPLICIT_PERMS.includes');
  });
});
