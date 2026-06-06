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
