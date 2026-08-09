// ==============================================
// ONE card, TWO caches — invalidate them together or not at all.
//
// THE BUG THIS EXISTS FOR (reported: "when people change their student id in
// the main web, it should automatically change the รุ่น, ปี immediately … but
// currently i have to refresh the web to see it changes").
//
// ข้อมูลของฉัน is one card painted by two modules: `my-seat.js` owns the shell
// and `my-house.js` paints into the slot it leaves (main.js `paintHouseInto`).
// Each keeps its own module-scope cache of its own RPC. So:
//
//   • saving on the ทีม SAMO half called clearMySeatCache() and then repainted
//     the house section FROM ITS STALE CACHE — the รหัสนักศึกษา changed, and the
//     รุ่น derived from it did not;
//   • saving on the ระบบบ้าน half had the mirror image, leaving the seat rows
//     above it showing the old value.
//
// Both halves now write through `update_my_identity` and both are downstream of
// ONE registry row (0132), so a save on either changes what the other displays.
// Two caches for one fact is the module-scope-cache class in
// docs/mistakes/app-state.md, and the fix is not to remember two calls — it is
// to make there be one call.
//
// The registration indirection is what keeps this file free of imports from the
// two modules that import it: a cycle between my-seat.js and my-house.js is the
// reason the obvious version of this does not work.
// ==============================================

const clearers = new Set();

/** Called by each cache owner at module load. Idempotent. */
export function registerProfileCache(fn) {
  if (typeof fn === 'function') clearers.add(fn);
}

/**
 * Drop every cached view of "who am I".
 *
 * Call after ANY write that touches the shared identity — ชื่อ, ชื่อเล่น,
 * รหัสนักศึกษา, สาขา, ชั้นปี, the photo — regardless of which pane made it. The
 * mirrors (0132/0133) mean a write on one side lands on the other, so a repaint
 * that skips one is showing a value the database no longer holds.
 */
export function clearProfileCaches() {
  for (const fn of clearers) {
    try { fn(); } catch { /* a broken clearer must not stop the others */ }
  }
}
