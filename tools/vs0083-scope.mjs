// 0083/0084 proof: a SAMO-Team-scoped VitalSound handler is SCOPED, not super.
//
// Proves, for a synthetic per-ฝ่าย handler (users.managed_vs_depts = one dept,
// no `vs` permission anywhere):
//   * current_user_vs_scope() = that dept  (a super's = NULL, a student's = {})
//   * vs_tickets SELECT under RLS returns ONLY that dept
//   * search / find_similar / unmerge / soft_delete never reach another dept
//   * vs_tags: readable, own-dept writable, other-dept refused
//   * public board (0084): counts as เจ้าหน้าที่ and reads staff-only comments
//     on their OWN dept's problem — but NOT on another dept's; anon reads none
//
// SELF-PROVISIONING + NON-DESTRUCTIVE: every check runs inside ONE Management-
// API call — one implicit transaction — that grants the scope, does its work,
// and ends with ROLLBACK. Nothing is left behind and the live tree/config is
// never read or written, so this stays valid while someone edits ทีม SAMO.
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
  else { fail++; console.log('  FAIL', name, extra.slice(0, 220)); }
};
const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;

async function mgmt(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${PAT}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  return { status: r.status, body: await r.json().catch(() => null) };
}

const errText = (r) => JSON.stringify(r.body || '');
const isDenied = (r) => r.status >= 400 && /authoriz|denied|policy|violat/i.test(errText(r));
/** The Management API returns ONLY the last row-producing statement of a
 *  multi-statement call — so every assertion a call makes must live in one
 *  final SELECT. This just unwraps that single result set. */
const rowsOf = (r) => (Array.isArray(r.body) ? r.body.flat().filter((x) => x && typeof x === 'object') : []);

let UID; let DEPT; let OTHER;

/** Grant the synthetic scope, then act as that user. `permissions` is never
 *  touched — users_self_update_guard would raise (auth.uid() is still null
 *  here); the two managed_* columns pass via the app.team_sync GUC the server
 *  writers use. */
const asHandler = (sql) => mgmt(`
  select set_config('app.team_sync', '1', true);
  update public.users
     set managed_vs_depts = array[${lit(DEPT)}],
         managed_permissions = array_remove(coalesce(managed_permissions,'{}'), 'vs')
   where id = ${lit(UID)};
  select set_config('request.jwt.claims',
    json_build_object('sub', ${lit(UID)}, 'role', 'authenticated')::text, true);
  ${sql}
  rollback;`);

/** A published, non-confidential Problem in `dept` carrying a student's
 *  staff-only comment whose body is a searchable marker. */
const seedProblem = (id, dept, marker) => `
  insert into public.vs_tickets (id, problem, target_dept, category, is_public, public_title)
  values (${lit(id)}, 'probe', ${lit(dept)},
          (select c.id from public.vs_categories c
            where coalesce(c.is_confidential, true) = false limit 1), true, 'probe');
  insert into public.vs_public_comments (canonical_id, author_user_id, is_staff, body, staff_only)
  values (${lit(id)}, (select u.id from public.users u where u.id <> ${lit(UID)} limit 1),
          false, ${lit(marker)}, true);`;

async function main() {
  console.log('project', REF);

  const pick = await mgmt(`select
    (select u.id from public.users u
      where coalesce(u.role,'user') = 'user'
        and not ('vs' = any(coalesce(u.permissions,'{}')))
      limit 1) as uid,
    (select t.target_dept from public.vs_tickets t where t.deleted_at is null
      group by 1 order by count(*) desc limit 1) as d1,
    (select t.target_dept from public.vs_tickets t where t.deleted_at is null
      group by 1 order by count(*) desc offset 1 limit 1) as d2`);
  ({ uid: UID, d1: DEPT, d2: OTHER } = pick.body?.[0] || {});
  if (!UID || !DEPT || !OTHER) {
    console.log('cannot build the scenario (need a plain user + 2 depts with tickets)', errText(pick));
    process.exit(1);
  }
  console.log('synthetic handler:', UID, '→', DEPT, '| other dept:', OTHER);

  // ---- scope helper + RLS reads ----
  const scope = await asHandler(`
    set local role authenticated;
    select public.current_user_vs_scope()::text as s,
           (select count(*) from public.vs_tickets
             where deleted_at is null and target_dept = ${lit(DEPT)}) as mine,
           (select count(*) from public.vs_tickets
             where deleted_at is null and target_dept is distinct from ${lit(DEPT)}) as others;
    reset role;`);
  const s = rowsOf(scope).find((x) => 's' in x) || {};
  check('current_user_vs_scope() = their dept only', s.s === `{${DEPT}}`, errText(scope));
  check('vs_tickets RLS: sees own dept', Number(s.mine) > 0, JSON.stringify(s));
  check('vs_tickets RLS: sees NO other dept', Number(s.others) === 0, JSON.stringify(s));

  // ---- dedup / delete RPCs ----
  const leak = await asHandler(
    `select count(*) filter (where target_dept is distinct from ${lit(DEPT)}) as leaked
       from public.search_vs_tickets('', null, 25);`);
  check('search_vs_tickets: no cross-dept rows',
    Number(rowsOf(leak).find((x) => 'leaked' in x)?.leaked) === 0, errText(leak));

  const alien = await mgmt(`select id from public.vs_tickets
     where target_dept = ${lit(OTHER)} and deleted_at is null and duplicate_of is null limit 1`);
  const alienId = alien.body?.[0]?.id;
  if (alienId) {
    check('find_similar_vs_tickets on another dept refused',
      isDenied(await asHandler(`select * from public.find_similar_vs_tickets(${lit(alienId)}, 5);`)));
    check('unmerge_vs_ticket on another dept refused',
      isDenied(await asHandler(`select public.unmerge_vs_ticket(${lit(alienId)});`)));
    check('soft_delete_vs_ticket on another dept refused',
      isDenied(await asHandler(`select public.soft_delete_vs_ticket(${lit(alienId)});`)));
  }

  // ---- vs_tags ----
  const tags = await asHandler(`
    set local role authenticated;
    select count(*) as n from public.vs_tags;
    insert into public.vs_tags (id, dept, label) values ('zz-probe', ${lit(DEPT)}, 'probe');
    reset role;`);
  check('vs_tags: readable + own-dept insert allowed', tags.status < 400, errText(tags));
  check('vs_tags: other-dept insert refused', isDenied(await asHandler(`
    set local role authenticated;
    insert into public.vs_tags (id, dept, label) values ('zz-probe2', ${lit(OTHER)}, 'probe');
    reset role;`)));

  // ---- public board (0084) ----
  const board = await asHandler(`
    ${seedProblem('VS-PRB84A', DEPT, 'SECRET-MINE')}
    ${seedProblem('VS-PRB84B', OTHER, 'SECRET-THEIRS')}
    select public.vs_post_public_comment('VS-PRB84A', 'badge probe');
    select public.current_user_is_vs_handler() as is_handler,
           public.get_public_vs_problem('VS-PRB84A')::text like '%SECRET-MINE%'   as reads_own,
           public.get_public_vs_problem('VS-PRB84B')::text like '%SECRET-THEIRS%' as reads_other,
           (select c.is_staff from public.vs_public_comments c
             where c.canonical_id = 'VS-PRB84A' and c.author_user_id = ${lit(UID)}) as badge;`);
  const b = rowsOf(board).find((x) => 'is_handler' in x) || {};
  check('board: scoped handler counts as เจ้าหน้าที่', b.is_handler === true, errText(board));
  check('board: reads staff-only comment on OWN dept', b.reads_own === true, JSON.stringify(b));
  check('board: does NOT read staff-only comment on another dept', b.reads_other === false, JSON.stringify(b));
  check('board: their own comment is stamped is_staff = true', b.badge === true, errText(board));

  // A guest must still see none of it (get_public_vs_problem is granted to anon).
  const guest = await mgmt(`
    ${seedProblem('VS-PRB84C', DEPT, 'SECRET-MINE')}
    select set_config('request.jwt.claims', '', true);
    select public.get_public_vs_problem('VS-PRB84C')::text like '%SECRET-MINE%' as leaked,
           public.current_user_is_vs_handler() as guest_is_handler;
    rollback;`);
  const g = rowsOf(guest).find((x) => 'leaked' in x) || {};
  check('board: anon cannot read a staff-only comment', g.leaked === false, errText(guest));
  check('anon is not a VS handler', g.guest_is_handler === false, errText(guest));

  // ---- nothing left behind ----
  const clean = await mgmt(`select
    (select count(*) from public.vs_tags where id like 'zz-probe%') as tags,
    (select count(*) from public.vs_tickets where id like 'VS-PRB84%') as tickets,
    (select count(*) from public.users
      where id = ${lit(UID)} and cardinality(managed_vs_depts) > 0) as granted`);
  const c = clean.body?.[0] || {};
  check('rollback left no probe rows and no lingering grant',
    Number(c.tags) === 0 && Number(c.tickets) === 0 && Number(c.granted) === 0, JSON.stringify(c));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
