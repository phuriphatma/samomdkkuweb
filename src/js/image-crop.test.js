import { describe, it, expect } from 'vitest';
import { cropGeometry } from './image-crop.js';

// The frame the ทีม SAMO card renders: 3:4 portrait, so ratio (h/w) = 4/3.
const RATIO = 4 / 3;

/** A 3:2 landscape studio shot (the real input) in a 300x400 frame, zoom 1.
 *  cover scale = max(300/3000, 400/2000) = 0.2 → coverW 600, coverH 400. */
const LANDSCAPE = {
  srcW: 3000, srcH: 2000, coverW: 600, frameW: 300, frameH: 400, ratio: RATIO,
};

describe('cropGeometry', () => {
  it('at zoom 1 on a landscape source, takes the full height and a 3:4 slice of the width', () => {
    const g = cropGeometry({ ...LANDSCAPE, zoom: 1, tx: 0, ty: 0 });
    // k = 600/3000 = 0.2 screen px per source px.
    expect(g.sh).toBe(2000);          // 400 / 0.2 — the whole frame height
    expect(g.sw).toBe(1500);          // 300 / 0.2 — exactly 3:4 of it
    expect(g.sx).toBe(750);           // centred: (3000 - 1500) / 2
    expect(g.sy).toBe(0);
  });

  it('produces an output that is exactly the frame ratio', () => {
    const g = cropGeometry({ ...LANDSCAPE, zoom: 1, tx: 0, ty: 0 });
    expect(g.outH / g.outW).toBeCloseTo(RATIO, 6);
  });

  it('panning right moves the crop window LEFT in source coords', () => {
    // Dragging the image right (+tx) reveals what was off the left edge.
    const g = cropGeometry({ ...LANDSCAPE, zoom: 1, tx: 60, ty: 0 });
    expect(g.sx).toBe(750 - 60 / 0.2);  // 450
    expect(g.sw).toBe(1500);
  });

  it('zooming in shrinks the source rect around the same centre', () => {
    const g = cropGeometry({ ...LANDSCAPE, zoom: 2, tx: 0, ty: 0 });
    expect(g.sw).toBe(750);
    expect(g.sh).toBe(1000);
    expect(g.sx).toBe(1125);            // (3000 - 750) / 2
    expect(g.sy).toBe(500);             // (2000 - 1000) / 2
  });

  it('never reads outside the source, however far the pan is pushed', () => {
    for (const tx of [-1e6, -500, 0, 500, 1e6]) {
      for (const ty of [-1e6, -500, 0, 500, 1e6]) {
        const g = cropGeometry({ ...LANDSCAPE, zoom: 1.7, tx, ty });
        expect(g.sx).toBeGreaterThanOrEqual(0);
        expect(g.sy).toBeGreaterThanOrEqual(0);
        expect(g.sx + g.sw).toBeLessThanOrEqual(LANDSCAPE.srcW + 1e-9);
        expect(g.sy + g.sh).toBeLessThanOrEqual(LANDSCAPE.srcH + 1e-9);
      }
    }
  });

  it('a portrait source taller than 3:4 is cropped vertically, not horizontally', () => {
    // 2000x3000 (2:3) in the same frame. cover = max(300/2000, 400/3000) = 0.15
    // → coverW 300, coverH 450: the width already fits, the height overflows.
    const g = cropGeometry({
      srcW: 2000, srcH: 3000, coverW: 300, frameW: 300, frameH: 400,
      ratio: RATIO, zoom: 1, tx: 0, ty: 0,
    });
    expect(g.sw).toBe(2000);                    // full width
    expect(Math.round(g.sh)).toBe(2667);        // 400 / 0.15
    expect(g.sx).toBe(0);
  });

  it('caps the long edge without changing the shape', () => {
    const g = cropGeometry({
      // cover = max(300/6000, 400/4000) = 0.1 → coverW 600.
      srcW: 6000, srcH: 4000, coverW: 600, frameW: 300, frameH: 400,
      ratio: RATIO, zoom: 1, tx: 0, ty: 0, maxEdge: 2400,
    });
    expect(g.sh).toBe(4000);        // the crop still reads 4000 source px…
    expect(g.outH).toBe(2400);      // …but the file is capped
    expect(g.outW).toBe(1800);
  });

  it('never upscales a small source', () => {
    const g = cropGeometry({
      srcW: 600, srcH: 400, coverW: 600, frameW: 300, frameH: 400,
      ratio: RATIO, zoom: 1, tx: 0, ty: 0, maxEdge: 2400,
    });
    expect(g.outH).toBe(400);
    expect(g.outW).toBe(300);
  });
});
