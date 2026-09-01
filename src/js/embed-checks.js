// ============================================================
// embed-checks.js — what a Lane-B ฝ่าย tool folder must satisfy.
// docs/DEPT-TOOLS.md §8.1. ONE implementation, two callers:
//
//   npm run check:embeds   → tools/check-embeds.mjs, for a contributor
//   npm test               → src/js/tool-frame.test.js, for CI
//
// Two callers of one rule is exactly the shape that drifts (class 6), so the
// rule lives here and both read it. The CLI exists because a contributor who
// cannot run the whole Vitest suite still needs a one-command answer.
//
// ⚠️ WHAT THIS IS AND IS NOT. None of these checks is the security boundary —
// the sandbox is (`src/js/tool-frame.js`). A tool that ignored every rule here
// still could not read the session, the DOM or the database. These catch the
// things that would merely be BROKEN or unmaintainable: code that throws on an
// opaque origin, a dependency on a host that will refuse the request anyway,
// and a folder nobody's name is on.
// ============================================================

import { stripComments } from './strip-comments.js';

/** Script hosts a tool may load from. Everything else must be in the folder. */
export const SCRIPT_ALLOWLIST = ['cdn.jsdelivr.net', 'cdnjs.cloudflare.com'];

/** Files whose CODE is scanned. Markdown is documentation ABOUT the rules and
 *  naturally contains the very strings the rules forbid — scanning it would
 *  make every correct README fail (a guard that fires on the healthy case). */
export const SCANNED = /\.(html|js|css)$/i;

/**
 * @param {{slug:string, files:Record<string,string>}} folder
 *   `files` maps a relative filename to its contents. Passing the contents in
 *   (rather than reading here) keeps this pure and lets the test build a
 *   folder that does NOT exist on disk — which is how the falsification cases
 *   below are written without creating and deleting real files.
 * @returns {string[]} human-readable problems; empty means it passes.
 */
export function checkEmbedFolder({ slug, files }) {
  const problems = [];
  const names = Object.keys(files);

  if (!names.includes('index.html')) {
    problems.push(`${slug}: no index.html — the frame would load a 404`);
  }

  const readme = files['README.md'];
  if (readme === undefined) {
    problems.push(`${slug}: no README.md`);
  } else if (!/^\s*(Owner|เจ้าของ)\s*:\s*\S/mi.test(readme)) {
    problems.push(`${slug}: README.md has no "Owner:" line naming a human — `
      + `a folder nobody owns is one nobody will update`);
  }

  for (const name of names) {
    if (!SCANNED.test(name)) continue;
    // Read through the shared stripper, never a hand-rolled regex: four
    // ratchets in this repo carried their own and every one was blind wherever
    // a file contained `'image/*'` (src/js/strip-comments.test.js).
    const code = stripComments(files[name]);
    const at = (msg) => `${slug}/${name}: ${msg}`;

    for (const m of code.matchAll(/<script[^>]*\bsrc\s*=\s*["']https?:\/\/([^/"']+)/gi)) {
      if (!SCRIPT_ALLOWLIST.includes(m[1])) {
        problems.push(at(`loads a script from ${m[1]}, which is not on the allowlist `
          + `(${SCRIPT_ALLOWLIST.join(', ')}). Put the code in the folder instead`));
      }
    }

    if (/\b(local|session)Storage\b/.test(code)) {
      problems.push(at('uses localStorage/sessionStorage, which THROWS on an opaque '
        + 'origin — the page will break, not degrade. Keep state in a variable'));
    }

    // `parent.postMessage(` is the height channel and the ONE exception: it is
    // the only parent access that works cross-origin at all. Every other
    // `parent.`/`top.` reach throws, so forbidding them is about telling the
    // author now instead of at runtime.
    const reaches = code.replace(/parent\s*\.\s*postMessage\s*\(/g, '');
    if (/\b(parent|top)\s*\.\s*\w/.test(reaches) || /\bwindow\s*\.\s*opener\b/.test(reaches)) {
      problems.push(at('reaches for parent/top/window.opener. The frame is isolated '
        + 'on purpose; only parent.postMessage() crosses it'));
    }
  }

  return problems;
}

// ---------------------------------------------------------------------------
// THE BOUNDARY. docs/DEPT-TOOLS.md §8.3.
//
// What makes "let the ฝ่าย open pull requests" safe is not the review — it is
// that a `tool/*` branch can only reach two places. A peer approving a diff
// they cannot fully read is safe when the diff CANNOT contain auth.js.
//
// ⚠️ `src/data/tools.js` is allowed here and gated elsewhere: CODEOWNERS puts
// it behind the owner, because that one line is what makes a folder reachable
// and decides who can see it. This check is about REACH; the owner's review is
// about the entry. Two different questions, deliberately in two places.
// ---------------------------------------------------------------------------

/** Paths a `tool/*` branch may change. */
export const TOOL_LANE = [
  /^public\/embed\/[a-z0-9][a-z0-9-]*\/[^/]+$/,   // a tool's own folder
  /^src\/data\/tools\.js$/,                       // the one registry entry
];

/**
 * Which of `paths` a tool branch is not allowed to touch.
 * @param {string[]} paths repo-relative, as `git diff --name-only` prints them
 */
export function filesOutsideToolLane(paths) {
  return paths.filter((p) => p && !TOOL_LANE.some((re) => re.test(p)));
}
