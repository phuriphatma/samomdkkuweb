#!/usr/bin/env node
// ============================================================
// smoke-browser.mjs — load a DEPLOYED build in a real browser and assert the
// handful of things that, when broken, make the whole site useless.
//
//   node tools/smoke-browser.mjs https://samo.md.kku.ac.th
//   node tools/smoke-browser.mjs <preview-url> --expect-ribbon
//   npm run smoke:browser -- https://samo.md.kku.ac.th
//
// WHY A BROWSER AND NOT A `curl`. Every check here is invisible to a fetch of
// the HTML, and each one is a bug this repo has actually shipped:
//
//   · **The entry module never ran.** THE failure mode for this app. Bootstrap
//     comes from a CDN, so every menu still opens and the page looks alive
//     while ~90 inline `onclick="global()"` handlers are dead. A `curl` sees a
//     200 and correct HTML. Cause is any failed fetch of the entry bundle — a
//     >7-day-old cached HTML naming a pruned chunk, flaky wifi, an extension.
//   · **The boot watchdog firing on a HEALTHY load.** Its first version used a
//     bare 8s timer and shouted at people whose connection was merely slow.
//     "No warning bar on a good load" is a real regression check, and only a
//     browser can make it.
//   · **The env ribbon's polarity.** A preview must SAY it is not the live
//     site; production must not. Grepping cannot answer this — a grep for
//     "preview" hits an unrelated announcements button, and the ribbon is
//     appended by JS at runtime. The rendered DOM is the only instrument.
//   · **Horizontal overflow on a phone.** Most of this app's traffic.
//
// NO CREDENTIALS. It loads the site the way an anonymous visitor does, so it
// needs no key, no session and no secret — which is why it is safe to run
// anywhere, including on a public repo's CI. It therefore tests the LOGGED-OUT
// surface only; anything behind sign-in needs `skills/drive-the-browser.md`.
//
// NO DEPENDENCIES. Chrome over CDP using Node's global WebSocket
// (`skills/drive-the-browser.md` §1). GitHub's ubuntu-latest runners ship
// Google Chrome, so this needs no install step.
// ============================================================
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

const args = process.argv.slice(2);
const URL_ = args.find((a) => !a.startsWith('--'));
const EXPECT_RIBBON = args.includes('--expect-ribbon');
const NO_RIBBON = args.includes('--expect-no-ribbon');

if (!URL_) {
  console.error('usage: node tools/smoke-browser.mjs <url> [--expect-ribbon|--expect-no-ribbon]');
  process.exit(2);
}

const CHROME = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
].find((p) => existsSync(p));

if (!CHROME) {
  console.error('no Chrome found — install Google Chrome or Chromium');
  process.exit(2);
}

const PORT = 9411 + (process.pid % 100);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0;
let fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass += 1; console.log('  PASS', name); }
  else { fail += 1; console.log('  FAIL', name, detail ? `— ${String(detail).slice(0, 200)}` : ''); }
};

const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`, '--no-first-run', '--no-sandbox',
  '--disable-gpu', '--disable-dev-shm-usage', '--hide-scrollbars',
  `--user-data-dir=/tmp/samo-smoke-${process.pid}`, 'about:blank',
], { stdio: 'ignore' });

async function wsUrl() {
  for (let i = 0; i < 80; i += 1) {
    try {
      const j = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
      if (j.webSocketDebuggerUrl) return j.webSocketDebuggerUrl;
    } catch { /* not up yet */ }
    await sleep(250);
  }
  throw new Error('Chrome did not expose a debugging port');
}

const ws = new WebSocket(await wsUrl());
await new Promise((r) => ws.addEventListener('open', r, { once: true }));

let id = 0;
const pending = new Map();
const consoleErrors = [];
const failedRequests = [];

ws.addEventListener('message', (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); return; }
  if (msg.method === 'Runtime.exceptionThrown') {
    consoleErrors.push(msg.params.exceptionDetails?.text
      || msg.params.exceptionDetails?.exception?.description || 'exception');
  }
  if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
    consoleErrors.push(msg.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
  }
  // A failed fetch of the ENTRY BUNDLE is the cause of the dead-page bug, and
  // it is silent in the console on some browsers. Watch the network directly.
  if (msg.method === 'Network.loadingFailed') {
    failedRequests.push(`${msg.params.type}: ${msg.params.errorText}`);
  }
});

const send = (method, params = {}, sessionId) => new Promise((res) => {
  const i = (id += 1);
  pending.set(i, res);
  ws.send(JSON.stringify({ id: i, method, params, ...(sessionId ? { sessionId } : {}) }));
});

const { result: { targetId } } = await send('Target.createTarget', { url: 'about:blank' });
const { result: { sessionId } } = await send('Target.attachToTarget', { targetId, flatten: true });
await send('Page.enable', {}, sessionId);
await send('Runtime.enable', {}, sessionId);
await send('Network.enable', {}, sessionId);

const evalJs = async (expression) => {
  const r = await send('Runtime.evaluate',
    { expression, awaitPromise: true, returnByValue: true }, sessionId);
  return r.result?.result?.value;
};

console.log(`\nsmoke: ${URL_}\n`);

// Phone first — it is most of this app's traffic, and the width where layout
// faults actually appear.
await send('Emulation.setDeviceMetricsOverride',
  { width: 390, height: 844, deviceScaleFactor: 2, mobile: true }, sessionId);
await send('Page.navigate', { url: URL_ }, sessionId);

// Wait for the ENTRY MODULE, not for a timer. `window.__samoBooted` is the same
// signal the in-page watchdog uses, so this asks the page's own question.
let booted = false;
for (let i = 0; i < 60 && !booted; i += 1) {
  booted = (await evalJs('window.__samoBooted === true')) === true;
  if (!booted) await sleep(500);
}
await sleep(1500);   // let the watchdog's own timer have its chance to fire

const probe = await evalJs(`(() => ({
  booted: window.__samoBooted === true,
  title: document.title,
  bootFailBar: !!document.getElementById('samoBootFail'),
  ribbon: (document.querySelector('.samo-env-ribbon') || {}).textContent || null,
  scrollW: document.documentElement.scrollWidth,
  clientW: document.documentElement.clientWidth,
  visibleText: (document.body.innerText || '').trim().length,
  handlers: ['samoSignOut', 'goToAbout', 'navigateTo', 'activateTab']
    .filter((n) => typeof window[n] === 'function'),
  inlineOnclicks: document.querySelectorAll('[onclick]').length,
}))()`);

// 1. THE headline check: the module graph ran. Everything inline depends on it.
check('the entry module ran (window.__samoBooted)', probe.booted === true,
  'the page will look alive and every inline onclick will be dead');

// 2. The inline handlers those onclicks call actually exist.
check(`window-bound handlers exist (${probe.handlers.length}/4)`,
  probe.handlers.length === 4,
  `missing: ${['samoSignOut', 'goToAbout', 'navigateTo', 'activateTab'].filter((n) => !probe.handlers.includes(n)).join(', ')}`);

// 3. The watchdog must NOT accuse a healthy load. Its first version did.
check('no boot-failure bar on a healthy load', probe.bootFailBar === false,
  'the watchdog fired on a page that booted — it is crying wolf again');

// 4. Something was actually painted.
check('the page rendered real content', probe.visibleText > 200,
  `only ${probe.visibleText} characters of visible text`);

// 5. No horizontal scroll at 390px.
check('no horizontal overflow at 390px', probe.scrollW <= probe.clientW + 1,
  `scrollWidth ${probe.scrollW} > clientWidth ${probe.clientW}`);

// 6. The ribbon says which world this is — only when asked.
if (EXPECT_RIBBON) {
  check('a non-production build says so on the page', Boolean(probe.ribbon),
    'no .samo-env-ribbon — a developer cannot tell this from the live site');
} else if (NO_RIBBON) {
  check('production paints NO env ribbon', probe.ribbon === null,
    `ribbon present: ${probe.ribbon}`);
}

// 7. Nothing failed to load, and nothing threw.
const bundleFailures = failedRequests.filter((f) => /Script|Stylesheet|Document/i.test(f));
check('no script or stylesheet failed to load', bundleFailures.length === 0,
  bundleFailures.join(' | '));
check('no uncaught errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));

// 8. Desktop too — one width proves nothing about the other.
await send('Emulation.setDeviceMetricsOverride',
  { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId);
await sleep(800);
const wide = await evalJs('({ s: document.documentElement.scrollWidth, c: document.documentElement.clientWidth })');
check('no horizontal overflow at 1280px', wide.s <= wide.c + 1, `${wide.s} > ${wide.c}`);

console.log(`\n${pass} passed, ${fail} failed  (${URL_})`);
ws.close();
chrome.kill();
process.exit(fail === 0 ? 0 : 1);
