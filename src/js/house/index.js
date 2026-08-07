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
import { uploadTeamPhoto, convertDriveUrl } from '../uploads.js';
import {
  fetchSettings, updateSettings, fetchHouses, updateHouse, fetchSais,
  fetchAdvisors, createAdvisor, updateAdvisor, deleteAdvisor, setAdvisorSais,
  fetchStudents, createStudent, updateStudent, deleteStudent, upsertStudents,
  createImportBatch, fetchRequests, decideRequest, markMissing,
} from './api.js';
import {
  parseStudentsCsv, diffAgainstExisting, toUpsertRow, buildStudentsCsv,
} from './io.js';
import {
  normalizeSai, houseOf, houseLabel, normalizeStudentId, HOUSE_COUNT,
  studentYear as studentYearOf,
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
let settings = null;
let houses = [];
let sais = [];
let students = [];
let advisors = [];
let requests = [];
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
      [settings, houses, sais, students, advisors, requests] = await Promise.all([
        fetchSettings(), fetchHouses(), fetchSais(),
        fetchStudents(), fetchAdvisors(), fetchRequests(),
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
  const verified = students.filter((s) => s.verified_at).length;
  const noSai = students.length - withSai;
  const stats = [
    ['นักศึกษาทั้งหมด', students.length, 'bi-people'],
    ['มีสายรหัสแล้ว', withSai, 'bi-signpost-split'],
    ['ยังไม่มีสายรหัส', noSai, noSai ? 'bi-exclamation-triangle text-warning' : 'bi-check2'],
    ['ยืนยันข้อมูลแล้ว', verified, 'bi-patch-check'],
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

  // Settings. Painted from the loaded row every render so a failed save cannot
  // leave the switch showing a state the database does not have.
  if (settings) {
    const y = $('hsetYear'); if (y) y.value = settings.academic_year ?? '';
    const se = $('hsetSaiEdit'); if (se) se.checked = !!settings.sai_self_edit_open;
    const rv = $('hsetRoster'); if (rv) rv.checked = !!settings.roster_visible;
  }

  const cards = $('houseCards');
  if (!cards) return;
  cards.innerHTML = houses.map((h) => {
    const named = !!String(h.name || '').trim();
    const icon = h.icon_url
      ? `<img src="${escHtml(convertDriveUrl(h.icon_url, 200))}" alt=""
             style="width:48px;height:48px;object-fit:cover;border-radius:12px" />`
      : `<div class="d-flex align-items-center justify-content-center fw-bold"
              style="width:48px;height:48px;border-radius:12px;background:${escHtml(h.color || '#e9ecef')};color:#fff">
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
// The ชั้นปี rule lives in ./fields.js (which mirrors SQL's student_year); this
// used to re-derive `academic_year - cohort + 1` inline, i.e. a THIRD copy of a
// rule that already existed in two places.
const studentYear = (s) => studentYearOf(s, settings?.academic_year);

function filteredStudents() {
  const q = ($('houseSearch')?.value || '').trim().toLowerCase();
  const fh = $('houseFilterHouse')?.value || '';
  const fy = $('houseFilterYear')?.value || '';
  const fm = $('houseFilterMajor')?.value || '';
  return students.filter((s) => {
    if (fh !== '' && String(saiHouse(s.sai_code)) !== fh) return false;
    if (fy !== '' && String(studentYear(s) ?? '') !== fy) return false;
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
  const ySel = $('houseFilterYear');
  if (ySel && ySel.options.length <= 1) {
    for (let y = 1; y <= 6; y += 1) {
      ySel.insertAdjacentHTML('beforeend', `<option value="${y}">ปี ${y}</option>`);
    }
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
          <td>${escHtml(s.full_name || '')}</td>
          <td>${escHtml(s.nickname || '')}</td>
          <td class="text-nowrap">${escHtml(s.student_id || '')}</td>
          <td class="small">${escHtml(s.kkumail || '')}</td>
          <td>${escHtml(s.major || '')}</td>
          <td>${studentYear(s) ?? '—'}</td>
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
function renderSais() {
  const wrap = $('houseSaiGroups');
  if (!wrap) return;
  const byHouse = new Map();
  for (const s of sais) {
    if (!byHouse.has(s.house_id)) byHouse.set(s.house_id, []);
    byHouse.get(s.house_id).push(s);
  }
  const advBySai = new Map();
  for (const a of advisors) {
    for (const link of a.sai_advisors || []) {
      if (!advBySai.has(link.sai_code)) advBySai.set(link.sai_code, []);
      advBySai.get(link.sai_code).push(a);
    }
  }
  const memberCount = new Map();
  for (const s of students) {
    if (!s.sai_code) continue;
    memberCount.set(s.sai_code, (memberCount.get(s.sai_code) || 0) + 1);
  }

  wrap.innerHTML = [...byHouse.entries()].sort((a, b) => a[0] - b[0]).map(([hid, list]) => `
    <div class="mb-3">
      <h6 class="small text-uppercase text-muted">${escHtml(houseName(hid))}</h6>
      <div class="row g-2">
        ${list.map((s) => {
    const adv = advBySai.get(s.code) || [];
    return `
          <div class="col-6 col-md-3 col-lg-2">
            <div class="border rounded p-2 h-100">
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
            <div class="d-flex gap-1">
              <button class="btn btn-sm btn-success" data-req-approve="${escHtml(r.id)}">อนุมัติ</button>
              <button class="btn btn-sm btn-outline-danger" data-req-reject="${escHtml(r.id)}">ปฏิเสธ</button>
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

  const skips = result.problems.filter((p) => p.level === 'skip');
  const warns = result.problems.filter((p) => p.level === 'warn');
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

    ${skips.length || warns.length ? `
      <details class="mb-3">
        <summary class="small">ปัญหาที่พบ ${skips.length + warns.length} รายการ</summary>
        <ul class="small mt-2 mb-0">
          ${[...skips, ...warns].slice(0, 100).map((p) => `
            <li class="${p.level === 'skip' ? 'text-danger' : 'text-warning-emphasis'}">
              ${escHtml(p.message)}</li>`).join('')}
        </ul>
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
    const knownMajors = [...new Set(students.map((s) => s.major).filter(Boolean))];
    const result = parseStudentsCsv(text, knownMajors.length ? knownMajors : ['MD', 'MDI', 'RT']);
    const diff = diffAgainstExisting(result.rows, students);
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
    const batch = await createImportBatch({
      file_name: fileName,
      uploaded_by: getUser()?.id || null,
      row_count: result.rows.length,
      inserted_count: diff.insert,
      updated_count: diff.update,
      unchanged_count: diff.same,
      problem_count: result.problems.length,
    });
    // Chunked: 1,800 rows in one POST is a large body and an all-or-nothing
    // failure. 200 at a time keeps each request small and makes a partial
    // failure legible ("stopped at chunk 4") instead of silent.
    const rows = result.rows.map((r) => toUpsertRow(r, batch?.id));
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
  $('hsMajor').value = s?.major || '';
  $('hsSai').value = s?.sai_code || '';
  $('hsStatus').value = s?.status || 'active';
  $('hsSaiLocked').checked = !!s?.sai_locked;
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
  if (!sai.ok) { alert('สายรหัสต้องเป็นตัวเลขไม่เกิน 3 หลัก'); return; }
  const sid = normalizeStudentId($('hsSid').value);
  const payload = {
    first_name_th: $('hsFirst').value.trim(),
    last_name_th: $('hsLast').value.trim() || null,
    student_id: sid.value,
    kkumail: $('hsMail').value.trim().toLowerCase(),
    major: $('hsMajor').value.trim() || null,
    sai_code: sai.value,
    status: $('hsStatus').value,
    sai_locked: $('hsSaiLocked').checked,
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
  if (!confirm(`ลบ “${s.full_name}” ออกจากระบบ?`)) return;
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
    if (!n.ok || !n.value) { alert(`สายรหัส “${part}” ไม่ถูกต้อง`); return; }
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
  if (!a || !confirm(`ลบอาจารย์ “${a.full_name}” ?`)) return;
  try {
    await deleteAdvisor(id);
    modalInstance('houseAdvisorModal')?.hide();
    await reload();
  } catch (err) { alert(err?.message || 'ลบไม่สำเร็จ'); }
}

// ---------- requests ----------
async function onDecide(id, approve) {
  const r = requests.find((x) => x.id === id);
  if (!r) return;
  const note = approve ? null : (prompt('เหตุผลที่ปฏิเสธ (จะแสดงให้นักศึกษาเห็น)') || null);
  if (!approve && note === null) return;   // cancelled the prompt
  try {
    if (approve) {
      // Apply the change first; only mark it approved if the write landed. The
      // other order would leave a request stamped "approved" whose edit never
      // happened, which is worse than a request that has to be redone.
      const patch = {};
      if (r.field === 'cohort_year') patch[r.field] = Number(r.requested_value) || null;
      else patch[r.field] = r.requested_value || null;
      if (r.field === 'sai_code') {
        const n = normalizeSai(r.requested_value);
        if (!n.ok || !sais.some((s) => s.code === n.value)) {
          alert(`สายรหัส “${r.requested_value}” ไม่ถูกต้อง — แก้ไขไม่ได้`); return;
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

  $('hsetYear')?.addEventListener('change', () => saveSetting({
    academic_year: Number($('hsetYear').value) || null,
  }));
  $('hsetSaiEdit')?.addEventListener('change', () => saveSetting({
    sai_self_edit_open: $('hsetSaiEdit').checked,
  }));
  $('hsetRoster')?.addEventListener('change', () => saveSetting({
    roster_visible: $('hsetRoster').checked,
  }));
}

async function saveSetting(patch) {
  try {
    settings = await updateSettings(patch);
    setStatus('บันทึกการตั้งค่าแล้ว');
    setTimeout(() => setStatus(''), 2000);
  } catch (err) {
    setStatus(err?.message || 'บันทึกการตั้งค่าไม่สำเร็จ', true);
    render();   // repaint the switch back to what the database actually holds
  }
}
