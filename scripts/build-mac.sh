#!/usr/bin/env bash
# Build Konscious for macOS: universal DMG (Apple silicon + Intel), ad-hoc signed.
#
#   scripts/build-mac.sh        → release/mac/Konscious-<version>-universal.dmg
#
# Builds from app/ only. Never touches the installed app or its data.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
app="$root/app"
step() { printf '\n\033[1m▸ %s\033[0m\n' "$1"; }

cd "$app"
[[ -d node_modules ]] || pnpm install --frozen-lockfile
version=$(node -p "require('./src-tauri/tauri.conf.json').version")

# Tests, typecheck, clippy — refuse to package a failing tree.
"$app/scripts/check-mac.sh"

step "build universal DMG"
# Absolute path ending in .noindex: Spotlight skips it, so build copies of
# Konscious.app never appear next to the installed one.
export CARGO_TARGET_DIR="$app/src-tauri/target-next.noindex"
CI=true pnpm -s tauri build --target universal-apple-darwin --bundles dmg

out_dir="$CARGO_TARGET_DIR/universal-apple-darwin/release/bundle"
dmg=$(ls -t "$out_dir"/dmg/*.dmg | head -1)
mkdir -p "$root/release/mac"
out="$root/release/mac/Konscious-$version-universal.dmg"
cp "$dmg" "$out"

lsreg=/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister
for bundle in "$out_dir"/macos/Konscious.app; do
  [[ -d "$bundle" ]] || continue
  "$lsreg" -u "$bundle" 2>/dev/null || true
  rm -rf "$bundle"
done

step "done"
echo "✓ $out"
shasum -a 256 "$out" | cut -d' ' -f1
