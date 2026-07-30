// Proof for the passport authorization hardening (passport db/0010 + db/0011).
//
// WHY THIS SHAPE: db/0011 is the lockdown that closes every `:: true` write
// policy in the `passport` schema. Applying it is the risky half — get it wrong
// and student scanning or the admin panel dies for 593 users. So this script
// applies 0011 INSIDE a transaction it rolls back, and asserts, as five real
// principals, that each can do exactly what they should and nothing more.
// Nothing is committed: no policy changes, no scans, no profiles touched.
//
// It therefore proves the lockdown BEFORE the lockdown is applied for real, and
// after 0011 IS applied it keeps working as a regression test (re-applying 0011
// inside the transaction is idempotent).
//
// Run:  node tools/pass-hardening.mjs
//
// The five principals:
//   anon           — the bundled anon key, no session. Today it can award itself
//                    km and dump the roster; after 0011 it must be able to do
//                    nothing but read the catalog.
//   student        — a real @kkumail.com account. Must still be able to stamp,
//                    and must NOT be able to forge a scan or edit its own km.
//   non-kkumail    — signed in, wrong domain. The kkumail rule is client-side
//                    only today, so the RPC has to enforce it.
//   moved account  — an account whose data was migrated away.
//   admin (full)   — blanket `passport` permission via the ทีม SAMO tree.
//   admin (scoped) — one department only; must see ONLY that department.
//
// NOTE the superuser caveat that makes this script necessary at all: the
// Management API runs as the Postgres superuser, where auth.uid() is null and RLS
// is bypassed entirely — so every policy and guard here looks like a no-op unless
// you impersonate with set_config('role') + set_config('request.jwt.claims').
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n').filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')]; })
);
const PAT = env.SUPABASE_ACCESS_TOKEN;
const REF = env.VITE_SUPABASE_URL.match(/https:\/\/([^.]+)\.supabase\.co/)[1];

// db/0011 lives in the separate passport repo. Override with PASSPORT_REPO if it
// is not checked out as a sibling of the samoweb tree.
const passportRoot = process.env.PASSPORT_REPO
  ? new URL(`file://${process.env.PASSPORT_REPO.replace(/\/?$/, '/')}`)
  : new URL('../../../passport/', import.meta.url);
const LOCKDOWN = readFileSync(new URL('db/0011_passport_rls_lockdown.sql', passportRoot), 'utf8');

let pass = 0; let fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('  PASS', name); }
  else { fail++; console.log('  FAIL', name, '->', String(extra).slice(0, 200)); }
};

async function mgmt(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${PAT}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  return { status: r.status, body: await r.json().catch(() => null) };
}

// Each probe records one row in `out`. `try_` wraps a statement so a raised
// exception is recorded as 'blocked:<sqlstate>' rather than aborting the run —
// which is the whole point: a blocked write and a permitted one must be
// distinguishable, and in a single transaction an uncaught error would poison it.
const TRY = (key, body) => `
  begin
    ${body}
    insert into out values('${key}','ALLOWED');
  exception when others then
    insert into out values('${key}','blocked:'||sqlstate||':'||replace(sqlerrm, E'\\n',' '));
  end;`;

// TRYN is for UPDATE / DELETE. RLS does NOT raise on those: a row the policy
// hides is simply not visible, so the statement SUCCEEDS having touched nothing.
// Asserting "did it throw?" would score a fully-blocked UPDATE as ALLOWED — which
// it did on the first run of this script. The only honest measure is ROW_COUNT.
// (INSERT is different: a WITH CHECK failure is a real 42501 error.)
const TRYN = (key, body) => `
  begin
    ${body}
    get diagnostics v_rc = ROW_COUNT;
    insert into out values('${key}','rows='||v_rc);
  exception when others then
    insert into out values('${key}','blocked:'||sqlstate||':'||replace(sqlerrm, E'\\n',' '));
  end;`;

const SQL = `
begin;

create temp table out(k text, v text);
do $$ begin
  execute format('grant usage on schema %s to anon, authenticated', pg_my_temp_schema()::regnamespace);
  execute 'grant select, insert on out to anon, authenticated';
end $$;

-- ---------------------------------------------------------------- fixtures ---
do $$
declare
  v_student uuid; v_student2 uuid; v_nonkku uuid; v_moved uuid;
  v_admin_full uuid; v_admin_scoped uuid;
  v_dept_a int; v_dept_b int;
  v_act_a uuid := gen_random_uuid(); v_act_b uuid := gen_random_uuid();
begin
  -- a full admin = blanket 'passport' perm through the tree
  select id into v_admin_full from public.users
   where 'passport' = any(coalesce(managed_permissions,'{}'))
      or 'passport' = any(coalesce(permissions,'{}')) limit 1;
  -- a scoped admin = a dept binding and NOT the blanket perm
  select id into v_admin_scoped from public.users
   where coalesce(managed_passport_scopes,'{}') <> '{}'
     and not ('passport' = any(coalesce(managed_permissions,'{}')))
     and not ('passport' = any(coalesce(permissions,'{}'))) limit 1;

  -- that scoped admin's department, read from their own grant
  select (substring(t from 3))::int into v_dept_a
    from public.users u, unnest(u.managed_passport_scopes) t
   where u.id = v_admin_scoped and t like 'd:%' limit 1;
  select id into v_dept_b from passport.departments
   where id is distinct from v_dept_a order by id limit 1;

  -- students: real kkumail auth accounts that are not admins and not migrated away
  select u.id into v_student from auth.users u
   where lower(u.email) like '%@kkumail.com'
     and u.id is distinct from v_admin_full and u.id is distinct from v_admin_scoped
     and not exists (select 1 from passport.account_migrations m
                      where lower(m.from_email) = lower(u.email))
   order by u.created_at limit 1;
  select u.id into v_student2 from auth.users u
   where lower(u.email) like '%@kkumail.com' and u.id is distinct from v_student
     and u.id is distinct from v_admin_full and u.id is distinct from v_admin_scoped
   order by u.created_at limit 1;

  select id into v_nonkku from auth.users
   where lower(email) not like '%@kkumail.com'
     and lower(email) <> 'pmphuriphat@gmail.com' limit 1;
  select u.id into v_moved from auth.users u
   join passport.account_migrations m on lower(m.from_email) = lower(u.email) limit 1;

  insert into out values('ids', concat_ws(' ',
    'student='||coalesce(v_student::text,'-'), 'student2='||coalesce(v_student2::text,'-'),
    'nonkku='||coalesce(v_nonkku::text,'-'),  'moved='||coalesce(v_moved::text,'-'),
    'admin_full='||coalesce(v_admin_full::text,'-'),
    'admin_scoped='||coalesce(v_admin_scoped::text,'-'),
    'dept_a='||coalesce(v_dept_a::text,'-'), 'dept_b='||coalesce(v_dept_b::text,'-')));

  -- keep the uuids addressable from later phases
  insert into out values('_student', v_student::text);
  insert into out values('_student2', v_student2::text);
  insert into out values('_nonkku', coalesce(v_nonkku::text,''));
  insert into out values('_moved', coalesce(v_moved::text,''));
  insert into out values('_admin_full', v_admin_full::text);
  insert into out values('_admin_scoped', v_admin_scoped::text);
  insert into out values('_act_a', v_act_a::text);
  insert into out values('_act_b', v_act_b::text);
  insert into out values('_dept_a', v_dept_a::text);
  insert into out values('_dept_b', v_dept_b::text);

  -- two throwaway activities, one per department, with known tokens + points
  insert into passport.activities (id, name, base_points_km, static_token, department_id)
  values (v_act_a, 'PROBE A', 100, 'TOKEN-A', v_dept_a),
         (v_act_b, 'PROBE B', 100, 'TOKEN-B', v_dept_b);

  -- profile rows so on_new_scan's UPDATE lands
  insert into passport.profiles (id, email, full_name, total_km)
    select u.id, u.email, 'Probe '||left(u.id::text,4), 0 from auth.users u
     where u.id in (v_student, v_student2)
    on conflict (id) do nothing;

  -- one pre-existing scan per department, so the scoped-admin leaderboard has
  -- something it must EXCLUDE as well as something it must include
  insert into passport.scans (user_id, activity_id, points_awarded, activity_name, department_id)
  values (v_student2, v_act_a, 100, 'PROBE A', v_dept_a);
  insert into passport.scans (user_id, activity_id, points_awarded, activity_name, department_id)
  values (v_student2, v_act_b, 100, 'PROBE B', v_dept_b);
end $$;

-- ------------------------------------------------- THE LOCKDOWN (0011) -------
${LOCKDOWN}

-- ================================================================= anon ======
do $$
declare v_act_a uuid; v_n int; v_rc int;
begin
  select v::uuid into v_act_a from out where k='_act_a';
  perform set_config('request.jwt.claims', json_build_object('role','anon')::text, true);
  perform set_config('role','anon', true);

  ${TRY('anon_insert_scan', `insert into passport.scans (user_id, activity_id, points_awarded)
      select v::uuid, v_act_a, 99999 from out where k='_student';`)}
  ${TRYN('anon_update_scans', `update passport.scans set points_awarded = 99999 where true;`)}
  ${TRYN('anon_delete_scans', `delete from passport.scans where true;`)}
  ${TRY('anon_insert_activity', `insert into passport.activities (name, base_points_km)
      values ('anon owns this', 1);`)}
  ${TRYN('anon_update_activity', `update passport.activities set base_points_km = 99999 where true;`)}
  ${TRYN('anon_update_year', `update passport.samo_years set ended_at = now() where true;`)}
  ${TRYN('anon_profile_km', `update passport.profiles set total_km = 99999 where true;`)}
  ${TRY('anon_stamp_rpc', `perform passport.stamp_scan(v_act_a, 'TOKEN-A');`)}
  ${TRY('anon_names_rpc', `perform * from passport.leaderboard_names();`)}
  ${TRY('anon_admin_lb_rpc', `perform * from passport.admin_leaderboard();`)}

  select count(*) into v_n from passport.profiles;      insert into out values('anon_read_profiles', v_n::text);
  select count(*) into v_n from passport.user_tiers;    insert into out values('anon_read_user_tiers', v_n::text);
  select count(*) into v_n from passport.season_results;insert into out values('anon_read_season_results', v_n::text);
  select count(*) into v_n from passport.activities;    insert into out values('anon_read_activities', v_n::text);
  select count(*) into v_n from passport.scans;         insert into out values('anon_read_scans', v_n::text);
end $$;
reset role;

-- ============================================================== student ======
do $$
declare
  v_uid uuid; v_other uuid; v_act_a uuid; v_act_b uuid;
  v_km_before int; v_km_after int; v_n int; v_rc int; v_scan passport.scans;
begin
  select v::uuid into v_uid    from out where k='_student';
  select v::uuid into v_other  from out where k='_student2';
  select v::uuid into v_act_a  from out where k='_act_a';
  select v::uuid into v_act_b  from out where k='_act_b';
  select total_km into v_km_before from passport.profiles where id = v_uid;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_uid, 'role','authenticated')::text, true);
  perform set_config('role','authenticated', true);

  -- the happy path must survive the lockdown
  begin
    v_scan := passport.stamp_scan(v_act_a, 'TOKEN-A');
    insert into out values('stu_stamp', 'ok points='||v_scan.points_awarded||
                                        ' user_match='||(v_scan.user_id = v_uid)::text);
  exception when others then insert into out values('stu_stamp','FAILED:'||sqlerrm); end;

  ${TRY('stu_stamp_again', `perform passport.stamp_scan(v_act_a, 'TOKEN-A');`)}
  ${TRY('stu_stamp_badtoken', `perform passport.stamp_scan(v_act_b, 'WRONG');`)}
  ${TRY('stu_stamp_nosuch', `perform passport.stamp_scan(gen_random_uuid(), 'TOKEN-A');`)}
  ${TRY('stu_forge_scan', `insert into passport.scans (user_id, activity_id, points_awarded)
      values (v_uid, v_act_b, 99999);`)}
  ${TRYN('stu_own_km', `update passport.profiles set total_km = 99999 where id = v_uid;`)}
  ${TRYN('stu_own_tier', `update passport.profiles set tier_override = 'The Ambassador' where id = v_uid;`)}
  ${TRYN('stu_own_name', `update passport.profiles set full_name = 'Renamed By Self' where id = v_uid;`)}
  ${TRYN('stu_other_km', `update passport.profiles set total_km = 0 where id = v_other;`)}
  ${TRY('stu_admin_lb', `perform * from passport.admin_leaderboard();`)}
  ${TRYN('stu_delete_other_scan', `delete from passport.scans where user_id = v_other;`)}

  select total_km into v_km_after from passport.profiles where id = v_uid;
  insert into out values('stu_km_delta', (coalesce(v_km_after,0) - coalesce(v_km_before,0))::text);

  select count(*) into v_n from passport.profiles;    insert into out values('stu_read_profiles', v_n::text);
  select count(*) into v_n from passport.user_tiers where id = v_uid;
  insert into out values('stu_read_own_tier', v_n::text);
  select count(*) into v_n from passport.leaderboard_names();
  insert into out values('stu_names_rpc', v_n::text);
  ${TRYN('stu_delete_own_scan', `delete from passport.scans where user_id = v_uid and activity_id = v_act_a;`)}
end $$;
reset role;

-- ========================================== non-kkumail / moved account ======
do $$
declare v_uid uuid; v_act_a uuid;
begin
  select v::uuid into v_act_a from out where k='_act_a';

  select nullif(v,'')::uuid into v_uid from out where k='_nonkku';
  if v_uid is not null then
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_uid, 'role','authenticated')::text, true);
    perform set_config('role','authenticated', true);
    ${TRY('nonkku_stamp', `perform passport.stamp_scan(v_act_a, 'TOKEN-A');`)}
    perform set_config('role','postgres', true);
  else
    insert into out values('nonkku_stamp','SKIP no such account');
  end if;

  select nullif(v,'')::uuid into v_uid from out where k='_moved';
  if v_uid is not null then
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_uid, 'role','authenticated')::text, true);
    perform set_config('role','authenticated', true);
    ${TRY('moved_stamp', `perform passport.stamp_scan(v_act_a, 'TOKEN-A');`)}
  else
    insert into out values('moved_stamp','SKIP no migrated account');
  end if;
end $$;
reset role;

-- ========================================================= admin (full) =====
do $$
declare v_uid uuid; v_a int; v_b int; v_n int; v_rows int; v_rc int;
begin
  select v::uuid into v_uid from out where k='_admin_full';
  select v::int  into v_a   from out where k='_dept_a';
  select v::int  into v_b   from out where k='_dept_b';
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_uid, 'role','authenticated')::text, true);
  perform set_config('role','authenticated', true);

  insert into out values('af_is_admin', passport.is_admin()::text);
  insert into out values('af_covers_a', passport.admin_covers_dept(v_a)::text);
  insert into out values('af_covers_b', passport.admin_covers_dept(v_b)::text);

  select count(*) into v_rows from passport.admin_leaderboard(null,null,v_a,null);
  insert into out values('af_lb_dept_a', v_rows::text);
  select count(*) into v_rows from passport.admin_leaderboard(null,null,v_b,null);
  insert into out values('af_lb_dept_b', v_rows::text);

  ${TRY('af_insert_activity', `insert into passport.activities (name, base_points_km)
      values ('admin made this', 5);`)}
  ${TRYN('af_update_scan', `update passport.scans set points_awarded = 101
      where activity_name = 'PROBE A';`)}
  select count(*) into v_n from passport.profiles; insert into out values('af_read_profiles', v_n::text);
end $$;
reset role;

-- ======================================================= admin (scoped) =====
do $$
declare v_uid uuid; v_a int; v_b int; v_rows int;
begin
  select v::uuid into v_uid from out where k='_admin_scoped';
  select v::int  into v_a   from out where k='_dept_a';
  select v::int  into v_b   from out where k='_dept_b';
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_uid, 'role','authenticated')::text, true);
  perform set_config('role','authenticated', true);

  insert into out values('as_is_admin', passport.is_admin()::text);
  insert into out values('as_covers_a', passport.admin_covers_dept(v_a)::text);
  insert into out values('as_covers_b', passport.admin_covers_dept(v_b)::text);

  -- the load-bearing assertion: asking for a department they do NOT hold must
  -- return nothing, because the scope is re-applied inside the definer function
  select count(*) into v_rows from passport.admin_leaderboard(null,null,v_a,null);
  insert into out values('as_lb_dept_a', v_rows::text);
  select count(*) into v_rows from passport.admin_leaderboard(null,null,v_b,null);
  insert into out values('as_lb_dept_b', v_rows::text);
  select count(*) into v_rows from passport.admin_leaderboard();
  insert into out values('as_lb_unfiltered', v_rows::text);
end $$;
reset role;

select k, v from out where k not like '\\_%' order by k;
rollback;
`;

const OUT_OF_TXN = `
select
  (select count(*) from information_schema.parameters
    where specific_schema='passport' and specific_name like 'leaderboard_names%'
      and parameter_mode='OUT') as names_out_cols,
  (select count(*) from information_schema.parameters
    where specific_schema='passport' and specific_name like 'leaderboard_names%'
      and parameter_mode='OUT' and lower(parameter_name)='email') as names_has_email,
  (select coalesce(string_agg(r.rolname,','),'-') from pg_proc p
     join pg_namespace n on n.oid=p.pronamespace, pg_roles r
    where n.nspname='passport' and p.proname='stamp_scan'
      and r.rolname in ('anon') and has_function_privilege(r.rolname,p.oid,'execute')) as stamp_anon,
  (select coalesce(c.reloptions::text,'-') from pg_class c
     join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='passport' and c.relname='user_tiers') as user_tiers_opts;
`;

(async () => {
  console.log('passport hardening proof — 0011 applied inside a rolled-back transaction\n');
  const r = await mgmt(SQL);
  if (r.status >= 300 || !Array.isArray(r.body)) {
    console.error('SQL failed:', r.status, JSON.stringify(r.body).slice(0, 900));
    process.exit(2);
  }
  const m = Object.fromEntries(r.body.map((x) => [x.k, x.v]));
  console.log('  setup:', m.ids, '\n');
  const blocked = (k) => (m[k] || '').startsWith('blocked');
  const raised = (k, code) => (m[k] || '').includes(code);
  // For UPDATE/DELETE, "denied" means the statement ran and touched NOTHING —
  // RLS hides the rows rather than raising. Either shape counts as blocked.
  const noop = (k) => blocked(k) || m[k] === 'rows=0';
  const touched = (k) => Number(String(m[k] || '').replace('rows=', '')) || 0;

  console.log('anon (the bundled key, no session) — must be inert:');
  check('cannot insert a scan', blocked('anon_insert_scan'), m.anon_insert_scan);
  check('cannot update scans', noop('anon_update_scans'), m.anon_update_scans);
  check('cannot delete scans', noop('anon_delete_scans'), m.anon_delete_scans);
  check('cannot create an activity', blocked('anon_insert_activity'), m.anon_insert_activity);
  check('cannot edit an activity', noop('anon_update_activity'), m.anon_update_activity);
  check('cannot end the current วาระ', noop('anon_update_year'), m.anon_update_year);
  check('cannot set anyone total_km', noop('anon_profile_km'), m.anon_profile_km);
  check('cannot execute stamp_scan', blocked('anon_stamp_rpc'), m.anon_stamp_rpc);
  check('cannot execute leaderboard_names', blocked('anon_names_rpc'), m.anon_names_rpc);
  check('admin_leaderboard refused', blocked('anon_admin_lb_rpc'), m.anon_admin_lb_rpc);
  check('reads 0 profiles (was the whole roster)', m.anon_read_profiles === '0', m.anon_read_profiles);
  check('reads 0 user_tiers (the view no longer bypasses RLS)',
    m.anon_read_user_tiers === '0', m.anon_read_user_tiers);
  check('reads 0 season_results', m.anon_read_season_results === '0', m.anon_read_season_results);
  check('CAN still read activities (needed pre-login)', Number(m.anon_read_activities) > 0, m.anon_read_activities);
  check('CAN still read scans (public ranking)', Number(m.anon_read_scans) > 0, m.anon_read_scans);

  console.log('\nstudent (@kkumail) — the happy path must survive:');
  check('stamp_scan works', (m.stu_stamp || '').startsWith('ok'), m.stu_stamp);
  check('points come from the ACTIVITY, not the client', (m.stu_stamp || '').includes('points=100'), m.stu_stamp);
  check('scan is pinned to auth.uid()', (m.stu_stamp || '').includes('user_match=true'), m.stu_stamp);
  check('total_km still updated by the server path (+100)', m.stu_km_delta === '100', m.stu_km_delta);
  check('double stamp -> ALREADY_STAMPED', raised('stu_stamp_again', 'ALREADY_STAMPED'), m.stu_stamp_again);
  check('wrong token -> INVALID_TOKEN', raised('stu_stamp_badtoken', 'INVALID_TOKEN'), m.stu_stamp_badtoken);
  check('unknown activity -> ACTIVITY_NOT_FOUND', raised('stu_stamp_nosuch', 'ACTIVITY_NOT_FOUND'), m.stu_stamp_nosuch);
  check('cannot forge a scan directly', blocked('stu_forge_scan'), m.stu_forge_scan);
  check('cannot set own total_km', raised('stu_own_km', 'server-managed'), m.stu_own_km);
  check('cannot set own tier_override', raised('stu_own_tier', 'admin-managed'), m.stu_own_tier);
  check('CAN still rename self', touched('stu_own_name') === 1, m.stu_own_name);
  check('cannot touch another student', noop('stu_other_km'), m.stu_other_km);
  check("cannot delete another student's scan", noop('stu_delete_other_scan'), m.stu_delete_other_scan);
  check('admin_leaderboard refused', raised('stu_admin_lb', 'NOT_AUTHORIZED'), m.stu_admin_lb);
  check('reads only own profile', m.stu_read_profiles === '1', m.stu_read_profiles);
  check('own user_tiers row still readable', m.stu_read_own_tier === '1', m.stu_read_own_tier);
  check('leaderboard names still available', Number(m.stu_names_rpc) > 0, m.stu_names_rpc);
  check('CAN delete own scan', touched('stu_delete_own_scan') === 1, m.stu_delete_own_scan);

  console.log('\ngate enforcement that was client-side only:');
  check('non-kkumail -> NOT_KKUMAIL', raised('nonkku_stamp', 'NOT_KKUMAIL'), m.nonkku_stamp);
  check('migrated-away account -> ACCOUNT_MOVED', raised('moved_stamp', 'ACCOUNT_MOVED'), m.moved_stamp);

  console.log('\nadmin, blanket `passport` via the ทีม SAMO tree:');
  check('is_admin', m.af_is_admin === 'true', m.af_is_admin);
  check('covers dept A', m.af_covers_a === 'true', m.af_covers_a);
  check('covers dept B too (all_departments)', m.af_covers_b === 'true', m.af_covers_b);
  check('leaderboard returns dept A', Number(m.af_lb_dept_a) > 0, m.af_lb_dept_a);
  check('leaderboard returns dept B', Number(m.af_lb_dept_b) > 0, m.af_lb_dept_b);
  check('can create an activity', m.af_insert_activity === 'ALLOWED', m.af_insert_activity);
  check('can correct a scan', touched('af_update_scan') >= 1, m.af_update_scan);
  check('can read all profiles', Number(m.af_read_profiles) > 1, m.af_read_profiles);

  console.log('\nadmin, ONE department (the scope must survive the definer bypass):');
  check('is_admin', m.as_is_admin === 'true', m.as_is_admin);
  check('covers own dept', m.as_covers_a === 'true', m.as_covers_a);
  check('does NOT cover another dept', m.as_covers_b === 'false', m.as_covers_b);
  check('leaderboard returns own dept', Number(m.as_lb_dept_a) > 0, m.as_lb_dept_a);
  check('leaderboard returns NOTHING for another dept', m.as_lb_dept_b === '0', m.as_lb_dept_b);
  check('unfiltered call still scoped', Number(m.as_lb_unfiltered) === Number(m.as_lb_dept_a),
    `unfiltered=${m.as_lb_unfiltered} own=${m.as_lb_dept_a}`);

  const r2 = await mgmt(OUT_OF_TXN);
  const s = Array.isArray(r2.body) ? r2.body[0] : {};
  console.log('\nshape checks (live schema, outside the transaction):');
  check('leaderboard_names exposes exactly 2 columns', String(s.names_out_cols) === '2', s.names_out_cols);
  check('leaderboard_names exposes NO email', String(s.names_has_email) === '0', s.names_has_email);
  check('stamp_scan is not anon-executable', s.stamp_anon === '-', s.stamp_anon);
  check('user_tiers has security_invoker=on',
    String(s.user_tiers_opts).includes('security_invoker=on'), s.user_tiers_opts);

  console.log(`\n${pass} passed, ${fail} failed (nothing committed — the transaction rolled back)`);
  process.exit(fail ? 1 : 0);
})();
