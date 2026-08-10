// ==============================================
// NOBODY SPLITS A NAME.
//
// This file exists because writing the rule down did not work. `house/io.js`
// has refused a combined "ชื่อ-สกุล" column since the importer was written, and
// its comment says exactly why — and three modules away, `my-seat.js` was doing
//
//     const [first, ...rest] = full_name.trim().split(/\s+/);
//
// on every save, rewriting the ชื่อ / นามสกุล of anyone whose name does not
// have exactly one space in it. Two implementations of one rule drift; here one
// of them was the negation of the other, and it shipped.
//
// So the rule is a test now:
//   1. no module reconstructs a name split from a combined string;
//   2. what the person's card offers to edit is exactly what the SQL guard
//      allows them to write — the two lists live in different languages and in
//      different files, which is how they drift.
// ==============================================
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { DETAIL_FIELDS, displayFields } from './my-seat.js';

const SRC = new URL('.', import.meta.url);

function jsFiles(dir = SRC, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const u = new URL(e.name + (e.isDirectory() ? '/' : ''), dir);
    if (e.isDirectory()) jsFiles(u, out);
    else if (e.name.endsWith('.js') && !e.name.endsWith('.test.js')) out.push(u);
  }
  return out;
}

describe('no module manufactures a name split', () => {
  // The shape to catch is "take a whole name, cut it on whitespace, treat the
  // pieces as ชื่อ and นามสกุล". Splitting for OTHER reasons is everywhere and
  // legitimate — initials for an avatar, a path, a permission list — so this
  // looks for the combination: a split whose result is assigned to, or used to
  // build, one of the two name columns.
  const NAME_KEYS = /(first_name_th|last_name_th)/;

  it('never derives first_name_th / last_name_th from a whitespace split', () => {
    const offenders = [];
    for (const f of jsFiles()) {
      const src = readFileSync(f, 'utf8');
      const lines = src.split('\n');
      lines.forEach((line, i) => {
        if (line.trim().startsWith('//') || line.trim().startsWith('*')) return;
        if (!/\.split\(/.test(line)) return;
        // The split itself, plus the two lines after it — a destructuring
        // `const [first, ...rest] = x.split(...)` puts the assignment on the
        // following line often enough that one line of context is not enough.
        const window = lines.slice(i, i + 3).join('\n');
        if (NAME_KEYS.test(window)) {
          offenders.push(`${f.pathname.split('/src/js/')[1]}:${i + 1}: ${line.trim()}`);
        }
      });
    }
    expect(offenders, 'a name was split on whitespace — see 0135').toEqual([]);
  });

  it('the house importer still REFUSES a combined name column', () => {
    // The other half of the same rule, and the one that has always been right.
    // If this ever softens into "split it for them", the test above is only
    // catching the copies.
    const io = readFileSync(new URL('./house/io.js', SRC), 'utf8');
    expect(io).toContain('_combined_name');
    expect(io).toMatch(/fatal:[\s\S]{0,200}แยกให้ไม่ได้/);
  });
});

describe('what the card edits is what the database allows', () => {
  it('DETAIL_FIELDS editable === team_members_self_update_guard v_allowed', () => {
    // The guard is an allow-LIST that raises P0001 on anything outside it, so a
    // field offered here and absent there is a form whose save always fails —
    // and a field allowed there and absent here is a column nobody can reach.
    // Read from the LATEST migration that defines the guard, because recreating
    // a function from the migration that FIRST defined it is its own entry in
    // docs/mistakes/postgres-schema.md.
    const dir = new URL('../../supabase/migrations/', SRC);
    const defining = readdirSync(dir)
      .filter((n) => n.endsWith('.sql'))
      .filter((n) => readFileSync(new URL(n, dir), 'utf8')
        .includes('create or replace function public.team_members_self_update_guard'))
      .sort();
    expect(defining.length, 'no migration defines the guard').toBeGreaterThan(0);

    const latest = readFileSync(new URL(defining[defining.length - 1], dir), 'utf8');
    const body = latest.slice(latest.lastIndexOf(
      'create or replace function public.team_members_self_update_guard'));
    // Slice from AFTER the opening bracket — `text[]` in the declaration itself
    // contains a `]`, so indexing from the start of the line finds that one and
    // the literal comes back empty.
    const MARK = 'v_allowed text[] := array[';
    const arr = body.slice(body.indexOf(MARK) + MARK.length);
    const literal = arr.slice(0, arr.indexOf(']'));
    const names = literal.match(/'([a-z_]+)'/g);
    expect(names, 'could not read v_allowed out of the migration').toBeTruthy();
    const allowed = new Set(names.map((s) => s.slice(1, -1)));

    // Not in the form and not the person's to set: `updated_at` is a trigger's
    // column, and the photo has its own control rather than a text box.
    for (const k of ['updated_at', 'photo_url', 'photo_focus']) allowed.delete(k);
    // `year` is DEAD (0145). The guard still lists it — the column exists until
    // the bundle that stopped reading it is confirmed served, and 0129 proved
    // what dropping first costs — but the card must NOT offer it. ชั้นปี is
    // computed now, and its chooser writes `year_offset` through
    // update_my_identity, which is a different table and a different guard.
    // When the column is dropped, `year` leaves v_allowed and this line goes
    // with it; until then it is the one asymmetry, and it is asymmetric in the
    // safe direction (the server permits more than the form offers).
    expect(allowed.has('year'), 'the guard still lists the dead `year` column').toBe(true);
    allowed.delete('year');
    // `full_name` is DERIVED from the split (0135). The guard must still permit
    // it — every write of the parts writes it too — but the card must not offer
    // it, or we are back to one box and a guess.
    expect(allowed.has('full_name')).toBe(true);
    allowed.delete('full_name');

    // DERIVED fields are not team_members columns and never appear in the
    // guard. `study_year` is the ชั้นปี chooser: it reads a calculation and
    // writes `year_offset` on the REGISTRY, so the guard has nothing to say
    // about it. Comparing it against v_allowed would be comparing two different
    // tables' rules and calling the difference a bug.
    const editable = DETAIL_FIELDS
      .filter((f) => f.editable && !f.value).map((f) => f.key);
    expect([...allowed].sort()).toEqual([...editable].sort());
    expect(editable).not.toContain('full_name');
    expect(DETAIL_FIELDS.find((f) => f.key === 'study_year').value).toBeTypeOf('function');
  });
});

describe('displayFields — a legacy row is not an incomplete one', () => {
  it('shows the split when the row has one', () => {
    const keys = displayFields({ first_name_th: 'สมชาย', last_name_th: 'ณ อยุธยา', full_name: 'สมชาย ณ อยุธยา' })
      .map((f) => f.key);
    expect(keys).toContain('first_name_th');
    expect(keys).toContain('last_name_th');
    expect(keys).not.toContain('full_name');
  });

  it('shows ONE ชื่อ-สกุล row when only the combined name exists', () => {
    // 399 members acquired their name before the split existed. Reporting
    // "ยังไม่ได้กรอก" for ชื่อ and นามสกุล directly under a header printing
    // their name would make the findings list noise.
    const keys = displayFields({ full_name: 'สมชาย ณ อยุธยา' }).map((f) => f.key);
    expect(keys).toContain('full_name');
    expect(keys).not.toContain('first_name_th');
  });

  it('asks for the split when the row has no name at all', () => {
    // 0126: a row may arrive knowing only an address. That person SHOULD be
    // asked, and asked in the shape the system actually wants.
    const keys = displayFields({}).map((f) => f.key);
    expect(keys).toContain('first_name_th');
    expect(keys).toContain('last_name_th');
  });
});
