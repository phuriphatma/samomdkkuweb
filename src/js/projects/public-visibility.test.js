import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { isShownPublicly } from './inbox.js';

// Migration 0114 put a `is_public` flag on projects + project_documents so
// the sender can pick what the public /projects-view mirror shows. The flag
// is enforced by RLS; isShownPublicly() only decides what the STAFF UI
// labels as hidden. Those are two spellings of one rule, which is the
// failure this repo keeps paying for (mistakes class 6) — so the test binds
// the JS reading of a missing flag to the SQL default that produced it.
const SQL = readFileSync(
  new URL('../../../supabase/migrations/0114_project_public_visibility.sql', import.meta.url),
  'utf8',
);

describe('isShownPublicly', () => {
  it('treats a row with no flag as SHOWN — the pre-0114 behaviour', () => {
    // Every row that existed before the column, and any payload that didn't
    // select it, must keep rendering the way the public site already did.
    expect(isShownPublicly({ id: 'PRJ-1' })).toBe(true);
    expect(isShownPublicly({ id: 'DOC-1', is_public: undefined })).toBe(true);
  });

  it('reads the flag when it is there', () => {
    expect(isShownPublicly({ is_public: true })).toBe(true);
    expect(isShownPublicly({ is_public: false })).toBe(false);
  });

  it('only the literal false hides — never a falsy near-miss', () => {
    // PostgREST sends a real boolean. If it ever sent 'false' or 0 we want
    // the label to stay optimistic rather than silently mark live rows
    // hidden; the DB is the authority for what anon can actually read.
    expect(isShownPublicly({ is_public: 'false' })).toBe(true);
    expect(isShownPublicly({ is_public: 0 })).toBe(true);
    expect(isShownPublicly(null)).toBe(true);
    expect(isShownPublicly(undefined)).toBe(true);
  });
});

describe('0114 migration ↔ UI agreement', () => {
  it('both columns default to true, which is what "no flag = shown" mirrors', () => {
    const decls = SQL.match(/add column if not exists is_public boolean not null default (\w+)/g) || [];
    expect(decls).toHaveLength(2);
    for (const d of decls) expect(d.endsWith('default true')).toBe(true);
  });

  it('the public read policies gate on the flag, and the หนังสือ one cascades', () => {
    expect(SQL).toMatch(/create policy "projects_read_public"[\s\S]*?using \(is_public\)/);
    expect(SQL).toMatch(
      /create policy "project_documents_read_public"[\s\S]*?using \(is_public and public\.project_is_public\(project_id\)\)/,
    );
    expect(SQL).toMatch(
      /create policy "project_files_read_public"[\s\S]*?using \(public\.project_doc_is_public\(document_id\)\)/,
    );
  });

  it('both resolver helpers fail CLOSED on an id that does not resolve', () => {
    // coalesce(..., false) — not true. An unresolvable reference answering
    // "allowed" is mistakes class 2, and it has bitten this schema before.
    const helpers = SQL.match(/create or replace function public\.project_(is_public|doc_is_public)[\s\S]*?\$\$;/g) || [];
    expect(helpers).toHaveLength(2);
    for (const h of helpers) {
      expect(h).toMatch(/coalesce\(/);
      expect(h).toMatch(/,\s*false\)/);
    }
  });

  it('the professor column guard lists is_public among the columns he cannot touch', () => {
    const guard = SQL.match(/function public\.project_documents_prof_guard\(\)[\s\S]*?\$\$;/)?.[0] || '';
    expect(guard).toMatch(/new\.is_public\s+is distinct from old\.is_public/);
  });
});
