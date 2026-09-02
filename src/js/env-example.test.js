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

// ==============================================
// THE FIRST COMMAND A CONTRIBUTOR IS TOLD TO RUN MUST WORK FOR A CONTRIBUTOR.
//
// docs/start/install.md told a new contributor to verify their setup with
// `npm run dev:check`. That command compares samo-dev against PRODUCTION
// (tools/dev-check.mjs reads VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY), which
// a contributor does not have and must never be sent — so it would exit 1 with
// "✗ PRODUCTION: URL or anon key missing from .env.local" having proved nothing
// about the four keys they actually pasted.
//
// A verification step that fails on a CORRECT setup is worse than none: it
// blames the reader for the guide's mistake, at the exact moment they have no
// way to tell which of the two is wrong.
// ==============================================
describe('the contributor-facing setup check', () => {
  const ENVCHECK = readFileSync(join(ROOT, 'tools', 'env-check.mjs'), 'utf8');
  const DEVCHECK = readFileSync(join(ROOT, 'tools', 'dev-check.mjs'), 'utf8');
  const PKG = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));

  it('is wired up as npm run env:check', () => {
    expect(PKG.scripts['env:check']).toBe('node tools/env-check.mjs');
  });

  it('reads NO production credential — that is the whole point', () => {
    for (const name of ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY', 'SUPABASE_ACCESS_TOKEN']) {
      expect(ENVCHECK, `env-check reads ${name}, which a contributor does not have`)
        .not.toMatch(new RegExp(`env\\.${name}\\b`));
    }
  });

  it('checks every name the example declares (control: the two lists agree)', () => {
    // Written from the EXAMPLE, not from a list retyped here — a guard built
    // from the same list as the code cannot see a name missing from both.
    const checked = [...ENVCHECK.matchAll(/'(SUPABASE_DEV_[A-Z_]+)'/g)].map((m) => m[1]);
    for (const name of declared) {
      expect(checked, `env-check never looks at ${name}`).toContain(name);
    }
  });

  it('dev:check STILL requires production — do not "simplify" the two into one', () => {
    // dev:check is a parity guard and its value is that it needs both sides.
    // Teaching it to skip the production half when credentials are absent would
    // make it pass in the one case it exists to catch.
    expect(DEVCHECK).toMatch(/env\.VITE_SUPABASE_URL/);
    expect(DEVCHECK).toMatch(/env\.VITE_SUPABASE_ANON_KEY/);
  });

  it('install.md sends contributors to env:check, and warns off the other one', () => {
    expect(INSTALL).toMatch(/npm run env:check/);
    expect(INSTALL, 'install.md still tells a contributor to run dev:check as their check')
      .not.toMatch(/^```bash\nnpm run dev:check\n```/m);
    expect(INSTALL, 'the warning that dev:check is not theirs has gone')
      .toMatch(/Not `npm run dev:check`/);
  });
});
