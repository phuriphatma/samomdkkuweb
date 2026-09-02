// ============================================================
// dept-page-admin.js — the screen where a ฝ่าย edits its OWN page.
//
// THE POINT OF IT. Before 0177, ฝ่าย page content was a hardcoded object and
// every change was a commit plus a deploy by the owner. This is the half that
// removes the owner from that loop: the ฝ่าย adds a card or writes HTML, saves,
// and the page is live. No branch, no pull request, no deploy.
//
// WHAT IT DOES NOT DECIDE. Which ฝ่าย you may edit is not a question this file
// answers — `current_user_dept_page_scope()` does, in the database, and RLS
// enforces it on every write. The picker below is populated from the same
// scope, so the UI cannot offer a ฝ่าย the database would refuse. That
// direction matters: UNDER-showing relative to RLS is safe, the reverse is a
// button that throws.
//
// ⛔ HTML IS NEVER PREVIEWED WITH innerHTML. The preview is the same sandboxed
// srcdoc frame the live page uses (dept-content.js), so what the editor sees is
// what a visitor sees, under the same isolation. Rendering the draft into the
// admin DOM "just to preview it" would hand the whole admin session to whatever
// the editor pasted — and it is the natural shortcut, which is why it is
// called out here and guarded in dept-content.test.js.
// ============================================================

import { dbRest } from './db.js';
import { escHtml } from './utils.js';
import { DEPT_OPTIONS, deptLabel } from '../data/depts.js';
import { renderDeptContent, watchDeptHtmlHeights } from './dept-content.js';
import { restErrorMessage } from './rest-error.js';

/** One Thai sentence for a failed call. `restErrorMessage` takes the RAW
 *  response, not the parsed object dbRest hands back, so the unwrapping happens
 *  here rather than four times at the call sites — and the raw JSON body never
 *  reaches a person, which is the rule rest-error.js exists to hold.  */
const errMsg = (error, fallback) =>
  `${fallback}: ${restErrorMessage(error?.status ?? 0, error?.raw || '')}`;

const SELECT = 'id,dept,kind,position,visible,title,eyebrow,description,href,'
  + 'cover_url,video_url,cta,html,updated_at';

let state = { dept: null, rows: [], busy: false };

/** The ฝ่าย this account may edit. `null` scope (every ฝ่าย) is the blanket
 *  grant; otherwise exactly the granted list, in the site's own page order. */
export function editableDepts(user) {
  if (!user) return [];
  const blanket = user.role === 'dev' || user.role === 'vp_admin'
    || (user.permissions || []).includes('master')
    || (user.managedPermissions || []).includes('master')
    || (user.permissions || []).includes('dept_pages')
    || (user.managedPermissions || []).includes('dept_pages');
  if (blanket) return DEPT_OPTIONS.slice();
  const mine = new Set(user.managedDeptPages || []);
  return DEPT_OPTIONS.filter((d) => mine.has(d.value));
}

async function load(dept) {
  const { data, error } = await dbRest(
    `/dept_content?dept=eq.${encodeURIComponent(dept)}&select=${SELECT}&order=position.asc,created_at.asc`);
  if (error) return { rows: [], error };
  return { rows: Array.isArray(data) ? data : [], error: null };
}

function rowEditor(r) {
  const isHtml = r.kind === 'html';
  return `
  <div class="dpa-row${r.visible === false ? ' dpa-hidden' : ''}" data-dpa-row="${escHtml(r.id)}">
    <div class="dpa-row-head">
      <span class="dpa-kind">${isHtml ? 'HTML' : 'การ์ด'}</span>
      <!-- The badge already says HTML, so repeating it in the title read
           "HTML บล็อก HTML" on screen. An html row shows its own title if the
           ฝ่าย gave it one, and otherwise nothing. -->
      <span class="dpa-title">${escHtml(r.title || '')}</span>
      <!-- Hidden is now the state a row is BORN in, so it cannot be signalled by
           opacity and a button label alone — a ฝ่าย who adds a card, does not
           find it in the preview beside them, and has no word for why, concludes
           the feature is broken. Say it. -->
      ${r.visible === false ? '<span class="dpa-draft">ยังไม่แสดง</span>' : ''}
      <span class="dpa-spacer"></span>
      <button type="button" class="btn btn-sm btn-outline-secondary" data-dpa-move="up"   title="เลื่อนขึ้น"><i class="bi bi-arrow-up"></i></button>
      <button type="button" class="btn btn-sm btn-outline-secondary" data-dpa-move="down" title="เลื่อนลง"><i class="bi bi-arrow-down"></i></button>
      <button type="button" class="btn btn-sm btn-outline-secondary" data-dpa-toggle>${r.visible === false ? 'แสดง' : 'ซ่อน'}</button>
      <button type="button" class="btn btn-sm btn-outline-danger" data-dpa-delete>ลบ</button>
    </div>
    ${isHtml ? `
      <label class="form-label small mt-2">HTML ของฝ่าย</label>
      <textarea class="form-control font-monospace dpa-html" rows="10" data-dpa-field="html">${escHtml(r.html || '')}</textarea>
      <p class="form-text">
        เขียน HTML/CSS/JavaScript ได้ตามต้องการ หน้านี้ถูกกันออกจากระบบหลัก
        จึงอ่านข้อมูลผู้ใช้หรือฐานข้อมูลไม่ได้ และใช้ localStorage ไม่ได้
      </p>` : `
      <div class="row g-2 mt-1">
        <div class="col-12 col-md-3"><label class="form-label small">ป้ายเล็ก</label>
          <input class="form-control" data-dpa-field="eyebrow" value="${escHtml(r.eyebrow || '')}" placeholder="Guidebook"></div>
        <div class="col-12 col-md-9"><label class="form-label small">หัวข้อ</label>
          <input class="form-control" data-dpa-field="title" value="${escHtml(r.title || '')}"></div>
        <div class="col-12"><label class="form-label small">คำอธิบาย</label>
          <input class="form-control" data-dpa-field="description" value="${escHtml(r.description || '')}"></div>
        <div class="col-12 col-md-8"><label class="form-label small">ลิงก์</label>
          <input class="form-control" data-dpa-field="href" value="${escHtml(r.href || '')}" placeholder="https://…"></div>
        <div class="col-12 col-md-4"><label class="form-label small">ข้อความปุ่ม</label>
          <input class="form-control" data-dpa-field="cta" value="${escHtml(r.cta || '')}" placeholder="เปิดลิงก์"></div>
        <div class="col-12 col-md-6"><label class="form-label small">รูปปก (URL)</label>
          <input class="form-control" data-dpa-field="cover_url" value="${escHtml(r.cover_url || '')}"></div>
        <div class="col-12 col-md-6"><label class="form-label small">วิดีโอ (URL)</label>
          <input class="form-control" data-dpa-field="video_url" value="${escHtml(r.video_url || '')}"></div>
      </div>`}
  </div>`;
}

function paint(root) {
  const list = root.querySelector('#dpaRows');
  const preview = root.querySelector('#dpaPreview');
  if (!list) return;
  if (!state.rows.length) {
    list.innerHTML = '<p class="text-muted mb-0">ยังไม่มีเนื้อหา กดปุ่มด้านบนเพื่อเพิ่ม</p>';
  } else {
    list.innerHTML = state.rows.map(rowEditor).join('');
  }
  if (preview) {
    // `renderDeptContent` drops hidden rows, which is correct — this preview is
    // the PUBLIC page. But "หน้านี้จะว่าง" beside a list of rows the ฝ่าย just
    // wrote reads as data loss, when the true answer is that none of them is
    // published yet. Two different emptinesses, two different sentences.
    const hasDrafts = state.rows.some((r) => r.visible === false);
    const emptyMsg = hasDrafts
      ? '<p class="text-muted mb-0">ยังไม่มีอะไรขึ้นหน้าเว็บ — เนื้อหาที่เพิ่มไว้ยังไม่แสดง '
        + 'กดปุ่ม "แสดง" ที่รายการทางซ้ายเมื่อพร้อม</p>'
      : '<p class="text-muted mb-0">หน้านี้จะว่าง</p>';
    preview.innerHTML = renderDeptContent(state.rows) || emptyMsg;
    watchDeptHtmlHeights();
  }
}

function say(root, msg, ok = false) {
  const el = root.querySelector('#dpaStatus');
  if (!el) return;
  el.textContent = msg || '';
  el.className = `dpa-status small ${ok ? 'text-success' : 'text-danger'}`;
}

/** Collect what the form holds for one row. */
function readRow(el) {
  const patch = {};
  for (const f of el.querySelectorAll('[data-dpa-field]')) {
    patch[f.dataset.dpaField] = f.value.trim() === '' ? null : f.value;
  }
  return patch;
}

async function save(root) {
  if (state.busy) return;
  state.busy = true;
  say(root, 'กำลังบันทึก…', true);
  try {
    for (const el of root.querySelectorAll('[data-dpa-row]')) {
      const id = el.dataset.dpaRow;
      const row = state.rows.find((r) => r.id === id);
      if (!row) continue;
      const patch = { ...readRow(el), position: row.position, visible: row.visible };
      // ⚠️ EVERY UPDATE ASKS FOR THE ROW BACK. A refused PATCH answers 204 with
      // no body, so without `return=representation` + a length check this would
      // report "บันทึกแล้ว" for a write RLS threw away — the shape 0167 shipped.
      const { data, error } = await dbRest(
        `/dept_content?id=eq.${encodeURIComponent(id)}`,
        { method: 'PATCH', body: patch, prefer: 'return=representation' },
      );
      if (error) { say(root, errMsg(error, 'บันทึกไม่สำเร็จ')); state.busy = false; return; }
      if (!Array.isArray(data) || data.length === 0) {
        say(root, 'บันทึกไม่สำเร็จ: ไม่มีสิทธิ์แก้เนื้อหาของฝ่ายนี้');
        state.busy = false; return;
      }
    }
    say(root, 'บันทึกแล้ว หน้าฝ่ายอัปเดตทันที', true);
    await refresh(root);
  } finally { state.busy = false; }
}

async function refresh(root) {
  const { rows, error } = await load(state.dept);
  if (error) { say(root, errMsg(error, 'โหลดเนื้อหาไม่สำเร็จ')); return; }
  state.rows = rows;
  paint(root);
}

/**
 * A NEW ROW IS A DRAFT. `dept_content.visible` defaults to `true` in the DDL,
 * so the first version of this created every card PUBLIC — it was on the ฝ่าย's
 * public page the instant the button was pressed, carrying the placeholder
 * title `หัวข้อใหม่`, no link and no cover. That really happened: one such card
 * stood on the live ฝ่ายดิจิทัล page.
 *
 * Every other authoring surface in this app drafts first (ประกาศ, หนังสือ), and
 * the whole premise of หน้าฝ่าย is that a ฝ่าย builds their page over several
 * sittings without asking IT. A default that publishes each sitting's
 * half-finished state contradicts the feature it belongs to.
 *
 * ⚠️ The column default stays `true` ON PURPOSE. It is what an INSERT from
 * anywhere else means, and flipping it would silently hide rows a future
 * importer or migration creates. The draft rule belongs to the BUTTON a person
 * presses, so it is stated here, explicitly, in the row this button writes.
 */
async function addRow(root, kind) {
  const max = state.rows.reduce((m, r) => Math.max(m, r.position || 0), 0);
  const body = kind === 'html'
    ? { dept: state.dept, kind: 'html', position: max + 10, visible: false, html: '<p>เขียนเนื้อหาของฝ่ายที่นี่</p>' }
    : { dept: state.dept, kind: 'card', position: max + 10, visible: false, title: 'หัวข้อใหม่' };
  const { data, error } = await dbRest('/dept_content',
    { method: 'POST', body, prefer: 'return=representation' });
  if (error) { say(root, errMsg(error, 'เพิ่มไม่สำเร็จ')); return; }
  if (!Array.isArray(data) || !data.length) {
    say(root, 'เพิ่มไม่สำเร็จ: ไม่มีสิทธิ์แก้เนื้อหาของฝ่ายนี้'); return;
  }
  await refresh(root);
}

async function removeRow(root, id) {
  // return=representation on a DELETE too: RLS refuses by matching zero rows,
  // never by erroring, so "it worked" and "you may not" are the same 204.
  const { data, error } = await dbRest(`/dept_content?id=eq.${encodeURIComponent(id)}`,
    { method: 'DELETE', prefer: 'return=representation' });
  if (error) { say(root, errMsg(error, 'ลบไม่สำเร็จ')); return; }
  if (!Array.isArray(data) || data.length === 0) {
    say(root, 'ลบไม่สำเร็จ: ไม่มีสิทธิ์แก้เนื้อหาของฝ่ายนี้'); return;
  }
  await refresh(root);
}

/** @returns {Promise<boolean>} whether the write actually landed. */
async function patchRow(root, id, patch, reload = true) {
  const { data, error } = await dbRest(`/dept_content?id=eq.${encodeURIComponent(id)}`,
    { method: 'PATCH', body: patch, prefer: 'return=representation' });
  if (error) { say(root, errMsg(error, 'บันทึกไม่สำเร็จ')); return false; }
  if (!Array.isArray(data) || data.length === 0) {
    say(root, 'บันทึกไม่สำเร็จ: ไม่มีสิทธิ์แก้เนื้อหาของฝ่ายนี้'); return false;
  }
  if (reload) await refresh(root);
  return true;
}

/** Swap two rows' positions. Reordering by rewriting BOTH keeps the numbers
 *  meaningful instead of drifting into ties that sort unpredictably. */
async function move(root, id, dir) {
  const i = state.rows.findIndex((r) => r.id === id);
  const j = dir === 'up' ? i - 1 : i + 1;
  if (i < 0 || j < 0 || j >= state.rows.length) return;
  const a = state.rows[i], b = state.rows[j];
  const pa = a.position, pb = b.position;
  // A swap is TWO writes and it must not half-happen. If the first is refused
  // — a revoked grant, a dropped connection — firing the second anyway leaves
  // both rows on one position, which then sorts by created_at and looks like
  // the reorder silently did the wrong thing. Stop, and let the message stand.
  const first = await patchRow(root, a.id, { position: pb === pa ? pb + (dir === 'up' ? -1 : 1) : pb }, false);
  if (!first) { await refresh(root); return; }
  await patchRow(root, b.id, { position: pa });
}

export function initDeptPageAdmin(user) {
  const root = document.querySelector('[data-admin-pane="deptpage"]');
  if (!root) return;
  const picker = root.querySelector('#dpaDept');
  const mine = editableDepts(user);
  if (picker) {
    picker.innerHTML = mine.map((d) => `<option value="${escHtml(d.value)}">${escHtml(d.label)}</option>`).join('');
    picker.disabled = mine.length <= 1;
  }
  const only = root.querySelector('#dpaOnly');
  if (only) {
    // Say WHICH ฝ่าย this account is for, rather than making the single-item
    // dropdown look like a choice that failed to offer alternatives.
    only.textContent = mine.length === 1 ? `คุณดูแลหน้า${deptLabel(mine[0].value)}` : '';
  }
  if (!mine.length) {
    root.querySelector('#dpaBody')?.classList.add('d-none');
    say(root, 'บัญชีนี้ยังไม่ได้รับสิทธิ์แก้หน้าฝ่ายใด — ขอสิทธิ์ได้ที่ ทีม SAMO');
    return;
  }
  state.dept = mine[0].value;
  refresh(root);

  if (root.dataset.dpaWired === '1') return;
  root.dataset.dpaWired = '1';

  picker?.addEventListener('change', () => { state.dept = picker.value; refresh(root); });
  root.querySelector('#dpaAddCard')?.addEventListener('click', () => addRow(root, 'card'));
  root.querySelector('#dpaAddHtml')?.addEventListener('click', () => addRow(root, 'html'));
  root.querySelector('#dpaSave')?.addEventListener('click', () => save(root));

  // Delegated, so it keeps working across every repaint. A listener per row is
  // this repo's listener-accumulation bug (docs/mistakes/frontend-ui.md).
  root.addEventListener('click', (e) => {
    const rowEl = e.target.closest('[data-dpa-row]');
    if (!rowEl) return;
    const id = rowEl.dataset.dpaRow;
    const row = state.rows.find((r) => r.id === id);
    if (e.target.closest('[data-dpa-delete]')) {
      if (!window.confirm('ลบเนื้อหานี้ออกจากหน้าฝ่าย?')) return;
      removeRow(root, id);
    } else if (e.target.closest('[data-dpa-toggle]')) {
      patchRow(root, id, { visible: !(row?.visible !== false) });
    } else {
      const mv = e.target.closest('[data-dpa-move]');
      if (mv) move(root, id, mv.dataset.dpaMove);
    }
  });
}
