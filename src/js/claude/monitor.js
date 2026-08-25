// ============================================================
// claude/monitor.js — is the usage measurement switched on, and who may switch
// it? (migration 0167)
//
// WHY THIS IS ITS OWN MODULE AND NOT TWENTY LINES IN index.js
// Both questions here are answered a second time somewhere else — the freshness
// rule in SQL, the admin gate in an RLS policy — and every rule in this feature
// that has ever had two authors has drifted. Pure functions with no DOM in them
// can be tested against the SQL they mirror (monitor.test.js reads the policy
// predicate out of the migration and pins the role list below to it); the same
// logic inlined in a paint function cannot be tested at all without a document.
//
// NOTHING HERE DECIDES ANYTHING THE SERVER DOES NOT ALREADY DECIDE. The gate is
// `claude_settings_write`; this only decides whether to draw the control, so
// that someone who cannot save is not handed a form that fails at the end.
// ============================================================

/**
 * The roles `claude_settings_write` names, and nothing else.
 *
 * ⚠️ A ROLE LIST CANNOT SEE A PERMISSION. A `master` holder has
 * `role = 'user'`, so testing this array alone would hide the switch from
 * exactly the people who hold the dev team's key — the bug that shipped across
 * this whole app in August 2026 and is class 5 in `.claude/rules/mistakes.md`.
 * `master` is therefore a separate argument in canEditMonitor(), never a value
 * in here.
 */
export const MONITOR_ADMIN_ROLES = ['vp_admin', 'dev'];

/**
 * May this account flip the switch?
 *
 * Mirrors `claude_settings_write`:
 *   using (current_user_role() = any (array['vp_admin','dev'])
 *          or current_user_has_permission('master'))
 */
export function canEditMonitor({ role = null, master = false } = {}) {
  return master === true || MONITOR_ADMIN_ROLES.includes(role);
}

/**
 * Read the switch out of a board payload, in the ONE shape the UI renders from.
 *
 * `enabled` defaults to TRUE for a payload that has no `monitoring` key at all.
 * That is deliberate and it is the safe direction here, which is worth saying
 * because this repo's usual rule is the opposite: an absent key means an OLD
 * BUNDLE talking to a NEW database, or a cached board from before 0167 — and
 * the honest description of that state is "nothing has been switched off",
 * because nothing had a switch. Defaulting to `false` would paint a paused
 * banner, with no reason in it, over a board that is measuring perfectly well.
 */
export function monitorState(board) {
  const m = board?.settings?.monitoring;
  if (!m) return { enabled: true, note: '', by: null, changedAt: null };
  return {
    enabled: m.enabled !== false,
    note: (m.note || '').trim(),
    by: m.changed_by || null,
    changedAt: m.changed_at ? new Date(m.changed_at) : null,
  };
}

/**
 * How old may a sample be and still describe "right now"?
 *
 * Published by get_claude_board() since 0167 so that the SQL and this file
 * cannot hold two different numbers. Before that the JS carried a hardcoded 35
 * minutes and the database carried nothing at all — two authors, one threshold,
 * which is how "ข้อมูลค้าง" and the number underneath it come to disagree.
 *
 * The fallback exists only for a payload predating 0167 and matches the
 * column's default rather than the old literal: an old bundle should read the
 * board the way the current database does.
 */
export function staleAfterMs(board) {
  const mins = Number(board?.settings?.sample_stale_minutes);
  return (Number.isFinite(mins) && mins > 0 ? mins : 45) * 60000;
}

/**
 * "3 วัน 4 ชม." — how long the pause has been running.
 *
 * Returns '' rather than a zero for a missing or future stamp. A duration is a
 * claim about elapsed time, and "0 นาที" beside a pause that started last week
 * is a reading, not a blank.
 */
export function pauseAge(changedAt, now = Date.now()) {
  if (!changedAt) return '';
  const ms = now - changedAt.getTime();
  if (!Number.isFinite(ms) || ms < 60000) return '';
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `${mins} นาที`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} ชม.`;
  const days = Math.floor(hrs / 24);
  const rem = hrs % 24;
  return rem ? `${days} วัน ${rem} ชม.` : `${days} วัน`;
}

/**
 * The one place that decides whether a pause has run long enough to cost a
 * re-login on the VM.
 *
 * The OAuth refresh token lives ~12 days and rotates on use; a paused reporter
 * deliberately does not rotate it (tools/claude-usage-report.mjs says why). So
 * past that point, turning measurement back on is not a click — somebody has to
 * ssh in. Warning at 10 days rather than 12 leaves two days to act, which is
 * the difference between a reminder and a post-mortem.
 */
export const RELOGIN_AFTER_DAYS = 10;

export function pauseNeedsRelogin(changedAt, now = Date.now()) {
  if (!changedAt) return false;
  return now - changedAt.getTime() > RELOGIN_AFTER_DAYS * 86400000;
}
