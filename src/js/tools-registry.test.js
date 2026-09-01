// ============================================================
// tools-registry.test.js — REPLACES dept-tool-mirror.test.js.
//
// That test existed because the ฝ่าย pages and the launcher were TWO
// hand-maintained copies of one tool list, and it asserted they agreed. There
// is now one registry (src/data/tools.js) that both render from, so "do the two
// copies agree" is no longer a question that can be asked — the duplication is
// gone by construction rather than by ratchet.
//
// ⚠️ THE OLD TEST'S PROPERTIES ARE NOT DROPPED, THEY MOVED. Deleting a guard
// because the code changed shape is how a repo loses the reason it was written.
// Both survive below, restated against the new shape:
//
//   "every ฝ่าย tool is findable in the launcher" → now: every registry entry
//   reaches BOTH renderers, and the launcher markup holds no hand-written card
//   that could bypass the registry (the ratchet that keeps this true).
//
//   "no launcher entry full-reloads an IN-APP route" → now: every kind:'path'
//   entry names a real PATH_ROUTES route AND renders with the in-app
//   navigation hook. Asserted on the RENDERED OUTPUT, because that is what a
//   browser acts on; asserting it on the registry would test the data and miss
//   the renderer.
//
// The subject is derived from PATH_ROUTES, never from "starts with /". The
// first version of the old guard flagged `/passport/` — a SEPARATE app at its
// own base where a full load is CORRECT — and a guard that fires on the healthy
// case is worse than no guard (`.claude/rules/mistakes.md`).
// ============================================================

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { TOOLS, toolsForDept, launcherTools, toolTarget } from '../data/tools.js';
import { DEPT_KEYS } from '../data/depts.js';
import { renderToolCard } from './tool-card.js';

const ROOT = new URL('../../', import.meta.url).pathname;
const read = (f) => readFileSync(`${ROOT}${f}`, 'utf8');

const departments = read('src/js/departments.js');
const launcherHtml = read('src/html/tab-tools.html');
const main = read('src/js/main.js');

/** The in-app routes the router actually knows. */
const spaPaths = new Set([...main.matchAll(/\{\s*path:\s*'([^']+)'/g)].map((m) => m[1]));

/** The ฝ่าย keys the detail page can render.
 *
 * ⚠️ This used to REGEX `departments.js` for `^  key: {`. When 0177 moved
 * DEPT_DEFS to its own home in src/data/depts.js — so the admin editor and the
 * grant picker could read the same list — the regex matched nothing and every
 * tool's dept read as a typo. That is the guard working, and the fix is to stop
 * parsing source for a value the module will simply export. */
const deptKeys = new Set(DEPT_KEYS);

describe('the ฝ่าย tool registry', () => {
  it('has tools, and the fixtures it is checked against are real', () => {
    // Guard the guard: every assertion below filters this list, and an empty
    // one would pass all of them over nothing.
    expect(TOOLS.length, 'no tools in the registry').toBeGreaterThan(4);
    expect(spaPaths.size, 'no PATH_ROUTES found — did the router shape change?')
      .toBeGreaterThan(5);
    expect(deptKeys.size, 'no DEPT_DEFS keys found — did departments.js change shape?')
      .toBeGreaterThan(4);
  });

  it('every slug is unique', () => {
    // A slug is the id an editor/table would store (docs/DEPT-TOOLS.md §2), so
    // a duplicate silently makes one of them unaddressable later.
    const seen = new Map();
    const dupes = [];
    for (const t of TOOLS) {
      if (seen.has(t.slug)) dupes.push(t.slug);
      seen.set(t.slug, true);
    }
    expect(dupes).toEqual([]);
  });

  it('every entry carries what its kind needs', () => {
    const bad = [];
    for (const t of TOOLS) {
      if (!t.name || !t.desc || !t.icon) bad.push(`${t.slug}: missing name/desc/icon`);
      if (!['tab', 'path', 'external', 'embed'].includes(t.kind)) bad.push(`${t.slug}: kind=${t.kind}`);
      if (t.kind === 'tab' && !t.tabId) bad.push(`${t.slug}: kind:'tab' with no tabId`);
      if (t.kind === 'path' && !t.path) bad.push(`${t.slug}: kind:'path' with no path`);
      if (t.kind === 'external' && !t.href) bad.push(`${t.slug}: kind:'external' with no href`);
      // An embed stores no path — it must not, or the folder and the route can
      // disagree. Its slug is the route, so the slug has to be URL-shaped.
      if (t.kind === 'embed' && t.path) bad.push(`${t.slug}: kind:'embed' must not carry a path — the slug IS the route`);
      if (t.kind === 'embed' && !/^[a-z0-9][a-z0-9-]*$/.test(t.slug)) bad.push(`${t.slug}: an embed slug must be lowercase url-safe`);
      if (!toolTarget(t)) bad.push(`${t.slug}: no target at all`);
    }
    expect(bad).toEqual([]);
  });

  it('every dept names a real ฝ่าย page', () => {
    // A typo here is invisible: toolsForDept() simply returns nothing and the
    // tool quietly never appears on the page it was written for.
    const bad = TOOLS.filter((t) => t.dept !== null && !deptKeys.has(t.dept))
      .map((t) => `${t.slug} → dept:'${t.dept}'`);
    expect(bad, [
      'A tool names a ฝ่าย that DEPT_DEFS does not define, so it renders nowhere',
      'on the ฝ่าย pages and nothing reports it. Known keys:',
      [...deptKeys].join(', '),
    ].join('\n')).toEqual([]);
  });

  it('every ฝ่าย with tools can actually render them', () => {
    // The mirror direction: a dept key that exists but whose page shows nothing
    // would be a registry that silently lost a page.
    const withTools = [...new Set(TOOLS.filter((t) => t.dept).map((t) => t.dept))];
    expect(withTools.length).toBeGreaterThan(3);
    for (const d of withTools) expect(toolsForDept(d).length, `${d} renders no tools`).toBeGreaterThan(0);
  });

  it('every in-app route exists in PATH_ROUTES', () => {
    // Embeds are excluded ON PURPOSE and covered by tool-frame.test.js instead:
    // they are matched by a PATTERN in pathToTab, not listed in PATH_ROUTES, so
    // asserting them here would demand a second home for the same fact.
    const bad = TOOLS.filter((t) => t.kind === 'path' && !spaPaths.has(t.path))
      .map((t) => `${t.slug} → ${t.path}`);
    expect(bad, [
      "A kind:'path' tool points at a route the router does not know, so clicking",
      'it lands on a page that never activates a tab. Add it to PATH_ROUTES in',
      'src/js/main.js, or make the tool kind:\'external\'.',
    ].join('\n')).toEqual([]);
  });
});

describe('what the registry renders', () => {
  it('an in-app route renders with in-app navigation AND keeps its href', () => {
    // The old bug, restated: a bare <a href="/spa-route"> throws away the SPA
    // and reloads the whole bundle. Shipped exactly that on 2026-08-27.
    // The href must SURVIVE — the delegated handler calls preventDefault, so
    // the href is what makes middle-click and "copy link" work.
    const bad = [];
    for (const t of TOOLS.filter((x) => x.kind === 'path')) {
      const html = renderToolCard(t);
      if (!html.includes(`data-dept-tool-path="${t.path}"`)) bad.push(`${t.slug}: no in-app hook`);
      if (!html.includes(`href="${t.path}"`)) bad.push(`${t.slug}: lost its href`);
    }
    expect(bad).toEqual([]);
  });

  it('a tab tool renders the delegated hook, not an inline onclick', () => {
    const bad = [];
    for (const t of TOOLS.filter((x) => x.kind === 'tab')) {
      const html = renderToolCard(t);
      if (!html.includes(`data-dept-tool-tab="${t.tabId}"`)) bad.push(`${t.slug}: no tab hook`);
    }
    expect(bad).toEqual([]);
  });

  it('an external tool opens in a new tab, safely', () => {
    const bad = [];
    for (const t of TOOLS.filter((x) => x.kind === 'external')) {
      const html = renderToolCard(t);
      if (!html.includes('target="_blank"') || !html.includes('rel="noopener"')) bad.push(t.slug);
    }
    expect(bad).toEqual([]);
  });

  it('every card is searchable by its own name', () => {
    // applyLauncherFilters matches data-name; a card whose own name is not in
    // its haystack is findable only by luck.
    const bad = launcherTools().filter((t) => {
      const m = /data-name="([^"]*)"/.exec(renderToolCard(t));
      return !m || !m[1].includes(t.name.toLowerCase());
    }).map((t) => t.slug);
    expect(bad).toEqual([]);
  });
});

describe('the second copy cannot come back', () => {
  it('tab-tools.html hand-writes no tool card', () => {
    // THE RATCHET. The registry only stays the single home while nothing is
    // added beside it. A hand-written card here would render fine, look
    // correct, and be invisible to every assertion above — which is exactly how
    // the duplication started the first time.
    const handWritten = [...launcherHtml.matchAll(/class="launcher-tool"/g)].length;
    expect(handWritten, [
      'A tool card is hand-written in src/html/tab-tools.html.',
      'That file ships an EMPTY grid (#launcherGridPublic); the cards are',
      'generated from src/data/tools.js by src/js/launcher.js.',
      'Add an entry to the registry instead — it appears in the launcher AND on',
      'the ฝ่าย page, which a hand-written card does not.',
    ].join('\n')).toBe(0);
  });

  it('the launcher grid the renderer targets still exists', () => {
    // Control for the assertion above: with the mount point renamed, zero
    // hand-written cards would also mean zero cards, and the test would pass
    // over a launcher that renders nothing at all.
    expect(launcherHtml).toContain('id="launcherGridPublic"');
    expect(read('src/js/launcher.js')).toContain("getElementById('launcherGridPublic')");
  });

  it('departments.js no longer carries a tool list', () => {
    expect(/^\s*tools: \[/m.test(departments), [
      'departments.js has a `tools:` array again. That is the copy the registry',
      'removed — DEPT_DEFS now holds only page chrome and the resource cards.',
    ].join('\n')).toBe(false);
  });
});
