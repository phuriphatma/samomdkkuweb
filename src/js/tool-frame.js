// ============================================================
// tool-frame.js — the HOST for a Lane-B ฝ่าย tool. docs/DEPT-TOOLS.md §3.
//
// A ฝ่าย delivers one self-contained HTML file that works when you
// double-click it. It ships verbatim in `public/embed/<slug>/` and this module
// puts it on the site inside a sandboxed iframe, under the site's own chrome.
// Nothing about their file is rewritten, ported or reviewed as app code — that
// is the whole point of the lane, and the reason the port cost per tool is ~0.
//
// ⛔ THE SECURITY MODEL IS ONE MISSING ATTRIBUTE. `allow-same-origin` is
// deliberately absent from the sandbox, which puts the frame on an OPAQUE
// origin: it cannot touch the parent DOM, cannot read the Supabase session,
// cannot read cookies, and `localStorage` THROWS inside it. Everything else
// here is convenience; that omission is the isolation. A future refactor that
// "fixes" a frame by adding `allow-same-origin` deletes the entire model in one
// word, which is why `tool-frame.test.js` asserts the PROPERTY on the rendered
// markup rather than trusting the constant below.
//
// HEIGHT. The frame cannot be measured from here (cross-origin), so it reports
// its own height by postMessage and the host applies it. The origin of an
// opaque frame is the string "null", so ORIGIN CANNOT BE THE CHECK — the check
// is `event.source === iframe.contentWindow`, which is the frame's identity and
// cannot be forged by another window.
//
// ⚠️ §3 specified a 2-second timer that falls back to `min-height: 70vh`. This
// does it in CSS instead, with no timer: `.tool-frame` carries that min-height
// from the first paint, and a reported height replaces it. Same outcome, and it
// removes a whole failure shape this repo has paid for — a timer-driven
// fallback fires on the slow-but-working case, and one that cannot be withdrawn
// is worse than none (`docs/mistakes/frontend-ui.md`, the boot watchdog). Here
// there is nothing to withdraw: a late message is simply applied when it comes.
// ============================================================

/** The sandbox the frame runs under. Read the ⛔ note above before editing. */
export const EMBED_SANDBOX = 'allow-scripts allow-popups allow-popups-to-escape-sandbox allow-forms';

/** The message a tool posts to report its height. Also in the starter kit. */
export const HEIGHT_MESSAGE = 'samo-embed-height';

// A tool that reports a nonsense height must not be able to blow the layout up
// or collapse it. Both bounds are generous — the clamp is a sanity rail, not a
// design constraint.
export const MIN_HEIGHT_PX = 120;
export const MAX_HEIGHT_PX = 20000;

/** Where a tool's folder is served from. `public/` is copied to the web root. */
export const embedSrc = (slug) => `/embed/${slug}/`;

/**
 * The slug in an embed route, or null.
 * Accepts a trailing slash for the same reason pathToTab normalises one:
 * people paste `/tools/x/` far more often than the router used to survive.
 */
export function embedSlugFromPath(pathname) {
  const m = /^\/tools\/([a-z0-9][a-z0-9-]*)\/?$/.exec(pathname || '');
  return m ? m[1] : null;
}

/**
 * The frame markup for one registry entry.
 * A string, so the test can assert the sandbox on what is actually RENDERED.
 * @param {object} tool an entry from src/data/tools.js with kind:'embed'
 */
export function renderToolFrame(tool) {
  return `<iframe class="tool-frame" id="toolFrame"`
    + ` src="${embedSrc(tool.slug)}"`
    + ` sandbox="${EMBED_SANDBOX}"`
    + ` title="${String(tool.name).replace(/[<>&"]/g, '')}"`
    + ` loading="lazy"></iframe>`;
}

/**
 * Clamp a reported height into something that cannot break the page, or null
 * if the message did not carry a usable one.
 *
 * ⚠️ `null` is rejected EXPLICITLY. `Number(null)` is 0 — finite — so a tool
 * that posted `{height: null}` (an unmeasured element, a typo) would have been
 * clamped to the floor and treated as a real measurement, releasing the CSS
 * min-height and collapsing the frame to 120px. Found by the test asking for
 * it, not by reading the code.
 */
export function clampHeight(px) {
  if (px === null || px === undefined || px === '') return null;
  const n = Number(px);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.min(MAX_HEIGHT_PX, Math.max(MIN_HEIGHT_PX, Math.round(n)));
}

let listening = false;

/**
 * Show `tool` in the host pane, and keep the frame's height in step with it.
 *
 * Safe to call repeatedly with the same tool: the frame is only rebuilt when
 * the SLUG changes, so re-opening the page does not reload the tool and throw
 * away whatever the reader had typed into it. Calling it with a different tool
 * DOES rebuild — that path exists because two embed routes share one pane, and
 * Bootstrap fires no `shown.bs.tab` when the already-active tab is re-shown.
 */
export function mountToolFrame(tool, doc = document) {
  const host = doc.getElementById('toolFrameHost');
  if (!host || !tool) return;

  const title = doc.getElementById('toolFrameTitle');
  const desc = doc.getElementById('toolFrameDesc');
  if (title) title.textContent = tool.name || '';
  if (desc) desc.textContent = tool.desc || '';

  const current = host.querySelector('.tool-frame');
  if (!current || current.getAttribute('src') !== embedSrc(tool.slug)) {
    host.innerHTML = renderToolFrame(tool);
  }

  if (listening) return;
  listening = true;
  // ONE listener for the life of the page, reading the live frame each time.
  // A listener per mount is this repo's "one listener per re-render" bug
  // (`docs/mistakes/frontend-ui.md`): they accumulate and every message is
  // handled N times.
  window.addEventListener('message', (e) => {
    const frame = doc.getElementById('toolFrame');
    // Identity, not origin — an opaque frame's origin is the string "null",
    // which every other opaque frame also has.
    if (!frame || e.source !== frame.contentWindow) return;
    const data = e.data;
    if (!data || data.type !== HEIGHT_MESSAGE) return;
    const h = clampHeight(data.height);
    if (h === null) return;
    frame.style.height = `${h}px`;
    // Release the CSS floor only once a real measurement has arrived, so a
    // tool that never reports one keeps the 70vh window and scrolls inside it.
    frame.style.minHeight = '0';
  });
}
