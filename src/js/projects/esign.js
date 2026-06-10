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
let placed = false;         // signature has been dropped on the page

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
  };

  els.prev?.addEventListener('click', () => gotoPage(currentPage - 1));
  els.next?.addEventListener('click', () => gotoPage(currentPage + 1));
  els.clearPad?.addEventListener('click', clearPad);
  els.useSig?.addEventListener('click', useSignature);
  els.confirm?.addEventListener('click', onConfirm);
  els.size?.addEventListener('input', () => {
    if (els.overlay && !els.overlay.classList.contains('d-none')) {
      els.overlay.style.width = `${els.size.value}px`;
      els.overlay.style.height = 'auto';
      clampOverlay();
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
  placed = true;
  els.sizeWrap?.classList.remove('d-none');
  els.confirm.disabled = false;
  if (document.getElementById('esignHint')) {
    document.getElementById('esignHint').textContent = 'ลากลายเซ็นไปยังตำแหน่งที่ต้องการ แล้วกด "ยืนยันลงนาม"';
  }
  // overlay clientHeight is only valid after the image loads
  o.onload = () => clampOverlay();
  clampOverlay();
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
  const stop = () => { dragging = false; };
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
  currentPage = n;
  await renderPage(n);
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
  if (!placed || !sigDataUrl) { alert('กรุณาวางลายเซ็นบนเอกสารก่อน'); return; }
  const btn = els.confirm;
  const orig = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>กำลังลงนาม…';
  try {
    const o = els.overlay, c = els.canvas;
    const cw = c.clientWidth, ch = c.clientHeight;
    const xRatio = o.offsetLeft / cw;
    const yRatio = o.offsetTop / ch;
    const wRatio = o.clientWidth / cw;
    const sigAspect = o.clientHeight / o.clientWidth;

    const doc = await PDFDocument.load(originalBytes);
    const png = await doc.embedPng(sigDataUrl);
    const pages = doc.getPages();
    const page = pages[currentPage - 1];
    const { width: pw, height: ph } = page.getSize();
    const w = wRatio * pw;
    const h = w * sigAspect;
    const x = xRatio * pw;
    const yTop = yRatio * ph;
    page.drawImage(png, { x, y: ph - yTop - h, width: w, height: h });
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
  placed = false;
  padHasInk = false;
  if (els.overlay) { els.overlay.classList.add('d-none'); els.overlay.removeAttribute('src'); }
  els.sizeWrap?.classList.add('d-none');
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
