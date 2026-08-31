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

# ---------------------------------------------------------------------------
# Pull FIRST, then re-exec ourselves.
#
# bash reads a script incrementally, by BYTE OFFSET — it does not slurp the
# whole file up front. This script `git pull`s the repo it lives in, so any
# commit that changes deploy.sh's length shifts every byte after the pull point
# and bash resumes mid-token in the new file, running a garbage fragment of a
# command as root. It usually "works" only because the file rarely changes.
#
# Re-executing after the pull guarantees the version that runs is the version
# that was just fetched, read from the top. The env var breaks the recursion.
if [ "${SAMO_DEPLOY_REEXEC:-}" != "1" ]; then
  echo "==> pull (then re-exec the updated script)"
  cd "$WEB_DIR"
  git pull --ff-only
  SAMO_DEPLOY_REEXEC=1 exec bash "$WEB_DIR/server/deploy.sh" "$@"
fi

# ---------------------------------------------------------------------------
# publish() — add the new build WITHOUT yanking the old one out from under
# browsers that are still running it.
#
# A plain `rsync -a --delete dist/ <root>/` deletes the previous build's hashed
# chunks the instant the new ones land. Any tab that was already open then 404s
# the moment it fetches something lazily — this app really does that
# (`await import('./esign.js')` in projects/inbox.js, `./qr.js` in shop/admin.js)
# — and the app breaks with no obvious cause. Observed live 2026-07-30: a user
# mid-session reported "the web is down" ~12 minutes after a deploy, and it
# "came back" when they reloaded. src/js/build-check.js cannot rescue that case,
# because it only runs at PAGE LOAD and the tab in question never reloaded.
#
# So: assets are additive (hashed filenames never collide, so keeping the old
# ones is free and correct), everything else is mirrored with --delete. Old
# assets are pruned after a grace period long enough that no live tab is still
# holding them.
#
# NOTE `--exclude=assets/` also protects those files from --delete; rsync only
# removes excluded files if you additionally pass --delete-excluded.
ASSET_GRACE_DAYS=7
publish() {
  local src="$1" root="$2"
  sudo mkdir -p "$root/assets"
  sudo rsync -a "$src/assets/" "$root/assets/"                 # additive: keep old chunks
  sudo rsync -a --delete --exclude=assets/ "$src/" "$root/"    # mirror the rest
  sudo find "$root/assets" -type f -mtime +$ASSET_GRACE_DAYS -delete
}

echo "==> samomdkkuweb: pull + build"
cd "$WEB_DIR"
git pull --ff-only
npm ci
npm run build
publish dist /var/www/samo-web

if [ -d "$PASS_DIR" ]; then
  echo "==> samomdkkupassport: pull + build (subpath base)"
  cd "$PASS_DIR"
  git pull --ff-only
  npm ci
  # KKU VM serves passport at the /passport/ subpath — base must be prefixed.
  # (pages.dev builds without this var → base '/'.)
  PASSPORT_BASE=/passport/ npm run build
  publish dist /var/www/passport
fi

# ---------------------------------------------------------------------------
# The docs site, served at samo.md.kku.ac.th/docs.
#
# Same shape as the passport build above: one repo, a second build with a
# different base. GitHub Actions publishes the SAME docs to GitHub Pages with
# the default base — that copy is the backup, and the reason this VM is not a
# single point of failure for the documentation.
#
# ⚠️ A DEPLOY IS NOT THE ONLY TRIGGER, and must not be. A ฝ่าย member fixing a
# typo should not wait for someone to have VPN and run this script. The
# samo-docs.timer unit rebuilds these from a separate checkout every few
# minutes (server/samo-docs.*). This block is here so that a full deploy also
# leaves /docs current, not so that it is the only way to publish.
echo "==> docs site: build with base /docs/"
cd "$WEB_DIR"
DOCS_BASE=/docs/ npm run docs:build
publish docs/.vitepress/dist /var/www/docs

echo "==> fix permissions"
sudo chown -R www-data:www-data /var/www/samo-web /var/www/passport
# ⚠️ /var/www/docs is ubuntu:www-data 775, NOT www-data:www-data like the two
# above. samo-docs.timer runs as `ubuntu` and rsyncs straight into it; chowning
# it to www-data here would leave the directory looking perfectly fine while
# every timed rebuild failed with EACCES, and /docs would silently freeze at
# whatever the last deploy produced. nginx still reads it, by group.
sudo chown -R ubuntu:www-data /var/www/docs
sudo chmod -R g+w /var/www/docs

echo "==> restart notify service + reload nginx"
sudo systemctl restart samo-notify || echo "  (samo-notify not installed yet — see docs/SELF-HOST.md)"
sudo nginx -t && sudo systemctl reload nginx

echo "==> done. Smoke test:"
echo "    curl -sk https://127.0.0.1/build.json"
echo "    curl -sk https://127.0.0.1/notify   # {\"ok\":true,...}"
