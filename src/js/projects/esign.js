// ==============================================
// PROJECTS ESIGN — in-browser PDF signing
//
// signPdf({ driveFileId, fileName }) opens the e-sign modal:
//   1. fetches the original PDF bytes via GAS (Drive blocks direct browser
//      fetch — CORS; getProjectFileData round-trips through GAS),
//   2. renders pages with pdf.js so the prof can navigate,
//   3. lets the prof draw a signature on a pad, then drag/resize it onto
//      the page,
//   4. embeds the signature PNG at the mapped PDF coordinates with pdf-lib
//      and resolves with a signed-PDF Blob (or null if cancelled).
//
// Coordinate mapping uses page-relative RATIOS (placement position / page
// size) so it's independent of the on-screen render scale. pdf-lib's origin
// is bottom-left; pdf.js / the DOM is top-left — we flip Y at embed time.
// ==============================================

import * as pdfjsLib from 'pdfjs-dist';
import PdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { PDFDocument } from 'pdf-lib';
import { getProjectFileData } from './uploads.js';

pdfjsLib.GlobalWorkerOptions.workerSrc = PdfWorker;

let wired = false;
let modal = null;
let els = {};

// per-session signing state
let resolver = null;
let settled = false;
let originalBytes = null;   // Uint8Array of the source PDF
let pdf = null;             // pdfjs document
let numPages = 0;
let currentPage = 1;
let sigDataUrl = null;      // trimmed signature PNG (data URL)
// Per-page placements: pageNum -> { xRatio, yRatio, wRatio, aspect } (page-
// relative ratios so they're render-scale independent). A page is "signed"
// iff it has an entry — the prof can stamp the signature on as many pages as
// they like, and embed runs over every entry at confirm time.
let placements = new Map();

// drawing-pad state
let padDrawing = false;
let padHasInk = false;
let padCtx = null;

function b64ToBytes(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function wire() {
  if (wired) return;
  const el = document.getElementById('projectEsignModal');
  if (!el) return;
  wired = true;
  modal = window.bootstrap?.Modal.getOrCreateInstance(el);
  els = {
    root: el,
    loading: document.getElementById('esignLoading'),
    error: document.getElementById('esignError'),
    work: document.getElementById('esignWork'),
    stage: document.getElementById('esignStage'),
    canvas: document.getElementById('esignPageCanvas'),
    overlay: document.getElementById('esignSigOverlay'),
    prev: document.getElementById('esignPrev'),
    next: document.getElementById('esignNext'),
    pageLabel: document.getElementById('esignPageLabel'),
    sizeWrap: document.getElementById('esignSizeWrap'),
    size: document.getElementById('esignSize'),
    pad: document.getElementById('esignPad'),
    clearPad: document.getElementById('esignClearPad'),
    useSig: document.getElementById('esignUseSig'),
    confirm: document.getElementById('esignConfirm'),
    pageControls: document.getElementById('esignPageControls'),
    thisPage: document.getElementById('esignThisPage'),
    thisPageLabel: document.getElementById('esignThisPageLabel'),
    allPages: document.getElementById('esignAllPages'),
    signedCount: document.getElementById('esignSignedCount'),
  };

  els.prev?.addEventListener('click', () => gotoPage(currentPage - 1));
  els.next?.addEventListener('click', () => gotoPage(currentPage + 1));
  els.clearPad?.addEventListener('click', clearPad);
  els.useSig?.addEventListener('click', useSignature);
  els.confirm?.addEventListener('click', onConfirm);
  els.thisPage?.addEventListener('click', toggleThisPage);
  els.allPages?.addEventListener('click', signAllPages);
  els.size?.addEventListener('input', () => {
    if (els.overlay && !els.overlay.classList.contains('d-none')) {
      els.overlay.style.width = `${els.size.value}px`;
      els.overlay.style.height = 'auto';
      clampOverlay();
      capturePlacement();   // resizing updates this page's placement
      updateSignControls();
    }
  });

  setupPad();
  setupOverlayDrag();

  // Close without confirming → resolve(null).
  el.addEventListener('hidden.bs.modal', () => finish(null));
}

// ---------- signature pad (pointer drawing on a transparent canvas) ----------

function setupPad() {
  const pad = els.pad;
  if (!pad) return;
  padCtx = pad.getContext('2d');
  padCtx.lineWidth = 2.4;
  padCtx.lineCap = 'round';
  padCtx.lineJoin = 'round';
  padCtx.strokeStyle = '#11243a';

  const pos = (e) => {
    const r = pad.getBoundingClientRect();
    return { x: (e.clientX - r.left) * (pad.width / r.width), y: (e.clientY - r.top) * (pad.height / r.height) };
  };
  pad.addEventListener('pointerdown', (e) => {
    padDrawing = true;
    pad.setPointerCapture(e.pointerId);
    const p = pos(e);
    padCtx.beginPath();
    padCtx.moveTo(p.x, p.y);
  });
  pad.addEventListener('pointermove', (e) => {
    if (!padDrawing) return;
    const p = pos(e);
    padCtx.lineTo(p.x, p.y);
    padCtx.stroke();
    padHasInk = true;
  });
  const stop = () => { padDrawing = false; };
  pad.addEventListener('pointerup', stop);
  pad.addEventListener('pointerleave', stop);
  pad.addEventListener('pointercancel', stop);
}

function clearPad() {
  if (!padCtx || !els.pad) return;
  padCtx.clearRect(0, 0, els.pad.width, els.pad.height);
  padHasInk = false;
}

/** Crop the pad to the ink bounding box → tight transparent PNG data URL.
 *  Returns null when the pad is empty. */
function trimmedSignature() {
  const pad = els.pad;
  const img = padCtx.getImageData(0, 0, pad.width, pad.height);
  const { data, width, height } = img;
  let minX = width, minY = height, maxX = 0, maxY = 0, found = false;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > 8) {
        found = true;
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
  }
  if (!found) return null;
  const pad2 = 6;
  minX = Math.max(0, minX - pad2); minY = Math.max(0, minY - pad2);
  maxX = Math.min(width - 1, maxX + pad2); maxY = Math.min(height - 1, maxY + pad2);
  const w = maxX - minX + 1, h = maxY - minY + 1;
  const out = document.createElement('canvas');
  out.width = w; out.height = h;
  out.getContext('2d').putImageData(padCtx.getImageData(minX, minY, w, h), 0, 0);
  return out.toDataURL('image/png');
}

function useSignature() {
  if (!padHasInk) { alert('กรุณาวาดลายเซ็นก่อน'); return; }
  sigDataUrl = trimmedSignature();
  if (!sigDataUrl) { alert('ไม่พบลายเซ็น ลองวาดใหม่อีกครั้ง'); return; }
  const o = els.overlay;
  o.src = sigDataUrl;
  o.classList.remove('d-none');
  o.style.width = `${els.size?.value || 170}px`;
  o.style.height = 'auto';
  // Drop it roughly centered on the visible page.
  o.style.left = `${Math.max(0, (els.canvas.clientWidth - o.clientWidth) / 2)}px`;
  o.style.top = `${Math.max(0, (els.canvas.clientHeight - o.clientHeight) / 2)}px`;
  els.sizeWrap?.classList.remove('d-none');
  els.pageControls?.classList.remove('d-none');
  if (document.getElementById('esignHint')) {
    document.getElementById('esignHint').textContent = 'ลากลายเซ็นไปยังตำแหน่งที่ต้องการ • ใช้ "ทุกหน้า" เพื่อลงทุกหน้า แล้วกด "ยืนยันลงนาม"';
  }
  // overlay clientHeight is only valid after the image loads — capture the
  // placement once it's measurable.
  o.onload = () => { clampOverlay(); capturePlacement(); updateSignControls(); };
  clampOverlay();
  capturePlacement();        // stamps the current page as signed
  updateSignControls();
}

// ---------- per-page placement bookkeeping ----------

/** Current overlay position as page-relative ratios, or null if hidden. */
function currentRatios() {
  const o = els.overlay, c = els.canvas;
  if (!o || !c || o.classList.contains('d-none')) return null;
  const cw = c.clientWidth, ch = c.clientHeight;
  if (!cw || !ch) return null;
  return {
    xRatio: o.offsetLeft / cw,
    yRatio: o.offsetTop / ch,
    wRatio: o.clientWidth / cw,
    aspect: o.clientHeight / o.clientWidth,
  };
}

/** Persist the overlay's current spot as this page's placement. */
function capturePlacement() {
  const r = currentRatios();
  if (r) placements.set(currentPage, r);
}

/** Show/hide + position the overlay for page n from its stored placement. */
function restoreOverlayForPage(n) {
  const o = els.overlay, c = els.canvas;
  if (!o || !c) return;
  const p = placements.get(n);
  if (!p || !sigDataUrl) { o.classList.add('d-none'); return; }
  o.src = sigDataUrl;
  o.classList.remove('d-none');
  o.style.width = `${p.wRatio * c.clientWidth}px`;
  o.style.height = 'auto';
  o.style.left = `${p.xRatio * c.clientWidth}px`;
  o.style.top = `${p.yRatio * c.clientHeight}px`;
  clampOverlay();
}

/** Drop the signature on the current page at a sensible default position
 *  (reuse the last placement's ratios if any, else centre). */
function placeOnCurrentPage() {
  const o = els.overlay, c = els.canvas;
  if (!o || !c || !sigDataUrl) return;
  const ref = placements.values().next().value;  // any existing placement
  o.src = sigDataUrl;
  o.classList.remove('d-none');
  o.style.width = `${ref ? ref.wRatio * c.clientWidth : (els.size?.value || 170)}px`;
  o.style.height = 'auto';
  if (ref) {
    o.style.left = `${ref.xRatio * c.clientWidth}px`;
    o.style.top = `${ref.yRatio * c.clientHeight}px`;
  } else {
    o.style.left = `${Math.max(0, (c.clientWidth - o.clientWidth) / 2)}px`;
    o.style.top = `${Math.max(0, (c.clientHeight - o.clientHeight) / 2)}px`;
  }
  clampOverlay();
  capturePlacement();
}

/** Toggle whether the current page carries the signature. */
function toggleThisPage() {
  if (!sigDataUrl) { alert('วาดลายเซ็นและกด "ใช้ลายเซ็นนี้" ก่อน'); return; }
  if (placements.has(currentPage)) {
    placements.delete(currentPage);
    els.overlay?.classList.add('d-none');
  } else {
    placeOnCurrentPage();
  }
  updateSignControls();
}

/** Stamp every page at the current page's (or any) placement ratios. */
function signAllPages() {
  if (!sigDataUrl) { alert('วาดลายเซ็นและกด "ใช้ลายเซ็นนี้" ก่อน'); return; }
  capturePlacement();
  const ref = placements.get(currentPage) || placements.values().next().value;
  if (!ref) { placeOnCurrentPage(); }
  const base = placements.get(currentPage) || placements.values().next().value;
  if (!base) return;
  for (let n = 1; n <= numPages; n++) placements.set(n, { ...base });
  restoreOverlayForPage(currentPage);
  updateSignControls();
}

/** Sync the toolbar (confirm enabled, this-page label, signed-page count). */
function updateSignControls() {
  const signed = placements.size;
  if (els.confirm) els.confirm.disabled = signed === 0;
  if (els.thisPage && els.thisPageLabel) {
    const on = placements.has(currentPage);
    els.thisPageLabel.textContent = on ? 'เอาออกจากหน้านี้' : 'ลงนามหน้านี้';
    els.thisPage.classList.toggle('btn-primary-soft', !on);
    els.thisPage.classList.toggle('btn-danger-soft', on);
  }
  if (els.signedCount) {
    els.signedCount.textContent = signed ? `ลงแล้ว ${signed} หน้า` : '';
  }
}

// ---------- drag the signature overlay over the page ----------

function setupOverlayDrag() {
  const o = els.overlay;
  if (!o) return;
  let dragging = false;
  let sx = 0, sy = 0, ol = 0, ot = 0;
  o.addEventListener('pointerdown', (e) => {
    dragging = true;
    o.setPointerCapture(e.pointerId);
    sx = e.clientX; sy = e.clientY;
    ol = o.offsetLeft; ot = o.offsetTop;
    e.preventDefault();
  });
  o.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    o.style.left = `${ol + (e.clientX - sx)}px`;
    o.style.top = `${ot + (e.clientY - sy)}px`;
    clampOverlay();
  });
  const stop = () => {
    if (dragging) { dragging = false; capturePlacement(); updateSignControls(); }
  };
  o.addEventListener('pointerup', stop);
  o.addEventListener('pointercancel', stop);
}

function clampOverlay() {
  const o = els.overlay, c = els.canvas;
  if (!o || !c) return;
  const maxL = Math.max(0, c.clientWidth - o.clientWidth);
  const maxT = Math.max(0, c.clientHeight - o.clientHeight);
  o.style.left = `${Math.min(Math.max(0, o.offsetLeft), maxL)}px`;
  o.style.top = `${Math.min(Math.max(0, o.offsetTop), maxT)}px`;
}

// ---------- pdf.js rendering ----------

async function gotoPage(n) {
  if (!pdf || n < 1 || n > numPages) return;
  capturePlacement();            // save the page we're leaving
  currentPage = n;
  await renderPage(n);
  restoreOverlayForPage(n);      // show the signature if this page has one
  updateSignControls();
}

async function renderPage(n) {
  const page = await pdf.getPage(n);
  const stageW = Math.max(280, els.stage.clientWidth || 600);
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(stageW / base.width, 2);
  const viewport = page.getViewport({ scale });
  const canvas = els.canvas;
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  canvas.style.width = `${viewport.width}px`;
  canvas.style.height = `${viewport.height}px`;
  await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
  els.pageLabel.textContent = `${n} / ${numPages}`;
  els.prev.disabled = n <= 1;
  els.next.disabled = n >= numPages;
  clampOverlay();
}

// ---------- confirm: embed with pdf-lib ----------

async function onConfirm() {
  capturePlacement();   // make sure the page currently shown is included
  if (!sigDataUrl || placements.size === 0) { alert('กรุณาวางลายเซ็นบนเอกสารก่อน'); return; }
  const btn = els.confirm;
  const orig = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>กำลังลงนาม…';
  try {
    const doc = await PDFDocument.load(originalBytes);
    const png = await doc.embedPng(sigDataUrl);
    const pages = doc.getPages();
    // Embed the signature on EVERY page the prof placed it on.
    for (const [pageNum, p] of placements.entries()) {
      const page = pages[pageNum - 1];
      if (!page) continue;
      const { width: pw, height: ph } = page.getSize();
      const w = p.wRatio * pw;
      const h = w * p.aspect;
      const x = p.xRatio * pw;
      const yTop = p.yRatio * ph;
      page.drawImage(png, { x, y: ph - yTop - h, width: w, height: h });
    }
    const out = await doc.save();
    const blob = new Blob([out], { type: 'application/pdf' });
    finish(blob);
    modal?.hide();
  } catch (err) {
    btn.disabled = false;
    btn.innerHTML = orig;
    alert(err.message || 'ลงนามไม่สำเร็จ');
  }
}

function resetState() {
  settled = false;
  originalBytes = null;
  pdf = null;
  numPages = 0;
  currentPage = 1;
  sigDataUrl = null;
  placements = new Map();
  padHasInk = false;
  if (els.overlay) { els.overlay.classList.add('d-none'); els.overlay.removeAttribute('src'); }
  els.sizeWrap?.classList.add('d-none');
  els.pageControls?.classList.add('d-none');
  if (els.signedCount) els.signedCount.textContent = '';
  if (els.confirm) els.confirm.disabled = true;
  if (els.confirm) els.confirm.innerHTML = '<i class="bi bi-pen me-1"></i> ยืนยันลงนาม';
  els.work?.classList.add('d-none');
  els.error?.classList.add('d-none');
  els.loading?.classList.remove('d-none');
  clearPad();
}

function finish(result) {
  if (settled) return;
  settled = true;
  const r = resolver;
  resolver = null;
  if (r) r(result);
}

/**
 * Open the e-sign modal for a PDF and resolve with a signed-PDF Blob,
 * or null if the user cancels.
 * @param {{ driveFileId: string, fileName?: string }} opts
 * @returns {Promise<Blob|null>}
 */
export function signPdf({ driveFileId, fileName } = {}) {
  wire();
  if (!modal) return Promise.resolve(null);
  return new Promise(async (resolve) => {
    resolver = resolve;
    resetState();
    modal.show();
    try {
      const data = await getProjectFileData(driveFileId);
      originalBytes = b64ToBytes(data.base64);
      // pdf.js consumes the buffer (transfers it) — hand it a copy so the
      // pristine bytes survive for pdf-lib at embed time.
      pdf = await pdfjsLib.getDocument({ data: originalBytes.slice() }).promise;
      numPages = pdf.numPages;
      currentPage = 1;
      els.loading?.classList.add('d-none');
      els.work?.classList.remove('d-none');
      await renderPage(1);
    } catch (err) {
      if (els.loading) els.loading.classList.add('d-none');
      if (els.error) {
        els.error.classList.remove('d-none');
        els.error.textContent = err.message || 'โหลดเอกสารไม่สำเร็จ';
      }
    }
  });
}
