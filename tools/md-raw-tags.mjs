// ============================================================
// md-raw-tags.mjs — find angle-bracket placeholders that a markdown renderer
// will SILENTLY DELETE.
//
// WHY. `docs/state-archive/2026-07-24-full.md` said:
//
//     Old gmail login sees a full-screen "ย้ายไป <kkumail>" block
//
// GitHub renders that as `"ย้ายไป "`. The placeholder is an unknown HTML tag,
// so the sanitiser drops it and the sentence loses the only word it exists to
// say. Confirmed against GitHub's own renderer (`gh api -X POST /markdown`),
// not assumed. VitePress is louder — the Vue compiler ABORTS the build on
// `<kkumail>` — which is how these were found at all, five weeks after they
// were written.
//
// ⚠️ THIS INSTRUMENT HAS BEEN WRONG TWICE, in both directions, which is why
// its test carries fixtures for each miss (`.claude/rules/mistakes.md`: a
// guard's instrument needs a guard too):
//
//   1. it did not understand a MULTI-LINE inline code span, and reported
//      `<col>` inside `` `alter table … <col> …` `` as raw — 20 false hits
//   2. it did not understand a fenced block inside a BLOCKQUOTE
//      (`> ```bash`), and a "fix" applied to one of those corrupted the line
//
// So: never widen this without adding the case to `md-raw-tags.test.js` first.
//
// ⛔ DO NOT ADD SVG ELEMENT NAMES TO `RENDERED_HTML`. It is the obvious "fix"
// the first time someone puts an inline diagram in a doc and this goes red —
// and it is wrong. Measured against GitHub's own renderer on 2026-08-31
// (`gh api -X POST /markdown`), an inline `<svg>` does not survive: the shell
// is stripped and every `<text>` child is KEPT, as a bare paragraph. A diagram
// therefore becomes a scatter of stray label words in the middle of the prose —
// worse than being dropped, because it reads as broken writing rather than a
// missing figure. Allowlisting the tags would make this instrument report green
// over exactly that. Put diagrams in `docs/diagrams/*.svg` and reference them
// relatively (`![alt](./diagrams/x.svg)`), which both renderers handle;
// `docs/STEP-BY-STEP.md` is the worked example.
//
// 📌 IT LIVES IN tools/, NOT src/. It is an instrument for `docs/`, and nothing
// in the app imports it — but while it sat under `src/js/` it made
// `npm run deploy:owed` report a deploy owed for a file that can never reach a
// bundle. A verification step that cries wolf gets ignored, which this repo has
// already paid to learn (`tools/run-proofs.mjs`).
// ============================================================

/**
 * Tags that a markdown renderer legitimately keeps. Anything else between
 * angle brackets in prose is a placeholder the reader is meant to SEE.
 */
export const RENDERED_HTML = new Set([
  'a', 'b', 'i', 'em', 'strong', 'code', 'pre', 'br', 'hr', 'img', 'p',
  'table', 'thead', 'tbody', 'tr', 'td', 'th', 'div', 'span', 'details',
  'summary', 'ul', 'ol', 'li', 'sub', 'sup', 'kbd', 'blockquote',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
]);

const blank = (m) => m.replace(/[<>]/g, ' ');

/**
 * Remove everything a renderer treats as literal text, so what remains is
 * prose. Order matters: fences before inline spans, or a stray backtick inside
 * a fenced block eats the rest of the file.
 */
export function stripCodeAndLinks(markdown) {
  // Fences are handled LINE BY LINE, not by a regex. The regex version — a
  // lazy `[\s\S]*?` closed by a backreference — backtracked catastrophically
  // and hung the test run on the first real file it met. A state machine over
  // lines cannot do that, and it is easier to read.
  const lines = String(markdown).split('\n');
  let fence = null;   // the marker that opened the current block, or null
  const kept = lines.map((line) => {
    // An optional blockquote prefix: `> ```bash` opens a block just as ```` ```bash ```` does.
    const m = line.match(/^[ \t]*(?:>[ \t]*)*(`{3,}|~{3,})/);
    if (fence) {
      if (m && m[1][0] === fence[0] && m[1].length >= fence.length) fence = null;
      return blank(line);
    }
    if (m) { fence = m[1]; return blank(line); }
    return line;
  });
  let t = kept.join('\n');

  // Inline spans, which may run across a line break but never a blank line.
  // ⚠️ The two branches must not overlap: `[^`]` also matches a newline, and
  // writing it that way made the alternation ambiguous — exponential
  // backtracking, and the sweep hung instead of failing.
  t = t.replace(/(`+)(?:[^`\n]|\n(?!\s*\n))*?\1/g, blank);
  // `[ref]: <destination>` — angle brackets are the markdown link syntax here.
  t = t.replace(/^\s*\[[^\]]+\]:\s*<[^>]*>.*$/gm, blank);
  // `<https://…>` is an autolink; every renderer turns it into a link.
  t = t.replace(/<[a-z][a-z0-9+.-]*:\/\/[^>\s]*>/gi, blank);
  // `<AppID\>` — already escaped by the author, and renders as text.
  t = t.replace(/<[A-Za-z][^>\n]*\\>/g, blank);
  return t;
}

/**
 * A code span that a line-leading HTML tag tore in half.
 *
 * CommonMark starts an HTML BLOCK at any line whose first token is a tag like
 * `<table`, and an HTML block INTERRUPTS the open paragraph — so an inline
 * code span cannot cross into it. `docs/mistakes/authz-rls.md` had:
 *
 *     never `select *` or `returns setof
 *     <table>`, so a future `alter table` cannot silently widen it.
 *
 * Both GitHub and VitePress render that as a literal backtick, a stray empty
 * `<table>` element, and a sentence in pieces. `stripCodeAndLinks` was FOOLED
 * by it — it removed the span the author intended rather than the one the
 * renderer sees — so this is checked separately, on the raw text.
 *
 * @param {string} markdown
 * @returns {{ line: number, text: string }[]}
 */
export function findTornSpans(markdown) {
  const lines = String(markdown).split('\n');
  const out = [];
  let fence = false;
  lines.forEach((line, i) => {
    if (/^[ \t]*(?:>[ \t]*)*(?:`{3,}|~{3,})/.test(line)) { fence = !fence; return; }
    if (fence) return;
    // A line that OPENS an HTML block and also carries a backtick: the tag has
    // landed inside what the author wrote as code.
    if (/^ {0,3}<\/?[A-Za-z][A-Za-z0-9-]*[\s/>]/.test(line) && line.includes('`')) {
      out.push({ line: i + 1, text: line.trim().slice(0, 60) });
    }
  });
  return out;
}

/**
 * @param {string} markdown
 * @returns {{ line: number, text: string }[]} placeholders a renderer will eat.
 */
export function findRawTags(markdown) {
  const out = [];
  stripCodeAndLinks(markdown).split('\n').forEach((line, i) => {
    // The TAG NAME is the first token only. Capturing `[A-Za-z0-9_ -]*`
    // instead swallowed the attributes too, so `<img src="x">` came back as a
    // tag named `img src=` and was reported as a placeholder.
    // `<test inbox>` is still caught: its tag name is `test`, which no
    // renderer knows, so GitHub drops the whole thing — verified against
    // `gh api -X POST /markdown`.
    for (const m of line.matchAll(/<\/?([A-Za-z][A-Za-z0-9-]*)(?=[\s/>])[^>\n]*>/g)) {
      if (RENDERED_HTML.has(m[1].toLowerCase())) continue;
      out.push({ line: i + 1, text: m[0] });
    }
  });
  return out;
}
