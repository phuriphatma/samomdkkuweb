#!/usr/bin/env bash
# Put the Gmail app password into Vaultwarden's config, from your OWN machine.
#
#   ./server/vaultwarden/set-smtp.sh            write it
#   ./server/vaultwarden/set-smtp.sh --test     prove the plumbing, change nothing
#
# ⚠️ THE PLUMBING TRAP, paid for twice: you cannot feed a remote script with a
# heredoc AND pipe secrets to the same ssh — both are stdin, the heredoc wins,
# the reads come back EMPTY, and it surfaces as "sudo: Authentication failed".
# So the remote half is a real FILE (_set-smtp-remote.sh, syntax-checkable on
# its own) that is copied over, and stdin carries only the three secrets.
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
  echo
  echo "  >> NOTHING WILL APPEAR AS YOU TYPE OR PASTE. No dots, no stars."
  echo "     That is a hidden prompt, not a hang. Paste, then press Enter."
  echo
  read -rsp "  app password (invisible): " APP_PW; echo
  APP_PW=${APP_PW// /}
  [ -n "$APP_PW" ] || { echo "!! nothing entered" >&2; exit 1; }
  echo "  got ${#APP_PW} characters."
  if [ ${#APP_PW} -ne 16 ]; then
    echo "   note: Google app passwords are usually 16."
    read -rp "   use it anyway? [y/N] " ok
    case "$ok" in y|Y) ;; *) echo "   aborted, nothing changed"; exit 1;; esac
  fi
fi

RP=/tmp/vw-smtp-$$.sh
scp -q server/vaultwarden/_set-smtp-remote.sh "samo-vm:$RP"
MODE=$([ "$TEST" = "--test" ] && echo test || echo write)

# No `|| true` here. The success message below must be unreachable when the
# remote half fails — the previous version printed "Send a test mail" after the
# script had died on a syntax error, which is the worst kind of green.
printf '%s\n%s\n%s\n' "$SUDO_PW" "$APP_PW" "$MODE" \
  | ssh samo-vm "bash $RP; rc=\$?; rm -f $RP; exit \$rc"

[ "$TEST" = "--test" ] && exit 0

echo
echo "Now prove delivery — configuration is not delivery:"
echo "  1. https://samo.md.kku.ac.th/vault/admin"
echo "  2. password:  ssh samo-vm 'sudo cat /root/vaultwarden-admin-password.txt'"
echo "  3. Settings -> SMTP -> Send test email  -> check the studbeta inbox"
