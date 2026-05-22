// ==============================================
// PR TRACKING — User ticket tracking & history
// ==============================================

import { renderTimeline } from './utils.js';
import { getUser as authGetUser } from './auth.js';
import { dbRest } from './db.js';

let loggedInUserPrTickets = [];

// ----------------------------------------------------
// Map a pr_tickets DB row into the camelCase shape the existing
// renderers (renderPRDashboard, openPRTicketDetail, etc.) expect.
// Keeps the migration minimal — we only had to rewrite the data
// fetch, not the rendering code.
// ----------------------------------------------------
function rowToTicket(r) {
  if (!r) return null;
  const submitDate = r.timestamp ? new Date(r.timestamp) : null;
  const publishDate = r.publish_date ? new Date(r.publish_date) : null;
  const fmt = (d) => d
    ? d.toLocaleString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).replace(',', '')
    : '-';
  return {
    id: r.id,
    date: fmt(submitDate),
    dept: r.department,
    contact: r.contact || '-',
    contentName: r.content_name,
    jobType: r.job_type || '-',
    platforms: Array.isArray(r.platforms) ? r.platforms.join(', ') : (r.platforms || '-'),
    postingChannel: r.posting_channel || '-',
    publishDate: fmt(publishDate),
    deadline: r.deadline_status || 'ปกติ',
    rushReason: r.rush_reason || '-',
    brief: r.brief || '-',
    caption: r.caption || '-',
    fileUrl: r.file_url || 'ไม่มีไฟล์แนบ',
    projectAccount: r.project_account || '-',
    copostWith: r.copost_with || '-',
    submitter: r.submitter_label || '',
    status: r.status,
    remarks: Array.isArray(r.remarks) ? r.remarks : [],
    assignees: Array.isArray(r.assignees) ? r.assignees : [],
    otherPlatforms: Array.isArray(r.other_platforms) ? r.other_platforms.join(', ') : (r.other_platforms || '-'),
    otherPlatformReason: r.other_platform_reason || '-',
  };
}

// --------------------------------------------------
// Track PR by Ticket ID (Guest)
// --------------------------------------------------

export async function trackPRTicket() {
  const tId = document.getElementById('prTrackTicketId').value.trim();
  const alertBox = document.getElementById('prTrackAlert');
  const btn = document.getElementById('btnTrackPrGuest');

  if (!tId) { alertBox.classList.remove('d-none'); alertBox.innerText = 'กรุณากรอก Ticket ID'; return; }
  btn.disabled = true; btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>กำลังค้นหา...'; alertBox.classList.add('d-none');

  try {
    const idEsc = encodeURIComponent(tId.toUpperCase());
    const { data, error } = await dbRest(`/pr_tickets?select=*&id=ilike.${idEsc}&limit=1`);
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : null;
    if (row) {
      renderPRDashboard(rowToTicket(row));
      document.getElementById('prLoginBox').classList.add('d-none');
      document.getElementById('prDashboardBox').classList.remove('d-none');
      document.getElementById('btnPrBackToHistory').onclick = logoutPRTrack;
    } else {
      alertBox.classList.remove('d-none');
      alertBox.innerText = 'ไม่พบ Ticket ID นี้ในระบบ';
    }
  } catch (e) {
    alertBox.classList.remove('d-none');
    alertBox.innerText = e.message || 'เชื่อมต่อเครือข่ายล้มเหลว';
  }
  finally { btn.disabled = false; btn.innerHTML = 'ค้นหาสถานะ'; }
}

// --------------------------------------------------
// Refresh current PR Ticket dashboard
// --------------------------------------------------

export async function refreshPRTicketDashboard() {
  const tId = document.getElementById('prDashTicketId').innerText.trim();
  const btn = document.getElementById('btnRefreshPrDash');
  const ogText = btn.innerHTML;
  btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span>'; btn.disabled = true;

  try {
    const idEsc = encodeURIComponent(tId);
    const { data, error } = await dbRest(`/pr_tickets?select=*&id=eq.${idEsc}&limit=1`);
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : null;
    if (row) renderPRDashboard(rowToTicket(row));
    else alert('ไม่พบ Ticket นี้');
  } catch (e) { alert('เชื่อมต่อเครือข่ายล้มเหลว: ' + (e.message || e)); }
  finally { btn.innerHTML = ogText; btn.disabled = false; }
}

// --------------------------------------------------
// Load PR History (Logged-in user)
// --------------------------------------------------

export async function loadPRHistory() {
  const alertBox = document.getElementById('prTrackAlert');
  const btn = document.getElementById('btnTrackPrUser');
  // PR submitter identifier comes from the unified global auth: email for
  // Google users, "@<username>" for password users. Old GAS-backed history
  // is keyed by whatever string was stored in the SubmitterEmail column,
  // which is the same identifier we now write at submit time.
  const user = authGetUser();
  const email = user?.email || (user?.username ? `@${user.username}` : '');

  if (!user || !email) {
    alertBox.classList.remove('d-none');
    alertBox.innerText = "ไม่พบข้อมูลบัญชี กรุณาเข้าสู่ระบบก่อน"; return;
  }
  btn.disabled = true; btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>กำลังโหลด...'; alertBox.classList.add('d-none');

  try {
    // RLS policy on pr_tickets restricts non-staff readers to their own
    // submitter_id, so we can safely select * for the current user.
    // Also match by submitter_label for legacy rows migrated from sheets
    // that may not have submitter_id linked.
    const idEsc = encodeURIComponent(user.id);
    const labelEsc = encodeURIComponent(email);
    const orFilter = encodeURIComponent(`submitter_id.eq.${idEsc},submitter_label.eq.${labelEsc}`)
      .replace(/%2C/g, ','); // PostgREST or= needs raw commas
    const { data, error } = await dbRest(
      `/pr_tickets?select=*&or=(${orFilter})&order=timestamp.desc`
    );
    if (error) throw error;
    loggedInUserPrTickets = (data || []).map(rowToTicket);
    renderPRHistoryList();
    document.getElementById('prLoginBox').classList.add('d-none');
    document.getElementById('prDashboardBox').classList.add('d-none');
    document.getElementById('prUserHistoryBox').classList.remove('d-none');
  } catch (e) {
    alertBox.classList.remove('d-none');
    alertBox.innerText = e.message || 'ข้อผิดพลาดเครือข่าย';
  }
  finally { btn.disabled = false; btn.innerHTML = 'โหลดประวัติของฉัน'; }
}

// --------------------------------------------------
// Render PR History List
// --------------------------------------------------

function renderPRHistoryList() {
  const list = document.getElementById('prUserHistoryList');
  list.innerHTML = '';
  if (loggedInUserPrTickets.length === 0) {
    list.innerHTML = '<div class="col-12 text-center text-muted mt-4">คุณยังไม่มีประวัติการส่งงาน PR</div>';
    return;
  }
  loggedInUserPrTickets.forEach((t) => {
    let badgeColor = t.status.includes('เสร็จสิ้น') ? 'success' : t.status.includes('รอ') || t.status.includes('แก้ไขงาน') ? 'warning text-dark' : 'primary';
    if (t.status.includes('ตีกลับ')) badgeColor = 'danger';
    list.insertAdjacentHTML('beforeend', `
      <div class="col-md-6">
        <div class="card shadow-sm border-0 h-100" style="cursor: pointer;" onclick="openPRTicketDetail('${t.id}')">
          <div class="card-body">
            <div class="d-flex justify-content-between mb-2"><span class="fw-bold text-pink-custom">${t.id}</span><span class="badge bg-${badgeColor}">${t.status}</span></div>
            <p class="small text-muted mb-1"><i class="bi bi-clock"></i> ${t.date}</p>
            <p class="card-text small fw-bold">${t.contentName}</p>
          </div>
        </div>
      </div>
    `);
  });
}

// --------------------------------------------------
// Open individual PR ticket detail
// --------------------------------------------------

export function openPRTicketDetail(id) {
  const ticket = loggedInUserPrTickets.find((t) => t.id === id);
  if (ticket) {
    renderPRDashboard(ticket);
    document.getElementById('prUserHistoryBox').classList.add('d-none');
    document.getElementById('prDashboardBox').classList.remove('d-none');
    document.getElementById('btnPrBackToHistory').onclick = () => {
      document.getElementById('prDashboardBox').classList.add('d-none');
      document.getElementById('prUserHistoryBox').classList.remove('d-none');
    };
  }
}

// --------------------------------------------------
// Render PR Dashboard (Single Ticket View)
// --------------------------------------------------

function renderPRDashboard(ticket) {
  document.getElementById('prDashTicketId').innerText = ticket.id;
  let badgeColor = ticket.status.includes('เสร็จสิ้น') ? 'bg-success' : ticket.status.includes('รอ') || ticket.status.includes('แก้ไขงาน') ? 'bg-warning text-dark' : 'bg-primary';
  if (ticket.status.includes('ตีกลับ')) badgeColor = 'bg-danger';
  document.getElementById('prDashStatusBadge').className = `badge fs-6 rounded-pill px-3 py-2 shadow-sm ${badgeColor}`;
  document.getElementById('prDashStatusBadge').innerText = ticket.status;

  let html = `
    <p class="mb-1 text-muted small"><strong>วันที่ส่ง:</strong> ${ticket.date}</p>
    <p class="mb-1 small"><strong class="text-pink-custom">ชื่องาน:</strong> ${ticket.contentName}</p>
    <p class="mb-1 small"><strong class="text-pink-custom">ฝ่าย:</strong> ${ticket.dept}</p>
    <p class="mb-1 small"><strong class="text-pink-custom">ช่องทางติดต่อ:</strong> ${ticket.contact}</p>
    <p class="mb-1 small"><strong class="text-pink-custom">รูปแบบงาน:</strong> ${ticket.jobType}</p>
    <p class="mb-1 small"><strong class="text-pink-custom">แพลตฟอร์ม:</strong> ${ticket.platforms}</p>
    <p class="mb-1 small"><strong class="text-pink-custom">ช่องทางการโพสต์:</strong> ${ticket.postingChannel}</p>
    <p class="mb-1 small"><strong class="text-pink-custom">Project Account / Co-post:</strong> ${ticket.projectAccount} / ${ticket.copostWith}</p>
    <p class="mb-1 small"><strong class="text-pink-custom">วันที่ต้องการลง:</strong> ${ticket.publishDate}</p>
  `;

  if (ticket.otherPlatforms && ticket.otherPlatforms !== '-') {
    html += `<p class="mb-1 small"><strong class="text-pink-custom">Other Platform:</strong> ${ticket.otherPlatforms}</p>`;
    if (ticket.otherPlatformReason && ticket.otherPlatformReason !== '-') {
      html += `<div class="alert alert-info py-2 small mt-1 mb-2"><i class="bi bi-chat-left-text-fill me-2"></i><strong>เหตุผลที่ต้องการประชาสัมพันธ์:</strong> ${ticket.otherPlatformReason}</div>`;
    }
  }
  if (ticket.deadline && ticket.deadline.includes('ด่วน')) {
    html += `<div class="alert alert-danger py-2 small mt-2 mb-2"><i class="bi bi-exclamation-triangle-fill me-2"></i><strong>เหตุผลงานด่วน:</strong> ${ticket.rushReason}</div>`;
  }

  // File links
  let linkHTML = '';
  if (!ticket.fileUrl || ticket.fileUrl === 'ไม่มีไฟล์แนบ' || ticket.fileUrl === '-') {
    linkHTML = '<span class="text-muted small border px-2 py-1 rounded bg-light mt-2 d-inline-block"><i class="bi bi-file-earmark-x"></i> ไม่มีไฟล์แนบ (No file)</span>';
  } else {
    const urls = ticket.fileUrl.split('\n');
    urls.forEach((url, index) => {
      if (url.startsWith('http')) {
        linkHTML += `<a href="${url}" target="_blank" class="btn btn-sm btn-outline-primary mt-2 me-2"><i class="bi bi-image"></i> ภาพที่ ${index + 1}</a>`;
      } else if (url.startsWith('ลิงก์เสริม:')) {
        const cleanUrl = url.replace('ลิงก์เสริม:', '').trim();
        linkHTML += `<a href="${cleanUrl}" target="_blank" class="btn btn-sm btn-outline-secondary mt-2 me-2"><i class="bi bi-link-45deg"></i> ลิงก์ G-Drive ส่วนตัว</a>`;
      }
    });
  }

  html += `
    <div class="mt-3 p-3 bg-white border rounded">
      <span class="fw-bold small text-muted d-block mb-1">บรีฟ:</span>
      <div class="small mb-2" style="white-space: pre-line;">${ticket.brief}</div>
      <hr class="my-2">
      <span class="fw-bold small text-muted d-block mb-1">แคปชั่น:</span>
      <div class="small" style="white-space: pre-line;">${ticket.caption}</div>
      ${linkHTML}
    </div>
  `;

  document.querySelector('#prDashboardBox .card-body').innerHTML = html;
  renderTimeline('prDashTimeline', ticket.remarks, ticket.date);
}

// --------------------------------------------------
// Logout / Back
// --------------------------------------------------

export function logoutPRTrack() {
  document.getElementById('prDashboardBox').classList.add('d-none');
  document.getElementById('prUserHistoryBox').classList.add('d-none');
  document.getElementById('prLoginBox').classList.remove('d-none');
  document.getElementById('prTrackTicketId').value = '';
  document.getElementById('prTrackAlert').classList.add('d-none');
}
