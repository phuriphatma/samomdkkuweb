// ==============================================
// SHOP DATA — Constants + pure helpers
//
// No DOM, no fetch — just the lookup tables and formatters used across
// products / orders / admin. Pure functions only; safe to unit-test.
// ==============================================

export const SHOP_SOURCES = [
  { id: 'all',      label: 'ทั้งหมด',            en: 'All' },
  { id: 'md',       label: 'MD',                en: 'MD',            color: 'var(--src-md)' },
  { id: 'rt',       label: 'RT',                en: 'RT',            color: 'var(--src-rt)' },
  { id: 'mdi',      label: 'MDI',               en: 'MDI',           color: 'var(--src-mdi)' },
  { id: 'sittikao', label: 'สมาคมสิทธิ์เก่า',     en: 'Sittikao',      color: 'var(--src-sittikao)' },
];

export const SHOP_TYPES = [
  { id: 'all',             label: 'ทุกประเภท',   icon: 'bi-grid' },
  { id: 'apparel-shirt',   label: 'เสื้อยืด',     icon: 'bi-bag' },
  { id: 'apparel-polo',    label: 'เสื้อโปโล',    icon: 'bi-person-vcard' },
  { id: 'apparel-trouser', label: 'กางเกง',      icon: 'bi-bookshelf' },
  { id: 'bag',             label: 'กระเป๋า',     icon: 'bi-handbag' },
  { id: 'stationery',      label: 'เครื่องเขียน', icon: 'bi-pencil' },
];

export const SHOP_SORT = [
  { id: 'newest',     label: 'ล่าสุด' },
  { id: 'price-asc',  label: 'ราคา ต่ำ→สูง' },
  { id: 'price-desc', label: 'ราคา สูง→ต่ำ' },
  { id: 'popular',    label: 'ขายดี' },
];

// Happy-path stages, in order. Off-path statuses (cancel, slip_mismatch,
// refund_pending, refunded, no_show) sit outside this sequence — they're
// shown as a pill but don't lay out the progress track.
export const STAGES_ORDER = ['pending', 'review', 'paid', 'produce', 'ready', 'done'];

export const STAGES_META = {
  // ── happy path ──────────────────────────────────────────────────
  pending:        { label: 'สั่งซื้อแล้ว · รอชำระเงิน',          icon: 'bi-bag-check',          short: 'รอชำระ' },
  review:         { label: 'รอการตรวจสอบสลิป',                   icon: 'bi-receipt',            short: 'ตรวจสลิป' },
  paid:           { label: 'ยืนยันการชำระแล้ว · รอเข้ารอบผลิต',  icon: 'bi-check-circle',       short: 'ชำระแล้ว' },
  produce:        { label: 'กำลังผลิตสินค้า',                    icon: 'bi-tools',              short: 'กำลังผลิต' },
  ready:          { label: 'พร้อมรับ · ดูประกาศวันรับสินค้า',     icon: 'bi-box-seam',           short: 'พร้อมรับ' },
  done:           { label: 'ได้รับสินค้าแล้ว',                    icon: 'bi-bag-check-fill',     short: 'รับแล้ว' },
  // ── off-path (terminal or refund flow) ──────────────────────────
  cancel:         { label: 'ยกเลิกคำสั่งซื้อ',                    icon: 'bi-x-circle',           short: 'ยกเลิก' },
  slip_mismatch:  { label: 'สลิปไม่ตรง · รอแก้ไข',                icon: 'bi-exclamation-triangle', short: 'สลิปไม่ตรง' },
  refund_pending: { label: 'รอคืนเงิน',                          icon: 'bi-arrow-counterclockwise', short: 'รอคืนเงิน' },
  refunded:       { label: 'คืนเงินแล้ว',                        icon: 'bi-cash-coin',          short: 'คืนแล้ว' },
  no_show:        { label: 'ไม่ได้มารับตามรอบ',                  icon: 'bi-question-circle',    short: 'ไม่มารับ' },
};

// Product-level stock status (independent of is_active soft-archive).
export const STOCK_STATUSES = ['available', 'sold_out', 'production_closed'];

export const STOCK_STATUS_META = {
  available:          { label: 'พร้อมจำหน่าย',     ribbon: '',            badgeCls: 'bg-success-subtle text-success border border-success-subtle' },
  sold_out:           { label: 'หมดสต็อก',         ribbon: 'SOLD OUT',     badgeCls: 'bg-danger-subtle text-danger border' },
  production_closed:  { label: 'ปิดรอบการผลิต',   ribbon: 'CLOSED',       badgeCls: 'bg-secondary-subtle text-secondary border' },
};

export function findSource(id) { return SHOP_SOURCES.find((s) => s.id === id); }
export function findType(id)   { return SHOP_TYPES.find((t) => t.id === id); }

/**
 * Aggregate total stock across a size×color matrix. Missing keys count as
 * "unknown / unlimited" (not zero) — admin hasn't filled them in.
 */
export function totalStock(matrix) {
  if (!matrix || typeof matrix !== 'object') return null;
  let sum = 0;
  let any = false;
  for (const v of Object.values(matrix)) {
    if (typeof v === 'number' && Number.isFinite(v)) { sum += v; any = true; }
  }
  return any ? sum : null;
}

/** A size+color combo is OOS when the matrix explicitly stores 0. */
export function stockKey(size, color) {
  return `${size || 'F'}-${color || 'default'}`;
}

/** Format an integer as a baht-style number, e.g. 1290 → "1,290". */
export function thb(n) {
  const v = Number(n) || 0;
  return v.toLocaleString('en-US');
}

/** Format an ISO date to Thai "DD month YY" with Buddhist-era year tail. */
export function fmtDate(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '-';
  const month = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
                 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'][d.getMonth()];
  return `${d.getDate()} ${month} ${((d.getFullYear() + 543)).toString().slice(-2)}`;
}

export function fmtDateTime(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '-';
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${fmtDate(iso)} · ${hh}:${mm}`;
}

/**
 * Generate a new order id of the form "SS-YY-NNNNN".
 * Random-padded; the DB primary key enforces uniqueness, callers retry on
 * collision. (Roughly 1 in 100,000 collision per call — fine at our scale.)
 */
export function genOrderId(now = new Date()) {
  const yy = String(now.getFullYear() + 543).slice(-2); // BE year
  const n = Math.floor(10000 + Math.random() * 89999);  // 5-digit
  return `SS-${yy}-${String(n).padStart(5, '0')}`;
}

/** Slug a string for use in a Drive folder name. */
export function slugify(s) {
  return String(s || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9฀-๿]+/g, '-')  // keep Thai unicode block
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'item';
}

/**
 * Read a batch's dates as a [{date, hours}] list — falls back to legacy
 * parallel `dates[]` + shared `hours` if `dates_full` is missing/empty.
 */
export function batchDateEntries(batch) {
  if (!batch) return [];
  const df = batch.dates_full;
  if (Array.isArray(df) && df.length) {
    return df.map((e) => ({ date: String(e?.date || ''), hours: String(e?.hours || '') }))
             .filter((e) => e.date);
  }
  const legacy = Array.isArray(batch.dates) ? batch.dates : [];
  const sharedHours = String(batch.hours || '');
  return legacy.filter(Boolean).map((d) => ({ date: String(d), hours: sharedHours }));
}
