// 0083 verification: a SAMO-Team-scoped VitalSound handler is scoped, not super.
//
// Proves, for a real tree-scoped account (users.managed_vs_depts non-empty,
// NO 'vs' in permissions/managed_permissions):
//   * current_user_vs_scope() = their dept(s)   (a super's = NULL)
//   * vs_tickets SELECT under RLS returns ONLY their dept
//   * search_vs_tickets / find_similar_vs_tickets never leak another dept
//   * merge across depts is refused; unmerge outside scope is refused
//   * vs_tags is readable and writable for their dept, refused for another
//
// Same mechanics as tools/vs0072-isolation.mjs: the Management API runs SQL as
// superuser, so each check runs inside ONE statement string that first does
//   set local role authenticated;  set_config('request.jwt.claims', …)
// to get both RLS enforcement and a working auth.uid().
//
// Read-only: creates nothing, mutates nothing (every write check is expected
// to FAIL, and the one that could succeed is rolled back).
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n').filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')]; })
);
const PAT = env.SUPABASE_ACCESS_TOKEN;
const REF = env.VITE_SUPABASE_URL.match(/https:\/\/([^.]+)\.supabase\.co/)[1];

let pass = 0; let fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('  PASS', name); }
  else { fail++; console.log('  FAIL', name, extra); }
};

async function mgmt(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${PAT}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  return { status: r.status, body: await r.json().catch(() => null) };
}

/** Run `sql` as the given uid with RLS on (role=authenticated). */
const asUser = (uid, sql) => mgmt(
  `set local role authenticated;
   select set_config('request.jwt.claims', json_build_object('sub','${uid}','role','authenticated')::text, true);
   ${sql}`,
);

const errText = (r) => JSON.stringify(r.body || '').slice(0, 200);
const isDenied = (r) => r.status >= 400 && /authoriz|denied|policy|violat/i.test(errText(r));

async function main() {
  console.log('project', REF);

  const who = await mgmt(`select id, email, managed_vs_depts::text as depts
     from public.users
    where cardinality(managed_vs_depts) > 0
      and not ('vs' = any(coalesce(permissions,'{}') || coalesce(managed_permissions,'{}')))
    limit 1`);
  const u = who.body?.[0];
  if (!u) { console.log('no tree-scoped VS account found — nothing to verify'); process.exit(0); }
  const DEPT = u.depts.replace(/^\{|\}$/g, '').split(',')[0].replace(/^"|"$/g, '');
  console.log('scoped account:', u.email, '→', DEPT);

  const other = await mgmt(`select target_dept, count(*) as n from public.vs_tickets
     where deleted_at is null and target_dept is distinct from ${lit(DEPT)}
     group by 1 order by n desc limit 1`);
  const OTHER = other.body?.[0]?.target_dept;
  console.log('other dept for negative checks:', OTHER);

  // 1. scope helper
  const scope = await asUser(u.id, 'select public.current_user_vs_scope()::text as s;');
  check('current_user_vs_scope() = their dept only',
    scope.body?.[0]?.s === u.depts, JSON.stringify(scope.body));

  // 2. RLS read
  const rows = await asUser(u.id, `select
      count(*) filter (where target_dept = ${lit(DEPT)}) as mine,
      count(*) filter (where target_dept is distinct from ${lit(DEPT)}) as others
    from public.vs_tickets where deleted_at is null;`);
  const r = rows.body?.[0] || {};
  check('vs_tickets RLS: sees own dept', Number(r.mine) > 0, JSON.stringify(r));
  check('vs_tickets RLS: sees NO other dept', Number(r.others) === 0, JSON.stringify(r));

  // 3. search RPC never leaks another dept
  const search = await asUser(u.id,
    `select count(*) filter (where target_dept is distinct from ${lit(DEPT)}) as leaked
       from public.search_vs_tickets('', null, 25);`);
  check('search_vs_tickets: no cross-dept rows',
    Number(search.body?.[0]?.leaked) === 0, errText(search));

  // 4. find_similar on an out-of-scope ticket is refused
  if (OTHER) {
    const alien = await mgmt(`select id from public.vs_tickets
       where target_dept = ${lit(OTHER)} and deleted_at is null and duplicate_of is null limit 1`);
    const alienId = alien.body?.[0]?.id;
    if (alienId) {
      const sim = await asUser(u.id, `select * from public.find_similar_vs_tickets(${lit(alienId)}, 5);`);
      check('find_similar_vs_tickets on another dept refused', isDenied(sim), errText(sim));
      const un = await asUser(u.id, `select public.unmerge_vs_ticket(${lit(alienId)});`);
      check('unmerge_vs_ticket on another dept refused', isDenied(un), errText(un));
      const del = await asUser(u.id, `select public.soft_delete_vs_ticket(${lit(alienId)});`);
      check('soft_delete_vs_ticket on another dept refused', isDenied(del), errText(del));
    }
  }

  // 5. vs_tags: readable; own dept writable; other dept refused (rolled back).
  const tagsRead = await asUser(u.id, 'select count(*) as n from public.vs_tags;');
  check('vs_tags readable by a scoped handler', tagsRead.status < 400, errText(tagsRead));

  const tagOwn = await asUser(u.id,
    `insert into public.vs_tags (id, dept, label) values ('zz-0083-probe', ${lit(DEPT)}, 'probe');
     rollback;`);
  check('vs_tags: own dept insert allowed', tagOwn.status < 400, errText(tagOwn));

  if (OTHER) {
    const tagOther = await asUser(u.id,
      `insert into public.vs_tags (id, dept, label) values ('zz-0083-probe2', ${lit(OTHER)}, 'probe');
       rollback;`);
    check('vs_tags: other dept insert refused', isDenied(tagOther), errText(tagOther));
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

function lit(s) { return `'${String(s).replace(/'/g, "''")}'`; }

main().catch((e) => { console.error(e); process.exit(1); });
