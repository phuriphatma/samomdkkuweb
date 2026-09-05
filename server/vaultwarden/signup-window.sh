#!/usr/bin/env bash
# Open Vaultwarden registration for a FIXED number of minutes, then close it
# again — whatever happens.
#
# WHY THIS EXISTS: the vault has no SMTP yet, so the only way to make an account
# is to let people register. Doing that by hand is two commands with a human in
# between, and the failure mode is forgetting the second one — leaving open
# registration on a public URL. This makes the close automatic, including on
# Ctrl-C, so the window cannot outlive your attention.
#
#   sudo /opt/vaultwarden/signup-window.sh [minutes]     (default 15)
#
# SIGNUPS_DOMAINS_WHITELIST=kkumail.com still applies throughout, so even during
# the window only a @kkumail.com address can register.
set -Eeuo pipefail
MINUTES=${1:-15}
ENV_FILE=/opt/vaultwarden/vaultwarden.env
COMPOSE="docker compose -f /opt/vaultwarden/docker-compose.yml"

[ "$(id -u)" -eq 0 ] || { echo "run with sudo" >&2; exit 1; }

set_signups() {
  sed -i "s|^SIGNUPS_ALLOWED=.*|SIGNUPS_ALLOWED=$1|" "$ENV_FILE"
  $COMPOSE up -d --force-recreate >/dev/null 2>&1
}

close() {
  echo
  echo "==> closing registration"
  set_signups false
  sleep 5
  # VERIFY the close, do not assume it. This is the whole point of the script:
  # an unverified close is the same risk as forgetting to close at all.
  code=$(curl -s -o /dev/null -w '%{http_code}' -X POST \
    http://127.0.0.1:8788/vault/identity/accounts/register \
    -H 'Content-Type: application/json' \
    -d '{"email":"closed-probe@example.com","masterPasswordHash":"x","key":"x","kdf":0,"kdfIterations":600000}')
  if [ "$code" = "400" ]; then
    echo "    CLOSED — a stranger's registration is refused (400)."
  else
    echo "    !! REGISTRATION MAY STILL BE OPEN (probe returned $code)."
    echo "    !! Fix by hand NOW:  sudo sed -i 's|^SIGNUPS_ALLOWED=.*|SIGNUPS_ALLOWED=false|' $ENV_FILE && sudo $COMPOSE up -d"
    exit 1
  fi
}
# Close on normal exit, Ctrl-C, and kill alike.
trap close EXIT INT TERM

echo "==> opening registration for $MINUTES minute(s)"
set_signups true
sleep 6
echo
echo "    Go to:  https://samo.md.kku.ac.th/vault/#/register"
echo "    Use your @kkumail.com address and pick a master password."
echo "    ⚠️  NOBODY CAN RESET A MASTER PASSWORD FOR YOU. Write it down first."
echo
for i in $(seq "$MINUTES" -1 1); do
  printf "\r    closing in %2d min — press Ctrl-C to close now  " "$i"
  sleep 60
done
