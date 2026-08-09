import { describe, it, expect } from 'vitest';
import { findIssues } from './health.js';

// The pane and tools/team-identity-dryrun.mjs implement the SAME resolution
// rule on opposite sides of the wire. These cases are written from the LIVE
// data the tool reported, so if the two ever drift apart, this fails.
const m = (o) => ({
  id: o.id, node_id: o.node || 'n1', full_name: o.name || null,
  nickname: o.nick || null, year: o.year || null, major: o.major || null,
  photo_url: o.photo || null, student_id: o.sid || null, kkumail: o.mail || null,
});
const run = (rows) => findIssues(rows, () => 'ฝ่ายทดสอบ');
const kinds = (rows) => run(rows).issues.map((i) => i.kind).sort();

describe('findIssues — grouping', () => {
  it('two rows with the same kkumail are ONE person', () => {
    const { people } = run([
      m({ id: 'a', name: 'มานี', mail: 'm.ja@kkumail.com', sid: '659999999-9' }),
      m({ id: 'b', name: 'มานี', mail: 'M.JA@kkumail.com', sid: '659999999-9' }),
    ]);
    expect(people).toHaveLength(1);
    expect(people[0].rows).toHaveLength(2);
  });

  it('two rows sharing only a รหัสนักศึกษา are one person', () => {
    const { people } = run([
      m({ id: 'a', name: 'ก', sid: '111-1' }),
      m({ id: 'b', name: 'ก', sid: '111-1' }),
    ]);
    expect(people).toHaveLength(1);
  });

  it('NEVER merges on name alone', () => {
    const { people } = run([
      m({ id: 'a', name: 'สมชาย ใจดี' }),
      m({ id: 'b', name: 'สมชาย ใจดี' }),
    ]);
    expect(people).toHaveLength(2);
  });

  // The live 673070332-6 case: one mistyped id, two humans, correct emails.
  it('does NOT fuse two different emails because a รหัสนักศึกษา matches', () => {
    const rows = [
      m({ id: 'a', name: 'จิรายุทธ โยชน์เมืองไพร', mail: 'jirayut.y@kkumail.com', sid: '673070332-6' }),
      m({ id: 'b', name: 'โรจนศักดิ์ เบี้ยไธสง', mail: 'rodjanasak.b@kkumail.com', sid: '673070332-6' }),
    ];
    expect(run(rows).people).toHaveLength(2);
    expect(kinds(rows)).toContain('sid_clash');
  });
});

describe('findIssues — rule 2: a row with no address is UNKNOWN, not different', () => {
  it('a no-email row joins the one person claiming its รหัส', () => {
    // The reported case, exactly: two postings for ชญาภา, one carrying the
    // address and one carrying nothing.
    const rows = [
      m({ id: 'a', name: 'ชญาภา เลาหะตานนท์', mail: 'chayapa.l@kkumail.com', sid: '663070019-9' }),
      m({ id: 'b', name: 'ชญาภา เลาหะตานนท์', mail: null, sid: '663070019-9' }),
    ];
    const { people, issues } = run(rows);
    expect(people).toHaveLength(1);
    expect(issues.some((i) => i.kind === 'sid_clash')).toBe(false);
  });

  it('…and says the empty posting still needs its address', () => {
    // Resolving it must not turn the finding into silence: every resolver in
    // this app joins team_members.kkumail, so that posting is invisible to the
    // person's own card and to every permission lookup until it is filled.
    const rows = [
      m({ id: 'a', name: 'ชญาภา', mail: 'chayapa.l@kkumail.com', sid: '663070019-9' }),
      m({ id: 'b', name: 'ชญาภา', mail: null, sid: '663070019-9' }),
    ];
    const gap = run(rows).issues.find((i) => i.kind === 'mail_gap');
    expect(gap).toBeTruthy();
    expect(gap.memberId).toBe('b');
    expect(gap.value).toBe('chayapa.l@kkumail.com');   // the answer, not a guess
  });

  it('NEVER merges two people who both have an address (0108)', () => {
    // 673070332-6 is one mistyped รหัส worn by two humans. Both rows carry an
    // address, so rule 2 does not look at them and the clash is still real.
    const rows = [
      m({ id: 'a', name: 'ก', mail: 'a@kkumail.com', sid: '673070332-6' }),
      m({ id: 'b', name: 'ข', mail: 'b@kkumail.com', sid: '673070332-6' }),
    ];
    expect(run(rows).people).toHaveLength(2);
    expect(kinds(rows)).toContain('sid_clash');
  });

  it('leaves a no-email row SEPARATE when two people claim its รหัส', () => {
    // Guessing between them would put a posting on the wrong human, which is
    // worse than the finding it would silence.
    const rows = [
      m({ id: 'a', name: 'ก', mail: 'a@kkumail.com', sid: '673070332-6' }),
      m({ id: 'b', name: 'ข', mail: 'b@kkumail.com', sid: '673070332-6' }),
      m({ id: 'c', name: 'ค', mail: null, sid: '673070332-6' }),
    ];
    expect(run(rows).people).toHaveLength(3);
  });

  it('a no-email row whose รหัส nobody claims stays on its own', () => {
    const rows = [
      m({ id: 'a', name: 'ก', mail: 'a@kkumail.com', sid: '111111111-1' }),
      m({ id: 'b', name: 'ข', mail: null, sid: '222222222-2' }),
    ];
    expect(run(rows).people).toHaveLength(2);
  });

  it('two no-email rows sharing a รหัส are still one person (rule 3)', () => {
    const rows = [
      m({ id: 'a', name: 'ก', mail: null, sid: '333333333-3' }),
      m({ id: 'b', name: 'ก', mail: null, sid: '333333333-3' }),
    ];
    expect(run(rows).people).toHaveLength(1);
    // No mail_gap: there is no address anywhere to offer, so it is a no_key.
    expect(kinds(rows)).not.toContain('mail_gap');
  });
});

describe('findIssues — invalid email', () => {
  // The live ชญาภา case: kkumail is literally '-'.
  it('a value with no @ is reported, and does NOT split the person', () => {
    const rows = [
      m({ id: 'a', name: 'ชญาภา', mail: '-', sid: '663070019-9' }),
      m({ id: 'b', name: 'ชญาภา', mail: 'chayapa.l@kkumail.com', sid: '663070019-9' }),
    ];
    const { issues, people } = run(rows);
    // REVERSED deliberately. This used to assert 2 people — "'-' cannot group
    // them" — and that was the fail-open reading: a cell holding a placeholder
    // is an ABSENT identity, not a claim to be a different human. Treating it
    // as a second person produced a รหัสซ้ำ finding about one person, which is
    // exactly what was reported live ("this person is the same person but it
    // detects wrong because no email").
    expect(people).toHaveLength(1);
    // …and the real problem is still reported, with the cell to fix.
    expect(issues.some((i) => i.kind === 'invalid_email' && i.value === '-')).toBe(true);
    expect(issues.some((i) => i.kind === 'sid_clash')).toBe(false);
    // Not ALSO a mail_gap: one cell, one finding.
    expect(issues.some((i) => i.kind === 'mail_gap')).toBe(false);
  });

  it('an empty kkumail is not reported as invalid', () => {
    expect(kinds([m({ id: 'a', name: 'ก', mail: '   ', sid: '1' })])).not.toContain('invalid_email');
  });
});

describe('findIssues — drift', () => {
  it('reports each disagreeing field once, with every value', () => {
    const { issues } = run([
      m({ id: 'a', name: 'วรวลัญช์ สุขเอนก', mail: 'w@kkumail.com', nick: 'ปรายฟ้า' }),
      m({ id: 'b', name: 'วรวลัญช์ สุขเอนก', mail: 'w@kkumail.com', nick: 'ปลายฟ้า' }),
    ]);
    const drift = issues.filter((i) => i.kind === 'drift');
    expect(drift).toHaveLength(1);
    expect(drift[0].field).toBe('nickname');
    expect(drift[0].values.map((v) => v.value).sort()).toEqual(['ปรายฟ้า', 'ปลายฟ้า'].sort());
    expect(drift[0].memberIds.sort()).toEqual(['a', 'b']);
  });

  it('a value present on one row and absent on the other is NOT drift', () => {
    // Absent is not a competing answer — filling it in is the normal case and
    // must not be dressed up as a conflict needing a decision.
    expect(kinds([
      m({ id: 'a', mail: 'x@kkumail.com', name: 'ก', nick: 'เอ' }),
      m({ id: 'b', mail: 'x@kkumail.com', name: 'ก' }),
    ])).not.toContain('drift');
  });

  it('catches a differing photo between one person\'s rows', () => {
    const { issues } = run([
      m({ id: 'a', mail: 'x@kkumail.com', name: 'ก', photo: 'https://lh3/d/AAA=w1200' }),
      m({ id: 'b', mail: 'x@kkumail.com', name: 'ก', photo: 'https://lh3/d/BBB=w1200' }),
    ]);
    expect(issues.filter((i) => i.kind === 'drift' && i.field === 'photo_url')).toHaveLength(1);
  });

  it('a person with one row can never drift', () => {
    expect(kinds([m({ id: 'a', mail: 'x@kkumail.com', name: 'ก', nick: 'เอ' })])).toEqual([]);
  });

  it('two different รหัสนักศึกษา on one person is its own finding', () => {
    const rows = [
      m({ id: 'a', mail: 'x@kkumail.com', name: 'ก', sid: '111-1' }),
      m({ id: 'b', mail: 'x@kkumail.com', name: 'ก', sid: '222-2' }),
    ];
    const is = run(rows).issues.find((i) => i.kind === 'sid_drift');
    expect(is.values.sort()).toEqual(['111-1', '222-2']);
  });
});

describe('findIssues — rows with no key', () => {
  it('flags a row with neither email nor รหัสนักศึกษา', () => {
    const is = run([m({ id: 'a', name: 'ปังหวาน ผลพิรุฬห์' })]).issues;
    expect(is).toHaveLength(1);
    expect(is[0].kind).toBe('no_key');
    expect(is[0].suggestions).toEqual([]);
  });

  it('offers a same-name keyed person as a SUGGESTION, without merging', () => {
    const rows = [
      m({ id: 'a', name: 'ปวีณ์ธิดา สัชญูกร' }),                                  // keyless
      m({ id: 'b', name: 'ปวีณ์ธิดา สัชญูกร', mail: 'pav@kkumail.com', sid: '9-9' }),
    ];
    const { people, issues } = run(rows);
    expect(people).toHaveLength(2);                       // still NOT merged
    const nk = issues.find((i) => i.kind === 'no_key');
    expect(nk.suggestions).toHaveLength(1);
    expect(nk.suggestions[0].email).toBe('pav@kkumail.com');
    expect(nk.suggestions[0].sid).toBe('9-9');
  });

  it('does not suggest another keyless row (there is nothing to copy)', () => {
    const nk = run([
      m({ id: 'a', name: 'ก' }),
      m({ id: 'b', name: 'ก' }),
    ]).issues.filter((i) => i.kind === 'no_key');
    expect(nk).toHaveLength(2);
    expect(nk.every((i) => i.suggestions.length === 0)).toBe(true);
  });
});

describe('findIssues — clean data', () => {
  it('reports nothing when every row is keyed and consistent', () => {
    expect(run([
      m({ id: 'a', name: 'ก', mail: 'a@kkumail.com', sid: '1-1', nick: 'เอ' }),
      m({ id: 'b', name: 'ก', mail: 'a@kkumail.com', sid: '1-1', nick: 'เอ' }),
      m({ id: 'c', name: 'ข', mail: 'b@kkumail.com', sid: '2-2' }),
    ]).issues).toEqual([]);
  });

  it('handles an empty roster', () => {
    expect(run([])).toEqual({ people: [], issues: [] });
  });
});

// ── markup ─────────────────────────────────────────────────────────────────
//
// No DOM in this test environment, but issueCard is a pure string function, so
// the two things that actually break silently CAN be checked: a button whose
// data-attribute no handler reads (a dead control), and an unescaped field.

import { readFileSync } from 'node:fs';
import { issueCard } from './health.js';

const card = (rows, kind) => {
  const is = run(rows).issues.find((i) => i.kind === kind);
  expect(is, `no ${kind} finding produced`).toBeTruthy();
  return issueCard(is);
};

const FIXTURES = {
  invalid_email: [m({ id: 'a', name: 'ก', mail: '-', sid: '1-1' })],
  drift: [
    m({ id: 'a', name: 'ก', mail: 'x@kkumail.com', nick: 'เอ' }),
    m({ id: 'b', name: 'ก', mail: 'x@kkumail.com', nick: 'บี' }),
  ],
  sid_drift: [
    m({ id: 'a', name: 'ก', mail: 'x@kkumail.com', sid: '1-1' }),
    m({ id: 'b', name: 'ก', mail: 'x@kkumail.com', sid: '2-2' }),
  ],
  sid_clash: [
    m({ id: 'a', name: 'ก', mail: 'x@kkumail.com', sid: '1-1' }),
    m({ id: 'b', name: 'ข', mail: 'y@kkumail.com', sid: '1-1' }),
  ],
  no_key: [
    m({ id: 'a', name: 'ก' }),
    m({ id: 'b', name: 'ก', mail: 'x@kkumail.com', sid: '1-1' }),
  ],
};

describe('issueCard markup', () => {
  it.each(Object.keys(FIXTURES))('renders a card for %s', (kind) => {
    expect(card(FIXTURES[kind], kind)).toContain('team-health-item');
  });

  // The bug this repo keeps hitting: an attribute-driven control whose value the
  // JS never handles. Here it fails CLOSED (a dead button), which is quiet.
  it('emits no action attribute the click handler does not read', () => {
    const src = readFileSync(new URL('./health.js', import.meta.url), 'utf8');
    const handled = new Set(
      // `t.dataset.hpick`, `t.dataset.hsavemail`, …
      [...src.matchAll(/t\.dataset\.(h[a-z]+) !== undefined/g)].map((x) => x[1]),
    );
    expect(handled.size).toBeGreaterThan(3);
    const camel = (s) => s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    for (const kind of Object.keys(FIXTURES)) {
      const html = card(FIXTURES[kind], kind);
      // Attributes on a <button> are actions; the ones on <input> are just
      // value carriers the handler reads by selector, so only buttons count.
      for (const btn of html.match(/<button[^>]*>/g) || []) {
        const acts = [...btn.matchAll(/data-(h[a-z-]+)=/g)].map((x) => camel(x[1]));
        // every button must carry at least one attribute the handler branches on
        const hit = acts.filter((a) => handled.has(a));
        expect(hit.length, `${kind}: button with no handled action — ${btn}`).toBeGreaterThan(0);
      }
    }
  });

  it('escapes user text — a roster row is not trusted markup', () => {
    const evil = '<img src=x onerror=alert(1)>';
    const html = issueCard(run([
      m({ id: 'a', name: evil, mail: '-', sid: '1-1' }),
    ]).issues.find((i) => i.kind === 'invalid_email'));
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img');
  });
});

// ── CSS coverage ───────────────────────────────────────────────────────────
//
// The exact failure reported on 2026-08-01: `.team-photo-field/-preview/
// -controls/-empty` shipped in tab-team.html with no rule anywhere, so the
// portrait rendered at natural size and burst out of the modal. A class with
// zero rules is invisible in review and looks like a broken value.

describe('every class these modules use has a CSS rule', () => {
  const css = ['team.css', 'image-crop.css', 'base.css']
    .map((f) => readFileSync(new URL(`../../css/${f}`, import.meta.url), 'utf8'))
    .join('\n');

  // The lookbehind skips CSS custom properties — `--imgcrop-ratio` is a
  // variable set from JS, not a class, and has no `.imgcrop-ratio` rule.
  it.each([
    ['team/health.js', '../team/health.js', /(?<!-)\b(?:team-health-[a-z-]+|team-mode-badge)/g],
    ['image-crop.js', '../image-crop.js', /(?<!-)\bimgcrop-[a-z-]+/g],
  ])('%s', (_label, rel, re) => {
    const src = readFileSync(new URL(rel, import.meta.url), 'utf8');
    const used = new Set(src.match(re) || []);
    expect(used.size).toBeGreaterThan(3);
    const missing = [...used].filter((c) => !css.includes(`.${c}`));
    expect(missing, `classes with no CSS rule: ${missing.join(', ')}`).toEqual([]);
  });
});

// The reported bug in its original form: the classes were in the HTML PARTIAL,
// not in JS. `.team-photo-field/-preview/-controls/-empty` had no rule anywhere,
// so the portrait rendered at its natural size and burst out of the modal.
describe('tab-team.html has a CSS rule for every team-* class it uses', () => {
  it('no unstyled class in the partial', () => {
    const html = readFileSync(new URL('../../html/tab-team.html', import.meta.url), 'utf8');
    const css = ['team.css', 'image-crop.css', 'base.css', 'forms.css', 'modals.css', 'cards.css']
      .map((f) => readFileSync(new URL(`../../css/${f}`, import.meta.url), 'utf8'))
      .join('\n');
    const used = new Set(
      [...html.matchAll(/class="([^"]+)"/g)]
        .flatMap((mm) => mm[1].split(/\s+/))
        .filter((c) => c.startsWith('team-')),
    );
    // Deliberate exceptions: layout containers that JS only toggles `d-none` on.
    // They carry no styling BY DESIGN, and listing them here is what makes the
    // rest of the assertion mean something — a new class that just forgot its
    // stylesheet now fails instead of hiding in a growing allow-list.
    const HOOKS_ONLY = new Set(['team-terms-pane', 'team-health-pane']);
    expect(used.size).toBeGreaterThan(10);
    const missing = [...used].filter((c) => !HOOKS_ONLY.has(c) && !css.includes(`.${c}`));
    expect(missing, `no CSS rule for: ${missing.join(', ')}`).toEqual([]);
  });
});

// ── who, not just how many ──────────────────────────────────────────────────
//
// The mode-button badge says HOW MANY need ตรวจสอบ; issuesByMember says WHO, so
// จัดการทีม can flag the actual rows. Every finding shape has to contribute, and
// they carry member ids three different ways.
import { issuesByMember } from './health.js';

const flags = (rows) => issuesByMember(rows, () => 'ฝ่ายทดสอบ');

describe('issuesByMember', () => {
  it('picks up a single-row finding (memberId)', () => {
    const { map, total } = flags([m({ id: 'a', name: 'ก', mail: '-', sid: '1-1' })]);
    expect(total).toBe(1);
    expect([...map.get('a')]).toEqual(['อีเมลไม่ถูกต้อง']);
  });

  it('flags EVERY placement of a person who drifts, not just one', () => {
    const { map } = flags([
      m({ id: 'a', name: 'ก', mail: 'x@kkumail.com', nick: 'เอ' }),
      m({ id: 'b', name: 'ก', mail: 'x@kkumail.com', nick: 'บี' }),
    ]);
    expect(map.has('a')).toBe(true);
    expect(map.has('b')).toBe(true);
  });

  it('flags BOTH people in a รหัสนักศึกษา clash (nested people[].memberIds)', () => {
    const { map } = flags([
      m({ id: 'a', name: 'จิรายุทธ', mail: 'jirayut.y@kkumail.com', sid: '673070332-6' }),
      m({ id: 'b', name: 'โรจนศักดิ์', mail: 'rodjanasak.b@kkumail.com', sid: '673070332-6' }),
    ]);
    expect([...map.get('a')]).toContain('รหัสนักศึกษาซ้ำกับคนอื่น');
    expect([...map.get('b')]).toContain('รหัสนักศึกษาซ้ำกับคนอื่น');
  });

  it('collects several reasons onto one row without duplicating them', () => {
    const { map } = flags([
      m({ id: 'a', name: 'ก', mail: 'x@kkumail.com', sid: '1-1', nick: 'เอ' }),
      m({ id: 'b', name: 'ก', mail: 'x@kkumail.com', sid: '2-2', nick: 'บี' }),
    ]);
    const reasons = [...map.get('a')];
    expect(reasons).toContain('ข้อมูลไม่ตรงกันระหว่างตำแหน่ง');
    expect(reasons).toContain('รหัสนักศึกษาไม่ตรงกัน');
    expect(new Set(reasons).size).toBe(reasons.length);
  });

  it('flags nobody when the roster is clean', () => {
    const { map, total } = flags([
      m({ id: 'a', name: 'ก', mail: 'a@kkumail.com', sid: '1-1' }),
      m({ id: 'b', name: 'ข', mail: 'b@kkumail.com', sid: '2-2' }),
    ]);
    expect(total).toBe(0);
    expect(map.size).toBe(0);
  });

  it('flag count and badge count agree with findIssues', () => {
    const rows = Object.values(FIXTURES).flat();
    expect(flags(rows).total).toBe(run(rows).issues.length);
  });
});

// ── the flag must lead somewhere ────────────────────────────────────────────
//
// Clicking a ต้องตรวจสอบ flag filters the pane to that person. If idsOf missed a
// finding shape the pane would open and say the person is fine — the worst
// possible answer, because it looks like a resolved problem rather than a bug.
import { idsOf } from './health.js';

describe('idsOf — the focus filter agrees with the flag', () => {
  it('every flagged member is reachable from at least one finding', () => {
    const rows = Object.values(FIXTURES).flat();
    const { map } = flags(rows);
    const reachable = new Set(run(rows).issues.flatMap(idsOf));
    for (const id of map.keys()) {
      expect(reachable.has(id), `member ${id} is flagged but no finding names it`).toBe(true);
    }
    expect(map.size).toBeGreaterThan(0);
  });

  it('filtering to one member keeps only findings that concern them', () => {
    const rows = [
      m({ id: 'a', name: 'ก', mail: 'x@kkumail.com', nick: 'เอ' }),
      m({ id: 'b', name: 'ก', mail: 'x@kkumail.com', nick: 'บี' }),
      m({ id: 'c', name: 'ข', mail: '-', sid: '9-9' }),
    ];
    const mine = run(rows).issues.filter((i) => idsOf(i).includes('a'));
    expect(mine).toHaveLength(1);
    expect(mine[0].kind).toBe('drift');
    // …and the unrelated row's finding is excluded.
    expect(run(rows).issues.filter((i) => idsOf(i).includes('c'))
      .every((i) => i.kind === 'invalid_email')).toBe(true);
  });

  it('focusing one side of a รหัส clash still shows the clash (it spans two people)', () => {
    const rows = [
      m({ id: 'a', name: 'จิรายุทธ', mail: 'j@kkumail.com', sid: '673070332-6' }),
      m({ id: 'b', name: 'โรจนศักดิ์', mail: 'r@kkumail.com', sid: '673070332-6' }),
    ];
    expect(run(rows).issues.filter((i) => idsOf(i).includes('a')).map((i) => i.kind))
      .toEqual(['sid_clash']);
  });
});
