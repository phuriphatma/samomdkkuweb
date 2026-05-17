// ==============================================
// VS TRACKING — User ticket tracking & history
// ==============================================

import { GAS_VITAL_SOUND_URL } from './config.js';
import { formatThaiDate, renderTimeline } from './utils.js';

let currentActiveTicketId = null;
let canUserReply = false;
let loggedInUserTickets = [];

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
    const res = await fetch(GAS_VITAL_SOUND_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ action: 'trackVitalSound', ticketId: tId }) });
    const result = await res.json();
    if (result.success) {
      currentActiveTicketId = result.ticket.id;
      canUserReply = false;
      renderUserDashboard(result.ticket);
      document.getElementById('vsLoginBox').classList.add('d-none');
      document.getElementById('vsDashboardBox').classList.remove('d-none');
      const btnBack = document.getElementById('btnBackToHistory');
      btnBack.innerText = 'กลับหน้าค้นหา'; btnBack.onclick = logoutTrack;
    } else { alertBox.classList.remove('d-none'); alertBox.innerText = result.message; }
  } catch (e) { alertBox.classList.remove('d-none'); alertBox.innerText = 'เกิดข้อผิดพลาดในการเชื่อมต่อเครือข่าย'; }
  finally { btn.disabled = false; btn.innerHTML = 'ค้นหาสถานะ'; }
}

// --------------------------------------------------
// Login to View History
// --------------------------------------------------

export async function loginToViewHistory() {
  const user = document.getElementById('trackUsername').value.trim();
  const pass = document.getElementById('trackPassword').value.trim();
  const alertBox = document.getElementById('trackAlert');
  const btn = document.getElementById('btnTrackLogin');
  if (!user || !pass) { alertBox.classList.remove('d-none'); alertBox.innerText = 'กรุณากรอก Username และ Password'; return; }

  btn.disabled = true; btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>กำลังเข้าสู่ระบบ...'; alertBox.classList.add('d-none');
  try {
    const res = await fetch(GAS_VITAL_SOUND_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ action: 'getUserHistory', username: user, password: pass }) });
    const result = await res.json();
    if (result.success) {
      loggedInUserTickets = result.tickets;
      renderUserHistoryList();
      document.getElementById('vsLoginBox').classList.add('d-none');
      document.getElementById('vsDashboardBox').classList.add('d-none');
      document.getElementById('vsUserHistoryBox').classList.remove('d-none');
    } else { alertBox.classList.remove('d-none'); alertBox.innerText = result.message; }
  } catch (e) { alertBox.classList.remove('d-none'); alertBox.innerText = 'เกิดข้อผิดพลาดในการเชื่อมต่อเครือข่าย'; }
  finally { btn.disabled = false; btn.innerHTML = 'เข้าสู่ระบบ'; }
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
    const res = await fetch(GAS_VITAL_SOUND_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ action: 'addRemark', ticketId: currentActiveTicketId, role: 'User', remark: text }) });
    const result = await res.json();
    if (result.success) { document.getElementById('userRemarkInput').value = ''; loginToViewHistory(); }
  } catch (e) { alert('ส่งข้อความไม่สำเร็จ'); }
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
