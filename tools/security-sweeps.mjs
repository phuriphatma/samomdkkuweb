// Standing security sweeps. Run after ANY change to RLS, a policy, or a
// SECURITY DEFINER function. Each one encodes a bug class this repo has
// actually shipped — see .claude/rules/mistakes.md for the post-mortems.
//
//   1. role-only policies      — policies gated on a bare role list, which
//                                ignore the ทีม SAMO grant channel. Expect
//                                exactly 3 deliberate (see STATE.md).
//   2. unknown-category readers — every function resolving is_confidential /
//                                public_eligible must fail CLOSED, because
//                                หมวดหมู่ is deletable and vs_tickets.category
//                                has no FK. Expect 0 open.
//   3. owner-UPDATE column guards — RLS is ROW-level; a per-row owner UPDATE
//                                policy with no BEFORE-UPDATE guard lets the
//                                owner write EVERY column. Expect only the
//                                two knowingly-accepted low-severity rows.
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')]; }));
const REF = env.VITE_SUPABASE_URL.match(/https:\/\/([^.]+)\.supabase\.co/)[1];

const q = async (sql) => {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }) });
  const b = await r.json();
  if (!r.ok) { console.error(b); process.exit(1); }
  return b;
};

// Deliberate exceptions, each justified in STATE.md. Widening any of these
// has a documented consequence — do not "fix" them without reading it.
const ROLE_ONLY_OK = ['users_update_staff', 'notify_log_select_staff',
                      'reserved_staff_usernames_read_staff'];
const NO_GUARD_OK  = ['project_doc_views_update_own', 'project_notifications_update'];

let bad = 0;
const line = (ok, s) => { if (!ok) bad++; console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${s}`); };

console.log('project', REF, '\n');

console.log('1. role-only policies (ignore the grant channel)');
for (const r of await q(`
  select tablename, policyname from pg_policies where schemaname='public'
   and (coalesce(qual,'')||' '||coalesce(with_check,'')) ~ 'current_user_role|current_user_is_staff'
   and (coalesce(qual,'')||' '||coalesce(with_check,'')) !~ 'has_permission|managed_|_scope|_seats|vs_depts|is_vs_handler|has_any_grant|project_seats'
   order by tablename`)) {
  line(ROLE_ONLY_OK.includes(r.policyname), `${r.tablename}.${r.policyname}`);
}

console.log('\n2. unknown-category readers must fail CLOSED');
for (const r of await q(`
  with fns as (select p.oid, p.proname, pg_get_functiondef(p.oid) as def
               from pg_proc p join pg_namespace n on n.oid=p.pronamespace
               where n.nspname='public' and p.prokind='f')
  select proname,
         def ~ 'coalesce\\(\\s*(v_conf|c\\.is_confidential)\\s*,\\s*true\\s*\\)' as ct,
         def ~* 'left join[^;]*vs_categories'                                    as lj,
         def ~* '(^|[^t])\\yjoin\\s+public\\.vs_categories'                       as ij,
         def ~ 'coalesce\\([^)]*is_confidential[^)]*,\\s*false\\s*\\)'            as cf
  from fns where def ~ 'is_confidential|public_eligible' order by proname`)) {
  const closed = !r.cf && (r.ct || (r.ij && !r.lj));
  line(closed, `${r.proname} ${closed ? '' : '← treats a deleted category as PUBLISHABLE'}`);
}

console.log('\n3. per-row owner UPDATE policies need a column guard');
for (const r of await q(`
  select p.tablename, p.policyname,
         (select count(*) from pg_trigger t
           where t.tgrelid=(quote_ident(p.schemaname)||'.'||quote_ident(p.tablename))::regclass
             and not t.tgisinternal and t.tgname ~ 'guard') as guards
  from pg_policies p where p.schemaname='public' and p.cmd in ('UPDATE','ALL')
    -- Match a per-row OWNER policy however it identifies the caller. It used to
    -- test for auth.uid() only, which made it BLIND to 0110's
    -- team_members_update_self — that keys on current_user_email(), a definer
    -- helper, precisely because an inline lookup on public.users would depend on
    -- that table's own RLS. A sweep that cannot see the newest shape of the bug
    -- it exists to catch is worse than no sweep, because it reports "clean".
    -- auth.uid() and current_user_email() identify a ROW'S OWNER. Deliberately
    -- NOT current_user_dept(): a dept is a SCOPE, not ownership — vs_tags is
    -- editable by any handler of that dept by design, every column of it, and
    -- its WITH CHECK already stops a row being moved to a dept you do not hold.
    -- Adding it produced exactly one hit and it was a false positive.
    and coalesce(p.qual,'') ~ 'auth\\.uid\\(\\)|current_user_email\\(\\)'
  order by p.tablename`)) {
  const ok = Number(r.guards) > 0 || NO_GUARD_OK.includes(r.policyname);
  line(ok, `${r.tablename}.${r.policyname}${Number(r.guards) ? ' (guarded)' : ' (accepted: low severity)'}`);
}

console.log(bad ? `\n${bad} FINDING(S)` : '\nall sweeps clean');
process.exit(bad ? 1 : 0);
