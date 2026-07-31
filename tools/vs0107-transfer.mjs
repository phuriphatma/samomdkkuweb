// 0107 proof: โอนย้ายฝ่าย / โอนคืน SE works for a dept-scoped VS handler,
// and only within the bounds vs_tickets_update_staff already encodes.
//
// The bug: a raw `PATCH /vs_tickets` moving target_dept to 'SE' 42501s for a
// scoped handler — NOT because the UPDATE policy refuses it (its WITH CHECK
// explicitly allows SE) but because Postgres re-applies the SELECT policy to
// the NEW row, and vs_tickets_read scopes a handler to their own target_dept.
// A handoff is therefore un-PATCHable by construction. 0107 routes it through
// a SECURITY DEFINER RPC that re-applies the same predicate.
//
// Checks (both principal shapes that hit this — a shared vp_admin account and
// a SAMO Team grantee carrying managed_vs_depts):
//   * the raw UPDATE still fails 42501            (the bug is real, not a UI slip)
//   * vs_transfer_dept(id,'SE') succeeds and the row lands in SE
//   * -> another อุปนายก's dept                    refused
//   * a ticket outside the caller's scope          refused
//   * a null / blank destination                   refused (fail-CLOSED: `null =
//     any(scope)` is NULL, and `if not (NULL)` does NOT take the branch)
//   * a plain user (no VS access at all)           refused
//   * an unrestricted handler (full `vs`)          may move to any dept
//   * anon holds no EXECUTE grant
//
// SELF-PROVISIONING + NON-DESTRUCTIVE: every check runs inside ONE Management-
// API call — one implicit transaction — that seeds its own scope + ticket and
// ends with ROLLBACK. Nothing is left behind; the live tree is never written.
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
  else { fail++; console.log('  FAIL', name, String(extra).slice(0, 240)); }
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
/** The Management API returns ONLY the last row-producing statement. */
const rowsOf = (r) => (Array.isArray(r.body) ? r.body.flat().filter((x) => x && typeof x === 'object') : []);

const TID = 'VS-PRB107A';      // in the handler's dept
const TID_OUT = 'VS-PRB107B';  // in someone else's dept
let UID; let VPA; let DEPT; let OTHER;

/**
 * Seed a synthetic per-ฝ่าย scope on a real `role='user'` row, seed two probe
 * tickets, then run `sql` as that user. `permissions` is never touched —
 * users_self_update_guard would raise (auth.uid() is null here); the two
 * managed_* columns pass via the app.team_sync GUC the server writers use.
 */
const asScoped = (sql, uid = null) => mgmt(`
  select set_config('app.team_sync', '1', true);
  update public.users
     set managed_vs_depts     = array[${lit(DEPT)}],
         managed_permissions  = array_remove(coalesce(managed_permissions, '{}'), 'vs')
   where id = ${lit(uid || UID)};
  insert into public.vs_tickets (id, problem, target_dept)
       values (${lit(TID)}, 'probe 0107', ${lit(DEPT)}),
              (${lit(TID_OUT)}, 'probe 0107 other', ${lit(OTHER)});
  select set_config('request.jwt.claims',
    json_build_object('sub', ${lit(uid || UID)}, 'role', 'authenticated')::text, true);
  ${sql}
  rollback;`);

/** Same, but acting as the REAL shared vp_admin account (role-based scope). */
const asVpAdmin = (sql) => mgmt(`
  insert into public.vs_tickets (id, problem, target_dept)
       values (${lit(TID)}, 'probe 0107', ${lit(DEPT)}),
              (${lit(TID_OUT)}, 'probe 0107 other', ${lit(OTHER)});
  select set_config('request.jwt.claims',
    json_build_object('sub', ${lit(VPA)}, 'role', 'authenticated')::text, true);
  ${sql}
  rollback;`);

/**
 * Body of a probe: try one thing as `authenticated` and report the outcome.
 * UPDATE is measured by ROW_COUNT, never by "did it throw" — RLS filters
 * rows silently on UPDATE, so an exception-only probe scores a fully-blocked
 * write as permitted (mistakes.md).
 */
// `after` runs once the role is back to superuser. Any read-back of a
// transferred ticket MUST live there: the whole point of the handoff is that
// the caller can no longer SELECT the row, so verifying from inside the
// caller's context reports NULL for a move that in fact succeeded.
const probe = (stmts, after = '') => `
  set local role authenticated;
  create temp table res(k text, v text) on commit drop;
  do $probe$
  declare v_rc int; v_t text;
  begin
  ${stmts}
  end $probe$;
  reset role;
  ${after}
  select * from res;`;

const tryRpc = (key, args) => `
  begin
    v_t := public.vs_transfer_dept(${args});
    insert into res values(${lit(key)}, 'ok:'||coalesce(v_t,'NULL'));
  exception when others then insert into res values(${lit(key)}, 'ERR '||SQLSTATE); end;`;

const val = (rows, k) => (rows.find((r) => r.k === k) || {}).v;

async function main() {
  console.log('project', REF);

  const pick = await mgmt(`select
    (select u.id from public.users u
      where coalesce(u.role,'user') = 'user'
        and not ('vs' = any(coalesce(u.permissions,'{}')))
        and coalesce(cardinality(u.managed_vs_depts), 0) = 0
      limit 1) as uid,
    (select u.id from public.users u where u.role = 'vp_admin'
       and u.department is not null limit 1) as vpa,
    (select u.department from public.users u where u.role = 'vp_admin'
       and u.department is not null limit 1) as dept,
    (select u.department from public.users u where u.role = 'vp_admin'
       and u.department is not null offset 1 limit 1) as other`);
  ({ uid: UID, vpa: VPA, dept: DEPT, other: OTHER } = pick.body?.[0] || {});
  if (!UID || !VPA || !DEPT || !OTHER) {
    console.error('could not pick fixtures', JSON.stringify(pick.body)); process.exit(1);
  }
  console.log(`scoped uid ${UID}\nvp_admin  ${VPA}\ndept "${DEPT}" / other "${OTHER}"\n`);

  // ---- the bug: a raw PATCH-equivalent UPDATE cannot hand a ticket off ----
  for (const [label, run] of [['tree-scoped handler', asScoped], ['vp_admin account', asVpAdmin]]) {
    const r = await run(probe(`
      begin
        update public.vs_tickets set target_dept = 'SE' where id = ${lit(TID)};
        get diagnostics v_rc = ROW_COUNT;
        insert into res values('raw', 'rows='||v_rc);
      exception when others then insert into res values('raw', 'ERR '||SQLSTATE); end;
      begin
        update public.vs_tickets set target_dept = target_dept where id = ${lit(TID)};
        get diagnostics v_rc = ROW_COUNT;
        insert into res values('raw_same', 'rows='||v_rc);
      exception when others then insert into res values('raw_same', 'ERR '||SQLSTATE); end;`));
    const rows = rowsOf(r);
    check(`${label}: raw UPDATE -> SE still fails 42501 (the reported bug)`,
      val(rows, 'raw') === 'ERR 42501', errText(r));
    check(`${label}: a same-dept write is fine (so it is the handoff, not the write)`,
      val(rows, 'raw_same') === 'rows=1', errText(r));
  }

  // ---- the fix ----
  for (const [label, run] of [['tree-scoped handler', asScoped], ['vp_admin account', asVpAdmin]]) {
    // Every refusal is tested BEFORE the successful move, so each runs against
    // a ticket still sitting in the caller's own dept — otherwise a later
    // "destination refused" would really be re-testing the source check.
    const r = await run(probe(`
      ${tryRpc('other', `${lit(TID)}, ${lit(OTHER)}`)}
      ${tryRpc('outside', `${lit(TID_OUT)}, 'SE'`)}
      ${tryRpc('null', `${lit(TID)}, null`)}
      ${tryRpc('blank', `${lit(TID)}, '   '`)}
      ${tryRpc('missing', `'VS-NOPE-0107', 'SE'`)}
      ${tryRpc('se', `${lit(TID)}, 'SE'`)}`,
    `insert into res select 'after', target_dept
       from public.vs_tickets where id = ${lit(TID)};`));
    const rows = rowsOf(r);
    check(`${label}: vs_transfer_dept -> SE succeeds`,
      val(rows, 'se') === 'ok:SE', errText(r));
    check(`${label}: the row actually lands in SE`,
      val(rows, 'after') === 'SE', errText(r));
    check(`${label}: -> another อุปนายก's dept is refused`,
      val(rows, 'other') === 'ERR 42501', errText(r));
    check(`${label}: a ticket outside their scope is refused`,
      val(rows, 'outside') === 'ERR 42501', errText(r));
    check(`${label}: a null destination is refused (fails CLOSED)`,
      val(rows, 'null') === 'ERR 22023', errText(r));
    check(`${label}: a blank destination is refused`,
      val(rows, 'blank') === 'ERR 22023', errText(r));
    check(`${label}: an unknown ticket is refused`,
      val(rows, 'missing') === 'ERR P0002', errText(r));
  }

  // ---- remarks ride along atomically ----
  const rem = await asScoped(probe(
    tryRpc('se', `${lit(TID)}, 'SE', '[{"type":"log","text":"โอนย้ายฝ่าย"}]'::jsonb`),
    `insert into res select 'remark', remarks->0->>'text'
       from public.vs_tickets where id = ${lit(TID)};`));
  check('the transfer log entry lands in the same statement as the move',
    val(rowsOf(rem), 'remark') === 'โอนย้ายฝ่าย', errText(rem));

  // ---- principals that must NOT be able to transfer ----
  const plain = await mgmt(`
    insert into public.vs_tickets (id, problem, target_dept)
         values (${lit(TID)}, 'probe 0107', ${lit(DEPT)});
    select set_config('request.jwt.claims',
      json_build_object('sub', ${lit(UID)}, 'role', 'authenticated')::text, true);
    ${probe(`
      insert into res values('handler', public.current_user_is_vs_handler()::text);
      ${tryRpc('rpc', `${lit(TID)}, 'SE'`)}`)}
    rollback;`);
  const p = rowsOf(plain);
  check('a plain user is not a VS handler', val(p, 'handler') === 'false', errText(plain));
  check('a plain user cannot transfer', val(p, 'rpc') === 'ERR 42501', errText(plain));

  // ---- an unrestricted handler keeps full reach ----
  const supr = await mgmt(`
    insert into public.vs_tickets (id, problem, target_dept)
         values (${lit(TID)}, 'probe 0107', ${lit(DEPT)});
    select set_config('app.team_sync', '1', true);
    update public.users
       set managed_permissions = array_append(
             array_remove(coalesce(managed_permissions,'{}'), 'vs'), 'vs')
     where id = ${lit(UID)};
    select set_config('request.jwt.claims',
      json_build_object('sub', ${lit(UID)}, 'role', 'authenticated')::text, true);
    ${probe(`
      insert into res values('scope',
        coalesce(array_to_string(public.current_user_vs_scope(), ','), 'NULL'));
      ${tryRpc('any', `${lit(TID)}, ${lit(OTHER)}`)}`)}
    rollback;`);
  const s = rowsOf(supr);
  check('a full `vs` grant has an unrestricted scope', val(s, 'scope') === 'NULL', errText(supr));
  check('an unrestricted handler may move a ticket to ANY dept',
    val(s, 'any') === `ok:${OTHER}`, errText(supr));

  // ---- grants ----
  const gr = await mgmt(`select
    has_function_privilege('anon',
      'public.vs_transfer_dept(text,text,jsonb)', 'execute') as anon_x,
    has_function_privilege('authenticated',
      'public.vs_transfer_dept(text,text,jsonb)', 'execute') as auth_x`);
  const g = gr.body?.[0] || {};
  check('anon holds no EXECUTE on vs_transfer_dept', g.anon_x === false, errText(gr));
  check('authenticated holds EXECUTE', g.auth_x === true, errText(gr));

  // ---- nothing left behind ----
  const clean = await mgmt(`select
    (select count(*) from public.vs_tickets where id like 'VS-PRB107%') as tickets,
    (select count(*) from public.users
      where id = ${lit(UID)} and cardinality(managed_vs_depts) > 0) as granted`);
  const c = clean.body?.[0] || {};
  check('rollback left no probe tickets and no lingering grant',
    Number(c.tickets) === 0 && Number(c.granted) === 0, JSON.stringify(c));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
