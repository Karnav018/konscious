#!/usr/bin/env bash
# Deploy the website to production: https://konscious.hawkapp.in
#
#   scripts/deploy-site.sh
#
# Builds here, then uploads the finished site to the Vercel project
# "konscious" (scope karnav018s-projects). It must build on this machine:
# the download buttons serve the installers from ../release, which Vercel's
# own build servers never see (a build there fails on purpose instead of
# shipping dead buttons). Needs the Vercel CLI, logged in: `vercel login`.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
site="$root/site"
step() { printf '\n\033[1m▸ %s\033[0m\n' "$1"; }

cd "$site"
# .vercel/ is per machine (git-ignored); link it the first time.
[[ -f .vercel/project.json ]] || vercel link --yes --project konscious

step "build (with the installers from release/)"
vercel pull --yes --environment=production >/dev/null
vercel build --prod

step "deploy to production"
vercel deploy --prebuilt --prod --yes

step "check"
curl -s -o /dev/null -w "https://konscious.hawkapp.in → HTTP %{http_code}\n" https://konscious.hawkapp.in/ || true
