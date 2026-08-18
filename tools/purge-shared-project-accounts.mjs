#!/usr/bin/env node
// ============================================================
// purge-shared-project-accounts.mjs — retire the last two SHARED
// password logins in the หนังสือโครงการ workflow (`sastaff`, `saprof`) and
// hand their work to the real people who already hold the same seat.
//
// WHY. Both accounts are `<name>@samomdkku.app` synthetic-email logins with a
// password several people know, and both are now redundant: the ทีม SAMO tree
// already grants the SAME capability to a named person by seat —
//   sastaff (role uni_staff) → whoever holds project_seat 'staff'  (เจ้าหน้าที่คณะ)
//   saprof  (role sa_prof)   → whoever holds project_seat 'prof'   (อาจารย์)
// and every RLS policy on every project_* table asks a seat-aware helper
// (current_user_is_project_actor / _is_project_uni_staff / _is_prof), never
// the role alone. So the seat holder can already do everything the shared
// account could; the shared password is pure exposure. This finishes the
// 2026-08-17 purge, which kept these two.
//
// ORDER MATTERS. Reassign FIRST, delete SECOND. Nine of the FKs into
// public.users are ON DELETE SET NULL, so deleting first would silently
// orphan the rows instead of failing — the attribution would be gone with no
// error to notice.
//
// WHAT IS NOT REASSIGNED, deliberately: `project_documents.timeline` /
// `project_sign_requests.timeline` embed the actor uid as `by`. The UI
// renders the ROLE label from the same entry and never the person, so a
// dangling uid is invisible there; `by` is only compared against the viewer's
// own id to decide "may I edit this comment". Rewriting history to say
// someone did something they did not do is worse than the two people no
// longer being able to edit an old shared-account comment. The 2026-08-17
// purge left timelines alone for the same reason.
//
//   node tools/purge-shared-project-accounts.mjs           # dry run (default)
//   CONFIRM=1 node tools/purge-shared-project-accounts.mjs # actually do it
// ============================================================
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n').filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')]; }));
const PAT = env.SUPABASE_ACCESS_TOKEN;
const REF = (env.VITE_SUPABASE_URL || '').match(/https:\/\/([^.]+)\.supabase\.co/)?.[1];
if (!PAT || !REF) { console.error('need VITE_SUPABASE_URL + SUPABASE_ACCESS_TOKEN in .env.local'); process.exit(1); }

const CONFIRM = process.env.CONFIRM === '1';

async function sql(q) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${PAT}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: q }),
  });
  const body = await r.json().catch(() => null);
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${JSON.stringify(body)}`);
  return Array.isArray(body) ? body : [];
}

// The account to retire, and the SEAT whose holder inherits its work.
// The successor is resolved LIVE from the seat, never hardcoded: a proof or
// a script whose subject is a name rots the day that person changes, and this
// repo has been bitten by exactly that (docs/mistakes/tooling-proofs.md).
const RETIRE = [
  { email: 'sastaff@samomdkku.app', role: 'uni_staff', seat: 'staff', th: 'เจ้าหน้าที่คณะ' },
  { email: 'saprof@samomdkku.app',  role: 'sa_prof',   seat: 'prof',  th: 'อาจารย์' },
];

/** Every place a uid can be attached to project work. The SET-NULL columns
 *  first (attribution), then the CASCADE ones (per-person state). */
const REASSIGN = [
  { t: 'project_files',         c: 'uploaded_by',  kind: 'attribution' },
  { t: 'project_sign_requests', c: 'requested_by', kind: 'attribution' },
  { t: 'project_sign_requests', c: 'prof_id',      kind: 'attribution' },
  { t: 'project_documents',     c: 'created_by',   kind: 'attribution' },
  { t: 'projects',              c: 'created_by',   kind: 'attribution' },
  { t: 'announcements',         c: 'created_by',   kind: 'attribution' },
  { t: 'pr_tickets',            c: 'submitter_id', kind: 'attribution' },
  { t: 'vs_tickets',            c: 'submitter_id', kind: 'attribution' },
  { t: 'shop_orders',           c: 'buyer_id',     kind: 'attribution' },
  { t: 'team_members',          c: 'user_id',      kind: 'attribution' },
];

async function resolveSuccessor(seat) {
  // role OR seat, the same union list_project_seat_users() uses — so this
  // finds the successor by the same rule the app addresses them by.
  const rows = await sql(`
    select u.id, u.email, u.display_name
      from public.users u
     where '${seat}' = any (coalesce(u.managed_project_seats, '{}'))
       and u.email not like '%@samomdkku.app'
     order by u.email`);
  return rows;
}

async function main() {
  console.log(`project ${REF}   ${CONFIRM ? '*** LIVE RUN ***' : '(dry run — set CONFIRM=1 to apply)'}\n`);

  const plan = [];
  for (const acct of RETIRE) {
    const [me] = await sql(`select id, email, role from public.users where email = '${acct.email}'`);
    if (!me) { console.log(`· ${acct.email} — already gone, nothing to do\n`); continue; }

    const heirs = await resolveSuccessor(acct.seat);
    if (heirs.length !== 1) {
      console.error(`✗ ${acct.email}: the '${acct.seat}' seat resolves to ${heirs.length} people`);
      console.error(`  ${heirs.map((h) => h.email).join(', ') || '(nobody)'}`);
      console.error(`  Refusing to guess. Give exactly one person the ${acct.th} seat in ทีม SAMO first.`);
      process.exit(1);
    }
    const heir = heirs[0];

    console.log(`· ${acct.email}  (role ${me.role})`);
    console.log(`  → ${heir.email}  ${heir.display_name || ''}   [seat '${acct.seat}' = ${acct.th}]`);

    let total = 0;
    for (const r of REASSIGN) {
      const [{ n }] = await sql(`select count(*)::int as n from public.${r.t} where ${r.c} = '${me.id}'`);
      if (n > 0) { console.log(`    ${n.toString().padStart(4)}  ${r.t}.${r.c}`); total += n; }
    }
    const [{ n: views }] = await sql(`select count(*)::int as n from public.project_doc_views where user_id = '${me.id}'`);
    const [{ n: notifs }] = await sql(`select count(*)::int as n from public.project_notifications where user_id = '${me.id}'`);
    if (views)  console.log(`    ${String(views).padStart(4)}  project_doc_views.user_id      (merged, newest seen_at wins)`);
    if (notifs) console.log(`    ${String(notifs).padStart(4)}  project_notifications.user_id  (moved)`);
    console.log(`    ${String(total + views + notifs).padStart(4)}  TOTAL\n`);

    plan.push({ acct, me, heir });
  }

  if (!CONFIRM) { console.log('Dry run only. Re-run with CONFIRM=1 to apply.'); return; }
  if (plan.length === 0) { console.log('Nothing to do.'); return; }

  for (const { acct, me, heir } of plan) {
    const stmts = REASSIGN.map((r) =>
      `update public.${r.t} set ${r.c} = '${heir.id}' where ${r.c} = '${me.id}';`);

    // project_doc_views is (user_id, document_id) PK — a straight UPDATE would
    // 23505 on any doc the heir has ALSO opened. Merge instead, keeping the
    // LATER seen_at: taking the earlier one would resurrect the whole backlog
    // as unread for them (docs/mistakes/app-state.md).
    stmts.push(`
      insert into public.project_doc_views (user_id, document_id, seen_at)
      select '${heir.id}', v.document_id, v.seen_at
        from public.project_doc_views v
       where v.user_id = '${me.id}'
      on conflict (user_id, document_id)
      do update set seen_at = greatest(public.project_doc_views.seen_at, excluded.seen_at);`);
    stmts.push(`delete from public.project_doc_views where user_id = '${me.id}';`);

    // Notifications have a surrogate pk, so a plain move is safe.
    stmts.push(`update public.project_notifications set user_id = '${heir.id}' where user_id = '${me.id}';`);

    // Only now is it safe to delete: every SET-NULL column must be empty
    // first, or the attribution silently becomes NULL instead of erroring.
    stmts.push(`
      do $$
      declare n int;
      begin
        select count(*) into n from public.project_files where uploaded_by = '${me.id}';
        if n > 0 then raise exception 'project_files still references %', '${me.id}'; end if;
        select count(*) into n from public.project_sign_requests
          where requested_by = '${me.id}' or prof_id = '${me.id}';
        if n > 0 then raise exception 'project_sign_requests still references %', '${me.id}'; end if;
      end $$;`);

    stmts.push(`delete from public.users where id = '${me.id}';`);
    stmts.push(`delete from auth.users where id = '${me.id}';`);

    console.log(`applying ${acct.email} → ${heir.email} …`);
    await sql(`begin;\n${stmts.join('\n')}\ncommit;`);
    console.log('  done');
  }

  // Verify from the AUTHORITY, not from the statements just sent.
  console.log('\nverifying …');
  const left = await sql(`
    select email from public.users where email in (${RETIRE.map((a) => `'${a.email}'`).join(',')})
    union all
    select email from auth.users where email in (${RETIRE.map((a) => `'${a.email}'`).join(',')})`);
  if (left.length) { console.error('✗ still present:', left.map((r) => r.email).join(', ')); process.exit(1); }
  const roles = await sql(`select role, count(*)::int as n from public.users where role <> 'user' group by role order by role`);
  console.log('✓ both accounts gone. Remaining non-user roles:',
    roles.map((r) => `${r.role}=${r.n}`).join(', ') || '(none)');
}

main().catch((e) => { console.error(e.message); process.exit(1); });
