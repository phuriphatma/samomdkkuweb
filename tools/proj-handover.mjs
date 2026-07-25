// หนังสือโครงการ — hand a shared account's state over to a personal one.
//
// WHY THIS EXISTS
// The workflow accounts (sastaff / samomdkkuvpa / saprof) are being migrated to
// personal @kkumail.com logins granted through ทีม SAMO. Granting the seat moves
// the *authorization*, but three things are bound to the OLD account's uid and do
// not follow:
//
//   1. project_doc_views      — read state. Without it the new account either
//                               sees the entire history as unread, or (after the
//                               first-run baseline) sees NOTHING as unread while
//                               the shared account still shows "N อัปเดต".
//   2. project_sign_requests  — a signature request names ONE prof_id. A migrated
//      .prof_id                 อาจารย์ account sees an EMPTY inbox, because
//                               scopeProjectsForRole() keeps only documents with a
//                               sign_request addressed to the viewer, and
//                               docPendingSignForProf() ("N รอลงนาม") matches the
//                               same uid.
//   3. project_notifications  — the bell. Rows name a recipient uid.
//      .user_id
//
// READ STATE IS REPLACED, NOT MERGED. Parity means the target ends up with
// exactly the source's rows: a document the source has never opened must have NO
// row on the target either, or its "อัปเดต" badge stays hidden. So the target's
// rows for the shared doc set are deleted first. That is deliberate and is why
// this is a tool with a dry run rather than something the app does silently.
//
// USAGE
//   node tools/proj-handover.mjs --from sastaff@samomdkku.app --to me@kkumail.com
//        (dry run — prints what would change, writes nothing)
//   node tools/proj-handover.mjs --from … --to … --apply
//   node tools/proj-handover.mjs --from … --to … --apply --notifications
//   node tools/proj-handover.mjs --from … --to … --apply --sign-requests
//
// --sign-requests MOVES the signature workload off the source account (it is a
// repoint, not a copy — a request has one prof). Only pass it when the source
// อาจารย์ account is actually being retired.
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };

const FROM = opt('--from');
const TO = opt('--to');
const APPLY = flag('--apply');
const DO_NOTIFS = flag('--notifications');
const DO_SIGN = flag('--sign-requests');

if (!FROM || !TO) {
  console.error('usage: node tools/proj-handover.mjs --from <email> --to <email> [--apply] [--notifications] [--sign-requests]');
  process.exit(1);
}

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n').filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')]; }));
const REF = env.VITE_SUPABASE_URL.match(/https:\/\/([^.]+)\.supabase\.co/)[1];
const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;

async function mgmt(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const body = await r.json().catch(() => null);
  if (r.status >= 400) throw new Error(`SQL ${r.status}: ${body?.message || JSON.stringify(body)}`);
  return Array.isArray(body) ? body.flat().filter((x) => x && typeof x === 'object') : [];
}

async function main() {
  console.log(`project ${REF}`);
  console.log(`handover: ${FROM}  →  ${TO}`);
  console.log(APPLY ? 'mode: APPLY (writes)\n' : 'mode: DRY RUN (writes nothing — pass --apply)\n');

  const ids = await mgmt(`
    select (select id from public.users where email = ${lit(FROM)}) as from_id,
           (select id from public.users where email = ${lit(TO)})   as to_id;`);
  const fromId = ids[0]?.from_id;
  const toId = ids[0]?.to_id;
  if (!fromId) throw new Error(`no such user: ${FROM}`);
  if (!toId) throw new Error(`no such user: ${TO}`);
  if (fromId === toId) throw new Error('--from and --to are the same account');

  // ---- 1. read state ----
  const before = await mgmt(`
    select (select count(*) from public.project_doc_views where user_id = ${lit(fromId)}) as source_rows,
           (select count(*) from public.project_doc_views where user_id = ${lit(toId)})   as target_rows;`);
  console.log(`read state : source has ${before[0].source_rows} doc-view rows, target has ${before[0].target_rows}`);

  // Documents where the SOURCE still has unseen activity — these are the
  // "N อัปเดต" badges the target should end up showing too.
  const unseen = await mgmt(`
    select d.id
      from public.project_documents d
      left join public.project_doc_views v on v.document_id = d.id and v.user_id = ${lit(fromId)}
     where (select count(*) from jsonb_array_elements(d.timeline) e
             where (e->>'at')::timestamptz > coalesce(v.seen_at, '-infinity'::timestamptz)) > 0
     order by d.id;`);
  console.log(`           : ${unseen.length} document(s) carry unread activity for the source`);
  if (unseen.length) console.log(`           : ${unseen.map((r) => r.id).join(', ')}`);

  if (APPLY) {
    // Replace, don't merge — see the header note.
    await mgmt(`
      delete from public.project_doc_views where user_id = ${lit(toId)};
      insert into public.project_doc_views (user_id, document_id, seen_at)
      select ${lit(toId)}, document_id, seen_at
        from public.project_doc_views where user_id = ${lit(fromId)}
      on conflict (user_id, document_id) do update set seen_at = excluded.seen_at;`);
    const after = await mgmt(
      `select count(*) as n from public.project_doc_views where user_id = ${lit(toId)};`);
    console.log(`           ✓ replaced — target now has ${after[0].n} rows (mirrors the source)`);
  }

  // ---- 2. notifications (opt-in) ----
  const notifs = await mgmt(`
    select count(*) filter (where user_id = ${lit(fromId)}) as source_all,
           count(*) filter (where user_id = ${lit(fromId)} and not is_read) as source_unread,
           count(*) filter (where user_id = ${lit(toId)})   as target_all
      from public.project_notifications;`);
  console.log(`bell       : source ${notifs[0].source_all} (${notifs[0].source_unread} unread), target ${notifs[0].target_all}`
    + (DO_NOTIFS ? '' : '   [skipped — pass --notifications]'));
  if (APPLY && DO_NOTIFS) {
    // COPY, not move: the shared account stays usable during the transition.
    await mgmt(`
      insert into public.project_notifications
        (user_id, kind, project_id, document_id, title, body, is_read, created_at)
      select ${lit(toId)}, n.kind, n.project_id, n.document_id, n.title, n.body, n.is_read, n.created_at
        from public.project_notifications n
       where n.user_id = ${lit(fromId)}
         and not exists (
           select 1 from public.project_notifications x
            where x.user_id = ${lit(toId)} and x.kind = n.kind
              and x.document_id is not distinct from n.document_id
              and x.created_at = n.created_at);`);
    const after = await mgmt(
      `select count(*) as n from public.project_notifications where user_id = ${lit(toId)};`);
    console.log(`           ✓ copied — target now has ${after[0].n} notification rows`);
  }

  // ---- 3. signature workload (opt-in, and it MOVES) ----
  const sign = await mgmt(`
    select count(*) as total, count(*) filter (where status = 'pending') as pending
      from public.project_sign_requests where prof_id = ${lit(fromId)};`);
  console.log(`signatures : source holds ${sign[0].total} request(s), ${sign[0].pending} pending`
    + (DO_SIGN ? '' : '   [skipped — pass --sign-requests]'));
  if (!DO_SIGN && Number(sign[0].total) > 0) {
    console.log('           ! until these are repointed, the target อาจารย์ account sees an EMPTY');
    console.log('             inbox for them — scopeProjectsForRole keeps only documents whose');
    console.log('             sign_request names the viewer.');
  }
  if (APPLY && DO_SIGN) {
    await mgmt(`update public.project_sign_requests
                   set prof_id = ${lit(toId)} where prof_id = ${lit(fromId)};`);
    const after = await mgmt(
      `select count(*) as n from public.project_sign_requests where prof_id = ${lit(toId)};`);
    console.log(`           ✓ moved — target now holds ${after[0].n} signature request(s)`);
  }

  console.log(APPLY ? '\ndone.' : '\nnothing written. re-run with --apply to commit.');
}
main().catch((e) => { console.error('\nFAILED:', e.message); process.exit(1); });
