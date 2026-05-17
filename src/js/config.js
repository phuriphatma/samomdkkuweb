// ==============================================
// CONFIG — API Endpoints & Constants
// ==============================================

/** Google Apps Script URL for PR / Announcements system */
export const GAS_API_URL =
  'https://script.google.com/macros/s/AKfycbw1iHE4ALCO6J7jPTFyiJx5B_9n7Dh7j67ksuWOQW40qkSikBGtVJR3aDPKWYOkm1BX/exec';

/** Google Apps Script URL for Vital Sound system */
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
