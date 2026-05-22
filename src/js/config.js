// ==============================================
// CONFIG — API Endpoints & Constants
// ==============================================
//
// These URLs point to the PRODUCTION GAS deployments. The prod GAS
// projects (prform + vssound) own the Drive folder with all historical
// PR uploads (2 TB quota) and the live Discord webhooks. Both branches
// of the site (samomdkkuweb.pages.dev + refactorsamomdkkuweb.pages.dev)
// hit these same URLs.
//
// Dev/clone URLs (used briefly during the refactor's testing phase;
// safe to remove once the migration is settled):
//   GAS_API_URL          = 'https://script.google.com/macros/s/AKfycbzLlh-Fic1oKBy8BQB16Q1OQ49szv8LcGf6kJADem7d7bBiDUXt5zwjBSMBU3e3Co923A/exec';
//   GAS_VITAL_SOUND_URL  = 'https://script.google.com/macros/s/AKfycbwKxvtnxIasQoHB2sC1A0nN14meorMCyq5NelczSC5siJotWhBWIMA6GQ1T1wFs3H09/exec';

/** Google Apps Script URL for PR (file upload + Discord notify) — PROD */
export const GAS_API_URL =
  'https://script.google.com/macros/s/AKfycbw1iHE4ALCO6J7jPTFyiJx5B_9n7Dh7j67ksuWOQW40qkSikBGtVJR3aDPKWYOkm1BX/exec';

/** Google Apps Script URL for Vital Sound (Discord notify) — PROD */
export const GAS_VITAL_SOUND_URL =
  'https://script.google.com/macros/s/AKfycbzOd7Yp1AHkCL8gApEoZcfVQzP1m6mpQyCLlvNIYaJGTFnH7HqnuIdJTT9JBWw9c0uR/exec';

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
