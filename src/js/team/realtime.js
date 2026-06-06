// ==============================================
// TEAM REALTIME — live multi-editor sync via Supabase Realtime
//
// Subscribes to postgres_changes on team_nodes + team_members so another VP's
// edits land without a refresh (last-write-wins; not character-level OT).
// Realtime re-applies RLS, so only vp_admin/dev sessions receive events.
//
// Also tracks lightweight Presence so the UI can show how many editors are
// currently on the page.
// ==============================================

import { db, currentAccessToken } from '../db.js';

let channel = null;
let reauthTimer = null;

/**
 * @param {(table: string, payload: object) => void} onChange  row change handler
 * @param {(count: number) => void} onPresence                 concurrent-viewer count
 * @param {{ id?: string, name?: string }} me                  identity for presence
 */
export function subscribeTeam(onChange, onPresence, me = {}) {
  if (channel) return channel;
  // Make sure the realtime socket authenticates as the signed-in user (our
  // db client disables autoRefresh, so set the token explicitly).
  try { db.realtime.setAuth(currentAccessToken()); } catch (_) {}

  channel = db.channel('team-collab', { config: { presence: { key: me.id || crypto.randomUUID() } } })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'team_nodes' },
      (p) => { try { onChange('team_nodes', p); } catch (e) { console.warn('[team] rt nodes', e); } })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'team_members' },
      (p) => { try { onChange('team_members', p); } catch (e) { console.warn('[team] rt members', e); } })
    .on('presence', { event: 'sync' }, () => {
      if (!onPresence) return;
      try {
        const state = channel.presenceState();
        onPresence(Object.keys(state).length);
      } catch (_) {}
    })
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        channel.track({ name: me.name || 'ผู้ใช้', at: Date.now() }).catch(() => {});
      }
    });

  // Our db client has autoRefreshToken disabled, so the socket's JWT would go
  // stale (~1h) and reconnects would silently lose RLS-gated events. Re-push
  // the current token every 20 min (dbRest keeps it fresh on writes).
  clearInterval(reauthTimer);
  reauthTimer = setInterval(() => {
    try { db.realtime.setAuth(currentAccessToken()); } catch (_) {}
  }, 20 * 60 * 1000);

  return channel;
}

export function unsubscribeTeam() {
  clearInterval(reauthTimer);
  reauthTimer = null;
  if (!channel) return;
  try { db.removeChannel(channel); } catch (_) {}
  channel = null;
}
