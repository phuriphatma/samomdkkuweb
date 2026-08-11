import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9229;
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`,
  '--user-data-dir=/tmp/cdp-profile-full', '--no-first-run', '--allow-file-access-from-files',
  '--enable-unsafe-swiftshader', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await sleep(2500);
const t = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
const ws = new WebSocket(t.find((x) => x.type === 'page').webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0; const pending = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) pending.get(m.id)(m); };
const send = (m, p = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
const ev = async (x) => { const r = await send('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true, userGesture: true }); return r.result?.result?.value ?? r.result?.exceptionDetails?.exception?.description; };
await send('Emulation.setDeviceMetricsOverride', { width: 1200, height: 900, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: `file://${process.cwd()}/about-mobile.html` });
await sleep(3000);
await ev(`document.getElementById('frameC').scrollIntoView({block:'center'}); 'ok'`);
await sleep(14000);
console.log('before:', await ev(`(() => { const s = document.getElementById('frameC').getBoundingClientRect(); return s.width + 'x' + Math.round(s.height); })()`));
await ev(`document.getElementById('cFull').click(); 'clicked'`);
await sleep(2500);
console.log('after :', await ev(`(() => {
  const st = document.getElementById('frameC');
  const r = st.getBoundingClientRect();
  const c = st.querySelector('canvas');
  return JSON.stringify({
    rect: Math.round(r.width) + 'x' + Math.round(r.height),
    expanded: st.classList.contains('is-expanded'),
    realFullscreen: document.fullscreenElement === st,
    canvas: c.width + 'x' + c.height,
    btn: document.getElementById('cFull').textContent,
    locked: document.body.classList.contains('is-locked'),
  });
})()`));
const s = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync('./fullscreen.png', Buffer.from(s.result.data, 'base64'));
await ev(`document.getElementById('cFull').click(); 'exit'`);
await sleep(1200);
console.log('exit  :', await ev(`(() => { const st = document.getElementById('frameC'); return JSON.stringify({ expanded: st.classList.contains('is-expanded'), locked: document.body.classList.contains('is-locked'), btn: document.getElementById('cFull').textContent }); })()`));
ws.close(); chrome.kill(); process.exit(0);
