#!/usr/bin/env bash
# Open Vaultwarden registration to ONE DOMAIN for a fixed number of minutes,
# then close it again — whatever happens.
#
#   sudo /opt/vaultwarden/signup-window.sh [minutes] [domain]
#   sudo /opt/vaultwarden/signup-window.sh 15 kkumail.com        (defaults)
#
# ⚠️ IT WORKS BY SETTING THE WHITELIST, NOT BY TOUCHING SIGNUPS_ALLOWED, and
# that is not a style choice — it is what the config actually does:
#
#   is_signup_allowed(email) =
#       whitelist EMPTY     -> signups_allowed        (false = closed to all)
#       whitelist NON-EMPTY -> is_email_domain_allowed(email)   <- flag IGNORED
#
# So a non-empty whitelist is the OPEN switch, scoped to one domain, and an
# empty whitelist with SIGNUPS_ALLOWED=false is the only fully closed state.
# The first version of this script toggled SIGNUPS_ALLOWED and told the operator
# "the kkumail whitelist still applies" — after the whitelist had been removed,
# that would have opened registration to the ENTIRE INTERNET while printing a
# reassurance. See docs/mistakes/authz-grants.md.
#
# Prefer an invitation to a window: `invite.sh` needs no window at all and works
# for any domain. This exists for the case where mail is broken.
set -Eeuo pipefail
MINUTES=${1:-15}
DOMAIN=${2:-kkumail.com}
ENV_FILE=/opt/vaultwarden/vaultwarden.env
COMPOSE="docker compose -f /opt/vaultwarden/docker-compose.yml"

[ "$(id -u)" -eq 0 ] || { echo "run with sudo" >&2; exit 1; }
case "$DOMAIN" in *.*) ;; *) echo "!! '$DOMAIN' is not a domain" >&2; exit 1;; esac

set_whitelist() {   # empty argument = closed
  python3 - "$ENV_FILE" "$1" <<'PY'
import sys
path, val = sys.argv[1], sys.argv[2]
out, seen = [], False
for l in open(path).read().split("\n"):
    if l.startswith("SIGNUPS_DOMAINS_WHITELIST=") or l.startswith("# SIGNUPS_DOMAINS_WHITELIST="):
        if not seen:
            out.append(("SIGNUPS_DOMAINS_WHITELIST=" + val) if val else "# SIGNUPS_DOMAINS_WHITELIST=")
            seen = True
    else:
        out.append(l)
if not seen:
    out.append(("SIGNUPS_DOMAINS_WHITELIST=" + val) if val else "# SIGNUPS_DOMAINS_WHITELIST=")
open(path, "w").write("\n".join(out))
PY
  $COMPOSE up -d --force-recreate >/dev/null 2>&1
}

close() {
  echo; echo "==> closing registration"
  set_whitelist ""
  sleep 20
  # Verify by ATTEMPTING THE FORBIDDEN ACTION in full. A malformed probe gets
  # 422 from the parser without reaching the gate and proves nothing.
  code=$(curl -s -o /dev/null -w '%{http_code}' -X POST \
    http://127.0.0.1:8788/vault/identity/accounts/register \
    -H 'Content-Type: application/json' \
    -d '{"email":"window-close-probe@'"$DOMAIN"'","masterPasswordHash":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=","key":"2.AAAAAAAAAAAAAAAAAAAAAA==|AAAAAAAAAAAAAAAAAAAAAA==|AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=","kdf":0,"kdfIterations":600000,"keys":{"publicKey":"AAAA","encryptedPrivateKey":"2.AAAA|AAAA|AAAA"}}')
  if [ "$code" = "400" ]; then
    echo "    CLOSED — an uninvited registration is refused (400)."
  else
    echo "    !! STILL OPEN (probe returned $code). If it is 200 an account was just created."
    echo "    !! Close by hand NOW:"
    echo "       sudo sed -i 's|^SIGNUPS_DOMAINS_WHITELIST=.*|# SIGNUPS_DOMAINS_WHITELIST=|' $ENV_FILE"
    echo "       sudo $COMPOSE up -d --force-recreate"
    exit 1
  fi
}
trap close EXIT INT TERM

echo "==> opening registration to *@$DOMAIN for $MINUTES minute(s)"
set_whitelist "$DOMAIN"
sleep 20
echo
echo "    https://samo.md.kku.ac.th/vault/#/register"
echo "    ONLY @$DOMAIN addresses can register during this window."
echo "    ⚠️  NOBODY CAN RESET A MASTER PASSWORD. Write it down first."
echo
for i in $(seq "$MINUTES" -1 1); do
  printf "\r    closing in %2d min — Ctrl-C to close now  " "$i"
  sleep 60
done
