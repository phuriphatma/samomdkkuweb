// The admin landing must offer every tool the sidebar does.
//
// REPORTED: "i think more tools in admin tab than tools shown in admin
// dashboard, add more". It was true and it was worse than cosmetic: `team`,
// `house`, `order` and `analytics` were keys in SIDE_FEATURE — so they had a
// sidebar entry, a pane and a gate — and had no card on the landing. An admin
// whose ONLY grant was one of those four signed in and landed on a page with
// nothing on it, because every card there is `d-none` until its gate passes.
//
// This is class 6 in the form the repo has already paid for once: "one list
// spelled out by hand beside a shared constant" (main.js's own five-key
// admin-link list vs ADMIN_FEATURES, 0113). The landing cards are hand-written
// HTML and SIDE_FEATURE is the real list; a comment asking the next person to
// keep them in step is not a mechanism, so this is the mechanism.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const LANDING = readFileSync(new URL('../../admin/index.html', import.meta.url), 'utf8');
const MAIN = readFileSync(new URL('./admin-main.js', import.meta.url), 'utf8');

/** The keys of SIDE_FEATURE, read out of the source rather than imported —
 *  admin-main.js runs Quill and the whole admin app at import time. */
function sideFeatureKeys() {
  const block = MAIN.match(/const SIDE_FEATURE = \{([\s\S]*?)\n\};/);
  expect(block).not.toBeNull();
  return [...block[1].matchAll(/^\s*(\w+):/gm)].map((m) => m[1]);
}

/** Every `data-admin-side` inside the landing card grid. Scoped to the grid so
 *  the SIDEBAR's own data-admin-side buttons are not counted as cards. */
function landingCardKeys() {
  const grid = LANDING.match(/<div class="row g-3" id="adminLandingCards">([\s\S]*?)\n {12}<\/div>/);
  expect(grid).not.toBeNull();
  return [...grid[1].matchAll(/data-admin-side="([\w-]+)"/g)].map((m) => m[1]);
}

describe('the admin landing and the sidebar are one list', () => {
  it('gives every sidebar tool a landing card', () => {
    const side = sideFeatureKeys().filter((k) => k !== 'landing');
    const cards = landingCardKeys();
    for (const key of side) expect(cards).toContain(key);
  });

  it('has no landing card for a tool the sidebar cannot open', () => {
    // The other direction. A card whose key is not in SIDE_FEATURE is a button
    // that either 404s or, worse, is never gated and so shows to everyone.
    const side = sideFeatureKeys();
    for (const key of landingCardKeys()) expect(side).toContain(key);
  });

  it('gates every card — a card with no data-admin-side shows to everyone', () => {
    const grid = LANDING.match(/<div class="row g-3" id="adminLandingCards">([\s\S]*?)\n {12}<\/div>/)[1];
    const cols = [...grid.matchAll(/<div class="col-[^"]*"([^>]*)>/g)];
    expect(cols.length).toBeGreaterThan(0);
    for (const [, attrs] of cols) expect(attrs).toMatch(/data-admin-side="/);
  });

  it('starts every card hidden — visibility is granted, never assumed', () => {
    // admin-main.js REMOVES d-none for the features a user holds. A card that
    // ships visible is one the gate can only ever hide too late, after it has
    // been painted to someone who may not hold it.
    const grid = LANDING.match(/<div class="row g-3" id="adminLandingCards">([\s\S]*?)\n {12}<\/div>/)[1];
    for (const [, attrs] of grid.matchAll(/<div class="(col-[^"]*)"[^>]*data-admin-side=/g)) {
      expect(attrs).toContain('d-none');
    }
  });
});

describe('ข้อมูลของฉัน lives on the landing, not inside ทีม SAMO', () => {
  it('has a host on the landing', () => {
    expect(LANDING).toContain('id="adminMySeat"');
    expect(LANDING).toContain('id="adminMeBlock"');
  });

  it('is not gated behind the team grant any more', () => {
    // The whole point of the move: an admin whose grants are `pr` and
    // `samoshop` could not reach their own record from /admin/ at all.
    const grid = LANDING.match(/<div class="row g-3" id="adminLandingCards">([\s\S]*?)\n {12}<\/div>/)[1];
    expect(grid).not.toContain('adminMySeat');
    const team = readFileSync(new URL('../html/tab-team.html', import.meta.url), 'utf8');
    expect(team).not.toContain('data-team-mode="me"');
    expect(team).not.toContain('id="teamMySeat"');
  });

  it('renders the SHARED card, never a second implementation', () => {
    expect(MAIN).toMatch(/import \{ loadMySeat, renderMySeat \} from '\.\/my-seat\.js'/);
  });
});
