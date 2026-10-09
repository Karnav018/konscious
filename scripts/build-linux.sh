#!/usr/bin/env bash
# Build Konscious for Linux on this Mac, in a Linux container.
#
#   scripts/build-linux.sh            → release/linux/Konscious_<version>_amd64.AppImage + .deb
#                                       (x86_64, what releases ship; emulated on Apple silicon — slow)
#   scripts/build-linux.sh --native   → the same for this machine's processor (arm64 on Apple silicon;
#                                       much faster, for trying it out)
#   scripts/build-linux.sh --check    → only the checks (tests, types, engine, clippy), natively
#   BUNDLES=deb scripts/build-linux.sh --native
#                                     → only some packages (the AppImage tools download from
#                                       GitHub's file servers; the .deb needs nothing)
#
# Needs Docker Desktop running. Never touches the Mac app or its data; the
# container keeps its own build caches in Docker volumes (konscious-*).
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
step() { printf '\n\033[1m▸ %s\033[0m\n' "$1"; }
fail() { printf '\033[31m✗ %s\033[0m\n' "$1"; exit 1; }

mode=release
case "${1:-}" in
  --native) mode=native ;;
  --check) mode=check ;;
  "") ;;
  *) fail "usage: scripts/build-linux.sh [--native | --check]" ;;
esac

docker info >/dev/null 2>&1 || fail "Docker isn't running: open Docker Desktop first"
host=$(uname -m); [[ "$host" == arm64 || "$host" == aarch64 ]] && host=arm64 || host=amd64
arch=amd64; [[ "$mode" != release ]] && arch=$host
deb_arch=$arch   # Debian's names, which the bundler uses too: amd64, arm64
version=$(node -p "require('$root/app/src-tauri/tauri.conf.json').version")

step "build environment (linux/$arch)"
image="konscious-linux-builder:$arch"
docker build --quiet --platform "linux/$arch" -t "$image" "$root/scripts/linux" >/dev/null
echo "ok: $image"

# Updater signatures need the release key, which only CI has. Without it the
# packages install and run the same; they just can't be published as an update.
sign=""
if [[ -z "${TAURI_SIGNING_PRIVATE_KEY:-}" ]]; then
  sign="--config '{\"bundle\":{\"createUpdaterArtifacts\":false}}'"
fi

# --init: a real PID 1 that reaps orphans, as systemd does on a Linux
# machine. Without it, process-group tests see unreaped zombies.
run=(docker run --rm --init --platform "linux/$arch"
  -v "$root:/src" -w /src/app
  -v "konscious-cargo-$arch:/root/.cargo/registry"
  -v "konscious-target-$arch:/target" -e CARGO_TARGET_DIR=/target
  -v "konscious-node-$arch:/src/app/node_modules"
  -v "konscious-pnpm-$arch:/root/.local/share/pnpm"
  -e npm_config_store_dir=/root/.local/share/pnpm/store   # not next to the project (the repo)
  -e CI=true -e TAURI_SIGNING_PRIVATE_KEY -e TAURI_SIGNING_PRIVATE_KEY_PASSWORD
  "$image")

step "install"
"${run[@]}" pnpm install --frozen-lockfile --reporter=silent

step "checks"
"${run[@]}" scripts/check-linux.sh
[[ "$mode" == check ]] && exit 0

bundles=${BUNDLES:-appimage,deb}
step "build $bundles"
"${run[@]}" bash -c "set -euo pipefail
  pnpm -s tauri build --bundles $bundles $sign
  out=/src/release/linux; mkdir -p \$out
  b=/target/release/bundle
  for kind in appimage deb; do
    case ,$bundles, in *,\$kind,*) ;; *) continue ;; esac
    ext=\$([ \$kind = appimage ] && echo AppImage || echo deb)
    cp \"\$(ls -t \$b/\$kind/*.\$ext | head -1)\" \$out/Konscious_${version}_${deb_arch}.\$ext
  done"

step "done"
ls -lh "$root/release/linux/"*"${version}_${deb_arch}"*
