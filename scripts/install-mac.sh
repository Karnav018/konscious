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
# Every Kova/Konscious bundle LaunchServices knows about (Spotlight, Launchpad,
# Dock and "Open With" all list from here), plus copies in the Applications folders.
copies() {
  { "$lsreg" -dump 2>/dev/null | grep -E '^path: +.*/(Kova|Konscious)\.app( \(0x[0-9a-f]+\))?$' |
      sed -E 's/^path: +//; s/ \(0x[0-9a-f]+\)$//' || true
    ls -d /Applications/{Kova,Konscious}.app "$HOME"/Applications/{Kova,Konscious}.app 2>/dev/null || true
  } | sort -u
}

if ((dry)); then
  echo "DMG:        $dmg"
  echo "running:    $(running | tr '\n' ' ')"
  echo "copies:"; copies | sed 's/^/  /'
  echo "would:      quit the running app, install $dest, remove every other copy above, reopen"
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

# Eject DMGs of earlier builds first (they also count as extra app copies).
for vol in /Volumes/Konscious* /Volumes/Kova*; do
  [[ -d "$vol" ]] && { hdiutil detach -quiet "$vol" 2>/dev/null || true; }
done

# Mount and check the new build before quitting anything.
mnt=$(mktemp -d /tmp/konscious-dmg.XXXXXX)
trap 'hdiutil detach -quiet "$mnt" 2>/dev/null || true; rmdir "$mnt" 2>/dev/null || true' EXIT
hdiutil attach -nobrowse -readonly -mountpoint "$mnt" "$dmg" >/dev/null
[[ -d "$mnt/Konscious.app" ]] || { echo "✗ no Konscious.app in $dmg"; exit 1; }
codesign --verify --deep --strict "$mnt/Konscious.app"

# SIGTERM = a normal quit: the app stops its sessions (marked to resume) and
# saves state. Wait for it to be fully gone so its data lock is released.
for pid in $(running); do echo "quitting pid $pid"; kill -TERM "$pid"; done
# (Kova and Konscious save their state on SIGTERM and mark sessions to resume.)
for _ in $(seq 1 60); do [[ -z "$(running)" ]] && break; sleep 0.5; done
[[ -z "$(running)" ]] || { echo "✗ the app did not quit within 30s; nothing changed"; exit 1; }

# Copy next to the old app first, then swap, so a failed copy leaves it intact.
tmp="/Applications/.Konscious.app.new"
rm -rf "$tmp"
ditto "$mnt/Konscious.app" "$tmp"
[[ -d "$dest" ]] && { "$lsreg" -u "$dest" 2>/dev/null || true; rm -rf "$dest"; }
mv "$tmp" "$dest"

# Exactly one app afterwards: delete other copies (old Kova, stray Konscious
# in ~/Applications, build outputs), eject mounted DMGs, and drop stale
# registrations for bundles that no longer exist.
while IFS= read -r p; do
  [[ -z "$p" || "$p" == "$dest" || "$p" == "$mnt"/* ]] && continue
  case "$p" in
    /Volumes/*) hdiutil detach -quiet "/Volumes/$(cut -d/ -f3 <<<"$p")" 2>/dev/null || true ;;
    /Applications/* | "$HOME"/Applications/* | "$root"/*) rm -rf "$p" ;;
  esac
  "$lsreg" -u "$p" 2>/dev/null || true
  echo "removed $p"
done < <(copies)
"$lsreg" -f "$dest" 2>/dev/null || true
echo "installed $dest ($(defaults read "$dest/Contents/Info" CFBundleShortVersionString))"

open "$dest"
for _ in $(seq 1 40); do [[ -n "$(pids_of "${apps[0]}")" ]] && break; sleep 0.5; done
sleep 8
echo "running: pid $(pids_of "${apps[0]}"), data: $(ls -d ~/.konscious 2>/dev/null || echo missing)"
echo "sessions: $(ps -axo ppid=,command= | awk -v p="$(pids_of "${apps[0]}")" '$1 == p' | wc -l | tr -d ' ')"
echo "$(date '+%F %T') done"
