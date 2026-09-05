#!/usr/bin/env bash
# Put the Gmail app password into Vaultwarden's config, from your OWN machine.
#
#   ./server/vaultwarden/set-smtp.sh            write it
#   ./server/vaultwarden/set-smtp.sh --test     prove the plumbing, change nothing
#
# The app password is typed into a hidden prompt, travels over ssh on stdin, and
# lands in a root-only file on the VM. It is never echoed, never in your shell
# history, and never passed as a command-line argument (`ps` shows those to every
# user on the box).
#
# ⚠️ THE PLUMBING TRAP, paid for twice: you cannot feed a remote script with a
# heredoc AND pipe secrets to the same ssh — they are both stdin, the heredoc
# wins, and the reads come back EMPTY (it surfaces as "sudo: Authentication
# failed"). So the script goes over as a FILE and stdin carries only secrets.
set -Eeuo pipefail
cd "$(dirname "$0")/../.."
TEST=${1:-}

[ -f .env.local ] || { echo "!! run from the repo root; .env.local not found" >&2; exit 1; }
SUDO_PW=$(grep -m1 '^SAMO_VM_SUDO_PASSWORD=' .env.local | cut -d= -f2- | sed 's/^"//;s/"$//')
[ -n "$SUDO_PW" ] || { echo "!! SAMO_VM_SUDO_PASSWORD missing from .env.local" >&2; exit 1; }

if [ "$TEST" = "--test" ]; then
  APP_PW="TESTVALUE_NOT_WRITTEN"
else
  echo "Gmail app password for mdstuddata.beta@gmail.com"
  echo "  myaccount.google.com -> Security -> App passwords"
  echo "  Google GENERATES it: you only type the name. 16 letters, spaces fine."
  read -rsp "  app password: " APP_PW; echo
  APP_PW=${APP_PW// /}
  [ -n "$APP_PW" ] || { echo "!! nothing entered" >&2; exit 1; }
  if [ ${#APP_PW} -ne 16 ]; then
    echo "   note: ${#APP_PW} characters (Google app passwords are usually 16)."
    read -rp "   use it anyway? [y/N] " ok
    case "$ok" in y|Y) ;; *) echo "   aborted, nothing changed"; exit 1;; esac
  fi
fi

REMOTE=$(mktemp); trap 'rm -f "$REMOTE"' EXIT
cat > "$REMOTE" <<'INNER'
IFS= read -r SUDO_PW
IFS= read -r APP_PW
IFS= read -r MODE
[ -n "$SUDO_PW" ] || { echo "!! sudo password arrived empty — stdin plumbing is broken" >&2; exit 1; }
[ -n "$APP_PW" ]  || { echo "!! app password arrived empty" >&2; exit 1; }
s() { printf '%s\n' "$SUDO_PW" | sudo -S -p '' "$@"; }

if [ "$MODE" = "test" ]; then
  s true 2>/dev/null \
    && echo "  OK: sudo accepted, app password arrived (${#APP_PW} chars). Nothing written." \
    || { echo "!! sudo rejected the password from .env.local" >&2; exit 1; }
  exit 0
fi

s env APP_PW="$APP_PW" python3 -c '
import os
p = "/opt/vaultwarden/vaultwarden.env"
# Compose v2 interpolates env_file values, so a literal $ must be doubled.
esc = os.environ["APP_PW"].replace("$", "$$")
lines = open(p).read().split("\n")
open(p, "w").write("\n".join(
    ("SMTP_PASSWORD=" + esc) if l.startswith("SMTP_PASSWORD=") else l for l in lines))
'
s docker compose -f /opt/vaultwarden/docker-compose.yml up -d --force-recreate >/dev/null 2>&1
sleep 25
# Verify what the RUNNING container has, never the file.
s docker exec vaultwarden sh -c '\''test -n "$SMTP_PASSWORD" && echo "  running container HAS an SMTP password (${#SMTP_PASSWORD} chars)" || echo "  !! running container has NO SMTP password"; echo "  SMTP_USERNAME=$SMTP_USERNAME"'\''
INNER

# Two ssh calls: the script goes over as a FILE, then stdin carries only secrets.
REMOTE_PATH=/tmp/vw-smtp-$$.sh
scp -q "$REMOTE" "samo-vm:$REMOTE_PATH"
MODE=$([ "$TEST" = "--test" ] && echo test || echo write)
printf '%s\n%s\n%s\n' "$SUDO_PW" "$APP_PW" "$MODE" \
  | ssh samo-vm "bash $REMOTE_PATH; rm -f $REMOTE_PATH"

[ "$TEST" = "--test" ] && exit 0
echo
echo "Send a test mail to prove delivery:"
echo "  1. https://samo.md.kku.ac.th/vault/admin"
echo "  2. password:  ssh samo-vm 'sudo cat /root/vaultwarden-admin-password.txt'"
echo "  3. Settings -> SMTP -> Send test email"
