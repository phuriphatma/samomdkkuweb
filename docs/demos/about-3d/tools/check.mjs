// Render the demo page locally, collect console errors, print measurements,
// and screenshot it at a phone and a desktop width.
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9225;
const WIDTH = Number(process.argv[2] || 1200);
const OUT = process.argv[3] || `./page-${WIDTH}.png`;
const FULL = process.argv[4] === 'full';
const THEME = process.argv[5] || 'light';

const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`,
  '--user-data-dir=/tmp/cdp-profile-check', '--no-first-run',
  '--allow-file-access-from-files', '--enable-unsafe-swiftshader',
  `--force-prefers-color-scheme=${THEME}`,
  'about:blank',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await sleep(2200);
const targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
const page = targets.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0; const pending = new Map(); const logs = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) pending.get(m.id)(m);
  if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(m.params.type)) {
    logs.push(m.params.type + ': ' + m.params.args.map((a) => a.value || a.description).join(' '));
  }
  if (m.method === 'Runtime.exceptionThrown') {
    logs.push('EXCEPTION: ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
  }
};
const send = (method, params = {}) => new Promise((res) => {
  const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params }));
});
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  return r.result?.result?.value ?? r.result?.exceptionDetails?.exception?.description;
};

await send('Runtime.enable');
await send('Page.enable');
await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: THEME }] });
await send('Emulation.setDeviceMetricsOverride', {
  width: WIDTH, height: 900, deviceScaleFactor: 1, mobile: false,
});
await send('Page.navigate', { url: `file://${process.cwd()}/about-mobile.html` });
await sleep(3500);
// bring the 3D frame into view so it boots
await evaluate(`document.getElementById('frameC')?.scrollIntoView({block:'center'}); 'ok'`);
await sleep(3000);
await evaluate(`window.scrollTo(0,0); 'ok'`);
await sleep(600);

console.log('measures:', await evaluate(`JSON.stringify({
  A: document.getElementById('mA').textContent,
  Ball: document.getElementById('mBall').textContent,
  ground: getComputedStyle(document.body).backgroundColor,
  B: document.getElementById('mB').textContent,
  aCards: document.querySelectorAll('#frameA .a-person').length,
  bDepts: document.querySelectorAll('#frameB .b-dept').length,
  canvas: !!document.querySelector('#frameC canvas'),
  labels: document.querySelectorAll('#frameC .c-label').length,
  bodyScrollW: document.documentElement.scrollWidth,
  viewport: window.innerWidth,
})`));
console.log('console:', logs.length ? logs.slice(0, 8) : 'clean');

const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: FULL });
writeFileSync(OUT, Buffer.from(shot.result.data, 'base64'));
console.log('wrote', OUT);
ws.close(); chrome.kill(); process.exit(0);
