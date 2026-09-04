#!/usr/bin/env node
// ============================================================
// dev-all.mjs — one command, both apps, one address.
//
// `npm run dev` used to start the portal only, and /passport/ answered with the
// portal's own HTML: a 200, the wrong page, and nothing to tell you. Since the
// September 2026 merge people reasonably expect one dev server to serve both,
// so it now does — this spawns the two Vite servers and the portal proxies
// /passport to the other one (see server.proxy in vite.config.js).
//
// Two processes rather than one because passport needs its own Vite root,
// plugins and html-includes. That is an implementation detail; the person
// running it sees one command and one URL.
//
// No dependency for this. `concurrently` would be a package to install, keep
// updated and explain, for something Node does in thirty lines.
// ============================================================
import { spawn } from 'node:child_process';

const kids = [];
function start(name, args, colour) {
  const p = spawn('npx', ['vite', ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
  const tag = `\x1b[${colour}m[${name}]\x1b[0m `;
  const pipe = (stream, to) => stream.on('data', (b) => {
    for (const line of String(b).split('\n')) if (line.trim()) to.write(tag + line + '\n');
  });
  pipe(p.stdout, process.stdout);
  pipe(p.stderr, process.stderr);
  p.on('exit', (code) => {
    // If either dies the pair is useless — take the other down rather than
    // leave a half-working setup where /passport/ silently fails to connect.
    if (!shuttingDown) {
      process.stdout.write(`${tag}exited (${code}) — stopping the other too\n`);
      stopAll();
      process.exitCode = code ?? 1;
    }
  });
  kids.push(p);
  return p;
}

let shuttingDown = false;
function stopAll() {
  shuttingDown = true;
  for (const p of kids) { try { p.kill('SIGTERM'); } catch { /* already gone */ } }
}
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { stopAll(); process.exit(0); });

start('passport', ['--config', 'passport/vite.config.js'], '36');
start('portal', [], '32');

process.stdout.write(
  '\n  Both servers starting. Open the PORTAL address below —\n'
  + '  /passport/ is proxied to the passport server, so one address serves both.\n\n',
);
