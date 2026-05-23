// ==============================================
// UTILS — Shared Helper Functions
// ==============================================

/**
 * Format a date value to Thai-style dd/MM/yyyy HH:mm:ss
 * Returns the input as-is if it's already formatted or unparseable.
 */
export function formatThaiDate(dateVal) {
  if (!dateVal) return '-';
  if (typeof dateVal === 'string' && dateVal.includes('/')) return dateVal;
  try {
    const d = new Date(dateVal);
    if (isNaN(d.getTime())) return String(dateVal);
    const pad = (n) => n.toString().padStart(2, '0');
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  } catch (e) {
    return String(dateVal);
  }
}

/**
 * Render a timeline of remarks/logs into a container element.
 * @param {string} containerId - DOM element ID for the timeline container
 * @param {Array} remarks - Array of remark objects {type, by, time, text}
 * @param {string} ticketDate - Date string of ticket creation
 */
export function renderTimeline(containerId, remarks, ticketDate) {
  const container = document.getElementById(containerId);
  container.innerHTML = '';

  // Initial ticket creation entry
  container.insertAdjacentHTML('beforeend', `
    <div class="mb-4 position-relative">
      <span class="position-absolute top-0 start-0 translate-middle p-2 bg-pink-custom border border-light rounded-circle" style="left:-1.5rem!important; background-color:var(--pink-500)!important;"></span>
      <div class="text-muted small">${ticketDate}</div>
      <div class="fw-bold">ระบบ</div>
      <div class="tl-log rounded p-2 mt-1 small">📨 สร้าง Ticket เรียบร้อย — รอผู้ดูแลรับเรื่อง</div>
    </div>
  `);

  if (!remarks || remarks.length === 0) return;

  remarks.forEach((rem) => {
    const isUser = rem.by === 'ผู้แจ้งปัญหา' || rem.by === 'User' || rem.by === 'ผู้ส่งงาน';
    const isLog = rem.type === 'log';

    const dotColor = isLog ? '#94a3b8' : isUser ? '#22c55e' : '#3b82f6';
    const boxClass = isLog ? 'tl-log' : isUser ? 'tl-remark-user' : 'tl-remark-staff';
    const icon = isLog ? '🔧' : isUser ? '💬' : '📝';
    const label = isLog
      ? `<span class="badge bg-secondary fw-normal">${rem.by}</span>`
      : `<span class="fw-bold">${rem.by}</span>`;

    container.insertAdjacentHTML('beforeend', `
      <div class="mb-4 position-relative">
        <span class="position-absolute top-0 start-0 translate-middle p-2 border border-light rounded-circle" style="left:-1.5rem!important; background-color:${dotColor}!important;"></span>
        <div class="text-muted small">${rem.time}</div>
        <div>${label}</div>
        <div class="${boxClass} rounded p-2 mt-1 small">${icon} ${rem.text}</div>
      </div>
    `);
  });
}

/**
 * Decode a Google Identity Services JWT token to extract the payload.
 * Throws a descriptive error rather than the cryptic indexing crashes
 * the naïve implementation gave on malformed input.
 */
export function decodeJwtResponse(token) {
  if (typeof token !== 'string') throw new Error('JWT must be a string');
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Malformed JWT (expected 3 segments)');
  try {
    let base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    base64 += Array((4 - (base64.length % 4)) % 4 + 1).join('=');
    const jsonPayload = decodeURIComponent(
      atob(base64)
        .split('')
        .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    );
    return JSON.parse(jsonPayload);
  } catch (e) {
    throw new Error('JWT decode failed: ' + (e.message || e));
  }
}

/**
 * Escape user-supplied strings before interpolation into innerHTML.
 * Use for non-content fields (title, department, snippet) where the
 * value is plain text. Don't use for Quill-produced HTML content.
 */
export function escHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
