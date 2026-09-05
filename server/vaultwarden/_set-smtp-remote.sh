#!/usr/bin/env bash
# Remote half of set-smtp.sh. Runs ON the VM. Never invoked directly.
#
# It is a FILE, not a string built by the caller, because the previous version
# was generated with nested quoting and shipped broken:
#   /tmp/vw-smtp-94439.sh: line 27: unexpected EOF while looking for matching `''
# A script assembled out of escaped quotes cannot be syntax-checked before it
# runs. This one can:  bash -n server/vaultwarden/_set-smtp-remote.sh
#
# stdin carries exactly three lines, in order: sudo password, app password, mode.
set -Eeuo pipefail

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

ENVF=/opt/vaultwarden/vaultwarden.env
COMPOSE=/opt/vaultwarden/docker-compose.yml

# Write with python via a FILE argument, not an inline -c program: an inline
# program is one more layer of quoting to get wrong.
cat > /tmp/vw-write-smtp.py <<'PY'
import os, sys
path = sys.argv[1]
# Compose v2 interpolates env_file values, so a literal $ must be doubled or it
# is eaten — the same defect that silently downgraded ADMIN_TOKEN to plain text.
esc = os.environ["APP_PW"].replace("$", "$$")
lines = open(path).read().split("\n")
open(path, "w").write("\n".join(
    ("SMTP_PASSWORD=" + esc) if l.startswith("SMTP_PASSWORD=") else l for l in lines))
PY

s env APP_PW="$APP_PW" python3 /tmp/vw-write-smtp.py "$ENVF"
rm -f /tmp/vw-write-smtp.py

s docker compose -f "$COMPOSE" up -d --force-recreate >/dev/null 2>&1
sleep 25

# Verify what the RUNNING container has, never what the file says.
cat > /tmp/vw-check.sh <<'CHK'
if [ -n "$SMTP_PASSWORD" ]; then
  echo "  running container HAS an SMTP password (${#SMTP_PASSWORD} chars)"
else
  echo "  !! running container has NO SMTP password"
  exit 1
fi
echo "  SMTP_USERNAME=$SMTP_USERNAME"
echo "  SMTP_HOST=$SMTP_HOST"
CHK
s docker cp /tmp/vw-check.sh vaultwarden:/tmp/vw-check.sh >/dev/null 2>&1
s docker exec vaultwarden sh /tmp/vw-check.sh
rm -f /tmp/vw-check.sh
