#!/usr/bin/env bash
# Install or update Konscious on this Mac from the built DMG.
#
#   scripts/install-mac.sh                 newest release/mac/Konscious-*.dmg
#   scripts/install-mac.sh path/to.dmg
#   scripts/install-mac.sh --delay 60      wait before quitting the running app
#   scripts/install-mac.sh --dry-run       show what would happen, change nothing
#
# Already installed? It updates in place: the running app (Konscious, or Kova
# from before the rename) is quit cleanly — sessions are saved and marked to
# resume — the new build replaces it, the old Kova.app is removed, and
# Konscious is opened again. Data stays in ~/.konscious (Kova's ~/.kova moves
# there on first launch).
#
# It runs detached from the terminal that started it, because that terminal is
# often a pane inside the very app being quit. Progress goes to the log below.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
self="$root/scripts/install-mac.sh"
log="${TMPDIR:-/tmp}/konscious-install.log"

dmg="" delay=0 dry=0
while (($#)); do
  case "$1" in
    --delay) delay="$2"; shift 2 ;;
    --dry-run) dry=1; shift ;;
    *) dmg="$1"; shift ;;
  esac
done
[[ -n "$dmg" ]] || dmg=$(ls -t "$root"/release/mac/Konscious-*-universal.dmg 2>/dev/null | head -1)
[[ -f "$dmg" ]] || { echo "✗ no DMG found — run scripts/build-mac.sh first"; exit 1; }
dmg="$(cd "$(dirname "$dmg")" && pwd)/$(basename "$dmg")"

dest=/Applications/Konscious.app
legacy=/Applications/Kova.app
apps=("$dest/Contents/MacOS/Konscious" "$legacy/Contents/MacOS/Kova")
lsreg=/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister

pids_of() { ps -axo pid=,command= | awk -v exe="$1" '$2 == exe { print $1 }'; }
running() { local exe; for exe in "${apps[@]}"; do pids_of "$exe"; done; }

if ((dry)); then
  echo "DMG:        $dmg"
  echo "installed:  $([[ -d $dest ]] && echo "$dest" || echo "—")  $([[ -d $legacy ]] && echo "$legacy (will be removed)")"
  echo "running:    $(running | tr '\n' ' ')"
  echo "would:      quit the running app, install $dest, reopen it"
  exit 0
fi

if [[ "${KONSCIOUS_INSTALL_DETACHED:-}" != 1 ]]; then
  KONSCIOUS_INSTALL_DETACHED=1 python3 -c 'import os, sys; os.setsid(); os.execv(sys.argv[1], sys.argv[1:])' \
    "$self" --delay "$delay" "$dmg" >"$log" 2>&1 </dev/null &
  echo "Installing Konscious in the background (log: $log)."
  echo "The running app quits, updates and reopens; your sessions resume on their own."
  exit 0
fi

echo "$(date '+%F %T') install $dmg"
sleep "$delay"

# Mount and check the new build before quitting anything.
mnt=$(mktemp -d /tmp/konscious-dmg.XXXXXX)
trap 'hdiutil detach -quiet "$mnt" 2>/dev/null || true; rmdir "$mnt" 2>/dev/null || true' EXIT
hdiutil attach -nobrowse -readonly -mountpoint "$mnt" "$dmg" >/dev/null
[[ -d "$mnt/Konscious.app" ]] || { echo "✗ no Konscious.app in $dmg"; exit 1; }
codesign --verify --deep --strict "$mnt/Konscious.app"

# SIGTERM = a normal quit: the app stops its sessions (marked to resume) and
# saves state. Wait for it to be fully gone so its data lock is released.
for pid in $(running); do echo "quitting pid $pid"; kill -TERM "$pid"; done
for _ in $(seq 1 60); do [[ -z "$(running)" ]] && break; sleep 0.5; done
[[ -z "$(running)" ]] || { echo "✗ the app did not quit within 30s; nothing changed"; exit 1; }

# Copy next to the old app first, then swap, so a failed copy leaves it intact.
tmp="/Applications/.Konscious.app.new"
rm -rf "$tmp"
ditto "$mnt/Konscious.app" "$tmp"
for old in "$dest" "$legacy"; do
  [[ -d "$old" ]] || continue
  "$lsreg" -u "$old" 2>/dev/null || true
  rm -rf "$old"
  echo "removed $old"
done
mv "$tmp" "$dest"
"$lsreg" -f "$dest" 2>/dev/null || true
echo "installed $dest ($(defaults read "$dest/Contents/Info" CFBundleShortVersionString))"

open "$dest"
for _ in $(seq 1 40); do [[ -n "$(pids_of "${apps[0]}")" ]] && break; sleep 0.5; done
sleep 8
echo "running: pid $(pids_of "${apps[0]}"), data: $(ls -d ~/.konscious 2>/dev/null || echo missing)"
echo "sessions: $(ps -axo ppid=,command= | awk -v p="$(pids_of "${apps[0]}")" '$1 == p' | wc -l | tr -d ' ')"
echo "$(date '+%F %T') done"
