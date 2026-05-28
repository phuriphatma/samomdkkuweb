// ==============================================
// VS STAFF — Staff Dashboard for Vital Sound (Supabase-backed)
// ==============================================

import { formatThaiDate, renderTimeline, escHtml } from './utils.js';
import { db, dbRest } from './db.js';
import { sendNotify } from './notify.js';
import { getUser as authGetUser } from './auth.js';

let staffTicketsCache = [];        // ALL tickets visible to this user (RLS-filtered)
let currentActiveTicketId = null;
let currentStaffRole = null;
let currentView = 'list';          // 'list' | 'kanban'

// --------------------------------------------------
// Dept identity — colour + short label per อุปนายก.
// Maps target_dept value → { color, short } for the UI badges.
// --------------------------------------------------

const DEPT_META = {
  'SE':                                            { color: '#6B7280', short: 'SE' },
  'อุปนายกฝ่ายบริหารองค์กร':                       { color: '#A17A60', short: 'บริหาร' },
  'อุปนายกฝ่ายดิจิทัลและสื่อสารองค์กร':            { color: '#F2CB67', short: 'ดิจิทัล' },
  'อุปนายกฝ่ายกิจการภายใน':                       { color: '#E68FAA', short: 'ภายใน' },
  'อุปนายกฝ่ายกิจการภายนอก':                      { color: '#7DB0CD', short: 'ภายนอก' },
  'อุปนายกฝ่ายกิจการมหาวิทยาลัย':                 { color: '#F49D5F', short: 'มหา​วิทยาลัย' },
  'อุปนายกฝ่ายวิชาการ':                            { color: '#2F5F9C', short: 'วิชาการ' },
  'อุปนายกฝ่ายยุทธศาสตร์และพัฒนาองค์กร':           { color: '#318D65', short: 'ยุทธ​ศาสตร์' },
  'อุปนายกฝ่ายคุณภาพชีวิตและสิ่งแวดล้อม':          { color: '#8DC96C', short: 'คุณภาพ' },
  'อุปนายกฝ่ายเวชนิทัศน์':                         { color: '#2294BC', short: 'เวช​นิทัศน์' },
  'อุปนายกฝ่ายรังสีเทคนิค':                        { color: '#9F84BD', short: 'รังสี' },
  'คณะ':                                          { color: '#475569', short: 'คณะ' },
};
const VP_DEPTS = Object.keys(DEPT_META).filter((k) => k.startsWith('อุปนายก'));

function deptColor(name) { return DEPT_META[name]?.color || '#94a3b8'; }
function deptShort(name) { return DEPT_META[name]?.short || name; }

// Group statuses into kanban columns. Lifting "ปฏิเสธ" back into SE
// keeps the board to 4 columns; SE picks it up and re-routes.
const KANBAN_COLUMNS = [
  {
    key: 'se',
    label: 'รอ SE พิจารณา',
    statuses: ['รอ SE รับเรื่อง', 'SE รับเรื่องแล้ว', 'ปฏิเสธ (ส่งคืน SE)'],
  },
  {
    key: 'awaiting_vp',
    label: 'รออุปนายกพิจารณา',
    statuses: ['กำลังรออุปนายกพิจารณา (ด่วน)', 'กำลังรออุปนายกพิจารณา'],
  },
  {
    key: 'in_progress',
    label: 'กำลังพิจารณา',
    statuses: ['อุปนายกรับเรื่องแล้ว', 'กำลังดำเนินการ', 'กำลังติดต่อคณะ'],
  },
  {
    key: 'done',
    label: 'เสร็จสิ้น',
    statuses: ['เสร็จสิ้น'],
  },
];

// --------------------------------------------------
// Age helpers — ticket "age" = ms since timestamp (created_at fallback).
// Thresholds: <24h fresh, 1-3d warming, >3d overdue.
// --------------------------------------------------

const ONE_DAY_MS = 86_400_000;

function ageMs(ticket) {
  const t = ticket.timestamp || ticket.created_at;
  if (!t) return 0;
  return Date.now() - new Date(t).getTime();
}

function ageBucket(ticket) {
  const ms = ageMs(ticket);
  if (ms < ONE_DAY_MS)       return 'fresh';      // green
  if (ms < 3 * ONE_DAY_MS)   return 'warming';    // yellow
  return 'overdue';                                // red
}

function ageLabel(ticket) {
  const ms = ageMs(ticket);
  const days = Math.floor(ms / ONE_DAY_MS);
  if (days >= 1) return `${days}d`;
  const hrs = Math.floor(ms / (60 * 60 * 1000));
  if (hrs >= 1)  return `${hrs}h`;
  const mins = Math.max(1, Math.floor(ms / 60_000));
  return `${mins}m`;
}

function isOverdue(ticket) {
  // Overdue only counts for "still-waiting" statuses — not completed/done.
  if ((ticket.status || '').includes('เสร็จสิ้น')) return false;
  return ageBucket(ticket) === 'overdue';
}

// --------------------------------------------------
// Staff Entry — gated by global auth (Admin tab)
//
// For a VP (role=vp_admin): force the dept filter to THEIR users.department
// and hide the picker entirely — they're only authorized to see their own
// dept's tickets, and the picker would just confuse them. RLS (migration
// 0010) already enforces this at the DB level; this just stops the UI
// from offering a choice that returns nothing.
//
// For vs_staff / dev (super): keep the picker so they can browse any dept.
// --------------------------------------------------

export async function enterVSStaffDashboard(roleArg) {
  const select = document.getElementById('staffRole');
  const user = authGetUser();
  const isVP = user?.role === 'vp_admin';
  const isSuper = user?.role === 'vs_staff' || user?.role === 'dev';

  if (isVP && user.department) {
    // Lock to the VP's own dept. Hide picker + view-toggle + summary.
    currentStaffRole = user.department;
    currentView = 'list';
    if (select) {
      if (![...select.options].some((o) => o.value === currentStaffRole)) {
        const opt = document.createElement('option');
        opt.value = currentStaffRole;
        opt.textContent = currentStaffRole;
        select.appendChild(opt);
      }
      select.value = currentStaffRole;
      select.classList.add('d-none');
    }
    document.getElementById('vsKanbanToggleBtn')?.classList.add('d-none');
    document.getElementById('vsDeptSummary')?.classList.add('d-none');
  } else {
    const selected = select && select.value ? select.value : null;
    currentStaffRole = selected || roleArg || 'SE';
    if (select) {
      select.value = currentStaffRole;
      select.classList.remove('d-none');
    }
    if (isSuper) {
      // Super sees the Kanban toggle + dept summary
      document.getElementById('vsKanbanToggleBtn')?.classList.remove('d-none');
      document.getElementById('vsDeptSummary')?.classList.remove('d-none');
    }
  }

  const titleEl = document.getElementById('staffTitle');
  if (titleEl) titleEl.innerText = `Dashboard: ${currentStaffRole}`;
  await fetchStaffTickets();
}

/** Switch list/kanban view. Public — wired to data-vs-view buttons. */
export function setVsView(view) {
  if (view !== 'list' && view !== 'kanban') return;
  currentView = view;
  // Toggle button active states
  document.querySelectorAll('[data-vs-view]').forEach((b) => {
    b.classList.toggle('active', b.dataset.vsView === view);
  });
  renderActiveView();
}

// --------------------------------------------------
// Fetch Staff Tickets (Supabase)
// SE sees non-emergency tickets routed to "SE"; everyone else sees
// tickets currently assigned to their dept (target_dept = role).
// --------------------------------------------------

export async function fetchStaffTickets() {
  const loading = document.getElementById('staffLoading');
  loading?.classList.remove('d-none');

  try {
    // ALWAYS fetch all visible tickets — RLS handles the
    // boundary (VPs see only their dept; vs_staff/dev see all).
    // The list view filters client-side by currentStaffRole;
    // the kanban view shows them all grouped by status.
    const { data, error } = await db
      .from('vs_tickets')
      .select('*')
      .order('timestamp', { ascending: false });
    if (error) throw error;
    staffTicketsCache = data || [];
  } catch (e) {
    console.error('[vs-staff] fetch failed', e);
    staffTicketsCache = [];
  } finally {
    loading?.classList.add('d-none');
  }

  renderDeptSummary();
  renderActiveView();
}

function renderActiveView() {
  const list   = document.getElementById('staffTicketList');
  const kanban = document.getElementById('staffTicketKanban');
  if (currentView === 'kanban') {
    list?.classList.add('d-none');
    kanban?.classList.remove('d-none');
    renderKanban();
  } else {
    kanban?.classList.add('d-none');
    list?.classList.remove('d-none');
    renderList();
  }
}

// --------------------------------------------------
// Renderers
// --------------------------------------------------

function ticketsForList() {
  // List view = single-dept focus (mirrors the old behaviour).
  return staffTicketsCache.filter((t) => t.target_dept === currentStaffRole);
}

function renderDeptSummary() {
  const wrap = document.getElementById('vsDeptSummary');
  if (!wrap || wrap.classList.contains('d-none')) return;
  // Counts per VP dept — includes overdue breakdown
  const html = VP_DEPTS.map((dept) => {
    const rows = staffTicketsCache.filter(
      (t) => t.target_dept === dept && !(t.status || '').includes('เสร็จสิ้น'),
    );
    if (rows.length === 0) return ''; // omit empty depts to reduce noise
    const overdue = rows.filter(isOverdue).length;
    const c = deptColor(dept);
    return `
      <button type="button" class="vs-dept-chip ${overdue > 0 ? 'has-overdue' : ''}"
        style="--chip-color: ${c};"
        onclick="onVSAdminPickDept('${escHtml(dept)}')">
        <span class="vs-dept-chip-dot"></span>
        <span class="vs-dept-chip-name">${escHtml(deptShort(dept))}</span>
        <span class="vs-dept-chip-count">${rows.length}</span>
        ${overdue > 0 ? `<span class="vs-dept-chip-overdue" title="ค้างเกิน 3 วัน">${overdue}</span>` : ''}
      </button>
    `;
  }).join('');
  wrap.innerHTML = html || '<div class="text-muted small">ไม่มีงานค้างของอุปนายก</div>';
}

function renderList() {
  const list = document.getElementById('staffTicketList');
  if (!list) return;
  list.innerHTML = '';
  const tickets = ticketsForList();
  if (tickets.length === 0) {
    list.innerHTML = '<div class="col-12 text-center text-muted py-5">ไม่มี ticket ในกล่องนี้</div>';
    return;
  }
  tickets.forEach((t, idx) => {
    // We need the cache-index for openStaffModalByIndex.
    const cacheIdx = staffTicketsCache.indexOf(t);
    let badgeColor = t.status.includes('เสร็จสิ้น') ? 'success'
      : t.status.includes('ด่วน') || t.status.includes('ปฏิเสธ') ? 'danger'
      : t.status.includes('รอ') ? 'warning text-dark'
      : 'primary';
    const strippedProblem = (t.problem || '').replace(/<[^>]+>/g, ' ');
    const dateStr = formatThaiDate(t.timestamp || t.created_at);
    list.insertAdjacentHTML('beforeend', `
      <div class="col-md-6">
        <div class="card shadow-sm border-0 h-100 vs-ticket-card" style="cursor: pointer;"
          onclick="openStaffModalByIndex(${cacheIdx})">
          <div class="card-body">
            <div class="d-flex justify-content-between mb-2">
              <span class="fw-bold text-pink-custom">${escHtml(t.id)}</span>
              <span class="badge bg-${badgeColor}">${escHtml(t.status)}</span>
            </div>
            <p class="small text-muted mb-1"><i class="bi bi-clock me-1"></i> ${escHtml(dateStr)} ${renderAgeChip(t)}</p>
            <p class="small text-muted mb-1"><i class="bi bi-diagram-3"></i> ฝ่าย: ${escHtml(t.target_dept)}</p>
            <p class="card-text small text-truncate">${escHtml(strippedProblem)}</p>
          </div>
        </div>
      </div>
    `);
  });
}

// --------------------------------------------------
// Age chip + Kanban render
// --------------------------------------------------

function renderAgeChip(ticket) {
  const bucket = ageBucket(ticket);
  const label  = ageLabel(ticket);
  return `<span class="vs-age-chip is-${bucket}" title="อายุ ticket">${label}</span>`;
}

function renderKanban() {
  const wrap = document.getElementById('staffTicketKanban');
  if (!wrap) return;
  // Columns by status. Open (non-done) statuses sort oldest-first so
  // stale tickets bubble to the top. Done column stays newest-first.
  const html = KANBAN_COLUMNS.map((col) => {
    const items = staffTicketsCache.filter((t) => col.statuses.includes(t.status));
    if (col.key !== 'done') {
      items.sort((a, b) => ageMs(b) - ageMs(a));   // oldest first
    } else {
      items.sort((a, b) => ageMs(a) - ageMs(b));   // newest first
    }
    const overdueCount = items.filter(isOverdue).length;
    const headerBadge = overdueCount > 0
      ? `<span class="vs-kanban-overdue" title="ค้างเกิน 3 วัน">${overdueCount}</span>`
      : '';
    const cardsHtml = items.length === 0
      ? '<div class="vs-kanban-empty">ไม่มี</div>'
      : items.map((t) => {
          const cacheIdx = staffTicketsCache.indexOf(t);
          const strippedProblem = (t.problem || '').replace(/<[^>]+>/g, ' ').slice(0, 90);
          const deptC = deptColor(t.target_dept);
          return `
            <div class="vs-kanban-card is-${ageBucket(t)}"
              style="--card-accent: ${deptC};"
              onclick="openStaffModalByIndex(${cacheIdx})">
              <div class="vs-kanban-card-head">
                <span class="vs-kanban-card-id">${escHtml(t.id)}</span>
                ${renderAgeChip(t)}
              </div>
              <div class="vs-kanban-card-body">${escHtml(strippedProblem)}</div>
              <div class="vs-kanban-card-foot">
                <span class="vs-kanban-card-dept" style="background:${deptC};">${escHtml(deptShort(t.target_dept))}</span>
                ${t.is_emergency ? '<span class="vs-kanban-card-urgent" title="ฉุกเฉิน">ด่วน</span>' : ''}
              </div>
            </div>
          `;
        }).join('');
    return `
      <section class="vs-kanban-col">
        <header class="vs-kanban-col-head">
          <span class="vs-kanban-col-title">${escHtml(col.label)}</span>
          <span class="vs-kanban-col-count">${items.length}</span>
          ${headerBadge}
        </header>
        <div class="vs-kanban-col-body">${cardsHtml}</div>
      </section>
    `;
  }).join('');
  wrap.innerHTML = html;
}

// --------------------------------------------------
// Open Staff Modal
// --------------------------------------------------

export function openStaffModalByIndex(idx) {
  const t = staffTicketsCache[idx];
  if (!t) return;
  openStaffModal(t.id, t.status, t.target_dept, t.problem, t.timestamp || t.created_at, t.remarks || []);
}

function openStaffModal(id, status, dept, problemHTML, date, remarks) {
  currentActiveTicketId = id;
  document.getElementById('staffModalTitle').innerText = id;
  document.getElementById('staffModalCurrentStatus').innerText = `สถานะปัจจุบัน: ${status}`;
  const formattedDate = formatThaiDate(date);
  document.getElementById('staffModalDate').innerText = `วันที่แจ้ง: ${formattedDate} | ฝ่ายที่รับผิดชอบ: ${dept}`;
  document.getElementById('staffModalProblem').innerHTML = problemHTML;
  renderTimeline('staffModalTimeline', remarks, formattedDate);

  document.getElementById('staffActionStatus').value = status;
  document.getElementById('staffActionTransfer').value = dept;
  document.getElementById('staffActionRemark').value = '';
  document.getElementById('staffNotifyTo').value = '';
  document.getElementById('staffSilentNotify').checked = false;
  bootstrap.Tab.getOrCreateInstance(document.getElementById('staff-detail-tab')).show();
  new bootstrap.Modal(document.getElementById('staffManageModal')).show();
}

// --------------------------------------------------
// Submit Staff Action (Supabase update + GAS Discord proxy)
// --------------------------------------------------

export async function submitStaffAction() {
  const newStatus = document.getElementById('staffActionStatus').value;
  const newDept = document.getElementById('staffActionTransfer').value;
  const remark = document.getElementById('staffActionRemark').value.trim();
  const notifyTo = document.getElementById('staffNotifyTo').value;
  const isSilent = document.getElementById('staffSilentNotify').checked;

  const ticket = staffTicketsCache.find((t) => t.id === currentActiveTicketId);
  if (!ticket) return;

  const statusChanged = newStatus && newStatus !== ticket.status;
  const deptChanged = newDept && newDept !== ticket.target_dept;

  if (!statusChanged && !deptChanged && !remark && !notifyTo) {
    alert('ไม่มีการเปลี่ยนแปลง กรุณาแก้ไขสถานะ โอนย้ายฝ่าย เพิ่ม Remark หรือส่งแจ้งเตือน ก่อนบันทึก');
    return;
  }

  const btn = document.querySelector('#staffManageModal .btn-dark');
  btn.disabled = true; btn.innerHTML = 'กำลังบันทึก...';

  try {
    // Refetch remarks to avoid clobbering server-side updates.
    const { data: existing, error: fetchErr } = await db
      .from('vs_tickets')
      .select('remarks, status, target_dept')
      .eq('id', currentActiveTicketId)
      .maybeSingle();
    if (fetchErr) throw fetchErr;

    const remarks = Array.isArray(existing?.remarks) ? [...existing.remarks] : [];
    const time = new Date().toLocaleString('en-GB', {
      day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
    });
    if (statusChanged) {
      remarks.push({ type: 'log', by: currentStaffRole, time, text: `เปลี่ยนสถานะ: "${existing.status}" → "${newStatus}"` });
    }
    if (deptChanged) {
      remarks.push({ type: 'log', by: currentStaffRole, time, text: `โอนย้ายฝ่าย: "${existing.target_dept}" → "${newDept}"` });
    }
    if (notifyTo) {
      remarks.push({ type: 'log', by: currentStaffRole, time, text: `ส่งแจ้งเตือน/ปรึกษา ไปที่ Discord ฝ่าย: "${notifyTo}"` });
    }
    if (remark) {
      remarks.push({ type: 'remark', by: currentStaffRole, time, text: remark });
    }

    const update = { remarks };
    if (statusChanged) update.status = newStatus;
    if (deptChanged) update.target_dept = newDept;

    // dbRest + return=representation so we surface RLS no-ops as errors
    // (see mistakes.md "supabase-js silent-success on RLS-blocked updates").
    const idEsc = encodeURIComponent(currentActiveTicketId);
    const { data: updated, error: updErr } = await dbRest(
      `/vs_tickets?id=eq.${idEsc}`,
      { method: 'PATCH', body: update, prefer: 'return=representation' },
    );
    if (updErr) throw new Error(updErr.message || 'update failed');
    if (!Array.isArray(updated) || updated.length === 0) {
      throw new Error('อัปเดตไม่สำเร็จ — ไม่พบ ticket หรือคุณไม่มีสิทธิ์แก้ไข');
    }

    // Fire-and-forget Discord notification via the unified helper
    // (fetch + keepalive; see notify.js for why not sendBeacon).
    if (notifyTo) {
      sendNotify('vs', {
        mode: 'consult',
        ticketId: currentActiveTicketId,
        role: currentStaffRole,
        notifyTo,
        isSilent,
        remark,
        displayDept: newDept || existing.target_dept,
        displayStatus: newStatus || existing.status,
      });
    }

    alert('อัปเดตข้อมูลสำเร็จ!');
    bootstrap.Modal.getInstance(document.getElementById('staffManageModal')).hide();
    fetchStaffTickets();
  } catch (e) {
    alert('เกิดข้อผิดพลาดในการบันทึก: ' + (e.message || e));
  } finally {
    btn.disabled = false;
    btn.innerHTML = 'บันทึกข้อมูล';
  }
}
