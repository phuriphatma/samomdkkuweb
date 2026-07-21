#!/usr/bin/env bash
# setup.sh — one-time (idempotent) install of the notify service + correct
# Nginx config on the KKU VM. Run from the repo root:
#
#   cd ~/samo-projects/samomdkkuweb && git pull && sudo ./server/setup.sh
#
# Safe to re-run: it never overwrites /etc/samo-notify.env once it holds
# real secrets. After the first run, edit that file to add the Discord
# webhook URLs, then: sudo systemctl restart samo-notify
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "Run with sudo: sudo ./server/setup.sh" >&2
  exit 1
fi

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
RUN_USER="${SUDO_USER:-ubuntu}"
cd "$REPO_DIR"
echo "==> repo: $REPO_DIR (service will run as: $RUN_USER)"

# 1. Notify secrets file — create from template only if absent.
if [ ! -f /etc/samo-notify.env ]; then
  cp server/samo-notify.env.example /etc/samo-notify.env
  chown root:root /etc/samo-notify.env
  chmod 600 /etc/samo-notify.env
  echo "==> created /etc/samo-notify.env  ***EDIT IT to add the Discord webhook URLs***"
else
  echo "==> /etc/samo-notify.env exists — left untouched"
fi

# 2. systemd unit — patch WorkingDirectory + User to this box's reality.
sed -e "s#^WorkingDirectory=.*#WorkingDirectory=${REPO_DIR}#" \
    -e "s#^User=.*#User=${RUN_USER}#" \
    -e "s#^Group=.*#Group=${RUN_USER}#" \
    server/samo-notify.service > /etc/systemd/system/samo-notify.service
systemctl daemon-reload
systemctl enable --now samo-notify
echo "==> samo-notify: $(systemctl is-active samo-notify)"

# 3. Nginx site.
cp server/nginx-samo.conf /etc/nginx/sites-available/default
nginx -t
systemctl reload nginx
echo "==> nginx reloaded"

echo
echo "Next:"
echo "  1) sudo nano /etc/samo-notify.env   # paste the 3 DISCORD_* webhook URLs"
echo "  2) sudo systemctl restart samo-notify"
echo "  3) curl -sk https://127.0.0.1/notify   # expect {\"ok\":true,...}"
