// ==============================================
// THE LIST OF REQUIRED ENV NAMES HAS ONE HOME, AND IT IS CHECKED IN.
//
// Before this, `docs/start/install.md` retyped the four SUPABASE_DEV_* names in
// a code block, and the guide hedged — "cp .env.local.example .env.local # if
// that example file exists" — because the file did not exist. A setup guide
// that is unsure whether its own first command works is a guide nobody has run.
//
// The names now live in `.env.local.example`, which git tracks. This asserts the
// two agree, in the direction that matters: a name the DOCS tell someone to set
// must exist in the example they were told to copy. The reverse is allowed —
// the example carries commented-out optional blocks the getting-started page
// deliberately does not mention.
//
// Class 6: two implementations of one rule drift, and a doc has no compiler.
// ==============================================
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..', '..');
const EXAMPLE = readFileSync(join(ROOT, '.env.local.example'), 'utf8');
const INSTALL = readFileSync(join(ROOT, 'docs', 'start', 'install.md'), 'utf8');
const PREREQ = readFileSync(join(ROOT, 'docs', 'start', 'prerequisites.md'), 'utf8');
const GITIGNORE = readFileSync(join(ROOT, '.gitignore'), 'utf8');

/** Every `NAME=` the example actually sets, ignoring commented-out lines. */
const declared = new Set(
  [...EXAMPLE.matchAll(/^([A-Z][A-Z0-9_]*)=/gm)].map((m) => m[1]),
);

describe('.env.local.example', () => {
  it('declares the four development-database names (control)', () => {
    // If this list is ever narrowed, the sweep below stops proving anything.
    expect([...declared].sort()).toEqual([
      'SUPABASE_DEV_ACCESS_TOKEN',
      'SUPABASE_DEV_ANON_KEY',
      'SUPABASE_DEV_DB_URL',
      'SUPABASE_DEV_URL',
    ]);
  });

  it('carries no real value — it is checked in, and .env.local is not', () => {
    // A key committed once is in the history for ever, and this repo is public.
    expect(EXAMPLE, 'a Supabase management token (sbp_) with a real body')
      .not.toMatch(/sbp_[A-Za-z0-9]{20,}/);
    expect(EXAMPLE, 'a JWT — anon keys start eyJ and are long')
      .not.toMatch(/eyJ[A-Za-z0-9_-]{30,}/);
    expect(EXAMPLE, 'a real postgres password')
      .not.toMatch(/postgresql:\/\/[^\s:]+:(?!password@)[^\s@]{8,}@/);
    // The project ref is 20 lowercase letters. The placeholder must not be one.
    expect(EXAMPLE).not.toMatch(/https:\/\/[a-z]{20}\.supabase\.co/);
  });

  it('is TRACKED while .env.local is ignored — the whole point of the pair', () => {
    expect(GITIGNORE).toMatch(/^\.env\.local$/m);
    expect(GITIGNORE, '.env.local.example must not be swept up by a wildcard')
      .not.toMatch(/^\.env\.local\.\*$/m);
    expect(GITIGNORE).not.toMatch(/^\.env\.local\.example$/m);
  });

  it('names no production credential as something to SET', () => {
    // These reach the live database and the live VM. They are mentioned in a
    // trailing comment so a file holding them is recognisable — never as a
    // `NAME=` a contributor would fill in.
    for (const secret of ['SUPABASE_ACCESS_TOKEN', 'SUPABASE_DB_URL', 'SAMO_VM_SUDO_PASSWORD']) {
      expect(declared, `${secret} is presented as a value to fill in`).not.toContain(secret);
    }
  });
});

describe('the getting-started pages and the example agree', () => {
  it('every env name the pages name is one the example declares', () => {
    const named = new Set(
      [...`${INSTALL}\n${PREREQ}`.matchAll(/\bSUPABASE_DEV_[A-Z_]+/g)].map((m) => m[0]),
    );
    expect(named.size, 'the pages stopped naming any variable at all').toBeGreaterThan(0);
    for (const n of named) {
      expect(declared, `install.md/prerequisites.md tell a contributor to set ${n}, `
        + 'which is not in .env.local.example — one of the two is stale').toContain(n);
    }
  });

  it('install.md points at the example instead of hedging about it', () => {
    expect(INSTALL).toContain('cp .env.local.example .env.local');
    expect(INSTALL, 'the guide still hedges about whether its own file exists')
      .not.toMatch(/if that example file exists/);
  });
});
