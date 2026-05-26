// ==============================================
// SHOP DATA — Constants + pure helpers
//
// No DOM, no fetch — just the lookup tables and formatters used across
// products / orders / admin. Pure functions only; safe to unit-test.
// ==============================================

export const SHOP_SOURCES = [
  { id: 'all',     label: 'ทั้งหมด',       en: 'All' },
  { id: 'project', label: 'โครงการ',       en: 'Project',     color: 'var(--src-project)' },
  { id: 'fund',    label: 'จัดหาทุน',      en: 'Fundraising', color: 'var(--src-fund)' },
  { id: 'rt',      label: 'RT',            en: 'RT',          color: 'var(--src-rt)' },
  { id: 'mdi',     label: 'MDI',           en: 'MDI',         color: 'var(--src-mdi)' },
  { id: 'merch',   label: 'ของที่ระลึก',    en: 'Merch',       color: 'var(--src-merch)' },
];

export const SHOP_TYPES = [
  { id: 'all',             label: 'ทุกประเภท',   icon: 'bi-grid' },
  { id: 'apparel-shirt',   label: 'เสื้อยืด',     icon: 'bi-bag' },
  { id: 'apparel-polo',    label: 'เสื้อโปโล',    icon: 'bi-person-vcard' },
  { id: 'apparel-trouser', label: 'กางเกง',      icon: 'bi-bookshelf' },
  { id: 'bag',             label: 'กระเป๋า',     icon: 'bi-handbag' },
  { id: 'accessory',       label: 'ของแถม',     icon: 'bi-stars' },
  { id: 'stationery',      label: 'เครื่องเขียน', icon: 'bi-pencil' },
];

export const SHOP_SORT = [
  { id: 'newest',     label: 'ล่าสุด' },
  { id: 'price-asc',  label: 'ราคา ต่ำ→สูง' },
  { id: 'price-desc', label: 'ราคา สูง→ต่ำ' },
  { id: 'popular',    label: 'ขายดี' },
];

export const STAGES_ORDER = ['pending', 'review', 'paid', 'produce', 'ready', 'done'];

export const STAGES_META = {
  pending: { label: 'รอชำระเงิน',     icon: 'bi-hourglass-split' },
  review:  { label: 'ตรวจสอบสลิป',    icon: 'bi-receipt' },
  paid:    { label: 'ยืนยันการชำระ',   icon: 'bi-check-circle' },
  produce: { label: 'กำลังผลิต',       icon: 'bi-tools' },
  ready:   { label: 'พร้อมรับสินค้า',   icon: 'bi-box-seam' },
  done:    { label: 'รับสินค้าแล้ว',    icon: 'bi-bag-check' },
  cancel:  { label: 'ยกเลิกแล้ว',       icon: 'bi-x-circle' },
};

export function findSource(id) { return SHOP_SOURCES.find((s) => s.id === id); }
export function findType(id)   { return SHOP_TYPES.find((t) => t.id === id); }

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
