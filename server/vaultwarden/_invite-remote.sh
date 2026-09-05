#!/usr/bin/env bash
# Remote half of invite.sh. Runs ON the VM. Never invoked directly.
# stdin: line 1 = sudo password, line 2 = comma-separated emails.
set -Eeuo pipefail
IFS= read -r SUDO_PW
IFS= read -r EMAILS
[ -n "$SUDO_PW" ] || { echo "!! sudo password arrived empty" >&2; exit 1; }
[ -n "$EMAILS" ]  || { echo "!! no emails given" >&2; exit 1; }
s() { printf '%s\n' "$SUDO_PW" | sudo -S -p '' "$@"; }

C=/tmp/vwinv.$$; B=http://127.0.0.1:8788/vault
# The cookie jar is written by `s curl`, i.e. as ROOT, so a plain rm in the trap
# fails with "Operation not permitted" and leaves an admin SESSION COOKIE on
# disk. Remove it with the same privilege that made it.
trap 'printf "%s\n" "$SUDO_PW" | sudo -S -p "" rm -f "$C" 2>/dev/null' EXIT

code=$(s curl -s -c "$C" -o /dev/null -w '%{http_code}' -X POST "$B/admin" \
  --data-urlencode "token=$(s cat /root/vaultwarden-admin-password.txt)" \
  -H 'Content-Type: application/x-www-form-urlencoded')
[ "$code" = "200" ] || { echo "!! admin login failed (http=$code)" >&2; exit 1; }

ok=0; fail=0
IFS=',' read -ra LIST <<< "$EMAILS"
for raw in "${LIST[@]}"; do
  e=$(printf '%s' "$raw" | tr -d '[:space:]')
  [ -n "$e" ] || continue
  body=$(s curl -s -b "$C" -X POST "$B/admin/invite" \
    -H 'Content-Type: application/json' -d "{\"email\":\"$e\"}" -w '\n%{http_code}')
  http=$(printf '%s' "$body" | tail -1)
  msg=$(printf '%s' "$body" | head -n -1 | python3 -c 'import sys,json
try:
    d=json.load(sys.stdin)
    print(d.get("message") or ("created " + d.get("email","")))
except Exception:
    print("(unparseable response)")' 2>/dev/null)
  if [ "$http" = "200" ]; then
    ok=$((ok+1));   printf '  ✓ %-34s %s\n' "$e" "$msg"
  else
    fail=$((fail+1)); printf '  ✗ %-34s http=%s %s\n' "$e" "$http" "$msg"
  fi
done

echo
echo "  invited: $ok   failed: $fail"
echo "  accounts now:"
s sqlite3 /opt/vaultwarden/data/db.sqlite3 \
  'select "    " || email || "  " || case when length(coalesce(password_hash,""))=0 then "INVITED (no password yet)" else "active" end from users order by email;'
# A partial failure must not exit 0 — a bulk tool that reports success while
# half the list did not go through is how people find out weeks later.
[ "$fail" -eq 0 ]
