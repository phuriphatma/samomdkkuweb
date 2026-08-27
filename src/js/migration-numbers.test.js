// ============================================================
// migration-numbers.test.js — two people cannot silently take one number.
//
// WHY THIS IS A TEST AND NOT A NOTE IN CONTRIBUTING.md
// `npm run migrate:new` takes the next number from the HIGHER of the working
// tree and origin/main, which prevents the common collision. It cannot prevent
// the uncommon one: two branches opened before either was pushed, or someone
// creating the file by hand. This is the ratchet that catches those, and it
// runs in CI on every pull request — which, since 2026-08-27, BLOCKS the merge.
//
// It asserts the PROPERTY (every version appears once, every filename is
// well-formed), never a list of the migrations that exist — a guard written
// from the same list as the code passes a wrong list.
// ============================================================

import { describe, it, expect } from 'vitest';
import { readdirSync } from 'node:fs';

const DIR = 'supabase/migrations';
const files = readdirSync(DIR).filter((f) => f.endsWith('.sql'));

describe('migration numbering', () => {
  it('reads the directory at all (a sweep that finds nothing must prove it looked)', () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it('every migration filename is NNNN_slug.sql', () => {
    const malformed = files.filter((f) => !/^\d{4}_[a-z0-9_]+\.sql$/.test(f));
    expect(malformed, [
      'A migration filename must be NNNN_lower_snake_slug.sql.',
      'The number is how every tool and every human orders them; the slug is what',
      'the next reader greps for.',
    ].join('\n')).toEqual([]);
  });

  it('no two migrations share a number', () => {
    const seen = new Map();
    const dupes = [];
    for (const f of files.sort()) {
      const v = f.slice(0, 4);
      if (seen.has(v)) dupes.push(`${v}: ${seen.get(v)} and ${f}`);
      else seen.set(v, f);
    }
    expect(dupes, [
      'Two migrations claim the same number.',
      'Whoever opened their branch second renames theirs — renaming an UNAPPLIED',
      'migration is free. If it is already applied somewhere, do not rename it:',
      'write a new one and say so in its header.',
      'Take numbers with `npm run migrate:new "<slug>"`, which reads origin/main.',
    ].join('\n')).toEqual([]);
  });
});
