import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9227;
const WAIT = Number(process.argv[2] || 14000);
const OUT = process.argv[3] || './shot3d.png';
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`,
  '--user-data-dir=/tmp/cdp-profile-3d', '--no-first-run', '--allow-file-access-from-files',
  '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  '--window-size=1200,900', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await sleep(2500);
const t = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
const ws = new WebSocket(t.find((x) => x.type === 'page').webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0; const pending = new Map(); const logs = [];
ws.onmessage = (e) => { const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) pending.get(m.id)(m);
  if (m.method === 'Runtime.exceptionThrown') logs.push('EXC: ' + (m.params.exceptionDetails.exception?.description || '').slice(0, 300));
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') logs.push('ERR: ' + m.params.args.map((a) => a.value).join(' ').slice(0, 200));
};
const send = (m, p = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
const ev = async (x) => { const r = await send('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true }); return r.result?.result?.value ?? r.result?.exceptionDetails?.exception?.description; };
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1200, height: 900, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: `file://${process.cwd()}/about-mobile.html` });
await sleep(3000);
await ev(`document.getElementById('frameC').scrollIntoView({block:'center'}); 'ok'`);
await sleep(WAIT);
console.log('state:', await ev(`JSON.stringify({
  status: document.getElementById('cStatus')?.textContent,
  hidden: document.getElementById('cStatus')?.hidden,
  canvasSize: (() => { const c = document.querySelector('#frameC canvas'); return c ? c.width + 'x' + c.height : 'none'; })(),
  labels: [...document.querySelectorAll('#frameC .c-label')].filter(e=>e.style.display!=='none').length,
})`));
console.log('errors:', logs.length ? logs : 'none');
const s = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync(OUT, Buffer.from(s.result.data, 'base64'));
console.log('wrote', OUT);
ws.close(); chrome.kill(); process.exit(0);
