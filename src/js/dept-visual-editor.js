// ============================================================
// dept-visual-editor.js — THE SPIKE. A visual editor for a ฝ่าย's HTML block.
//
// Reported, three times, of the หน้าฝ่าย form editor:
//   "it have to click เพิ่มหัวข้อ เพิ่มการ์ด and filll each, it is untuitive,
//    it should be like working with canva, powerpoint or something that more
//    like wysiwyg … you can look at example online like the wix.com cms system"
//
// ⚠️ THIS IS A SPIKE AND IT IS MEANT TO BE JUDGED, NOT EXTENDED. The block set
// below is deliberately small. If the feel is wrong, delete this file and the
// dependency; nothing else in the app knows it exists.
//
// WHY GrapesJS AND NOT Puck / Craft.js. Both are React-only —
// `peerDependencies: { react: "^18 || ^19" }`, checked on the registry — and
// this app is Vanilla JS + Vite + Bootstrap. GrapesJS is vanilla (its deps are
// backbone, underscore and codemirror), BSD-3, and outputs plain HTML + CSS.
//
// WHY IT COSTS ALMOST NOTHING ARCHITECTURALLY. GrapesJS emits HTML, and
// `kind:'html'` already exists: stored in `dept_content.html`, rendered verbatim
// into a sandboxed opaque-origin frame. So this is an EDITOR SWAP, not a new
// storage model, a new isolation model, or a new renderer. It writes into the
// textarea that is already there and the existing save path does the rest —
// this module performs no database write of its own, on purpose.
//
// ⛔ THE OUTPUT MUST BE SELF-CONTAINED, AND THIS IS THE THING THAT IS EASY TO
// GET WRONG. The block goes into `srcdoc` on a frame with NO allow-same-origin,
// so the document it lands in is BLANK: no Bootstrap, no site stylesheet, no
// fonts. A block built from Bootstrap classes would look perfect in this editor
// (which is inside the styled admin page) and completely unstyled on the real
// ฝ่าย page. Every block below therefore carries its own inline layout, and
// `wrapDocument()` prepends the base <style> and the height reporter.
//
// ⛔ AND NO MEDIA QUERIES IN THE BLOCKS. The columns stack by `flex-wrap` with a
// flex-basis, so a two-column row becomes one column on a phone with no
// breakpoint to get wrong. A non-designer cannot ship a laptop-only layout with
// these blocks, which was the whole objection to a free-position canvas.
// ============================================================

/** The GrapesJS build is ~1.1 MB. It is loaded on demand, from the admin bundle
 *  only — `dept-visual-editor.test.js` fails if it reaches the public entry. */
let editorPromise = null;

/**
 * The base stylesheet every ฝ่าย block inherits, and the height reporter.
 *
 * The reporter is the same contract `public/embed/starter/` uses
 * (`samo-embed-height`), measured on `document.body` and NOT on
 * `documentElement` — inside an iframe `documentElement` IS the frame, so
 * measuring it asks the host how tall the host made it and the block can never
 * shrink. That bug already shipped once, on the tool frame.
 */
export function wrapDocument(html, css) {
  return `<style>
  :root { color-scheme: light; }
  body {
    margin: 0; padding: 4px;
    font-family: 'Noto Sans Thai', system-ui, -apple-system, 'Segoe UI', sans-serif;
    color: #1f2933; line-height: 1.65;
  }
  img { max-width: 100%; height: auto; display: block; }
  a { color: #105922; }
  * { box-sizing: border-box; }
${css || ''}
</style>
${html || ''}
<script>
  // Tell the host how tall this block really is. body, never documentElement.
  (function () {
    function report() {
      parent.postMessage({
        type: 'samo-embed-height',
        height: Math.ceil(document.body.getBoundingClientRect().height),
      }, '*');
    }
    new ResizeObserver(report).observe(document.body);
    window.addEventListener('load', report);
  })();
</script>`;
}

/** Pull the author's HTML back out of a wrapped document, so re-opening the
 *  editor shows what they built rather than the wrapper around it. */
export function unwrapDocument(saved) {
  const s = String(saved || '');
  if (!s.includes('samo-embed-height')) return s;   // hand-written, leave alone
  return s
    .replace(/<style>[\s\S]*?<\/style>/, '')
    .replace(/<script>[\s\S]*?<\/script>/, '')
    .trim();
}

/**
 * THE BLOCK SET.
 *
 * Small on purpose — this is the spike. Every one is self-contained and stacks
 * on a phone without a media query. `flex: 1 1 260px` is the whole trick: below
 * about 560px there is no room for two, so they wrap.
 */
export const BLOCKS = [
  {
    id: 'samo-heading', label: 'หัวข้อ',
    content: '<h2 style="margin:0 0 8px;font-size:1.35rem;color:#105922">หัวข้อของฝ่าย</h2>',
  },
  {
    id: 'samo-text', label: 'ข้อความ',
    content: '<p style="margin:0 0 12px">พิมพ์ข้อความของฝ่ายที่นี่ กดสองครั้งเพื่อแก้</p>',
  },
  {
    id: 'samo-image', label: 'รูปภาพ',
    // A placeholder the author replaces by double-clicking; GrapesJS's asset
    // manager opens on an image component.
    content: { type: 'image', style: { width: '100%', margin: '0 0 12px' } },
  },
  {
    id: 'samo-button', label: 'ปุ่มลิงก์',
    content: '<a href="#" style="display:inline-block;padding:9px 18px;border-radius:8px;'
      + 'background:#105922;color:#fff;text-decoration:none;margin:0 0 12px">เปิดลิงก์</a>',
  },
  {
    id: 'samo-two', label: '2 คอลัมน์',
    content: '<div style="display:flex;flex-wrap:wrap;gap:16px;margin:0 0 12px">'
      + '<div style="flex:1 1 260px">คอลัมน์ซ้าย</div>'
      + '<div style="flex:1 1 260px">คอลัมน์ขวา</div></div>',
  },
  {
    id: 'samo-three', label: '3 คอลัมน์',
    content: '<div style="display:flex;flex-wrap:wrap;gap:16px;margin:0 0 12px">'
      + '<div style="flex:1 1 200px">คอลัมน์ 1</div>'
      + '<div style="flex:1 1 200px">คอลัมน์ 2</div>'
      + '<div style="flex:1 1 200px">คอลัมน์ 3</div></div>',
  },
  {
    id: 'samo-card', label: 'การ์ด',
    content: '<div style="border:1px solid #dee2e6;border-radius:12px;padding:16px;'
      + 'background:#fff;margin:0 0 12px">'
      + '<h3 style="margin:0 0 6px;font-size:1.05rem">หัวข้อการ์ด</h3>'
      + '<p style="margin:0;color:#5c6773">คำอธิบายสั้นๆ</p></div>',
  },
  {
    id: 'samo-divider', label: 'เส้นคั่น',
    content: '<hr style="border:0;border-top:1px solid #dee2e6;margin:20px 0">',
  },
];

/**
 * Open the visual editor over the page. Resolves with the HTML to store, or
 * `null` if the person cancelled.
 *
 * @param {string} initialHtml what the row holds today
 * @returns {Promise<string|null>}
 */
export async function openVisualEditor(initialHtml) {
  // Loaded here and nowhere else, so the ~1.1 MB never enters an entry bundle.
  if (!editorPromise) {
    editorPromise = Promise.all([
      import('grapesjs'),
      import('grapesjs/dist/css/grapes.min.css'),
    ]).then(([mod]) => mod.default || mod);
  }
  const grapesjs = await editorPromise;

  const overlay = document.createElement('div');
  overlay.className = 'dve-overlay';
  overlay.innerHTML = `
    <div class="dve-bar">
      <strong class="dve-title">แก้หน้าแบบเห็นภาพ</strong>
      <span class="dve-hint">ลากบล็อกจากขวามาวาง · ดับเบิลคลิกเพื่อแก้ข้อความ</span>
      <span class="dve-spacer"></span>
      <button type="button" class="btn btn-sm btn-outline-secondary" data-dve="cancel">ยกเลิก</button>
      <button type="button" class="btn btn-sm btn-primary" data-dve="save">
        <i class="bi bi-check-lg"></i> ใช้เนื้อหานี้
      </button>
    </div>
    <div class="dve-body"><div class="dve-canvas"></div></div>`;
  document.body.appendChild(overlay);
  document.body.classList.add('dve-open');

  const editor = grapesjs.init({
    container: overlay.querySelector('.dve-canvas'),
    height: '100%',
    width: 'auto',
    // ⛔ NEVER localStorage. GrapesJS defaults to autosaving into it, which
    // would make the editor's idea of the page outlive — and silently override
    // — what the database actually holds.
    storageManager: false,
    // The author's markup, minus the wrapper this module added last time.
    components: unwrapDocument(initialHtml) || '<p>เริ่มจากลากบล็อกจากทางขวามาวางที่นี่</p>',
    blockManager: { blocks: BLOCKS.map((b) => ({ ...b, category: 'บล็อกของฝ่าย' })) },
    // ⚠️ MOBILE FIRST, and that is the ORDER not just the list — GrapesJS opens
    // on the first device. Most of this site's traffic is phones, and a ฝ่าย who
    // never switches width is the person this defends against.
    deviceManager: {
      devices: [
        { id: 'mobile', name: 'มือถือ', width: '390px', widthMedia: '575px' },
        { id: 'tablet', name: 'แท็บเล็ต', width: '768px', widthMedia: '991px' },
        { id: 'desktop', name: 'คอมพิวเตอร์', width: '', widthMedia: '' },
      ],
    },
  });

  // ⛔ OPEN THE BLOCKS PANEL. GrapesJS hides it behind an icon by default, so
  // the first thing a ฝ่าย sees is an empty canvas and a Style Manager saying
  // "Select an element" — which IS the complaint this spike exists to answer:
  // "it is untuitive". Found by screenshotting it, not by reading the docs.
  // The blocks are the only thing on screen that says what to do next.
  try {
    editor.Panels.getButton('views', 'open-blocks')?.set('active', true);
  } catch { /* a panel id GrapesJS renamed — the icon still works */ }

  return new Promise((resolve) => {
    const close = (value) => {
      editor.destroy();
      overlay.remove();
      document.body.classList.remove('dve-open');
      resolve(value);
    };
    overlay.addEventListener('click', (e) => {
      if (e.target.closest('[data-dve="cancel"]')) close(null);
      else if (e.target.closest('[data-dve="save"]')) {
        // getCss() carries whatever the style manager produced; the blocks
        // themselves are inline-styled, so this is usually small or empty.
        close(wrapDocument(editor.getHtml(), editor.getCss()));
      }
    });
  });
}
