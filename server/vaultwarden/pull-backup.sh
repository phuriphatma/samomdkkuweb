#!/usr/bin/env bash
# Copy the latest verified Vaultwarden backup OFF the VM, to this machine.
#
# WHY THIS EXISTS: a backup that lives only on the VM is not a backup — the VM
# dying is the case you are insuring against. Run this from your laptop on VPN.
# Vaultwarden data is end-to-end encrypted, so the archive is not plaintext,
# but it is still the whole vault: keep the copy somewhere you'd keep a vault.
#
#   ./pull-backup.sh [destination-dir]     (default: ./vaultwarden-backups)
set -Eeuo pipefail
DEST=${1:-./vaultwarden-backups}
HOST=${VW_SSH_HOST:-samo-vm}
mkdir -p "$DEST"

latest=$(ssh "$HOST" 'sudo ls -1t /var/backups/vaultwarden/vaultwarden-*.tar.gz 2>/dev/null | head -1')
[ -n "$latest" ] || { echo "!! no backup found on $HOST" >&2; exit 1; }

echo "==> pulling $latest"
ssh "$HOST" "sudo cat '$latest'" > "$DEST/$(basename "$latest")"

# Verify what LANDED here, not what was sent. A truncated transfer is the
# common failure and it looks like success at the sending end.
tar -tzf "$DEST/$(basename "$latest")" >/dev/null \
  || { echo "!! transferred archive is unreadable — DO NOT delete the VM copy" >&2; exit 1; }
echo "==> OK  $DEST/$(basename "$latest")"
