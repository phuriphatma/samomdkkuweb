#!/usr/bin/env bash
# Nightly Vaultwarden backup.
#
# ⚠️ WHY THIS IS NOT `cp db.sqlite3`:
#   1. A live sqlite file has -wal/-shm sidecars. A raw copy taken mid-write is
#      CORRUPT, and it is corrupt SILENTLY — it restores, it opens, and rows are
#      missing. `sqlite3 .backup` uses the online-backup API and is consistent.
#   2. A DB-only backup restores with BROKEN ATTACHMENTS. config.json, the RSA
#      key and the attachments/ + sends/ trees are part of the vault, not
#      decoration. Restore the db alone and every file anyone uploaded is gone
#      and every session token is invalid.
#
# This script VERIFIES its own output before rotating anything away, because a
# backup you have never restored is a hypothesis. It exits non-zero on any
# failure so the systemd timer surfaces it instead of quietly succeeding.
set -Eeuo pipefail

DATA_DIR=${VW_DATA_DIR:-/opt/vaultwarden/data}
DEST_DIR=${VW_BACKUP_DIR:-/var/backups/vaultwarden}
KEEP=${VW_BACKUP_KEEP:-14}
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

die() { echo "!! $*" >&2; exit 1; }

[ -d "$DATA_DIR" ] || die "data dir missing: $DATA_DIR"
command -v sqlite3 >/dev/null || die "sqlite3 not installed (apt-get install -y sqlite3)"
mkdir -p "$DEST_DIR"

echo "==> snapshot database (online backup API, WAL-safe)"
sqlite3 "$DATA_DIR/db.sqlite3" ".backup '$WORK/db.sqlite3'" \
  || die "sqlite3 .backup failed"

# Verify the COPY, not the original. A backup that cannot be read is the whole
# failure mode this script exists to prevent.
echo "==> verify integrity of the copy"
check=$(sqlite3 "$WORK/db.sqlite3" 'PRAGMA integrity_check;' 2>&1) \
  || die "integrity_check could not run: $check"
[ "$check" = "ok" ] || die "integrity_check FAILED: $check"

# A structurally-valid but EMPTY database also passes integrity_check, so assert
# the vault actually has content. Asserting ">0 users" rather than a hardcoded
# count: the number changes every year, the property does not.
users=$(sqlite3 "$WORK/db.sqlite3" 'select count(*) from users;' 2>/dev/null || echo 0)
[ "$users" -ge 1 ] || die "backup contains $users users — refusing to store an empty vault"
echo "    integrity ok, $users user(s)"

echo "==> collect the rest of the vault"
for f in config.json rsa_key.pem rsa_key.pub.pem; do
  [ -f "$DATA_DIR/$f" ] && cp -a "$DATA_DIR/$f" "$WORK/" || true
done
for d in attachments sends; do
  [ -d "$DATA_DIR/$d" ] && cp -a "$DATA_DIR/$d" "$WORK/" || true
done

ARCHIVE="$DEST_DIR/vaultwarden-$STAMP.tar.gz"
tar -czf "$ARCHIVE" -C "$WORK" . || die "tar failed"
chmod 600 "$ARCHIVE"

# Prove the archive is readable and carries the database. `tar -tzf` walks the
# whole stream, so a truncated or corrupt gzip fails here rather than on the
# day you need it.
echo "==> verify archive"
tar -tzf "$ARCHIVE" >/dev/null || die "archive is unreadable: $ARCHIVE"
tar -tzf "$ARCHIVE" | grep -q './db.sqlite3' || die "archive has no db.sqlite3"
size=$(stat -c %s "$ARCHIVE")
[ "$size" -ge 4096 ] || die "archive suspiciously small: $size bytes"
echo "    $ARCHIVE ($(numfmt --to=iec "$size"))"

echo "==> rotate (keep $KEEP)"
# Only AFTER the new archive verified. Never prune on a failed run.
ls -1t "$DEST_DIR"/vaultwarden-*.tar.gz 2>/dev/null | tail -n +$((KEEP + 1)) \
  | while read -r old; do echo "    rm $old"; rm -f "$old"; done

echo "==> OK $STAMP"
