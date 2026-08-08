// ==============================================
// TEAM API — Supabase CRUD via dbRest()
//
// Backs the SAMO Team org tree (public.team_nodes) and its people
// (public.team_members). RLS gates everything to vp_admin + dev (0046).
//
// Writes use prefer: 'return=representation' + a length check so an RLS
// denial surfaces as a thrown error instead of silent success — same
// discipline as projects/api.js (see .claude/rules/mistakes.md).
// ==============================================

import { dbRest } from '../db.js';
import { deleteTeamFile } from '../uploads.js';

// ---- Photo lifecycle ----

/**
 * Trash a portrait in Drive, but ONLY once nothing points at it any more.
 *
 * The reference check is not defensive padding — `publish_team_term` copies
 * `photo_url` straight into `team_archive_members`, so the instant a
 * ปีการศึกษา is published every live portrait is referenced twice by the SAME
 * Drive file id. Deleting a member's photo without checking would blank their
 * card in an archived year, silently, months later. (The live data does not
 * show this yet only because nothing has been published with photos — the
 * mechanism is already there and will produce it on the next publish.)
 *
 * The same holds within the live table once one person can hold several
 * ตำแหน่ง sharing one photo.
 *
 * CALL THIS AFTER THE ROW IS ALREADY GONE OR ALREADY REPOINTED, never from a
 * form action — otherwise cancelling the editor would have destroyed a photo
 * the database still uses. With the write committed first, the count is simply
 * the truth.
 *
 * Best-effort and never throws: the DB write it follows has already succeeded.
 * Worst case a file lingers, which is exactly the status quo.
 */
export async function deleteTeamPhotoIfUnused(photoUrl) {
  const url = String(photoUrl || '').trim();
  if (!url) return false;
  try {
    const q = `photo_url=eq.${encodeURIComponent(url)}&select=id&limit=1`;
    const [live, archived] = await Promise.all([
      dbRest(`/team_members?${q}`),
      dbRest(`/team_archive_members?${q}`),
    ]);
    // A failed count must NOT be read as "no references" — that is the
    // fail-open shape this repo keeps getting bitten by. Skip the delete.
    if (live.error || archived.error) {
      console.warn('[team/api] photo ref-count failed, keeping the file');
      return false;
    }
    const refs = (live.data?.length || 0) + (archived.data?.length || 0);
    if (refs > 0) return false;
    return await deleteTeamFile(url);
  } catch (e) {
    console.warn('[team/api] deleteTeamPhotoIfUnused failed:', e);
    return false;
  }
}

// ---- Reads ----

/** Load the whole tree + members in two flat queries. The caller builds
 *  the parent→child structure in memory. */
export async function fetchTree() {
  const [nodesRes, membersRes] = await Promise.all([
    dbRest('/team_nodes?select=*&order=position.asc,name.asc'),
    dbRest('/team_members?select=*&order=position.asc,full_name.asc'),
  ]);
  if (nodesRes.error) throw new Error(nodesRes.error.message || 'โหลดโครงสร้างทีมไม่สำเร็จ');
  if (membersRes.error) throw new Error(membersRes.error.message || 'โหลดสมาชิกทีมไม่สำเร็จ');
  return { nodes: nodesRes.data || [], members: membersRes.data || [] };
}

// ---- Nodes ----

export async function createNode(row) {
  if (!row?.name?.trim()) throw new Error('ต้องระบุชื่อตำแหน่ง/ฝ่าย');
  const { data, error } = await dbRest('/team_nodes', {
    method: 'POST',
    body: row,
    prefer: 'return=representation',
  });
  if (error) throw new Error(error.message || 'เพิ่มไม่สำเร็จ');
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error('เพิ่มไม่สำเร็จ (สิทธิ์ไม่พอ)');
  }
  return data[0];
}

export async function updateNode(id, patch) {
  const { data, error } = await dbRest(`/team_nodes?id=eq.${id}`, {
    method: 'PATCH',
    body: patch,
    prefer: 'return=representation',
  });
  if (error) throw new Error(error.message || 'บันทึกไม่สำเร็จ');
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error('บันทึกไม่สำเร็จ (สิทธิ์ไม่พอ)');
  }
  return data[0];
}

// An RLS-blocked DELETE is NOT an error — PostgREST returns 204 with zero rows
// deleted, so `if (error)` alone scores "you have no permission" as success and
// the row silently returns on the next reload (mistakes.md, "supabase-js
// silent-success on RLS-blocked updates / deletes"). Every delete below asks for
// the deleted rows back and refuses to report success on an empty set — the same
// shape createMember/updateMember above already use, and the one
// projects/api.js, vs-staff.js and announcements.js already use for DELETE.
export async function deleteNode(id) {
  const { data, error } = await dbRest(`/team_nodes?id=eq.${id}`, {
    method: 'DELETE',
    prefer: 'return=representation',
  });
  if (error) throw new Error(error.message || 'ลบไม่สำเร็จ');
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error('ลบไม่สำเร็จ — ไม่พบตำแหน่งนี้ หรือคุณไม่มีสิทธิ์ลบ (ต้องมีสิทธิ์ ทีม SAMO (แก้ไข))');
  }
}

// ---- Members ----

export async function createMember(row) {
  if (!row?.node_id) throw new Error('ต้องระบุตำแหน่งของสมาชิก');
  if (!row?.full_name?.trim()) throw new Error('ต้องระบุชื่อ-สกุล');
  const { data, error } = await dbRest('/team_members', {
    method: 'POST',
    body: row,
    prefer: 'return=representation',
  });
  if (error) throw new Error(error.message || 'เพิ่มสมาชิกไม่สำเร็จ');
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error('เพิ่มสมาชิกไม่สำเร็จ (สิทธิ์ไม่พอ)');
  }
  return data[0];
}

export async function updateMember(id, patch) {
  const { data, error } = await dbRest(`/team_members?id=eq.${id}`, {
    method: 'PATCH',
    body: patch,
    prefer: 'return=representation',
  });
  if (error) throw new Error(error.message || 'บันทึกสมาชิกไม่สำเร็จ');
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error('บันทึกสมาชิกไม่สำเร็จ (สิทธิ์ไม่พอ)');
  }
  return data[0];
}

export async function deleteMember(id) {
  const { data, error } = await dbRest(`/team_members?id=eq.${id}`, {
    method: 'DELETE',
    prefer: 'return=representation',
  });
  if (error) throw new Error(error.message || 'ลบสมาชิกไม่สำเร็จ');
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error('ลบสมาชิกไม่สำเร็จ — ไม่พบสมาชิกนี้ หรือคุณไม่มีสิทธิ์ลบ (ต้องมีสิทธิ์ ทีม SAMO (แก้ไข))');
  }
}

/** Persist a batch of {id, position[, parent_id|node_id]} updates after a
 *  drag. Runs them in parallel; rejects if any fail. */
export async function patchNodePositions(updates) {
  await Promise.all(updates.map((u) => {
    const { id, ...patch } = u;
    return updateNode(id, patch);
  }));
}

export async function patchMemberPositions(updates) {
  await Promise.all(updates.map((u) => {
    const { id, ...patch } = u;
    return updateMember(id, patch);
  }));
}

// ---- ปีการศึกษา + the archive (0104) ----
//
// The live tree is always the CURRENT term and carries no year. Past terms are a
// frozen snapshot in team_archive_nodes / team_archive_members, holding only the
// columns the public projection publishes — so an archived row has no column any
// permission resolver reads and cannot grant anything.

export async function fetchTerms() {
  const { data, error } = await dbRest('/team_terms?select=*&order=year.desc');
  if (error) throw new Error(error.message || 'โหลดปีการศึกษาไม่สำเร็จ');
  return data || [];
}

export async function createTerm(year, label = null) {
  const { data, error } = await dbRest('/team_terms', {
    method: 'POST',
    body: { year, label },
    prefer: 'return=representation',
  });
  if (error) throw new Error(error.message || 'เพิ่มปีการศึกษาไม่สำเร็จ');
  if (!Array.isArray(data) || !data.length) throw new Error('เพิ่มปีการศึกษาไม่สำเร็จ (สิทธิ์ไม่พอ)');
  return data[0];
}

export async function updateTerm(year, patch) {
  const { data, error } = await dbRest(`/team_terms?year=eq.${year}`, {
    method: 'PATCH',
    body: patch,
    prefer: 'return=representation',
  });
  if (error) throw new Error(error.message || 'บันทึกไม่สำเร็จ');
  if (!Array.isArray(data) || !data.length) throw new Error('บันทึกไม่สำเร็จ (สิทธิ์ไม่พอ)');
  return data[0];
}

export async function deleteTerm(year) {
  // Cascades to team_archive_nodes → team_archive_members.
  const { data, error } = await dbRest(`/team_terms?year=eq.${year}`, {
    method: 'DELETE',
    prefer: 'return=representation',
  });
  if (error) throw new Error(error.message || 'ลบไม่สำเร็จ');
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error('ลบไม่สำเร็จ — ไม่พบปีการศึกษานี้ หรือคุณไม่มีสิทธิ์ลบ (ต้องมีสิทธิ์ ทีม SAMO (แก้ไข))');
  }
}

/**
 * Make `year` the live term.
 *
 * Two writes, not one: `team_terms_one_current` is a partial UNIQUE index, so
 * setting the new current before clearing the old one violates it. Clear first.
 * (Not atomic — a failure between the two leaves NO current term, which the
 * public page already handles by falling back to the live tree.)
 */
export async function setCurrentTerm(year) {
  await dbRest('/team_terms?is_current=is.true', {
    method: 'PATCH',
    body: { is_current: false },
  });
  return updateTerm(year, { is_current: true });
}

/** Freeze the live tree into `year`'s archive. Re-runnable; replaces wholesale. */
export async function publishTerm(year) {
  const { data, error } = await dbRest('/rpc/publish_team_term', {
    method: 'POST',
    body: { p_year: year },
  });
  if (error) throw new Error(error.message || 'เผยแพร่ไม่สำเร็จ');
  return data;
}

/** The editable view of one archived year. */
export async function fetchArchive(year) {
  const [nodesRes, membersRes] = await Promise.all([
    dbRest(`/team_archive_nodes?year=eq.${year}&select=*&order=position.asc,name.asc`),
    dbRest(`/team_archive_members?year=eq.${year}&select=*&order=position.asc,full_name.asc`),
  ]);
  if (nodesRes.error) throw new Error(nodesRes.error.message || 'โหลดผังปีนี้ไม่สำเร็จ');
  if (membersRes.error) throw new Error(membersRes.error.message || 'โหลดรายชื่อปีนี้ไม่สำเร็จ');
  return { nodes: nodesRes.data || [], members: membersRes.data || [] };
}

export async function updateArchiveMember(id, patch) {
  const { data, error } = await dbRest(`/team_archive_members?id=eq.${id}`, {
    method: 'PATCH',
    body: patch,
    prefer: 'return=representation',
  });
  if (error) throw new Error(error.message || 'บันทึกไม่สำเร็จ');
  if (!Array.isArray(data) || !data.length) throw new Error('บันทึกไม่สำเร็จ (สิทธิ์ไม่พอ)');
  return data[0];
}

export async function deleteArchiveMember(id) {
  const { data, error } = await dbRest(`/team_archive_members?id=eq.${id}`, {
    method: 'DELETE',
    prefer: 'return=representation',
  });
  if (error) throw new Error(error.message || 'ลบไม่สำเร็จ');
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error('ลบไม่สำเร็จ — ไม่พบสมาชิกนี้ หรือคุณไม่มีสิทธิ์ลบ (ต้องมีสิทธิ์ ทีม SAMO (แก้ไข))');
  }
}

export async function updateArchiveNode(id, patch) {
  const { data, error } = await dbRest(`/team_archive_nodes?id=eq.${id}`, {
    method: 'PATCH',
    body: patch,
    prefer: 'return=representation',
  });
  if (error) throw new Error(error.message || 'บันทึกไม่สำเร็จ');
  if (!Array.isArray(data) || !data.length) throw new Error('บันทึกไม่สำเร็จ (สิทธิ์ไม่พอ)');
  return data[0];
}

/**
 * Which snapshots are behind the live tree (0105).
 *
 * Only the CURRENT year can be "stale" — a past year is SUPPOSED to diverge from
 * the live tree; that is what an archive is. Server-side because it needs
 * max(updated_at) across both team tables.
 */
export async function fetchTermStatus() {
  const { data, error } = await dbRest('/rpc/team_term_status', { method: 'POST', body: {} });
  if (error) throw new Error(error.message || 'อ่านสถานะปีการศึกษาไม่สำเร็จ');
  return data || { terms: [] };
}

// ---- สาขา vocabulary (migration 0113) ----
//
// A PICKER LIST, not a foreign key. `team_members.major` is plain text and this
// table only decides what the choosers offer, which is why `deleteMajor` below
// can be a one-liner with no cascade to reason about: removing a สาขา from the
// list leaves every person who has it exactly as they were. The migration
// header explains why an FK was rejected (removing reference data is what turns
// a resolver into a fail-open — the class logged in docs/mistakes/authz-rls.md).

export async function fetchMajors() {
  const { data, error } = await dbRest('/team_majors?select=*&order=position.asc,code.asc');
  if (error) throw new Error(error.message || 'โหลดรายการสาขาไม่สำเร็จ');
  return data || [];
}

export async function createMajor(row) {
  const { data, error } = await dbRest('/team_majors', {
    method: 'POST', body: row, prefer: 'return=representation',
  });
  if (error) throw new Error(error.message || 'เพิ่มสาขาไม่สำเร็จ');
  if (!Array.isArray(data) || !data.length) throw new Error('เพิ่มสาขาไม่สำเร็จ (สิทธิ์ไม่พอ)');
  return data[0];
}

export async function updateMajor(id, patch) {
  const { data, error } = await dbRest(`/team_majors?id=eq.${id}`, {
    method: 'PATCH', body: patch, prefer: 'return=representation',
  });
  if (error) throw new Error(error.message || 'บันทึกสาขาไม่สำเร็จ');
  if (!Array.isArray(data) || !data.length) throw new Error('บันทึกสาขาไม่สำเร็จ (สิทธิ์ไม่พอ)');
  return data[0];
}

export async function deleteMajor(id) {
  const { data, error } = await dbRest(`/team_majors?id=eq.${id}`, {
    method: 'DELETE',
    prefer: 'return=representation',
  });
  if (error) throw new Error(error.message || 'ลบสาขาไม่สำเร็จ');
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error('ลบสาขาไม่สำเร็จ — ไม่พบสาขานี้ หรือคุณไม่มีสิทธิ์ลบ (ต้องมีสิทธิ์ ทีม SAMO (แก้ไข))');
  }
}

/**
 * How many member rows carry a given สาขา code — asked BEFORE a rename or a
 * remove, so the confirm can say "this touches 348 people" instead of leaving
 * the admin to guess.
 *
 * `eq`, NOT `ilike`. An ilike filter makes the value a PATTERN (the class logged
 * in docs/mistakes/authz-rls.md as "an ILIKE lookup makes the id a pattern, not
 * a capability"): a สาขา code containing `_` or `%` would silently match — and
 * on the rename below, silently REWRITE — other people's rows. Exact match is
 * correct because migration 0113 canonicalised every stored value to the
 * vocabulary's own spelling, and both writers normalise through fields.js.
 */
export async function countMembersWithMajor(code) {
  const c = String(code || '').trim();
  if (!c) return 0;
  const { data, error } = await dbRest(
    `/team_members?select=id&major=eq.${encodeURIComponent(c)}`,
  );
  if (error) throw new Error(error.message || 'นับจำนวนสมาชิกไม่สำเร็จ');
  return (data || []).length;
}

/** Rename a สาขา ON THE PEOPLE — the vocabulary row is renamed separately.
 *  Two writes, deliberately: the member rows are the data, the vocabulary row is
 *  only the picker, and doing them in one place makes the order explicit. */
export async function renameMajorOnMembers(fromCode, toCode) {
  const from = String(fromCode || '').trim();
  const to = String(toCode || '').trim();
  if (!from || !to || from === to) return 0;
  const { data, error } = await dbRest(
    `/team_members?major=eq.${encodeURIComponent(from)}`,
    { method: 'PATCH', body: { major: to }, prefer: 'return=representation' },
  );
  if (error) throw new Error(error.message || 'เปลี่ยนชื่อสาขาไม่สำเร็จ');
  return (data || []).length;
}

/**
 * Resolve ONE exact kkumail against ระบบบ้าน's student registry.
 *
 * The interim bridge between the two person tables (migration 0130): ทีม SAMO
 * and ระบบบ้าน hold the same fields for the same humans, keyed on the same
 * kkumail, and the ทีม SAMO form used to make an admin retype what the
 * university had already sent — which is where the two copies diverge.
 *
 * Exact match, one row or null, and a hand-built column list on the server
 * side. It is NOT a directory: there is no listing, no prefix search and no
 * count, so it can only confirm an address the caller already has. The full
 * merge is docs/PERSON-REGISTRY.md.
 *
 * @returns {Promise<object|null>} null when the address is not in ระบบบ้าน.
 */
export async function lookupStudentByKkumail(kkumail) {
  const v = String(kkumail || '').trim();
  if (!v) return null;
  const { data, error } = await dbRest('/rpc/lookup_student_by_kkumail', {
    method: 'POST', body: { p_kkumail: v },
  });
  if (error) throw new Error(error.message || 'ค้นข้อมูลจากระบบบ้านไม่สำเร็จ');
  return data || null;
}
