// ==============================================
// HOUSE API — every read/write for ระบบบ้าน, on dbRest.
//
// Two rules this file exists to hold:
//
// 1. EVERY DELETE asks for the deleted rows back and refuses to report success
//    on an empty array. PostgREST answers an RLS-blocked DELETE with 204 and
//    zero rows, NOT an error — the bug that made "ลบสมาชิกไม่ได้" invisible in
//    ทีม SAMO. `src/js/delete-guard.test.js` sweeps this file too.
//
// 2. `sais.house_id` is NEVER written and never computed here. It is a GENERATED
//    STORED column (migration 0116) and the database is the sole authority for
//    the house rule. houseOf() in ./fields.js exists only for the import preview.
// ==============================================
import { dbRest } from '../db.js';
// The สาขา vocabulary is faculty-wide (`team_majors`, migration 0113, widened to
// the `house` permission in 0125) and ทีม SAMO already owns the CRUD for it.
// Re-exported rather than re-queried: this app has three spellings of `MD` in
// its history from the last time one rule had two implementations.
export { fetchMajors } from '../team/api.js';

const fail = (error, msg) => { throw new Error(error?.message || msg); };

// ---- settings ----
export async function fetchSettings() {
  const { data, error } = await dbRest('/house_settings?select=*&limit=1');
  if (error) fail(error, 'โหลดการตั้งค่าไม่สำเร็จ');
  return (data && data[0]) || null;
}

export async function updateSettings(patch) {
  const { data, error } = await dbRest('/house_settings?id=eq.true', {
    method: 'PATCH', body: patch, prefer: 'return=representation',
  });
  if (error) fail(error, 'บันทึกการตั้งค่าไม่สำเร็จ');
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error('บันทึกการตั้งค่าไม่สำเร็จ (สิทธิ์ไม่พอ)');
  }
  return data[0];
}

// ---- houses ----
export async function fetchHouses() {
  const { data, error } = await dbRest('/houses?select=*&order=id.asc');
  if (error) fail(error, 'โหลดข้อมูลบ้านไม่สำเร็จ');
  return data || [];
}

/** Houses are UPDATE-only by design — the ten rows are seeded and the set is
 *  fixed by the rule (one house per digit). There is no createHouse and no
 *  deleteHouse, and the migration revokes INSERT/DELETE so a stray call fails
 *  at the database rather than half-working. */
export async function updateHouse(id, patch) {
  const { data, error } = await dbRest(`/houses?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH', body: patch, prefer: 'return=representation',
  });
  if (error) fail(error, 'บันทึกบ้านไม่สำเร็จ');
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error('บันทึกบ้านไม่สำเร็จ — ไม่พบบ้านนี้ หรือคุณไม่มีสิทธิ์แก้ไข');
  }
  return data[0];
}

// ---- สายรหัส ----
export async function fetchSais() {
  const { data, error } = await dbRest('/sais?select=code,house_id,label,note&order=code.asc');
  if (error) fail(error, 'โหลดสายรหัสไม่สำเร็จ');
  return data || [];
}

/**
 * Create any สายรหัส in `codes` that does not exist yet.
 *
 * MUST run before students are upserted: `students.sai_code` has a foreign key
 * to `sais`, and สาย are NOT a seeded range — they run to roughly the size of
 * the largest year (~287 and moving with enrolment), so the set is derived from
 * whatever the import file contains. Idempotent, so it is safe per chunk.
 */
export async function ensureSais(codes) {
  const list = [...new Set((codes || []).filter(Boolean))];
  if (!list.length) return 0;
  const { data, error } = await dbRest('/rpc/ensure_sais', {
    method: 'POST', body: { p_codes: list },
  });
  if (error) fail(error, 'สร้างสายรหัสไม่สำเร็จ');
  return data || 0;
}

// ---- advisors ----
export async function fetchAdvisors() {
  const { data, error } = await dbRest(
    '/advisors?select=*,sai_advisors(sai_code,role,position)&order=full_name.asc');
  if (error) fail(error, 'โหลดรายชื่ออาจารย์ไม่สำเร็จ');
  return data || [];
}

export async function createAdvisor(row) {
  const { data, error } = await dbRest('/advisors', {
    method: 'POST', body: row, prefer: 'return=representation',
  });
  if (error) fail(error, 'เพิ่มอาจารย์ไม่สำเร็จ');
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error('เพิ่มอาจารย์ไม่สำเร็จ (สิทธิ์ไม่พอ)');
  }
  return data[0];
}

export async function updateAdvisor(id, patch) {
  const { data, error } = await dbRest(`/advisors?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH', body: patch, prefer: 'return=representation',
  });
  if (error) fail(error, 'บันทึกอาจารย์ไม่สำเร็จ');
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error('บันทึกอาจารย์ไม่สำเร็จ (สิทธิ์ไม่พอ)');
  }
  return data[0];
}

export async function deleteAdvisor(id) {
  const { data, error } = await dbRest(`/advisors?id=eq.${encodeURIComponent(id)}`, {
    method: 'DELETE', prefer: 'return=representation',
  });
  if (error) fail(error, 'ลบอาจารย์ไม่สำเร็จ');
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error('ลบอาจารย์ไม่สำเร็จ — ไม่พบรายการ หรือคุณไม่มีสิทธิ์ลบ');
  }
}

/** Replace an advisor's สาย assignments wholesale. Delete-then-insert rather
 *  than a diff: the set is at most a handful of rows, and a diff would be more
 *  code with more ways to leave a stale link behind. */
export async function setAdvisorSais(advisorId, saiCodes) {
  const id = encodeURIComponent(advisorId);
  // delete-guard:allow-empty — clearing the links of an advisor who has none
  // yet legitimately deletes zero rows, so this delete must NOT throw on an
  // empty result. Every OTHER delete in this file must. The marker is what
  // exempts it in delete-guard.test.js; do not add it without a reason like
  // this one.
  const { error: delErr } = await dbRest(`/sai_advisors?advisor_id=eq.${id}`, {
    method: 'DELETE', prefer: 'return=representation',
  });
  if (delErr) fail(delErr, 'อัปเดตสายของอาจารย์ไม่สำเร็จ');
  if (!saiCodes.length) return;
  const { error } = await dbRest('/sai_advisors', {
    method: 'POST',
    body: saiCodes.map((code, i) => ({ sai_code: code, advisor_id: advisorId, position: i })),
    prefer: 'return=representation',
  });
  if (error) fail(error, 'อัปเดตสายของอาจารย์ไม่สำเร็จ');
}

/**
 * The สาย-first half of the same link table.
 *
 * `setAdvisorSais` above answers "which สาย does this อาจารย์ look after"; these
 * two answer "which อาจารย์ look after this สาย". Both write `sai_advisors`, and
 * they must stay consistent: one link row, whichever direction created it. That
 * is why this pair adds and removes ONE row instead of replacing a set — a
 * สาย-side "replace everything for this สาย" would silently drop links the
 * advisor-side editor had just made.
 */
export async function addSaiAdvisor(saiCode, advisorId, position = 0) {
  const { data, error } = await dbRest('/sai_advisors', {
    method: 'POST',
    body: { sai_code: saiCode, advisor_id: advisorId, position },
    prefer: 'return=representation',
  });
  if (error) fail(error, 'เพิ่มอาจารย์ให้สายนี้ไม่สำเร็จ');
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error('เพิ่มอาจารย์ให้สายนี้ไม่สำเร็จ (สิทธิ์ไม่พอ)');
  }
  return data[0];
}

export async function removeSaiAdvisor(saiCode, advisorId) {
  const { data, error } = await dbRest(
    `/sai_advisors?sai_code=eq.${encodeURIComponent(saiCode)}`
    + `&advisor_id=eq.${encodeURIComponent(advisorId)}`, {
      method: 'DELETE', prefer: 'return=representation',
    });
  if (error) fail(error, 'นำอาจารย์ออกจากสายนี้ไม่สำเร็จ');
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error('นำอาจารย์ออกจากสายนี้ไม่สำเร็จ — ไม่พบรายการ หรือคุณไม่มีสิทธิ์ลบ');
  }
}

// ---- students ----
const STUDENT_COLS = [
  'id', 'kkumail', 'student_id', 'first_name_th', 'last_name_th', 'full_name',
  'nickname', 'nickname_imported', 'nickname_self', 'major', 'sai_code',
  'cohort_year', 'photo_url', 'bio', 'year_override', 'is_listed',
  'verified_at', 'sai_locked', 'sai_self_edits', 'missing_since', 'updated_at',
].join(',');

export async function fetchStudents() {
  // Paged: PostgREST caps a response and ~1,800 rows is comfortably over the
  // default limit on some deployments. Asking explicitly is cheaper than
  // discovering a silently truncated roster.
  const out = [];
  const page = 1000;
  for (let from = 0; ; from += page) {
    const { data, error } = await dbRest(
      `/students?select=${STUDENT_COLS}&order=sai_code.asc,full_name.asc`,
      { headers: { Range: `${from}-${from + page - 1}`, 'Range-Unit': 'items' } });
    // 416 means the range starts past the last row, which happens whenever the
    // total is an exact multiple of `page` — the loop below would otherwise
    // break only on a SHORT page and ask for one range too many. Treat it as
    // "no more rows", not as a failed load.
    if (error && error.status === 416) break;
    if (error) fail(error, 'โหลดรายชื่อนักศึกษาไม่สำเร็จ');
    const rows = data || [];
    out.push(...rows);
    if (rows.length < page) break;
  }
  return out;
}

export async function createStudent(row) {
  const { data, error } = await dbRest('/students', {
    method: 'POST', body: row, prefer: 'return=representation',
  });
  if (error) fail(error, 'เพิ่มนักศึกษาไม่สำเร็จ');
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error('เพิ่มนักศึกษาไม่สำเร็จ (สิทธิ์ไม่พอ)');
  }
  return data[0];
}

export async function updateStudent(id, patch) {
  const { data, error } = await dbRest(`/students?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH', body: patch, prefer: 'return=representation',
  });
  if (error) fail(error, 'บันทึกนักศึกษาไม่สำเร็จ');
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error('บันทึกนักศึกษาไม่สำเร็จ (สิทธิ์ไม่พอ)');
  }
  return data[0];
}

export async function deleteStudent(id) {
  const { data, error } = await dbRest(`/students?id=eq.${encodeURIComponent(id)}`, {
    method: 'DELETE', prefer: 'return=representation',
  });
  if (error) fail(error, 'ลบนักศึกษาไม่สำเร็จ');
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error('ลบนักศึกษาไม่สำเร็จ — ไม่พบรายการ หรือคุณไม่มีสิทธิ์ลบ');
  }
}

/**
 * Upsert a chunk of imported rows on kkumail.
 *
 * `merge-duplicates` + the kkumail unique index means a re-import UPDATES rather
 * than duplicating. The body must only ever carry IMPORT-OWNED columns — never
 * nickname_self / photo_url / bio / year_override / is_listed, which belong to
 * the student. Enforced by the caller building the payload, and by
 * `house-import.test.js` asserting the key set.
 */
export async function upsertStudents(rows) {
  const { data, error } = await dbRest('/students?on_conflict=kkumail', {
    method: 'POST',
    body: rows,
    prefer: 'resolution=merge-duplicates,return=representation',
  });
  if (error) fail(error, 'นำเข้าข้อมูลไม่สำเร็จ');
  return data || [];
}

/**
 * Mark the students that the newest import file did NOT mention.
 *
 * The importer never deletes — a blind sync would wipe self-edits and anyone the
 * source happened to omit. It stamps `missing_since` instead so the gap is
 * visible and reversible. Chunked because the `in.()` filter goes in the URL and
 * a few hundred uuids would blow past the practical URL length.
 */
export async function markMissing(ids, when = new Date().toISOString()) {
  const CHUNK = 100;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const list = ids.slice(i, i + CHUNK).map((x) => `"${x}"`).join(',');
    const { error } = await dbRest(`/students?id=in.(${encodeURIComponent(list)})`, {
      method: 'PATCH', body: { missing_since: when }, prefer: 'return=minimal',
    });
    if (error) fail(error, 'บันทึกสถานะ “ไม่พบในไฟล์ล่าสุด” ไม่สำเร็จ');
  }
}

export async function createImportBatch(row) {
  const { data, error } = await dbRest('/student_import_batches', {
    method: 'POST', body: row, prefer: 'return=representation',
  });
  if (error) fail(error, 'บันทึกประวัติการนำเข้าไม่สำเร็จ');
  return (data && data[0]) || null;
}

/**
 * Stamp what the import ACTUALLY did.
 *
 * The batch row has to exist before the students are written (they carry
 * `last_import_batch`), so it is created with zeroed counts. Writing the
 * PLANNED counts at creation time would leave an audit row claiming a
 * successful import of N people after a run that died on chunk 3 — an audit
 * trail that lies is worse than none.
 */
export async function finishImportBatch(id, counts) {
  if (!id) return;
  const { error } = await dbRest(`/student_import_batches?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH', body: counts, prefer: 'return=minimal',
  });
  // Non-fatal: the students are already in. A failed bookkeeping write must not
  // report the import itself as failed.
  if (error) console.warn('[house] could not stamp import batch:', error.message);
}

// ---- change requests ----
export async function fetchRequests() {
  const { data, error } = await dbRest(
    '/student_change_requests?select=*,students(full_name,kkumail,sai_code)'
    + '&order=status.asc,created_at.desc');
  if (error) fail(error, 'โหลดคำขอแก้ไขไม่สำเร็จ');
  return data || [];
}

export async function decideRequest(id, status, note, userId) {
  const { data, error } = await dbRest(
    `/student_change_requests?id=eq.${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: { status, decision_note: note || null, decided_by: userId || null, decided_at: new Date().toISOString() },
      prefer: 'return=representation',
    });
  if (error) fail(error, 'บันทึกผลคำขอไม่สำเร็จ');
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error('บันทึกผลคำขอไม่สำเร็จ (สิทธิ์ไม่พอ)');
  }
  return data[0];
}

// ---- the signed-in student's own record (public side) ----
export async function fetchMyStudentRecord() {
  const { data, error } = await dbRest('/rpc/get_my_student_record', { method: 'POST', body: {} });
  if (error) throw new Error(error.message || 'โหลดข้อมูลไม่สำเร็จ');
  return data || null;
}

export async function saveMyStudentRecord(patch) {
  const { data, error } = await dbRest('/rpc/update_my_student_record', {
    method: 'POST', body: { p_patch: patch },
  });
  if (error) throw new Error(error.message || 'บันทึกไม่สำเร็จ');
  return data || null;
}

/** File a correction request for the CALLER's own record. The RPC resolves the
 *  student from auth.uid(), so there is no id to pass and no way to file one on
 *  someone else's behalf. */
export async function requestMyChange(field, requested, reason) {
  const { data, error } = await dbRest('/rpc/request_my_change', {
    method: 'POST',
    body: { p_field: field, p_requested: requested, p_reason: reason || null },
  });
  if (error) throw new Error(error.message || 'ส่งคำขอไม่สำเร็จ');
  return data || null;
}

// There is deliberately NO house-roster reader here. ระบบบ้าน publishes อาจารย์,
// never students: `get_house_roster()` was dropped in migration 0124 along with
// the setting that gated it. A student's card lists their own record and the
// อาจารย์ที่ปรึกษา of every สาย in their house — nobody else's name.
