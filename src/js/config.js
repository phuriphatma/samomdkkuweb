// ==============================================
// CONFIG — API Endpoints & Constants
// ==============================================
//
// The prod GAS deployment (prform) owns the Drive folder with all PR/shop/
// project uploads (2 TB quota) and the projects email (MailApp). Both
// branches of the site hit the same URL. Discord notifications no longer
// go through GAS — they moved to the Cloudflare Pages Function below.

/** Google Apps Script URL for prform — Drive uploads + projects email. PROD */
export const GAS_API_URL =
  'https://script.google.com/macros/s/AKfycbw1iHE4ALCO6J7jPTFyiJx5B_9n7Dh7j67ksuWOQW40qkSikBGtVJR3aDPKWYOkm1BX/exec';

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
