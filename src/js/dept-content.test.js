// ============================================================
// dept-content.test.js — the guards for a ฝ่าย's own page content (0177).
//
// ⛔ THE ONE THAT MATTERS: a ฝ่าย's HTML is rendered VERBATIM, and it is only
// safe because it goes into an iframe on an OPAQUE ORIGIN — `sandbox` with no
// `allow-same-origin`. Everything else about this feature is ordinary CRUD.
//
// The change that would break it does not look like a security change. It looks
// like a simplification: "the editors are trusted staff, just innerHTML it".
// That is why the property is asserted on the RENDERED markup, in both the
// public renderer and the admin preview, and why the test says so in the
// failure message rather than in a comment nobody reads at 1am.
// ============================================================

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { renderContentHtml, renderContentCard, renderDeptContent } from './dept-content.js';
import { EMBED_SANDBOX } from './tool-frame.js';
import { DEPT_KEYS, DEPT_OPTIONS, deptLabel } from '../data/depts.js';
import { DEPT_PAGES, DEPT_PAGE_LABEL, DEPT_PAGES_ALL, ADMIN_FEATURES, PERM_CATALOG } from './team-vocab.js';

const ROOT = new URL('../../', import.meta.url).pathname;
const read = (f) => readFileSync(`${ROOT}${f}`, 'utf8');
const ADMIN = read('src/js/dept-page-admin.js');
const CSS   = read('src/css/dept-page-admin.css');
const DDL   = read('supabase/migrations/0177_a_dept_edits_its_own_page.sql');

describe("a ฝ่าย's HTML is isolated, not sanitised", () => {
  it('renders into a sandbox WITHOUT allow-same-origin', () => {
    const html = renderContentHtml({ id: 'x', html: '<p>hi</p>' });
    const sandbox = /sandbox="([^"]*)"/.exec(html);
    expect(sandbox, 'no sandbox attribute at all').toBeTruthy();
    expect(sandbox[1], [
      'A ฝ่าย page block declares allow-same-origin, which puts whatever an',
      'editor pasted back on the site\'s own origin: it can then read the',
      'signed-in session, the parent DOM and cookies. The isolation IS the',
      'security model here — there is no sanitiser behind it, deliberately.',
    ].join('\n')).not.toContain('allow-same-origin');
    expect(sandbox[1]).toBe(EMBED_SANDBOX);
  });

  it('uses srcdoc, never innerHTML, and quotes the attribute', () => {
    // `"` would close srcdoc early and the rest would parse as attributes on
    // the iframe itself — which is an escape from the frame, not a style bug.
    const html = renderContentHtml({ id: 'x', html: '<img src="a" onerror="alert(1)">' });
    expect(html).toContain('srcdoc="');
    expect(html).not.toContain('src="a"');       // the inner quote was encoded
    expect(html).toContain('&quot;');
  });

  it('the SOURCE never assigns a row\'s html to innerHTML', () => {
    // The tempting simplification, in both files that touch this content.
    for (const f of ['src/js/dept-content.js', 'src/js/dept-page-admin.js']) {
      const src = read(f);
      expect(src, `${f} assigns .html straight into the DOM — that is the vulnerability`)
        .not.toMatch(/innerHTML\s*=\s*[^;]*\br\.html\b/);
      expect(src, `${f} assigns row.html into the DOM`)
        .not.toMatch(/innerHTML\s*=\s*[^;]*\brow\.html\b/);
    }
  });

  it('the admin preview renders through the SAME function as the live page', () => {
    // A second preview renderer is a second place for the sandbox to be wrong,
    // and the preview is exactly where someone would "just show it quickly".
    const admin = read('src/js/dept-page-admin.js');
    expect(admin).toContain("renderDeptContent");
    expect(admin, 'the editor builds its own frame markup instead of reusing one')
      .not.toContain('<iframe');
  });
});

describe('the page renders what a ฝ่าย put on it', () => {
  it('a card with a link is an anchor; one without is not a dead link', () => {
    const withLink = renderContentCard({ title: 'a', href: 'https://x.test' });
    expect(withLink).toContain('<a class="news-card"');
    expect(withLink).toContain('rel="noopener"');
    const noLink = renderContentCard({ title: 'a' });
    expect(noLink, 'an anchor with no href is unfocusable and announces a link to nowhere')
      .not.toContain('<a class="news-card"');
  });

  it('escapes what a ฝ่าย typed into a CARD field', () => {
    // A card is NOT the html block: its fields are plain text and go into the
    // page itself, so they must be escaped like any other user input.
    const out = renderContentCard({ title: '<script>alert(1)</script>' });
    expect(out).not.toContain('<script>');
    expect(out).toContain('&lt;script&gt;');
  });

  it('hidden rows never reach the public page', () => {
    const out = renderDeptContent([
      { id: '1', kind: 'card', title: 'shown', visible: true },
      { id: '2', kind: 'card', title: 'ซ่อนไว้', visible: false },
    ]);
    expect(out).toContain('shown');
    expect(out, 'a hidden row rendered publicly makes ซ่อน mean nothing').not.toContain('ซ่อนไว้');
  });

  it('an HTML block breaks the card grid instead of becoming a grid ITEM', () => {
    // Found by opening the page: the container carried `news-grid`, so a block
    // sat in a column beside a card and both stretched to the tallest cell.
    const out = renderDeptContent([
      { id: '1', kind: 'card', title: 'a', visible: true },
      { id: '2', kind: 'html', html: '<p>x</p>', visible: true },
      { id: '3', kind: 'card', title: 'b', visible: true },
    ]);
    // Counts GRIDS, not the word: each grid carries `news-grid news-grid--archive`,
    // so matching the bare token counted every grid twice.
    expect((out.match(/class="news-grid/g) || []).length,
      'the two card runs need their own grids').toBe(2);
    expect(out.indexOf('data-dept-html')).toBeGreaterThan(out.indexOf('news-grid'));
    expect(read('src/html/tab-departments.html'),
      'the container must not be a grid, or every html block becomes a grid item')
      .not.toMatch(/news-grid[^"]*"\s+id="deptsDetailCards"/);
  });

  it('renders nothing at all when a ฝ่าย has added nothing', () => {
    expect(renderDeptContent([])).toBe('');
    expect(renderDeptContent([{ id: '1', kind: 'card', title: 'x', visible: false }])).toBe('');
  });
});

describe('a new row is a DRAFT, and the editor says so', () => {
  // A card used to be created VISIBLE, so it stood on the ฝ่าย's PUBLIC page the
  // instant the button was pressed — placeholder title, no link, no cover. One
  // such card was live on ฝ่ายดิจิทัล. The premise of หน้าฝ่าย is that a ฝ่าย
  // builds their page over several sittings; a default that publishes each
  // sitting's half-finished state contradicts the feature it belongs to.
  it('every row addRow creates is a draft, whatever the kind', () => {
    const fn = ADMIN.slice(ADMIN.indexOf('async function addRow('));
    const insert = fn.slice(0, fn.indexOf('dbRest('));
    expect(
      insert,
      'a row created from หน้าฝ่าย is public the moment it is added, before it '
      + 'has a title, a link or a cover',
    ).toMatch(/visible:\s*false/);
    // The seeds must not be able to override it back. `{ ...seed }` spread
    // AFTER visible:false would let one kind quietly opt out of the rule.
    expect(insert, 'a seed is spread after visible:false and could override it')
      .toMatch(/visible:\s*false,\s*\.\.\.seed/);
  });

  it('the column default stays true — the draft rule belongs to the BUTTON', () => {
    // Flipping the DDL default would hide rows a future import or migration
    // creates, silently. The rule is about a person pressing a button, so it is
    // stated at that button, in the row it writes.
    expect(DDL).toMatch(/visible\s+boolean\s+not null default true/);
  });

  it('a hidden row carries a WORD, not just a fade', () => {
    // Hidden is now the state a ฝ่าย meets first. Opacity and a button reading
    // "แสดง" do not tell anyone what the fade means; someone who adds a card,
    // cannot find it in the preview, and has no word for why concludes the
    // feature is broken.
    expect(ADMIN).toMatch(/dpa-draft/);
    expect(ADMIN, 'the draft badge is painted on VISIBLE rows too').toMatch(
      /r\.visible === false \? '<span class="dpa-draft">/);
    expect(
      CSS,
      'the .dpa-draft class is emitted with no rule to render it — CSS fails '
      + 'silently, so a dead rule looks like a feature nobody built',
    ).toMatch(/\.dpa-draft\s*\{/);
  });

  it('the fade never covers the head that explains it', () => {
    // `opacity` on the row would take the badge and the แสดง button down with
    // the content: a child cannot be more opaque than its group.
    expect(CSS).not.toMatch(/\.dpa-row\.dpa-hidden\s*\{[^}]*opacity/);
    expect(CSS).toMatch(/\.dpa-row\.dpa-hidden\s*>\s*:not\(\.dpa-row-head\)/);
  });

  it('an all-draft page says so instead of "หน้านี้จะว่าง"', () => {
    // Two different emptinesses. "This page will be empty" beside a list of rows
    // the ฝ่าย just wrote reads as data loss; the true answer is that none of
    // them is published yet.
    expect(ADMIN).toMatch(/hasDrafts/);
    expect(ADMIN).toMatch(/ยังไม่มีอะไรขึ้นหน้าเว็บ/);
  });
});

describe('a kind is added in FOUR places or not at all (0179)', () => {
  // Adding a kind touches the DDL check constraint, the public renderer, the
  // editor's label map and the editor's new-row seeds. Miss one and the failure
  // is quiet and different each time: an unknown kind renders as a CARD
  // (deliberately — that is what makes the migration safe in either order), a
  // missing label shows the wrong chip, a missing seed posts a row the database
  // refuses with a message that blames the ฝ่าย.
  //
  // So the list is derived from the DDL — the one place that DECIDES what is
  // legal — and every other site is checked against it. Never written from the
  // same list the code came from.
  const DDL179 = read('supabase/migrations/0179_a_dept_page_has_sections.sql');
  const RENDER = read('src/js/dept-content.js');

  const kinds = (() => {
    const m = DDL179.match(/check \(kind in \(([^)]*)\)\)/);
    expect(m, 'the kind constraint was renamed — this guard is now blind').toBeTruthy();
    return [...m[1].matchAll(/'([a-z]+)'/g)].map((x) => x[1]);
  })();

  it('reads the legal kinds out of the DDL (control)', () => {
    expect(kinds.sort()).toEqual(['card', 'html', 'section', 'text']);
  });

  it('the public renderer has a branch for every kind but the default one', () => {
    // `card` is the else-branch on purpose, so it is the one kind that must NOT
    // appear as an explicit test — and every other one must.
    for (const k of kinds.filter((k) => k !== 'card')) {
      expect(RENDER, `renderDeptContent has no branch for kind='${k}', so it would `
        + 'be drawn as a card').toMatch(new RegExp(`r\\.kind === '${k}'`));
    }
  });

  it('the editor can label every kind', () => {
    for (const k of kinds) {
      expect(ADMIN, `KIND_META has no entry for '${k}' — its chip would say การ์ด`)
        .toMatch(new RegExp(`^\\s*${k}:\\s*\\{\\s*label:`, 'm'));
    }
  });

  it('the editor can CREATE every kind, with a body the constraint accepts', () => {
    const seeds = ADMIN.slice(ADMIN.indexOf('const NEW_ROW = {'));
    const block = seeds.slice(0, seeds.indexOf('};'));
    for (const k of kinds) {
      expect(block, `NEW_ROW has no seed for '${k}' — the add button would post a `
        + 'row the database refuses').toMatch(new RegExp(`${k}:\\s*\\{`));
    }
    // And each seed must carry the field its kind renders, or the insert is
    // refused by dept_content_has_body with a message that reads as a
    // permission problem.
    expect(block).toMatch(/section:\s*\{\s*title:/);
    expect(block).toMatch(/card:\s*\{\s*title:/);
    expect(block).toMatch(/text:\s*\{\s*description:/);
    expect(block).toMatch(/html:\s*\{\s*html:/);
  });

  it('has an add button for every kind', () => {
    const HTML = read('src/html/tab-dept-page.html');
    for (const k of kinds) {
      const id = `dpaAdd${k[0].toUpperCase()}${k.slice(1)}`;
      expect(HTML, `no ${id} button, so '${k}' can never be created`).toContain(id);
      expect(ADMIN, `${id} is in the markup but nothing listens to it`).toContain(id);
    }
  });

  it('every class the row chip EMITS has a live CSS rule', () => {
    // CSS fails silently: a chip with no rule is not a broken build, it is a
    // grey box that looks like a feature nobody finished.
    for (const cls of [...ADMIN.matchAll(/cls:\s*'(dpa-kind--[a-z]+)'/g)].map((m) => m[1])) {
      expect(CSS, `.${cls} is emitted with no rule`).toMatch(new RegExp(`\\.${cls}\\s*\\{`));
    }
  });
});

describe('the admin preview and the public page share one stylesheet path', () => {
  it('the preview container carries dept-content, like the live one', () => {
    // The page CSS is scoped under `.dept-content`. Without the class the
    // preview renders identical HTML through a different path, so a section
    // heading would look right live and wrong in the editor — which is exactly
    // what the preview exists to rule out.
    const ADMIN_HTML = read('src/html/tab-dept-page.html');
    const PUBLIC_HTML = read('src/html/tab-departments.html');
    expect(PUBLIC_HTML, 'the public container lost dept-content').toMatch(
      /id="deptsDetailCards"|class="dept-content/);
    expect(ADMIN_HTML).toMatch(/id="dpaPreview"[^>]*class="[^"]*dept-content/);
  });

  it('the section rules are scoped somewhere BOTH containers match', () => {
    const TF = read('src/css/tool-frame.css');
    expect(TF).toMatch(/\.dept-content\s*>\s*\.dept-section/);
  });
});

describe('the grant reaches every gate it has to', () => {
  it('the ฝ่าย list has ONE home, and the pickers read it', () => {
    expect(DEPT_KEYS.length).toBeGreaterThan(1);
    expect(DEPT_PAGES).toEqual(DEPT_OPTIONS);
    for (const k of DEPT_KEYS) expect(DEPT_PAGE_LABEL[k]).toBe(deptLabel(k));
  });

  it('every ฝ่าย the grid can open is a ฝ่าย the grant can name', () => {
    // Both directions: a page with no grantable key is uneditable for ever, and
    // a grantable key with no page is a grant that resolves to nothing.
    const grid = read('src/html/tab-departments.html');
    const opened = [...grid.matchAll(/data-dept-open="([a-z]+)"/g)].map((m) => m[1]).sort();
    expect([...new Set(opened)]).toEqual([...DEPT_KEYS].sort());
  });

  it('the blanket grant opens the admin app', () => {
    // A grant that does not open /admin/ is a screen its holder cannot reach.
    expect(ADMIN_FEATURES).toContain(DEPT_PAGES_ALL);
    expect(PERM_CATALOG.some((p) => p.key === DEPT_PAGES_ALL)).toBe(true);
  });

  it('a SCOPED holder — who has no permission key at all — still gets in', () => {
    // Class 5, the most repeated bug here: the writes honour the new channel
    // and the UI gate does not, so the database lets them edit a page the app
    // never shows them.
    const auth = read('src/js/auth.js');
    expect(auth, 'userCanAccess must admit a per-ฝ่าย scope, not just the key')
      .toMatch(/feature === 'dept_pages'[\s\S]{0,120}managedDeptPages/);
    expect(auth, 'the scope must be read off the profile row').toContain('managed_dept_pages');
    expect(auth, 'and carried from the login sync RPC').toContain('synced.dept_pages');
  });

  it('the scope and the blanket key are EXCLUSIVE on save', () => {
    // 0083: a narrowing scope beside an unconditional permission is dead,
    // because permissive policies are OR'd and the broad grant wins.
    const team = read('src/js/team/index.js');
    expect(team).toMatch(/pageScoped[\s\S]{0,80}filter\(\(p\) => p !== DEPT_PAGES_ALL\)/);
  });

  it('a scoped grant is still VISIBLE as a chip', () => {
    // 0087's twin: a scoped grant carries no capability key, so the generic
    // chip loop renders nothing and the grant looks absent to the admin who
    // just made it. Reported for Passport; written here in the same commit.
    const team = read('src/js/team/index.js');
    expect(team).toContain('is-page');
    expect(read('src/css/team.css'), 'a chip class with no CSS rule is an invisible chip')
      .toContain('.team-perm-chip.is-page');
  });

  it('the grant survives a team export/import', () => {
    const io = read('src/js/team/io.js');
    expect((io.match(/dept_page:/g) || []).length, 'nodes AND members').toBe(2);
  });

  it('the SQL and the JS agree on what the columns are called', () => {
    // The mirror is the risk: this rule is implemented on both sides of the
    // wire, so the names are pinned against the migration that created them.
    const sql = read('supabase/migrations/0177_a_dept_edits_its_own_page.sql');
    for (const name of ['managed_dept_pages', 'dept_page', 'current_user_dept_page_scope',
      'effective_team_dept_pages_for_email', 'dept_content']) {
      expect(sql, `${name} is not in 0177`).toContain(name);
    }
    // The blanket key spelled the same on both sides.
    expect(sql).toContain(`current_user_has_permission('${DEPT_PAGES_ALL}')`);
  });
});
