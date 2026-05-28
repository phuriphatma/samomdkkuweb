// ==============================================
// VS STAFF — Staff Dashboard for Vital Sound (Supabase-backed)
// ==============================================

import { formatThaiDate, renderTimeline, escHtml } from './utils.js';
import { db, dbRest } from './db.js';
import { sendNotify } from './notify.js';
import { getUser as authGetUser } from './auth.js';

let staffTicketsCache = [];
let currentActiveTicketId = null;
let currentStaffRole = null;

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

  if (isVP && user.department) {
    // Lock to the VP's own dept. Hide the picker.
    currentStaffRole = user.department;
    if (select) {
      select.value = currentStaffRole;
      // If their dept isn't in the static option list (legacy markup),
      // add it dynamically so the .value sticks.
      if (select.value !== currentStaffRole) {
        const opt = document.createElement('option');
        opt.value = currentStaffRole;
        opt.textContent = currentStaffRole;
        select.appendChild(opt);
        select.value = currentStaffRole;
      }
      // Hide the picker (the surrounding parent too if it's a wrapper).
      select.classList.add('d-none');
    }
  } else {
    const selected = select && select.value ? select.value : null;
    currentStaffRole = selected || roleArg || 'SE';
    if (select) {
      select.value = currentStaffRole;
      select.classList.remove('d-none');
    }
  }

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
    // Order by `timestamp` (set on both live submissions + migrated rows)
    // rather than created_at (defaults to migration time for legacy rows).
    let query = db.from('vs_tickets').select('*').order('timestamp', { ascending: false });
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
        // Escape every user-text field. Students submit free text to
        // VS tickets; without this, the staff dashboard renders any
        // injected script when an อุปนายก opens the list.
        list.insertAdjacentHTML('beforeend', `
          <div class="col-md-6">
            <div class="card shadow-sm border-0 h-100" style="cursor: pointer;" onclick="openStaffModalByIndex(${idx})">
              <div class="card-body">
                <div class="d-flex justify-content-between mb-2"><span class="fw-bold text-pink-custom">${escHtml(t.id)}</span><span class="badge bg-${badgeColor}">${escHtml(t.status)}</span></div>
                <p class="small text-muted mb-1"><i class="bi bi-clock me-1"></i> ${escHtml(dateStr)}</p>
                <p class="small text-muted mb-1"><i class="bi bi-diagram-3"></i> ฝ่าย: ${escHtml(t.target_dept)}</p>
                <p class="card-text small text-truncate">${escHtml(strippedProblem)}</p>
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
