// ==============================================
// strip-comments.js — remove comments from JS source WITHOUT eating code.
//
// WHY THIS IS NOT A REGEX. Four guards in this repo each carried their own
// `.replace(/\/\*[\s\S]*?\*\//g, '')`. That regex cannot tell a comment opener
// from the two characters `/*` inside a string — and `main.js` contains
//
//     input.accept = 'image/*';
//
// so the "comment" opened there and ran until the next `*​/` anywhere in the
// file: 13,839 characters of real source blanked before any assertion ran. The
// same literal is in `admin-main.js` and `my-seat.js`. Measured on 2026-08-12:
// ~24,000 characters across the three files were invisible to the guards, and
// `native-dialog.test.js` — whose whole job is to find dialogs in exactly these
// modules — was one of the blinded readers.
//
// A guard that reads a mangled file does not fail. It PASSES, because the
// hazard it was looking for is no longer in the text it was handed. That is
// this repo's most expensive failure mode, and it was living inside the tests
// written to prevent it.
//
// So: a character scanner with an explicit mode stack. It replaces comments
// with equivalent whitespace rather than deleting them, so every line number
// and byte offset in the output still matches the input — a guard that reports
// `file:line` keeps telling the truth.
//
// THE PART THAT IS EASY TO GET WRONG, and did get wrong once: `${…}` inside a
// template literal holds REAL CODE, which can contain quotes, comments and
// further templates. A scanner that skips to the next backtick lands inside an
// interpolation and is out of phase FOR THE REST OF THE FILE. The first draft
// did that and left a `/** … */` block un-stripped five lines after a
// multi-line template in `house/my-house.js` — caught only because
// `native-dialog.test.js` then reported prose as a call site.
//
// Covered by `strip-comments.test.js`, which checks the property a phase error
// violates: with `keepStrings: false`, the output contains no comment markers
// at all. An instrument every other guard depends on is the last place to
// accept "looks right".
// ==============================================

/**
 * @param {string} code JavaScript source.
 * @param {{ keepStrings?: boolean, keepRegex?: boolean }} [opts] When
 *   `keepStrings` is false, string and template contents are blanked too
 *   (quotes kept), which is what a guard scanning for a CALL wants — otherwise
 *   the identifier it forbids can hide inside a message string and be scored as
 *   a real call site. `keepRegex: false` does the same for regex literals: a
 *   pattern whose last atom is `\s*` ends with a star immediately before its
 *   closing delimiter, which reads as a block-comment CLOSER to anything
 *   checking that no comment markers remain. house/index.js has one.
 *   (Writing that sequence out here would end this very comment — which is the
 *   same hazard, one level up.)
 * @returns {string} same length as the input, comments replaced by spaces.
 */
export function stripComments(code, opts = {}) {
  const keepStrings = opts.keepStrings !== false;
  const keepRegex = opts.keepRegex !== false;
  const n = code.length;
  const out = new Array(n);

  // What the scanner is currently inside. `interp` entries carry the brace
  // depth of a `${…}`; hitting depth 0 returns to the template that opened it.
  /** @type {Array<{ kind: 'template' | 'interp', depth?: number }>} */
  const stack = [];
  const inTemplate = () => stack.length > 0 && stack[stack.length - 1].kind === 'template';

  /** Keep a character, or blank it when we are inside a string and not keeping them. */
  const emit = (i, literal) => { out[i] = literal ? code[i] : (code[i] === '\n' ? '\n' : ' '); };

  // Whether a `/` here opens a regex literal rather than being division. Look
  // back at the last emitted non-space character: after a value (identifier,
  // number, `)`, `]`) it is division; after an operator, `(`, `,` or `=` it is
  // a regex. The standard heuristic, and sufficient for this codebase.
  const regexCanStart = (i) => {
    for (let k = i - 1; k >= 0; k -= 1) {
      const c = code[k];
      if (c === ' ' || c === '\n' || c === '\t' || c === '\r') continue;
      return !/[\w$)\]]/.test(c);
    }
    return true;
  };

  let i = 0;
  while (i < n) {
    const c = code[i];
    const next = code[i + 1];

    if (inTemplate()) {
      if (c === '\\') { emit(i, keepStrings); emit(i + 1, keepStrings); i += 2; continue; }
      if (c === '`') { out[i] = '`'; stack.pop(); i += 1; continue; }
      if (c === '$' && next === '{') {
        out[i] = '$'; out[i + 1] = '{';
        stack.push({ kind: 'interp', depth: 1 });
        i += 2;
        continue;
      }
      emit(i, keepStrings);
      i += 1;
      continue;
    }

    // ---- comments (only reachable in code context) ----
    if (c === '/' && next === '*') {
      const end = code.indexOf('*/', i + 2);
      const stop = end === -1 ? n : end + 2;
      for (let k = i; k < stop; k += 1) out[k] = code[k] === '\n' ? '\n' : ' ';
      i = stop;
      continue;
    }
    if (c === '/' && next === '/') {
      let end = code.indexOf('\n', i);
      if (end === -1) end = n;
      for (let k = i; k < end; k += 1) out[k] = ' ';
      i = end;
      continue;
    }

    // ---- quoted strings ----
    if (c === "'" || c === '"') {
      out[i] = c;
      let j = i + 1;
      while (j < n) {
        if (code[j] === '\\') { emit(j, keepStrings); emit(j + 1, keepStrings); j += 2; continue; }
        if (code[j] === c) break;
        // A quoted string cannot span a newline. Bailing here stops an
        // unterminated quote (an apostrophe in prose, most often) from
        // swallowing the rest of the file — the exact failure being fixed.
        if (code[j] === '\n') break;
        emit(j, keepStrings);
        j += 1;
      }
      if (code[j] === c) { out[j] = c; i = j + 1; } else { i = j; }
      continue;
    }

    if (c === '`') {
      out[i] = '`';
      stack.push({ kind: 'template' });
      i += 1;
      continue;
    }

    // ---- regex literals, so `/*` inside one is not a comment ----
    if (c === '/' && regexCanStart(i)) {
      let j = i + 1;
      let inClass = false;
      let closed = false;
      while (j < n) {
        const d = code[j];
        if (d === '\\') { j += 2; continue; }
        if (d === '\n') break;
        if (d === '[') inClass = true;
        else if (d === ']') inClass = false;
        else if (d === '/' && !inClass) { closed = true; break; }
        j += 1;
      }
      if (closed) {
        out[i] = '/';
        for (let k = i + 1; k < j; k += 1) out[k] = keepRegex ? code[k] : ' ';
        out[j] = '/';
        i = j + 1;
        continue;
      }
    }

    // ---- interpolation brace tracking ----
    if (stack.length > 0 && stack[stack.length - 1].kind === 'interp') {
      const top = stack[stack.length - 1];
      if (c === '{') top.depth += 1;
      else if (c === '}') {
        top.depth -= 1;
        if (top.depth === 0) { out[i] = '}'; stack.pop(); i += 1; continue; }
      }
    }

    out[i] = c;
    i += 1;
  }

  for (let k = 0; k < n; k += 1) if (out[k] === undefined) out[k] = code[k];
  return out.join('');
}

/** HTML comments. Same reasoning, far simpler grammar. */
export function stripHtmlComments(html) {
  return html.replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ' '));
}
