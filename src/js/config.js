// ==============================================
// CONFIG — API Endpoints & Constants
// ==============================================
//
// The prod GAS deployment (prform) owns the Drive folder with all PR/shop/
// project uploads (2 TB quota) and the projects email (MailApp). Both
// branches of the site hit the same URL. Discord notifications no longer
// go through GAS — they moved to the Cloudflare Pages Function below.

/**
 * Google Apps Script URL for the `samoweb` project — Drive uploads + projects
 * email. PROD.
 *
 * Migrated off `prformweb` (2026-07-31), which was a script BOUND to an unused
 * spreadsheet. A bound script is stored inside its container, so trashing that
 * stray-looking Sheet would have taken the script and every deployment with it
 * — killing PR/shop/projects/team uploads and the projects email at once. This
 * one is standalone.
 *
 * The old deployment is deliberately still live so bundles cached before this
 * change keep working; both scripts run identical code under the same account
 * and resolve the SAME Drive folders, so the overlap is behaviourally
 * indistinguishable. Retire `prformweb` only after the old endpoint stops
 * seeing traffic.
 */
export const GAS_API_URL =
  'https://script.google.com/macros/s/AKfycbwomKiiUUNx4eYKEJM376MCg3Z-ykxLXFArLNSLdHwjnkYxZnFP0YykdlbClvQ4P0Hl7w/exec';

/** Cloudflare Pages Function (`functions/notify.js`) that proxies ALL
 *  Discord notifications (PR / Vital Sign / หนังสือโครงการ). Same-origin
 *  path — resolves to the Function on every Pages deployment; GAS keeps
 *  Drive uploads + the projects email only. */
export const NOTIFY_FN_URL = '/notify';

/** Quill.js toolbar configuration shared by all editors */
export const QUILL_TOOLBAR = [
  [{ size: ['10px', '12px', '13px', '14px', '15px', '16px', '18px', '20px', '24px', '32px'] }],
  [{ align: [] }],
  ['bold', 'italic', 'underline', 'strike'],
  [{ color: [] }, { background: [] }],
  [{ list: 'ordered' }, { list: 'bullet' }],
  ['link', 'image', 'video'],
  ['clean'],
];
