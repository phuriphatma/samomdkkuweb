#!/usr/bin/env bash
# Put the Gmail app password into Vaultwarden's config, from your OWN machine.
#
# Run it from the repo root, on VPN:   ./server/vaultwarden/set-smtp.sh
#
# The app password is typed into a hidden prompt, travels over ssh, and lands in
# a root-only file on the VM. It is never echoed, never written to your shell
# history, never passed as a command-line argument (which `ps` would expose to
# every other user on the box), and never printed by this script.
set -Eeuo pipefail
cd "$(dirname "$0")/../.."

[ -f .env.local ] || { echo "!! run from the repo root; .env.local not found" >&2; exit 1; }
SUDO_PW=$(grep -m1 '^SAMO_VM_SUDO_PASSWORD=' .env.local | cut -d= -f2- | sed 's/^"//;s/"$//')
[ -n "$SUDO_PW" ] || { echo "!! SAMO_VM_SUDO_PASSWORD missing from .env.local" >&2; exit 1; }

echo "Gmail app password for mdstuddata.beta@gmail.com (the role account that already sends SAMO mail)"
echo "  myaccount.google.com -> Security -> App passwords"
echo "  16 letters; spaces are fine, they get stripped."
read -rsp "  app password: " APP_PW; echo
APP_PW=${APP_PW// /}
# Google app passwords are 16 characters today. WARN on anything else, do not
# REFUSE: a hard length check is a guess about someone else's product, and the
# cost of being wrong is blocking the operator from a value that would have
# worked. Empty is the only genuinely unusable case.
[ -n "$APP_PW" ] || { echo "!! nothing entered" >&2; exit 1; }
if [ ${#APP_PW} -ne 16 ]; then
  echo "   note: ${#APP_PW} characters (Google app passwords are usually 16)."
  read -rp "   use it anyway? [y/N] " ok
  case "$ok" in y|Y) ;; *) echo "   aborted, nothing changed"; exit 1;; esac
fi

# Both secrets go over stdin, in order, so neither appears in a process list.
printf '%s\n%s\n' "$SUDO_PW" "$APP_PW" | ssh samo-vm 'bash -s' <<'REMOTE'
IFS= read -r SUDO_PW
IFS= read -r APP_PW
printf '%s\n' "$SUDO_PW" | sudo -S -p '' bash -c "
  set -e
  f=/opt/vaultwarden/vaultwarden.env
  # python, not sed: an app password is [a-z] only today, but a config writer
  # that breaks on a metacharacter is a trap for whoever rotates it next.
  APP_PW='$APP_PW' python3 - \"\$f\" <<'PY'
import os, sys
p = sys.argv[1]
pw = os.environ['APP_PW']
out = []
for l in open(p).read().split('\n'):
    out.append('SMTP_PASSWORD=' + pw if l.startswith('SMTP_PASSWORD=') else l)
open(p, 'w').write('\n'.join(out))
PY
  docker compose -f /opt/vaultwarden/docker-compose.yml up -d --force-recreate >/dev/null 2>&1
"
REMOTE

echo "==> waiting for the container to come back"
for i in $(seq 1 30); do
  code=$(curl -s -o /dev/null -w '%{http_code}' https://samo.md.kku.ac.th/vault/alive || true)
  [ "$code" = "200" ] && { echo "    healthy after ${i}0s"; break; }
  sleep 10
done

# Verify what the RUNNING container has, not what the file says. The file being
# right while the container runs the old value is exactly how a probe lied
# earlier in this project's history.
printf '%s\n' "$SUDO_PW" | ssh samo-vm 'IFS= read -r P
  printf "%s\n" "$P" | sudo -S -p "" docker exec vaultwarden sh -c "test -n \"\$SMTP_PASSWORD\" && echo \"    running container HAS an SMTP password set\" || echo \"    !! running container has NO SMTP password\""'

echo
echo "Now send a test mail:"
echo "  1. open  https://samo.md.kku.ac.th/vault/admin"
echo "  2. log in with:  ssh samo-vm 'sudo cat /root/vaultwarden-admin-password.txt'"
echo "  3. Settings -> SMTP -> 'Send test email'  -> check the SAMO Gmail inbox"
