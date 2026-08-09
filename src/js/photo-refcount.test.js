// ==============================================
// EVERY TABLE THAT HOLDS A photo_url MUST BE COUNTED BEFORE THE FILE IS DELETED.
//
// THE BUG THIS EXISTS FOR. `deleteTeamPhotoIfUnused` counted `team_members` and
// `team_archive_members`, which was the complete list until migration 0132 gave
// `people` a `photo_url` and its mirror copied the same URL down to
// `students.photo_url`. Nobody updated the count, so:
//
//   delete a ทีม SAMO member whose portrait had mirrored
//     → the count says 0 references
//     → the Drive file is deleted
//     → `people` and `students` still point at it
//     → the person's own card and ระบบบ้าน show a broken image, permanently.
//
// Measured on a rollback transaction before the fix. The failure mode is DATA
// DESTRUCTION performed by a cleanup that believed it was safe, and nothing
// about the code looked wrong — the count was correct for the world it was
// written in.
//
// So the list is a test now: any table that grows a `photo_url` has to appear in
// the refcount, or this fails. A guard test is the only thing that survives
// somebody adding a fifth holder in eighteen months.
// ==============================================
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';

const MIGRATIONS = new URL('../../supabase/migrations/', import.meta.url);
const API = new URL('./team/api.js', import.meta.url);

/**
 * Tables RENAMED since the DDL that created them. The scan reads every
 * migration ever written, so it finds the name a column was born under —
 * `team_people` became `public.people` in 0132 and the row it names is the same
 * row. Without this the test would demand a query against a table that no
 * longer exists.
 */
const RENAMED = { team_people: 'people' };

/** Tables the migration tree gives a `photo_url` column, by reading the DDL. */
function tablesWithPhotoUrl() {
  const found = new Set();
  for (const name of readdirSync(MIGRATIONS).filter((n) => n.endsWith('.sql'))) {
    const sql = readFileSync(new URL(name, MIGRATIONS), 'utf8');

    // `alter table <t> ... add column [if not exists] photo_url`
    for (const m of sql.matchAll(
      /alter\s+table\s+(?:if\s+exists\s+)?(?:public\.)?(\w+)([\s\S]*?);/gi)) {
      if (/add\s+column\s+(?:if\s+not\s+exists\s+)?photo_url/i.test(m[2])) found.add(m[1]);
    }

    // `create table <t> ( ... photo_url ... )`
    for (const m of sql.matchAll(
      /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?(\w+)\s*\(([\s\S]*?)\n\);/gi)) {
      if (/^\s*photo_url\s/im.test(m[2])) found.add(m[1]);
    }
  }
  return new Set([...found].map((t) => RENAMED[t] || t));
}

/** The LIVE body of photo_reference_count — from the latest migration that
 *  defines it, never the one that first did (docs/mistakes/postgres-schema.md). */
function refcountSql() {
  const defining = readdirSync(MIGRATIONS)
    .filter((n) => n.endsWith('.sql'))
    .filter((n) => readFileSync(new URL(n, MIGRATIONS), 'utf8')
      .includes('function public.photo_reference_count'))
    .sort();
  expect(defining.length, 'no migration defines photo_reference_count')
    .toBeGreaterThan(0);
  const sql = readFileSync(new URL(defining[defining.length - 1], MIGRATIONS), 'utf8');
  const from = sql.lastIndexOf('create or replace function public.photo_reference_count');
  return sql.slice(from, sql.indexOf('$$;', from));
}

describe('the portrait refcount knows every table that references a portrait', () => {
  it('counts every table the schema gives a photo_url', () => {
    // The count lives in SQL (0143), not in the client: `students` and
    // `advisors` need `house`, the caller deleting a member holds `team_edit`,
    // and RLS answers that with zero rows rather than an error — so a
    // client-side count reports "unreferenced" for the very caller that
    // triggers the delete.
    const counted = refcountSql();
    const tables = tablesWithPhotoUrl();
    // Sanity FIRST: a sweep that finds nothing would pass this test forever.
    // "Make it find something you know is there" — mistakes class 7.
    expect(tables.size, 'the DDL scan found no photo_url columns at all')
      .toBeGreaterThan(1);
    expect(tables.has('team_members')).toBe(true);

    const missing = [...tables].filter((t) => !counted.includes(`public.${t}`));
    expect(missing,
      `photo_reference_count does not count: ${missing.join(', ')} — `
      + 'a table holding a photo_url that the count does not know about makes '
      + 'the count report 0 for a file that is still in use, and the cleanup '
      + 'then destroys it')
      .toEqual([]);
  });

  it('runs as a DEFINER, or the caller who deletes cannot see what it counts', () => {
    expect(refcountSql()).toMatch(/security\s+definer/i);
  });

  it('answers a blank URL with a reference, never with zero', () => {
    // Nonsense input must not read as "nothing uses this" — the caller's next
    // move on a 0 is an irreversible delete.
    expect(refcountSql()).toMatch(/then\s+1\b/);
  });

  it('the client keeps the file unless the answer is a definite zero', () => {
    // The fail-open direction here destroys somebody's portrait. An error, a
    // null, or a shape change all mean "I could not check".
    const body = readFileSync(API, 'utf8');
    const fn = body.slice(body.indexOf('export async function deleteTeamPhotoIfUnused'));
    const client = fn.slice(0, fn.indexOf('\n}'));
    expect(client).toMatch(/if\s*\(error\)\s*\{[\s\S]*?return false/);
    expect(client).toMatch(/Number\.isFinite/);
    expect(client).toMatch(/refs\s*!==\s*0/);
  });
});
