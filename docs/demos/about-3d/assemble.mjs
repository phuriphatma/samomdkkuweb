// Splice the org data, the evidence image and the three.js bundle into the page.
import { readFileSync, writeFileSync } from 'node:fs';

const here = (f) => new URL(f, import.meta.url);
let html = readFileSync(here('./about-mobile.src.html'), 'utf8');

const data = readFileSync(here('./org-demo.json'), 'utf8');
const three = readFileSync(here('./three-bundle.js'), 'utf8');

// The evidence screenshot is optional: it is a crop of the live site (see the
// README), and the page still makes its case without it. A missing file must
// not fail the build — it would only tempt someone into publishing a page with
// a broken image in it.
let jpg = '';
try { jpg = readFileSync(here('./evid.jpg')).toString('base64'); }
catch { console.warn('! evid.jpg missing — the evidence figure will be omitted'); }

html = html.replace('ORG_DATA_JSON', () => data);
html = html.replace('CARD_DATA_JSON', () => readFileSync(here('./cards.json'), 'utf8'));
html = html.replace('CARD_ATLAS_SRC', () => readFileSync(here('./atlas.jpg.txt'), 'utf8').trim());
html = jpg
  ? html.replace('EVIDENCE_SRC', () => `data:image/jpeg;base64,${jpg}`)
  : html.replace(/<figure class="evidence"[\s\S]*?<\/figure>/, '');
// three.js goes in ahead of the page script that uses window.THREE.
html = html.replace('<script>\n(() => {\n  const DATA', () => `<script>${three}</script>\n\n<script>\n(() => {\n  const DATA`);

writeFileSync(here('./about-mobile.html'), html);
console.log('wrote about-mobile.html —', (html.length / 1024 / 1024).toFixed(2), 'MB');
console.log('has THREE:', html.includes('window.THREE=') || html.includes('window.THREE ='));
