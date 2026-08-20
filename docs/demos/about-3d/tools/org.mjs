// Screenshot the เกี่ยวกับเรา org chart on a phone viewport, either view.
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9223;
const WIDTH = Number(process.argv[2] || 390);
const VIEW = process.argv[3] || 'chart';     // 'chart' | 'all' ('list'/'graph' retired 2026-08-20)
const OUT = process.argv[4] || `./org-${VIEW}-${WIDTH}.png`;

const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`,
  '--window-size=500,900', '--hide-scrollbars',
  '--user-data-dir=/tmp/cdp-profile-org', '--no-first-run',
  'about:blank',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await sleep(2200);

const targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
const page = targets.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));

let id = 0;
const pending = new Map();
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) pending.get(m.id)(m);
};
const send = (method, params = {}) => new Promise((res) => {
  const i = ++id;
  pending.set(i, res);
  ws.send(JSON.stringify({ id: i, method, params }));
});
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  return r.result?.result?.value ?? r.result?.exceptionDetails?.text;
};

await send('Emulation.setDeviceMetricsOverride', {
  width: WIDTH, height: 844, deviceScaleFactor: 2, mobile: true,
});
// Seed the view preference before the app boots.
await send('Page.navigate', { url: 'https://samo.md.kku.ac.th/' });
await sleep(1200);
await evaluate(`localStorage.setItem('samo.org.view', ${JSON.stringify(VIEW)}); 'ok'`);
await send('Page.navigate', { url: 'https://samo.md.kku.ac.th/about' });
await sleep(4500);
await evaluate(`document.getElementById('about-team')?.scrollIntoView(); 'ok'`);
await sleep(1200);

console.log('status:', await evaluate(`document.getElementById('orgStatus')?.textContent || 'rendered'`));
console.log('metrics:', JSON.stringify(await evaluate(`(() => {
  const b = document.getElementById('orgBody');
  if (!b) return null;
  const scrollers = [...b.querySelectorAll('*')].filter((el) => el.scrollWidth > el.clientWidth + 4);
  return {
    bodyScrollW: b.scrollWidth, bodyClientW: b.clientWidth,
    pageScrollW: document.documentElement.scrollWidth,
    viewport: window.innerWidth,
    overflowing: scrollers.slice(0, 5).map((el) => el.className + ':' + el.scrollWidth + '/' + el.clientWidth),
    cards: b.querySelectorAll('.org-person, .org-member, [class*=person]').length,
  };
})()`)));

const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
writeFileSync(OUT, Buffer.from(shot.result.data, 'base64'));
console.log('wrote', OUT);
ws.close();
chrome.kill();
process.exit(0);
