// ============================================================
// dept-content.js — a ฝ่าย's own page content, read from the database.
//
// Before 0177 this lived in `DEPT_DEFS.cards`, a hardcoded object: six ฝ่าย, of
// which exactly ONE had any content, and changing a link meant a commit and a
// deploy by the owner. docs/DEPT-TOOLS.md §12 named the rule this follows —
// **content is DATA, tools are CODE** — so cards, text and covers are rows a
// ฝ่าย edits in the app, and anything with behaviour stays a reviewed file.
//
// TWO KINDS:
//   'card' — structured, editable in a form by someone who has never seen HTML
//   'html' — a ฝ่าย that wants to design its own page writes HTML, and it is
//            rendered VERBATIM inside the SAME sandboxed frame a Lane-B tool
//            gets (tool-frame.js). Not a second isolation mechanism: the same
//            one, so there is one place to get it right.
//
// ⛔ THE HTML IS NEVER PUT IN THE PAGE. It goes into an iframe `srcdoc` with
// `sandbox` and NO `allow-same-origin`, i.e. an opaque origin — it cannot read
// the session, the parent DOM, cookies or localStorage. That is why it needs no
// sanitiser, and why "just innerHTML it, the editors are staff" is the change
// that would turn a content feature into a vulnerability. Guarded by
// dept-content.test.js, which asserts the property on the RENDERED markup.
// ============================================================

import { dbRest } from './db.js';
import { escHtml } from './utils.js';
import { convertDriveUrl } from './uploads.js';
import { EMBED_SANDBOX, HEIGHT_MESSAGE, clampHeight } from './tool-frame.js';

/** Every visible row for one ฝ่าย, in the order the editor arranged them. */
export async function loadDeptContent(dept) {
  const q = `/dept_content?dept=eq.${encodeURIComponent(dept)}`
    + '&select=id,kind,position,visible,title,eyebrow,description,href,cover_url,video_url,cta,html'
    + '&order=position.asc,created_at.asc';
  const { data, error } = await dbRest(q);
  if (error) return { rows: [], error };
  // An editor's own hidden rows come back too (RLS lets them read those on
  // purpose — ซ่อน must not mean "gone"). The PUBLIC page must not show them,
  // and filtering here rather than in the query keeps one request serving both
  // the page and the editor.
  return { rows: Array.isArray(data) ? data : [], error: null };
}

/** The announcement-style link card. Mirrors renderNewsCard in announcements.js
 *  so a ฝ่าย page reads like the ประกาศ listing rather than like a second app. */
export function renderContentCard(row) {
  const media = row.video_url
    ? `<video src="${escHtml(row.video_url)}" muted loop autoplay playsinline preload="metadata" aria-hidden="true"></video>`
    : (row.cover_url
      ? `<img src="${escHtml(convertDriveUrl(row.cover_url))}" alt="" loading="lazy">`
      : '');
  const body = `
      <div class="news-card-body">
        ${row.eyebrow ? `<span class="news-eyebrow">${escHtml(row.eyebrow)}</span>` : ''}
        <h4 class="news-card-title">${escHtml(row.title || '')}</h4>
        ${row.description ? `<p class="news-card-desc">${escHtml(row.description)}</p>` : ''}
        ${row.href ? `<div class="news-meta">
          <span class="news-meta-cta">${escHtml(row.cta || 'เปิดลิงก์')} <i class="bi bi-box-arrow-up-right"></i></span>
        </div>` : ''}
      </div>`;
  const inner = `${media ? `<div class="news-card-media">${media}</div>` : ''}${body}`;
  // A card with no link is a notice, not a dead <a>. An anchor with no href is
  // not keyboard-focusable and announces itself as a link that goes nowhere.
  return row.href
    ? `<a class="news-card" href="${escHtml(row.href)}" target="_blank" rel="noopener">${inner}</a>`
    : `<div class="news-card news-card-static">${inner}</div>`;
}

/**
 * A ฝ่าย's own HTML, isolated.
 *
 * `srcdoc` + a sandbox WITHOUT allow-same-origin puts this on an opaque origin.
 * The height arrives by postMessage exactly as a Lane-B tool's does, and until
 * it does the CSS floor keeps the block readable — there is no timer to misfire.
 */
export function renderContentHtml(row) {
  // The only escaping needed: srcdoc is an ATTRIBUTE, so a bare `"` inside the
  // ฝ่าย's HTML would end it early and the rest would be parsed as attributes
  // on the iframe. This is not sanitising — it is quoting.
  const doc = String(row.html || '')
    .replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  return `<iframe class="tool-frame dept-html" data-dept-html="${escHtml(row.id)}"`
    + ` sandbox="${EMBED_SANDBOX}" srcdoc="${doc}"`
    + ` title="เนื้อหาของฝ่าย" loading="lazy"></iframe>`;
}

/**
 * A SECTION HEADING (0179) — the thing a page of twelve cards was missing.
 *
 * Modelled on a Moodle course page, which the owner named as the reference:
 * a titled band with an optional line of summary, grouping everything that
 * follows it until the next one. It is a LABEL, never a link — a heading that
 * navigates somewhere is a different promise.
 */
export function renderContentSection(row) {
  return `<div class="dept-section">
      <h3 class="dept-section-title">${escHtml(row.title || '')}</h3>
      ${row.description ? `<p class="dept-section-sub">${escHtml(row.description)}</p>` : ''}
    </div>`;
}

/**
 * A PARAGRAPH (0179) — the missing middle between a form and writing HTML.
 *
 * Before this, a ฝ่าย wanting two sentences of explanation had to jump straight
 * to kind='html'. Newlines are honoured (`white-space: pre-line` in the CSS)
 * rather than parsed, so a ฝ่าย gets paragraphs without this becoming a second,
 * unsandboxed markup path — which is what "just let them use a bit of HTML
 * here" would quietly build.
 */
export function renderContentText(row) {
  return `<p class="dept-text">${escHtml(row.description || '')}</p>`;
}

export function renderDeptContent(rows) {
  const visible = (rows || []).filter((r) => r.visible !== false);
  if (!visible.length) return '';
  // Consecutive cards share one grid; anything full width breaks the run.
  // Rendering every card into its own grid would collapse the layout to one
  // column, which is what the first version did.
  const out = [];
  let run = [];
  const flush = () => {
    if (run.length) out.push(`<div class="news-grid news-grid--archive dept-cards">${run.join('')}</div>`);
    run = [];
  };
  // ⚠️ The default branch draws an UNKNOWN kind as a card. That is deliberate:
  // it is what makes 0179-style additions safe in either order against a
  // running app — a row of a kind this bundle has never heard of looks wrong,
  // never blank and never broken. Adding a kind means adding a case HERE, and
  // dept-content.test.js fails if the DDL knows a kind this function does not.
  for (const r of visible) {
    if (r.kind === 'html') { flush(); out.push(renderContentHtml(r)); }
    else if (r.kind === 'section') { flush(); out.push(renderContentSection(r)); }
    else if (r.kind === 'text') { flush(); out.push(renderContentText(r)); }
    else run.push(renderContentCard(r));
  }
  flush();
  return out.join('');
}

let listening = false;

/** Size every ฝ่าย HTML block from the height it reports. One listener for the
 *  life of the page — one per render is this repo's listener-accumulation bug. */
export function watchDeptHtmlHeights(doc = document) {
  if (listening) return;
  listening = true;
  window.addEventListener('message', (e) => {
    const frames = doc.querySelectorAll('iframe[data-dept-html]');
    for (const f of frames) {
      // Identity, not origin: every opaque frame's origin is the string "null",
      // so an origin check would accept any other frame on the page.
      if (e.source !== f.contentWindow) continue;
      if (!e.data || e.data.type !== HEIGHT_MESSAGE) return;
      const h = clampHeight(e.data.height);
      if (h === null) return;
      f.style.height = `${h}px`;
      f.style.minHeight = '0';
      return;
    }
  });
}
