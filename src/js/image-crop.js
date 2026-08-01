// ==============================================
// IMAGE-CROP — pan/zoom a picked photo into a fixed-ratio frame before upload.
//
// WHY THIS REPLACED จุดโฟกัสของรูป: the ทีม SAMO card is a 3:4 portrait but the
// studio shoots 3:2 landscape, so ~45% of the frame is thrown away. The old
// answer was a three-option select (กลาง / บน / ล่าง) that the admin had to
// guess at for every member, could only nudge vertically, and still had no idea
// what the card would look like. Cropping is the same decision made once,
// visually, with the actual result on screen.
//
// It also removes a cost: a 'top'/'bottom' member opted OUT of lh3's server-side
// crop and downloaded the full frame so CSS could crop it (~78 KB instead of
// ~38 KB per card). An image that is ALREADY 3:4 makes `=w-h-c-rw` an exact,
// lossless-framing crop for everyone — so every portrait now takes the cheap
// path and photo_focus is always 'center' for anything uploaded from here.
//
// `photo_focus` stays in the DB and in the render path: archived years and rows
// uploaded before this still carry 'top'/'bottom' and must keep rendering right.
// It is simply no longer something a human is asked about.
//
// The dialog builds its own DOM (no HTML partial) so it can be used from the
// admin app, the public app, or anything added later without a partial being
// wired into the right index.html — see mistakes.md on partials that nothing
// includes.
// ==============================================

import { downscaleImage, decode, drawStepped } from './image-resize.js';

/** height / width of the frame. 4/3 = the 3:4 portrait the org chart renders. */
const DEFAULT_RATIO = 4 / 3;
const MAX_ZOOM = 4;
/** Long edge of the produced file. Matches downscaleImage's cap so the crop
 *  output passes through uploadTeamPhoto's own downscale untouched. */
const MAX_EDGE = 2400;

const MODAL_ID = 'imgCropModal';

let els = null;          // cached DOM once built
let bmp = null;          // decoded source (ImageBitmap or HTMLImageElement)
let srcW = 0;
let srcH = 0;
let coverW = 0;          // image size, in CSS px, at zoom 1 (covers the frame)
let coverH = 0;
let frameW = 0;
let frameH = 0;
let zoom = 1;
let tx = 0;              // frame-centre → image-centre offset, CSS px
let ty = 0;
let settle = null;       // resolve() of the in-flight cropImage() promise
let outName = 'photo.webp';
let outRatio = DEFAULT_RATIO;

// ── DOM ─────────────────────────────────────────────────────────────────────

function build() {
  if (els) return els;
  const wrap = document.createElement('div');
  wrap.innerHTML = `
<div class="modal fade imgcrop-modal" id="${MODAL_ID}" tabindex="-1" aria-hidden="true">
  <div class="modal-dialog modal-dialog-centered">
    <div class="modal-content">
      <div class="modal-header">
        <h5 class="modal-title" id="imgCropTitle">ปรับกรอบรูป</h5>
        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="ปิด"></button>
      </div>
      <div class="modal-body">
        <div class="imgcrop-stage" id="imgCropStage">
          <img id="imgCropImg" alt="" draggable="false" />
          <div class="imgcrop-grid" aria-hidden="true"></div>
        </div>
        <div class="imgcrop-tools">
          <i class="bi bi-zoom-out" aria-hidden="true"></i>
          <input type="range" class="form-range" id="imgCropZoom"
            min="1" max="${MAX_ZOOM}" step="0.01" value="1" aria-label="ย่อ-ขยาย" />
          <i class="bi bi-zoom-in" aria-hidden="true"></i>
          <button type="button" class="btn btn-sm btn-outline-secondary" id="imgCropReset">รีเซ็ต</button>
        </div>
        <p class="imgcrop-hint" id="imgCropHint">ลากรูปเพื่อเลื่อน · ใช้แถบเลื่อนหรือหมุนเมาส์เพื่อย่อ-ขยาย</p>
      </div>
      <div class="modal-footer">
        <button type="button" class="btn btn-light" data-bs-dismiss="modal">ยกเลิก</button>
        <button type="button" class="btn btn-primary" id="imgCropConfirm">ใช้รูปนี้</button>
      </div>
    </div>
  </div>
</div>`;
  const root = wrap.firstElementChild;
  document.body.appendChild(root);
  els = {
    root,
    stage: root.querySelector('#imgCropStage'),
    img: root.querySelector('#imgCropImg'),
    zoom: root.querySelector('#imgCropZoom'),
    reset: root.querySelector('#imgCropReset'),
    confirm: root.querySelector('#imgCropConfirm'),
    title: root.querySelector('#imgCropTitle'),
    hint: root.querySelector('#imgCropHint'),
  };
  wire();
  return els;
}

function modal() {
  const el = build().root;
  return window.bootstrap ? window.bootstrap.Modal.getOrCreateInstance(el) : null;
}

// ── transform model ─────────────────────────────────────────────────────────
//
// `transform: translate(Tx,Ty) scale(z)` maps an image point p to Tx + z*p, so
// tx/ty are plain screen pixels and the two never interact. The image element is
// sized to coverW x coverH (the smallest size that covers the frame at zoom 1),
// which makes zoom === 1 exactly "no empty edges" and gives the slider a
// meaningful floor.

function clamp() {
  const maxX = Math.max(0, (coverW * zoom - frameW) / 2);
  const maxY = Math.max(0, (coverH * zoom - frameH) / 2);
  tx = Math.min(maxX, Math.max(-maxX, tx));
  ty = Math.min(maxY, Math.max(-maxY, ty));
}

function paint() {
  clamp();
  els.img.style.transform =
    `translate(-50%, -50%) translate(${tx}px, ${ty}px) scale(${zoom})`;
  els.zoom.value = String(zoom);
}

/** Zoom keeping the image point currently under (px, py) — screen coords
 *  relative to the frame CENTRE — pinned in place. */
function zoomAt(next, px = 0, py = 0) {
  const z = Math.min(MAX_ZOOM, Math.max(1, next));
  const qx = (px - tx) / zoom;
  const qy = (py - ty) / zoom;
  tx = px - qx * z;
  ty = py - qy * z;
  zoom = z;
  paint();
}

/** Measure the frame and size the image to cover it. Must run while the modal
 *  is visible — a display:none stage measures 0. */
function layout() {
  const r = els.stage.getBoundingClientRect();
  const prevCover = coverW;
  frameW = r.width;
  frameH = r.height;
  const k = Math.max(frameW / srcW, frameH / srcH);
  coverW = srcW * k;
  coverH = srcH * k;
  // tx/ty are screen pixels, so a rotate or window resize would otherwise
  // teleport the framing. Scale them with the image instead.
  if (prevCover) { const s = coverW / prevCover; tx *= s; ty *= s; }
  els.img.style.width = `${coverW}px`;
  els.img.style.height = `${coverH}px`;
  paint();
}

// ── interaction ─────────────────────────────────────────────────────────────

function wire() {
  const { stage, img, zoom: slider, reset, confirm, root } = els;

  // Pointer state. A Map keyed by pointerId is what makes one-finger pan and
  // two-finger pinch the same code path instead of two competing gestures.
  const pts = new Map();
  let pinch = null; // { dist, zoom, cx, cy }

  const centreOffset = (e) => {
    const r = stage.getBoundingClientRect();
    return { x: e.clientX - (r.left + r.width / 2), y: e.clientY - (r.top + r.height / 2) };
  };

  stage.addEventListener('pointerdown', (e) => {
    stage.setPointerCapture(e.pointerId);
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 2) {
      const [a, b] = [...pts.values()];
      const r = stage.getBoundingClientRect();
      pinch = {
        dist: Math.hypot(a.x - b.x, a.y - b.y) || 1,
        zoom,
        cx: (a.x + b.x) / 2 - (r.left + r.width / 2),
        cy: (a.y + b.y) / 2 - (r.top + r.height / 2),
      };
    }
    stage.classList.add('is-dragging');
  });

  stage.addEventListener('pointermove', (e) => {
    const prev = pts.get(e.pointerId);
    if (!prev) return;
    e.preventDefault();
    const dx = e.clientX - prev.x;
    const dy = e.clientY - prev.y;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size >= 2 && pinch) {
      const [a, b] = [...pts.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      zoomAt(pinch.zoom * (d / pinch.dist), pinch.cx, pinch.cy);
      return;
    }
    tx += dx;
    ty += dy;
    paint();
  });

  const release = (e) => {
    pts.delete(e.pointerId);
    if (pts.size < 2) pinch = null;
    if (!pts.size) stage.classList.remove('is-dragging');
  };
  stage.addEventListener('pointerup', release);
  stage.addEventListener('pointercancel', release);

  stage.addEventListener('wheel', (e) => {
    e.preventDefault();
    const { x, y } = centreOffset(e);
    zoomAt(zoom * (e.deltaY < 0 ? 1.12 : 1 / 1.12), x, y);
  }, { passive: false });

  slider.addEventListener('input', () => zoomAt(Number(slider.value)));
  reset.addEventListener('click', () => { zoom = 1; tx = 0; ty = 0; paint(); });
  img.addEventListener('dragstart', (e) => e.preventDefault());

  confirm.addEventListener('click', async () => {
    confirm.disabled = true;
    els.hint.textContent = 'กำลังตัดรูป…';
    try {
      const file = await render();
      finish(file);
      modal()?.hide();
    } catch (err) {
      els.hint.textContent = 'ตัดรูปไม่สำเร็จ: ' + (err?.message || err);
    } finally {
      confirm.disabled = false;
    }
  });

  // Measuring needs a laid-out stage, so wait for the modal to be shown.
  root.addEventListener('shown.bs.modal', layout);
  // Dismiss by ✕ / ยกเลิก / backdrop / Esc all land here. `finish` is a no-op
  // once already settled, so the confirm path above is unaffected.
  root.addEventListener('hidden.bs.modal', () => {
    finish(null);
    // Released here rather than in finish(): the confirm path calls finish()
    // BEFORE hide(), and revoking there would blank the image mid-fade.
    if (previewObjectUrl) {
      URL.revokeObjectURL(previewObjectUrl);
      previewObjectUrl = null;
      els.img.removeAttribute('src');
    }
  });
  window.addEventListener('resize', () => { if (root.classList.contains('show')) layout(); });
}

// ── output ──────────────────────────────────────────────────────────────────

function toBlob(canvas, mime, quality) {
  return new Promise((resolve) => canvas.toBlob(resolve, mime, quality));
}

/**
 * Map the on-screen frame back to source pixels.
 *
 * `k` is screen px per source px, so the frame (frameW x frameH screen px)
 * covers frameW/k x frameH/k of the original, centred on the image centre
 * displaced by the pan offset. Pure and exported so the one piece of arithmetic
 * that can silently produce a WRONG crop — no error, just the wrong part of the
 * photo — is unit-tested rather than eyeballed.
 *
 * `outH` is capped at MAX_EDGE and never upscales past what the crop actually
 * contains; `outW` follows from the ratio so the file is exactly the shape the
 * card renders.
 */
export function cropGeometry({ srcW, srcH, coverW, frameW, frameH, zoom, tx, ty, ratio, maxEdge = MAX_EDGE }) {
  const k = (coverW * zoom) / srcW;         // screen px per source px
  const sw = Math.min(srcW, frameW / k);
  const sh = Math.min(srcH, frameH / k);
  const sx = Math.max(0, Math.min(srcW - sw, srcW / 2 - tx / k - sw / 2));
  const sy = Math.max(0, Math.min(srcH - sh, srcH / 2 - ty / k - sh / 2));
  const outH = Math.max(1, Math.min(Math.round(sh), maxEdge));
  const outW = Math.max(1, Math.round(outH / ratio));
  return { sx, sy, sw, sh, outW, outH };
}

/**
 * Crop to `cropGeometry` and re-encode. Cropping first and resizing second
 * (rather than drawing straight to the output size) keeps drawStepped's 2x2
 * averaging, which is what stops hair and fabric turning into noise.
 */
async function render() {
  const { sx, sy, sw, sh, outW, outH } = cropGeometry({
    srcW, srcH, coverW, frameW, frameH, zoom, tx, ty, ratio: outRatio,
  });

  // Crop 1:1 into a scratch canvas, then let drawStepped do the downscale.
  const cut = document.createElement('canvas');
  cut.width = Math.max(1, Math.round(sw));
  cut.height = Math.max(1, Math.round(sh));
  const cctx = cut.getContext('2d');
  cctx.imageSmoothingEnabled = true;
  cctx.imageSmoothingQuality = 'high';
  cctx.drawImage(bmp, sx, sy, sw, sh, 0, 0, cut.width, cut.height);

  const out = drawStepped(cut, cut.width, cut.height, outW, outH);
  let blob = await toBlob(out, 'image/webp', 0.9);
  let ext = 'webp';
  // Safari < 14 and some Android WebViews have no WebP encoder and return null.
  if (!blob) { blob = await toBlob(out, 'image/jpeg', 0.92); ext = 'jpg'; }
  if (!blob) throw new Error('เบราว์เซอร์นี้ไม่รองรับการตัดรูป');

  const base = outName.replace(/\.[^.]+$/, '') || 'photo';
  return new File([blob], `${base}.${ext}`, { type: blob.type });
}

let previewObjectUrl = null;

/** Paint the decoded bitmap into an <img>-able blob URL, replacing any previous
 *  one. Revoking on replace (not on hide) keeps it alive for the whole dialog. */
async function previewUrl(source, w, h) {
  const view = document.createElement('canvas');
  view.width = w;
  view.height = h;
  view.getContext('2d').drawImage(source, 0, 0);
  const blob = await toBlob(view, 'image/webp', 0.92)
    || await toBlob(view, 'image/jpeg', 0.92);
  if (previewObjectUrl) URL.revokeObjectURL(previewObjectUrl);
  previewObjectUrl = blob ? URL.createObjectURL(blob) : null;
  return previewObjectUrl || '';
}

function finish(file) {
  const done = settle;
  settle = null;
  bmp?.close?.();
  bmp = null;
  if (done) done(file);
}

// ── public API ──────────────────────────────────────────────────────────────

/**
 * Show the crop dialog for `file` and resolve with a cropped File, or `null` if
 * the user cancelled (dismiss, Esc, backdrop — all of them).
 *
 * The source is downscaled to MAX_EDGE FIRST: it bounds the scratch canvas in
 * render() well under iOS Safari's ~16.7 Mpx limit, and a 4800px master is
 * pointless for an image the CDN never serves above 1200px anyway.
 */
export async function cropImage(file, { ratio = DEFAULT_RATIO, title, hint } = {}) {
  if (!file) return null;
  build();
  // A previous dialog that was still open would leave its promise dangling.
  finish(null);

  outRatio = ratio;
  outName = file.name || 'photo';
  els.stage.style.setProperty('--imgcrop-ratio', String(1 / ratio));
  if (title) els.title.textContent = title;
  els.hint.textContent = hint || 'ลากรูปเพื่อเลื่อน · ใช้แถบเลื่อนหรือหมุนเมาส์เพื่อย่อ-ขยาย';

  const small = await downscaleImage(file, { maxEdge: MAX_EDGE, quality: 0.92 });
  bmp = await decode(small);
  srcW = bmp.width || bmp.naturalWidth;
  srcH = bmp.height || bmp.naturalHeight;
  if (!srcW || !srcH) { bmp?.close?.(); bmp = null; throw new Error('ไม่สามารถอ่านไฟล์รูปได้'); }

  // <img> cannot take an ImageBitmap, so paint it through a canvas once. A blob
  // URL rather than toDataURL(): a 1800x2400 PNG data URL is a ~10 MB string
  // held in the DOM, which is a real cost on the phones this is used from.
  els.img.src = await previewUrl(bmp, srcW, srcH);

  zoom = 1; tx = 0; ty = 0;
  return new Promise((resolve) => {
    settle = resolve;
    modal()?.show();
    // Belt and braces: if the modal never fires `shown` (no bootstrap global),
    // resolve rather than hanging the caller's await forever.
    if (!window.bootstrap) finish(null);
  });
}
