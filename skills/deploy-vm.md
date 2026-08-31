# Deploying to the KKU VM (prod)

`samo.md.kku.ac.th` is the real host. `server/deploy.sh` runs **on the VM** and
pulls from GitHub, so deploying is: commit → push `main` → run the script over
ssh.

## Prerequisites

- **VPN must be connected.** Without it `ssh samo-vm` times out at
  `10.101.111.181:22` with no useful error. If ssh hangs, that is the reason —
  ask the user to connect rather than debugging the key.
- `SAMO_VM_SUDO_PASSWORD` in `.env.local` (gitignored). Sudo on the VM is **not**
  passwordless.


⚠️ **Added 2026-08-27 — check this BEFORE you deploy, not after:**

```bash
npm run migrate:status        # PENDING must be 0 on production
```

A bundle that reads a column the live database does not have is 0129's
20-minute outage in the other direction. Order is unchanged: **ADD before the
code that reads it ships; DROP only after the new bundle is confirmed SERVED**
(`skills/ship-a-migration.md`).

## The command

```bash
PW=$(grep -m1 '^SAMO_VM_SUDO_PASSWORD=' .env.local | cut -d= -f2- | sed 's/^"//;s/"$//')
{ printf '%s\n' "$PW"; sleep 10; } | timeout 600 ssh -tt -o BatchMode=yes samo-vm \
  'sudo -v && cd "$HOME/samo-projects/samomdkkuweb" && ./server/deploy.sh; echo "DEPLOY_EXIT=$?"' 2>&1 \
  | grep -viE 'password|^\[sudo' | grep -E "DEPLOY_EXIT|==>|error" | tail -12
```

**RUN IT IN THE BACKGROUND, AND GIVE IT A GENEROUS CEILING.** These two go
together and getting them backwards truncated a real deploy on 2026-08-31.

The owner objected to a long `timeout` twice — *"why are you timeout for so
long"*, then *"timeout 30 is enough"* — and the objection is about WAITING, not
about the ceiling. `timeout` is a kill limit, not a duration. The fix for the
waiting is `run_in_background: true`: the command returns immediately, the VM
keeps working, and you are notified when it exits. Then the ceiling costs
nobody anything and should be generous.

⚠️ **MEASURED, because the old figure here was stale and I trusted it.** This
file used to say "~90 s", from an era when the deploy built ONE app. It now
builds three things — samomdkkuweb, samomdkkupassport, and the docs site — each
with its own `npm ci`. A real run on 2026-08-31 started 12:40:55 and was still
in the docs build when `timeout 300` killed it at 12:45:56. **A full deploy needs
MORE than five minutes.** 600 is the ceiling until someone measures a completed
run and writes the number here.

**What a truncated deploy leaves behind** — the reason the ceiling matters. The
kill landed after the three builds and before `fix permissions`, `restart
samo-notify` and `nginx -t && systemctl reload nginx`. That run happened to be
harmless: the app was already current, and `/var/www/docs` kept a complete,
self-consistent OLD build (every page still 200). Do not read that as "killing
it is safe" — `publish()` is an rsync, so a kill during the mirror step CAN
leave a half-written root, and the nginx reload never happening means a config
change silently does not take effect.

**Always verify from outside afterwards**, VPN or no VPN — the public host is
reachable without it:

```bash
for p in / /admin/ /passport/ /pr /notify; do
  printf "%-12s " "$p"; curl -s -o /dev/null -m 15 -w "%{http_code}\n" "https://samo.md.kku.ac.th$p"
done
```

**`sleep 10`, not `sleep 420`.** The sleep exists only to hold stdin open long
enough for `sudo -v` to read the password — which happens in the first second.
It is NOT a timeout for the deploy. `sleep` never writes, so it never gets
SIGPIPE when ssh exits; bash therefore waits for the whole sleep, and a
`sleep 420` made every deploy sit idle for ~5 minutes after the VM had already
printed `==> done`. The deploy itself takes ~90 s and is bounded by `timeout`,
not by the sleep. Reported by the owner: *"you take too long timeout sleep"*.

Then verify — **from the served artifact, never the local file**:

```bash
ssh samo-vm 'cd ~/samo-projects/samomdkkuweb && git log --oneline -1
             grep -c "<a string your change added>" /var/www/samo-web/assets/admin-*.js'
```

## Why it is shaped like that — three traps, each hit for real

1. **`-tt` is required.** `sudo`'s credential cache is per-TTY. Without a PTY,
   `sudo -S -v` authenticates but the timestamp does not carry to the sudo calls
   *inside* `deploy.sh` (which re-execs itself), and it dies at the end —
   after both builds — with `sudo: A terminal is required to authenticate`.
   `sudo -v` up front under `-tt` primes a cache the whole script then uses.

2. **Never combine a heredoc with a stdin pipe.** This
   ```bash
   printf '%s\n' "$PW" | ssh samo-vm 'bash -s' <<'REMOTE'   # ← WRONG
   ```
   leaks the password: the heredoc claims ssh's stdin, and the password line
   ends up executed as a remote command — it is then echoed in the error output
   (`bash: line 1: <the password>: command not found`) and into the transcript.
   Put the script in the ssh **argument** and let stdin carry only the password.
   *If this happens, tell the user to rotate the password immediately.*

3. **`sleep` keeps stdin open; the outer `timeout` will kill it.** The deploy
   itself finishes in ~90 s but the `sleep` holds the pipe, so the command exits
   143 *after* a successful deploy. **`DEPLOY_EXIT=0` in the output is the real
   verdict — exit 143 from the wrapper is expected and not a failure.**

## What deploy.sh does that you must not reimplement

- Publishes assets **additively** (`rsync` without `--delete` for `assets/`),
  pruning only files older than 7 days. A plain `rsync --delete` yanks the
  previous build's hashed chunks out from under tabs that are still open, and
  this app lazy-imports (`esign.js`, shop `qr.js`) — a user mid-session sees
  "the web is down" ~12 minutes after a deploy.
- Re-execs itself after `git pull`, because bash reads a script by byte offset
  and a pull that changes the file's length resumes mid-token.

Both are load-bearing. Deploy through the script, not by hand.
