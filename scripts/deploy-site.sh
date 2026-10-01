#!/usr/bin/env bash
# Deploy the website to production: https://konscious.hawkapp.in
#
#   scripts/deploy-site.sh
#
# Builds here, then uploads the finished site to the Vercel project
# "konscious" (scope karnav018s-projects). Needs the Vercel CLI, logged in:
# `vercel login`.
#
# The site carries no installers: its download buttons link to the GitHub
# release for the version in site/src/site.ts, which is the same release the
# app updates itself from. So deploy this after the release workflow has
# published that tag, or the buttons 404 until it does.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
site="$root/site"
step() { printf '\n\033[1m▸ %s\033[0m\n' "$1"; }

cd "$site"
# .vercel/ is per machine (git-ignored); link it the first time.
[[ -f .vercel/project.json ]] || vercel link --yes --project konscious

step "build"
vercel pull --yes --environment=production >/dev/null
vercel build --prod

step "deploy to production"
vercel deploy --prebuilt --prod --yes

step "check"
curl -s -o /dev/null -w "https://konscious.hawkapp.in → HTTP %{http_code}\n" https://konscious.hawkapp.in/ || true
