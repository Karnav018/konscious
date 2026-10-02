#!/usr/bin/env bash
# Build Konscious for Windows (x64) on this Mac by cross-compiling.
#
#   scripts/build-windows.sh    → release/win/Konscious_<version>_x64-setup.exe
#
# Builds from windows/ only; the macOS app in app/ is not involved.
# One-time setup: brew install llvm nsis
#                 cargo install --locked cargo-xwin
#                 rustup target add x86_64-pc-windows-msvc
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
win="$root/windows"
target=x86_64-pc-windows-msvc
step() { printf '\n\033[1m▸ %s\033[0m\n' "$1"; }
fail() { printf '\033[31m✗ %s\033[0m\n' "$1"; exit 1; }

step "toolchain"
command -v cargo-xwin >/dev/null || fail "cargo-xwin missing: cargo install --locked cargo-xwin"
command -v makensis >/dev/null   || fail "NSIS missing: brew install nsis"
llvm="$(brew --prefix llvm 2>/dev/null)/bin"
[[ -x "$llvm/clang-cl" && -x "$llvm/llvm-rc" ]] || fail "LLVM missing: brew install llvm"
rustup target list --installed | grep -qx "$target" || rustup target add "$target"
export PATH="$llvm:$PATH"   # clang-cl, llvm-rc, llvm-lib for the MSVC target
echo "ok"

cd "$win"
[[ -d node_modules ]] || pnpm install --frozen-lockfile
version=$(node -p "require('./src-tauri/tauri.conf.json').version")

step "frontend tests + typecheck"
pnpm -s test
pnpm -s exec tsc --noEmit -p .

step "engine lint for Windows (incl. tests)"
# Compiles the tests for Windows too: code used only by macOS/Linux tests
# must be gated, or the Windows CI lint fails.
(cd src-tauri && cargo xwin clippy --quiet --target "$target" --all-targets -- -D warnings)

step "build NSIS installer ($target)"
# First run downloads the MSVC CRT + Windows SDK (~1 GB) into
# ~/Library/Caches/cargo-xwin; later builds reuse it.
export CARGO_TARGET_DIR="$win/src-tauri/target"
# Updater signatures need the release key, which only CI has. Without it,
# build without update artifacts: the app installs and runs the same, it just
# can't be published as an update.
sign=()
if [[ -z "${TAURI_SIGNING_PRIVATE_KEY:-}" ]]; then
  sign=(--config '{"bundle":{"createUpdaterArtifacts":false}}')
  echo "no TAURI_SIGNING_PRIVATE_KEY: building without updater signatures"
fi
pnpm -s tauri build --runner cargo-xwin --target "$target" --bundles nsis ${sign[@]+"${sign[@]}"}

exe=$(ls -t "$CARGO_TARGET_DIR/$target"/release/bundle/nsis/*-setup.exe | head -1)
mkdir -p "$root/release/win"
out="$root/release/win/Konscious_${version}_x64-setup.exe"
cp "$exe" "$out"

step "done"
echo "✓ $out"
shasum -a 256 "$out" | cut -d' ' -f1
