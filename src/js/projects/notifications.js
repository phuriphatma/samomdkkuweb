// ==============================================
// PROJECTS NOTIFICATIONS — bell + offcanvas drawer
//
// Bell lives in the navbar (#navProjectsBell), only visible for the two
// project roles. Clicking opens the offcanvas drawer. Items are
// click-to-jump (calls onJump with project/document ids).
// ==============================================

import { escHtml } from '../utils.js';
import { onAuthChange, getUser } from '../auth.js';
import {
  listMyNotifications,
  countMyUnread,
  markNotificationRead,
  markAllNotificationsRead,
} from './api.js';
import { NOTIFY_KIND_META, fmtRelative } from './data.js';
import { getCachedProjects } from './index.js';

let onJump = () => {};
let offcanvas = null;

const POLL_INTERVAL_MS = 20_000;   // was 60s — felt stale when the other party acted while you were on the page
let pollTimer = null;

export function mountNotifications({ onJump: cb } = {}) {
  if (typeof cb === 'function') onJump = cb;

  const ocEl = document.getElementById('projectsNotifyOffcanvas');
  if (ocEl) offcanvas = window.bootstrap?.Offcanvas.getOrCreateInstance(ocEl);

  const openBell = () => {
    refreshNotificationList();
    offcanvas?.show();
  };
  document.getElementById('navProjectsBell')?.addEventListener('click', openBell);
  document.getElementById('navProjectsBellMobile')?.addEventListener('click', openBell);

  document.getElementById('projectsNotifyMarkAll')?.addEventListener('click', async () => {
    const user = getUser();
    if (!user) return;
    await markAllNotificationsRead(user.id);
    refreshNotificationBell();
    refreshNotificationList();
  });

  document.getElementById('projectsNotifyList')?.addEventListener('click', async (e) => {
    const item = e.target.closest('[data-projects-notify-id]');
    if (!item) return;
    const id = item.dataset.projectsNotifyId;
    const projectId  = item.dataset.projectId || null;
    const documentId = item.dataset.documentId || null;
    await markNotificationRead(id);
    refreshNotificationBell();
    offcanvas?.hide();
    if (projectId || documentId) onJump({ projectId, documentId });
  });

  // Refresh the bell whenever the page becomes visible again (return-to-tab).
  // Without this, a user staring at the screen had to wait up to one poll
  // interval before seeing new activity from the other side.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refreshNotificationBell();
  });

  // Also refresh when the user clicks into the projects tab itself.
  document.addEventListener('shown.bs.tab', (e) => {
    if (e.target?.id === 'pills-projects-tab') refreshNotificationBell();
  });

  onAuthChange((user) => {
    if (!user) {
      stopPolling();
      setBellCount(0);
      return;
    }
    refreshNotificationBell();
    startPolling();
  });
}

function startPolling() {
  stopPolling();
  pollTimer = setInterval(refreshNotificationBell, POLL_INTERVAL_MS);
}
function stopPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}

export async function refreshNotificationBell() {
  const user = getUser();
  if (!user) { setBellCount(0); return; }
  const n = await countMyUnread(user.id);
  setBellCount(n);
}

function setBellCount(n) {
  const apply = (badge) => {
    if (!badge) return;
    if (!n || n <= 0) {
      badge.classList.add('d-none');
      badge.textContent = '0';
    } else {
      badge.classList.remove('d-none');
      badge.textContent = n > 99 ? '99+' : String(n);
    }
  };
  apply(document.getElementById('navProjectsBellCount'));
  apply(document.getElementById('navProjectsBellCountMobile'));
}

async function refreshNotificationList() {
  const wrap = document.getElementById('projectsNotifyList');
  const empty = document.getElementById('projectsNotifyEmpty');
  if (!wrap) return;
  const user = getUser();
  if (!user) {
    wrap.innerHTML = '';
    if (empty) empty.classList.remove('d-none');
    return;
  }
  wrap.innerHTML = '<div class="text-center text-muted py-4"><span class="spinner-border spinner-border-sm me-2"></span>กำลังโหลด…</div>';
  try {
    const list = await listMyNotifications(user.id, { limit: 50 });
    if (list.length === 0) {
      wrap.innerHTML = '';
      if (empty) empty.classList.remove('d-none');
      return;
    }
    if (empty) empty.classList.add('d-none');
    wrap.innerHTML = list.map(renderNotifyItem).join('');
  } catch (e) {
    wrap.innerHTML = `<div class="text-danger small p-3">โหลดการแจ้งเตือนไม่สำเร็จ: ${escHtml(e.message || e)}</div>`;
  }
}

function renderNotifyItem(n) {
  const meta = NOTIFY_KIND_META[n.kind] || { icon: 'bi-bell', cls: 'is-info' };
  // Look up the project name + doc title from the local cache so the
  // notification card answers "which project? which book?" without
  // forcing the reader to expand a row to find out.
  const projects = getCachedProjects() || [];
  const project = n.project_id ? projects.find((p) => p.id === n.project_id) : null;
  let doc = null;
  if (project && n.document_id) {
    doc = (project.documents || []).find((d) => d.id === n.document_id) || null;
  }
  const projectLabel = project ? project.name : (n.project_id || '');
  const docLabel = doc
    ? `หนังสือ #${doc.sequence_no} "${doc.title}"`
    : (n.document_id ? `หนังสือ ${n.document_id}` : '');
  const ctxLine = (projectLabel || docLabel)
    ? `<div class="projects-notify-ctx">
         ${projectLabel ? `<span class="projects-notify-ctx-proj"><i class="bi bi-folder2-open me-1"></i>${escHtml(projectLabel)}</span>` : ''}
         ${docLabel ? `<span class="projects-notify-ctx-doc"><i class="bi bi-journal-text me-1"></i>${escHtml(docLabel)}</span>` : ''}
       </div>`
    : '';
  return `
    <button type="button" class="projects-notify-item ${n.is_read ? '' : 'is-unread'} ${meta.cls}"
      data-projects-notify-id="${n.id}"
      data-project-id="${escHtml(n.project_id || '')}"
      data-document-id="${escHtml(n.document_id || '')}">
      <i class="bi ${meta.icon} projects-notify-icon"></i>
      <div class="projects-notify-body">
        ${ctxLine}
        <div class="projects-notify-text">${escHtml(n.body || '')}</div>
        <div class="projects-notify-time">${escHtml(fmtRelative(n.created_at))}</div>
      </div>
      ${n.is_read ? '' : '<span class="projects-notify-dot"></span>'}
    </button>
  `;
}
