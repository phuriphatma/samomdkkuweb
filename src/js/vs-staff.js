// ==============================================
// VS STAFF — Staff Dashboard for Vital Sound
// ==============================================

import { GAS_VITAL_SOUND_URL } from './config.js';
import { formatThaiDate, renderTimeline } from './utils.js';

let staffTicketsCache = [];
let currentActiveTicketId = null;
let currentStaffRole = null;

// --------------------------------------------------
// Initialize Remember Me
// --------------------------------------------------

export function initVsStaffRemember() {
  if (localStorage.getItem('vsStaffUser')) {
    document.getElementById('staffUsername').value = localStorage.getItem('vsStaffUser');
    document.getElementById('staffPassword').value = localStorage.getItem('vsStaffPass');
    if (localStorage.getItem('vsStaffRole')) {
      document.getElementById('staffRole').value = localStorage.getItem('vsStaffRole');
    }
    document.getElementById('staffRemember').checked = true;
  }
}

// --------------------------------------------------
// Staff Login
// --------------------------------------------------

export async function loginStaff() {
  const user = document.getElementById('staffUsername').value.trim();
  const pass = document.getElementById('staffPassword').value.trim();
  const remember = document.getElementById('staffRemember').checked;
  const alertBox = document.getElementById('staffLoginAlert');
  const btn = document.getElementById('btnStaffLogin');

  if (!user || !pass) { alertBox.innerText = 'กรุณากรอก Username และ Password'; alertBox.classList.remove('d-none'); return; }
  alertBox.classList.add('d-none'); btn.disabled = true; btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>กำลังตรวจสอบ...';

  try {
    const res = await fetch(GAS_VITAL_SOUND_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ action: 'verifyStaffLogin', username: user, password: pass }) });
    const result = await res.json();
    if (result.success) {
      currentStaffRole = document.getElementById('staffRole').value;
      if (remember) {
        localStorage.setItem('vsStaffUser', user);
        localStorage.setItem('vsStaffPass', pass);
        localStorage.setItem('vsStaffRole', currentStaffRole);
      } else {
        localStorage.removeItem('vsStaffUser');
        localStorage.removeItem('vsStaffPass');
        localStorage.removeItem('vsStaffRole');
      }
      document.getElementById('staffTitle').innerText = `Dashboard: ${currentStaffRole}`;
      btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Loading...';
      await fetchStaffTickets();
      document.getElementById('staffLoginBox').classList.add('d-none');
      document.getElementById('staffDashboardBox').classList.remove('d-none');
    } else { alertBox.innerText = result.message; alertBox.classList.remove('d-none'); }
  } catch (e) { alertBox.innerText = 'เกิดข้อผิดพลาดในการเชื่อมต่อเครือข่าย'; alertBox.classList.remove('d-none'); }
  finally { btn.disabled = false; btn.innerHTML = 'เข้าสู่ระบบ'; }
}

export function logoutStaff() {
  currentStaffRole = null;
  document.getElementById('staffDashboardBox').classList.add('d-none');
  document.getElementById('staffLoginBox').classList.remove('d-none');
}

/**
 * Enter the VS staff dashboard. Reads the role from the in-page #staffRole
 * select (which lives in the admin tab now), falling back to the supplied
 * argument and then 'SE'. No login box anymore — the admin tab is gated by
 * the global auth modal.
 */
export async function enterVSStaffDashboard(roleArg) {
  const select = document.getElementById('staffRole');
  const selected = select && select.value ? select.value : null;
  currentStaffRole = selected || roleArg || 'SE';
  if (select) select.value = currentStaffRole;
  const titleEl = document.getElementById('staffTitle');
  if (titleEl) titleEl.innerText = `Dashboard: ${currentStaffRole}`;
  await fetchStaffTickets();
}

// --------------------------------------------------
// Fetch Staff Tickets
// --------------------------------------------------

export async function fetchStaffTickets() {
  const loading = document.getElementById('staffLoading');
  const list = document.getElementById('staffTicketList');
  loading.classList.remove('d-none'); list.innerHTML = '';

  try {
    const res = await fetch(GAS_VITAL_SOUND_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ action: 'getStaffTickets', role: currentStaffRole }) });
    const result = await res.json();
    loading.classList.add('d-none');

    if (result.success && result.tickets.length > 0) {
      staffTicketsCache = result.tickets;
      result.tickets.forEach((t, idx) => {
        let badgeColor = t.status.includes('เสร็จสิ้น') ? 'success' : t.status.includes('รอ') ? 'warning text-dark' : 'primary';
        if (t.status.includes('ด่วน') || t.status.includes('ปฏิเสธ')) badgeColor = 'danger';
        let strippedProblem = t.problem.replace(/<[^>]+>/g, ' ');

        list.insertAdjacentHTML('beforeend', `
          <div class="col-md-6">
            <div class="card shadow-sm border-0 h-100" style="cursor: pointer;" onclick="openStaffModalByIndex(${idx})">
              <div class="card-body">
                <div class="d-flex justify-content-between mb-2"><span class="fw-bold text-pink-custom">${t.id}</span><span class="badge bg-${badgeColor}">${t.status}</span></div>
                <p class="small text-muted mb-1"><i class="bi bi-clock me-1"></i> ${formatThaiDate(t.date)}</p>
                <p class="small text-muted mb-1"><i class="bi bi-diagram-3"></i> ฝ่าย: ${t.dept}</p>
                <p class="card-text small text-truncate">${strippedProblem}</p>
              </div>
            </div>
          </div>
        `);
      });
    } else {
      staffTicketsCache = [];
      list.innerHTML = '<div class="col-12 text-center text-muted mt-4">ไม่มี Ticket ที่ต้องจัดการในขณะนี้</div>';
    }
  } catch (e) { loading.classList.add('d-none'); list.innerHTML = '<div class="col-12 text-center text-danger mt-4">เกิดข้อผิดพลาดในการโหลดข้อมูล</div>'; }
}

// --------------------------------------------------
// Open Staff Modal
// --------------------------------------------------

export function openStaffModalByIndex(idx) {
  const t = staffTicketsCache[idx];
  if (!t) return;
  openStaffModal(t.id, t.status, t.dept, t.problem, t.date, t.remarks || []);
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
// Submit Staff Action
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
  const deptChanged = newDept && newDept !== ticket.dept;

  if (!statusChanged && !deptChanged && !remark && !notifyTo) {
    alert('ไม่มีการเปลี่ยนแปลง กรุณาแก้ไขสถานะ โอนย้ายฝ่าย เพิ่ม Remark หรือส่งแจ้งเตือน ก่อนบันทึก'); return;
  }

  const btn = document.querySelector('#staffManageModal .btn-dark');
  btn.disabled = true; btn.innerHTML = 'กำลังบันทึก...';

  const payload = {
    action: 'updateTicket', ticketId: currentActiveTicketId, role: currentStaffRole,
    newStatus: statusChanged ? newStatus : '', newDept: deptChanged ? newDept : '', remark, notifyTo, isSilent,
  };

  try {
    const res = await fetch(GAS_VITAL_SOUND_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(payload) });
    const result = await res.json();
    if (result.success) {
      alert('อัปเดตข้อมูลสำเร็จ!');
      bootstrap.Modal.getInstance(document.getElementById('staffManageModal')).hide();
      fetchStaffTickets();
    } else { alert('เกิดข้อผิดพลาด: ' + result.message); }
  } catch (e) { alert('เกิดข้อผิดพลาดในการบันทึก'); }
  finally { btn.disabled = false; btn.innerHTML = 'บันทึกข้อมูล'; }
}
