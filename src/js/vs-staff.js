// ==============================================
// VS STAFF — Staff Dashboard for Vital Sound (Supabase-backed)
// ==============================================

import { formatThaiDate, renderTimeline } from './utils.js';
import { db } from './db.js';

let staffTicketsCache = [];
let currentActiveTicketId = null;
let currentStaffRole = null;

// --------------------------------------------------
// Staff Entry — gated by global auth (Admin tab)
// --------------------------------------------------

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
// Fetch Staff Tickets (Supabase)
// SE sees non-emergency tickets routed to "SE"; everyone else sees
// tickets currently assigned to their dept (target_dept = role).
// --------------------------------------------------

export async function fetchStaffTickets() {
  const loading = document.getElementById('staffLoading');
  const list = document.getElementById('staffTicketList');
  loading.classList.remove('d-none');
  list.innerHTML = '';

  try {
    let query = db.from('vs_tickets').select('*').order('created_at', { ascending: false });
    if (currentStaffRole === 'SE') {
      query = query.eq('target_dept', 'SE');
    } else {
      query = query.eq('target_dept', currentStaffRole);
    }
    const { data, error } = await query;
    if (error) throw error;
    loading.classList.add('d-none');

    if (data && data.length > 0) {
      staffTicketsCache = data;
      data.forEach((t, idx) => {
        let badgeColor = t.status.includes('เสร็จสิ้น') ? 'success' : t.status.includes('รอ') ? 'warning text-dark' : 'primary';
        if (t.status.includes('ด่วน') || t.status.includes('ปฏิเสธ')) badgeColor = 'danger';
        const strippedProblem = (t.problem || '').replace(/<[^>]+>/g, ' ');
        const dateStr = formatThaiDate(t.timestamp || t.created_at);
        list.insertAdjacentHTML('beforeend', `
          <div class="col-md-6">
            <div class="card shadow-sm border-0 h-100" style="cursor: pointer;" onclick="openStaffModalByIndex(${idx})">
              <div class="card-body">
                <div class="d-flex justify-content-between mb-2"><span class="fw-bold text-pink-custom">${t.id}</span><span class="badge bg-${badgeColor}">${t.status}</span></div>
                <p class="small text-muted mb-1"><i class="bi bi-clock me-1"></i> ${dateStr}</p>
                <p class="small text-muted mb-1"><i class="bi bi-diagram-3"></i> ฝ่าย: ${t.target_dept}</p>
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
  } catch (e) {
    loading.classList.add('d-none');
    list.innerHTML = `<div class="col-12 text-center text-danger mt-4">เกิดข้อผิดพลาด: ${e.message || e}</div>`;
  }
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

    const { error: updErr } = await db
      .from('vs_tickets')
      .update(update)
      .eq('id', currentActiveTicketId);
    if (updErr) throw updErr;

    // Fire-and-forget Discord notification via Supabase Edge Function.
    if (notifyTo) {
      db.functions.invoke('notify-vs', {
        body: {
          mode: 'consult',
          ticketId: currentActiveTicketId,
          role: currentStaffRole,
          notifyTo,
          silent: isSilent,
          remark,
          displayDept: newDept || existing.target_dept,
          displayStatus: newStatus || existing.status,
        },
      }).catch((e) => console.warn('[vs] Discord notify failed (non-fatal):', e));
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
