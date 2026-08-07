// 0114 proof: per-โครงการ / per-หนังสือ public visibility on หนังสือโครงการ.
//
// BOTH DIRECTIONS, because a probe that can only report "denied" cannot tell a
// working guard from a broken query (docs/mistakes/tooling-proofs.md):
//   ALLOW  — anon still sees a published โครงการ, its published หนังสือ and files
//   DENY   — anon sees neither a hidden โครงการ, nor a hidden หนังสือ, nor the
//            files of either
//   CASCADE— a PUBLISHED หนังสือ inside a HIDDEN โครงการ is still hidden
//   ACTORS — vp_admin / uni_staff / the prof keep seeing everything
//   COLUMN — uni_staff and the prof may still run the workflow but may NOT
//            flip is_public; the vpa seat and vp_admin may
//
// SELF-PROVISIONING + NON-DESTRUCTIVE: one Management-API call = one implicit
// transaction, ending in ROLLBACK. The probe rows it creates never survive it,
// and no live project is read or written.
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

const SQL = `
begin;
create temp table out(k text, v text);
do $$ begin
  execute format('grant usage on schema %s to authenticated', pg_my_temp_schema()::regnamespace);
  execute format('grant usage on schema %s to anon', pg_my_temp_schema()::regnamespace);
  execute 'grant select, insert on out to authenticated, anon';
end $$;

do $$
declare
  v_vpa uuid; v_uni uuid; v_prof uuid;
  n int;
begin
  select id into v_vpa  from public.users where role = 'vp_admin'  limit 1;
  select id into v_uni  from public.users where role = 'uni_staff' limit 1;
  select id into v_prof from public.users where role = 'sa_prof'   limit 1;
  insert into out values('setup', format('vpa=%s uni=%s prof=%s',
    coalesce(v_vpa::text,'(none)'), coalesce(v_uni::text,'(none)'), coalesce(v_prof::text,'(none)')));

  -- Two projects: one published, one hidden. Each carries one published and
  -- one hidden หนังสือ, each หนังสือ one file.
  insert into public.projects (id, name, is_public) values
    ('PRJ-T114-PUB', 'probe published', true),
    ('PRJ-T114-HID', 'probe hidden',    false);

  insert into public.project_documents (id, project_id, type_id, title, sequence_no, status, is_public) values
    ('DOC-T114-PP', 'PRJ-T114-PUB', 'project', 'pub doc in pub project', 1, 'sent', true),
    ('DOC-T114-PH', 'PRJ-T114-PUB', 'project', 'hid doc in pub project', 2, 'sent', false),
    ('DOC-T114-HP', 'PRJ-T114-HID', 'project', 'pub doc in hid project', 1, 'sent', true),
    ('DOC-T114-HH', 'PRJ-T114-HID', 'project', 'hid doc in hid project', 2, 'sent', false);

  -- A signature request so the professor genuinely "can see" DOC-T114-PH —
  -- a hidden หนังสือ he was asked to sign. Without it every prof result is
  -- an empty-set, which proves nothing.
  if v_prof is not null then
    insert into public.project_sign_requests (id, document_id, prof_id, status)
    values ('SGN-T114', 'DOC-T114-PH', v_prof, 'pending');
  end if;

  insert into public.project_files (document_id, file_name, drive_view_url) values
    ('DOC-T114-PP', 'pp.pdf', 'https://drive/pp'),
    ('DOC-T114-PH', 'ph.pdf', 'https://drive/ph'),
    ('DOC-T114-HP', 'hp.pdf', 'https://drive/hp'),
    ('DOC-T114-HH', 'hh.pdf', 'https://drive/hh');

  ---------------- ANON: what the public site sees ----------------
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claims', json_build_object('role','anon')::text, true);

  select count(*) into n from public.projects where id = 'PRJ-T114-PUB';
  insert into out values('anon_sees_pub_project', n::text);
  select count(*) into n from public.projects where id = 'PRJ-T114-HID';
  insert into out values('anon_sees_hid_project', n::text);

  select count(*) into n from public.project_documents where id = 'DOC-T114-PP';
  insert into out values('anon_doc_pp', n::text);
  select count(*) into n from public.project_documents where id = 'DOC-T114-PH';
  insert into out values('anon_doc_ph', n::text);
  select count(*) into n from public.project_documents where id = 'DOC-T114-HP';
  insert into out values('anon_doc_hp', n::text);
  select count(*) into n from public.project_documents where id = 'DOC-T114-HH';
  insert into out values('anon_doc_hh', n::text);

  select count(*) into n from public.project_files where document_id = 'DOC-T114-PP';
  insert into out values('anon_file_pp', n::text);
  select count(*) into n from public.project_files where document_id = 'DOC-T114-PH';
  insert into out values('anon_file_ph', n::text);
  select count(*) into n from public.project_files where document_id = 'DOC-T114-HP';
  insert into out values('anon_file_hp', n::text);
  select count(*) into n from public.project_files where document_id = 'DOC-T114-HH';
  insert into out values('anon_file_hh', n::text);

  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', null, true);

  ---------------- ACTORS: nothing may disappear for staff ----------------
  if v_vpa is not null then
    perform set_config('role', 'authenticated', true);
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_vpa, 'role','authenticated')::text, true);
    select count(*) into n from public.projects where id like 'PRJ-T114-%';
    insert into out values('vpa_projects', n::text);
    select count(*) into n from public.project_documents where id like 'DOC-T114-%';
    insert into out values('vpa_docs', n::text);
    select count(*) into n from public.project_files where document_id like 'DOC-T114-%';
    insert into out values('vpa_files', n::text);
    -- and the sender may flip the flag on both tables
    begin
      update public.projects set is_public = false where id = 'PRJ-T114-PUB';
      update public.projects set is_public = true  where id = 'PRJ-T114-PUB';
      insert into out values('vpa_may_publish_project', 'OK');
    exception when others then insert into out values('vpa_may_publish_project', 'FAILED: '||sqlerrm); end;
    begin
      update public.project_documents set is_public = false where id = 'DOC-T114-PP';
      update public.project_documents set is_public = true  where id = 'DOC-T114-PP';
      insert into out values('vpa_may_publish_doc', 'OK');
    exception when others then insert into out values('vpa_may_publish_doc', 'FAILED: '||sqlerrm); end;
    perform set_config('role', 'postgres', true);
    perform set_config('request.jwt.claims', null, true);
  else
    insert into out values('vpa_projects','(no vp_admin user)');
  end if;

  if v_uni is not null then
    perform set_config('role', 'authenticated', true);
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_uni, 'role','authenticated')::text, true);
    select count(*) into n from public.project_documents where id like 'DOC-T114-%';
    insert into out values('uni_docs', n::text);
    -- the workflow must keep working …
    begin
      update public.project_documents set status = 'received', received_at = now()
       where id = 'DOC-T114-PP';
      insert into out values('uni_workflow', 'OK');
    exception when others then insert into out values('uni_workflow', 'FAILED: '||sqlerrm); end;
    -- … but publishing is not theirs
    begin
      update public.project_documents set is_public = false where id = 'DOC-T114-PP';
      insert into out values('uni_publish_doc', 'ACCEPTED');
    exception when others then insert into out values('uni_publish_doc', 'blocked'); end;
    begin
      update public.projects set is_public = false where id = 'PRJ-T114-PUB';
      insert into out values('uni_publish_project', 'ACCEPTED');
    exception when others then insert into out values('uni_publish_project', 'blocked'); end;
    perform set_config('role', 'postgres', true);
    perform set_config('request.jwt.claims', null, true);
  else
    insert into out values('uni_docs','(no uni_staff user)');
  end if;

  if v_prof is not null then
    perform set_config('role', 'authenticated', true);
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_prof, 'role','authenticated')::text, true);
    -- He still reads the หนังสือ sent to him even though it is hidden from
    -- the public mirror — the two boundaries are independent.
    select count(*) into n from public.project_documents where id = 'DOC-T114-PH';
    insert into out values('prof_reads_his_doc', n::text);
    -- Commenting (a timeline write) must keep working …
    begin
      update public.project_documents
         set timeline = coalesce(timeline,'[]'::jsonb) ||
                        jsonb_build_object('action','comment','note','probe')
       where id = 'DOC-T114-PH';
      insert into out values('prof_comment', 'OK');
    exception when others then insert into out values('prof_comment', 'FAILED: '||sqlerrm); end;
    -- … and publishing his own หนังสือ to the world must not.
    begin
      update public.project_documents set is_public = true where id = 'DOC-T114-PH';
      insert into out values('prof_publish_doc', 'ACCEPTED');
    exception when others then insert into out values('prof_publish_doc', 'blocked'); end;
    perform set_config('role', 'postgres', true);
    perform set_config('request.jwt.claims', null, true);
  else
    insert into out values('prof_reads_his_doc','(no sa_prof user)');
  end if;

  -- Whatever the attempts above did, the flags must still be the originals.
  select count(*) into n from public.projects
   where id = 'PRJ-T114-PUB' and is_public;
  insert into out values('flag_pub_project_intact', n::text);
  select count(*) into n from public.project_documents
   where id = 'DOC-T114-PP' and is_public;
  insert into out values('flag_pub_doc_intact', n::text);
  select count(*) into n from public.project_documents
   where id = 'DOC-T114-PH' and not is_public;
  insert into out values('flag_hid_doc_intact', n::text);

  ---------------- HELPERS: fail closed on an unknown id ----------------
  insert into out values('helper_unknown_project',
    public.project_is_public('PRJ-DOES-NOT-EXIST')::text);
  insert into out values('helper_unknown_doc',
    public.project_doc_is_public('DOC-DOES-NOT-EXIST')::text);
  insert into out values('helper_cascade_hp',
    public.project_doc_is_public('DOC-T114-HP')::text);
  insert into out values('helper_pp',
    public.project_doc_is_public('DOC-T114-PP')::text);
end $$;

select * from out;
rollback;
`;

async function main() {
  console.log('project', REF, '— 0114 หนังสือโครงการ public visibility\n');
  const r = await mgmt(SQL);
  if (r.status >= 400) { console.log('SQL ERROR', JSON.stringify(r.body)); process.exit(1); }
  const rows = Array.isArray(r.body) ? r.body.flat().filter((x) => x && x.k) : [];
  if (!rows.length) { console.log('no output', JSON.stringify(r.body).slice(0, 400)); process.exit(1); }
  const get = (k) => rows.find((x) => x.k === k)?.v ?? '';
  console.log(' ', get('setup'), '\n');

  console.log('ALLOW — the public mirror still shows what is published');
  check('anon sees a published โครงการ',            get('anon_sees_pub_project') === '1', get('anon_sees_pub_project'));
  check('anon sees a published หนังสือ in it',       get('anon_doc_pp') === '1', get('anon_doc_pp'));
  check('anon sees that หนังสือ\'s file',            get('anon_file_pp') === '1', get('anon_file_pp'));

  console.log('\nDENY — and nothing that was hidden');
  check('a hidden โครงการ is invisible',            get('anon_sees_hid_project') === '0', get('anon_sees_hid_project'));
  check('a hidden หนังสือ is invisible',             get('anon_doc_ph') === '0', get('anon_doc_ph'));
  check('its file is invisible too',               get('anon_file_ph') === '0', get('anon_file_ph'));
  check('every หนังสือ under a hidden โครงการ is invisible',
    get('anon_doc_hh') === '0', get('anon_doc_hh'));

  console.log('\nCASCADE — a published หนังสือ cannot escape a hidden โครงการ');
  check('published หนังสือ in a hidden โครงการ is invisible',
    get('anon_doc_hp') === '0', get('anon_doc_hp'));
  check('…and so are its files',                   get('anon_file_hp') === '0', get('anon_file_hp'));
  check('…and the files of the hidden one',        get('anon_file_hh') === '0', get('anon_file_hh'));
  check('project_doc_is_public() agrees (cascade)', get('helper_cascade_hp') === 'false', get('helper_cascade_hp'));
  check('project_doc_is_public() agrees (allowed)', get('helper_pp') === 'true', get('helper_pp'));

  console.log('\nFAIL CLOSED — an unresolvable id is not "public"');
  check('unknown project id → false',              get('helper_unknown_project') === 'false', get('helper_unknown_project'));
  check('unknown document id → false',             get('helper_unknown_doc') === 'false', get('helper_unknown_doc'));

  console.log('\nACTORS — staff lose nothing');
  check('vp_admin still reads both โครงการ',        get('vpa_projects') === '2', get('vpa_projects'));
  check('vp_admin still reads all four หนังสือ',     get('vpa_docs') === '4', get('vpa_docs'));
  check('vp_admin still reads all four files',     get('vpa_files') === '4', get('vpa_files'));
  check('uni_staff still reads all four หนังสือ',    get('uni_docs') === '4', get('uni_docs'));
  check('uni_staff still runs the workflow',       get('uni_workflow') === 'OK', get('uni_workflow'));
  check('the prof still reads the hidden หนังสือ sent to him',
    get('prof_reads_his_doc') === '1', get('prof_reads_his_doc'));
  check('the prof still comments on it',           get('prof_comment') === 'OK', get('prof_comment'));

  console.log('\nCOLUMN GUARD — only the sender publishes');
  check('vp_admin may publish/unpublish a โครงการ', get('vpa_may_publish_project') === 'OK', get('vpa_may_publish_project'));
  check('vp_admin may publish/unpublish a หนังสือ',  get('vpa_may_publish_doc') === 'OK', get('vpa_may_publish_doc'));
  check('uni_staff may NOT hide a หนังสือ',          get('uni_publish_doc') === 'blocked', get('uni_publish_doc'));
  check('uni_staff may NOT hide a โครงการ',          get('uni_publish_project') === 'blocked', get('uni_publish_project'));
  check('the prof may NOT publish his own หนังสือ',   get('prof_publish_doc') === 'blocked', get('prof_publish_doc'));
  check('the flags survived every attempt (โครงการ)', get('flag_pub_project_intact') === '1', get('flag_pub_project_intact'));
  check('the flags survived every attempt (หนังสือ)',  get('flag_pub_doc_intact') === '1', get('flag_pub_doc_intact'));
  check('…including the hidden one',               get('flag_hid_doc_intact') === '1', get('flag_hid_doc_intact'));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
main();
