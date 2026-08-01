// ==============================================
// TEAM HEALTH — the ตรวจสอบข้อมูล pane (mode 'health').
//
// WHY THIS EXISTS AS A SCREEN AND NOT A SCRIPT: a person is currently stored
// once per ตำแหน่ง, so 403 rows describe ~285 humans, and each copy carries its
// own ชื่อเล่น / ชั้นปี / รูป / kkumail with nothing keeping them in step. They
// have already drifted for 9 people. A one-off cleanup would fix today and be
// wrong again after the next CSV import — so the ambiguity is surfaced
// continuously, computed live from the data that is already in memory.
//
// THE RESOLUTION RULE. This is implemented TWICE — here in JS and in SQL in
// tools/team-identity-dryrun.mjs — which this repo has been bitten by before
// ("two implementations of one rule drift silently"). Both key on the same
// email-first `person_key`, and as of 2026-08-01 they agree on the live data:
// 1 invalid_email · 2 sid_clash · 0 sid_drift · 11 drift (across 9 people) ·
// 10 no_key = 24. Re-run the tool after changing either; if they disagree, the
// tool is the reference because it sees every row without a client in between.
//   1. rows sharing a valid kkumail        → one person
//   2. rows with NO kkumail sharing a รหัส → one person
//   3. anything else                        → its own person
// NEVER on name. `673070332-6` in the live data is one mistyped รหัสนักศึกษา
// shared by two humans whose emails are correct and distinct — merging on รหัส
// would fuse two people irreversibly once สิทธิ์ flowed through the joined row.
// Name matches are offered as a SUGGESTION the admin clicks, never applied.
//
// WHO IS MEANT TO FIX THESE: mostly not the admin. An admin cannot know whether
// วรวลัญช์'s ชื่อเล่น is ปรายฟ้า or ปลายฟ้า. The durable answer is the person's
// own profile page, where they pick in one click. This pane is the half that
// works today, and the half that will always be needed for rows belonging to
// people who never sign in.
// ==============================================

import { escHtml } from '../utils.js';
import { updateMember } from './api.js';

const $ = (id) => document.getElementById(id);

// ── pure: find everything worth a human's attention ─────────────────────────

const clean = (v) => {
  const s = String(v ?? '').trim();
  return s === '' ? null : s;
};
/** An address with no `@` is not an address. One live row literally holds `-`,
 *  which is what split ชญาภา into two people. */
const email = (v) => {
  const s = clean(v);
  return s && s.includes('@') ? s.toLowerCase() : null;
};

/** Fields a person can only have one of. `photo_url` is included: two rows for
 *  one human showing different portraits is the same bug, just more visible. */
export const IDENTITY_FIELDS = [
  { key: 'full_name', label: 'ชื่อ-สกุล' },
  { key: 'prefix', label: 'คำนำหน้า' },
  { key: 'nickname', label: 'ชื่อเล่น' },
  { key: 'year', label: 'ชั้นปี' },
  { key: 'major', label: 'สาขา' },
  { key: 'photo_url', label: 'รูป' },
];

/**
 * Group rows into people and list every unresolved ambiguity.
 *
 * Pure — takes plain arrays, returns plain data, touches no DOM and no network,
 * so the rule above is unit-testable rather than eyeballed against production.
 */
export function findIssues(members, nodeName = () => '') {
  const rows = members.map((m) => ({
    id: m.id,
    node_id: m.node_id,
    node: nodeName(m.node_id),
    full_name: clean(m.full_name),
    prefix: clean(m.prefix),
    nickname: clean(m.nickname),
    year: clean(m.year),
    major: clean(m.major),
    photo_url: clean(m.photo_url),
    sid: clean(m.student_id),
    em: email(m.kkumail),
    rawMail: clean(m.kkumail),
  }));

  // Rule 1 → 2 → 3. The prefixes keep the key spaces disjoint so a
  // รหัสนักศึกษา can never collide with an email.
  const keyOf = (r) => (r.em ? `e:${r.em}` : r.sid ? `s:${r.sid}` : `r:${r.id}`);
  const people = new Map();
  for (const r of rows) {
    const k = keyOf(r);
    if (!people.has(k)) people.set(k, { key: k, rows: [], email: r.em, sids: new Set() });
    const p = people.get(k);
    p.rows.push(r);
    if (r.sid) p.sids.add(r.sid);
    if (!p.email && r.em) p.email = r.em;
  }
  for (const p of people.values()) {
    p.name = p.rows.find((r) => r.full_name)?.full_name || '(ไม่มีชื่อ)';
    p.sids = [...p.sids];
  }

  const issues = [];

  // 1. A kkumail that is not an address. Mechanical — no knowledge needed.
  for (const r of rows) {
    if (r.rawMail && !r.em) {
      issues.push({
        kind: 'invalid_email', id: `mail:${r.id}`, memberId: r.id,
        name: r.full_name, node: r.node, value: r.rawMail,
      });
    }
  }

  // 2. One person, two answers. The admin usually cannot know which is right —
  // so both are offered and neither is preselected.
  for (const p of people.values()) {
    if (p.rows.length < 2) continue;
    for (const f of IDENTITY_FIELDS) {
      const seen = new Map();
      for (const r of p.rows) {
        if (r[f.key] == null) continue;
        if (!seen.has(r[f.key])) seen.set(r[f.key], []);
        seen.get(r[f.key]).push(r.id);
      }
      if (seen.size > 1) {
        issues.push({
          kind: 'drift', id: `drift:${p.key}:${f.key}`, personKey: p.key,
          name: p.name, field: f.key, fieldLabel: f.label,
          memberIds: p.rows.map((r) => r.id),
          values: [...seen].map(([value, ids]) => ({ value, ids })),
        });
      }
    }
  }

  // 3. Rows with no key at all. These people can never be matched to a login,
  // so they are invisible to every self-service flow until one is filled in.
  // A same-name person WITH a key is offered as a suggestion — clicked, never
  // applied, because a name is not evidence.
  const byName = new Map();
  for (const p of people.values()) {
    if (!p.email && !p.sids.length) continue;
    for (const r of p.rows) {
      if (!r.full_name) continue;
      if (!byName.has(r.full_name)) byName.set(r.full_name, new Set());
      byName.get(r.full_name).add(p.key);
    }
  }
  for (const p of people.values()) {
    if (p.email || p.sids.length) continue;
    for (const r of p.rows) {
      const matches = [...(byName.get(r.full_name) || [])]
        .map((k) => people.get(k))
        .filter(Boolean);
      issues.push({
        kind: 'no_key', id: `nokey:${r.id}`, memberId: r.id,
        name: r.full_name, node: r.node,
        suggestions: matches.map((m) => ({
          key: m.key, name: m.name, email: m.email, sid: m.sids[0] || null,
          nodes: m.rows.map((x) => x.node).filter(Boolean),
        })),
      });
    }
  }

  // 4. One รหัสนักศึกษา under two people. NOT a merge candidate — it is a typo
  // on one of them, and the two are correctly separate.
  const sidOwners = new Map();
  for (const p of people.values()) {
    for (const s of p.sids) {
      if (!sidOwners.has(s)) sidOwners.set(s, []);
      sidOwners.get(s).push(p);
    }
  }
  for (const [sid, owners] of sidOwners) {
    if (owners.length < 2) continue;
    issues.push({
      kind: 'sid_clash', id: `sid:${sid}`, sid,
      people: owners.map((p) => ({
        key: p.key, name: p.name, email: p.email,
        memberIds: p.rows.map((r) => r.id),
        nodes: p.rows.map((r) => r.node).filter(Boolean),
      })),
    });
  }

  // 5. One person carrying two different รหัสนักศึกษา (same email, so the same
  // human — one of the two was mistyped).
  for (const p of people.values()) {
    if (p.sids.length > 1) {
      issues.push({
        kind: 'sid_drift', id: `siddrift:${p.key}`, personKey: p.key,
        name: p.name, values: p.sids,
        memberIds: p.rows.map((r) => r.id),
      });
    }
  }

  return { people: [...people.values()], issues };
}

/** Order the pane renders in: cheapest and most certain first, so the admin
 *  clears the mechanical ones before reaching the judgement calls. */
const GROUPS = [
  {
    kind: 'invalid_email',
    title: 'อีเมลไม่ถูกต้อง',
    blurb: 'ค่านี้ไม่ใช่อีเมล จึงใช้จับคู่ตอนเข้าสู่ระบบไม่ได้ — และทำให้คนคนเดียวถูกนับเป็นสองคน',
  },
  {
    kind: 'sid_clash',
    title: 'รหัสนักศึกษาซ้ำกันระหว่างคนละคน',
    blurb: 'สองคนนี้ถือรหัสนักศึกษาเดียวกัน แปลว่ามีคนหนึ่งถูกกรอกผิด — ระบบไม่รวมทั้งสองเข้าด้วยกัน เพราะอีเมลต่างกัน',
  },
  {
    kind: 'sid_drift',
    title: 'คนเดียวกันแต่รหัสนักศึกษาไม่ตรงกัน',
    blurb: 'อีเมลเดียวกันจึงเป็นคนเดียวกัน แต่รหัสในแต่ละแถวไม่ตรงกัน',
  },
  {
    kind: 'drift',
    title: 'ข้อมูลของคนเดียวกันไม่ตรงกัน',
    blurb: 'คนคนนี้อยู่หลายตำแหน่ง และแต่ละแถวเก็บข้อมูลคนละค่า เลือกค่าที่ถูกต้อง แล้วระบบจะเขียนให้ทุกแถว',
  },
  {
    kind: 'no_key',
    title: 'ไม่มีอีเมลและรหัสนักศึกษา',
    blurb: 'แถวนี้ไม่มีอะไรให้จับคู่กับบัญชีผู้ใช้ เจ้าตัวจึงยืนยันตัวตนเองไม่ได้',
  },
];

// ── pane ────────────────────────────────────────────────────────────────────

let host = null;
let getData = null;
let onChanged = null;
let chain = Promise.resolve();

function status(msg, kind = '') {
  const el = $('teamHealthStatus');
  if (el) {
    el.textContent = msg || '';
    el.className = `team-health-status${kind ? ` is-${kind}` : ''}`;
  }
}

/**
 * Serialise writes instead of dropping them. An `if (busy) return` would
 * silently discard the second of two quick clicks — and each click here carries
 * a different decision, so dropping one is data loss that reports success.
 */
function run(fn, okMsg) {
  chain = chain.then(async () => {
    try {
      await fn();
      await onChanged?.();
      // AFTER the repaint, not before: renderHealth() replaces host.innerHTML,
      // which recreates #teamHealthStatus empty. Setting it first meant every
      // SUCCESS was silently wiped while every FAILURE showed — the exact
      // inverse of what the user needs.
      renderHealth();
      if (okMsg) status(okMsg, 'ok');
    } catch (e) {
      status(e?.message || 'บันทึกไม่สำเร็จ', 'error');
    }
  });
  return chain;
}

const chip = (text, cls = '') =>
  `<span class="team-health-chip${cls ? ` ${cls}` : ''}">${escHtml(text)}</span>`;

function valueLabel(field, value) {
  if (field !== 'photo_url') return value;
  return 'รูปที่ ' + String(value).slice(-6);
}

/** Exported for tests: the markup is a pure function of the finding, so the
 *  action attributes it emits can be checked against the click handler without
 *  a DOM. An attribute with no matching branch is a dead button. */
export function issueCard(is) {
  if (is.kind === 'invalid_email') {
    return `
      <li class="team-health-item" data-hi="${escHtml(is.id)}">
        <div class="team-health-who">
          <strong>${escHtml(is.name || '(ไม่มีชื่อ)')}</strong>
          ${is.node ? chip(is.node) : ''}
        </div>
        <div class="team-health-detail">ค่าปัจจุบัน: <code>${escHtml(is.value)}</code></div>
        <div class="team-health-acts">
          <input type="email" class="form-control form-control-sm" data-hmail="${escHtml(is.memberId)}"
            placeholder="name@kkumail.com" aria-label="อีเมลที่ถูกต้อง" />
          <button type="button" class="btn btn-sm btn-primary" data-hsavemail="${escHtml(is.memberId)}">บันทึกอีเมล</button>
          <button type="button" class="btn btn-sm btn-outline-secondary" data-hclearmail="${escHtml(is.memberId)}">ล้างค่าทิ้ง</button>
        </div>
      </li>`;
  }

  if (is.kind === 'drift') {
    return `
      <li class="team-health-item" data-hi="${escHtml(is.id)}">
        <div class="team-health-who">
          <strong>${escHtml(is.name)}</strong>
          ${chip(is.fieldLabel, 'is-field')}
        </div>
        <div class="team-health-detail">เลือกค่าที่ถูกต้อง — จะเขียนทับให้ทุกตำแหน่งของคนนี้</div>
        <div class="team-health-acts">
          ${is.values.map((v) => `
            <button type="button" class="btn btn-sm btn-outline-primary"
              data-hpick="${escHtml(is.id)}" data-hfield="${escHtml(is.field)}"
              data-hvalue="${escHtml(v.value)}"
              data-hids="${escHtml(is.memberIds.join(','))}">
              ${escHtml(valueLabel(is.field, v.value))}
            </button>`).join('')}
        </div>
      </li>`;
  }

  if (is.kind === 'sid_drift') {
    return `
      <li class="team-health-item" data-hi="${escHtml(is.id)}">
        <div class="team-health-who"><strong>${escHtml(is.name)}</strong></div>
        <div class="team-health-detail">เลือกรหัสที่ถูกต้อง — จะเขียนให้ทุกตำแหน่งของคนนี้</div>
        <div class="team-health-acts">
          ${is.values.map((v) => `
            <button type="button" class="btn btn-sm btn-outline-primary"
              data-hpick="${escHtml(is.id)}" data-hfield="student_id"
              data-hvalue="${escHtml(v)}" data-hids="${escHtml(is.memberIds.join(','))}">
              ${escHtml(v)}
            </button>`).join('')}
        </div>
      </li>`;
  }

  if (is.kind === 'sid_clash') {
    return `
      <li class="team-health-item" data-hi="${escHtml(is.id)}">
        <div class="team-health-who">
          <strong>รหัส ${escHtml(is.sid)}</strong>
          ${chip(`${is.people.length} คน`, 'is-warn')}
        </div>
        <div class="team-health-detail">แก้รหัสของคนที่กรอกผิด — ปล่อยอีกคนไว้ตามเดิม</div>
        ${is.people.map((p) => `
          <div class="team-health-sub">
            <div class="team-health-who">
              <span>${escHtml(p.name)}</span>
              ${p.email ? chip(p.email) : chip('ไม่มีอีเมล', 'is-warn')}
              ${p.nodes.slice(0, 2).map((x) => chip(x)).join('')}
            </div>
            <div class="team-health-acts">
              <input type="text" class="form-control form-control-sm" data-hsid="${escHtml(p.key)}"
                placeholder="รหัสนักศึกษาที่ถูกต้อง" aria-label="รหัสนักศึกษาของ ${escHtml(p.name)}" />
              <button type="button" class="btn btn-sm btn-primary"
                data-hsavesid="${escHtml(p.key)}" data-hids="${escHtml(p.memberIds.join(','))}">บันทึก</button>
            </div>
          </div>`).join('')}
      </li>`;
  }

  // no_key
  return `
    <li class="team-health-item" data-hi="${escHtml(is.id)}">
      <div class="team-health-who">
        <strong>${escHtml(is.name || '(ไม่มีชื่อ)')}</strong>
        ${is.node ? chip(is.node) : ''}
      </div>
      ${is.suggestions.length ? `
        <div class="team-health-detail">
          มีคนชื่อเดียวกันที่มีอีเมลอยู่แล้ว — ถ้าเป็นคนเดียวกัน กดเพื่อใช้ข้อมูลเดียวกัน
          <span class="team-health-warn">ชื่อไม่ใช่หลักฐาน ระบบจะไม่รวมให้เอง</span>
        </div>
        <div class="team-health-acts">
          ${is.suggestions.map((s) => `
            <button type="button" class="btn btn-sm btn-outline-primary"
              data-hlink="${escHtml(is.memberId)}"
              data-hlinkmail="${escHtml(s.email || '')}"
              data-hlinksid="${escHtml(s.sid || '')}"
              data-hlinkname="${escHtml(s.name)}">
              เป็นคนเดียวกับ ${escHtml(s.name)}${s.nodes[0] ? ` (${escHtml(s.nodes[0])})` : ''}
            </button>`).join('')}
        </div>` : ''}
      <div class="team-health-acts">
        <input type="email" class="form-control form-control-sm" data-hnkmail="${escHtml(is.memberId)}"
          placeholder="kkumail" aria-label="อีเมล" />
        <input type="text" class="form-control form-control-sm" data-hnksid="${escHtml(is.memberId)}"
          placeholder="รหัสนักศึกษา" aria-label="รหัสนักศึกษา" />
        <button type="button" class="btn btn-sm btn-primary" data-hsavenk="${escHtml(is.memberId)}">บันทึก</button>
      </div>
    </li>`;
}

export function renderHealth() {
  if (!host) return;
  const { members, nodeName, loaded } = getData?.() || { members: [], nodeName: () => '' };
  // "ข้อมูลครบถ้วน" over an empty array is a LIE, not an empty state: before the
  // tree has loaded there are zero members and therefore zero findings. Say so.
  if (!loaded) {
    host.innerHTML = '<div class="team-health"><div class="team-health-clear">'
      + '<p>กำลังโหลดข้อมูล…</p></div></div>';
    return;
  }
  const { people, issues } = findIssues(members, nodeName);

  const groups = GROUPS
    .map((g) => ({ ...g, items: issues.filter((i) => i.kind === g.kind) }))
    .filter((g) => g.items.length);

  host.innerHTML = `
    <div class="team-health">
      <div class="team-health-head">
        <div>
          <h6 class="team-health-title">ตรวจสอบข้อมูล</h6>
          <p class="team-health-sum">
            ${members.length} แถว · ${people.length} คน ·
            ${issues.length ? `<strong>${issues.length} รายการที่ควรตรวจสอบ</strong>` : 'ไม่พบปัญหา'}
          </p>
        </div>
      </div>
      <div class="team-health-status" id="teamHealthStatus"></div>
      ${groups.length ? groups.map((g) => `
        <section class="team-health-group">
          <header>
            <h6>${escHtml(g.title)} <span class="team-health-count">${g.items.length}</span></h6>
            <p>${escHtml(g.blurb)}</p>
          </header>
          <ul class="team-health-list">${g.items.map(issueCard).join('')}</ul>
        </section>`).join('') : `
        <div class="team-health-clear">
          <i class="bi bi-check2-circle"></i>
          <p>ข้อมูลครบถ้วน ไม่มีรายการที่ต้องตรวจสอบ</p>
        </div>`}
      <p class="team-health-foot">
        รายการนี้คำนวณสดจากข้อมูลจริงทุกครั้งที่เปิด — การนำเข้าครั้งต่อไปที่ทำให้ข้อมูลไม่ตรงกัน จะขึ้นที่นี่เอง
      </p>
    </div>`;
}

/** Write one field to EVERY row of a person, which is the whole point: the
 *  drift exists because the rows are separate copies. */
function setOnAll(ids, field, value) {
  return Promise.all(ids.map((id) => updateMember(id, { [field]: value })));
}

export function initHealth(hostEl, opts = {}) {
  host = hostEl;
  getData = opts.getData;
  onChanged = opts.onChanged;
  if (!host) return;

  host.addEventListener('click', (e) => {
    const t = e.target.closest?.('button');
    // No `busy` guard. run() already serialises through a promise chain, and
    // every handler below reads its input values SYNCHRONOUSLY here, so a click
    // that lands mid-write carries the right data and simply queues. Dropping it
    // would be the antipattern the run() comment exists to warn against — which
    // an earlier version of this very function committed.
    if (!t) return;

    if (t.dataset.hpick !== undefined) {
      const ids = t.dataset.hids.split(',').filter(Boolean);
      const field = t.dataset.hfield;
      const value = t.dataset.hvalue;
      return void run(() => setOnAll(ids, field, value), `ตั้งเป็น “${value}” ให้ทุกตำแหน่งแล้ว`);
    }

    if (t.dataset.hclearmail !== undefined) {
      const id = t.dataset.hclearmail;
      return void run(() => updateMember(id, { kkumail: null }), 'ล้างค่าแล้ว');
    }

    if (t.dataset.hsavemail !== undefined) {
      const id = t.dataset.hsavemail;
      const v = host.querySelector(`[data-hmail="${CSS.escape(id)}"]`)?.value.trim();
      if (!v || !v.includes('@')) return void status('กรอกอีเมลให้ถูกต้องก่อน', 'error');
      return void run(() => updateMember(id, { kkumail: v }), 'บันทึกอีเมลแล้ว');
    }

    if (t.dataset.hsavesid !== undefined) {
      const key = t.dataset.hsavesid;
      const ids = t.dataset.hids.split(',').filter(Boolean);
      const v = host.querySelector(`[data-hsid="${CSS.escape(key)}"]`)?.value.trim();
      if (!v) return void status('กรอกรหัสนักศึกษาก่อน', 'error');
      return void run(() => setOnAll(ids, 'student_id', v), 'บันทึกรหัสแล้ว');
    }

    if (t.dataset.hsavenk !== undefined) {
      const id = t.dataset.hsavenk;
      const mail = host.querySelector(`[data-hnkmail="${CSS.escape(id)}"]`)?.value.trim();
      const sid = host.querySelector(`[data-hnksid="${CSS.escape(id)}"]`)?.value.trim();
      if (!mail && !sid) return void status('กรอกอีเมลหรือรหัสนักศึกษาอย่างน้อยหนึ่งอย่าง', 'error');
      if (mail && !mail.includes('@')) return void status('อีเมลไม่ถูกต้อง', 'error');
      const patch = {};
      if (mail) patch.kkumail = mail;
      if (sid) patch.student_id = sid;
      return void run(() => updateMember(id, patch), 'บันทึกแล้ว');
    }

    if (t.dataset.hlink !== undefined) {
      const id = t.dataset.hlink;
      const mail = t.dataset.hlinkmail || '';
      const sid = t.dataset.hlinksid || '';
      const who = t.dataset.hlinkname;
      // The one action here that can be WRONG in a way the data cannot catch —
      // it is driven by a name match. Say what it does before doing it. Linking
      // an email also hands over whatever สิทธิ์ that person's ตำแหน่ง carry,
      // which is why this is never automatic.
      if (!confirm(`ยืนยันว่าแถวนี้คือ “${who}” คนเดียวกัน?\n\n`
        + `จะตั้งอีเมล/รหัสนักศึกษาให้ตรงกัน และแถวนี้จะถูกนับรวมเป็นคนเดียวกัน\n`
        + `หากเป็นคนละคน ให้กดยกเลิกแล้วกรอกข้อมูลเองด้านล่าง`)) return;
      const patch = {};
      if (mail) patch.kkumail = mail;
      if (sid) patch.student_id = sid;
      if (!Object.keys(patch).length) return void status('คนที่เลือกไม่มีอีเมลหรือรหัสให้ใช้', 'error');
      return void run(() => updateMember(id, patch), `รวมกับ ${who} แล้ว`);
    }
  });
}

/** Cold entry — render immediately from what index.js already has in memory. */
export function enterHealth() {
  status('');
  renderHealth();
}

/** For the badge on the mode button, so an admin sees there is something to do
 *  without having to open the pane and look. */
export function issueCount(members, nodeName) {
  return findIssues(members, nodeName).issues.length;
}
