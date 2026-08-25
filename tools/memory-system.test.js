/**
 * Invariants of the agent memory system.
 *
 * `.claude/rules/*.md` + `CLAUDE.md` are injected into EVERY agent session.
 * They grew to 251k chars (~63k tokens) once, because the bug write-ups lived
 * there. These tests are what keeps the always-loaded layer an INDEX and the
 * write-ups read-on-demand under `docs/mistakes/`.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  TOPICS, headingsOf, shorten, buildIndex, buildFullIndex,
} from './mistakes-index.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const DIR = path.join(ROOT, 'docs/mistakes');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

describe('context budget', () => {
  it('every auto-loaded file stays within its budget', () => {
    // Fails loudly rather than letting the harness truncate. The fix when this
    // breaks is to move detail into docs/, never to raise the cap.
    const run = () =>
      execFileSync('node', [path.join(ROOT, 'tools/check-context-budget.mjs')], {
        cwd: ROOT,
        encoding: 'utf8',
      });
    expect(run).not.toThrow();
  });

  it('no bug write-up has crept back into the always-loaded rules', () => {
    // A write-up is recognisable by its shape; the hot file may only hold
    // classes + the generated index.
    const hot = read('.claude/rules/mistakes.md');
    expect(hot).not.toMatch(/\*\*Symptom\*\*:/);
    expect(hot).not.toMatch(/\*\*Where\*\*:/);
  });
});

describe('mistakes index', () => {
  it('is in sync with docs/mistakes/ headings', () => {
    const { body } = buildIndex();
    expect(read('.claude/rules/mistakes.md')).toContain(body);
  });

  it('lists every topic file, and every topic file is listed', () => {
    // INDEX.md is the GENERATED full listing that sits beside the write-ups,
    // not a topic — declaring it in TOPICS would make the generator index its
    // own output.
    const onDisk = fs.readdirSync(DIR)
      .filter((f) => f.endsWith('.md') && f !== 'INDEX.md').sort();
    const declared = TOPICS.map(([f]) => f).sort();
    expect(onDisk).toEqual(declared);
  });

  it('the ALWAYS-LOADED file carries the directory, and the full list does NOT live there', () => {
    // The property that broke: the per-entry index grew with every bug fixed
    // until it was 18,533 of a 30,000-byte budget and blocked the next
    // write-up from being added at all. What is charged to every session must
    // be O(1) in the number of entries, not O(n).
    const hot = read('.claude/rules/mistakes.md');
    const full = read('docs/mistakes/INDEX.md');
    const someHeading = headingsOf(path.join(DIR, 'frontend-ui.md')).at(-1);

    expect(full).toContain(shorten(someHeading));   // it is findable…
    expect(hot).not.toContain(shorten(someHeading)); // …and not charged to every session
    // The directory line for that file IS there, with its count.
    expect(hot).toMatch(/`frontend-ui\.md` \*\(\d+\)\*/);
    expect(hot).toContain('docs/mistakes/INDEX.md');
  });

  it('the full index is in sync too', () => {
    expect(read('docs/mistakes/INDEX.md')).toBe(buildFullIndex());
  });

  it('has no duplicate entry across the nine files', () => {
    // 117 entries is past the point where a human remembers whether a symptom
    // is already written up; a duplicate would split the next reader's search.
    const seen = new Map();
    for (const [file] of TOPICS) {
      for (const h of headingsOf(path.join(DIR, file))) {
        expect(seen.has(h), `duplicate entry "${h}" in ${file} and ${seen.get(h)}`).toBe(false);
        seen.set(h, file);
      }
    }
    expect(seen.size).toBeGreaterThan(100);
  });

  it('every entry ends up with a non-empty, scannable index line', () => {
    for (const [file] of TOPICS) {
      for (const h of headingsOf(path.join(DIR, file))) {
        const line = shorten(h);
        expect(line.length, `empty index line for "${h}"`).toBeGreaterThan(10);
        expect(line.length, `index line too long for "${h}"`).toBeLessThanOrEqual(120);
        // A line that opens mid-sentence is unusable in an index.
        expect(line.startsWith('…'), `index line starts with an ellipsis: "${line}"`).toBe(false);
      }
    }
  });
});

describe('shorten()', () => {
  it('keeps a heading that already fits', () => {
    expect(shorten('Postgres has no `create or replace policy`')).toBe(
      'Postgres has no `create or replace policy`',
    );
  });

  it('drops the elaboration after the em dash when the claim carries the symptom', () => {
    const long =
      'A per-recipient SELECT RLS policy is DEAD when a `using(true)` public-read policy already exists on the same table' +
      ' — because permissive policies are OR-ed together by Postgres and the broad one always wins';
    expect(shorten(long)).toBe(
      'A per-recipient SELECT RLS policy is DEAD when a `using(true)` public-read policy already exists on the same table',
    );
  });

  it('truncates with an ellipsis when even the claim is too long', () => {
    const s = shorten('x'.repeat(200));
    expect(s).toHaveLength(120);
    expect(s.endsWith('…')).toBe(true);
  });

  it('keeps the whole heading when the claim alone would be too terse', () => {
    expect(shorten('It broke — because the flag defaulted the wrong way')).toBe(
      'It broke — because the flag defaulted the wrong way',
    );
  });
});
