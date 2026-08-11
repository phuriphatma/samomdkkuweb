# เกี่ยวกับเรา on mobile — the three-option demo

**Status: a decision is waiting on the owner. No app code has been changed.**
Nothing in `src/` implements any of this; it is a comparison built to be looked
at, on the owner's phone, so they can pick a direction.

Published (private artifact, same URL across updates):
<https://claude.ai/code/artifact/0c4533a8-099a-49c0-bf48-35173db32cc0>

---

## Why it exists

2026-08-12 the owner reported that the org chart on `/about` "doesn't look good
on mobile, the width can only show one column", and asked whether 3D (three.js)
would be better. Measured on the live site at a 390px viewport, before anything
was built:

| | |
|---|---|
| แผนผัง view, whole page height | **108,726 px** (~130 screens) |
| รายการ view, same width | 12,484 px |
| Width one person card actually uses | **~35%** — one row holds one person |
| The data | 398 คน · 270 ตำแหน่ง · 11 ฝ่าย · 5 levels deep · up to 21 people in one ตำแหน่ง |
| People with a photo uploaded | **10 of 398** |

That last row is the one that keeps being forgotten: any "wall of faces"
design is mostly default avatars today, so the real work behind option ค is
persuading people to upload, not writing code.

## What the page contains

Three live phone frames over the **same real data**, each scrollable:

- **แบบ ก — today.** Faithful reproduction of the current แผนผัง layout: one
  person per row, one indent step per level.
- **แบบ ข — the proposal.** ฝ่าย accordions, sticky ฝ่าย chips, search, and a
  4-column tile grid. A ตำแหน่ง only earns its own heading row when it holds 3+
  people; everyone else carries their ตำแหน่ง as a caption on their own tile.
  That one rule is where most of the height saving comes from.
- **แบบ ค — 3D force graph.** A top-down (`dagMode: 'td'`-style) force-directed
  graph, in the spirit of `vasturiano/3d-force-graph`'s tree example, where
  every person is a photo card. Force simulation is hand-written (see below).

The height numbers printed under frames ก and ข are **measured live from the
DOM at render time**, not typed in — and both are measured with every ฝ่าย
expanded, so they compare like with like. An earlier version compared ก
fully-expanded against ข with one ฝ่าย open and reported a 22× win that was
really about the collapse; it now reports ~3.2×, plus the 1,247px you actually
land on.

## The recommendation given

1. **Ship แบบ ข.** It is the fix for what was reported, needs no new library,
   and helps desktop too (more columns, same code).
2. **Decide on 3D separately.** If yes: a hero of ~40% viewport height above the
   list, skippable, lazy-loaded — so someone who came to look up a name does not
   pay 713 KB + 1.6 MB for it.
3. If only the *look* is wanted, the same rotating constellation is ~100 lines
   of canvas at 0 KB. The library only earns its place if the cards do.

---

## Rebuilding it

Nothing generated is committed (see `.gitignore` — the atlas bakes real names
next to real portraits, and this repo is public). From this directory:

```bash
node fetch-data.mjs      # public RPC → chart-raw.json, photo-urls.json, photos/
node build-data.mjs      # → org-demo.json (compact tree the frames render)
npm pack three@latest && tar xzf three-*.tgz     # three.js source
printf "import * as THREE from './package/build/three.module.js';\nwindow.THREE = THREE;\n" > three-entry.js
npx esbuild three-entry.js --bundle --minify --format=iife --outfile=three-bundle.js
node atlas.mjs           # bakes 398 cards → atlas.jpg.txt + cards.json
node assemble.mjs        # → about-mobile.html (self-contained, ~2.5 MB)
```

`evid.jpg` (the screenshot of the live site in the "ปัญหา" section) is optional;
`assemble.mjs` drops the figure if it is missing. To regenerate it:
`node tools/org.mjs 390 chart ./org-chart-390.png`, then crop with `sips`.

Publish `about-mobile.html` with the Artifact tool, passing the URL above so it
updates in place instead of minting a new one.

### Why the atlas is baked in a browser

Thai needs real shaping — vowels above and below the consonant, tone marks
stacked on those. Canvas 2D uses the platform's text engine, so drawing each
card there and handing the pixels to WebGL gets correct Thai for free.
Generating glyphs inside a shader does not. The cost is that the text is an
image: no Ctrl+F, no selection, and it pixelates when zoomed hard.

## `tools/` — headless Chrome drivers

The Chrome extension is usually not connected, so everything here is driven over
CDP with Node 22's global `WebSocket`. Each takes args and writes a PNG.

| script | what it is for |
|---|---|
| `org.mjs <width> <list\|chart> <out>` | screenshot + measure the **live site's** /about page |
| `check.mjs <width> <out> [full] [light\|dark]` | render the demo, print measurements, collect console errors |
| `shot3d.mjs <waitMs> <out>` | let the 3D frame settle, then screenshot it |
| `dbg.mjs` | print the graph's internal state (camera distance, position extents, NaN check) |
| `focus.mjs` | click a ฝ่าย chip, verify the focus + reframe |
| `full.mjs` | click เต็มจอ, verify both the real Fullscreen API and the overlay fallback |

`dbg.mjs` is the one that matters. It needs `window.__dbg` to exist — a hook
that is deliberately **not** in the committed source. Re-add it temporarily
inside `start3d()` when debugging:

```js
window.__dbg = () => ({ dist, settled, fitted, focus, center: center.toArray(),
  cam: camera.position.toArray(), nan: [...pos].some(Number.isNaN),
  maxAbs: Math.max(...[...pos].map(Math.abs)) });
```

---

## KNOWN BUG — zoom, still open

**Reported twice by the owner, still reproducing as of 2026-08-12.** The second
report was "the demo still has bug when zoom" after the first fix, so what is
written below is a *partial* diagnosis, not a solved problem. Do not assume the
cause is known.

**Symptom**: while zooming (pinch or wheel) the view flickers to a different
framing and then snaps back.

**Fixed so far (and it was real)**: the camera auto-fit was re-armed by *any*
resize, and a pinch resizes the visual viewport on mobile — so the gesture and
the auto-fit fought each other. `userZoomed` now latches on the first manual
zoom and only an explicit action (fullscreen, layout toggle, ฝ่าย focus) is
allowed to reframe. See `zoomBy()` and the `ResizeObserver` in `frameC.js`.

**Still wrong — leads worth trying, in order:**

1. **The other reframe paths.** `applyFocus()` sets `userZoomed = false` and
   `fitted = false`, and the ฝ่าย legend is a horizontally scrollable strip
   *inside* the stage — a scroll or an accidental tap there could reframe
   mid-gesture. Check whether the flicker only happens after touching it.
2. **`center.lerp(target, 0.08)` runs every frame.** The camera orbits an eased
   centroid, so any change in what is "in view" glides the camera for ~1s. If a
   zoom changes nothing about the centroid this is invisible; if something does
   change it, it reads exactly as "a different view, then back".
3. **Two `IntersectionObserver`s toggle the rAF loop.** Zooming the *page* (not
   the graph) changes intersection ratios; a cancel/restart of the loop with a
   stale last frame on the canvas would flash.
4. **Pinch handling is split** between `touchmove` (two fingers) and `wheel`
   (ctrl+wheel on trackpads). A browser that emits both for one gesture applies
   the zoom twice, at different rates.

**Reproduce it properly first** — on the device the owner used, since the
`touchmove` path never runs under a headless mouse. `dbg.mjs` printing `dist`
across a gesture will show whether the distance is being overwritten or whether
the camera *position* is moving for another reason.

## History worth not repeating

- **A hard positional clamp inside a relaxation loop ratchets.** The ฝ่าย wedge
  started as a hard clamp back into the slice; cards squeezed inside it could
  only relieve pressure by sliding outward, so the graph grew to a radius of
  5,708 units — past the camera's far plane. It rendered as a **completely blank
  canvas, with no error**. It is a spring with a radius cap now.
- **A blank canvas is not a diagnosis.** "Nothing rendered" and "everything flew
  off screen" look identical. Printing `maxAbs` of the position buffer found it
  in one shot; staring at the picture would not have.
