// ============================================================
// dept-tool-mirror.test.js — the ฝ่าย page and the launcher list one set of
// tools, and they are written down TWICE.
//
// `DEPT_DEFS` in departments.js renders the per-ฝ่าย tool cards; tab-tools.html
// hand-writes the same tools again for the searchable launcher. Two copies of
// one fact, kept in step by memory — the drift class this repo pays for most
// (`.claude/rules/mistakes.md` class 6). Adding Golden Period on 2026-08-27
// made it a THIRD home, so this ratchet went in with it.
//
// It asserts the PROPERTY — every tool a ฝ่าย page can reach is findable in the
// launcher — not a hardcoded list of tools, which would just be a fourth copy
// that passes itself.
//
// THE REAL FIX is one registry both read (docs/DEPT-TOOLS.md §2). Until that
// lands, this is what stops the two drifting silently.
// ============================================================

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const ROOT = new URL('../../', import.meta.url).pathname;
const departments = readFileSync(`${ROOT}src/js/departments.js`, 'utf8');
const launcher = readFileSync(`${ROOT}src/html/tab-tools.html`, 'utf8');

/** Every tool DEPT_DEFS can route to, as {name, target}. */
function deptTools(src) {
  const out = [];
  // one object literal per tool; the target is whichever key it carries
  for (const m of src.matchAll(/\{\s*kind:\s*'(tab|path|external)'[\s\S]*?\}/g)) {
    const block = m[0];
    const name = /name:\s*'([^']+)'/.exec(block)?.[1];
    const target = /(?:tabId|path|href):\s*'([^']+)'/.exec(block)?.[1];
    if (name && target) out.push({ name, target });
  }
  return out;
}

describe('the ฝ่าย pages and the tools launcher list the same tools', () => {
  const tools = deptTools(departments);

  it('reads DEPT_DEFS at all (a sweep that finds nothing must prove it looked)', () => {
    expect(tools.length).toBeGreaterThan(4);
  });

  it('no launcher entry full-reloads an IN-APP route', () => {
    // The ฝ่าย cards navigate through `navigateTo` (a delegated handler on
    // [data-dept-tool-path]); the launcher is separate markup with no such
    // handler, so a bare <a href="/spa-route"> there throws away the SPA and
    // reloads the whole bundle. Shipped exactly that on 2026-08-27.
    //
    // ⚠️ The subject is derived from PATH_ROUTES, not from "starts with /".
    // The first version of this guard flagged `/passport/` — a SEPARATE app at
    // its own base, where a full load is CORRECT — and a guard that fires on
    // the healthy case is worse than no guard (`.claude/rules/mistakes.md`).
    const main = readFileSync(`${ROOT}src/js/main.js`, 'utf8');
    const spaPaths = new Set(
      [...main.matchAll(/\{\s*path:\s*'([^']+)'/g)].map((m) => m[1]),
    );
    expect(spaPaths.size, 'no PATH_ROUTES found — did the shape change?')
      .toBeGreaterThan(5);

    const bad = [];
    for (const m of launcher.matchAll(/<a\s[^>]*class="launcher-tool"[^>]*>/g)) {
      const tag = m[0];
      const href = /href="([^"]+)"/.exec(tag)?.[1] ?? '';
      if (spaPaths.has(href) && !/onclick=|data-dept-tool-path=/.test(tag)) bad.push(href);
    }
    expect(bad, [
      'A launcher entry links to an IN-APP route with no in-app navigation, so',
      'clicking it reloads the entire bundle instead of switching tabs.',
      "Add onclick=\"navigateTo('<path>'); return false;\" and KEEP the href —",
      'it is what makes middle-click and copy-link work.',
    ].join('\n')).toEqual([]);
  });

  it('every ฝ่าย tool is reachable from the launcher too', () => {
    const missing = tools.filter((t) => !launcher.includes(t.target));
    expect(missing.map((t) => `${t.name} → ${t.target}`), [
      'A tool on a ฝ่าย page has no entry in the launcher (src/html/tab-tools.html).',
      'Someone searching เครื่องมือ for it will not find it.',
      '',
      'These are TWO HAND-MAINTAINED COPIES of one list. Add it to the launcher,',
      'or — better — do the registry in docs/DEPT-TOOLS.md §2 so there is one.',
    ].join('\n')).toEqual([]);
  });
});
