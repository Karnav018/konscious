#!/usr/bin/env bash
# Build the Konscious website (landing page and any other registered pages).
#
#   scripts/build-site.sh       → site/dist/  (static files, deploy as-is)
#
# Builds from site/ only; independent of the app builds.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
site="$root/site"
step() { printf '\n\033[1m▸ %s\033[0m\n' "$1"; }

cd "$site"
[[ -d node_modules ]] || pnpm install --frozen-lockfile

# Typecheck runs inside `pnpm build` (tsc -b) — a type error stops the build.
step "build site"
rm -rf dist
pnpm -s build

step "done"
echo "✓ $site/dist"
