// ============================================================
// VitePress config — the docs site. Phase 5 of docs/TEAM-WORKFLOW.md §8.
//
// ⛔ THE SIDEBAR IS GENERATED, NOT WRITTEN. Every `.md` under `docs/` is found
// on disk and titled from its own first `# ` heading. There is deliberately no
// hand-maintained page list, because this repo has paid for that shape more
// than once: a list beside the thing it describes drifts, and the drift is
// invisible — a doc simply never appears in the sidebar and nobody notices it
// is missing (.claude/rules/mistakes.md, class 6). `src/js/docs-site.test.js`
// asserts the generator still reaches every file.
//
// WHAT IS PUBLISHED. All of `docs/`, deliberately — the owner chose the whole
// tree over a contributor-facing subset on 2026-08-30. The repository is
// already public, so nothing here is newly exposed; what changes is that it
// becomes browsable and indexable. **That is the reason nothing secret may go
// into `docs/`** — no key, no live URL that is meant to stay unlisted (the
// `samo-dev` project URL in particular), no student's name, รหัสนักศึกษา or
// photo. That was already the rule for a public repo; the site raises the
// price of breaking it.
// ============================================================
import { defineConfig } from 'vitepress';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const DOCS = new URL('..', import.meta.url).pathname;

/** Directories under docs/ that are not pages. */
const SKIP_DIRS = new Set(['.vitepress', 'templates', 'node_modules', 'package', 'demos']);
// `demos/` is NOT documentation. `docs/demos/about-3d/README.md` is a decision
// still waiting on the owner, and it links a PRIVATE Claude artifact URL —
// publishing that link on a browsable site is the wrong shape regardless of
// whether the artifact itself is reachable. The files stay in the repository,
// where the person making the decision reads them.
// ⚠️ `docs/demos/about-3d/package/` is a VENDORED third-party npm tree — 1,195
// files and 37 MB checked in under docs/. It is not documentation, and building
// its stray READMEs into the site would publish someone else's package as if it
// were ours. Excluded by the `package` entry above; `srcExclude` below repeats
// it so VitePress does not glob them either.

/** Every markdown file under docs/, as paths relative to docs/. */
export function collect(dir = DOCS, out = []) {
  for (const name of readdirSync(dir).sort()) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) collect(full, out);
    else if (name.endsWith('.md')) out.push(relative(DOCS, full));
  }
  return out;
}

/**
 * A page's title, taken from its own first `# ` heading.
 *
 * Falling back to the filename rather than throwing is deliberate: a file with
 * no heading is a real thing (a stub, a generated fragment) and should still be
 * reachable. An unreachable page is the failure this generator exists to avoid.
 */
export function titleOf(rel) {
  const text = readFileSync(join(DOCS, rel), 'utf8');
  const h1 = text.match(/^#\s+(.+?)\s*$/m);
  if (h1) return h1[1].replace(/`/g, '');
  return rel.split(sep).pop().replace(/\.md$/, '');
}

/**
 * The top-level docs, GROUPED FOR A READER rather than listed alphabetically.
 *
 * A flat list of 71 pages is the thing the owner said drove non-technical
 * people off GitHub in the first place, so this is the one hand-maintained
 * list on the site — and it is guarded: `src/js/docs-site.test.js` fails when a
 * new top-level doc is not in exactly one group. A file is never LOST by
 * omission (it lands in `UNSORTED` and the test goes red naming it); it just
 * cannot be quietly ignored.
 */
export const TOP_GROUPS = [
  {
    text: 'เริ่มที่นี่ · Start here',
    files: ['DEPT-TOOLS.md', 'TEAM-WORKFLOW.md', 'MERGE-CHECKLIST.md', 'VERSIONING.md'],
  },
  {
    text: 'How the system works',
    files: [
      'INVARIANTS.md', 'CONTEXT.md', 'EMAIL.md', 'PERSON-REGISTRY.md',
      'HOUSE-SYSTEM.md', 'house-data-spec-th.md', 'TEAM-ROLES-AND-PHOTOS.md',
      'SELF-HOST.md',
    ],
  },
  {
    text: 'Plans, proposals and history',
    files: [
      'NEXT.md', 'PROJECT-ARCHITECTURE.md', 'KKU-SSO.md', 'KKU-SSO-MANUAL.md',
      'AUTH-MODEL.md', 'SUPABASE-MIGRATION.md', 'PASSPORT-MERGE.md',
    ],
  },
];

const SUBDIR_GROUPS = [
  { key: 'mistakes', text: 'Bug write-ups', collapsed: true },
  { key: 'state', text: 'Session notes', collapsed: true },
  { key: 'state-archive', text: 'Archive — why it was done that way', collapsed: true },
  { key: 'design-refs', text: 'Design references', collapsed: true },
];

const linkOf = (rel) => '/' + rel.replace(/\.md$/, '').split(sep).join('/');
const dirOf = (rel) => (rel.includes(sep) ? rel.split(sep)[0] : '');

/**
 * @returns {{ text: string, collapsed?: boolean, items: {text:string,link:string}[] }[]}
 */
export function buildSidebar(files = collect()) {
  const top = files.filter((f) => dirOf(f) === '' && f !== 'index.md');
  const claimed = new Set(TOP_GROUPS.flatMap((g) => g.files));
  const groups = TOP_GROUPS.map((g) => ({
    text: g.text,
    collapsed: false,
    items: g.files.filter((f) => top.includes(f)).map((f) => ({ text: titleOf(f), link: linkOf(f) })),
  }));

  // Anything nobody classified. Empty in a healthy repo; the test says so.
  const unsorted = top.filter((f) => !claimed.has(f));
  if (unsorted.length) {
    groups.push({
      text: 'Unsorted — add these to TOP_GROUPS',
      collapsed: false,
      items: unsorted.map((f) => ({ text: titleOf(f), link: linkOf(f) })),
    });
  }

  for (const { key, text, collapsed } of SUBDIR_GROUPS) {
    let items = files.filter((f) => dirOf(f) === key);
    if (!items.length) continue;
    // Dated filenames — newest first, which is the order anyone wants them in.
    if (key === 'state-archive') items = items.slice().reverse();
    groups.push({ text, collapsed, items: items.map((f) => ({ text: titleOf(f), link: linkOf(f) })) });
  }
  return groups;
}

export default defineConfig({
  title: 'SAMO MDKKU — docs',
  description: 'Working documentation for the MDKKU SAMO student portal.',
  lang: 'th',
  base: '/samomdkkuweb/',

  // ⛔ NOT INDEXED, deliberately. The repository has always been public, so
  // nothing here is newly exposed — but a rendered, crawlable site is a
  // different thing from a file in a repo, and this content is engineering
  // notes: infrastructure detail, a colleague's work email where it is
  // load-bearing evidence, the reasoning behind access rules. The audience is
  // the team and the ฝ่าย, who arrive from a link somebody gave them, not from
  // a search engine. `robots.txt` in `docs/public/` says the same thing to
  // crawlers that ignore the meta tag.
  head: [['meta', { name: 'robots', content: 'noindex, nofollow' }]],
  srcExclude: ['**/node_modules/**', 'templates/**', '**/package/**', 'demos/**'],
  cleanUrls: true,
  lastUpdated: true,

  // These docs reference source files, tools and skills by path constantly —
  // `server/deploy.sh`, `tools/db-query.mjs`, `skills/deploy-vm.md`. Those are
  // real paths in the repository and NOT pages on this site, so VitePress is
  // right that they do not resolve and wrong that it is a defect. Anything
  // pointing INSIDE docs/ is still checked.
  ignoreDeadLinks: [
    /^\.\.\/(?!.*\.md$)/, /^\/(?!samomdkkuweb)/,
    /^(src|tools|skills|server|supabase|appscript|public|scripts)\//,
    /^\.\.\/\.\.\//, /\.(sh|mjs|js|sql|gs|json|html|css|py)$/,
  ],

  themeConfig: {
    outline: { level: [2, 3], label: 'ในหน้านี้ · On this page' },
    nav: [
      { text: 'เริ่มที่นี่', link: '/DEPT-TOOLS' },
      { text: 'How it works', link: '/CONTEXT' },
      { text: 'Rules', link: '/INVARIANTS' },
      { text: 'Bug write-ups', link: '/mistakes/INDEX' },
      {
        text: 'Repo',
        items: [
          { text: 'GitHub', link: 'https://github.com/phuriphatma/samomdkkuweb' },
          { text: 'STATE.md — what is true right now', link: 'https://github.com/phuriphatma/samomdkkuweb/blob/main/STATE.md' },
          { text: 'CONTRIBUTING.md', link: 'https://github.com/phuriphatma/samomdkkuweb/blob/main/CONTRIBUTING.md' },
          { text: 'The live portal', link: 'https://samo.md.kku.ac.th' },
        ],
      },
    ],
    sidebar: buildSidebar(),
    // Local search — no Algolia account, no third party, works offline.
    // ⚠️ Thai has no word boundaries, so a Thai term is findable only where the
    // prose already surrounds it with spaces (which is how these docs are
    // written: `ฝ่าย`, `หนังสือโครงการ`). Do not promise Thai substring search.
    search: {
      provider: 'local',
      options: {
        translations: {
          button: { buttonText: 'ค้นหา · Search', buttonAriaLabel: 'ค้นหา' },
          modal: {
            noResultsText: 'ไม่พบผลลัพธ์',
            footer: { selectText: 'เลือก', navigateText: 'เลื่อน', closeText: 'ปิด' },
          },
        },
      },
    },
    docFooter: { prev: 'ก่อนหน้า', next: 'ถัดไป' },
    darkModeSwitchLabel: 'ธีม',
    returnToTopLabel: 'กลับขึ้นบน',
    sidebarMenuLabel: 'เมนู',
    editLink: {
      pattern: 'https://github.com/phuriphatma/samomdkkuweb/edit/main/docs/:path',
      text: 'Edit this page on GitHub',
    },
    footer: {
      message: 'Working docs. <strong>STATE.md is the status file and lives at the repo root, not here.</strong>',
      copyright: 'สโมสรนักศึกษา คณะแพทยศาสตร์ มหาวิทยาลัยขอนแก่น',
    },
  },
});
