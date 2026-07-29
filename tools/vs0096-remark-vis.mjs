// 0096 proof: the บันทึกข้อความ visibility ladder + the vs_tickets column guard.
//
// Proves, against a throwaway duplicate group (canonical A + duplicate B) and a
// synthetic student who submits B:
//
//   LADDER
//     * 'staff'  remarks never leave the staff read
//     * 'ticket' remarks reach that ticket's submitter only
//     * 'thread' remarks written on A reach B's submitter too
//     * 'public' remarks reach the board's `updates` stream (and the thread)
//     * a confidential canonical still publishes NOTHING
//
//   READ-PATH PARITY (the 0074 lesson — sanitize EVERY path, not one)
//     * get_my_vs_tickets()   — no staff-only remark, no duplicate_of
//     * get_vs_ticket_by_id() — same, plus tags blanked (0080)
//
//   COLUMN GUARD (vs_tickets_self_update_guard)
//     * a submitter CANNOT self-publish to the public board  ← the live bug
//     * cannot self-close, reroute, retag, or re-link as a duplicate
//     * cannot forge vis/author on an appended remark, or rewrite history
//     * CAN still append an ordinary reply (nothing regressed)
//     * staff and server contexts are unaffected
//
// SELF-PROVISIONING + NON-DESTRUCTIVE: every check runs inside ONE Management-
// API call — one implicit transaction — ending in ROLLBACK. Nothing is left
// behind and the live config is never mutated.
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
  else { fail++; console.log('  FAIL', name, String(extra).slice(0, 260)); }
};

async function mgmt(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${PAT}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  return { status: r.status, body: await r.json().catch(() => null) };
}

const A = 'VS-TST96A';   // canonical, published to the board
const B = 'VS-TST96B';   // duplicate of A, submitted by the synthetic student

// One transaction: seed → assert → rollback. Every assertion is collected into
// a temp table and emitted by the single trailing SELECT (the Management API
// returns only the last row-producing statement).
const SQL = `
begin;
create temp table out(k text, v text);
-- The assertions below run under set_config('role', …); the temp table has to
-- be writable from those roles too (temp schema name is per-session).
do $$ begin
  execute format('grant usage on schema %s to authenticated, anon',
                 pg_my_temp_schema()::regnamespace);
  execute 'grant select, insert on out to authenticated, anon';
end $$;

do $$
declare
  v_student uuid;
  v_staff   uuid;
  r         text;
  r2        text;
  j         jsonb;
  n         integer;
begin
  select id into v_staff from public.users
   where role in ('vs_staff','dev') order by role limit 1;
  select id into v_student from public.users
   where coalesce(role,'user') = 'user' and id <> v_staff limit 1;
  if v_student is null then
    insert into out values('setup','no non-staff user'); return;
  end if;
  insert into out values('setup', 'staff=' || v_staff || ' student=' || v_student);

  ------------------------------------------------------------------
  -- Seed: A (canonical, public) + B (duplicate, submitted by student)
  ------------------------------------------------------------------
  delete from public.vs_tickets where id in ('${A}','${B}');
  insert into public.vs_tickets (id, problem, target_dept, status, category,
                                 created_at, is_public, public_title, submitter_id)
  values ('${A}', 'raw canonical text SECRET-A', 'SE', 'สโมกำลังดำเนินการ', 'it',
          now(), true, 'แอร์เสียชั้น 4', null),
         ('${B}', 'raw duplicate text SECRET-B', 'SE', 'สโมกำลังดำเนินการ', 'it',
          now(), false, null, v_student);
  update public.vs_tickets set duplicate_of = '${A}' where id = '${B}';

  -- Staff notes on A, one at each rung of the ladder.
  update public.vs_tickets set remarks = jsonb_build_array(
      jsonb_build_object('type','log','by','SE','time','01/01, 00:00',
        'at','2026-07-29T01:00:00Z','vis','staff',  'text','STAFF-ONLY internal note ${A}'),
      jsonb_build_object('type','remark','by','SE','time','01/01, 00:01',
        'at','2026-07-29T01:01:00Z','vis','ticket', 'text','TICKET-ONLY note for A'),
      jsonb_build_object('type','remark','by','SE','time','01/01, 00:02',
        'at','2026-07-29T01:02:00Z','vis','thread', 'text','THREAD note for the group'),
      jsonb_build_object('type','remark','by','SE','time','01/01, 00:03',
        'at','2026-07-29T01:03:00Z','vis','public', 'text','PUBLIC progress update'))
   where id = '${A}';
  -- A legacy-shaped internal remark on B (0071 merge trail: names A's id).
  update public.vs_tickets set remarks = jsonb_build_array(
      jsonb_build_object('type','log','by','ระบบ','time','01/01, 00:00',
        'internal', true, 'text','รวมเป็นเรื่องซ้ำของ ${A}'))
   where id = '${B}';

  ------------------------------------------------------------------
  -- LADDER — what B's submitter sees
  ------------------------------------------------------------------
  perform set_config('role','authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_student, 'role','authenticated')::text, true);

  j := public.get_my_vs_tickets();
  insert into out values('my_count', jsonb_array_length(j)::text);
  insert into out values('my_remarks', coalesce((j -> 0 -> 'remarks')::text, 'null'));

  select coalesce(x.remarks::text, 'null'), coalesce(x.duplicate_of, 'NULL')
    into r, r2
    from public.get_vs_ticket_by_id('${B}') x limit 1;
  insert into out values('byid_remarks', coalesce(r, 'null')),
                        ('byid_dupof',   coalesce(r2, 'NULL'));

  ------------------------------------------------------------------
  -- COLUMN GUARD — as B's submitter
  ------------------------------------------------------------------
  begin
    update public.vs_tickets set is_public = true, public_title = 'SELF-PUBLISHED'
     where id = '${B}';
    insert into out values('guard_self_publish','ACCEPTED');
  exception when others then insert into out values('guard_self_publish','blocked'); end;

  begin
    update public.vs_tickets set status = 'เสร็จสิ้น' where id = '${B}';
    insert into out values('guard_self_close','ACCEPTED');
  exception when others then insert into out values('guard_self_close','blocked'); end;

  begin
    update public.vs_tickets set target_dept = 'อุปนายกฝ่ายวิชาการ' where id = '${B}';
    insert into out values('guard_reroute','ACCEPTED');
  exception when others then insert into out values('guard_reroute','blocked'); end;

  begin
    update public.vs_tickets set tags = array['x'] where id = '${B}';
    insert into out values('guard_retag','ACCEPTED');
  exception when others then insert into out values('guard_retag','blocked'); end;

  begin
    update public.vs_tickets set duplicate_of = null where id = '${B}';
    insert into out values('guard_unlink','ACCEPTED');
  exception when others then insert into out values('guard_unlink','blocked'); end;

  begin
    update public.vs_tickets set remarks = coalesce(remarks,'[]'::jsonb) ||
      jsonb_build_object('type','remark','by','เจ้าหน้าที่','time','x','vis','public','text','forged')
     where id = '${B}';
    insert into out values('guard_forge_public_remark','ACCEPTED');
  exception when others then insert into out values('guard_forge_public_remark','blocked'); end;

  begin
    update public.vs_tickets set remarks = '[]'::jsonb where id = '${B}';
    insert into out values('guard_erase_history','ACCEPTED');
  exception when others then insert into out values('guard_erase_history','blocked'); end;

  -- ...but an ordinary reply through the RPC must still work.
  begin
    perform public.vs_add_submitter_remark('${B}', 'ขอสอบถามความคืบหน้าครับ');
    insert into out values('submitter_reply_rpc','OK');
  exception when others then
    insert into out values('submitter_reply_rpc','FAILED: ' || sqlerrm); end;

  -- ...and a submitter must not reply on someone ELSE's ticket.
  begin
    perform public.vs_add_submitter_remark('${A}', 'not mine');
    insert into out values('reply_on_foreign_ticket','ACCEPTED');
  exception when others then insert into out values('reply_on_foreign_ticket','blocked'); end;

  perform set_config('role','postgres', true);
  perform set_config('request.jwt.claims', null, true);

  ------------------------------------------------------------------
  -- PUBLIC BOARD — updates stream, anon
  ------------------------------------------------------------------
  perform set_config('role','anon', true);
  perform set_config('request.jwt.claims', json_build_object('role','anon')::text, true);
  j := public.get_public_vs_problem('${A}');
  insert into out values('board_updates', coalesce((j -> 'updates')::text,'null'));
  insert into out values('board_detail_raw', coalesce(j::text,'null'));
  select coalesce(sum(b.update_count),0) into n
    from public.get_public_vs_board(null,'new',200) b where b.canonical_id = '${A}';
  insert into out values('board_update_count', n::text);
  perform set_config('role','postgres', true);
  perform set_config('request.jwt.claims', null, true);

  ------------------------------------------------------------------
  -- CONFIDENTIAL canonical publishes nothing, even with a public remark
  ------------------------------------------------------------------
  update public.vs_tickets set category = 'personal' where id = '${A}';
  perform set_config('role','anon', true);
  perform set_config('request.jwt.claims', json_build_object('role','anon')::text, true);
  insert into out values('confidential_detail',
    coalesce(public.get_public_vs_problem('${A}')::text, 'NULL'));
  perform set_config('role','postgres', true);
  perform set_config('request.jwt.claims', null, true);
  update public.vs_tickets set category = 'it' where id = '${A}';

  ------------------------------------------------------------------
  -- 0098 — deleting a หมวดหมู่ must fail CLOSED on every public reader.
  -- vs_tickets.category has no FK, so a delete leaves dangling ids; before
  -- 0098 get_public_vs_problem's coalesce(is_confidential, FALSE) served
  -- them, which un-hid a confidential ticket left at is_public = true.
  ------------------------------------------------------------------
  insert into public.vs_categories (id,label,icon,is_confidential,public_eligible,sort_order)
    values ('tstcat96','probe ความลับ','bi-shield-lock',true,false,999);
  insert into public.vs_tickets (id, problem, target_dept, status, category,
                                 created_at, is_public, public_title)
    values ('VS-TSTC96','ร้องเรียนบุคคล SECRET-CONF','SE','สโมกำลังดำเนินการ','tstcat96',
            now(), true, 'ไม่ควรแสดง');

  perform set_config('role','anon', true);
  perform set_config('request.jwt.claims', json_build_object('role','anon')::text, true);
  insert into out values('conf_before_delete',
    coalesce(public.get_public_vs_problem('VS-TSTC96')->>'public_title','HIDDEN'));
  perform set_config('role','postgres', true);
  perform set_config('request.jwt.claims', null, true);

  delete from public.vs_categories where id = 'tstcat96';

  perform set_config('role','anon', true);
  perform set_config('request.jwt.claims', json_build_object('role','anon')::text, true);
  insert into out values('conf_after_delete',
    coalesce(public.get_public_vs_problem('VS-TSTC96')->>'public_title','HIDDEN'));
  select count(*) into n from public.get_public_vs_board(null,'new',200) b
    where b.canonical_id = 'VS-TSTC96';
  insert into out values('conf_after_delete_on_board', n::text);
  perform set_config('role','postgres', true);
  perform set_config('request.jwt.claims', null, true);

  -- A NON-confidential public problem with a deleted category is likewise
  -- unreachable (the id no longer resolves), while an intact one still works.
  update public.vs_tickets set category = 'it' where id = '${A}';
  perform set_config('role','anon', true);
  perform set_config('request.jwt.claims', json_build_object('role','anon')::text, true);
  insert into out values('intact_category_still_served',
    coalesce(public.get_public_vs_problem('${A}')->>'public_title','HIDDEN'));
  perform set_config('role','postgres', true);
  perform set_config('request.jwt.claims', null, true);

  ------------------------------------------------------------------
  -- STAFF is unaffected by the guard (still writes every column)
  ------------------------------------------------------------------
  perform set_config('role','authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_staff, 'role','authenticated')::text, true);
  begin
    update public.vs_tickets
       set status = 'เสร็จสิ้น', public_note = 'staff still writes freely',
           remarks = coalesce(remarks,'[]'::jsonb) || jsonb_build_object(
             'type','remark','by','SE','vis','public','at','2026-07-29T02:00:00Z',
             'text','staff public note')
     where id = '${A}';
    insert into out values('staff_unaffected','OK');
  exception when others then insert into out values('staff_unaffected','FAILED: ' || sqlerrm); end;
  perform set_config('role','postgres', true);
  perform set_config('request.jwt.claims', null, true);

  ------------------------------------------------------------------
  -- SERVER CONTEXT (null auth.uid()) is unaffected — migrations + tools
  ------------------------------------------------------------------
  begin
    update public.vs_tickets set public_note = 'server write' where id = '${B}';
    insert into out values('server_context_unaffected','OK');
  exception when others then
    insert into out values('server_context_unaffected','FAILED: ' || sqlerrm); end;
end $$;

select * from out;
rollback;
`;

async function main() {
  console.log('project', REF, '— 0096 remark visibility + column guard\n');
  const r = await mgmt(SQL);
  if (r.status >= 400) { console.log('SQL ERROR', JSON.stringify(r.body)); process.exit(1); }
  const rows = Array.isArray(r.body) ? r.body.flat().filter((x) => x && x.k) : [];
  const get = (k) => rows.find((x) => x.k === k)?.v ?? '';
  if (!rows.length) { console.log('no output', JSON.stringify(r.body).slice(0, 400)); process.exit(1); }
  console.log(' ', get('setup'), '\n');

  const my = get('my_remarks');
  const byid = get('byid_remarks');

  console.log('LADDER — what the duplicate\'s submitter sees');
  check('staff-only remark is NOT in the owner read', !my.includes('STAFF-ONLY'), my);
  check('staff-only remark is NOT in the by-id read', !byid.includes('STAFF-ONLY'), byid);
  check("A's ticket-only remark does NOT cross to B", !my.includes('TICKET-ONLY'), my);
  check('thread remark from A DOES reach B', my.includes('THREAD note'), my);
  check('public remark from A DOES reach B', my.includes('PUBLIC progress'), my);
  check('thread entries are tagged from_thread', my.includes('from_thread'), my);
  check('legacy internal:true remark is stripped (the live leak)',
    !my.includes('รวมเป็นเรื่องซ้ำของ') && !byid.includes('รวมเป็นเรื่องซ้ำของ'), my);
  check('by-id read still nulls duplicate_of (0071)', get('byid_dupof') === 'NULL', get('byid_dupof'));
  check('owner read returns the ticket', get('my_count') !== '0', get('my_count'));

  console.log('\nPUBLIC BOARD — progress updates, separate from comments');
  const upd = get('board_updates');
  check('public remark IS in the board updates stream', upd.includes('PUBLIC progress'), upd);
  check('thread remark is NOT public', !upd.includes('THREAD note'), upd);
  check('ticket remark is NOT public', !upd.includes('TICKET-ONLY'), upd);
  check('staff-only remark is NOT public', !upd.includes('STAFF-ONLY'), upd);
  check('board detail leaks no raw problem text',
    !get('board_detail_raw').includes('SECRET-'), get('board_detail_raw'));
  check('board list exposes update_count', get('board_update_count') === '1', get('board_update_count'));
  check('confidential canonical publishes nothing',
    get('confidential_detail') === 'NULL', get('confidential_detail'));

  console.log('\nCATEGORY DELETE (0098) — a dangling category id fails CLOSED');
  check('confidential ticket hidden BEFORE its category is deleted',
    get('conf_before_delete') === 'HIDDEN', get('conf_before_delete'));
  check('…and STILL hidden after the category is deleted',
    get('conf_after_delete') === 'HIDDEN', get('conf_after_delete'));
  check('…and still absent from the board list',
    get('conf_after_delete_on_board') === '0', get('conf_after_delete_on_board'));
  check('a problem with an INTACT category is still served',
    get('intact_category_still_served') !== 'HIDDEN', get('intact_category_still_served'));

  console.log('\nCOLUMN GUARD — vs_tickets_update_owner is row-level only');
  check('submitter CANNOT self-publish to the board', get('guard_self_publish') === 'blocked');
  check('submitter CANNOT self-close', get('guard_self_close') === 'blocked');
  check('submitter CANNOT reroute the dept', get('guard_reroute') === 'blocked');
  check('submitter CANNOT write internal tags', get('guard_retag') === 'blocked');
  check('submitter CANNOT unlink the duplicate', get('guard_unlink') === 'blocked');
  check('submitter CANNOT forge a public remark', get('guard_forge_public_remark') === 'blocked');
  check('submitter CANNOT erase the timeline', get('guard_erase_history') === 'blocked');
  check('submitter CAN still reply (nothing regressed)',
    get('submitter_reply_rpc') === 'OK', get('submitter_reply_rpc'));
  check('submitter CANNOT reply on a foreign ticket',
    get('reply_on_foreign_ticket') === 'blocked');
  check('staff writes are unaffected', get('staff_unaffected') === 'OK', get('staff_unaffected'));
  check('server context (null auth.uid) is unaffected',
    get('server_context_unaffected') === 'OK', get('server_context_unaffected'));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
main();
