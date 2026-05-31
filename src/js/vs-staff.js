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
// Kanban-only now. List view was dropped — the cross-dept board with
// the dept dropdown filter is the canonical surface for everyone.

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

// One kanban column per status — mirrors the dropdown in modal-vs-staff.html
// so the board reflects exactly the workflow states a staffer can pick.
// Order left → right is the natural progression: incoming → SE → VP →
// in-flight → terminal. Donw stays on the right so finished work doesn't
// crowd active work. Most accounts won't have items in every column;
// the "ซ่อนคอลัมน์ว่าง" toggle (default ON) hides empties.
const KANBAN_COLUMNS = [
  { key: 'waiting_se',     label: 'รอ SE รับเรื่อง',             statuses: ['รอ SE รับเรื่อง'] },
  { key: 'se_acked',       label: 'SE รับเรื่องแล้ว',            statuses: ['SE รับเรื่องแล้ว'] },
  { key: 'urgent_vp',      label: 'รออุปนายก (ด่วน)',            statuses: ['กำลังรออุปนายกพิจารณา (ด่วน)'] },
  { key: 'waiting_vp',     label: 'รออุปนายกพิจารณา',            statuses: ['กำลังรออุปนายกพิจารณา'] },
  { key: 'vp_acked',       label: 'อุปนายกรับเรื่องแล้ว',         statuses: ['อุปนายกรับเรื่องแล้ว'] },
  { key: 'in_progress',    label: 'กำลังดำเนินการ',                statuses: ['กำลังดำเนินการ'] },
  { key: 'faculty_liaison',label: 'กำลังติดต่อคณะ',                statuses: ['กำลังติดต่อคณะ'] },
  { key: 'rejected',       label: 'ปฏิเสธ (ส่งคืน SE)',           statuses: ['ปฏิเสธ (ส่งคืน SE)'] },
  { key: 'done',           label: 'เสร็จสิ้น',                     statuses: ['เสร็จสิ้น'] },
];

// Persisted user preference: hide columns that have 0 tickets.
// Default ON because 9 columns of mostly empty is noisy for any
// account that only touches part of the workflow.
const HIDE_EMPTY_KEY = 'vsKanbanHideEmpty';
function getHideEmpty() {
  const v = localStorage.getItem(HIDE_EMPTY_KEY);
  return v === null ? true : v === '1';
}
function setHideEmpty(on) {
  localStorage.setItem(HIDE_EMPTY_KEY, on ? '1' : '0');
}

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

const ALL_DEPTS = '__all__';

export async function enterVSStaffDashboard(roleArg) {
  const select = document.getElementById('staffRole');
  const user = authGetUser();
  const isVP = user?.role === 'vp_admin';
  const isSuper = user?.role === 'vs_staff' || user?.role === 'dev';

  if (isVP && user.department) {
    // Lock the dept filter to the VP's own dept (RLS allows them
    // nothing else anyway). Picker stays hidden.
    currentStaffRole = user.department;
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
  } else {
    // SE / dev — keep the picker. Default to "all" so the cross-dept
    // triage board is the first thing they see.
    const selected = select && select.value ? select.value : null;
    currentStaffRole = selected || roleArg || ALL_DEPTS;
    if (select) {
      select.value = currentStaffRole;
      select.classList.remove('d-none');
    }
  }

  const titleEl = document.getElementById('staffTitle');
  if (titleEl) {
    titleEl.innerText = `Dashboard: ${currentStaffRole === ALL_DEPTS ? 'ทุกฝ่าย' : currentStaffRole}`;
  }
  // Wire the scroll-affordance listener now that admin DOM is alive.
  bindKanbanScrollAffordance();
  await fetchStaffTickets();
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
    // dbRest (raw PostgREST) instead of db.from(...). The supabase-js
    // client serialises requests behind a session lock that the
    // periodic auth refresh in db.js + the JWT-auto-refresh path in
    // dbRest both contend for; under heavy auth churn a `db.from`
    // read can stall the dashboard for several seconds (or hang
    // entirely per mistakes.md "supabase-js gets into a bad state").
    // dbRest skips supabase-js, has an AbortController timeout, and
    // single-flight refreshes the JWT on 401 — same pattern just
    // applied to pr-staff in dcfd381.
    //
    // ALWAYS fetch all visible tickets — RLS handles the boundary
    // (VPs see only their dept; vs_staff/dev see all). The list view
    // filters client-side by currentStaffRole; the kanban view shows
    // them all grouped by status.
    const { data, error } = await dbRest(
      '/vs_tickets?select=*&order=timestamp.desc',
    );
    if (error) throw new Error(error.message || 'โหลดไม่สำเร็จ');
    staffTicketsCache = data || [];
  } catch (e) {
    console.error('[vs-staff] fetch failed', e);
    staffTicketsCache = [];
  } finally {
    loading?.classList.add('d-none');
  }

  renderKanban();
}

/** Public — toggle the "hide empty columns" preference. */
export function setVsKanbanHideEmpty(on) {
  setHideEmpty(!!on);
  renderKanban();
}

// --------------------------------------------------
// Renderers
// --------------------------------------------------

/** Tickets visible in the current view, respecting the dropdown filter.
 *  Used by both list and kanban renderers — single source of truth so
 *  changing the dropdown updates both surfaces consistently. */
function filteredTickets() {
  if (currentStaffRole === ALL_DEPTS) return staffTicketsCache;
  return staffTicketsCache.filter((t) => t.target_dept === currentStaffRole);
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
  // Reflect the hide-empty checkbox state every render.
  const cb = document.getElementById('vsKanbanHideEmpty');
  if (cb) cb.checked = getHideEmpty();

  // Columns by status. Newest-first across every column — same as the
  // PR kanban. (Was oldest-first for open columns; the "stale at the
  // top" pattern made sense for a triage queue but felt wrong vs PR
  // which staff move between constantly. Age-bucket colour on the
  // card still flags overdue tickets for triage.)
  const base = filteredTickets();
  const hideEmpty = getHideEmpty();

  // Empty state — when the user's filter has zero tickets, render a
  // single full-width placeholder so the surface doesn't look broken.
  if (base.length === 0) {
    wrap.innerHTML = `
      <div class="vs-kanban-empty-state">
        <i class="bi bi-inbox"></i>
        <p>ไม่มี ticket ในมุมมองนี้</p>
        <p class="small">ลองเปลี่ยนตัวกรองฝ่าย หรือกดรีเฟรชด้านบน</p>
      </div>
    `;
    syncKanbanScrollAffordance();
    return;
  }
  // Collect every status string the 9 canonical columns claim, so we
  // can build a catch-all "อื่นๆ" column for tickets with legacy /
  // non-canonical status strings (Sheets-migrated rows in particular).
  // Without this, those tickets are in the cache but absent from
  // every column — silently invisible.
  const knownStatuses = new Set(KANBAN_COLUMNS.flatMap((c) => c.statuses));
  const columnsWithFallback = [
    ...KANBAN_COLUMNS,
    { key: 'other', label: 'อื่นๆ', statuses: null }, // null = catch-all
  ];
  const html = columnsWithFallback.map((col) => {
    const items = col.statuses === null
      ? base.filter((t) => !knownStatuses.has(t.status))
      : base.filter((t) => col.statuses.includes(t.status));
    if (hideEmpty && items.length === 0) return '';
    items.sort((a, b) => ageMs(a) - ageMs(b));   // newest first, every column

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
      <section class="vs-kanban-col ${col.key === 'other' ? 'is-other' : ''}">
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

  // After every render, recompute scroll affordances (left/right fade
  // gradients). Listener attached once; here we just refresh state in
  // case columns just changed.
  syncKanbanScrollAffordance();
}

// --------------------------------------------------
// Scroll affordances — edge fade gradients on the kanban container.
// Pattern from Linear / Apple App Store / Notion gallery: subtle
// gradient on each side that fades as you reach that end. Combined
// with the natural column-peek (next column ~partially visible),
// users feel "more content" without being told. Mobile-friendly.
// --------------------------------------------------

function syncKanbanScrollAffordance() {
  const wrap   = document.getElementById('vsKanbanWrap');
  const kanban = document.getElementById('staffTicketKanban');
  if (!wrap || !kanban) return;
  const max = kanban.scrollWidth - kanban.clientWidth;
  // No overflow at all → hide both fades.
  if (max <= 4) {
    wrap.classList.remove('is-scrolled');
    wrap.classList.add('is-end');
    return;
  }
  wrap.classList.toggle('is-scrolled', kanban.scrollLeft > 8);
  wrap.classList.toggle('is-end', max - kanban.scrollLeft < 8);
}

// Attach the scroll listener once. Lives at module load (the elements
// might not exist yet on first import, so we re-bind on first render
// guarded by a flag).
let scrollAffordanceBound = false;
function bindKanbanScrollAffordance() {
  if (scrollAffordanceBound) return;
  const kanban = document.getElementById('staffTicketKanban');
  if (!kanban) return;
  kanban.addEventListener('scroll', syncKanbanScrollAffordance, { passive: true });
  window.addEventListener('resize', syncKanbanScrollAffordance);
  scrollAffordanceBound = true;
}
// Bind on next microtask so the DOM has the element by the time we run.
queueMicrotask(bindKanbanScrollAffordance);

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
// Delete VS Ticket — vs_staff / dev only (RLS enforces).
// dbRest + return=representation so we surface RLS no-ops as real errors
// (see mistakes.md "supabase-js silent-success" entry).
// --------------------------------------------------

export async function deleteCurrentVSTicket() {
  if (!currentActiveTicketId) return;
  const ticket = staffTicketsCache.find((t) => t.id === currentActiveTicketId);
  const hint = ticket ? `"${(ticket.problem || '').replace(/<[^>]+>/g, ' ').slice(0, 60)}"` : '';
  if (!confirm(`ลบ ticket ${currentActiveTicketId} ${hint} ใช่หรือไม่? ไม่สามารถกู้คืนได้`)) return;

  const idEsc = encodeURIComponent(currentActiveTicketId);
  const { data, error } = await dbRest(
    `/vs_tickets?id=eq.${idEsc}`,
    { method: 'DELETE', prefer: 'return=representation' },
  );
  if (error) {
    alert('ลบไม่สำเร็จ: ' + (error.message || 'unknown'));
    return;
  }
  if (!Array.isArray(data) || data.length === 0) {
    alert('ลบไม่สำเร็จ — ไม่พบ ticket หรือคุณไม่มีสิทธิ์ลบ\n(VP ลบได้เฉพาะ ticket ของฝ่ายตนเอง — โอนคืน SE ก่อนเพื่อให้ SE ลบให้)');
    return;
  }

  // Close the modal + refresh.
  const modalEl = document.getElementById('staffManageModal');
  bootstrap.Modal.getInstance(modalEl)?.hide();
  currentActiveTicketId = null;
  await fetchStaffTickets();
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

  // Guard: a VP can only transfer back to SE — not directly to another
  // VP. RLS (migration 0013's with-check) enforces this server-side; we
  // catch it here with a friendly Thai message before the request fires
  // so users don't see the raw RLS error.
  if (deptChanged) {
    const user = authGetUser();
    if (user?.role === 'vp_admin') {
      const ownDept = user.department || '';
      const isVPDest = (newDept || '').startsWith('อุปนายก');
      if (isVPDest && newDept !== ownDept) {
        alert('ไม่สามารถส่งต่อให้อุปนายกท่านอื่นโดยตรงได้\n\nกรุณาเลือก "โอนคืน SE" เพื่อให้ SE พิจารณาและส่งต่อให้อุปนายกท่านที่เกี่ยวข้อง');
        return;
      }
    }
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
