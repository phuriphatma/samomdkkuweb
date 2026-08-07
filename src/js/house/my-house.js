// ==============================================
// "บ้านของฉัน" — what a signed-in student sees on the home page.
//
// Mirrors my-seat.js in shape and for the same reason: one SECURITY DEFINER RPC
// that takes NO argument (identity comes from auth.uid()), so this module cannot
// be pointed at anyone else and cannot become a roster lookup. Every field it
// renders is the caller's own.
//
// WHAT IT HAS TO SURVIVE
//   • No data at all. The ~1,800-row import may land weeks after this ships, so
//     a student who is not in the table yet gets NO card — not an error, not an
//     empty skeleton. That is the overwhelmingly common case at launch.
//   • A house with no name. Until someone names บ้าน 3 it renders as "บ้าน 3".
//     There is no reveal flag: an unnamed house IS the not-yet-revealed state.
// ==============================================
import { escHtml } from '../utils.js';
import { convertDriveUrl } from '../uploads.js';
import {
  fetchMyStudentRecord, saveMyStudentRecord, fetchHouseRoster, requestMyChange,
} from './api.js';
import { houseLabel, normalizeSai, houseOf } from './fields.js';

// Cached per signed-in uid, so an in-place account switch cannot show the
// previous person's house (the module-scope-cache trap in mistakes.md).
let cacheUid = null;
let cachePromise = null;

export function clearMyHouseCache() {
  cacheUid = null;
  cachePromise = null;
}

export function loadMyHouse(uid) {
  if (!uid) return Promise.resolve(null);
  if (cacheUid === uid && cachePromise) return cachePromise;
  cacheUid = uid;
  cachePromise = fetchMyStudentRecord()
    .then((rec) => (rec && rec.kkumail ? rec : null))
    .catch((err) => {
      // Not in the table yet is the normal case before the import — never noisy.
      console.warn('my-house: lookup failed:', err);
      return null;
    });
  return cachePromise;
}

function houseChip(rec) {
  const name = houseLabel(rec.house_id, rec.house_name);
  const color = rec.house_color || '#105922';
  const icon = rec.house_icon
    ? `<img src="${escHtml(convertDriveUrl(rec.house_icon, 160))}" alt=""
           style="width:40px;height:40px;object-fit:cover;border-radius:10px" />`
    : `<div class="d-flex align-items-center justify-content-center fw-bold"
            style="width:40px;height:40px;border-radius:10px;background:${escHtml(color)};color:#fff">
         ${rec.house_id ?? '?'}
       </div>`;
  return `
    <div class="d-flex align-items-center gap-2">
      ${icon}
      <div>
        <div class="fw-semibold">${escHtml(name)}</div>
        <div class="small text-muted">สายรหัส ${escHtml(rec.sai || '—')}</div>
      </div>
    </div>`;
}

function advisorList(rec) {
  const own = rec.advisors || [];
  if (!own.length) {
    return '<div class="small text-muted">ยังไม่มีข้อมูลอาจารย์ที่ปรึกษาของสายนี้</div>';
  }
  return `<ul class="list-unstyled mb-0 small">${own.map((a) => `
    <li><i class="bi bi-person-badge text-muted"></i>
      ${escHtml([a.title, a.name].filter(Boolean).join(' '))}
      ${a.dept ? `<span class="text-muted">· ${escHtml(a.dept)}</span>` : ''}
    </li>`).join('')}</ul>`;
}

export function renderMyHouse(host, rec) {
  if (!host) return;
  if (!rec) { host.hidden = true; host.innerHTML = ''; return; }
  host.hidden = false;

  const year = rec.year ? `ปี ${rec.year}` : '';
  host.innerHTML = `
    <div class="card">
      <div class="card-body">
        <div class="d-flex flex-wrap gap-3 align-items-center">
          ${rec.house_id === null || rec.house_id === undefined
    ? '<div class="text-muted">ยังไม่ได้กำหนดสายรหัส</div>'
    : houseChip(rec)}
          <div class="ms-auto text-end small">
            <div class="fw-semibold">${escHtml(rec.full_name || '')}</div>
            <div class="text-muted">
              ${escHtml([rec.nickname, rec.major, year].filter(Boolean).join(' · '))}
            </div>
          </div>
        </div>

        <hr class="my-3" />
        <div class="row g-3">
          <div class="col-md-6">
            <div class="small text-uppercase text-muted mb-1">อาจารย์ที่ปรึกษาสายของฉัน</div>
            ${advisorList(rec)}
          </div>
          <div class="col-md-6">
            <div class="small text-uppercase text-muted mb-1">ข้อมูลของฉัน</div>
            <div class="small">
              <div>รหัสนักศึกษา: ${escHtml(rec.student_id || '—')}</div>
              <div>kkumail: ${escHtml(rec.kkumail || '—')}</div>
            </div>
            <div class="mt-2 d-flex flex-wrap gap-2">
              <button type="button" class="btn btn-sm btn-outline-secondary" data-house-act="edit">
                <i class="bi bi-pencil"></i> แก้ไขข้อมูล
              </button>
              ${rec.roster_visible && (rec.house_id !== null && rec.house_id !== undefined) ? `
                <button type="button" class="btn btn-sm btn-outline-secondary" data-house-act="roster">
                  <i class="bi bi-people"></i> เพื่อนร่วมบ้าน
                </button>` : ''}
              ${rec.verified_at ? '<span class="badge bg-success align-self-center">ยืนยันข้อมูลแล้ว</span>' : `
                <button type="button" class="btn btn-sm btn-success" data-house-act="verify">
                  <i class="bi bi-check2"></i> ข้อมูลถูกต้อง
                </button>`}
            </div>
          </div>
        </div>

        <div class="mt-3 d-none" data-house-panel="edit"></div>
        <div class="mt-3 d-none" data-house-panel="roster"></div>
      </div>
    </div>`;

  wireCard(host, rec);
}

function editPanelHtml(rec) {
  // สายรหัส is offered as an editable field ONLY while the admin switch is on
  // and the student has not already used their one change. Otherwise it is
  // shown read-only with the "แจ้งข้อมูลไม่ถูกต้อง" route, so the answer to
  // "mine is wrong" is never a dead end.
  const saiBlock = rec.sai_editable
    ? `<div class="col-6">
         <label class="form-label small" for="mhSai">สายรหัส</label>
         <input class="form-control form-control-sm" id="mhSai" value="${escHtml(rec.sai || '')}" />
         <div class="form-text text-warning">
           แก้ได้ครั้งเดียว และจะทำให้บ้านของคุณเปลี่ยนตาม
         </div>
       </div>`
    : `<div class="col-6">
         <label class="form-label small">สายรหัส</label>
         <input class="form-control form-control-sm" value="${escHtml(rec.sai || '')}" disabled />
         <div class="form-text">
           แก้เองไม่ได้ —
           <a href="#" data-house-act="request">แจ้งว่าข้อมูลไม่ถูกต้อง</a>
         </div>
       </div>`;

  return `
    <form data-house-form="edit" class="border rounded p-3">
      <div class="row g-2">
        <div class="col-6">
          <label class="form-label small" for="mhNick">ชื่อเล่น</label>
          <input class="form-control form-control-sm" id="mhNick" value="${escHtml(rec.nickname || '')}" />
        </div>
        ${saiBlock}
        <div class="col-6">
          <label class="form-label small" for="mhYear">ชั้นปี (ถ้าไม่ตรง)</label>
          <select class="form-select form-select-sm" id="mhYear">
            <option value="">คำนวณให้อัตโนมัติ${rec.year ? ` (ปี ${rec.year})` : ''}</option>
            ${[1, 2, 3, 4, 5, 6, 7].map((y) => `
              <option value="${y}" ${String(rec.year_override) === String(y) ? 'selected' : ''}>ปี ${y}</option>`).join('')}
          </select>
          <div class="form-text">ใช้เมื่อลาพัก เรียนซ้ำ หรือจบช้า</div>
        </div>
        <div class="col-6 d-flex align-items-center">
          <div class="form-check">
            <input class="form-check-input" type="checkbox" id="mhListed" ${rec.is_listed ? 'checked' : ''} />
            <label class="form-check-label small" for="mhListed">
              แสดงชื่อฉันในรายชื่อเพื่อนร่วมบ้าน
            </label>
          </div>
        </div>
      </div>
      <div class="mt-2 d-flex gap-2">
        <button type="submit" class="btn btn-sm btn-primary">บันทึก</button>
        <button type="button" class="btn btn-sm btn-secondary" data-house-act="cancel">ยกเลิก</button>
        <span class="small align-self-center" data-house-msg></span>
      </div>
    </form>`;
}

function wireCard(host, rec) {
  const panel = (name) => host.querySelector(`[data-house-panel="${name}"]`);

  host.querySelectorAll('[data-house-act]').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      const act = btn.dataset.houseAct;
      if (act === 'request') e.preventDefault();

      if (act === 'edit') {
        const p = panel('edit');
        p.classList.toggle('d-none');
        if (!p.classList.contains('d-none')) {
          p.innerHTML = editPanelHtml(rec);
          wireEditForm(host, rec, p);
        }
      } else if (act === 'cancel') {
        panel('edit').classList.add('d-none');
      } else if (act === 'verify') {
        try {
          const updated = await saveMyStudentRecord({ verify: true });
          renderMyHouse(host, updated);
        } catch (err) { alert(err?.message || 'บันทึกไม่สำเร็จ'); }
      } else if (act === 'roster') {
        const p = panel('roster');
        p.classList.toggle('d-none');
        if (!p.classList.contains('d-none')) {
          p.innerHTML = '<div class="text-muted small">กำลังโหลด…</div>';
          try {
            const list = await fetchHouseRoster(rec.house_id);
            p.innerHTML = list.length ? `
              <div class="small text-uppercase text-muted mb-1">
                เพื่อนร่วม${escHtml(houseLabel(rec.house_id, rec.house_name))} (${list.length} คน)
              </div>
              <div class="row g-1 small">
                ${list.map((m) => `
                  <div class="col-6 col-md-4 col-lg-3">
                    ${escHtml(m.name || '')}
                    ${m.nickname ? `<span class="text-muted">(${escHtml(m.nickname)})</span>` : ''}
                    <span class="text-muted">· สาย ${escHtml(m.sai || '')}</span>
                  </div>`).join('')}
              </div>`
              : '<div class="text-muted small">ยังไม่มีรายชื่อ</div>';
          } catch (err) {
            p.innerHTML = `<div class="text-danger small">${escHtml(err?.message || 'โหลดไม่สำเร็จ')}</div>`;
          }
        }
      } else if (act === 'request') {
        const want = prompt('สายรหัสที่ถูกต้องของคุณคือ? (3 หลัก เช่น 017)');
        if (!want) return;
        const n = normalizeSai(want);
        if (!n.ok || !n.value) { alert('สายรหัสต้องเป็นตัวเลขไม่เกิน 3 หลัก'); return; }
        const why = prompt('อธิบายสั้นๆ ว่าทำไมถึงคิดว่าข้อมูลเดิมไม่ถูกต้อง') || '';
        try {
          await requestMyChange('sai_code', n.value, why);
          alert(`ส่งคำขอแล้ว — ขอเปลี่ยนเป็นสาย ${n.value} (${houseLabel(houseOf(n.value), null)})\n`
            + 'ผู้ดูแลจะตรวจสอบและแจ้งผลให้ทราบ');
        } catch (err) { alert(err?.message || 'ส่งคำขอไม่สำเร็จ'); }
      }
    });
  });
}

function wireEditForm(host, rec, panelEl) {
  const form = panelEl.querySelector('[data-house-form="edit"]');
  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = form.querySelector('[data-house-msg]');
    const patch = {
      nickname_self: form.querySelector('#mhNick').value.trim(),
      year_override: form.querySelector('#mhYear').value || '',
      is_listed: form.querySelector('#mhListed').checked,
    };
    const saiInput = form.querySelector('#mhSai');
    if (saiInput) {
      const n = normalizeSai(saiInput.value);
      if (!n.ok) {
        if (msg) { msg.textContent = 'สายรหัสไม่ถูกต้อง'; msg.className = 'small align-self-center text-danger'; }
        return;
      }
      // Only send it when it actually changed — the RPC counts a change against
      // the student's one allowance, and re-saving an unrelated field must not
      // burn it.
      if (n.value !== rec.sai) patch.sai_code = n.value;
    }
    if (msg) { msg.textContent = 'กำลังบันทึก…'; msg.className = 'small align-self-center text-muted'; }
    try {
      const updated = await saveMyStudentRecord(patch);
      clearMyHouseCache();
      renderMyHouse(host, updated);
    } catch (err) {
      if (msg) { msg.textContent = err?.message || 'บันทึกไม่สำเร็จ'; msg.className = 'small align-self-center text-danger'; }
    }
  });
}

/** Load + paint. Best-effort: a student who is not in the table simply has no
 *  card, which is the normal state until the import lands. */
export async function showMyHouse(host, uid) {
  if (!host) return;
  const rec = await loadMyHouse(uid);
  renderMyHouse(host, rec);
}
