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
    // Escape rem.by / rem.text — both come from user input (staff or
    // submitter typing into remark/comment textareas) and end up in
    // innerHTML.
    const label = isLog
      ? `<span class="badge bg-secondary fw-normal">${escHtml(rem.by)}</span>`
      : `<span class="fw-bold">${escHtml(rem.by)}</span>`;

    container.insertAdjacentHTML('beforeend', `
      <div class="mb-4 position-relative">
        <span class="position-absolute top-0 start-0 translate-middle p-2 border border-light rounded-circle" style="left:-1.5rem!important; background-color:${dotColor}!important;"></span>
        <div class="text-muted small">${escHtml(rem.time)}</div>
        <div>${label}</div>
        <div class="${boxClass} rounded p-2 mt-1 small">${icon} ${escHtml(rem.text)}</div>
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

/**
 * Sanitize a URL for safe use in an href attribute. Only allows http(s),
 * mailto, and tel schemes. Returns '#' for anything else (e.g. javascript:,
 * data:, or attribute-injection payloads). Always pair with escHtml() when
 * interpolating into an attribute via innerHTML.
 */
export function safeUrl(s) {
  const u = String(s == null ? '' : s).trim();
  if (/^https?:\/\//i.test(u) || /^mailto:/i.test(u) || /^tel:/i.test(u)) return u;
  return '#';
}

/** Copy text to the clipboard. Returns true on success.
 *  Falls back to a hidden textarea trick if Clipboard API is unavailable
 *  (older mobile browsers, file:// pages). */
export async function copyText(text) {
  const value = String(text == null ? '' : text);
  if (!value) return false;
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch { /* fall through */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = value;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

/** Render an order-id chip: monospaced code + a clipboard-copy button.
 *  Used in shop customer + admin views. Pairs with the global delegated
 *  `[data-copy]` handler set up in main.js / admin-main.js. */
export function orderIdChipHtml(id) {
  const safe = escHtml(id || '—');
  return `<span class="order-id-chip">
    <code>${safe}</code>
    <button type="button" class="btn btn-link btn-sm p-0 ms-1 order-id-copy"
            data-copy="${safe}" title="คัดลอกรหัสคำสั่งซื้อ" aria-label="คัดลอกรหัสคำสั่งซื้อ">
      <i class="bi bi-clipboard"></i>
    </button>
  </span>`;
}
