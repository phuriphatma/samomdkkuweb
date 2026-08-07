// delete-guard.test.js — every DELETE must be able to tell "blocked" from "done".
//
// WHY THIS IS A TEST AND NOT A NOTE IN mistakes.md.
// PostgREST answers an RLS-blocked DELETE with `204 No Content` and zero rows —
// NOT an error. So `const { error } = await dbRest(url, { method: 'DELETE' });
// if (error) throw` scores "you have no permission to delete this" as a success:
// the caller optimistically drops the row from its local model, re-renders, and
// the row is back on the next reload with nothing having been reported.
//
// The repo already knew this — it is written up in docs/mistakes/supabase-client.md
// ("silent-success on RLS-blocked updates / deletes"), vs-staff.js cites it by
// name in a comment, and projects/api.js + announcements.js both guard correctly.
// It was still missing from all five deletes in team/api.js and three in
// shop/api.js, because a written-down hazard does not make anyone check the next
// delete they write. This test does.
//
// THE RULE: a `method: 'DELETE'` through dbRest must ask for the deleted rows
// back (`prefer: 'return=representation'`) and must refuse to report success on
// an empty array.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SRC = new URL('.', import.meta.url).pathname;

function jsFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...jsFiles(p));
    else if (entry.endsWith('.js') && !entry.endsWith('.test.js')) out.push(p);
  }
  return out;
}

/**
 * Every `method: 'DELETE'` site, with the ~14 lines that follow it — enough to
 * cover the `prefer` line and the result check that should come after.
 */
function deleteSites() {
  const sites = [];
  for (const file of jsFiles(SRC)) {
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (!line.includes("method: 'DELETE'")) return;
      // Forward to the end of THIS function, never into the next one: a
      // fixed-size window either misses a check sitting below a long comment
      // (deleteProduct's FK note is 15 lines) or, if simply widened, lets the
      // NEXT function's check satisfy this one — a sweep that passes for the
      // wrong reason. Truncate at the following top-level `export`.
      const after = [];
      for (let j = i + 1; j < Math.min(lines.length, i + 45); j += 1) {
        if (/^export\s/.test(lines[j])) break;
        after.push(lines[j]);
      }
      // Look BACK to the top of the enclosing function, for the same reason:
      // `prefer` sometimes precedes `method`, and an exemption marker is written
      // as a comment above the call. Bounded by the preceding top-level `export`
      // so the PREVIOUS function's guard can never satisfy this one.
      const before = [];
      for (let j = i; j >= 0 && i - j < 20; j -= 1) {
        before.unshift(lines[j]);
        if (/^export\s/.test(lines[j])) break;
      }
      sites.push({
        file: file.slice(SRC.length),
        line: i + 1,
        window: [...before, ...after].join('\n'),
      });
    });
  }
  return sites;
}

/**
 * The only two ways a DELETE may skip the guard, both requiring a written reason
 * at the call site:
 *   • `.catch(() => {})` — a best-effort rollback (shop_orders api.js:448/452),
 *     deliberately fire-and-forget so a failed rollback cannot mask the real
 *     error being thrown.
 *   • an explicit `delete-guard:allow-empty` marker — a delete for which zero
 *     rows is a legitimate outcome (clearing links that may not exist yet).
 * Anything else must guard.
 */
function exempt(site) {
  return /\.catch\(\(\) => \{\}\)/.test(site.window)
    || /delete-guard:allow-empty/.test(site.window);
}

describe('every DELETE can distinguish an RLS block from a real delete', () => {
  const sites = deleteSites();

  it('finds the DELETE call sites at all (a sweep that finds nothing proves nothing)', () => {
    // Guards the guard: if a refactor changes how deletes are spelled, this
    // test must fail loudly rather than silently pass over an empty list.
    expect(sites.length).toBeGreaterThan(15);
  });

  it.each(sites.map((s) => [`${s.file}:${s.line}`, s]))(
    '%s asks for the deleted rows back',
    (_label, site) => {
      if (exempt(site)) return;
      expect(site.window).toContain("prefer: 'return=representation'");
    },
  );

  it.each(sites.map((s) => [`${s.file}:${s.line}`, s]))(
    '%s treats zero deleted rows as a failure',
    (_label, site) => {
      if (exempt(site)) return;
      // Either shape is fine: `data.length === 0` / `!data.length`, thrown or
      // surfaced to the user. What must NOT exist is a delete that only looks
      // at `error`.
      expect(site.window).toMatch(/data\.length\s*===\s*0|!data\.length|length\s*===\s*0/);
    },
  );
});
