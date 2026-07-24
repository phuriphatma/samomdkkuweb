// ==============================================
// VS RESOLUTION — shared "reason on close" vocabulary
//
// One source of truth for the close-reason set (migration 0073), used by BOTH
// the staff close flow (vs-staff.js) and the submitter-facing tracking view
// (vs-tracking.js). Kept in its own tiny module so neither of the two big
// files pulls the other into its bundle, and so the two surfaces can never
// drift on labels/order.
//
//   key        — the value stored in vs_tickets.resolution (CHECK-constrained)
//   staff      — label shown to staff in the close picker
//   student    — friendly outcome shown to the submitter when done
//   icon       — Bootstrap Icons class for the student card
//   badge      — Bootstrap badge class (student-facing colour)
//   noteRequired — resolution_note is mandatory in the UI for this reason
// ==============================================

export const VS_RESOLUTIONS = [
  {
    key: 'fixed',
    staff: 'แก้ไข/ดำเนินการเรียบร้อย',
    student: 'ดำเนินการแก้ไขเรียบร้อยแล้ว',
    icon: 'bi-check-circle-fill',
    badge: 'bg-success',
    noteRequired: false,
  },
  {
    key: 'forwarded',
    staff: 'ส่งต่อให้คณะ/หน่วยงานที่เกี่ยวข้อง',
    student: 'ส่งต่อให้หน่วยงาน/คณะที่เกี่ยวข้องดำเนินการต่อ',
    icon: 'bi-forward-fill',
    badge: 'bg-info text-dark',
    noteRequired: false,
  },
  {
    key: 'wont_do',
    staff: 'ไม่สามารถดำเนินการได้ (ระบุเหตุผล)',
    student: 'ไม่สามารถดำเนินการได้',
    icon: 'bi-x-circle-fill',
    badge: 'bg-secondary',
    noteRequired: true,
  },
  {
    key: 'duplicate',
    staff: 'เป็นเรื่องซ้ำกับเรื่องอื่น',
    student: 'เป็นเรื่องเดียวกับที่มีผู้แจ้งไว้ก่อนแล้ว',
    icon: 'bi-diagram-2-fill',
    badge: 'bg-secondary',
    noteRequired: false,
  },
];

/** Look up one resolution's metadata by key. Returns null for unknown/empty. */
export function vsResolution(key) {
  if (!key) return null;
  return VS_RESOLUTIONS.find((r) => r.key === key) || null;
}
