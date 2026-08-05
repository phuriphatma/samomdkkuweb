// team-vocab.js — the display vocabulary for ทีม SAMO grants.
//
// These four lists were previously literals inside src/js/team/index.js, which
// is an ADMIN-only module. The public site now has to name the same things (the
// "ตำแหน่งของฉัน" card tells a signed-in member what they hold), and copying the
// labels across the two entry points is the "two implementations of one rule
// drift" bug from mistakes.md waiting to happen — a permission key renamed in
// the admin catalogue would silently render as a raw key on the public card.
//
// So: ONE source, imported by both. Values are contracts with the database and
// must not be edited casually:
//   • PERM_CATALOG keys      → team_nodes/team_members.permissions[] and every
//                              current_user_has_permission('…') branch in RLS.
//   • VS_DEPTS values        → vs_tickets.target_dept, matched by string.
//   • PROJECT_SEATS values   → team_*.project_seat (migration 0086).
// Labels are display-only and safe to reword.

export const PERM_CATALOG = [
  { key: 'pr',       label: 'PR' },
  { key: 'vs',       label: 'VitalSound' },
  { key: 'samoshop', label: 'SAMO Shop' },
  { key: 'projects', label: 'หนังสือโครงการ' },
  { key: 'creator',  label: 'เขียนประกาศ' },
  { key: 'team',     label: 'ทีม SAMO' },
  { key: 'passport', label: 'SAMO Passport' },
];
export const PERM_LABEL = Object.fromEntries(PERM_CATALOG.map((p) => [p.key, p.label]));

// VitalSound departments (vs_tickets.target_dept). Binding a node — or a
// single person (0083) — to one of these (`vs_dept`) scopes VS access to that
// dept. The binding IS the VS grant's scope: a row carries EITHER the full
// `vs` permission (all depts) OR a vs_dept (that dept only), never both —
// `vs` is an unconditional true branch in every VS policy and would swallow
// the narrower dept check. See migration 0083.
// Values MUST match the VS dept strings exactly; labels are the short display
// names (same set as the VS staff dept dropdown).
export const VS_DEPTS = [
  { value: 'นายกสโม',                                 label: 'นายกสโม' },
  { value: 'SE',                                       label: 'SE (Student Engagement)' },
  { value: 'อุปนายกฝ่ายบริหารองค์กร',                  label: 'บริหารองค์กร' },
  { value: 'อุปนายกฝ่ายดิจิทัลและสื่อสารองค์กร',       label: 'ดิจิทัลและสื่อสาร' },
  { value: 'อุปนายกฝ่ายกิจการภายใน',                   label: 'กิจการภายใน' },
  { value: 'อุปนายกฝ่ายกิจการภายนอก',                  label: 'กิจการภายนอก' },
  { value: 'อุปนายกฝ่ายกิจการมหาวิทยาลัย',             label: 'กิจการมหาวิทยาลัย' },
  { value: 'อุปนายกฝ่ายวิชาการ',                       label: 'วิชาการ' },
  { value: 'อุปนายกฝ่ายยุทธศาสตร์และพัฒนาองค์กร',      label: 'ยุทธศาสตร์' },
  { value: 'อุปนายกฝ่ายคุณภาพชีวิตและสิ่งแวดล้อม',     label: 'คุณภาพชีวิต' },
  { value: 'อุปนายกฝ่ายเวชนิทัศน์',                    label: 'เวชนิทัศน์' },
  { value: 'อุปนายกฝ่ายรังสีเทคนิค',                   label: 'รังสีเทคนิค' },
];
export const VS_DEPT_LABEL = Object.fromEntries(VS_DEPTS.map((d) => [d.value, d.label]));

// หนังสือโครงการ seats (team_nodes/team_members.project_seat, migration 0086).
// Projects is NOT one capability — it is three workflows keyed off the seat,
// so a `projects` grant without one leaves the person with no controls.
export const PROJECT_SEATS = [
  { value: 'vpa',   label: 'ผู้ส่งหนังสือ (SAMO)' },
  { value: 'staff', label: 'เจ้าหน้าที่คณะ' },
  { value: 'prof',  label: 'อาจารย์ (ลงนาม)' },
];
export const PROJECT_SEAT_LABEL = Object.fromEntries(PROJECT_SEATS.map((s) => [s.value, s.label]));

// Which grants actually open the admin app (/admin/). Mirrors the coarse
// "can this account use the app at all" gate in admin-main.js canUseAdmin() —
// they import the same array, because a list that drifted would either bounce a
// legitimate grantee at the door or send a passport-only member to a page that
// bounces them. `passport` is deliberately absent: SAMO Passport is a separate
// app at /passport/, so a passport-only grant is not admin access.
export const ADMIN_FEATURES = ['pr', 'vs', 'samoshop', 'projects', 'creator', 'team'];
