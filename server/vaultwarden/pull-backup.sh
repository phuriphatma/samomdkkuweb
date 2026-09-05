#!/usr/bin/env bash
# Copy the latest verified Vaultwarden backup OFF the VM, to this machine.
#
#   ./server/vaultwarden/pull-backup.sh [destination-dir]   (default ./vaultwarden-backups)
#
# A backup that lives only on the VM is not a backup — the VM dying is the case
# you are insuring against. Run this on VPN, and keep the copy somewhere you
# would keep a vault: the archive is encrypted at rest, but it IS the vault.
#
# ⚠️ Sudo on this VM needs a password, so a bare `ssh samo-vm sudo ...` produces
# EMPTY OUTPUT, not an error. The first version of this script read that as
# "no backup found on samo-vm" — a false negative that looks like a legitimate
# answer, on the one tool whose whole job is telling you a backup exists.
set -Eeuo pipefail
cd "$(dirname "$0")/../.."
DEST=${1:-./vaultwarden-backups}
HOST=${VW_SSH_HOST:-samo-vm}

[ -f .env.local ] || { echo "!! run from the repo root; .env.local not found" >&2; exit 1; }
SUDO_PW=$(grep -m1 '^SAMO_VM_SUDO_PASSWORD=' .env.local | cut -d= -f2- | sed 's/^"//;s/"$//')
[ -n "$SUDO_PW" ] || { echo "!! SAMO_VM_SUDO_PASSWORD missing from .env.local" >&2; exit 1; }
mkdir -p "$DEST"

# Ask in a way that distinguishes "none exist" from "could not look".
listing=$(printf '%s\n' "$SUDO_PW" | ssh "$HOST" 'IFS= read -r P
  printf "%s\n" "$P" | sudo -S -p "" ls -1t /var/backups/vaultwarden/vaultwarden-*.tar.gz 2>/dev/null
  printf "RC=%s\n" "$?"')
# sed, not `grep -oP`: BSD grep on macOS has no -P, and the failure is a usage
# dump rather than an error, which reads like a broken script.
rc=$(printf '%s' "$listing" | sed -n 's/^RC=\([0-9][0-9]*\)$/\1/p' | tail -1)
latest=$(printf '%s' "$listing" | grep -E '\.tar\.gz$' | head -1)

if [ "${rc:-1}" != "0" ] && [ -z "$latest" ]; then
  echo "!! could not LIST backups on $HOST (sudo or ssh failed) — this is NOT 'no backups exist'" >&2
  exit 1
fi
[ -n "$latest" ] || { echo "!! the directory is genuinely empty: no backup on $HOST" >&2; exit 1; }

echo "==> pulling $latest"
printf '%s\n' "$SUDO_PW" | ssh "$HOST" "IFS= read -r P; printf '%s\n' \"\$P\" | sudo -S -p '' cat '$latest'" > "$DEST/$(basename "$latest")"

# Verify what LANDED here, not what was sent — a truncated transfer looks like
# success at the sending end.
tar -tzf "$DEST/$(basename "$latest")" >/dev/null 2>&1 \
  || { echo "!! transferred archive is unreadable — DO NOT delete the VM copy" >&2; exit 1; }
tar -tzf "$DEST/$(basename "$latest")" | grep -q './db.sqlite3' \
  || { echo "!! archive has no db.sqlite3" >&2; exit 1; }
echo "==> OK  $DEST/$(basename "$latest")  ($(du -h "$DEST/$(basename "$latest")" | cut -f1))"
