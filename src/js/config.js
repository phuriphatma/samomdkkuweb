// ==============================================
// CONFIG — API Endpoints & Constants
// ==============================================
//
// These URLs currently point to the DEV-cloned GAS deployments used for
// testing the refactor/modular branch. To switch back to production,
// restore the prod /exec URLs (kept below in the commented block).
//
// Prod URLs (the campus-live deployments):
//   GAS_API_URL          = 'https://script.google.com/macros/s/AKfycbw1iHE4ALCO6J7jPTFyiJx5B_9n7Dh7j67ksuWOQW40qkSikBGtVJR3aDPKWYOkm1BX/exec';
//   GAS_VITAL_SOUND_URL  = 'https://script.google.com/macros/s/AKfycbzOd7Yp1AHkCL8gApEoZcfVQzP1m6mpQyCLlvNIYaJGTFnH7HqnuIdJTT9JBWw9c0uR/exec';

/** Google Apps Script URL for PR / Announcements system (DEV) */
export const GAS_API_URL =
  'https://script.google.com/macros/s/AKfycbzLlh-Fic1oKBy8BQB16Q1OQ49szv8LcGf6kJADem7d7bBiDUXt5zwjBSMBU3e3Co923A/exec';

/** Google Apps Script URL for Vital Sound system (DEV) */
export const GAS_VITAL_SOUND_URL =
  'https://script.google.com/macros/s/AKfycbwKxvtnxIasQoHB2sC1A0nN14meorMCyq5NelczSC5siJotWhBWIMA6GQ1T1wFs3H09/exec';

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
