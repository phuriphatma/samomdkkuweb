// ==============================================
// VS TRACKING — User ticket tracking & history
// ==============================================

import { formatThaiDate, renderTimeline, escHtml } from './utils.js';
import { db, dbRest } from './db.js';
import { getUser as authGetUser } from './auth.js';

let currentActiveTicketId = null;
let canUserReply = false;
let loggedInUserTickets = [];

// --------------------------------------------------
// Submitter-facing phase model
//
// The 9 internal staff statuses (see vs-staff.js KANBAN_COLUMNS) stay the
// source of truth — the staff board is unchanged. For the STUDENT tracking
// view we collapse those 9 into 4 human phases so a submitter sees a clear
// progress story instead of internal routing jargon. The exact status is
// still shown as a caption, so nothing is hidden.
//
//   0 ส่งเรื่อง   — รอ SE รับเรื่อง (+ any unknown/legacy early status)
//   1 รับเรื่อง   — SE รับเรื่องแล้ว, รออุปนายก*, อุปนายกรับเรื่องแล้ว,
//                   ปฏิเสธ (ส่งคืน SE)  ← a re-consideration bounce, not terminal
//   2 ดำเนินการ  — กำลังดำเนินการ, กำลังติดต่อคณะ
//   3 เสร็จสิ้น   — เสร็จสิ้น
// --------------------------------------------------

export const VS_PHASES = [
  { key: 'submitted', label: 'ส่งเรื่อง',  desc: 'ส่งเรื่องแล้ว รอเจ้าหน้าที่รับเรื่อง',   badge: 'bg-warning text-dark' },
  { key: 'reviewing', label: 'รับเรื่อง',  desc: 'เจ้าหน้าที่กำลังพิจารณาเรื่องของคุณ',    badge: 'bg-info text-dark' },
  { key: 'working',   label: 'ดำเนินการ', desc: 'กำลังดำเนินการแก้ไขปัญหาของคุณ',        badge: 'bg-primary' },
  { key: 'done',      label: 'เสร็จสิ้น',  desc: 'ดำเนินการเสร็จสิ้น',                    badge: 'bg-success' },
];

// Order of checks matters — most-advanced phase wins. "เสร็จสิ้น" first so a
// completed ticket never falls into an earlier branch; then the ดำเนินการ
// band; then anything that reached SE/VP; else the initial ส่งเรื่อง phase.
export function vsPhaseIndex(status) {
  const s = status || '';
  if (s.includes('เสร็จสิ้น')) return 3;
  if (s.includes('ดำเนินการ') || s.includes('ติดต่อคณะ')) return 2;
  if (s.includes('SE รับเรื่องแล้ว') || s.includes('อุปนายก') || s.includes('ปฏิเสธ')) return 1;
  return 0;
}

// Build the 4-node progress stepper. A node is "done" when its phase has
// been passed, "active" (pulsing) when it's the current phase, else pending.
// When the ticket is complete (phase 3) the last node reads done, not active.
function renderVsStepper(status) {
  return renderVsStepperByPhase(vsPhaseIndex(status));
}

// Same stepper, driven by an explicit 0..3 phase index. Used by the public
// board (get_public_vs_board returns a phase, never the raw status).
export function renderVsStepperByPhase(idx) {
  const isComplete = idx === 3;
  return `<div class="vs-stepper" role="list">` + VS_PHASES.map((p, i) => {
    let cls = 'vs-step';
    let inner = String(i + 1);
    if (i < idx || (i === idx && isComplete)) { cls += ' is-done'; inner = '<i class="bi bi-check-lg"></i>'; }
    else if (i === idx) { cls += ' is-active'; }
    return `<div class="${cls}" role="listitem">
        <span class="vs-step-dot">${inner}</span>
        <span class="vs-step-label">${escHtml(p.label)}</span>
      </div>`;
  }).join('') + `</div>`;
}

// Map a vs_tickets DB row to the legacy shape rendererers expect.
function rowToTicket(r) {
  return {
    id: r.id,
    date: r.timestamp || r.created_at,
    problem: r.problem,
    dept: r.target_dept,
    status: r.status,
    // Never surface staff-internal remarks (dedup cross-references that name
    // another ticket's id) to a submitter. The get_vs_ticket_by_id RPC already
    // strips these + nulls duplicate_of (0071); this filters the RPC-missing
    // direct-read fallback too. See mistakes.md (VS duplicate confidentiality).
    remarks: Array.isArray(r.remarks) ? r.remarks.filter((e) => !e?.internal) : [],
    isOwner: false, // overridden by callers when appropriate
  };
}

// --------------------------------------------------
// Track by Ticket ID (Guest)
// --------------------------------------------------

export async function trackWithTicketId() {
  const tId = document.getElementById('trackTicketId').value.trim();
  const alertBox = document.getElementById('trackAlert');
  const btn = document.getElementById('btnTrackGuest');
  if (!tId) { alertBox.classList.remove('d-none'); alertBox.innerText = 'กรุณากรอก Ticket ID'; return; }

  btn.disabled = true; btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>กำลังค้นหา...'; alertBox.classList.add('d-none');
  try {
    // Use the security-definer RPC (migration 0021) so the lookup
    // works whether the caller is signed in or not. Direct table
    // reads via RLS would deny anonymous users — staff-only.
    // Pre-0021 fallback: try the direct read via dbRest if the RPC
    // 404s, so the site still works on databases without the migration.
    let { data, error } = await dbRest('/rpc/get_vs_ticket_by_id', {
      method: 'POST',
      body: { p_id: tId },
    });
    if (error && error.status === 404) {
      if (!window.__samoWarnedGuestRpcVs) {
        window.__samoWarnedGuestRpcVs = true;
        console.warn('[vs-tracking] get_vs_ticket_by_id RPC missing — apply migration 0021_guest_ticket_lookup_rpcs.sql for guest lookup. Falling back to direct read.');
      }
      const tIdEsc = encodeURIComponent(tId);
      ({ data, error } = await dbRest(`/vs_tickets?select=*&id=eq.${tIdEsc}&deleted_at=is.null&limit=1`));
    }
    if (error) throw new Error(error.message || 'ค้นหาล้มเหลว');
    const row = Array.isArray(data) && data.length > 0 ? data[0] : null;
    if (row) {
      currentActiveTicketId = row.id;
      canUserReply = false;
      renderUserDashboard(rowToTicket(row));
      document.getElementById('vsLoginBox').classList.add('d-none');
      document.getElementById('vsDashboardBox').classList.remove('d-none');
      const btnBack = document.getElementById('btnBackToHistory');
      btnBack.innerText = 'กลับหน้าค้นหา'; btnBack.onclick = logoutTrack;
    } else {
      alertBox.classList.remove('d-none');
      alertBox.innerText = 'ไม่พบ Ticket นี้ในระบบ';
    }
  } catch (e) {
    alertBox.classList.remove('d-none');
    alertBox.innerText = e.message || 'เกิดข้อผิดพลาดในการเชื่อมต่อเครือข่าย';
  }
  finally { btn.disabled = false; btn.innerHTML = 'ค้นหาสถานะ'; }
}

// --------------------------------------------------
// Login to View History
// --------------------------------------------------

export async function loginToViewHistory() {
  const alertBox = document.getElementById('trackAlert');
  const btn = document.getElementById('btnTrackLogin');
  const authUser = authGetUser();

  if (!authUser) {
    alertBox.classList.remove('d-none');
    alertBox.innerText = 'กรุณาเข้าสู่ระบบก่อน';
    return;
  }

  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>กำลังโหลด...'; }
  alertBox.classList.add('d-none');

  try {
    const submitterLabel = authUser.email || (authUser.username ? `@${authUser.username}` : '');
    // RLS lets you read your own tickets; the OR matches both linked-by-id
    // (new submissions) and label-matched (migrated legacy rows).
    // dbRest instead of supabase-js .from — same bad-state guard as
    // trackWithTicketId above. PostgREST `or=(...)` syntax in the URL.
    const orClause = `or=(submitter_id.eq.${encodeURIComponent(authUser.id)},submitter_label.eq.${encodeURIComponent(submitterLabel)})`;
    const { data, error } = await dbRest(
      `/vs_tickets?select=*&${orClause}&deleted_at=is.null&order=timestamp.desc`,
    );
    if (error) throw new Error(error.message || 'โหลดประวัติล้มเหลว');
    loggedInUserTickets = (data || []).map(rowToTicket);
    renderUserHistoryList();
    document.getElementById('vsLoginBox').classList.add('d-none');
    document.getElementById('vsDashboardBox').classList.add('d-none');
    document.getElementById('vsUserHistoryBox').classList.remove('d-none');
  } catch (e) {
    alertBox.classList.remove('d-none');
    alertBox.innerText = e.message || 'เกิดข้อผิดพลาดในการเชื่อมต่อเครือข่าย';
  }
  finally { if (btn) { btn.disabled = false; btn.innerHTML = 'เข้าสู่ระบบ'; } }
}

// --------------------------------------------------
// Render User History List
// --------------------------------------------------

function renderUserHistoryList() {
  const listContainer = document.getElementById('userHistoryList');
  listContainer.innerHTML = '';
  if (loggedInUserTickets.length === 0) { listContainer.innerHTML = '<div class="col-12 text-center text-muted mt-4">คุณยังไม่มีประวัติการแจ้งปัญหาในระบบ</div>'; return; }

  loggedInUserTickets.forEach((t) => {
    // Colour by submitter-facing phase (badge text still shows the exact
    // status). Keeps the history list consistent with the detail view.
    const phase = VS_PHASES[vsPhaseIndex(t.status)];
    const badgeColor = phase.badge;
    let strippedProblem = t.problem.replace(/<[^>]+>/g, ' ');

    // Escape every user-text field. strippedProblem is post-stripped
    // HTML so it's plain text already, but we escape again for safety
    // (the strip regex doesn't catch every payload).
    listContainer.insertAdjacentHTML('beforeend', `
      <div class="col-md-6">
        <div class="card shadow-sm border-0 h-100" style="cursor: pointer;" onclick="openTicketDetail('${escHtml(t.id)}')">
          <div class="card-body">
            <div class="d-flex justify-content-between mb-2"><span class="fw-bold text-pink-custom">${escHtml(t.id)}</span><span class="badge ${badgeColor}">${escHtml(t.status)}</span></div>
            <p class="small text-muted mb-1"><i class="bi bi-clock"></i> ${escHtml(t.date)}</p>
            <p class="card-text small text-truncate">${escHtml(strippedProblem)}</p>
          </div>
        </div>
      </div>
    `);
  });
}

// --------------------------------------------------
// Open Individual Ticket Detail
// --------------------------------------------------

export function openTicketDetail(ticketId) {
  const ticket = loggedInUserTickets.find((t) => t.id === ticketId);
  if (ticket) {
    currentActiveTicketId = ticket.id; canUserReply = true;
    renderUserDashboard(ticket);
    document.getElementById('vsUserHistoryBox').classList.add('d-none');
    document.getElementById('vsDashboardBox').classList.remove('d-none');
    const btnBack = document.getElementById('btnBackToHistory');
    btnBack.innerText = 'กลับหน้าประวัติ';
    btnBack.onclick = function () { document.getElementById('vsDashboardBox').classList.add('d-none'); document.getElementById('vsUserHistoryBox').classList.remove('d-none'); };
  }
}

// --------------------------------------------------
// Render User Dashboard
// --------------------------------------------------

function renderUserDashboard(ticket) {
  document.getElementById('dashTicketId').innerText = `Ticket #${ticket.id}`;

  // Friendly phase (derived from the exact status) drives the headline badge
  // and the stepper; the exact 9-status value is still shown as a caption.
  const idx = vsPhaseIndex(ticket.status);
  const phase = VS_PHASES[idx];
  const statusBadge = document.getElementById('dashStatusBadge');
  statusBadge.className = `badge fs-6 rounded-pill px-3 py-2 shadow-sm ${phase.badge}`;
  statusBadge.innerText = phase.label;

  const stepperEl = document.getElementById('dashStepper');
  if (stepperEl) {
    stepperEl.innerHTML =
      renderVsStepper(ticket.status)
      + `<div class="vs-phase-desc">${escHtml(phase.desc)}</div>`
      + `<div class="vs-phase-exact">สถานะโดยละเอียด: ${escHtml(ticket.status)}</div>`;
  }

  const formattedDate = formatThaiDate(ticket.date);
  const deptNote = ticket.status.includes('รออุปนายก') ? `${ticket.dept} (รอพิจารณา)` : ticket.dept;
  document.getElementById('dashTicketDate').innerText = `วันที่แจ้ง: ${formattedDate} | ฝ่ายปัจจุบัน: ${deptNote}`;
  document.getElementById('dashTicketProblem').innerHTML = ticket.problem;

  renderTimeline('dashTimeline', ticket.remarks, formattedDate);
  const remarkBox = document.getElementById('userRemarkBox');
  if (canUserReply) remarkBox.classList.remove('d-none'); else remarkBox.classList.add('d-none');
}

// --------------------------------------------------
// Submit User Remark
// --------------------------------------------------

export async function submitUserRemark() {
  const text = document.getElementById('userRemarkInput').value.trim();
  if (!text) return;
  const btn = document.querySelector('#userRemarkBox .btn-outline-danger');
  const ogText = btn.innerHTML;
  btn.innerHTML = 'กำลังส่ง...'; btn.disabled = true;

  try {
    const { data: existing, error: fetchErr } = await db
      .from('vs_tickets')
      .select('remarks')
      .eq('id', currentActiveTicketId)
      .maybeSingle();
    if (fetchErr) throw fetchErr;
    const remarks = Array.isArray(existing?.remarks) ? [...existing.remarks] : [];
    const time = new Date().toLocaleString('en-GB', {
      day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
    });
    remarks.push({ by: 'ผู้แจ้งปัญหา', time, text });
    // dbRest + return=representation: supabase-js would silently report
    // success on an RLS-blocked update (mistakes.md).
    const idEsc = encodeURIComponent(currentActiveTicketId);
    const { data: updated, error: updErr } = await dbRest(
      `/vs_tickets?id=eq.${idEsc}`,
      { method: 'PATCH', body: { remarks }, prefer: 'return=representation' },
    );
    if (updErr) throw new Error(updErr.message || 'update failed');
    if (!Array.isArray(updated) || updated.length === 0) {
      throw new Error('ส่งข้อความไม่สำเร็จ — ไม่พบ ticket หรือคุณไม่มีสิทธิ์ตอบกลับ');
    }
    document.getElementById('userRemarkInput').value = '';
    loginToViewHistory();
  } catch (e) { alert('ส่งข้อความไม่สำเร็จ: ' + (e.message || e)); }
  finally { btn.innerHTML = ogText; btn.disabled = false; }
}

// --------------------------------------------------
// Logout
// --------------------------------------------------

export function logoutTrack() {
  currentActiveTicketId = null; canUserReply = false; loggedInUserTickets = [];
  document.getElementById('vsDashboardBox').classList.add('d-none');
  document.getElementById('vsUserHistoryBox').classList.add('d-none');
  document.getElementById('vsLoginBox').classList.remove('d-none');
  document.getElementById('trackTicketId').value = '';
  document.getElementById('trackUsername').value = '';
  document.getElementById('trackPassword').value = '';
  document.getElementById('trackAlert').classList.add('d-none');
}
