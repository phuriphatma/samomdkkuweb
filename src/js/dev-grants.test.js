// dev-grants.test.js — the guest-access file must never reach production.
//
// WHY. `tools/dev-grants.json` gives a guest reviewer one permission on
// samo-dev for a week (TEAM-WORKFLOW §3), so that seeing a feature does not
// require making somebody an administrator of the live system. The whole value
// of that depends on one property: it CANNOT touch production.
//
// The tool disables `users_self_update_guard` to do its work — deliberately,
// documented, and only defensible because the refusal above it is by project
// REF and comes first. If that refusal ever weakens, the tool becomes a way to
// grant arbitrary permissions on the live database from a JSON file.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('../../', import.meta.url).pathname;
const SRC = readFileSync(join(ROOT, 'tools/dev-grants.mjs'), 'utf8');
const CFG = JSON.parse(readFileSync(join(ROOT, 'tools/dev-grants.json'), 'utf8'));

describe('dev-grants cannot reach production', () => {
  it('refuses the production ref, and refuses an unknown project too', () => {
    // Both branches matter. Refusing only production would happily write to
    // any other project someone pointed it at.
    expect(SRC).toMatch(/TARGET === PROD_REF/);
    expect(SRC, 'an unknown project is not refused — it must not assume "not production" means disposable')
      .toMatch(/TARGET !== DEV_REF/);
    // The refusals must EXIT, not warn.
    const exits = SRC.match(/process\.exit\(2\)/g) || [];
    expect(exits.length, 'a refusal that does not exit is a warning').toBeGreaterThanOrEqual(3);
  });

  it('the refusal comes BEFORE anything that writes', () => {
    const refusal = SRC.indexOf('is the PRODUCTION project');
    const write = SRC.indexOf('update public.users');
    expect(refusal).toBeGreaterThan(-1);
    expect(write).toBeGreaterThan(-1);
    expect(refusal, 'the production check runs after a write path — order is the guard')
      .toBeLessThan(write);
  });

  it('says out loud that it disables the guard, and why that is acceptable', () => {
    // An undocumented trigger bypass in a permissions tool is how a shortcut
    // becomes a hole nobody remembers taking.
    expect(SRC).toContain("session_replication_role");
    expect(SRC, 'the trigger bypass is not explained next to the code that does it')
      .toMatch(/users_self_update_guard/);
  });

  it('writes `permissions`, never a managed_* column', () => {
    // managed_* is rewritten from the team registry on every login, so a grant
    // written there vanishes silently the next time the person signs in.
    expect(SRC).toMatch(/set permissions =/);
    expect(SRC, 'writing a managed_* column produces a grant that disappears at next login')
      .not.toMatch(/set\s+managed_\w+\s*=/);
  });
});

describe('every dev grant expires', () => {
  it('the shipped file is empty, or every entry has a date and a reason', () => {
    // An empty list is the correct steady state; the file exists so that a
    // grant is a reviewable change rather than a click nobody undoes.
    for (const g of CFG.grants || []) {
      expect(g.email, 'a grant with no email').toBeTruthy();
      expect(g.until, `${g.email}: no expiry — this list rots by design`)
        .toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(g.why, `${g.email}: no reason recorded`).toBeTruthy();
    }
  });

  it('the tool skips an expired entry rather than applying it', () => {
    expect(SRC).toMatch(/g\.until < today/);
    expect(SRC, 'an entry with no valid until must be skipped, not defaulted')
      .toMatch(/Every grant must expire/);
  });

  it('reports what it could NOT do, not only what it did', () => {
    // A typo'd address grants nothing and looks exactly like success.
    expect(SRC).toMatch(/unmatched/);
    expect(SRC).toMatch(/NO SUCH ACCOUNT/);
  });

  it('is wired into the rebuild, or a refresh would silently drop every grant', () => {
    const refresh = readFileSync(join(ROOT, 'tools/dev-refresh.mjs'), 'utf8');
    expect(refresh, 'dev:refresh does not re-apply dev-grants — a rebuild would wipe them')
      .toContain('dev-grants.mjs');
    expect(refresh, 'dev:refresh does not repoint email away from real staff')
      .toContain('uni_staff_email');
  });
});
