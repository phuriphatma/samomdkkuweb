// ==============================================
// PROJECTS DATA — constants + pure helpers
//
// No DOM, no fetch — lookup tables, status metadata, id generators,
// formatters used across the module. Safe to unit-test.
// ==============================================

export const PROJECT_STATUSES = ['open', 'in_progress', 'completed', 'cancelled'];

export const PROJECT_STATUS_META = {
  open:         { label: 'เปิดรับ',       cls: 'is-open',     icon: 'bi-folder2-open' },
  in_progress:  { label: 'กำลังดำเนินการ', cls: 'is-progress', icon: 'bi-arrow-repeat' },
  completed:    { label: 'เสร็จสิ้น',     cls: 'is-done',     icon: 'bi-check-circle' },
  cancelled:    { label: 'ยกเลิก',        cls: 'is-cancel',   icon: 'bi-x-circle' },
};

// Doc statuses — ordered for the 4-step progress visualisation.
// 'returned' and 'cancelled' are off-path (handled separately in UI).
export const DOC_PATH_ORDER = ['sent', 'received', 'in_progress', 'completed'];

export const DOC_STATUS_META = {
  draft:       { label: 'ฉบับร่าง',         cls: 'is-draft',    icon: 'bi-pencil' },
  sent:        { label: 'ส่งแล้ว',          cls: 'is-sent',     icon: 'bi-send' },
  received:    { label: 'รับเรื่องแล้ว',    cls: 'is-received', icon: 'bi-inbox' },
  in_progress: { label: 'กำลังดำเนินการ',  cls: 'is-progress', icon: 'bi-arrow-repeat' },
  returned:    { label: 'ส่งกลับเพื่อแก้ไข', cls: 'is-returned', icon: 'bi-arrow-counterclockwise' },
  completed:   { label: 'เสร็จสิ้น',        cls: 'is-completed', icon: 'bi-check-circle' },
  cancelled:   { label: 'ยกเลิก',           cls: 'is-cancel',   icon: 'bi-x-circle' },
};

export const NOTIFY_KIND_META = {
  sent:           { icon: 'bi-send',                cls: 'is-info' },
  received:       { icon: 'bi-inbox',               cls: 'is-info' },
  status:         { icon: 'bi-arrow-repeat',        cls: 'is-info' },
  returned:       { icon: 'bi-arrow-counterclockwise', cls: 'is-warn' },
  comment:        { icon: 'bi-chat-left-text',      cls: 'is-info' },
  file_replaced:  { icon: 'bi-arrow-repeat',        cls: 'is-info' },
  completed:      { icon: 'bi-check-circle',        cls: 'is-ok' },
};

// ---- Formatters ----

const THAI_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
                     'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

export function fmtDate(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '-';
  return `${d.getDate()} ${THAI_MONTHS[d.getMonth()]} ${((d.getFullYear() + 543)).toString().slice(-2)}`;
}

export function fmtDateTime(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '-';
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${fmtDate(iso)} · ${hh}:${mm}`;
}

export function fmtRelative(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '-';
  const diff = Date.now() - d.getTime();
  const sec = Math.floor(diff / 1000);
  if (sec < 60)     return 'เมื่อสักครู่';
  if (sec < 3600)   return `${Math.floor(sec / 60)} นาทีที่แล้ว`;
  if (sec < 86400)  return `${Math.floor(sec / 3600)} ชั่วโมงที่แล้ว`;
  if (sec < 604800) return `${Math.floor(sec / 86400)} วันที่แล้ว`;
  return fmtDate(iso);
}

export function fmtBytes(n) {
  const b = Number(n) || 0;
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 * 1024 * 1024) return `${(b / (1024 * 1024)).toFixed(1)} MB`;
  return `${(b / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

// ---- ID generators ----

/** PRJ-YYMM-NNNN (BE year + month + 4-digit random). DB enforces uniqueness. */
export function genProjectId(now = new Date()) {
  const yy = String(now.getFullYear() + 543).slice(-2);
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const n  = Math.floor(1000 + Math.random() * 8999);
  return `PRJ-${yy}${mm}-${n}`;
}

/** DOC-YYMMDD-HHMM-XXXX. */
export function genDocumentId(now = new Date()) {
  const yy = String(now.getFullYear() + 543).slice(-2);
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const mi = String(now.getMinutes()).padStart(2, '0');
  const tail = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `DOC-${yy}${mm}${dd}-${hh}${mi}-${tail}`;
}

/** Slug for Drive folder names — keeps Thai Unicode, strips other chars. */
export function slugify(s) {
  return String(s || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9฀-๿]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'item';
}

/** Build a logical Drive path for a document folder. */
export function buildDocFolderPath(projectId, projectName, documentId, typeId) {
  const projectSlug = slugify(projectName);
  const typeSlug = slugify(typeId || 'doc');
  return `Projects/${projectId}_${projectSlug}/${documentId}_${typeSlug}`;
}
