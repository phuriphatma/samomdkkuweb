# Driving the app in a real browser

The Chrome extension (`mcp__claude-in-chrome__*`) is **usually not connected** in
this repo's sessions. Drive the app yourself instead. This has found bugs nothing
else could — the dead ยกเลิก button in every confirm dialog, and the iPad
portrait that no DOM measurement could see.

Two engines, and you need both:

| Engine | Use it for | How |
|---|---|---|
| **Chrome** (headless, CDP) | everything by default | Node 22's global `WebSocket`, no dependency |
| **WebKit** (Playwright) | anything the owner reports on **iPad/iPhone/Safari** | `npx playwright install webkit` |

---

## 1. Chrome over CDP — no dependencies

Node 22 has a global `WebSocket`, so a driver is ~40 lines and needs nothing
installed. Launch Chrome with `--headless=new --remote-debugging-port=PORT`, poll
`http://127.0.0.1:PORT/json/version` for `webSocketDebuggerUrl`, then
`Target.createTarget` → `Target.attachToTarget` → `Page.enable` +
`Runtime.enable`, and evaluate with
`Runtime.evaluate {expression, awaitPromise:true, returnByValue:true}`.

Useful extras:

- `Emulation.setDeviceMetricsOverride {deviceScaleFactor:2}` — **retina**. Half
  the responsive-image bugs only appear at DPR 2.
- `Page.captureScreenshot {captureBeyondViewport:true, clip:{x,y,width,height,scale}}`
  — clip in PAGE coordinates (`rect.y + window.scrollY`), `scale:2` to read small
  Thai text.
- Collect `Runtime.consoleAPICalled` and `Runtime.exceptionThrown` into an array
  and print it. "No console errors" is a real assertion.

### Reaching the page you want

The public SPA opens on the landing tab. To get to a tab:

```js
document.querySelector('[data-bs-target="#pills-about"]')?.click()
```

Then wait — this app lazy-imports (d3, esign, shop QR). 2–5 s per step, and
`await sleep()` after every click that triggers a dynamic import.

---

## 2. WebKit, when the report comes from an iPad

```bash
npx playwright install webkit          # ~1 min, cached in ~/Library/Caches/ms-playwright
```

```js
import { webkit, devices } from 'playwright';
const ctx = await (await webkit.launch()).newContext({ ...devices['iPad Pro 11'] });
```

This is the same engine as mobile Safari. It reproduced the foreignObject paint
bug exactly.

`await page.route('**lh3.googleusercontent.com/**', r => r.abort())` forces the
broken-image state deliberately, instead of waiting to see if the network fails.

---

## 3. THE IMPORTANT PART: pick an instrument that can see the bug

**`getBoundingClientRect()` cannot see a paint bug.** On the iPad portrait bug it
returned the CORRECT box for every variant, including the broken ones — layout
was right, only the compositing was wrong. Computed style said `position:
relative` and nothing looked out of place.

When something is visibly wrong but every measurement says fine, **measure the
pixels**:

1. Replace the subject with a solid, unmistakable colour
   (`canvas.toDataURL()` of a `#cc3333` rect) so it cannot be confused with the
   design.
2. Screenshot.
3. Decode with `pngjs` and find the bounding box of that colour.
4. Compare to what `getBoundingClientRect()` claims. **A mismatch is the bug.**

```js
const png = PNG.sync.read(readFileSync('shot.png'));
const dpr = png.width / (await page.evaluate('innerWidth'));   // ← do not forget
let x0=1e9,y0=1e9,n=0;
for (let y=0;y<png.height;y++) for (let x=0;x<png.width;x++){
  const i=(png.width*y+x)<<2;
  if (png.data[i]>150 && png.data[i+1]<90 && png.data[i+2]<90){ n++; if(x<x0)x0=x; if(y<y0)y0=y; }
}
```

Divide by `dpr` before comparing to CSS pixels.

### Isolate with a minimal page, one property at a time

Once the pixels disagree with the layout, do NOT bisect the app. Write a
standalone HTML file reproducing the structure (for the iPad bug: a
`<g transform="translate(300,200)">` over a `<foreignObject>`), expose a
`setVariant(cls)` hook, and loop over one property at a time measuring the
painted position. The answer arrives in one run and it is unambiguous:

```
overflow:hidden · aspect-ratio · display:grid · border-radius  →  312,214  ok
position:relative                                              →   12, 14  wrong
```

12,14 was 312−300, 214−200 — off by exactly the transform. Nothing else could
have named the culprit that precisely.

---

## 4. Always run a CONTROL

Headless environments intermittently have **no egress to
`lh3.googleusercontent.com`**. Portraits then fail to load and it looks like a
bug you just introduced.

The control: check whether an **already-shipped, untouched** view has the same
symptom, and whether a bare `new Image()` to the same URL loads. On one run the
existing รายการ view loaded 0/11 images and the raw probe errored — proving the
environment, not the code. Do this before reporting an image bug.

---

## 5. Verify against PRODUCTION, not just localhost

`npm run preview` serves `dist/` on `:4173`. Verify there while iterating, then
re-run the same script against `https://samo.md.kku.ac.th/` after deploying. The
VM builds its own asset hashes, so a localhost pass proves nothing about prod —
see `skills/deploy-vm.md`.

---

## 6. Housekeeping

Put drivers in the scratchpad, never in the repo. Kill Chrome and the preview
server when done:

```bash
pkill -f "vite preview"; pkill -f "remote-debugging-port=92"
```

Use a distinct `--remote-debugging-port` per concurrent driver; a stale Chrome on
the same port silently attaches you to the wrong browser.
