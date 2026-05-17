// ==============================================
// PR STAFF — Dashboard, Modal, Agent Management
// ==============================================

import { GAS_API_URL } from './config.js';
import { renderTimeline } from './utils.js';

let prStaffTicketsCache = [];
let currentActivePrTicketId = null;
let globalPrAgents = [];
let currentPrAssignees = [];

// --------------------------------------------------
// Staff Login
// --------------------------------------------------

export function initPrStaffRemember() {
  if (localStorage.getItem('prStaffUser')) {
    document.getElementById('prStaffUsername').value = localStorage.getItem('prStaffUser');
    document.getElementById('prStaffPassword').value = localStorage.getItem('prStaffPass');
    document.getElementById('prStaffRemember').checked = true;
  }
}

export async function loginPRStaff() {
  const user = document.getElementById('prStaffUsername').value.trim();
  const pass = document.getElementById('prStaffPassword').value.trim();
  const remember = document.getElementById('prStaffRemember').checked;
  const alertBox = document.getElementById('prStaffLoginAlert');
  const btn = document.getElementById('btnPrStaffLogin');

  if (!user || !pass) { alertBox.innerText = 'กรุณากรอก Username/Password'; alertBox.classList.remove('d-none'); return; }
  btn.disabled = true; btn.innerHTML = 'กำลังตรวจสอบ...'; alertBox.classList.add('d-none');

  try {
    const res = await fetch(GAS_API_URL, { method: 'POST', body: JSON.stringify({ action: 'verifyPRStaffLogin', username: user, password: pass }) });
    const result = await res.json();
    if (result.success) {
      await loadGlobalAgents();
      if (remember) {
        localStorage.setItem('prStaffUser', user);
        localStorage.setItem('prStaffPass', pass);
      } else {
        localStorage.removeItem('prStaffUser');
        localStorage.removeItem('prStaffPass');
      }
      await fetchPRStaffTickets();
      document.getElementById('prStaffLoginBox').classList.add('d-none');
      document.getElementById('prStaffDashboardBox').classList.remove('d-none');
    } else { alertBox.innerText = result.message; alertBox.classList.remove('d-none'); }
  } catch (e) { alertBox.innerText = 'เชื่อมต่อล้มเหลว'; alertBox.classList.remove('d-none'); }
  finally { btn.disabled = false; btn.innerHTML = 'เข้าสู่ระบบจัดการ PR'; }
}

export function logoutPRStaff() {
  document.getElementById('prStaffDashboardBox').classList.add('d-none');
  document.getElementById('prStaffLoginBox').classList.remove('d-none');
}

// --------------------------------------------------
// Fetch & Render Staff Tickets
// --------------------------------------------------

export async function fetchPRStaffTickets() {
  const loading = document.getElementById('prStaffLoading');
  const list = document.getElementById('prStaffTicketList');
  loading.classList.remove('d-none'); list.innerHTML = '';

  try {
    const res = await fetch(GAS_API_URL, { method: 'POST', body: JSON.stringify({ action: 'getStaffPRTickets' }) });
    const result = await res.json();
    loading.classList.add('d-none');
    if (result.success && result.tickets.length > 0) {
      prStaffTicketsCache = result.tickets;
      result.tickets.forEach((t, idx) => {
        let bColor = t.status.includes('เสร็จสิ้น') ? 'success' : t.status.includes('รอ') || t.status.includes('แก้ไขงาน') ? 'warning text-dark' : 'primary';
        if (t.status.includes('ตีกลับ')) bColor = 'danger';
        let rushFlag = t.deadline && t.deadline.includes('ด่วน') ? '<span class="badge bg-danger ms-2"><i class="bi bi-rocket-takeoff me-1"></i>ขอไวกว่าปกติ</span>' : '';
        let assigneesHtml = (t.assignees && t.assignees.length > 0)
          ? t.assignees.map(a => `<span class="badge bg-white text-dark border me-1 shadow-sm"><i class="bi bi-person-fill text-pink-custom"></i> ${a}</span>`).join('')
          : '<span class="text-muted small"><i class="bi bi-person"></i> ยังไม่มีผู้รับผิดชอบ</span>';

        list.insertAdjacentHTML('beforeend', `
          <div class="col-md-6">
            <div class="card shadow-sm border-0 h-100" style="cursor: pointer;" onclick="openPRStaffModal(${idx})">
              <div class="card-body d-flex flex-column">
                <div class="d-flex justify-content-between mb-2"><span class="fw-bold text-pink-custom">${t.id}</span><span class="badge bg-${bColor}">${t.status}</span></div>
                <p class="small text-muted mb-1"><i class="bi bi-clock me-1"></i> ${t.date}</p>
                <p class="small text-muted mb-1"><i class="bi bi-building"></i> ${t.dept}</p>
                <p class="card-text small fw-bold text-truncate mb-2">${t.contentName} ${rushFlag}</p>
                <div class="mt-auto border-top pt-2">${assigneesHtml}</div>
              </div>
            </div>
          </div>
        `);
      });
    } else { list.innerHTML = '<div class="col-12 text-center text-muted mt-4">ไม่มีงาน PR ค้างในระบบ</div>'; }
  } catch (e) { loading.classList.add('d-none'); list.innerHTML = '<div class="text-danger text-center">เกิดข้อผิดพลาด</div>'; }
}

// --------------------------------------------------
// Open PR Staff Modal
// --------------------------------------------------

export function openPRStaffModal(idx) {
  const t = prStaffTicketsCache[idx];
  if (!t) return;
  currentActivePrTicketId = t.id;
  document.getElementById('prStaffModalTitle').innerText = t.id;
  document.getElementById('prStaffModalCurrentStatus').innerText = `สถานะปัจจุบัน: ${t.status}`;
  document.getElementById('prStaffModalDept').innerText = t.dept;
  document.getElementById('prStaffModalPubDateText').innerText = t.publishDate;

  // Convert dd/MM/yyyy HH:mm -> yyyy-MM-ddTHH:mm
  let pubDateVal = '';
  if (t.publishDate && t.publishDate !== '-') {
    const m = t.publishDate.match(/(\d{2})\/(\d{2})\/(\d{4})\s(\d{2}:\d{2})/);
    if (m) { pubDateVal = `${m[3]}-${m[2]}-${m[1]}T${m[4]}`; }
    else { pubDateVal = t.publishDate.replace(' ', 'T'); if (pubDateVal.length > 16) pubDateVal = pubDateVal.substring(0, 16); }
  }
  document.getElementById('prStaffActionDate').value = pubDateVal;
  document.getElementById('prStaffModalJobType').innerText = t.jobType;
  document.getElementById('prStaffModalPlatform').innerText = t.platforms;
  document.getElementById('prStaffModalChannel').innerText = t.postingChannel;
  document.getElementById('prStaffModalProjectInfo').innerText = t.projectAccount + ' / ' + t.copostWith;
  document.getElementById('prStaffModalContact').innerText = t.contact;
  document.getElementById('prStaffModalEmail').innerText = t.submitter;

  // Other Platform
  if (t.otherPlatforms && t.otherPlatforms !== '-') {
    document.getElementById('prStaffModalOtherPlatBox').classList.remove('d-none');
    document.getElementById('prStaffModalOtherPlat').innerText = t.otherPlatforms;
    if (t.otherPlatformReason && t.otherPlatformReason !== '-') {
      document.getElementById('prStaffModalOtherPlatReasonBox').classList.remove('d-none');
      document.getElementById('prStaffModalOtherPlatReason').innerText = t.otherPlatformReason;
    } else {
      document.getElementById('prStaffModalOtherPlatReasonBox').classList.add('d-none');
    }
  } else {
    document.getElementById('prStaffModalOtherPlatBox').classList.add('d-none');
  }

  document.getElementById('prStaffModalBrief').innerText = t.brief;
  document.getElementById('prStaffModalCaption').innerText = t.caption;

  if (t.deadline && t.deadline.includes('ด่วน')) {
    document.getElementById('prStaffModalRushReasonBox').classList.remove('d-none');
    document.getElementById('prStaffModalRushReason').innerText = t.rushReason;
  } else {
    document.getElementById('prStaffModalRushReasonBox').classList.add('d-none');
  }

  // File links
  let linkBox = document.getElementById('prStaffModalLinkBox');
  if (!t.fileUrl || t.fileUrl === 'ไม่มีไฟล์แนบ' || t.fileUrl === '-' || !t.fileUrl.startsWith('http')) {
    linkBox.innerHTML = '<span class="text-muted small border px-2 py-1 rounded bg-light"><i class="bi bi-file-earmark-x"></i> ไม่มีไฟล์แนบ (No file)</span>';
  } else {
    let staffLinks = '';
    const urls = t.fileUrl.split('\n');
    urls.forEach((url, index) => {
      if (url.startsWith('http')) {
        staffLinks += `<a href="${url}" target="_blank" class="btn btn-sm btn-outline-primary me-2"><i class="bi bi-image"></i> ดูภาพที่ ${index + 1}</a>`;
      } else if (url.startsWith('ลิงก์เสริม:')) {
        const cleanUrl = url.replace('ลิงก์เสริม:', '').trim();
        staffLinks += `<a href="${cleanUrl}" target="_blank" class="btn btn-sm btn-outline-dark me-2"><i class="bi bi-link-45deg"></i> ลิงก์ G-Drive</a>`;
      }
    });
    linkBox.innerHTML = staffLinks;
  }

  renderTimeline('prStaffModalTimeline', t.remarks, t.date);
  document.getElementById('prStaffActionStatus').value = t.status;
  let currentDeadline = (t.deadline && t.deadline.includes('ด่วน')) ? 'ด่วน (PR Review)' : 'ปกติ';
  document.getElementById('prStaffActionDeadlineStatus').value = currentDeadline;
  document.getElementById('prStaffActionRemark').value = '';
  currentPrAssignees = t.assignees ? [...t.assignees] : [];
  renderPRStaffAssignees();
  bootstrap.Tab.getOrCreateInstance(document.getElementById('pr-staff-detail-tab')).show();
  new bootstrap.Modal(document.getElementById('prStaffManageModal')).show();
}

// --------------------------------------------------
// Submit PR Staff Action
// --------------------------------------------------

export async function submitPRStaffAction() {
  const newStatus = document.getElementById('prStaffActionStatus').value;
  const newDeadlineStatus = document.getElementById('prStaffActionDeadlineStatus').value;
  const remark = document.getElementById('prStaffActionRemark').value.trim();
  const rawDateVal = document.getElementById('prStaffActionDate').value;
  const newPublishDate = rawDateVal.replace('T', ' ');

  const ticket = prStaffTicketsCache.find((t) => t.id === currentActivePrTicketId);
  let autoLogs = [];
  if (ticket) {
    if (newStatus && newStatus !== ticket.status) autoLogs.push(`เปลี่ยนสถานะเป็น: ${newStatus}`);
    if (newDeadlineStatus && newDeadlineStatus !== ticket.deadline) autoLogs.push(`อัปเดตสถานะความด่วนเป็น: ${newDeadlineStatus}`);
    let newDateDisplay = newPublishDate;
    const dtMatch = newPublishDate.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}:\d{2})/);
    if (dtMatch) newDateDisplay = `${dtMatch[3]}/${dtMatch[2]}/${dtMatch[1]} ${dtMatch[4]}`;
    let oldDateClean = ticket.publishDate && ticket.publishDate !== '-' ? ticket.publishDate.substring(0, 16) : 'ไม่มีกำหนดการเดิม';
    if (newPublishDate && newDateDisplay !== oldDateClean) autoLogs.push(`เปลี่ยนวัน-เวลาโพสต์จาก ${oldDateClean} เป็น ${newDateDisplay}`);
  }

  const btn = document.querySelector('#prStaffManageModal .btn-dark');
  btn.disabled = true; btn.innerHTML = 'กำลังบันทึก...';

  try {
    const res = await fetch(GAS_API_URL, {
      method: 'POST', body: JSON.stringify({
        action: 'updatePRTicket', ticketId: currentActivePrTicketId,
        newStatus, newDeadlineStatus, remark, newPublishDate, autoLogs, assignees: currentPrAssignees,
      }),
    });
    const result = await res.json();
    if (result.success) {
      alert('อัปเดตสถานะงาน PR สำเร็จ!');
      bootstrap.Modal.getInstance(document.getElementById('prStaffManageModal')).hide();
      fetchPRStaffTickets();
    } else { alert('เกิดข้อผิดพลาด: ' + result.message); }
  } catch (e) { alert('เกิดข้อผิดพลาดในการบันทึก'); }
  finally { btn.disabled = false; btn.innerHTML = 'บันทึกอัปเดต'; }
}

// --------------------------------------------------
// Delete PR Ticket
// --------------------------------------------------

export async function deletePRStaffAction() {
  if (!confirm('⚠️ คุณแน่ใจหรือไม่ว่าต้องการลบงาน PR นี้? ข้อมูลจะไม่สามารถกู้คืนได้')) return;
  const btn = document.querySelector('#prStaffManageModal .btn-danger');
  const ogText = btn.innerHTML;
  btn.disabled = true; btn.innerHTML = 'กำลังลบ...';

  try {
    const res = await fetch(GAS_API_URL, { method: 'POST', body: JSON.stringify({ action: 'deletePRTicket', ticketId: currentActivePrTicketId }) });
    const result = await res.json();
    if (result.success) {
      alert('ลบงาน PR เรียบร้อยแล้ว!');
      bootstrap.Modal.getInstance(document.getElementById('prStaffManageModal')).hide();
      fetchPRStaffTickets();
    } else { alert('เกิดข้อผิดพลาด: ' + result.message); }
  } catch (e) { alert('เกิดข้อผิดพลาดในการลบ'); }
  finally { btn.disabled = false; btn.innerHTML = ogText; }
}

// --------------------------------------------------
// Agent Management
// --------------------------------------------------

async function loadGlobalAgents() {
  try {
    const res = await fetch(GAS_API_URL, { method: 'POST', body: JSON.stringify({ action: 'getAgents' }) });
    const result = await res.json();
    if (result.success) { globalPrAgents = result.agents || []; populateAssigneeDropdown(); }
  } catch (e) { console.error('Failed to load agents', e); }
}

async function saveGlobalAgents() {
  try { await fetch(GAS_API_URL, { method: 'POST', body: JSON.stringify({ action: 'saveAgents', agents: globalPrAgents }) }); }
  catch (e) { console.error('Failed to save agents', e); }
}

export async function openManageAgentsModal() {
  const btn = document.querySelector('button[onclick="openManageAgentsModal()"]');
  const ogText = btn.innerHTML;
  btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> กำลังโหลด...'; btn.disabled = true;
  await loadGlobalAgents();
  btn.innerHTML = ogText; btn.disabled = false;
  renderManageAgentsList();
  new bootstrap.Modal(document.getElementById('manageAgentsModal')).show();
}

function renderManageAgentsList() {
  const listUI = document.getElementById('globalAgentsListUI');
  listUI.innerHTML = '';
  if (globalPrAgents.length === 0) {
    listUI.innerHTML = '<li class="list-group-item text-center text-muted small py-3">ยังไม่มีรายชื่อทีม</li>';
    return;
  }
  globalPrAgents.forEach((agent, index) => {
    listUI.insertAdjacentHTML('beforeend', `
      <li class="list-group-item d-flex justify-content-between align-items-center bg-light">
        <span class="fw-bold text-secondary">${agent}</span>
        <button class="btn btn-sm btn-outline-danger border-0" onclick="removeAgent(${index})"><i class="bi bi-trash-fill"></i></button>
      </li>
    `);
  });
}

export function addNewAgent() {
  const input = document.getElementById('newAgentNameInput');
  const name = input.value.trim();
  if (name && !globalPrAgents.includes(name)) {
    globalPrAgents.push(name);
    input.value = '';
    renderManageAgentsList();
    populateAssigneeDropdown();
    saveGlobalAgents();
  }
}

export function removeAgent(index) {
  globalPrAgents.splice(index, 1);
  renderManageAgentsList();
  populateAssigneeDropdown();
  saveGlobalAgents();
}

function populateAssigneeDropdown() {
  const select = document.getElementById('prStaffAssigneeSelect');
  if (!select) return;
  select.innerHTML = '<option value="" disabled selected>-- เลือกผู้รับผิดชอบ --</option>';
  globalPrAgents.forEach(agent => {
    select.insertAdjacentHTML('beforeend', `<option value="${agent}">${agent}</option>`);
  });
}

export function addPRStaffAssignee() {
  const select = document.getElementById('prStaffAssigneeSelect');
  const name = select.value;
  if (name && !currentPrAssignees.includes(name)) {
    currentPrAssignees.push(name);
    select.value = '';
    renderPRStaffAssignees();
  }
}

export function removePRStaffAssignee(name) {
  currentPrAssignees = currentPrAssignees.filter(n => n !== name);
  renderPRStaffAssignees();
}

function renderPRStaffAssignees() {
  const list = document.getElementById('prStaffAssigneesList');
  list.innerHTML = '';
  currentPrAssignees.forEach(name => {
    list.insertAdjacentHTML('beforeend', `
      <span class="badge rounded-pill bg-light text-dark border px-3 py-2 d-flex align-items-center shadow-sm">
        ${name}
        <i class="bi bi-x-circle-fill ms-2 text-danger" style="cursor:pointer; font-size: 1.1rem;" onclick="removePRStaffAssignee('${name}')"></i>
      </span>
    `);
  });
}
