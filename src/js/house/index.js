// ==============================================
// ระบบบ้าน (House) — admin workspace.
//
// Six panes behind one lazy load: ภาพรวม · นักศึกษา · สายรหัส · อาจารย์ ·
// คำขอแก้ไข · นำเข้าข้อมูล. Schema + rationale: migrations 0116–0118 and
// docs/HOUSE-SYSTEM.md.
//
// TWO THINGS THIS MODULE NEVER DOES
//   1. It never computes a house. `sais.house_id` is a GENERATED column and the
//      house rule lives in SQL; the import preview borrows houseOf() from
//      ./fields.js purely to show a number before anything is written.
//   2. It never writes a student-owned column through the import path. The
//      allow-list is IMPORT_OWNED_COLUMNS in ./io.js and a test pins it.
//
// IT ALSO HAS TO WORK WITH NO DATA AT ALL. The data from the Data Analytics
// dept may arrive weeks after this ships, so every pane renders an honest empty
// state rather than a spinner or a broken table.
// ==============================================
import { escHtml } from '../utils.js';
import { getUser } from '../auth.js';
// An app-owned confirm. `window.confirm` cannot be trusted here: once Chrome's
// "Prevent this page from creating additional dialogs" is ticked it returns
// false forever with no UI, which is how ทีม SAMO's delete button and this
// pane's ปฏิเสธ both came to "do nothing at all".
import { askDelete } from '../confirm-modal.js';
import { uploadTeamPhoto, convertDriveUrl } from '../uploads.js';
import {
  fetchHouses, updateHouse, fetchSais,
  fetchAdvisors, createAdvisor, updateAdvisor, deleteAdvisor, setAdvisorSais,
  addSaiAdvisor, removeSaiAdvisor,
  fetchStudents, createStudent, updateStudent, deleteStudent, upsertStudents,
  createImportBatch, finishImportBatch, fetchRequests, decideRequest,
  markMissing, ensureSais, fetchMajors,
} from './api.js';
import {
  parseStudentsCsv, diffAgainstExisting, toUpsertRow, buildStudentsCsv,
  CSV_COLUMN_LABEL,
} from './io.js';
import {
  normalizeSai, houseOf, houseLabel, normalizeStudentId, HOUSE_COUNT,
  cohortLabel, saiProblem, safeColor,
} from './fields.js';

const $ = (id) => document.getElementById(id);
const modalInstance = (id) => {
  const el = $(id);
  return el && window.bootstrap ? window.bootstrap.Modal.getOrCreateInstance(el) : null;
};

// ---- module state ----
let initialized = false;
let loading = null;
let mode = 'overview';
// No `settings` state any more: ระบบบ้าน has no switches left. The two it had
// (ปีการศึกษา, สายรหัสแก้เองได้, เห็นรายชื่อเพื่อนร่วมบ้าน) each belonged to a
// feature that was removed outright in 0123–0125, and a stored setting nothing
// reads is a control that lies.
let houses = [];
let sais = [];
let students = [];
let advisors = [];
let requests = [];
let majors = [];            // team_majors — the ONE สาขา vocabulary
let pendingImport = null;   // parsed + diffed, awaiting confirmation

function setStatus(msg, isError = false) {
  const el = $('houseStatus');
  if (!el) return;
  el.textContent = msg || '';
  el.classList.toggle('text-danger', !!isError);
  el.classList.toggle('text-muted', !isError);
}

const saiHouse = (code) => {
  const row = sais.find((s) => s.code === code);
  // Prefer the DB's generated column; fall back to the local rule only when the
  // สาย is not in the seeded list (which should not happen, but a null here
  // would render "undefined" on a card).
  return row ? row.house_id : houseOf(code);
};

const houseById = (id) => houses.find((h) => h.id === id) || null;
const houseName = (id) => houseLabel(id, houseById(id)?.name);

// ============================================================
// LOAD
// ============================================================
export function enterHouseWorkspace() {
  if (!initialized) {
    initialized = true;
    wire();
  }
  if (!loading) reload();
}

async function reload() {
  setStatus('กำลังโหลด…');
  loading = (async () => {
    try {
      [houses, sais, students, advisors, requests, majors] = await Promise.all([
        fetchHouses(), fetchSais(),
        fetchStudents(), fetchAdvisors(), fetchRequests(), fetchMajors(),
      ]);
      setStatus('');
      render();
    } catch (e) {
      setStatus(e?.message || 'โหลดข้อมูลไม่สำเร็จ', true);
    } finally {
      loading = null;
    }
  })();
  return loading;
}

// ============================================================
// RENDER
// ============================================================
function render() {
  document.querySelectorAll('[data-house-mode]').forEach((b) => {
    b.classList.toggle('active', b.dataset.houseMode === mode);
  });
  document.querySelectorAll('[data-house-pane]').forEach((p) => {
    p.classList.toggle('d-none', p.dataset.housePane !== mode);
  });

  const openReqs = requests.filter((r) => r.status === 'pending').length;
  const badge = $('houseReqBadge');
  if (badge) {
    badge.textContent = String(openReqs);
    badge.classList.toggle('d-none', openReqs === 0);
  }

  if (mode === 'overview') renderOverview();
  else if (mode === 'students') renderStudents();
  else if (mode === 'sais') renderSais();
  else if (mode === 'advisors') renderAdvisors();
  else if (mode === 'requests') renderRequests();
}

// ---------- ภาพรวม ----------
function renderOverview() {
  $('houseEmptyNote')?.classList.toggle('d-none', students.length > 0);

  const withSai = students.filter((s) => s.sai_code).length;
  const noSai = students.length - withSai;
  const stats = [
    ['นักศึกษาทั้งหมด', students.length, 'bi-people'],
    ['มีสายรหัสแล้ว', withSai, 'bi-signpost-split'],
    ['ยังไม่มีสายรหัส', noSai, noSai ? 'bi-exclamation-triangle text-warning' : 'bi-check2'],
    ['อาจารย์ที่ปรึกษา', advisors.length, 'bi-person-badge'],
  ];
  const wrap = $('houseStats');
  if (wrap) {
    wrap.innerHTML = stats.map(([label, value, icon]) => `
      <div class="col-6 col-md">
        <div class="card h-100"><div class="card-body py-2 px-3">
          <div class="small text-muted"><i class="bi ${icon}"></i> ${escHtml(label)}</div>
          <div class="fs-4 fw-semibold">${value.toLocaleString('th-TH')}</div>
        </div></div>
      </div>`).join('');
  }

  const counts = new Map();
  for (const s of students) {
    const h = saiHouse(s.sai_code);
    if (h === null || h === undefined) continue;
    counts.set(h, (counts.get(h) || 0) + 1);
  }

  const cards = $('houseCards');
  if (!cards) return;
  cards.innerHTML = houses.map((h) => {
    const named = !!String(h.name || '').trim();
    const icon = h.icon_url
      ? `<img src="${escHtml(convertDriveUrl(h.icon_url, 200))}" alt=""
             style="width:48px;height:48px;object-fit:cover;border-radius:12px" />`
      : `<div class="d-flex align-items-center justify-content-center fw-bold"
              style="width:48px;height:48px;border-radius:12px;background:${safeColor(h.color, '#e9ecef')};color:#fff">
           ${h.id}
         </div>`;
    return `
      <div class="col-6 col-md-4 col-lg-3">
        <div class="card h-100 house-card" role="button" data-house-edit="${h.id}">
          <div class="card-body d-flex gap-2 align-items-center">
            ${icon}
            <div class="flex-grow-1 min-w-0">
              <div class="fw-semibold text-truncate">${escHtml(houseLabel(h.id, h.name))}</div>
              <div class="small text-muted">${(counts.get(h.id) || 0).toLocaleString('th-TH')} คน</div>
              ${named ? '' : '<div class="small text-warning">ยังไม่ตั้งชื่อ</div>'}
            </div>
            <i class="bi bi-pencil text-muted"></i>
          </div>
        </div>
      </div>`;
  }).join('');
}

// ---------- นักศึกษา ----------
// รุ่น (MD50), never ชั้นปี. The rule lives in ./fields.js and takes no clock —
// see cohortLabel() there for why ชั้นปี was dropped from ระบบบ้าน entirely.
const cohortOf = (s) => cohortLabel(s);

function filteredStudents() {
  const q = ($('houseSearch')?.value || '').trim().toLowerCase();
  const fh = $('houseFilterHouse')?.value || '';
  const fy = $('houseFilterYear')?.value || '';
  const fm = $('houseFilterMajor')?.value || '';
  return students.filter((s) => {
    if (fh !== '' && String(saiHouse(s.sai_code)) !== fh) return false;
    if (fy !== '' && (cohortOf(s) || '') !== fy) return false;
    if (fm !== '' && (s.major || '') !== fm) return false;
    if (!q) return true;
    return [s.full_name, s.nickname, s.student_id, s.kkumail, s.sai_code]
      .some((v) => String(v || '').toLowerCase().includes(q));
  });
}

function renderStudents() {
  // Filter choosers, built from the data actually present.
  const hSel = $('houseFilterHouse');
  if (hSel && hSel.options.length <= 1) {
    for (let i = 0; i < HOUSE_COUNT; i += 1) {
      hSel.insertAdjacentHTML('beforeend', `<option value="${i}">${escHtml(houseName(i))}</option>`);
    }
  }
  // Built from the รุ่น actually present, like the สาขา chooser below — a fixed
  // 1–6 list was only ever right for ชั้นปี, and รุ่น has no upper bound.
  const ySel = $('houseFilterYear');
  if (ySel && ySel.options.length <= 1) {
    [...new Set(students.map(cohortOf).filter(Boolean))].sort().reverse().forEach((c) => {
      ySel.insertAdjacentHTML('beforeend', `<option value="${escHtml(c)}">${escHtml(c)}</option>`);
    });
  }
  const mSel = $('houseFilterMajor');
  if (mSel && mSel.options.length <= 1) {
    [...new Set(students.map((s) => s.major).filter(Boolean))].sort().forEach((m) => {
      mSel.insertAdjacentHTML('beforeend', `<option value="${escHtml(m)}">${escHtml(m)}</option>`);
    });
  }

  const rows = filteredStudents();
  const body = $('houseStudentRows');
  if (body) {
    body.innerHTML = rows.length ? rows.slice(0, 500).map((s) => {
      const h = saiHouse(s.sai_code);
      return `
        <tr data-student="${escHtml(s.id)}" role="button">
          <td>${s.full_name ? escHtml(s.full_name)
    : '<span class="text-muted fst-italic">ยังไม่มีชื่อ</span>'}</td>
          <td>${escHtml(s.nickname || '')}</td>
          <td class="text-nowrap">${escHtml(s.student_id || '')}</td>
          <td class="small">${escHtml(s.kkumail || '')}</td>
          <td>${escHtml(s.major || '')}</td>
          <td>${escHtml(cohortOf(s) || '—')}</td>
          <td>${escHtml(s.sai_code || '—')}</td>
          <td>${h === null || h === undefined ? '—' : escHtml(houseName(h))}</td>
          <td class="text-end"><i class="bi bi-pencil text-muted"></i></td>
        </tr>`;
    }).join('') : `
      <tr><td colspan="9" class="text-center text-muted py-4">
        ${students.length ? 'ไม่พบนักศึกษาที่ตรงกับตัวกรอง'
    : 'ยังไม่มีข้อมูลนักศึกษา — นำเข้าไฟล์จากแท็บ “นำเข้าข้อมูล”'}
      </td></tr>`;
  }
  const count = $('houseStudentCount');
  if (count) {
    count.textContent = rows.length
      ? `แสดง ${Math.min(rows.length, 500).toLocaleString('th-TH')} จาก ${rows.length.toLocaleString('th-TH')} คน`
      : '';
  }
}

// ---------- สายรหัส ----------
/** อาจารย์ per สาย, built once per render from the advisor rows we already have.
 *  The link table is loaded nested under `advisors`, so this is the ONE place
 *  that inverts it — every สาย-side reader uses this map rather than re-walking
 *  `sai_advisors` and drifting from it. */
function advisorsBySai() {
  const m = new Map();
  for (const a of advisors) {
    for (const link of a.sai_advisors || []) {
      if (!m.has(link.sai_code)) m.set(link.sai_code, []);
      m.get(link.sai_code).push(a);
    }
  }
  for (const list of m.values()) {
    list.sort((x, y) => String(x.full_name || '').localeCompare(String(y.full_name || ''), 'th'));
  }
  return m;
}

function renderSais() {
  const wrap = $('houseSaiGroups');
  if (!wrap) return;

  const hSel = $('houseSaiFilterHouse');
  if (hSel && hSel.options.length <= 1) {
    for (let i = 0; i < HOUSE_COUNT; i += 1) {
      hSel.insertAdjacentHTML('beforeend', `<option value="${i}">${escHtml(houseName(i))}</option>`);
    }
  }

  const advBySai = advisorsBySai();
  const memberCount = new Map();
  for (const s of students) {
    if (!s.sai_code) continue;
    memberCount.set(s.sai_code, (memberCount.get(s.sai_code) || 0) + 1);
  }

  if (!sais.length) {
    wrap.innerHTML = '<div class="text-muted text-center py-4">'
      + 'ยังไม่มีสายรหัสในระบบ — สายรหัสจะถูกสร้างอัตโนมัติเมื่อนำเข้าข้อมูลนักศึกษา'
      + '</div>';
    return;
  }

  // Search matches the สาย code OR an อาจารย์ name, because "which สาย does
  // อ.สมชาย have" is the same question asked from the other end.
  const q = ($('houseSaiSearch')?.value || '').trim().toLowerCase();
  const fh = $('houseSaiFilterHouse')?.value || '';
  const onlyEmpty = !!$('houseSaiOnlyEmpty')?.checked;
  const visible = sais.filter((s) => {
    const adv = advBySai.get(s.code) || [];
    if (fh !== '' && String(s.house_id) !== fh) return false;
    if (onlyEmpty && adv.length) return false;
    if (!q) return true;
    return s.code.includes(q)
      || adv.some((a) => String(a.full_name || '').toLowerCase().includes(q));
  });

  if (!visible.length) {
    wrap.innerHTML = '<div class="text-muted text-center py-4">ไม่พบสายที่ตรงกับตัวกรอง</div>';
    return;
  }

  const byHouse = new Map();
  for (const s of visible) {
    if (!byHouse.has(s.house_id)) byHouse.set(s.house_id, []);
    byHouse.get(s.house_id).push(s);
  }

  wrap.innerHTML = [...byHouse.entries()].sort((a, b) => a[0] - b[0]).map(([hid, list]) => `
    <div class="mb-3">
      <h6 class="small text-uppercase text-muted">${escHtml(houseName(hid))} · ${list.length} สาย</h6>
      <div class="row g-2">
        ${list.map((s) => {
    const adv = advBySai.get(s.code) || [];
    return `
          <div class="col-6 col-md-3 col-lg-2">
            <div class="border rounded p-2 h-100 house-sai-card" data-sai="${escHtml(s.code)}" role="button"
                 title="กดเพื่อจัดการอาจารย์ของสาย ${escHtml(s.code)}">
              <div class="fw-semibold">สาย ${escHtml(s.code)}</div>
              <div class="small text-muted">${(memberCount.get(s.code) || 0)} คน</div>
              <div class="small ${adv.length ? '' : 'text-warning'}">
                ${adv.length ? escHtml(adv.map((a) => a.full_name).join(', ')) : 'ยังไม่มีอาจารย์'}
              </div>
            </div>
          </div>`;
  }).join('')}
      </div>
    </div>`).join('');
}

// ---------- สาย modal: อาจารย์ of ONE สาย ----------
/**
 * Repaint the modal body from module state.
 *
 * Called on open and after every add/remove — the modal does NOT close on save,
 * because assigning three อาจารย์ to a สาย would otherwise be three round trips
 * through a card grid (the "modal that closes on save" entry in mistakes.md).
 */
function paintSaiModal(code) {
  const sai = sais.find((s) => s.code === code);
  // The modal markup lives in tab-house.html; bail rather than throw if either
  // it or the สาย has gone (a reload can drop a สาย whose last student moved).
  if (!sai || !$('hxTitle') || !$('hxAdvisors') || !$('hxPick')) return;
  const assigned = advisorsBySai().get(code) || [];
  const members = students.filter((s) => s.sai_code === code).length;

  $('hxTitle').textContent = `สายรหัส ${code}`;
  $('hxMeta').innerHTML = `${escHtml(houseName(sai.house_id))} · ${members} คน`
    + ' · <span class="text-muted">บ้านคำนวณจากเลขหลักสุดท้าย แก้ด้วยมือไม่ได้</span>';

  $('hxAdvisors').innerHTML = assigned.length ? assigned.map((a) => `
    <div class="d-flex align-items-center gap-2 border rounded px-2 py-1 mb-1">
      <div class="flex-grow-1 small">
        <span class="fw-semibold">${escHtml([a.title, a.full_name].filter(Boolean).join(' '))}</span>
        ${a.dept ? `<span class="text-muted"> · ${escHtml(a.dept)}</span>` : ''}
      </div>
      <button type="button" class="btn btn-sm btn-outline-danger py-0 px-2"
              data-sai-remove="${escHtml(a.id)}" title="นำออกจากสายนี้">
        <i class="bi bi-x-lg"></i>
      </button>
    </div>`).join('')
    : '<div class="small text-warning">ยังไม่มีอาจารย์ที่ปรึกษาของสายนี้</div>';

  const taken = new Set(assigned.map((a) => a.id));
  const options = advisors.filter((a) => !taken.has(a.id));
  $('hxPick').innerHTML = options.length
    ? options.map((a) => `<option value="${escHtml(a.id)}">${
  escHtml([a.title, a.full_name, a.dept ? `(${a.dept})` : ''].filter(Boolean).join(' '))}</option>`).join('')
    : '<option value="">— ไม่มีอาจารย์ให้เลือก —</option>';
  $('hxPick').disabled = !options.length;
  $('hxAdd').disabled = !options.length;
}

/** Only the advisor rows changed, so only they are refetched. `reload()` here
 *  meant six queries — including all ~1,800 students — for every single
 *  add/remove click, and assigning four อาจารย์ to one สาย is four of them. */
async function refreshAdvisors() {
  advisors = await fetchAdvisors();
  render();
}

function openSaiModal(code) {
  $('hxCode').value = code;
  paintSaiModal(code);
  modalInstance('houseSaiModal')?.show();
}

async function onSaiAddAdvisor() {
  const code = $('hxCode').value;
  const advisorId = $('hxPick').value;
  if (!code || !advisorId) return;
  const btn = $('hxAdd');
  btn.disabled = true;
  try {
    const assigned = advisorsBySai().get(code) || [];
    await addSaiAdvisor(code, advisorId, assigned.length);
    await refreshAdvisors();
    paintSaiModal(code);
  } catch (err) {
    setStatus(err?.message || 'เพิ่มอาจารย์ไม่สำเร็จ', true);
  } finally {
    btn.disabled = false;
  }
}

async function onSaiRemoveAdvisor(advisorId) {
  const code = $('hxCode').value;
  if (!code || !advisorId) return;
  try {
    await removeSaiAdvisor(code, advisorId);
    await refreshAdvisors();
    paintSaiModal(code);
  } catch (err) {
    setStatus(err?.message || 'นำอาจารย์ออกไม่สำเร็จ', true);
  }
}

// ---------- อาจารย์ ----------
function renderAdvisors() {
  const q = ($('houseAdvisorSearch')?.value || '').trim().toLowerCase();
  const rows = advisors.filter((a) => !q
    || [a.full_name, a.email, a.dept].some((v) => String(v || '').toLowerCase().includes(q)));
  const body = $('houseAdvisorRows');
  if (!body) return;
  body.innerHTML = rows.length ? rows.map((a) => `
    <tr data-advisor="${escHtml(a.id)}" role="button">
      <td>${escHtml([a.title, a.full_name].filter(Boolean).join(' '))}</td>
      <td class="small">${escHtml(a.email || '')}</td>
      <td class="small">${escHtml(a.dept || '')}</td>
      <td class="small">${escHtml((a.sai_advisors || []).map((l) => l.sai_code).sort().join(', ') || '—')}</td>
      <td class="text-end"><i class="bi bi-pencil text-muted"></i></td>
    </tr>`).join('')
    : `<tr><td colspan="5" class="text-center text-muted py-4">
         ยังไม่มีรายชื่ออาจารย์ — กด “เพิ่มอาจารย์” หรือรอไฟล์จากฝ่ายข้อมูล</td></tr>`;
}

// ---------- คำขอแก้ไข ----------
const FIELD_LABEL = {
  sai_code: 'สายรหัส', student_id: 'รหัสนักศึกษา', kkumail: 'kkumail',
  first_name_th: 'ชื่อจริง', last_name_th: 'นามสกุล', major: 'สาขา',
  cohort_year: 'ปีที่เข้า',
};

function renderRequests() {
  const wrap = $('houseRequestRows');
  if (!wrap) return;
  const open = requests.filter((r) => r.status === 'pending');
  const done = requests.filter((r) => r.status !== 'pending').slice(0, 30);
  if (!requests.length) {
    wrap.innerHTML = '<div class="text-muted text-center py-4">ยังไม่มีคำขอแก้ไข</div>';
    return;
  }
  const card = (r) => {
    const s = r.students || {};
    const isSai = r.field === 'sai_code';
    const newHouse = isSai ? houseOf(String(r.requested_value || '')) : null;
    return `
      <div class="card mb-2"><div class="card-body py-2">
        <div class="d-flex flex-wrap gap-2 align-items-center">
          <div class="flex-grow-1">
            <div class="fw-semibold">${escHtml(s.full_name || '(ไม่ทราบชื่อ)')}
              <span class="small text-muted">${escHtml(s.kkumail || '')}</span></div>
            <div class="small">
              ขอแก้ <strong>${escHtml(FIELD_LABEL[r.field] || r.field)}</strong>
              จาก <code>${escHtml(r.current_value || '—')}</code>
              เป็น <code>${escHtml(r.requested_value || '—')}</code>
              ${isSai && newHouse !== null
    ? `<span class="badge bg-warning text-dark">ย้ายไป ${escHtml(houseName(newHouse))}</span>` : ''}
            </div>
            ${r.reason ? `<div class="small text-muted">เหตุผล: ${escHtml(r.reason)}</div>` : ''}
          </div>
          ${r.status === 'pending' ? `
            <div class="d-flex flex-column gap-1" style="min-width:16rem">
              <input type="text" class="form-control form-control-sm"
                     data-req-note="${escHtml(r.id)}"
                     placeholder="เหตุผล (ไม่บังคับ — นักศึกษาจะเห็นข้อความนี้)" />
              <div class="d-flex gap-1">
                <button class="btn btn-sm btn-success" data-req-approve="${escHtml(r.id)}">อนุมัติ</button>
                <button class="btn btn-sm btn-outline-danger" data-req-reject="${escHtml(r.id)}">ปฏิเสธ</button>
              </div>
            </div>`
    : `<span class="badge ${r.status === 'approved' ? 'bg-success' : 'bg-secondary'}">
                 ${r.status === 'approved' ? 'อนุมัติแล้ว' : 'ปฏิเสธแล้ว'}</span>`}
        </div>
      </div></div>`;
  };
  wrap.innerHTML = (open.length ? `<h6 class="small text-uppercase text-muted">รอดำเนินการ</h6>${open.map(card).join('')}` : '')
    + (done.length ? `<h6 class="small text-uppercase text-muted mt-3">ดำเนินการแล้ว</h6>${done.map(card).join('')}` : '');
}

// ============================================================
// IMPORT
// ============================================================
function renderImportPreview(result, diff) {
  const wrap = $('housePreview');
  if (!wrap) return;

  if (result.fatal) {
    wrap.innerHTML = `
      <div class="alert alert-danger">
        <h6 class="alert-heading">นำเข้าไม่ได้</h6>
        <p class="mb-0">${escHtml(result.fatal)}</p>
      </div>`;
    pendingImport = null;
    return;
  }

  // FILE-level findings (the สาย padding notice, unrecognised columns) are shown
  // ABOVE the fold, not inside the collapsed list: they describe the file as a
  // whole, and "we padded 412 สาย for you" is the one thing the person confirming
  // this import must read before clicking. Per-row problems stay collapsed —
  // there can be hundreds.
  const fileLevel = result.problems.filter((p) => p.line === 1);
  const perRow = result.problems.filter((p) => p.line !== 1);
  const skips = perRow.filter((p) => p.level === 'skip');
  const warns = perRow.filter((p) => p.level === 'warn');
  const infos = perRow.filter((p) => p.level === 'info');
  const houseCounts = new Map();
  for (const r of result.rows) {
    if (r._house === null) continue;
    houseCounts.set(r._house, (houseCounts.get(r._house) || 0) + 1);
  }

  wrap.innerHTML = `
    <div class="alert alert-secondary">
      <div class="row text-center g-2">
        <div class="col"><div class="fs-4 fw-semibold text-success">${diff.insert}</div><div class="small">จะเพิ่มใหม่</div></div>
        <div class="col"><div class="fs-4 fw-semibold text-primary">${diff.update}</div><div class="small">จะแก้ไข</div></div>
        <div class="col"><div class="fs-4 fw-semibold text-muted">${diff.same}</div><div class="small">ไม่เปลี่ยน</div></div>
        <div class="col"><div class="fs-4 fw-semibold text-warning">${skips.length}</div><div class="small">ข้าม</div></div>
      </div>
    </div>

    ${result.missingColumns.length ? `
      <div class="alert alert-warning py-2 small">
        <strong>ไฟล์นี้ไม่มีคอลัมน์:</strong>
        ${escHtml(result.missingColumns.map((c) => CSV_COLUMN_LABEL[c] || c).join(' · '))}
        <br />นำเข้าได้ — ช่องที่ขาดจะ<strong>ไม่ถูกแตะต้อง</strong>
        ของเดิมในระบบยังอยู่ครบ
        ${result.missingColumns.includes('sai_code')
    ? '<br />(ไฟล์นี้ไม่มีสายรหัส จึงไม่มีการย้ายบ้านใครทั้งสิ้น)' : ''}
      </div>` : ''}

    ${fileLevel.map((p) => `
      <div class="alert ${p.level === 'warn' ? 'alert-warning' : 'alert-info'} py-2 small">
        ${escHtml(p.message)}
      </div>`).join('')}

    ${diff.missing.length ? `
      <div class="alert alert-warning py-2 small">
        มี ${diff.missing.length} คนอยู่ในระบบแต่ไม่มีในไฟล์นี้ —
        <strong>ระบบจะไม่ลบให้</strong> และจะทำเครื่องหมายไว้ว่าไม่พบในไฟล์ล่าสุด
      </div>` : ''}

    <div class="mb-3">
      <h6 class="small text-uppercase text-muted">จำนวนคนที่จะเข้าแต่ละบ้าน</h6>
      <div class="d-flex flex-wrap gap-2">
        ${Array.from({ length: HOUSE_COUNT }, (_, i) => `
          <span class="badge bg-light text-dark border">
            ${escHtml(houseName(i))}: ${houseCounts.get(i) || 0}
          </span>`).join('')}
      </div>
    </div>

    ${perRow.length ? `
      <details class="mb-3">
        <summary class="small">ปัญหาที่พบ ${perRow.length} รายการ</summary>
        <ul class="small mt-2 mb-0">
          ${[...skips, ...warns, ...infos].slice(0, 100).map((p) => `
            <li class="${p.level === 'skip' ? 'text-danger'
    : p.level === 'warn' ? 'text-warning-emphasis' : 'text-muted'}">
              ${escHtml(p.message)}</li>`).join('')}
        </ul>
        ${perRow.length > 100 ? `<div class="small text-muted mt-1">
          (แสดง 100 รายการแรกจาก ${perRow.length})</div>` : ''}
      </details>` : ''}

    <button type="button" class="btn btn-primary" id="houseImportConfirm"
      ${result.rows.length ? '' : 'disabled'}>
      ยืนยันนำเข้า ${result.rows.length.toLocaleString('th-TH')} รายการ
    </button>`;

  $('houseImportConfirm')?.addEventListener('click', runImport);
}

async function onCsvPicked(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    const text = await file.text();
    // The MANAGED vocabulary (team_majors), never "whatever is already in the
    // table" and never a hardcoded fallback. Deriving the known list from the
    // existing rows made it self-ratifying: one bad import taught the next one
    // that `md` was a real สาขา, and the hardcoded ['MD','MDI','RT'] was a second
    // copy of a list an admin can edit.
    const result = parseStudentsCsv(text, majors.map((m) => m.code));
    const diff = diffAgainstExisting(result.rows, students, result.presentColumns);
    pendingImport = { result, diff, fileName: file.name };
    renderImportPreview(result, diff);
  } catch (err) {
    setStatus(err?.message || 'อ่านไฟล์ไม่สำเร็จ', true);
  }
}

async function runImport() {
  if (!pendingImport) return;
  const { result, diff, fileName } = pendingImport;
  const btn = $('houseImportConfirm');
  if (btn) { btn.disabled = true; btn.textContent = 'กำลังนำเข้า…'; }
  try {
    // Counts are stamped AFTER the write (finishImportBatch below), not here:
    // the row must exist first because students carry last_import_batch, but a
    // row created with the planned counts would claim a successful import of N
    // people even if the run died on chunk 3.
    const batch = await createImportBatch({
      file_name: fileName,
      uploaded_by: getUser()?.id || null,
      row_count: result.rows.length,
      problem_count: result.problems.length,
    });
    // สาย FIRST. students.sai_code is a foreign key and สาย are not seeded —
    // the range runs as high as the largest year's headcount, so the set comes
    // from the file. Without this every student on a สาย we have not seen
    // before fails with a 23503 partway through the import.
    if (btn) btn.textContent = 'กำลังสร้างสายรหัส…';
    await ensureSais(result.rows.map((r) => r.sai_code).filter(Boolean));

    // Chunked: 1,800 rows in one POST is a large body and an all-or-nothing
    // failure. 200 at a time keeps each request small and makes a partial
    // failure legible ("stopped at chunk 4") instead of silent.
    // Scoped to the columns the FILE carried: a column the file did not have
    // must not be written, or an import would clear it for everyone in the file.
    const rows = result.rows.map((r) => toUpsertRow(r, batch?.id, result.presentColumns));
    const CHUNK = 200;
    for (let i = 0; i < rows.length; i += CHUNK) {
      await upsertStudents(rows.slice(i, i + CHUNK));
      if (btn) btn.textContent = `กำลังนำเข้า… ${Math.min(i + CHUNK, rows.length)}/${rows.length}`;
    }
    // Rows already in the database that this file does not mention. The preview
    // promises they are flagged rather than deleted — before this, it said so
    // and then did nothing, which is worse than not offering the guarantee.
    const missingIds = diff.missing.map((m) => m.id).filter(Boolean);
    if (missingIds.length) {
      if (btn) btn.textContent = 'กำลังทำเครื่องหมายรายการที่ไม่อยู่ในไฟล์…';
      await markMissing(missingIds);
    }
    await finishImportBatch(batch?.id, {
      inserted_count: diff.insert,
      updated_count: diff.update,
      unchanged_count: diff.same,
    });
    pendingImport = null;
    $('houseCsvFile').value = '';
    $('housePreview').innerHTML = '<div class="alert alert-success">นำเข้าเรียบร้อยแล้ว</div>';
    await reload();
  } catch (err) {
    if (btn) { btn.disabled = false; btn.textContent = 'ลองอีกครั้ง'; }
    setStatus(err?.message || 'นำเข้าไม่สำเร็จ', true);
  }
}

// ============================================================
// EDITORS
// ============================================================
function openStudentModal(id) {
  const s = id ? students.find((x) => x.id === id) : null;
  $('hsId').value = s?.id || '';
  $('hsFirst').value = s?.first_name_th || '';
  $('hsLast').value = s?.last_name_th || '';
  $('hsNick').value = s?.nickname_self || s?.nickname_imported || '';
  $('hsSid').value = s?.student_id || '';
  $('hsMail').value = s?.kkumail || '';
  // Chooser, not free text — the same three codes ทีม SAMO manages. An off-list
  // value already stored is kept as its own option so saving an unrelated field
  // cannot silently rewrite it.
  const cur = s?.major || '';
  const known = majors.some((m) => m.code === cur);
  $('hsMajor').innerHTML = '<option value="">— ไม่ระบุ —</option>'
    + majors.map((m) => `<option value="${escHtml(m.code)}"${m.code === cur ? ' selected' : ''}>${
  escHtml(m.label ? `${m.code} — ${m.label}` : m.code)}</option>`).join('')
    + (cur && !known ? `<option value="${escHtml(cur)}" selected>${escHtml(cur)} (ไม่อยู่ในรายการ)</option>` : '');
  $('hsSai').value = s?.sai_code || '';

  $('hsDelete').classList.toggle('d-none', !s);
  updateHouseHint();
  modalInstance('houseStudentModal')?.show();
}

function updateHouseHint() {
  const hint = $('hsHouseHint');
  if (!hint) return;
  const n = normalizeSai($('hsSai')?.value);
  if (!n.value) { hint.textContent = ' '; return; }
  if (!n.ok) { hint.textContent = 'สายรหัสไม่ถูกต้อง'; hint.className = 'form-text text-danger'; return; }
  const h = houseOf(n.value);
  hint.className = 'form-text';
  hint.textContent = `สาย ${n.value} → ${houseName(h)}`;
}

async function onStudentSubmit(e) {
  e.preventDefault();
  const id = $('hsId').value;
  const sai = normalizeSai($('hsSai').value);
  if (!sai.ok) { alert(saiProblem($('hsSai').value) || 'สายรหัสไม่ถูกต้อง'); return; }
  const sid = normalizeStudentId($('hsSid').value);
  const payload = {
    // Nullable since 0126 — an imported row may legitimately have no name yet.
    first_name_th: $('hsFirst').value.trim() || null,
    last_name_th: $('hsLast').value.trim() || null,
    student_id: sid.value,
    kkumail: $('hsMail').value.trim().toLowerCase(),
    major: $('hsMajor').value.trim() || null,
    sai_code: sai.value,
  };
  // An admin editing the row by hand is writing the person's REAL nickname, so
  // it goes to the imported slot (the student's own nickname_self still wins if
  // they ever set one — that precedence is the whole point of the pair).
  payload.nickname_imported = $('hsNick').value.trim() || null;
  try {
    if (id) await updateStudent(id, payload);
    else await createStudent(payload);
    modalInstance('houseStudentModal')?.hide();
    await reload();
  } catch (err) { alert(err?.message || 'บันทึกไม่สำเร็จ'); }
}

async function onStudentDelete() {
  const id = $('hsId').value;
  const s = students.find((x) => x.id === id);
  if (!s) return;
  if (!await askDelete(s.full_name || s.kkumail,
    'ข้อมูลบ้าน สายรหัส และสิ่งที่นักศึกษาคนนี้กรอกเองจะหายไปทั้งหมด')) return;
  try {
    await deleteStudent(id);
    modalInstance('houseStudentModal')?.hide();
    await reload();
  } catch (err) { alert(err?.message || 'ลบไม่สำเร็จ'); }
}

// ---------- house editor ----------
let houseIconUrl = null;
function openHouseModal(id) {
  const h = houseById(id);
  if (!h) return;
  $('heId').value = String(h.id);
  $('heTitle').textContent = `แก้ไข${houseLabel(h.id, h.name)}`;
  $('heName').value = h.name || '';
  $('heSlogan').value = h.slogan || '';
  $('heColor').value = h.color || '#105922';
  houseIconUrl = h.icon_url || null;
  paintHouseIcon();
  $('heIconFile').value = '';
  modalInstance('houseEditModal')?.show();
}

function paintHouseIcon() {
  const img = $('heIconPreview');
  const clear = $('heIconClear');
  if (!img) return;
  if (houseIconUrl) {
    img.src = convertDriveUrl(houseIconUrl, 200);
    img.classList.remove('d-none');
    clear?.classList.remove('d-none');
  } else {
    img.classList.add('d-none');
    clear?.classList.add('d-none');
  }
}

async function onHouseIconPicked(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  setStatus('กำลังอัปโหลดโลโก้…');
  try {
    // Filed under the existing Team tree so this needs NO Apps Script change and
    // no new OAuth scope — `uploadTeamFile` only requires the path to start with
    // "Team". A dedicated House folder would have meant a GAS redeploy.
    const { url } = await uploadTeamPhoto(file, {
      year: '_House', dept: 'icons', order: $('heId').value, name: `house-${$('heId').value}`,
    });
    houseIconUrl = url;
    paintHouseIcon();
    setStatus('');
  } catch (err) {
    setStatus(err?.message || 'อัปโหลดไม่สำเร็จ', true);
  }
}

async function onHouseSubmit(e) {
  e.preventDefault();
  const id = Number($('heId').value);
  try {
    await updateHouse(id, {
      name: $('heName').value.trim() || null,
      slogan: $('heSlogan').value.trim() || null,
      color: $('heColor').value || null,
      icon_url: houseIconUrl,
    });
    modalInstance('houseEditModal')?.hide();
    await reload();
  } catch (err) { alert(err?.message || 'บันทึกไม่สำเร็จ'); }
}

// ---------- advisor editor ----------
function openAdvisorModal(id) {
  const a = id ? advisors.find((x) => x.id === id) : null;
  $('haId').value = a?.id || '';
  $('haTitle').value = a?.title || '';
  $('haFirst').value = a?.first_name_th || '';
  $('haLast').value = a?.last_name_th || '';
  $('haEmail').value = a?.email || '';
  $('haDept').value = a?.dept || '';
  $('haSais').value = (a?.sai_advisors || []).map((l) => l.sai_code).sort().join(', ');
  $('haDelete').classList.toggle('d-none', !a);
  modalInstance('houseAdvisorModal')?.show();
}

async function onAdvisorSubmit(e) {
  e.preventDefault();
  const id = $('haId').value;
  const codes = [];
  for (const part of $('haSais').value.split(/[,\s]+/).filter(Boolean)) {
    const n = normalizeSai(part);
    if (!n.ok || !n.value) { alert(`สายรหัส “${part}”: ${saiProblem(part) || 'ไม่ถูกต้อง'}`); return; }
    if (!sais.some((s) => s.code === n.value)) { alert(`ไม่พบสาย ${n.value} ในระบบ`); return; }
    if (!codes.includes(n.value)) codes.push(n.value);
  }
  const payload = {
    title: $('haTitle').value.trim() || null,
    first_name_th: $('haFirst').value.trim(),
    last_name_th: $('haLast').value.trim() || null,
    email: $('haEmail').value.trim().toLowerCase() || null,
    dept: $('haDept').value.trim() || null,
  };
  try {
    const row = id ? await updateAdvisor(id, payload) : await createAdvisor(payload);
    await setAdvisorSais(row.id, codes);
    modalInstance('houseAdvisorModal')?.hide();
    await reload();
  } catch (err) { alert(err?.message || 'บันทึกไม่สำเร็จ'); }
}

async function onAdvisorDelete() {
  const id = $('haId').value;
  const a = advisors.find((x) => x.id === id);
  if (!a) return;
  if (!await askDelete(a.full_name, 'อาจารย์ท่านนี้จะถูกนำออกจากทุกสายที่ดูแลอยู่')) return;
  try {
    await deleteAdvisor(id);
    modalInstance('houseAdvisorModal')?.hide();
    await reload();
  } catch (err) { alert(err?.message || 'ลบไม่สำเร็จ'); }
}

// ---------- requests ----------
/**
 * Approve or reject one คำขอแก้ไข.
 *
 * REPORTED: "ปฏิเสธ doesn't work, อนุมัติ works." It didn't, and it had TWO
 * silent ways not to — the same pair that made the ทีม SAMO delete button look
 * dead. The reason was collected with `prompt()`, and then:
 *   • Chrome's "Prevent this page from creating additional dialogs" makes every
 *     later prompt() return null instantly, with no UI, for the life of the
 *     page — and the handler read null as "cancelled" and returned; and
 *   • pressing OK on an EMPTY box gives '', which `|| null` turned into null
 *     too, so an admin who had no particular reason also got nothing, and
 *     nobody had been told a reason was mandatory.
 * อนุมัติ worked because it never opened a dialog.
 *
 * The reason is now an ordinary input in the card: always visible, genuinely
 * optional, and impossible for the browser to suppress.
 */
async function onDecide(id, approve) {
  const r = requests.find((x) => x.id === id);
  if (!r) { setStatus('ไม่พบคำขอนี้แล้ว — กำลังโหลดใหม่', true); reload(); return; }
  const note = document.querySelector(`[data-req-note="${CSS.escape(id)}"]`)?.value.trim() || null;
  try {
    if (approve) {
      // Apply the change first; only mark it approved if the write landed. The
      // other order would leave a request stamped "approved" whose edit never
      // happened, which is worse than a request that has to be redone.
      const patch = {};
      if (r.field === 'cohort_year') patch[r.field] = Number(r.requested_value) || null;
      else patch[r.field] = r.requested_value || null;
      if (r.field === 'sai_code') {
        // Only the SHAPE is checked here. Whether a `sais` row exists is not our
        // business: 0122 put "create the สาย on demand" on the students table as
        // a trigger, so any valid 001–999 code lands. Refusing an unseen code
        // here was a per-caller rule contradicting the table's own — the exact
        // shape 0122 exists to stop — and it dead-ended the admin with
        // "แก้ไขไม่ได้" and no way forward.
        const n = normalizeSai(r.requested_value);
        if (!n.ok || !n.value) {
          alert(`สายรหัส “${r.requested_value}”: ${saiProblem(r.requested_value) || 'ไม่ถูกต้อง'}`);
          return;
        }
        patch.sai_code = n.value;
      }
      await updateStudent(r.student_ref, patch);
    }
    await decideRequest(id, approve ? 'approved' : 'rejected', note, getUser()?.id);
    await reload();
  } catch (err) { alert(err?.message || 'ดำเนินการไม่สำเร็จ'); }
}

// ============================================================
// EXPORT
// ============================================================
function exportCsv() {
  if (!students.length) { alert('ยังไม่มีข้อมูลให้ส่งออก'); return; }
  const csv = buildStudentsCsv(students);
  // BOM: Excel opens a UTF-8 CSV as mojibake without it, and this file is full
  // of Thai names.
  const blob = new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `samo-house-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ============================================================
// WIRING
// ============================================================
function wire() {
  document.querySelectorAll('[data-house-mode]').forEach((btn) => {
    btn.addEventListener('click', () => { mode = btn.dataset.houseMode; render(); });
  });
  $('houseReload')?.addEventListener('click', () => reload());
  $('houseExportCsv')?.addEventListener('click', exportCsv);

  $('houseSearch')?.addEventListener('input', renderStudents);
  ['houseFilterHouse', 'houseFilterYear', 'houseFilterMajor'].forEach((id) => {
    $(id)?.addEventListener('change', renderStudents);
  });
  $('houseAddStudent')?.addEventListener('click', () => openStudentModal(null));
  $('houseStudentRows')?.addEventListener('click', (e) => {
    const tr = e.target.closest('[data-student]');
    if (tr) openStudentModal(tr.dataset.student);
  });
  $('houseStudentForm')?.addEventListener('submit', onStudentSubmit);
  $('hsDelete')?.addEventListener('click', onStudentDelete);
  $('hsSai')?.addEventListener('input', updateHouseHint);

  $('houseCards')?.addEventListener('click', (e) => {
    const card = e.target.closest('[data-house-edit]');
    if (card) openHouseModal(Number(card.dataset.houseEdit));
  });
  $('houseEditForm')?.addEventListener('submit', onHouseSubmit);
  $('heIconFile')?.addEventListener('change', onHouseIconPicked);
  $('heIconClear')?.addEventListener('click', () => { houseIconUrl = null; paintHouseIcon(); });
  $('heReset')?.addEventListener('click', () => {
    $('heName').value = ''; $('heSlogan').value = ''; houseIconUrl = null; paintHouseIcon();
  });

  // สายรหัส pane — filters, and the สาย-first อาจารย์ modal.
  $('houseSaiSearch')?.addEventListener('input', renderSais);
  $('houseSaiFilterHouse')?.addEventListener('change', renderSais);
  $('houseSaiOnlyEmpty')?.addEventListener('change', renderSais);
  $('houseSaiGroups')?.addEventListener('click', (e) => {
    const card = e.target.closest('[data-sai]');
    if (card) openSaiModal(card.dataset.sai);
  });
  $('hxAdd')?.addEventListener('click', onSaiAddAdvisor);
  $('hxAdvisors')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-sai-remove]');
    if (btn) onSaiRemoveAdvisor(btn.dataset.saiRemove);
  });

  $('houseAdvisorSearch')?.addEventListener('input', renderAdvisors);
  $('houseAddAdvisor')?.addEventListener('click', () => openAdvisorModal(null));
  $('houseAdvisorRows')?.addEventListener('click', (e) => {
    const tr = e.target.closest('[data-advisor]');
    if (tr) openAdvisorModal(tr.dataset.advisor);
  });
  $('houseAdvisorForm')?.addEventListener('submit', onAdvisorSubmit);
  $('haDelete')?.addEventListener('click', onAdvisorDelete);

  $('houseRequestRows')?.addEventListener('click', (e) => {
    const ok = e.target.closest('[data-req-approve]');
    const no = e.target.closest('[data-req-reject]');
    if (ok) onDecide(ok.dataset.reqApprove, true);
    else if (no) onDecide(no.dataset.reqReject, false);
  });

  $('houseCsvFile')?.addEventListener('change', onCsvPicked);

}

