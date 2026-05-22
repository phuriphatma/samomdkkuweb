// ==============================================
// PR STAFF — Dashboard, Modal, Agent Management
// ==============================================

import { renderTimeline } from './utils.js';
import { db } from './db.js';

// ----------------------------------------------------
// DB row → camelCase ticket shape used by the kanban renderer + modal.
// ----------------------------------------------------
function rowToTicket(r) {
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

let prStaffTicketsCache = [];
let currentActivePrTicketId = null;
let globalPrAgents = [];
let currentPrAssignees = [];

// --------------------------------------------------
// Staff Entry
// PR staff login is handled globally via the navbar sign-in modal
// (see auth.js). The legacy in-form login box was removed when the
// dashboard moved to the Admin tab.
// --------------------------------------------------

/**
 * Enter the PR staff dashboard. Used by the admin tab once the user has
 * been verified as pr_staff (or dev) via the global auth modal.
 */
export async function enterPRStaffDashboard() {
  await loadGlobalAgents();
  await fetchPRStaffTickets();
}

// --------------------------------------------------
// Fetch & Render Staff Tickets
// --------------------------------------------------

export async function fetchPRStaffTickets() {
  const loading = document.getElementById('prStaffLoading');
  const board = document.getElementById('prStaffKanban');
  if (loading) loading.classList.remove('d-none');
  if (board) board.innerHTML = '';

  try {
    const { data, error } = await db
      .from('pr_tickets')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw error;
    if (loading) loading.classList.add('d-none');
    prStaffTicketsCache = (data || []).map(rowToTicket);
    if (prStaffTicketsCache.length > 0) {
      filterPRStaffTickets();
    } else {
      renderPRStaffKanban([]);
    }
  } catch (e) {
    if (loading) loading.classList.add('d-none');
    if (board) board.innerHTML = `<div class="text-danger text-center py-4">เกิดข้อผิดพลาดในการโหลด: ${e.message || e}</div>`;
  }
}

// Canonical kanban statuses (order = column order). Tickets whose status
// is anything else get bucketed via bucketStatus() below.
const KANBAN_STATUSES = [
  'รอ PR รับเรื่อง',
  'PR รับเรื่อง',
  'รับบรีฟแล้ว (กำลังดำเนินการ)',
  'รอโพสต์ตามกำหนดการ',
  'โพสต์เรียบร้อย (เสร็จสิ้น)',
  'ตีกลับให้แก้ไขงาน',
  'กำลังแก้ไขงาน',
];

const STATUS_COLOR = {
  'รอ PR รับเรื่อง': '#fbbf24',                      // amber
  'PR รับเรื่อง': '#3b82f6',                          // blue
  'รับบรีฟแล้ว (กำลังดำเนินการ)': '#8b5cf6',          // violet
  'รอโพสต์ตามกำหนดการ': '#f59e0b',                    // orange
  'โพสต์เรียบร้อย (เสร็จสิ้น)': '#10b981',            // green
  'ตีกลับให้แก้ไขงาน': '#ef4444',                     // red
  'กำลังแก้ไขงาน': '#f97316',                         // bright orange
};

function bucketStatus(rawStatus) {
  const s = (rawStatus || '').toString();
  if (KANBAN_STATUSES.includes(s)) return s;
  // Substring fallbacks for legacy / variant wording
  if (s.includes('เสร็จสิ้น') || s.includes('โพสต์เรียบร้อย')) return 'โพสต์เรียบร้อย (เสร็จสิ้น)';
  if (s.includes('ตีกลับ')) return 'ตีกลับให้แก้ไขงาน';
  if (s.includes('กำลังแก้ไข') || s.includes('แก้ไขงาน')) return 'กำลังแก้ไขงาน';
  if (s.includes('รอโพสต์')) return 'รอโพสต์ตามกำหนดการ';
  if (s.includes('บรีฟ') || s.includes('ดำเนินการ')) return 'รับบรีฟแล้ว (กำลังดำเนินการ)';
  if (s.includes('รับเรื่อง') && !s.includes('รอ')) return 'PR รับเรื่อง';
  return 'รอ PR รับเรื่อง';
}

export function filterPRStaffTickets() {
  const filterEl = document.getElementById('prStaffDeptFilter');
  const filterValue = filterEl ? filterEl.value : 'all';
  const filtered = filterValue === 'all'
    ? prStaffTicketsCache
    : prStaffTicketsCache.filter((t) => t.dept === filterValue);
  renderPRStaffKanban(filtered);
}

function renderPRStaffKanban(tickets) {
  const board = document.getElementById('prStaffKanban');
  if (!board) return;
  board.innerHTML = '';

  // Bucket tickets by status column
  const buckets = new Map(KANBAN_STATUSES.map((s) => [s, []]));
  tickets.forEach((t) => {
    const col = bucketStatus(t.status);
    buckets.get(col).push(t);
  });

  KANBAN_STATUSES.forEach((status) => {
    const list = buckets.get(status) || [];
    const color = STATUS_COLOR[status] || '#94a3b8';

    const column = document.createElement('section');
    column.className = 'pr-kanban-column';
    column.style.setProperty('--col-color', color);

    let cardsHtml;
    if (list.length === 0) {
      cardsHtml = '<div class="pr-kanban-empty">ไม่มีงาน</div>';
    } else {
      cardsHtml = list.map((t) => renderKanbanCard(t)).join('');
    }

    column.innerHTML = `
      <header class="pr-kanban-column-header">
        <span class="pr-kanban-column-dot"></span>
        <span class="pr-kanban-column-title">${escapeHtml(status)}</span>
        <span class="pr-kanban-column-count">${list.length}</span>
      </header>
      <div class="pr-kanban-column-body">${cardsHtml}</div>
    `;

    board.appendChild(column);
  });
}

function renderKanbanCard(t) {
  const originalIndex = prStaffTicketsCache.indexOf(t);
  const rushFlag = t.deadline && t.deadline.includes('ด่วน')
    ? '<span class="pr-kanban-card-rush"><i class="bi bi-rocket-takeoff"></i> ด่วน</span>'
    : '';
  const assigneesHtml = (t.assignees && t.assignees.length > 0)
    ? `<div class="pr-kanban-card-assignees">${t.assignees.map(a => `<span class="pr-kanban-card-assignee"><i class="bi bi-person-fill me-1"></i>${escapeHtml(a)}</span>`).join('')}</div>`
    : '<div class="pr-kanban-card-noassign"><i class="bi bi-person me-1"></i>ยังไม่มีผู้รับผิดชอบ</div>';

  return `
    <article class="pr-kanban-card" tabindex="0" onclick="openPRStaffModal(${originalIndex})"
      onkeydown="if(event.key==='Enter'){openPRStaffModal(${originalIndex});}">
      <div class="d-flex justify-content-between align-items-start gap-2">
        <span class="pr-kanban-card-id">${escapeHtml(t.id)}</span>
        ${rushFlag}
      </div>
      <h6 class="pr-kanban-card-title">${escapeHtml(t.contentName || '(ไม่มีชื่องาน)')}</h6>
      <div class="pr-kanban-card-dept"><i class="bi bi-building"></i> ${escapeHtml(t.dept || '-')}</div>
      ${assigneesHtml}
      <div class="pr-kanban-card-meta">
        <span><i class="bi bi-clock me-1"></i>${escapeHtml(t.date || '')}</span>
      </div>
    </article>
  `;
}

function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
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
    // Fetch current remarks from DB so we don't clobber server-side
    // updates that happened since the modal was opened.
    const { data: existing, error: fetchErr } = await db
      .from('pr_tickets')
      .select('remarks')
      .eq('id', currentActivePrTicketId)
      .maybeSingle();
    if (fetchErr) throw fetchErr;

    const remarks = Array.isArray(existing?.remarks) ? [...existing.remarks] : [];
    const time = new Date().toLocaleString('en-GB', {
      day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
    }).replace(',', '');
    autoLogs.forEach((text) => remarks.push({ time, by: 'ระบบ', text, type: 'log' }));
    if (remark) remarks.push({ time, by: 'ทีม PR', text: remark });

    const update = {
      remarks,
      assignees: currentPrAssignees,
    };
    if (newStatus) update.status = newStatus;
    if (newDeadlineStatus) update.deadline_status = newDeadlineStatus;
    if (newPublishDate) {
      // Convert "YYYY-MM-DD HH:mm" → ISO
      const isoCandidate = newPublishDate.replace(' ', 'T');
      const d = new Date(isoCandidate);
      if (!isNaN(d.getTime())) update.publish_date = d.toISOString();
    }

    const { error: updErr } = await db
      .from('pr_tickets')
      .update(update)
      .eq('id', currentActivePrTicketId);
    if (updErr) throw updErr;

    alert('อัปเดตสถานะงาน PR สำเร็จ!');
    bootstrap.Modal.getInstance(document.getElementById('prStaffManageModal')).hide();
    fetchPRStaffTickets();
  } catch (e) { alert('เกิดข้อผิดพลาดในการบันทึก: ' + (e.message || e)); }
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
    const { error } = await db
      .from('pr_tickets')
      .delete()
      .eq('id', currentActivePrTicketId);
    if (error) throw error;
    alert('ลบงาน PR เรียบร้อยแล้ว!');
    bootstrap.Modal.getInstance(document.getElementById('prStaffManageModal')).hide();
    fetchPRStaffTickets();
  } catch (e) { alert('เกิดข้อผิดพลาดในการลบ: ' + (e.message || e)); }
  finally { btn.disabled = false; btn.innerHTML = ogText; }
}

// --------------------------------------------------
// Agent Management
// --------------------------------------------------

async function loadGlobalAgents() {
  try {
    const { data, error } = await db
      .from('pr_agents')
      .select('agents')
      .eq('id', 1)
      .maybeSingle();
    if (error) throw error;
    globalPrAgents = (data?.agents) || [];
    populateAssigneeDropdown();
  } catch (e) { console.error('Failed to load agents', e); }
}

async function saveGlobalAgents() {
  try {
    const { error } = await db
      .from('pr_agents')
      .update({ agents: globalPrAgents, updated_at: new Date().toISOString() })
      .eq('id', 1);
    if (error) throw error;
  } catch (e) { console.error('Failed to save agents', e); }
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
