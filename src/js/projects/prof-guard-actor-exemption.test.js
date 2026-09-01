import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';

// ============================================================
// A column guard keyed on an IDENTITY must ask whether that identity is the
// only reason the caller got in.
//
// REPORTED (2026-09-01): "my friend has permission master with ผู้ส่งคณะ but
// can't ซ่อนจากเว็บ on each หนังสือ", with
//   P0001 project_documents_prof_guard: professor may only add comments
//
// 0111 §2 folds `master` into current_user_project_seats() as
// {vpa,staff,prof} so a master can work any of the three desks. Every OTHER
// reader of current_user_is_prof() is an OR branch in a policy, where an
// extra `true` only widens. These two BEFORE UPDATE guards are the
// exceptions — they RESTRICT — so the third desk read as a disqualification
// and all 41 master holders could change nothing on a หนังสือ but a comment.
//
// WHY THIS TEST AND NOT ONLY THE LIVE PROOF. The live proof
// (tools/proj0176-master-desk.sql) is the authority on what the DATABASE
// does; it needs a PAT and the VPN and does not run in `npm test`. This
// pins the migration CORPUS instead, against one specific way the fix dies:
// a future migration doing `create or replace` from 0051's or 0114's body —
// which 0114's own header warns about, having nearly done it. Whichever
// migration defines these functions LAST is what production runs.
//
// It asserts the PROPERTY (the guard exempts an actor), not the line the fix
// happened to be written on — a test built from the same list as the code
// passes any wrong list (skills/write-a-guard.md).
// ============================================================
const DIR = new URL('../../../supabase/migrations/', import.meta.url);
const FILES = readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort();

/** The body of the LAST `create or replace function public.<name>` in the
 *  whole corpus — i.e. what production actually runs after every migration
 *  has been applied in order. */
function latestBodyOf(fnName) {
  const re = new RegExp(
    `create or replace function public\\.${fnName}\\(\\)[\\s\\S]*?\\$\\$;`, 'g');
  let latest = null;
  let latestFile = null;
  for (const f of FILES) {
    const sql = readFileSync(new URL(f, DIR), 'utf8');
    const hits = sql.match(re);
    if (hits && hits.length) { latest = hits[hits.length - 1]; latestFile = f; }
  }
  return { body: latest, file: latestFile };
}

const GUARDS = ['project_documents_prof_guard', 'sign_requests_prof_guard'];

describe('the professor column guards exempt a project actor (0176)', () => {
  for (const fn of GUARDS) {
    it(`${fn} is defined somewhere — the scan is not vacuous`, () => {
      // The control. Without it, a renamed function makes every assertion
      // below pass over `null` and this file becomes decoration.
      const { body, file } = latestBodyOf(fn);
      expect(file, `no migration defines ${fn}`).toBeTruthy();
      expect(body).toContain('raise exception');
    });

    it(`${fn} restricts a professor only when they are NOT an actor`, () => {
      const { body, file } = latestBodyOf(fn);
      expect(
        /current_user_is_prof\(\)\s+and\s+not\s+public\.current_user_is_project_actor\(\)/.test(body),
        `${file} republishes ${fn} without the actor exemption — a master `
        + 'holds the prof seat (0111) and would be locked out of their own desk again',
      ).toBe(true);
    });

    it(`${fn} still raises — the exemption widened the guard, it did not delete it`, () => {
      const { body } = latestBodyOf(fn);
      expect(body).toMatch(/is distinct from old\./);
      expect(body).toMatch(/raise exception '.*prof_guard/);
    });
  }

  it('is_public is still one of the columns the doc guard names', () => {
    // 0114 added it. The 0176 rewrite retyped the column list, and a retyped
    // list is exactly where a column quietly goes missing — at which point a
    // professor could publish a หนังสือ to the public site.
    const { body } = latestBodyOf('project_documents_prof_guard');
    expect(body).toMatch(/new\.is_public\s+is distinct from old\.is_public/);
  });

  it('the doc guard still names every column 0114 listed, none dropped', () => {
    const { body } = latestBodyOf('project_documents_prof_guard');
    for (const col of ['id', 'project_id', 'type_id', 'title', 'note', 'sequence_no',
      'status', 'return_reason', 'sent_at', 'received_at', 'completed_at',
      'drive_folder', 'is_public', 'created_by', 'created_at']) {
      expect(body, `column ${col} dropped from the guard`)
        .toMatch(new RegExp(`new\\.${col}\\s+is distinct from old\\.${col}`));
    }
    // timeline is the one column that must NOT be listed — the professor's
    // comments are the whole reason 0051 widened the policy.
    expect(body).not.toMatch(/new\.timeline\s+is distinct from old\.timeline/);
  });

  it('master still holds all three project seats — the fix does not undo 0111 §2', () => {
    // If a later session "fixes" this by narrowing the seats instead, every
    // GRANT that reads current_user_is_prof() (project_settings read,
    // doc_types read, sign-request read/insert, signed-file insert) closes
    // for a master. The guards are the right place; this pins that.
    const sql = readFileSync(new URL('0111_master_grant.sql', DIR), 'utf8');
    expect(sql).toMatch(/current_user_has_permission\('master'\) then array\['vpa', 'staff', 'prof'\]/);
  });
});
