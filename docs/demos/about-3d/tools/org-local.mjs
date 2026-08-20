// org-local.mjs — SEE the เกี่ยวกับเรา org chart while you are changing it.
//
// `org.mjs` (beside this) shoots the LIVE site. This one drives the LOCAL dev
// server (`npm run dev`, :5174), which is what you want mid-change, and adds the
// three things that were rebuilt from scratch twice because they lived in a
// scratchpad that gets wiped:
//
//   node org-local.mjs 390            frames down the section, phone width
//   node org-local.mjs 1440 chart     …desktop, and pick the view
//   node org-local.mjs 820 all        …ผังรวม on an iPad
//   node org-local.mjs 1440 chart --open "ฝ่ายพัฒนาทรัพยากรบุคคล"
//                                     open one ฝ่าย and shoot it in place
//   node org-local.mjs 1440 chart --no-bootstrap
//                                     load with Bootstrap's CDN CSS BLOCKED —
//                                     this is how the `[hidden]` bug was found
//                                     (see docs/mistakes/frontend-ui.md). Any
//                                     behaviour that changes under this flag is
//                                     BORROWED from Bootstrap, not implemented.
//
// It prints the numbers that matter before the pictures: section height at that
// width (the density metric this page is judged on — 24,101px was the old
// connector chart, 3,989px is the panel view), whether the PAGE scrolls
// horizontally, and any element overflowing its own box. Screenshots go to
// ./shots/.
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9271;
const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const val = (n) => { const i = args.indexOf(n); return i < 0 ? null : args[i + 1]; };
const WIDTH = Number(args[0] || 390);
const VIEW = (args[1] && !args[1].startsWith('--')) ? args[1] : 'chart';
const OPEN = val('--open');
const BASE = val('--base') || 'http://localhost:5174';
const H = WIDTH < 500 ? 844 : (WIDTH < 1100 ? 1024 : 900);
const FRAMES = Number(val('--frames') || 3);
mkdirSync('./shots', { recursive: true });

const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`,
  '--window-size=500,900', '--hide-scrollbars', '--no-first-run',
  '--user-data-dir=/tmp/cdp-org-local', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await sleep(2300);

const targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
await new Promise((r) => { ws.onopen = r; });
let id = 0; const pending = new Map(); const logs = []; let imgs = 0;
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) pending.get(m.id)(m);
  if (m.method === 'Network.requestWillBeSent'
    && /lh3\.googleusercontent/.test(m.params.request.url)) imgs += 1;
  if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(m.params.type)) {
    logs.push(`${m.params.type}: ${m.params.args.map((a) => a.value ?? a.description ?? '').join(' ')}`);
  }
};
const send = (method, params = {}) => new Promise((res) => {
  const i = ++id; pending.set(i, res);
  ws.send(JSON.stringify({ id: i, method, params }));
});
// Wrapped in try/catch because a raw throw surfaces only as the useless string
// "Uncaught" — see the headless-chrome notes in docs/demos/about-3d/tools/.
const ev = async (src) => {
  const r = await send('Runtime.evaluate', {
    expression: `(async()=>{try{${src}}catch(e){return 'ERR '+e.stack}})()`,
    awaitPromise: true,
    returnByValue: true,
  });
  return r.result?.result?.value ?? r.result?.exceptionDetails?.text;
};

await send('Network.enable');
await send('Runtime.enable');
if (flag('--no-bootstrap')) {
  await send('Network.setBlockedURLs', { urls: ['*cdn.jsdelivr.net/npm/bootstrap@*/dist/css/*'] });
}
await send('Emulation.setDeviceMetricsOverride', {
  width: WIDTH, height: H, deviceScaleFactor: 2, mobile: WIDTH < 700,
});
// Seed the view preference BEFORE the app boots — it is read once, at import.
await send('Page.navigate', { url: `${BASE}/` });
await sleep(1400);
await ev(`localStorage.setItem('samo.org.view', ${JSON.stringify(VIEW)}); return 1`);
await send('Page.navigate', { url: `${BASE}/about` });
await sleep(5200);

if (OPEN) {
  console.log('open:', await ev(`
    const b = [...orgBody.querySelectorAll('.orgc-unit-btn')]
      .find((x) => x.textContent.includes(${JSON.stringify(OPEN)}));
    if (!b) return 'NOT FOUND — check the ฝ่าย name';
    b.click(); await new Promise((r) => setTimeout(r, 500));
    scrollTo({ top: b.getBoundingClientRect().top + scrollY - 100, behavior: 'instant' });
    await new Promise((r) => setTimeout(r, 800));
    return 'opened';`));
}

console.log('metrics:', JSON.stringify(await ev(`
  const sec = document.getElementById('about-team');
  const over = [...document.querySelectorAll('#pills-about *')]
    .filter((e) => e.scrollWidth > e.clientWidth + 2).slice(0, 6)
    .map((e) => (e.className || e.tagName).toString().slice(0, 40) + ':' + e.scrollWidth + '/' + e.clientWidth);
  return {
    sectionH: Math.round(sec.scrollHeight),
    pageScrollsSideways: document.documentElement.scrollWidth > innerWidth,
    pageW: document.documentElement.scrollWidth, viewport: innerWidth,
    openPanels: document.querySelectorAll('.orgc-unit-body:not([hidden])').length,
    overflowing: over,
  };`), null, 1));
console.log('portrait requests:', imgs);
if (logs.length) console.log('console:', logs.slice(0, 6).join('\n'));

const top = await ev('return document.getElementById("about-team").getBoundingClientRect().top + scrollY');
for (let i = 0; i < (OPEN ? 1 : FRAMES); i += 1) {
  if (!OPEN) { await ev(`scrollTo(0, ${top} + ${i} * ${H - 40}); return 1`); await sleep(700); }
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  const name = `./shots/${VIEW}-${WIDTH}${flag('--no-bootstrap') ? '-nobs' : ''}-${OPEN ? 'open' : i}.png`;
  writeFileSync(name, Buffer.from(shot.result.data, 'base64'));
  console.log('wrote', name);
}
ws.close(); chrome.kill(); process.exit(0);
