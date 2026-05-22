// ==============================================
// VS TRACKING — User ticket tracking & history
// ==============================================

import { formatThaiDate, renderTimeline } from './utils.js';
import { db } from './db.js';
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
    const { data, error } = await db
      .from('vs_tickets')
      .select('*')
      .eq('id', tId)
      .maybeSingle();
    if (error) throw error;
    if (data) {
      currentActiveTicketId = data.id;
      canUserReply = false;
      renderUserDashboard(rowToTicket(data));
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
    const { data, error } = await db
      .from('vs_tickets')
      .select('*')
      .or(`submitter_id.eq.${authUser.id},submitter_label.eq.${submitterLabel}`)
      .order('created_at', { ascending: false });
    if (error) throw error;
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

    listContainer.insertAdjacentHTML('beforeend', `
      <div class="col-md-6">
        <div class="card shadow-sm border-0 h-100" style="cursor: pointer;" onclick="openTicketDetail('${t.id}')">
          <div class="card-body">
            <div class="d-flex justify-content-between mb-2"><span class="fw-bold text-pink-custom">${t.id}</span><span class="badge bg-${badgeColor}">${t.status}</span></div>
            <p class="small text-muted mb-1"><i class="bi bi-clock"></i> ${t.date}</p>
            <p class="card-text small text-truncate">${strippedProblem}</p>
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
    const { error: updErr } = await db
      .from('vs_tickets')
      .update({ remarks })
      .eq('id', currentActiveTicketId);
    if (updErr) throw updErr;
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
