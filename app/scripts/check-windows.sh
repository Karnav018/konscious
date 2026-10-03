#!/usr/bin/env bash
# Windows safety gate: the same four checks check-mac.sh runs, for the Windows
# build of the one codebase. Runs on a Windows machine (Git Bash) or in CI.
#   app/scripts/check-windows.sh
set -euo pipefail
cd "$(dirname "$0")/.."

step() { printf '\n\033[1m▸ %s\033[0m\n' "$1"; }

step "frontend tests";   pnpm -s test
step "typecheck";        pnpm -s exec tsc --noEmit -p .
step "engine tests";     cargo test --quiet --manifest-path src-tauri/Cargo.toml --lib
step "clippy";           cargo clippy --quiet --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings

printf '\n\033[32m✓ Windows checks passed\033[0m\n'
