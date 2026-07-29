// 0100 proof: shop_orders_self_update_guard.
//
// The ATTACKS it must block (all measured as ACCEPTED before the guard):
//   * a buyer zeroing total / subtotal / fee on their own pending order
//   * a buyer writing admin_note (a staff-facing field)
//   * a buyer forging a timeline entry attributed to "admin"
//   * a buyer rewriting or truncating existing timeline history
//   * a buyer reassigning pickup_batch_id / is_preorder / buyer_id
//
// The FLOWS it must NOT break — this half matters more than the half above,
// because a guard that breaks checkout is worse than the hole it closes. Each
// mirrors a real call site in src/js/shop/api.js:
//   * enrichNewOrder    → buyer_phone + slips, right after placing
//   * addOrderSlip      → slips, slip_url, slip_uploaded_at, status, timeline
//   * removeOrderSlip   → same fields, dropping back to pending
//   * a shop admin still writes everything (totals, admin_note, status)
//   * a server context (null auth.uid) is untouched
//
// SELF-PROVISIONING + NON-DESTRUCTIVE: one Management-API call = one implicit
// transaction, ending in ROLLBACK. Nothing is left behind; no live order is
// read or written.
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

const ID = 'ORD-TST100';

const SQL = `
begin;
create temp table out(k text, v text);
do $$ begin
  execute format('grant usage on schema %s to authenticated', pg_my_temp_schema()::regnamespace);
  execute 'grant select, insert on out to authenticated';
end $$;

do $$
declare
  v_buyer uuid; v_admin uuid;
  v_total numeric; v_note text; v_status text; v_tl jsonb; v_phone text;
  function_result text;
begin
  select id into v_buyer from public.users where coalesce(role,'user')='user' limit 1;
  select id into v_admin from public.users
   where role in ('shop_admin','dev') or 'samoshop' = any(coalesce(permissions,'{}'))
   order by role limit 1;
  insert into out values('setup', 'buyer=' || v_buyer || ' admin=' || coalesce(v_admin::text,'(none)'));

  insert into public.shop_orders (id, buyer_id, status, subtotal, fee, total, buyer_label, timeline)
  values ('${ID}', v_buyer, 'pending', 500, 20, 520, 'probe',
          jsonb_build_array(jsonb_build_object('stage','pending','label','รอชำระเงิน')));

  perform set_config('role','authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_buyer, 'role','authenticated')::text, true);

  ---------------- ATTACKS ----------------
  begin
    update public.shop_orders set total=0, subtotal=0, fee=0 where id='${ID}';
    insert into out values('atk_money','ACCEPTED');
  exception when others then insert into out values('atk_money','blocked'); end;

  begin
    update public.shop_orders set admin_note='PAID IN FULL - verified by staff' where id='${ID}';
    insert into out values('atk_admin_note','ACCEPTED');
  exception when others then insert into out values('atk_admin_note','blocked'); end;

  begin
    update public.shop_orders set timeline = coalesce(timeline,'[]'::jsonb) ||
      jsonb_build_object('by','admin','stage','paid','label','ชำระเงินแล้ว') where id='${ID}';
    insert into out values('atk_forge_timeline','ACCEPTED');
  exception when others then insert into out values('atk_forge_timeline','blocked'); end;

  begin
    update public.shop_orders set timeline='[]'::jsonb where id='${ID}';
    insert into out values('atk_erase_timeline','ACCEPTED');
  exception when others then insert into out values('atk_erase_timeline','blocked'); end;

  begin
    update public.shop_orders set pickup_batch_id='x', is_preorder=true where id='${ID}';
    insert into out values('atk_reassign','ACCEPTED');
  exception when others then insert into out values('atk_reassign','blocked'); end;

  ---------------- LEGITIMATE BUYER FLOWS ----------------
  -- enrichNewOrder: buyer_phone + slips
  begin
    update public.shop_orders
       set buyer_phone='0812345678',
           slips = jsonb_build_array(jsonb_build_object('url','https://x/s1','at','2026-07-29T00:00:00Z'))
     where id='${ID}';
    insert into out values('flow_enrich','OK');
  exception when others then insert into out values('flow_enrich','FAILED: '||sqlerrm); end;

  -- addOrderSlip: slips + slip_url + slip_uploaded_at + status + timeline
  begin
    update public.shop_orders
       set slips = coalesce(slips,'[]'::jsonb) ||
                   jsonb_build_object('url','https://x/s2','at','2026-07-29T01:00:00Z'),
           slip_url='https://x/s2', slip_uploaded_at=now(), status='review',
           timeline = coalesce(timeline,'[]'::jsonb) ||
                      jsonb_build_object('stage','review','at','2026-07-29T01:00:00Z',
                                         'label','ส่งสลิปแล้ว — รอตรวจ')
     where id='${ID}';
    insert into out values('flow_add_slip','OK');
  exception when others then insert into out values('flow_add_slip','FAILED: '||sqlerrm); end;

  -- removeOrderSlip: back to pending with a timeline note
  begin
    update public.shop_orders
       set slips='[]'::jsonb, slip_url=null, slip_uploaded_at=null, status='pending',
           timeline = coalesce(timeline,'[]'::jsonb) ||
                      jsonb_build_object('stage','pending','at','2026-07-29T02:00:00Z',
                                         'label','ลบสลิปแล้ว — รอชำระเงิน')
     where id='${ID}';
    insert into out values('flow_remove_slip','OK');
  exception when others then insert into out values('flow_remove_slip','FAILED: '||sqlerrm); end;

  perform set_config('role','postgres', true);
  perform set_config('request.jwt.claims', null, true);

  select total, admin_note, status, timeline, buyer_phone
    into v_total, v_note, v_status, v_tl, v_phone
    from public.shop_orders where id='${ID}';
  insert into out values('final', format('total=%s admin_note=%L status=%s tl_len=%s phone=%L',
    v_total, v_note, v_status, jsonb_array_length(v_tl), v_phone));

  ---------------- ADMIN + SERVER CONTEXT ----------------
  if v_admin is not null then
    perform set_config('role','authenticated', true);
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_admin, 'role','authenticated')::text, true);
    begin
      update public.shop_orders
         set total=999, admin_note='admin still writes', status='paid',
             timeline = coalesce(timeline,'[]'::jsonb) ||
                        jsonb_build_object('by','admin','stage','paid','label','ตรวจสอบแล้ว')
       where id='${ID}';
      insert into out values('admin_unaffected','OK');
    exception when others then insert into out values('admin_unaffected','FAILED: '||sqlerrm); end;
    perform set_config('role','postgres', true);
    perform set_config('request.jwt.claims', null, true);
  else
    insert into out values('admin_unaffected','OK (no admin user to test)');
  end if;

  begin
    update public.shop_orders set total=1234, admin_note='server write' where id='${ID}';
    insert into out values('server_unaffected','OK');
  exception when others then insert into out values('server_unaffected','FAILED: '||sqlerrm); end;
end $$;

select * from out;
rollback;
`;

async function main() {
  console.log('project', REF, '— 0100 shop_orders buyer column guard\n');
  const r = await mgmt(SQL);
  if (r.status >= 400) { console.log('SQL ERROR', JSON.stringify(r.body)); process.exit(1); }
  const rows = Array.isArray(r.body) ? r.body.flat().filter((x) => x && x.k) : [];
  if (!rows.length) { console.log('no output', JSON.stringify(r.body).slice(0, 400)); process.exit(1); }
  const get = (k) => rows.find((x) => x.k === k)?.v ?? '';
  console.log(' ', get('setup'), '\n');

  console.log('ATTACKS — a buyer must not touch money or staff fields');
  check('cannot zero total / subtotal / fee', get('atk_money') === 'blocked');
  check('cannot write admin_note', get('atk_admin_note') === 'blocked');
  check('cannot forge a timeline entry attributed to admin',
    get('atk_forge_timeline') === 'blocked');
  check('cannot erase timeline history', get('atk_erase_timeline') === 'blocked');
  check('cannot reassign pickup batch / preorder flag', get('atk_reassign') === 'blocked');

  console.log('\nLEGITIMATE BUYER FLOWS — nothing may regress');
  check('enrichNewOrder (buyer_phone + slips)', get('flow_enrich') === 'OK', get('flow_enrich'));
  check('addOrderSlip (slip + status review + timeline)',
    get('flow_add_slip') === 'OK', get('flow_add_slip'));
  check('removeOrderSlip (back to pending + timeline)',
    get('flow_remove_slip') === 'OK', get('flow_remove_slip'));
  const fin = get('final');
  check('the order still holds its real price after all of it',
    fin.includes('total=520'), fin);
  check('admin_note was never written by the buyer',
    /admin_note=NULL/.test(fin) || /admin_note=''/.test(fin), fin);

  console.log('\nEVERYONE ELSE — unaffected');
  check('a shop admin still writes every column',
    get('admin_unaffected').startsWith('OK'), get('admin_unaffected'));
  check('a server context (null auth.uid) is unaffected',
    get('server_unaffected') === 'OK', get('server_unaffected'));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
main();
