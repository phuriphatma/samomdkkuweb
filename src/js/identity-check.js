// ==============================================
// ตรวจสอบข้อมูลของฉัน — the import's disagreements, asked of the one person who
// can actually answer them.
//
// THE PROBLEM THIS IS THE UI HALF OF (migration 0138). The faculty roster and a
// person can disagree about that person's own name. Until now the disagreement
// was resolved silently and in the person's favour — `students_keep_self_edits`
// discarded the file's value — which is the right OUTCOME and an invisible one:
// nobody ever learned that the faculty spells their surname differently, and
// nobody finds out until an exam list or a certificate.
//
// WHY THE PERSON AND NOT AN ADMIN. 1,800 potential disagreements against one
// admin is not a workflow. 1,800 people each answering one question about their
// own name is, and each of them is the only one who actually knows the answer.
// The admin list exists for whoever never comes.
//
// AND THE CONFIRM BUTTON, which is the answer to "some will check, some won't".
// Pressing it stamps `identity_confirmed_at`, and that timestamp is the ONLY
// thing separating "looked at it, it is right" from "never opened the page".
// Those two need completely different follow-up and are indistinguishable
// without it.
//
// This module renders NOTHING when there is nothing to say and the person has
// already confirmed — a permanent banner asking you to check data you checked
// last week is how people learn to ignore banners.
// ==============================================
import { dbRest } from './db.js';
import { escHtml } from './utils.js';

/** Field → what a student calls it. Deliberately NOT the column name: the
 *  person reading this has never heard of `first_name_th`. */
const FIELD_LABEL = {
  first_name_th: 'ชื่อ',
  last_name_th: 'นามสกุล',
  student_id: 'รหัสนักศึกษา',
  major: 'สาขา',
};

let cache = null;

export function clearIdentityCheckCache() { cache = null; }

export async function loadIdentityStatus() {
  if (cache) return cache;
  cache = dbRest('/rpc/get_my_identity_status', { method: 'POST', body: {} })
    .then(({ data, error }) => {
      if (error) throw new Error(error.message || `HTTP ${error.status}`);
      return data || null;
    })
    // A person the registry has never heard of is the common case for a
    // visitor, not a failure — and a failure here must not be louder than the
    // page it sits on.
    .catch((err) => { console.warn('identity-check: lookup failed:', err); return null; });
  return cache;
}

/**
 * Pure, and exported for the tests: given the status payload, what should the
 * block say?
 *
 * Three states, and the third is why this is a function rather than an `if`:
 *  • conflicts open        → ask, one question per field
 *  • none, never confirmed → offer the confirm button once
 *  • none, confirmed       → NOTHING. Not a green tick, not a reassurance —
 *    the block disappears. A card that stays on screen forever saying "your
 *    data is fine" is the thing people stop reading, and then they stop
 *    reading it on the day it says something else.
 */
export function identityCheckState(status) {
  if (!status) return { kind: 'none' };
  const conflicts = Array.isArray(status.conflicts) ? status.conflicts : [];
  if (conflicts.length) return { kind: 'conflicts', conflicts };
  if (!status.confirmed_at) return { kind: 'unconfirmed' };
  return { kind: 'none' };
}

function conflictHtml(c) {
  const label = FIELD_LABEL[c.field] || c.field;
  const mine = String(c.mine ?? '').trim() || '(ว่าง)';
  const theirs = String(c.theirs ?? '').trim() || '(ว่าง)';
  return `
    <li class="identity-conflict" data-conflict-id="${escHtml(c.id)}">
      <p class="identity-conflict-field">${escHtml(label)}</p>
      <div class="identity-conflict-values">
        <button type="button" class="identity-choice" data-use="mine">
          <span class="identity-choice-who">ที่คุณกรอกไว้</span>
          <span class="identity-choice-value">${escHtml(mine)}</span>
        </button>
        <button type="button" class="identity-choice" data-use="theirs">
          <span class="identity-choice-who">ข้อมูลจากคณะ</span>
          <span class="identity-choice-value">${escHtml(theirs)}</span>
        </button>
      </div>
      <p class="identity-conflict-hint">กดเลือกอันที่ถูกต้อง</p>
    </li>`;
}

export function renderIdentityCheck(host, status) {
  if (!host) return;
  const state = identityCheckState(status);
  if (state.kind === 'none') { host.hidden = true; host.innerHTML = ''; return; }

  host.hidden = false;
  if (state.kind === 'unconfirmed') {
    host.innerHTML = `
      <div class="identity-card identity-card--ask">
        <p class="identity-card-title">ช่วยตรวจสอบข้อมูลของคุณ</p>
        <p class="identity-card-body">
          ดูข้อมูลด้านล่างว่าถูกต้องครบถ้วนไหม ถ้ามีอะไรผิดแก้ได้เลย
          ถ้าถูกต้องแล้วกดยืนยันเพื่อให้เรารู้ว่าคุณตรวจแล้ว
        </p>
        <div class="identity-card-actions">
          <button type="button" class="identity-confirm" data-identity-confirm>ข้อมูลถูกต้องแล้ว</button>
          <span class="identity-status" data-identity-status role="status"></span>
        </div>
      </div>`;
    return;
  }

  host.innerHTML = `
    <div class="identity-card identity-card--conflict">
      <p class="identity-card-title">ข้อมูลจากคณะไม่ตรงกับที่คุณกรอกไว้</p>
      <p class="identity-card-body">
        คณะส่งข้อมูลนักศึกษามาให้ และมีบางช่องไม่ตรงกับที่คุณกรอกเอง
        เราเก็บของคุณไว้ให้ก่อน ยังไม่ได้ทับ — ช่วยเลือกให้หน่อยว่าอันไหนถูก
      </p>
      <ul class="identity-conflict-list">${state.conflicts.map(conflictHtml).join('')}</ul>
      <span class="identity-status" data-identity-status role="status"></span>
    </div>`;
}

/**
 * Fetch, paint, and wire.
 *
 * The listener is attached to the HOST, once per call, and the host is replaced
 * wholesale on every repaint — so there is exactly one handler per painted DOM.
 * A delegated listener re-attached to a SURVIVING node on every render fires N
 * times on the Nth paint, which is how a panel ended up opening only on
 * odd-numbered clicks (docs/mistakes/frontend-ui.md).
 */
export async function showIdentityCheck(host, opts = {}) {
  if (!host) return;
  const status = await loadIdentityStatus();
  renderIdentityCheck(host, status);
  if (host.hidden) return;

  const say = (msg) => {
    const el = host.querySelector('[data-identity-status]');
    if (el) el.textContent = msg;
  };

  host.onclick = async (e) => {
    const confirmBtn = e.target.closest('[data-identity-confirm]');
    if (confirmBtn) {
      confirmBtn.disabled = true;
      say('กำลังบันทึก…');
      try {
        const { error } = await dbRest('/rpc/confirm_my_identity', { method: 'POST', body: {} });
        if (error) throw new Error(error.message || `HTTP ${error.status}`);
        clearIdentityCheckCache();
        await showIdentityCheck(host, opts);
      } catch (err) {
        confirmBtn.disabled = false;
        say(`บันทึกไม่สำเร็จ: ${err.message || err}`);
      }
      return;
    }

    const choice = e.target.closest('[data-use]');
    if (!choice) return;
    const row = choice.closest('[data-conflict-id]');
    if (!row) return;
    // Both buttons, not just the pressed one: leaving the other live invites a
    // second click that races the first and resolves the same question twice.
    row.querySelectorAll('[data-use]').forEach((b) => { b.disabled = true; });
    say('กำลังบันทึก…');
    try {
      const { error } = await dbRest('/rpc/resolve_identity_conflict', {
        method: 'POST',
        body: { p_id: row.dataset.conflictId, p_use: choice.dataset.use },
      });
      if (error) throw new Error(error.message || `HTTP ${error.status}`);
      clearIdentityCheckCache();
      await showIdentityCheck(host, opts);
      // The chosen value may have changed the record itself — taking the
      // faculty's spelling writes it to ระบบบ้าน and, through the mirrors, to
      // ทีม SAMO. Repainting only this block would leave the cards below
      // showing what the person's name was a moment ago.
      opts.afterResolve?.();
    } catch (err) {
      row.querySelectorAll('[data-use]').forEach((b) => { b.disabled = false; });
      say(`บันทึกไม่สำเร็จ: ${err.message || err}`);
    }
  };
}
