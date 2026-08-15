// Every stylesheet must be reachable from an entry — and from the RIGHT one.
//
// REPORTED, with a screenshot: จองโควตา Claude rendered as a bare column of
// unstyled text — day names, hour labels and bar segments stacked down the
// page. Nothing was broken. The pane, the permission gate, the routing and the
// board data were all correct; `src/css/claude.css` had simply been imported
// into `src/main.css` while the pane lives in `admin/index.html`, which loads
// `src/admin.css`. The rules were built, shipped, and never loaded.
//
// This is the repo's two-entry trap (see two-entry-spa: public `/` and admin
// `/admin/` build separately) crossed with the CSS failure mode that has its
// own line in mistakes.md: a selector that stops matching looks exactly like a
// feature nobody built. There is no error, no failed request, no console
// warning — CSS just does nothing, and it does nothing in a way that reads as
// "the layout was never written".
//
// So: an orphan check, which is the mechanism a comment could not be.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');

const MAIN = read('./main.css');
const ADMIN = read('./admin.css');
const CSS_FILES = readdirSync(new URL('./css/', import.meta.url))
  .filter((f) => f.endsWith('.css'));

const importsOf = (entry) =>
  [...entry.matchAll(/@import\s+['"]\.\/css\/([\w-]+\.css)['"]/g)].map((m) => m[1]);

const MAIN_IMPORTS = importsOf(MAIN);
const ADMIN_IMPORTS = importsOf(ADMIN);

describe('no stylesheet is an orphan', () => {
  it.each(CSS_FILES)('%s is imported by main.css or admin.css', (file) => {
    // A file in src/css/ that neither entry imports is dead code at best and,
    // when something in the markup expects it, an invisible bug.
    expect(
      MAIN_IMPORTS.includes(file) || ADMIN_IMPORTS.includes(file),
      `${file} is imported by neither src/main.css nor src/admin.css`,
    ).toBe(true);
  });

  it('both entries import only files that exist', () => {
    [...MAIN_IMPORTS, ...ADMIN_IMPORTS].forEach((f) => {
      expect(CSS_FILES, `src/css/${f} is imported but missing`).toContain(f);
    });
  });
});

describe('an admin-only pane gets its CSS from the admin entry', () => {
  // The pane partials that only admin/index.html includes. Each pairs with the
  // stylesheet that draws it; the point of the pairing is that the stylesheet
  // must be on the SAME side of the two-entry split as the markup.
  const ADMIN_ONLY = [
    ['claude.css', 'tab-claude.html'],
    ['house-admin.css', 'tab-house.html'],
    ['analytics.css', 'tab-analytics.html'],
  ];

  const ADMIN_HTML = read('../admin/index.html');
  const PUBLIC_HTML = read('../index.html');

  it.each(ADMIN_ONLY)('%s is in admin.css, because %s is an admin-only partial', (css, partial) => {
    // Guard the guard: assert the PREMISE first. If the partial ever starts
    // being included in the public entry too, this pairing is wrong and the
    // test should say so rather than quietly enforcing a stale rule.
    expect(ADMIN_HTML, `${partial} should be included by admin/index.html`).toContain(partial);
    expect(PUBLIC_HTML, `${partial} is no longer admin-only — revisit this pairing`)
      .not.toContain(partial);

    expect(ADMIN_IMPORTS, `${css} must be imported by src/admin.css`).toContain(css);
    expect(MAIN_IMPORTS, `${css} is admin-only and would be dead weight in the public bundle`)
      .not.toContain(css);
  });
});
