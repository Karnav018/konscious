#!/usr/bin/env bash
# Deploy the website to production: https://konscious.hawkapp.in
#
#   scripts/deploy-site.sh
#
# Uploads site/ to the Vercel project "konscious" (scope karnav018s-projects),
# which builds it (site/vercel.json) and serves it on the subdomain. Checks the
# build locally first so a broken page never goes out. Needs the Vercel CLI,
# logged in: `vercel login`.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
site="$root/site"
step() { printf '\n\033[1m▸ %s\033[0m\n' "$1"; }

"$root/scripts/build-site.sh"

cd "$site"
# .vercel/ is per machine (git-ignored); link it the first time.
[[ -f .vercel/project.json ]] || vercel link --yes --project konscious

step "deploy to production"
vercel deploy --prod --yes

step "check"
curl -s -o /dev/null -w "https://konscious.hawkapp.in → HTTP %{http_code}\n" https://konscious.hawkapp.in/
