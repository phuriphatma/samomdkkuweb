#!/usr/bin/env bash
# ============================================================
# samo-docs-build.sh — keep samo.md.kku.ac.th/docs current WITHOUT a deploy.
#
# WHY THIS EXISTS. The docs are served from this VM (nginx `location /docs/`),
# and the obvious objection to putting them here was "then publishing needs
# somebody on the VPN". It does not: GitHub Actions cannot reach this box, but
# this box can reach GitHub. The repository is PUBLIC, so this pulls with no
# credential of any kind.
#
# A ฝ่าย member fixing a typo should not wait for a maintainer to have VPN.
# server/deploy.sh also builds the docs, but that is a convenience — this timer
# is what makes /docs self-maintaining.
#
# ⚠️ ITS OWN CHECKOUT, deliberately. `git reset --hard` here must never touch
# ~/samo-projects/samomdkkuweb, which server/deploy.sh manages and whose working
# tree is what a deploy builds the APP from. Two writers on one checkout is this
# repo's most repeated bug shape wearing a filesystem costume.
#
# Runs as `ubuntu`, never root — /var/www/docs is ubuntu:www-data 775, so nginx
# reads it by group and this script needs no sudo and no npm-as-root.
# ============================================================
set -euo pipefail

# The repository URL is NOT written here. It is read from the checkout
# server/deploy.sh already maintains, so this file has no opinion about who owns
# the repo — which matters, because it is moving to an organisation account and
# `tools/repo-identity.mjs` exists to make that one edit. `npm test` fails any
# .sh that names the slug, and it is right to.
APP_DIR="$HOME/samo-projects/samomdkkuweb"
REPO_URL=$(git -C "$APP_DIR" remote get-url origin 2>/dev/null || true)
if [ -z "$REPO_URL" ]; then
  echo "no git remote at $APP_DIR — this VM has no app checkout to learn the repo URL from" >&2
  exit 1
fi
DOCS_DIR="$HOME/samo-projects/samomdkkuweb-docs"
WWW="/var/www/docs"

# First run bootstraps the checkout, so installing the timer is the only step.
if [ ! -d "$DOCS_DIR/.git" ]; then
  echo "==> first run: cloning docs checkout"
  git clone --quiet "$REPO_URL" "$DOCS_DIR"
fi

cd "$DOCS_DIR"
git fetch --quiet origin main

LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse origin/main)

# Nothing new AND the site is already on disk → do nothing. The second half of
# that test matters: without it, a wiped /var/www/docs would never be rebuilt
# because the shas already agreed. A guard that cannot see the broken state is
# no guard (.claude/rules/mistakes.md, class 7).
if [ "$LOCAL" = "$REMOTE" ] && [ -f "$WWW/index.html" ]; then
  echo "==> up to date at ${LOCAL:0:7}, nothing to do"
  exit 0
fi

echo "==> ${LOCAL:0:7} -> ${REMOTE:0:7}: rebuilding docs"
git reset --hard --quiet origin/main
npm ci --silent --no-audit --no-fund
DOCS_BASE=/docs/ npm run docs:build

# Additive assets, mirrored HTML — the same rule server/deploy.sh publishes the
# apps under, and for the same reason: VitePress lazy-loads hashed chunks, so
# deleting the previous build's assets breaks any tab that is already open.
mkdir -p "$WWW/assets"
rsync -a docs/.vitepress/dist/assets/ "$WWW/assets/"
rsync -a --delete --exclude=assets/ docs/.vitepress/dist/ "$WWW/"
find "$WWW/assets" -type f -mtime +7 -delete

echo "==> published $(git rev-parse --short HEAD) to $WWW"
