import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9231;
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`,
  '--user-data-dir=/tmp/cdp-profile-focus', '--no-first-run', '--allow-file-access-from-files',
  '--enable-unsafe-swiftshader', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await sleep(2500);
const t = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
const ws = new WebSocket(t.find((x) => x.type === 'page').webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0; const pending = new Map(); const errs = [];
ws.onmessage = (e) => { const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) pending.get(m.id)(m);
  if (m.method === 'Runtime.exceptionThrown') errs.push((m.params.exceptionDetails.exception?.description || '').slice(0, 200));
};
const send = (m, p = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
const ev = async (x) => { const r = await send('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true }); return r.result?.result?.value ?? r.result?.exceptionDetails?.exception?.description; };
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1200, height: 900, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: `file://${process.cwd()}/about-mobile.html` });
await sleep(2500);
await ev(`document.getElementById('frameC').scrollIntoView({block:'center'}); 'ok'`);
await sleep(13000);
// focus ฝ่ายกิจการภายนอก (the biggest, 81 people) then go fullscreen for the shot
await ev(`document.querySelector('#cLegend [data-di="4"]').click(); 'ok'`);
await sleep(4000);
console.log('after focus:', await ev(`JSON.stringify(window.__dbg())`));
await ev(`document.getElementById('cFull').click(); 'ok'`);
await sleep(4000);
const s = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync('./focus.png', Buffer.from(s.result.data, 'base64'));
console.log('errors:', errs.length ? errs : 'none');
ws.close(); chrome.kill(); process.exit(0);
