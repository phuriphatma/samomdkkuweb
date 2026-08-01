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

export async function deleteNode(id) {
  const { error } = await dbRest(`/team_nodes?id=eq.${id}`, { method: 'DELETE' });
  if (error) throw new Error(error.message || 'ลบไม่สำเร็จ');
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
  const { error } = await dbRest(`/team_members?id=eq.${id}`, { method: 'DELETE' });
  if (error) throw new Error(error.message || 'ลบสมาชิกไม่สำเร็จ');
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
  const { error } = await dbRest(`/team_terms?year=eq.${year}`, { method: 'DELETE' });
  if (error) throw new Error(error.message || 'ลบไม่สำเร็จ');
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
  const { error } = await dbRest(`/team_archive_members?id=eq.${id}`, { method: 'DELETE' });
  if (error) throw new Error(error.message || 'ลบไม่สำเร็จ');
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
