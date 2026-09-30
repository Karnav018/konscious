#!/usr/bin/env bash
# Mac safety gate: run before merging anything into main.
#   scripts/check-mac.sh           tests, types, lint
#   scripts/check-mac.sh --build   …plus a release .app build (not installed)
set -euo pipefail
cd "$(dirname "$0")/.."

step() { printf '\n\033[1m▸ %s\033[0m\n' "$1"; }

step "frontend tests";   pnpm -s test
step "typecheck";        pnpm -s exec tsc --noEmit -p .
step "engine tests";     cargo test --quiet --manifest-path src-tauri/Cargo.toml --lib
step "clippy";           cargo clippy --quiet --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings

if [[ "${1:-}" == "--build" ]]; then
  export CARGO_TARGET_DIR="$PWD/src-tauri/target-next.noindex"   # never the installed app
  step "release build (.app)"
  CI=true pnpm -s tauri build --bundles app
  bin="$CARGO_TARGET_DIR/release/Kova"
  step "binary checks"
  # The Mac binary must not contain the Windows hook helper.
  if nm "$bin" | grep -q "win_hooks"; then echo "✗ Windows code found in the Mac binary"; exit 1; fi
  echo "✓ no Windows code in $bin"
  app="$CARGO_TARGET_DIR/release/bundle/macos/Kova.app"
  codesign --verify --deep --strict "$app" && echo "✓ signature valid"
  # Build copies would show up as extra "Kova" apps in Spotlight/Launchpad.
  /System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -u "$app" 2>/dev/null || true
  rm -rf "$app"
fi

printf '\n\033[32m✓ Mac checks passed\033[0m\n'
