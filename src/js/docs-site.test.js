// ============================================================
// docs-site.test.js — every doc is reachable from the docs site's sidebar.
//
// The site (docs/.vitepress/config.mjs) generates its sidebar from the
// filesystem, so a new file under docs/mistakes/, docs/state/ or the archive
// appears on its own. The TOP-LEVEL docs are the exception: they are grouped by
// hand, because a flat alphabetical list of every reference page is exactly the
// experience that drove non-technical readers off GitHub.
//
// A hand-maintained list beside the thing it describes is this repo's most
// repeated bug (.claude/rules/mistakes.md class 6 — main.js's admin links vs
// ADMIN_FEATURES, 0113). So the list gets a differential test: add a doc and
// forget to classify it, and this goes red naming the file. It cannot silently
// vanish from the sidebar, which is the failure that would otherwise never be
// noticed — nobody misses a page they do not know exists.
// ============================================================
import { describe, it, expect } from 'vitest';
import { collect, buildSidebar, TOP_GROUPS } from '../../docs/.vitepress/config.mjs';

const sidebar = buildSidebar();
const files = collect();
const links = new Set(sidebar.flatMap((g) => g.items.map((i) => i.link)));

describe('the docs site reaches every document', () => {
  it('finds the docs at all (control)', () => {
    // A generator that found nothing would satisfy every "no missing page"
    // assertion below by vacuum.
    expect(files.length).toBeGreaterThan(50);
    expect(links.size).toBeGreaterThan(50);
  });

  it('every markdown file appears in the sidebar exactly once', () => {
    const expected = files
      .filter((f) => f !== 'index.md')
      .map((f) => '/' + f.replace(/\.md$/, '').split(/[\\/]/).join('/'));
    const missing = expected.filter((l) => !links.has(l));
    expect(missing, `these docs exist but no sidebar entry points at them:\n${missing.join('\n')}`).toEqual([]);

    const all = sidebar.flatMap((g) => g.items.map((i) => i.link));
    const dupes = all.filter((l, i) => all.indexOf(l) !== i);
    expect(dupes, `listed in two groups: ${dupes.join(', ')}`).toEqual([]);
  });

  it('every top-level doc has been put in a group deliberately', () => {
    // The "Unsorted" group only exists so a new file is never LOST. Its
    // presence is the failure, not the remedy.
    const unsorted = sidebar.find((g) => g.text.startsWith('Unsorted'));
    expect(unsorted?.items.map((i) => i.link) ?? [],
      'add these to TOP_GROUPS in docs/.vitepress/config.mjs, in the group a reader would look in')
      .toEqual([]);
  });

  it('TOP_GROUPS names no file that has been deleted', () => {
    // The mirror direction. A group listing a file that no longer exists
    // renders nothing and reads exactly like a group that is simply short.
    const named = TOP_GROUPS.flatMap((g) => g.files);
    const gone = named.filter((f) => !files.includes(f));
    expect(gone, `TOP_GROUPS names missing files: ${gone.join(', ')}`).toEqual([]);
  });

  it('gives every entry a real title, not a filename', () => {
    // titleOf falls back to the filename when a doc has no `# ` heading. That
    // is deliberate (better than crashing) but it looks broken in a sidebar, so
    // surface it here instead.
    // ⚠️ The first version of this guessed by SHAPE — "all caps, or ends in
    // .md" — and flagged two archive files whose real titles simply end with
    // the words "STATE.md". Compare against the actual basename instead; the
    // property is "the title is not just the filename", not "the title looks
    // like a filename".
    const filenamey = sidebar.flatMap((g) => g.items)
      .filter((i) => i.text === i.link.split('/').pop());
    expect(filenamey.map((i) => i.link),
      'these docs have no `# ` heading, so the sidebar shows their filename').toEqual([]);
  });
});
