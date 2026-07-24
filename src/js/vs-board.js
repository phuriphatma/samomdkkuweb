// vs-board.js — VitalSound PUBLIC "Problem" board (Phase 2b UI).
//
// The public face of the help desk: a browsable board of the canonical
// Problems SE has published, with a 👥 "เจอเหมือนกัน" (me-too) counter and a
// pseudonymous public discussion thread. Everything here reads ONLY the curated
// projection returned by the SECURITY DEFINER RPCs in migration 0072 — never a
// raw ticket. Untrusted text (public_title, public_note, comment bodies, aliases)
// is always escHtml'd on render: the RPCs return attacker-influenceable columns
// (see mistakes.md "anon-INSERTable table's text columns are attacker-controlled").
//
// Auth: browsing is anonymous; me-too + commenting require a signed-in (kkumail)
// user — the RPCs fail closed, and the UI prompts the sign-in modal.

import { dbRest } from './db.js';
import { escHtml } from './utils.js';
import { getUser as authGetUser } from './auth.js';
import { VS_PHASES, renderVsStepperByPhase } from './vs-tracking.js';

// ---- module state ----
let loaded = false;          // lazy-load guard (board loads on first show)
let categories = [];         // non-confidential, board-eligible categories
let currentSort = 'hot';
let currentCategory = null;  // null = ทั้งหมด
let searchTimer = null;
let currentQuery = '';
let openProblemId = null;

const PHASE_BADGE = ['bg-warning text-dark', 'bg-info text-dark', 'bg-primary', 'bg-success'];

// --------------------------------------------------
// Init — wire the lazy-load trigger fired by toggleVitalSoundMode().
// --------------------------------------------------
export function initVsBoard() {
  if (!document.getElementById('vsBoardSection')) return;
  const prime = () => { if (!loaded) { loaded = true; loadCategories().then(loadBoard); } };
  // Mode-radio switched to board (fired by toggleVitalSoundMode).
  window.addEventListener('vs-board-shown', prime);
  // Navigating INTO the VitalSound tab (board is the default-visible mode) —
  // any tab trigger for #pills-vitalsound (navbar or offcanvas) fires this.
  document.addEventListener('shown.bs.tab', (e) => {
    if (e.target?.getAttribute('data-bs-target') === '#pills-vitalsound'
        && document.getElementById('vsModeBoard')?.checked) prime();
  });
  // Already the active pane on load (deep link) → prime now.
  const pane = document.getElementById('pills-vitalsound');
  if (pane && pane.classList.contains('active')) prime();
}

// --------------------------------------------------
// Categories → filter chips
// --------------------------------------------------
async function loadCategories() {
  const { data, error } = await dbRest(
    '/vs_categories?select=id,label,icon,is_confidential,public_eligible&is_active=eq.true&order=sort_order.asc'
  );
  if (error || !Array.isArray(data)) { categories = []; return; }
  // Only categories that can actually appear on the public board.
  categories = data.filter((c) => !c.is_confidential && c.public_eligible);
  renderCategoryChips();
}

function renderCategoryChips() {
  const wrap = document.getElementById('vsBoardCats');
  if (!wrap) return;
  const chip = (id, label, icon) => {
    const active = currentCategory === id ? ' is-active' : '';
    const ic = icon ? `<i class="bi ${escHtml(icon)} me-1"></i>` : '';
    return `<button type="button" class="vs-cat-chip${active}" onclick="vsBoardCat(${id === null ? 'null' : `'${escHtml(id)}'`})">${ic}${escHtml(label)}</button>`;
  };
  wrap.innerHTML = chip(null, 'ทั้งหมด', 'bi-collection')
    + categories.map((c) => chip(c.id, c.label, c.icon)).join('');
}

// --------------------------------------------------
// Board list
// --------------------------------------------------
async function loadBoard() {
  const list = document.getElementById('vsBoardList');
  const empty = document.getElementById('vsBoardEmpty');
  if (!list) return;
  list.innerHTML = spinner();
  empty.classList.add('d-none');

  const { data, error } = await dbRest('/rpc/get_public_vs_board', {
    method: 'POST',
    body: { p_category: currentCategory, p_sort: currentSort, p_limit: 60 },
  });
  if (error) { list.innerHTML = errorNote('โหลดกระดานปัญหาไม่สำเร็จ'); return; }
  renderBoardList(Array.isArray(data) ? data : []);
}

function renderBoardList(rows) {
  const list = document.getElementById('vsBoardList');
  const empty = document.getElementById('vsBoardEmpty');
  if (!list) return;
  if (!rows.length) {
    list.innerHTML = '';
    document.getElementById('vsBoardEmptyMsg').textContent =
      currentQuery ? 'ไม่พบปัญหาที่ตรงกับคำค้นหา' : 'ยังไม่มีปัญหาที่เปิดเผยในขณะนี้';
    empty.classList.remove('d-none');
    return;
  }
  empty.classList.add('d-none');
  list.innerHTML = rows.map(cardHtml).join('');
}

function cardHtml(r) {
  const phase = Number(r.phase) || 0;
  const badge = PHASE_BADGE[phase] || PHASE_BADGE[0];
  const phaseLabel = VS_PHASES[phase]?.label || '';
  const cat = r.cat_label
    ? `<span class="vs-cat-chip vs-cat-chip-sm"><i class="bi ${escHtml(r.cat_icon || 'bi-tag')} me-1"></i>${escHtml(r.cat_label)}</span>`
    : '';
  const affected = Number(r.affected) || 1;
  const comments = r.comment_count != null ? Number(r.comment_count) : null;
  const following = r.following === true;
  const id = escHtml(r.canonical_id);
  return `<div class="col-12 col-md-6">
    <div class="vs-board-card" onclick="vsBoardOpen('${id}')">
      <div class="vs-board-card-top">
        ${cat}
        <span class="badge ${badge} rounded-pill vs-phase-pill">${escHtml(phaseLabel)}</span>
      </div>
      <div class="vs-board-title">${escHtml(r.public_title || '(ไม่มีหัวข้อ)')}</div>
      <div class="vs-board-card-foot">
        <button type="button" class="vs-metoo-btn${following ? ' is-on' : ''}"
          onclick="event.stopPropagation();vsBoardMeToo('${id}',this)">
          <i class="bi ${following ? 'bi-people-fill' : 'bi-people'}"></i>
          <span class="vs-metoo-count">${affected}</span> เจอเหมือนกัน
        </button>
        ${comments != null ? `<span class="vs-board-comments"><i class="bi bi-chat-dots me-1"></i>${comments}</span>` : ''}
      </div>
    </div>
  </div>`;
}

// --------------------------------------------------
// Controls (wired to window.* in main.js)
// --------------------------------------------------
export function vsBoardSetSort(sort) {
  currentSort = sort;
  currentQuery = ''; const s = document.getElementById('vsBoardSearch'); if (s) s.value = '';
  loadBoard();
}
export function vsBoardCat(id) {
  currentCategory = id;
  renderCategoryChips();
  if (currentQuery) runSearch(); else loadBoard();
}
export function vsBoardSearch(v) {
  currentQuery = (v || '').trim();
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => { currentQuery ? runSearch() : loadBoard(); }, 260);
}

async function runSearch() {
  const list = document.getElementById('vsBoardList');
  if (!list) return;
  list.innerHTML = spinner();
  const { data, error } = await dbRest('/rpc/search_public_vs', {
    method: 'POST',
    body: { p_query: currentQuery, p_limit: 30 },
  });
  if (error) { list.innerHTML = errorNote('ค้นหาไม่สำเร็จ'); return; }
  let rows = Array.isArray(data) ? data : [];
  if (currentCategory) rows = rows.filter((r) => r.category === currentCategory);
  renderBoardList(rows);
}

// --------------------------------------------------
// Problem detail
// --------------------------------------------------
export async function vsBoardOpen(id) {
  openProblemId = id;
  const listView = document.getElementById('vsBoardListView');
  const detail = document.getElementById('vsProblemDetail');
  const body = document.getElementById('vsProblemBody');
  listView.classList.add('d-none');
  detail.classList.remove('d-none');
  body.innerHTML = spinner();
  const { data, error } = await dbRest('/rpc/get_public_vs_problem', {
    method: 'POST', body: { p_id: id },
  });
  if (error || !data) { body.innerHTML = errorNote('ไม่พบเรื่องนี้ หรือถูกปิดการเปิดเผยแล้ว'); return; }
  renderProblemDetail(data);
}

export function vsBoardBack() {
  openProblemId = null;
  document.getElementById('vsProblemDetail').classList.add('d-none');
  document.getElementById('vsBoardListView').classList.remove('d-none');
  // refresh counts that may have changed; keep the user's search context
  if (currentQuery) runSearch(); else loadBoard();
}

function renderProblemDetail(p) {
  const body = document.getElementById('vsProblemBody');
  const phase = Number(p.phase) || 0;
  const cat = categories.find((c) => c.id === p.category);
  const affected = Number(p.affected) || 1;
  const following = p.following === true;
  const signedIn = !!authGetUser();
  const comments = Array.isArray(p.comments) ? p.comments : [];
  const id = escHtml(p.canonical_id);

  const note = p.public_note
    ? `<div class="vs-problem-note"><i class="bi bi-megaphone-fill me-1"></i>${escHtml(p.public_note)}</div>` : '';

  const composer = signedIn
    ? `<div class="vs-comment-composer">
         <textarea id="vsCommentInput" class="form-control form-control-sm" rows="2" maxlength="2000"
           placeholder="ร่วมแสดงความคิดเห็น (ไม่แสดงชื่อจริง)..."></textarea>
         <button type="button" class="btn btn-submit btn-sm mt-2" onclick="vsPostComment('${id}')">
           <i class="bi bi-send me-1"></i>ส่งความคิดเห็น</button>
       </div>`
    : `<div class="vs-comment-signin alert alert-light border small mb-0">
         <i class="bi bi-lock me-1"></i>เข้าสู่ระบบด้วย KKU Mail เพื่อร่วมแสดงความคิดเห็น
         <button type="button" class="btn btn-outline-secondary btn-sm ms-2"
           data-bs-toggle="modal" data-bs-target="#signinModal">เข้าสู่ระบบ</button>
       </div>`;

  body.innerHTML = `
    <div class="vs-problem-head">
      ${cat ? `<span class="vs-cat-chip vs-cat-chip-sm"><i class="bi ${escHtml(cat.icon || 'bi-tag')} me-1"></i>${escHtml(cat.label)}</span>` : ''}
      <h4 class="vs-problem-title mt-2">${escHtml(p.public_title || '(ไม่มีหัวข้อ)')}</h4>
    </div>
    <div class="vs-stepper-wrap my-4">${renderVsStepperByPhase(phase)}</div>
    ${note}
    <div class="vs-problem-actions">
      <button type="button" class="vs-metoo-btn vs-metoo-btn-lg${following ? ' is-on' : ''}"
        onclick="vsBoardMeToo('${id}',this)">
        <i class="bi ${following ? 'bi-people-fill' : 'bi-people'}"></i>
        <span class="vs-metoo-count">${affected}</span> คนเจอปัญหานี้เหมือนกัน
      </button>
    </div>
    <hr class="my-4">
    <h6 class="fw-bold mb-3"><i class="bi bi-chat-dots me-2"></i>ความคิดเห็น
      <span class="text-muted fw-normal">(${comments.length})</span></h6>
    <div class="vs-comment-list mb-3">
      ${comments.length ? comments.map(commentHtml).join('') : '<p class="text-muted small">ยังไม่มีความคิดเห็น เป็นคนแรกที่ร่วมพูดคุย</p>'}
    </div>
    ${composer}`;
}

function commentHtml(c) {
  const staff = c.is_staff === true;
  const alias = staff
    ? `<span class="vs-comment-alias is-staff"><i class="bi bi-patch-check-fill me-1"></i>${escHtml(c.alias || 'เจ้าหน้าที่')}</span>`
    : `<span class="vs-comment-alias">${escHtml(c.alias || 'นศ.')}</span>`;
  return `<div class="vs-comment${staff ? ' is-staff' : ''}">
    <div class="vs-comment-meta">${alias}</div>
    <div class="vs-comment-body">${escHtml(c.body || '')}</div>
  </div>`;
}

// --------------------------------------------------
// Actions — me-too + comment (require sign-in; RPCs fail closed)
// --------------------------------------------------
export async function vsBoardMeToo(id, btn) {
  if (!authGetUser()) { promptSignin(); return; }
  const on = btn.classList.contains('is-on');
  btn.disabled = true;
  const { data, error } = await dbRest(`/rpc/${on ? 'vs_remove_me_too' : 'vs_add_me_too'}`, {
    method: 'POST', body: { p_canonical: id },
  });
  btn.disabled = false;
  if (error) { return; }
  const count = Array.isArray(data) ? data[0] : data; // scalar RPC → number
  btn.classList.toggle('is-on', !on);
  const icon = btn.querySelector('i');
  if (icon) icon.className = `bi ${!on ? 'bi-people-fill' : 'bi-people'}`;
  const c = btn.querySelector('.vs-metoo-count');
  if (c && count != null) c.textContent = Number(count);
}

export async function vsPostComment(id) {
  if (!authGetUser()) { promptSignin(); return; }
  const input = document.getElementById('vsCommentInput');
  const body = (input?.value || '').trim();
  if (!body) return;
  const btn = document.querySelector('.vs-comment-composer .btn-submit');
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span>'; }
  const { error } = await dbRest('/rpc/vs_post_public_comment', {
    method: 'POST', body: { p_canonical: id, p_body: body },
  });
  if (error) {
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="bi bi-send me-1"></i>ส่งความคิดเห็น'; }
    const m = pgMsg(error);
    alert(/บ่อยเกินไป|ความยาว/.test(m) ? m : 'ส่งความคิดเห็นไม่สำเร็จ');
    return;
  }
  vsBoardOpen(id); // reload the thread
}

// dbRest sets error.message to the raw PostgREST body (often a JSON string);
// pull the human `message` field out for user-facing alerts (see mistakes.md).
function pgMsg(error) {
  const raw = error?.message || '';
  try { return JSON.parse(raw)?.message || raw; } catch { return raw; }
}

function promptSignin() {
  const el = document.getElementById('signinModal');
  if (el && window.bootstrap?.Modal) window.bootstrap.Modal.getOrCreateInstance(el).show();
}

// ---- tiny view helpers ----
function spinner() {
  return '<div class="col-12 text-center text-muted py-5"><span class="spinner-border spinner-border-sm me-2"></span>กำลังโหลด...</div>';
}
function errorNote(msg) {
  return `<div class="col-12 text-center text-danger py-4"><i class="bi bi-exclamation-triangle me-1"></i>${escHtml(msg)}</div>`;
}
