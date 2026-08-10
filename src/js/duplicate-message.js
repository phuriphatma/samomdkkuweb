// ==============================================
// duplicateMessage() — turn a Postgres 23505 into a sentence about a THING.
//
// REPORTED, about ระบบบ้าน: adding a นักศึกษา who already existed produced
//   {"code":"23505","details":null,"hint":null,"message":"duplicate key value
//    violates unique constraint \"students_kkumail_key\"}
// in an alert(). It was fixed there — and only there. Every other write path in
// the app still passed `err.message` straight to alert(), so the identical
// wall of English appeared for:
//
//   • เพิ่มอาจารย์, twice over (`advisors_email_key`) — the ordinary
//     "add an advisor" form AND the quick-add inside the สายรหัส modal;
//   • เพิ่มสาขา (`team_majors_code_uniq`).
//
// That is this repo's most repeated shape: a fix applied to the writer that
// happened to be in front of us. So the rule lives here now, keyed on the
// CONSTRAINT NAME, and every path that can hit a unique index calls it.
//
// WHY CONSTRAINT NAMES AND NOT COLUMN GUESSES. The old version fell through to
// `text.includes('kkumail')`, which is true of a message that merely mentions
// the column — including `people_kkumail_uniq`, a different table with a
// different remedy. A constraint name identifies exactly one index, so the
// advice can be exact; the generic tail is only for a constraint nobody has
// taught this function yet.
//
// IT RETURNS null FOR ANYTHING THAT IS NOT A DUPLICATE, and every caller keeps
// its own fallback. A translator that swallowed unrelated errors would hide the
// next real bug behind a friendly sentence about duplicates — so
// duplicate-message.test.js has a control asserting a non-23505 passes through.
// ==============================================

/** Constraint name → how to say it to a person who is not a programmer. */
const BY_CONSTRAINT = [
  {
    match: /students_kkumail_key/,
    say: (p) => `อีเมล ${p.kkumail || 'นี้'} มีนักศึกษาใช้อยู่แล้ว\n\n`
      + 'คน ๆ หนึ่งมีข้อมูลในระบบบ้านได้แถวเดียว — ถ้าเป็นคนเดียวกัน '
      + 'ให้ค้นหาชื่อในรายการแล้วกดแก้ไขแถวเดิม ถ้าเป็นคนละคน ตรวจสอบอีเมลอีกครั้ง',
  },
  {
    match: /students_sid_uniq/,
    say: (p) => `รหัสนักศึกษา ${p.student_id || 'นี้'} มีคนใช้อยู่แล้ว\n\n`
      + 'ตรวจสอบว่าพิมพ์ถูกต้อง — ถ้าถูกต้องแล้วแปลว่ามีสองแถวถือรหัสเดียวกัน '
      + 'ซึ่งต้องแก้ที่แถวเดิม ไม่ใช่เพิ่มแถวใหม่',
  },
  {
    match: /advisors_email_key/,
    say: (p) => `อีเมล ${p.email || 'นี้'} มีอาจารย์ในระบบใช้อยู่แล้ว\n\n`
      + 'ถ้าเป็นอาจารย์ท่านเดิม ไม่ต้องเพิ่มใหม่ — ค้นหาชื่อในช่อง '
      + '“เพิ่มอาจารย์ที่มีอยู่แล้ว” แล้วกดเลือกเพื่อใส่เข้าสายนี้ได้เลย',
  },
  {
    match: /team_majors_code_uniq/,
    say: (p) => `สาขา ${p.code || 'นี้'} มีอยู่ในรายการแล้ว\n\n`
      + 'ถ้าต้องการเปลี่ยนชื่อที่แสดง ให้กดแก้ไขที่สาขาเดิมแทนการเพิ่มใหม่',
  },
  {
    match: /people_kkumail_uniq/,
    say: (p) => `อีเมล ${p.kkumail || 'นี้'} มีคนในระบบใช้อยู่แล้ว\n\n`
      + 'ระบบเก็บข้อมูลคนหนึ่งคนไว้ชุดเดียว ใช้ช่องค้นหาเพื่อดึงคนเดิมมาใช้ '
      + 'แทนการสร้างใหม่',
  },
];

/**
 * @param {object} err      the error object from dbRest/supabase-js
 * @param {object} [payload] the row that was being written, for naming values
 * @returns {string|null} a Thai sentence, or null if this is not a duplicate
 */
export function duplicateMessage(err, payload = {}) {
  const text = `${err?.message || ''} ${err?.details || ''} ${JSON.stringify(err || {})}`;
  if (!text.includes('23505') && !/duplicate key/i.test(text)) return null;
  for (const { match, say } of BY_CONSTRAINT) {
    if (match.test(text)) return say(payload);
  }
  return 'ข้อมูลนี้ซ้ำกับที่มีอยู่แล้วในระบบ — ตรวจสอบว่ากรอกซ้ำกับรายการเดิมหรือไม่';
}
