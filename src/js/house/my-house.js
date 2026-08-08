// ==============================================
// "บ้านของฉัน" — what a signed-in student sees on the home page.
//
// Mirrors my-seat.js in shape and for the same reason: one SECURITY DEFINER RPC
// that takes NO argument (identity comes from auth.uid()), so this module cannot
// be pointed at anyone else and cannot become a directory lookup. Every field it
// renders is the caller's own, or an อาจารย์ named in their capacity as
// อาจารย์ที่ปรึกษา of a สาย in their house. It lists NO other student.
//
// IT ALSO MIRRORS my-seat.js VISUALLY, ON PURPOSE. Both cards answer "here is
// my record" to the same person on the same screen, so they share the `myseat-*`
// stylesheet rather than growing a second set of nearly-identical rules that
// drift apart. my-house.css adds only what is genuinely house-specific (the
// crest, the house accent colour and the อาจารย์ lists).
//
// WHAT IT HAS TO SURVIVE
//   • No data at all. The ~1,800-row import may land weeks after this ships, so
//     a student who is not in the table yet gets NO card — not an error, not an
//     empty skeleton. That is the overwhelmingly common case at launch.
//   • A house with no name. Until someone names บ้าน 3 it renders as "บ้าน 3".
//     There is no reveal flag: an unnamed house IS the not-yet-revealed state.
//   • Being re-rendered. renderMyHouse() runs on every auth event, and it used
//     to add a DELEGATED listener to `host` each time while the buttons only
//     toggled `d-none` — so after two paints every click toggled twice and the
//     panel stayed shut. Reported as "I need to click many times and sometimes
//     it will appear". Listeners now go on the nodes THIS paint created, which
//     the next `innerHTML =` throws away with them.
//
// NO ชั้นปี, AND NO ยืนยันข้อมูล. Both were data we do not need: ชั้นปี needs a
// clock and is wrong for anyone who ลาพัก / เรียนซ้ำ / จบช้า, so the card shows
// รุ่น (MD50) — a fact fixed at admission and readable off the รหัสนักศึกษา (see
// cohortLabel in ./fields.js). "ข้อมูลถูกต้อง" collected a timestamp nobody was
// ever going to act on. Migration 0123 removed both from the RPCs so no caller
// can put them back by accident.
// ==============================================
import { escHtml } from '../utils.js';
import { convertDriveUrl } from '../uploads.js';
import {
  fetchMyStudentRecord, saveMyStudentRecord, requestMyChange,
} from './api.js';
import { houseLabel, normalizeSai, cohortLabel } from './fields.js';

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

// ── the record, as label → value ───────────────────────────────────────────
//
// The same "ชื่อ … รหัสนักศึกษา …" list ตำแหน่งของฉันในทีม SAMO uses, because a
// person reading two cards about themselves should not have to learn two
// layouts. `self` marks what the student may change here; everything else comes
// from the university's file and is corrected by แจ้งข้อมูลไม่ถูกต้อง, which is
// why the card can show it read-only without becoming a dead end.
export const HOUSE_DETAIL_FIELDS = [
  { key: 'full_name', label: 'ชื่อ-สกุล', wide: true },
  { key: 'nickname', label: 'ชื่อเล่น', self: true },
  { key: 'student_id', label: 'รหัสนักศึกษา' },
  { key: 'cohort', label: 'รุ่น', value: (r) => cohortLabel(r) },
  { key: 'major', label: 'สาขา' },
  { key: 'sai', label: 'สายรหัส' },
  { key: 'house', label: 'บ้าน', value: (r) => (r.house_id === null || r.house_id === undefined
    ? '' : houseLabel(r.house_id, r.house_name)) },
  { key: 'kkumail', label: 'KKU Mail', wide: true },
];

/** Fields a student may ask an admin to correct. The SET is the allow-list in
 *  `public.request_my_change` (migration 0116) — anything not on it is rejected
 *  by the RPC, so offering it here would be a button that always fails. */
export const REQUESTABLE_FIELDS = [
  { field: 'first_name_th', label: 'ชื่อ' },
  { field: 'last_name_th', label: 'นามสกุล' },
  { field: 'student_id', label: 'รหัสนักศึกษา' },
  { field: 'major', label: 'สาขา' },
  { field: 'cohort_year', label: 'ปีที่เข้า (รุ่น)' },
  { field: 'sai_code', label: 'สายรหัส' },
];

function detailsHtml(rec) {
  const rows = HOUSE_DETAIL_FIELDS.map((f) => {
    const v = String((f.value ? f.value(rec) : rec[f.key]) ?? '').trim();
    return `<div class="myseat-detail${v ? '' : ' is-empty'}${f.wide ? ' is-wide' : ''}">
      <dt>${escHtml(f.label)}</dt>
      <dd>${v ? escHtml(v) : '<span class="myseat-missing">ยังไม่มีข้อมูล</span>'}</dd>
    </div>`;
  }).join('');
  return `<dl class="myseat-details">${rows}</dl>`;
}

function crestHtml(rec) {
  if (rec.house_id === null || rec.house_id === undefined) {
    return '<div class="myhouse-crest myhouse-crest--none" aria-hidden="true"><i class="bi bi-question-lg"></i></div>';
  }
  if (rec.house_icon) {
    return `<img class="myhouse-crest" src="${escHtml(convertDriveUrl(rec.house_icon, 200))}"
                 alt="" loading="lazy" />`;
  }
  return `<div class="myhouse-crest myhouse-crest--plain" aria-hidden="true">${rec.house_id}</div>`;
}

/** One อาจารย์ line. `tag` carries their สาย when the list spans several. */
function advisorLi(a, tag) {
  return `<li>
      <i class="bi bi-person-badge" aria-hidden="true"></i>
      <span>${escHtml([a.title, a.name].filter(Boolean).join(' '))}${
  tag ? `<em>${escHtml(tag)}</em>` : ''}${
  a.dept ? `<em>${escHtml(a.dept)}</em>` : ''}</span>
    </li>`;
}

/**
 * Two lists: the student's OWN สาย, then everyone else's in the same house.
 *
 * This is what replaced เพื่อนร่วมบ้าน. A roster of ~180 classmates' names was
 * both the least useful thing on the card and the only thing on it that
 * published other people — whereas "who are the อาจารย์ in my house" is the
 * question a student actually arrives with, and อาจารย์ are staff, listed in
 * their capacity as อาจารย์ที่ปรึกษา.
 *
 * The house-wide list comes from `house_advisors` (one row per distinct อาจารย์
 * per สาย, built by the RPC), with the student's own สาย filtered out so nobody
 * is named twice on one card.
 */
function advisorsHtml(rec) {
  const own = rec.advisors || [];
  const house = (rec.house_advisors || []).filter((a) => a.sai !== rec.sai);

  const ownBlock = `<div class="myseat-block">
    <span class="myseat-label">อาจารย์ที่ปรึกษาสายของฉัน${rec.sai ? ` (สาย ${escHtml(rec.sai)})` : ''}</span>
    ${own.length
    ? `<ul class="myhouse-advisors">${own.map((a) => advisorLi(a, null)).join('')}</ul>`
    : '<p class="myhouse-empty">ยังไม่มีข้อมูลอาจารย์ที่ปรึกษาของสายนี้</p>'}
  </div>`;

  if (!house.length) return ownBlock;

  return `${ownBlock}
    <div class="myseat-block">
      <span class="myseat-label">อาจารย์ในบ้านเดียวกัน (${house.length} ท่าน)</span>
      <ul class="myhouse-advisors">${house
    .map((a) => advisorLi(a, a.sai ? `สาย ${a.sai}` : null)).join('')}</ul>
    </div>`;
}

/**
 * The self-edit form.
 *
 * Only two things are the student's: ชื่อเล่น, and — while the admin switch is
 * on and they have not used their one change — สายรหัส. Everything else on this
 * card belongs to the university's file, so it is not offered here at all;
 * แจ้งข้อมูลไม่ถูกต้อง is its route.
 */
function editFormHtml(rec) {
  const sai = rec.sai_editable
    ? `<label class="myseat-field">
         <span>สายรหัส</span>
         <input type="text" name="sai" inputmode="numeric" value="${escHtml(rec.sai || '')}" />
         <em class="myseat-field-hint myhouse-warn">แก้ได้ครั้งเดียว และบ้านของคุณจะเปลี่ยนตามเลขหลักสุดท้าย</em>
       </label>`
    : `<label class="myseat-field myseat-field--locked">
         <span>สายรหัส</span>
         <input type="text" value="${escHtml(rec.sai || '')}" readonly />
         <em class="myseat-field-hint">แก้เองไม่ได้ — ใช้ปุ่ม “แจ้งข้อมูลไม่ถูกต้อง” ด้านล่าง</em>
       </label>`;

  return `
    <form class="myseat-edit" data-house-form="edit" hidden>
      <p class="myseat-edit-intro">
        ชื่อ-สกุล รหัสนักศึกษา สาขา และรุ่น มาจากข้อมูลของคณะ แก้ที่นี่ไม่ได้ —
        ถ้าไม่ถูกต้องให้แจ้งไว้ ผู้ดูแลจะแก้ให้
      </p>
      <div class="myseat-fields">
        <label class="myseat-field">
          <span>ชื่อเล่น</span>
          <input type="text" name="nickname" value="${escHtml(rec.nickname_self || rec.nickname || '')}" />
        </label>
        ${sai}
      </div>
      <div class="myseat-edit-actions">
        <button type="submit" class="myseat-save">บันทึก</button>
        <button type="button" class="myseat-cancel" data-house-act="cancel-edit">ยกเลิก</button>
        <span class="myseat-edit-status" data-house-status role="status"></span>
      </div>
    </form>`;
}

/**
 * แจ้งข้อมูลไม่ถูกต้อง, as a form rather than two `prompt()`s.
 *
 * The prompts it replaces were the shape that made the ทีม SAMO delete button
 * look dead: Chrome's "Prevent this page from creating additional dialogs" makes
 * `prompt()` return null with no error and no trace, so the report silently did
 * nothing. A form in the card cannot be suppressed and shows its own result.
 */
function reportFormHtml(rec) {
  return `
    <form class="myseat-edit" data-house-form="report" hidden>
      <p class="myseat-edit-intro">
        บอกว่าช่องไหนผิดและค่าที่ถูกต้องคืออะไร ผู้ดูแลจะตรวจสอบแล้วแก้ให้ —
        ระบบจะไม่เปลี่ยนข้อมูลจนกว่าจะได้รับการอนุมัติ
      </p>
      <div class="myseat-fields">
        <label class="myseat-field">
          <span>ช่องที่ไม่ถูกต้อง</span>
          <select name="field">
            ${REQUESTABLE_FIELDS.map((f) => `
              <option value="${escHtml(f.field)}">${escHtml(f.label)}</option>`).join('')}
          </select>
        </label>
        <label class="myseat-field">
          <span>ค่าที่ถูกต้อง</span>
          <input type="text" name="requested" placeholder="เช่น 017" />
        </label>
      </div>
      <label class="myseat-field is-wide myhouse-reason">
        <span>เหตุผล (ไม่บังคับ)</span>
        <textarea name="reason" rows="2" placeholder="เช่น ย้ายสายตั้งแต่ปีที่แล้ว"></textarea>
      </label>
      <div class="myseat-edit-actions">
        <button type="submit" class="myseat-save">ส่งคำขอ</button>
        <button type="button" class="myseat-cancel" data-house-act="cancel-report">ยกเลิก</button>
        <span class="myseat-edit-status" data-house-report-status role="status"></span>
      </div>
    </form>`;
}

export function renderMyHouse(host, rec) {
  if (!host) return;
  if (!rec) { host.hidden = true; host.innerHTML = ''; return; }
  host.hidden = false;

  const named = houseLabel(rec.house_id, rec.house_name);
  const hasHouse = rec.house_id !== null && rec.house_id !== undefined;
  const who = [rec.full_name, rec.nickname ? `(${rec.nickname})` : ''].filter(Boolean).join(' ');

  host.innerHTML = `
    <div class="myseat-card myhouse-card"${
  rec.house_color ? ` style="--house-accent:${escHtml(rec.house_color)}"` : ''}>
      <div class="myseat-head">
        <span class="myseat-eyebrow"><i class="bi bi-house-heart-fill" aria-hidden="true"></i> บ้านของฉัน</span>
      </div>

      <div class="myseat-person">
        ${crestHtml(rec)}
        <div class="myseat-person-body">
          <p class="myseat-name">${escHtml(hasHouse ? named : 'ยังไม่ได้กำหนดสายรหัส')}</p>
          <p class="myhouse-sub">${escHtml(hasHouse
    ? [who, rec.sai ? `สายรหัส ${rec.sai}` : ''].filter(Boolean).join(' · ')
    : 'เมื่อมีสายรหัสแล้ว ระบบจะจัดบ้านให้อัตโนมัติจากเลขหลักสุดท้าย')}</p>
          ${hasHouse && rec.house_slogan
    ? `<p class="myhouse-slogan">${escHtml(rec.house_slogan)}</p>` : ''}
        </div>
      </div>

      ${detailsHtml(rec)}

      <div class="myhouse-actions">
        <button type="button" class="myseat-fix myseat-fix--quiet" data-house-act="edit">
          <i class="bi bi-pencil" aria-hidden="true"></i> แก้ไขข้อมูล
        </button>
        <button type="button" class="myseat-fix myseat-fix--quiet" data-house-act="report">
          <i class="bi bi-flag" aria-hidden="true"></i> แจ้งข้อมูลไม่ถูกต้อง
        </button>
      </div>

      ${editFormHtml(rec)}
      ${reportFormHtml(rec)}

      ${advisorsHtml(rec)}
    </div>`;

  wireCard(host, rec);
}

// ── behaviour ──────────────────────────────────────────────────────────────

/**
 * Wire the nodes THIS paint created.
 *
 * Every listener below is attached to an element inside `host.innerHTML`, so the
 * next render drops it along with the node. The previous version delegated from
 * `host` itself — which survives every render — and added one more listener per
 * paint, so a `classList.toggle()` in the handler ran once, then twice, then
 * three times, and the panel opened only on odd-numbered paints. That is the
 * "click many times and sometimes it will appear" bug.
 */
function wireCard(host, rec) {
  // renderMyHouse's contract is "anything with .innerHTML and .hidden" — the
  // unit tests assert the MARKUP against a plain object with no DOM at all.
  if (typeof host.querySelector !== 'function') return;

  const card = host.querySelector('.myhouse-card');
  const editForm = host.querySelector('[data-house-form="edit"]');
  const reportForm = host.querySelector('[data-house-form="report"]');

  // ONE state, set explicitly. Never `toggle()` on a shared container: a panel
  // whose visibility is computed from its own current class cannot be reasoned
  // about once anything else touches it.
  let open = null;                       // 'edit' | 'report' | null
  const setOpen = (which) => {
    open = which;
    if (editForm) editForm.hidden = open !== 'edit';
    if (reportForm) reportForm.hidden = open !== 'report';
    card?.querySelectorAll('[data-house-act]').forEach((b) => {
      b.classList.toggle('is-open', b.dataset.houseAct === open);
    });
  };
  const toggle = (which) => setOpen(open === which ? null : which);

  host.querySelector('[data-house-act="edit"]')?.addEventListener('click', () => toggle('edit'));
  host.querySelector('[data-house-act="report"]')?.addEventListener('click', () => toggle('report'));
  host.querySelector('[data-house-act="cancel-edit"]')?.addEventListener('click', () => setOpen(null));
  host.querySelector('[data-house-act="cancel-report"]')?.addEventListener('click', () => setOpen(null));

  // ── บันทึก
  editForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const status = editForm.querySelector('[data-house-status]');
    const btn = editForm.querySelector('.myseat-save');
    const patch = {
      nickname_self: editForm.querySelector('[name="nickname"]').value.trim(),
    };
    // Only the EDITABLE variant carries a name; the locked one is a read-only
    // display input with none, so this cannot pick it up.
    const saiInput = editForm.querySelector('[name="sai"]');
    if (saiInput) {
      const n = normalizeSai(saiInput.value);
      if (!n.ok) {
        if (status) status.textContent = 'สายรหัสต้องเป็นตัวเลขไม่เกิน 3 หลัก';
        saiInput.focus();
        return;
      }
      // Only send it when it actually CHANGED — the RPC counts a change against
      // the student's one allowance, and re-saving an unrelated field must not
      // burn it.
      if (n.value !== rec.sai) patch.sai_code = n.value;
    }
    if (status) { status.textContent = 'กำลังบันทึก…'; status.classList.remove('is-error'); }
    if (btn) btn.disabled = true;
    try {
      const updated = await saveMyStudentRecord(patch);
      clearMyHouseCache();
      renderMyHouse(host, updated);
    } catch (err) {
      if (status) {
        status.textContent = err?.message || 'บันทึกไม่สำเร็จ';
        status.classList.add('is-error');
      }
      if (btn) btn.disabled = false;
    }
  });

  // ── แจ้งข้อมูลไม่ถูกต้อง
  reportForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const status = reportForm.querySelector('[data-house-report-status]');
    const btn = reportForm.querySelector('.myseat-save');
    const field = reportForm.querySelector('[name="field"]').value;
    const requestedEl = reportForm.querySelector('[name="requested"]');
    let requested = requestedEl.value.trim();
    if (!requested) {
      if (status) { status.textContent = 'กรอกค่าที่ถูกต้องด้วย'; status.classList.add('is-error'); }
      requestedEl.focus();
      return;
    }
    if (field === 'sai_code') {
      const n = normalizeSai(requested);
      if (!n.ok || !n.value) {
        if (status) { status.textContent = 'สายรหัสต้องเป็นตัวเลขไม่เกิน 3 หลัก'; status.classList.add('is-error'); }
        requestedEl.focus();
        return;
      }
      requested = n.value;
    }
    if (status) { status.textContent = 'กำลังส่ง…'; status.classList.remove('is-error'); }
    if (btn) btn.disabled = true;
    try {
      await requestMyChange(field, requested, reportForm.querySelector('[name="reason"]').value.trim());
      reportForm.innerHTML = '<p class="myhouse-sent">'
        + '<i class="bi bi-check2-circle" aria-hidden="true"></i> '
        + 'ส่งคำขอแล้ว ผู้ดูแลจะตรวจสอบและแก้ไขให้</p>';
    } catch (err) {
      if (status) {
        status.textContent = err?.message || 'ส่งคำขอไม่สำเร็จ';
        status.classList.add('is-error');
      }
      if (btn) btn.disabled = false;
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
