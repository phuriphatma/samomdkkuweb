import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  RELEASES, AREAS, CHANGE_TYPES, LEVELS, LATEST, SYSTEMS, MAJOR_STORY, changeCounts, PENDING
} from '../data/changelog.js';
import { readFileSync } from 'node:fs';
import pkg from '../../package.json';
import { thaiDate, thaiMonth, visibleReleases, spanWeeks } from './changelog.js';
import activity from '../data/dev-activity.json';
import { weeksBetween, releaseCadenceDays } from './dev-activity.js';

describe('changelog data', () => {
  it('is newest-first — the page renders in array order and does not sort', () => {
    const dates = RELEASES.map((r) => r.date);
    expect([...dates].sort().reverse()).toEqual(dates);
    expect(LATEST).toBe(RELEASES[0]);
  });

  it('has unique versions', () => {
    const v = RELEASES.map((r) => r.version);
    expect(new Set(v).size).toBe(v.length);
  });

  it('every release is complete and uses known keys', () => {
    for (const r of RELEASES) {
      expect(r.version, `${r.version} version format`).toMatch(/^\d+\.\d+\.\d+$/);
      expect(r.date, `${r.version} date format`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(r.title?.trim(), `${r.version} title`).toBeTruthy();
      expect(['public', 'staff']).toContain(r.audience);
      expect(LEVELS, `${r.version} level "${r.level}"`).toHaveProperty(r.level);
      expect(r.areas.length, `${r.version} areas`).toBeGreaterThan(0);
      for (const a of r.areas) expect(AREAS, `${r.version} area "${a}"`).toHaveProperty(a);
      expect(r.changes.length, `${r.version} changes`).toBeGreaterThan(0);
      for (const c of r.changes) {
        expect(CHANGE_TYPES, `${r.version} type "${c.type}"`).toHaveProperty(c.type);
        expect(c.text?.trim(), `${r.version} change text`).toBeTruthy();
      }
    }
  });

  /**
   * The whole premise of this file is that it is written for readers. An entry
   * that names a table, a migration or a permission key has slipped back into
   * being a git log, and nobody outside the team can read it.
   */
  it('leaks no engineering identifiers into user-facing copy', () => {
    const banned = [
      /\bmigration\b/i, /\b\d{4}_[a-z_]+\b/, /_[a-z]+_[a-z]+\b/,
      /\bRLS\b/, /\bSELECT\b/, /\bsupabase\b/i, /\bdbRest\b/,
      /\bteam_(nodes|members|people)\b/, /\bvs_tickets\b/,
    ];
    for (const r of RELEASES) {
      const copy = [r.title, r.summary || '', ...r.changes.map((c) => c.text)].join(' ');
      for (const re of banned) {
        expect(copy, `${r.version} matched ${re}`).not.toMatch(re);
      }
    }
  });

  it('counts every change once', () => {
    const c = changeCounts();
    expect(c.total).toBe(RELEASES.reduce((n, r) => n + r.changes.length, 0));
    expect(c.new + c.improved + c.fixed).toBe(c.total);
  });
});

describe('version system', () => {
  const parse = (v) => v.split('.').map(Number);
  const chrono = () => [...RELEASES].reverse(); // oldest first

  it('every version is strictly increasing over time', () => {
    const list = chrono();
    for (let i = 1; i < list.length; i += 1) {
      const [aM, aN, aP] = parse(list[i - 1].version);
      const [bM, bN, bP] = parse(list[i].version);
      const newer = bM > aM || (bM === aM && (bN > aN || (bN === aN && bP > aP)));
      expect(newer, `${list[i].version} must be newer than ${list[i - 1].version}`).toBe(true);
    }
  });

  /**
   * The bump has to match the tier, or the number stops meaning anything —
   * this is the whole contract described in docs/VERSIONING.md.
   */
  it('each bump matches the release level', () => {
    const list = chrono();
    for (let i = 1; i < list.length; i += 1) {
      const [aM, aN] = parse(list[i - 1].version);
      const [bM, bN, bP] = parse(list[i].version);
      const r = list[i];
      if (r.level === 'major') {
        expect([bM, bN, bP], `${r.version} major`).toEqual([aM + 1, 0, 0]);
      } else if (r.level === 'minor') {
        expect([bM, bN, bP], `${r.version} minor`).toEqual([aM, aN + 1, 0]);
      } else {
        expect(bM, `${r.version} patch keeps major`).toBe(aM);
        expect(bN, `${r.version} patch keeps minor`).toBe(aN);
      }
    }
  });

  it('the first release is 1.0.0 and is a major', () => {
    const first = chrono()[0];
    expect(first.version).toBe('1.0.0');
    expect(first.level).toBe('major');
  });

  it('package.json carries the current version', () => {
    expect(pkg.version).toBe(LATEST.version);
  });

  it('every major states what changed about the scope', () => {
    for (const r of RELEASES) {
      if (r.level !== 'major') continue;
      expect(MAJOR_STORY[r.version], `${r.version} needs a MAJOR_STORY`).toBeTruthy();
    }
    // …and no story is stranded on a version that no longer exists.
    for (const v of Object.keys(MAJOR_STORY)) {
      expect(RELEASES.some((r) => r.version === v), `story for missing ${v}`).toBe(true);
    }
  });
});

describe('changelog rendering helpers', () => {
  it('formats an ISO date as Thai Buddhist-era', () => {
    expect(thaiDate('2026-07-24')).toBe('24 ก.ค. 2569');
    expect(thaiDate('2026-01-01')).toBe('1 ม.ค. 2569');
  });

  it('returns the input unchanged when it is not a date', () => {
    expect(thaiDate('')).toBe('');
    expect(thaiDate('nope')).toBe('nope');
  });

  it('formats a month divider', () => {
    expect(thaiMonth('2026-07-24')).toBe('กรกฎาคม 2569');
  });

  it('spans the whole project in weeks', () => {
    expect(spanWeeks(RELEASES)).toBe(13);
    expect(spanWeeks([])).toBe(0);
  });

  it('filters by audience, and "all" keeps everything', () => {
    expect(visibleReleases(RELEASES, 'all')).toHaveLength(RELEASES.length);
    const pub = visibleReleases(RELEASES, 'public');
    expect(pub.length).toBeGreaterThan(0);
    expect(pub.every((r) => r.audience === 'public')).toBe(true);
    expect(visibleReleases(RELEASES, 'public').length + visibleReleases(RELEASES, 'staff').length)
      .toBe(RELEASES.length);
  });
});

describe('dev-activity data', () => {
  it('has a gap-free daily series between the first and last commit', () => {
    const days = activity.heatmap.days;
    expect(days.length).toBe(activity.range.calendarDays);
    expect(days[0][0]).toBe(activity.range.first);
    expect(days[days.length - 1][0]).toBe(activity.range.last);
    for (let i = 1; i < days.length; i += 1) {
      const prev = new Date(`${days[i - 1][0]}T00:00:00Z`).getTime();
      const cur = new Date(`${days[i][0]}T00:00:00Z`).getTime();
      expect(cur - prev, `gap before ${days[i][0]}`).toBe(86400000);
    }
  });

  it('totals agree with the series', () => {
    const days = activity.heatmap.days;
    expect(days.reduce((n, [, c]) => n + c, 0)).toBe(activity.totals.commits);
    expect(days.filter(([, c]) => c > 0).length).toBe(activity.totals.activeDays);
  });

  it('thresholds are strictly increasing, so no two ramp steps collapse', () => {
    const t = activity.heatmap.thresholds;
    expect(t).toHaveLength(4);
    for (let i = 1; i < t.length; i += 1) expect(t[i]).toBeGreaterThan(t[i - 1]);
  });

  it('level 0 means zero commits and nothing else — the grey is not a ramp step', () => {
    for (const [date, count, level] of activity.heatmap.days) {
      expect(level === 0, `${date} count=${count} level=${level}`).toBe(count === 0);
      expect(level).toBeLessThanOrEqual(5);
    }
  });

  it('publishes no email addresses — this repo is public and the JSON is bundled', () => {
    expect(JSON.stringify(activity)).not.toMatch(/@/);
  });
});

/**
 * There is no jsdom in this project and the Chrome extension is not always
 * connected, so a render that throws would otherwise reach production unseen.
 * This stub is deliberately dumb — it is not pretending to be a DOM, it only
 * has to be enough to run the render path end to end and let us assert on the
 * HTML string that comes out. Layout and colour still need a real browser.
 */
function stubDom() {
  const hosts = new Map();
  const el = (tag = 'div') => ({
    tagName: tag.toUpperCase(),
    dataset: {},
    style: {},
    className: '',
    textContent: '',
    innerHTML: '',
    offsetWidth: 40,
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    appendChild(c) { return c; },
    addEventListener() {},
    setAttribute() {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 200, height: 20 }),
    querySelector: () => el(),
    querySelectorAll: () => [],
  });
  globalThis.document = {
    getElementById(id) {
      if (!hosts.has(id)) hosts.set(id, el());
      return hosts.get(id);
    },
    querySelector: () => el(),
    querySelectorAll: () => [],
    addEventListener() {},
    createElement: (t) => el(t),
  };
  globalThis.window = { location: { pathname: '/' } };
  globalThis.location = globalThis.window.location;
  globalThis.requestAnimationFrame = () => {};
  globalThis.performance = { now: () => 0 };
  return hosts;
}

describe('dev-activity panel renders', () => {
  let hosts;
  beforeEach(() => { hosts = stubDom(); });
  afterEach(() => {
    delete globalThis.document; delete globalThis.window;
    delete globalThis.location; delete globalThis.requestAnimationFrame;
    delete globalThis.performance;
  });

  it('shows three outcome tiles and every system on the timeline', async () => {
    const { initDevActivity } = await import('./dev-activity.js');
    expect(() => initDevActivity()).not.toThrow();
    const html = hosts.get('devActivity').innerHTML;

    expect(html.match(/devact-tile-num/g)).toHaveLength(3);
    expect(html.match(/devact-step"/g)).toHaveLength(SYSTEMS.length);
    for (const s of SYSTEMS) expect(html).toContain(s.label);
  });

  /**
   * The panel was rebuilt precisely to stop publishing effort metrics: commit
   * counts, lines of code and streaks measure activity rather than result, and
   * the audience here cannot judge them. This test is the guard rail — it fails
   * if any of them creep back onto the landing page.
   */
  it('publishes no effort metrics — no commits, lines, or streaks', async () => {
    const { initDevActivity } = await import('./dev-activity.js');
    initDevActivity();
    const html = hosts.get('devActivity').innerHTML;
    for (const banned of ['บรรทัด', 'ครั้งที่ส่งงาน', 'ติดกัน', 'วันที่หนักที่สุด', 'ชุดทดสอบ']) {
      expect(html, `leaked "${banned}"`).not.toContain(banned);
    }
    // The raw counts must not appear as bare numbers either.
    expect(html).not.toContain(String(activity.totals.commits));
    expect(html).not.toContain(activity.totals.insertions.toLocaleString('en-US'));
  });

  it('credits the team, not individuals, and injects no markup', async () => {
    const { initDevActivity } = await import('./dev-activity.js');
    initDevActivity();
    const html = hosts.get('devActivity').innerHTML;
    expect(html).toContain("IT SAMO'69");
    // Personal names were dropped from the public credit line; if one comes
    // back it must be a deliberate edit, not a silent re-introduction.
    for (const c of activity.contributors) expect(html).not.toContain(c.name);
    expect(html).not.toMatch(/<script/i);
  });

  /**
   * The in-house framing was removed at the user's request: this project is
   * built with AI assistance, and a loud "100% built by us, no outside help"
   * claim overstates it. Keeping the claim out is the honest position, so the
   * guard is a test rather than a comment.
   */
  it('makes no "built entirely in-house" claim', async () => {
    const { initDevActivity } = await import('./dev-activity.js');
    initDevActivity();
    const html = hosts.get('devActivity').innerHTML;
    for (const claim of ['สร้างขึ้นเอง', 'ภายในสโมสร', 'ไม่ได้จ้าง', '100%']) {
      expect(html, `leaked claim "${claim}"`).not.toContain(claim);
    }
    // Nor a cadence the team does not actually keep — the real gaps run to
    // weeks (17 มิ.ย. → 9 ก.ค.), so "ทุกสัปดาห์" would be a promise, not a fact.
    for (const claim of ['ทุกสัปดาห์', 'ทุกวัน']) {
      expect(html, `promised a cadence: "${claim}"`).not.toContain(claim);
    }
  });
});

describe('outcome maths', () => {
  it('counts whole weeks across the build', () => {
    expect(weeksBetween('2026-04-30', '2026-08-01')).toBe(13);
    expect(weeksBetween('2026-04-30', '2026-04-30')).toBe(1); // never zero
  });

  it('averages the gap between releases', () => {
    expect(releaseCadenceDays(RELEASES)).toBeGreaterThan(0);
    expect(releaseCadenceDays([RELEASES[0]])).toBe(0);
  });

  it('systems are listed in launch order and dated inside the build window', () => {
    const dates = SYSTEMS.map((s) => s.date);
    expect([...dates].sort()).toEqual(dates);
    for (const s of SYSTEMS) {
      expect(s.date >= activity.range.first).toBe(true);
      expect(s.date <= activity.range.last).toBe(true);
    }
  });
});

describe('PENDING — notes staged as the work ships', () => {
  // The whole point of writing a note in the same commit as the change is that
  // it is written while the reason is fresh. That only pays off if the staged
  // note is held to the SAME standard as a released one — otherwise `npm run
  // release` folds engineering jargon straight into the public page.
  it('uses the same shape as a released change', () => {
    for (const c of PENDING) {
      expect(Object.keys(c).sort()).toEqual(['area', 'audience', 'text', 'type']);
      expect(CHANGE_TYPES[c.type], `unknown type ${c.type}`).toBeTruthy();
      expect(AREAS[c.area], `unknown area ${c.area}`).toBeTruthy();
      expect(['public', 'staff']).toContain(c.audience);
      expect(c.text.trim().length).toBeGreaterThan(15);
    }
  });

  it('leaks no engineering identifiers — the same ban list as RELEASES', () => {
    const banned = [
      /\bmigration\b/i, /\b\d{4}_[a-z_]+\b/, /_[a-z]+_[a-z]+\b/,
      /\bRLS\b/, /\bSELECT\b/, /\bsupabase\b/i, /\bdbRest\b/,
      /\bteam_(nodes|members|people)\b/, /\bvs_tickets\b/,
    ];
    for (const c of PENDING) {
      for (const re of banned) {
        expect(c.text, `staged note matched ${re}`).not.toMatch(re);
      }
    }
  });

  it('is not rendered on /updates — unreleased notes are a promise', () => {
    // The landing panel and the changelog page read RELEASES. If PENDING ever
    // gains a reader, that is a product decision, not a refactor.
    const src = readFileSync(new URL('./changelog.js', import.meta.url), 'utf8');
    expect(src).not.toContain('PENDING');
  });
});
