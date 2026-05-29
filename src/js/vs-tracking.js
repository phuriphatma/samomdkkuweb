// ==============================================
// VS TRACKING — User ticket tracking & history
// ==============================================

import { formatThaiDate, renderTimeline, escHtml } from './utils.js';
import { db, dbRest } from './db.js';
import { getUser as authGetUser } from './auth.js';

let currentActiveTicketId = null;
let canUserReply = false;
let loggedInUserTickets = [];

// Map a vs_tickets DB row to the legacy shape rendererers expect.
function rowToTicket(r) {
  return {
    id: r.id,
    date: r.timestamp || r.created_at,
    problem: r.problem,
    dept: r.target_dept,
    status: r.status,
    remarks: Array.isArray(r.remarks) ? r.remarks : [],
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
    // dbRest, not supabase-js .from(...): the latter has been hanging
    // on Android Chrome (mistakes.md "supabase-js gets into a bad state").
    const tIdEsc = encodeURIComponent(tId);
    const { data, error } = await dbRest(`/vs_tickets?select=*&id=eq.${tIdEsc}&limit=1`);
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
      `/vs_tickets?select=*&${orClause}&order=timestamp.desc`,
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
    let badgeColor = t.status.includes('เสร็จสิ้น') ? 'success' : t.status.includes('รอ') ? 'warning text-dark' : 'primary';
    if (t.status.includes('ด่วน') || t.status.includes('ปฏิเสธ')) badgeColor = 'danger';
    let strippedProblem = t.problem.replace(/<[^>]+>/g, ' ');

    // Escape every user-text field. strippedProblem is post-stripped
    // HTML so it's plain text already, but we escape again for safety
    // (the strip regex doesn't catch every payload).
    listContainer.insertAdjacentHTML('beforeend', `
      <div class="col-md-6">
        <div class="card shadow-sm border-0 h-100" style="cursor: pointer;" onclick="openTicketDetail('${escHtml(t.id)}')">
          <div class="card-body">
            <div class="d-flex justify-content-between mb-2"><span class="fw-bold text-pink-custom">${escHtml(t.id)}</span><span class="badge bg-${badgeColor}">${escHtml(t.status)}</span></div>
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
  let badgeClass = 'bg-secondary';
  if (ticket.status.includes('รอ')) badgeClass = 'bg-warning text-dark';
  if (ticket.status.includes('ด่วน')) badgeClass = 'bg-danger';
  if (ticket.status.includes('ดำเนินการ') || ticket.status.includes('ติดต่อคณะ')) badgeClass = 'bg-primary';
  if (ticket.status.includes('เสร็จสิ้น')) badgeClass = 'bg-success';
  if (ticket.status.includes('ปฏิเสธ')) badgeClass = 'bg-danger';

  const statusBadge = document.getElementById('dashStatusBadge');
  statusBadge.className = `badge fs-6 rounded-pill px-3 py-2 shadow-sm ${badgeClass}`;
  statusBadge.innerText = ticket.status;

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
