#!/usr/bin/env bash
# deploy.sh — pull + build + publish both apps on the KKU VM, then bounce
# the notify service. Run from the samomdkkuweb repo root on the server:
#   cd ~/samo-projects/samomdkkuweb && ./server/deploy.sh
#
# Assumes the layout in docs/SELF-HOST.md:
#   ~/samo-projects/samomdkkuweb     (this repo, .env.local present)
#   ~/samo-projects/samomdkkupassport (built with base '/passport/')
#   /var/www/samo-web  and  /var/www/passport  (Nginx roots)
set -euo pipefail

WEB_DIR="$HOME/samo-projects/samomdkkuweb"
PASS_DIR="$HOME/samo-projects/samomdkkupassport"

echo "==> samomdkkuweb: pull + build"
cd "$WEB_DIR"
git pull --ff-only
npm ci
npm run build
sudo rsync -a --delete dist/ /var/www/samo-web/

if [ -d "$PASS_DIR" ]; then
  echo "==> samomdkkupassport: pull + build (subpath base)"
  cd "$PASS_DIR"
  git pull --ff-only
  npm ci
  # KKU VM serves passport at the /passport/ subpath — base must be prefixed.
  # (pages.dev builds without this var → base '/'.)
  PASSPORT_BASE=/passport/ npm run build
  sudo rsync -a --delete dist/ /var/www/passport/
fi

echo "==> fix permissions"
sudo chown -R www-data:www-data /var/www/samo-web /var/www/passport

echo "==> restart notify service + reload nginx"
sudo systemctl restart samo-notify || echo "  (samo-notify not installed yet — see docs/SELF-HOST.md)"
sudo nginx -t && sudo systemctl reload nginx

echo "==> done. Smoke test:"
echo "    curl -sk https://127.0.0.1/build.json"
echo "    curl -sk https://127.0.0.1/notify   # {\"ok\":true,...}"
