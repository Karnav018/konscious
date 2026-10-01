#!/usr/bin/env bash
# Cut a release.
#
#   scripts/release.sh 0.2.0            bump, commit, tag v0.2.0, push
#   scripts/release.sh 0.2.0 --dry-run  bump and show the diff, change nothing
#
# Given the version the tree is already on (a branch that bumped it before being
# merged), it writes nothing and only tags and pushes.
#
# The version is written in both apps (package.json, tauri.conf.json, Cargo.toml,
# Cargo.lock), in the website and in the README's download links, and all of them
# must agree: the release workflow refuses a tag that doesn't match the app, and
# the updater compares the installed version against the one in the manifest.
#
# Pushing the tag is the release. GitHub Actions builds both apps, signs them
# with the updater key and publishes them (.github/workflows/release.yml); every
# installed copy sees it within the hour and offers the restart. Deploy the
# website after that, so its download buttons point at a release that exists:
#   scripts/deploy-site.sh
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"

version="${1:-}"
dry=false
[[ "${2:-}" == "--dry-run" ]] && dry=true

step() { printf '\n\033[1m▸ %s\033[0m\n' "$1"; }
fail() { printf '\033[31m✗ %s\033[0m\n' "$1"; exit 1; }

[[ -n "$version" ]] || fail "usage: scripts/release.sh <version> [--dry-run]"
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || fail "not a version: $version (expected e.g. 0.2.0)"
old=$(node -p "require('./app/src-tauri/tauri.conf.json').version")
# A merged branch may have bumped the version already; then there is nothing to
# write and this run only has to tag what is here.
tag_only=false
[[ "$version" == "$old" ]] && tag_only=true
git rev-parse -q --verify "refs/tags/v$version" >/dev/null && fail "tag v$version already exists"
[[ -z "$(git status --porcelain)" ]] || fail "working tree is dirty — commit or stash first"

if $tag_only; then
  step "already at $version — tagging what is here"
else
  step "bump $old → $version"
  # package.json / tauri.conf.json: the "version" field at the top level only.
  for f in app/package.json app/src-tauri/tauri.conf.json windows/package.json windows/src-tauri/tauri.conf.json site/package.json; do
    perl -0pi -e "s/(\"version\": )\"\Q$old\E\"/\$1\"$version\"/" "$f"
  done
  # Cargo.toml: the [package] version, which is the first one in the file.
  for f in app/src-tauri/Cargo.toml windows/src-tauri/Cargo.toml; do
    perl -0pi -e "s/^version = \"\Q$old\E\"/version = \"$version\"/m" "$f"
  done
  # Cargo.lock: only our own package's entry, never a dependency that happens to
  # share the version number.
  for f in app/src-tauri/Cargo.lock windows/src-tauri/Cargo.lock; do
    perl -0pi -e "s/(name = \"konscious\"(\r?\n)version = )\"\Q$old\E\"/\$1\"$version\"/" "$f"
  done
  # ${1}, not $1: the new version starts with a digit, and "$1" + "0" would read
  # as capture group $10.
  perl -0pi -e "s/(const version = ')\Q$old\E(')/\${1}$version\${2}/" site/src/site.ts
  # The README's download links and badges carry the file names, version and all.
  perl -0pi -e "s/\Q$old\E/$version/g" README.md
fi

step "check"
for f in app/src-tauri/tauri.conf.json windows/src-tauri/tauri.conf.json; do
  got=$(node -p "require('./$f').version")
  [[ "$got" == "$version" ]] || fail "$f still says $got"
done
grep -q "name = \"konscious\"" app/src-tauri/Cargo.lock || fail "app Cargo.lock lost its konscious entry"
grep -q "^const version = '$version'$" site/src/site.ts || fail "site/src/site.ts no longer declares the version"
for f in app/src-tauri/Cargo.toml windows/src-tauri/Cargo.toml; do
  grep -q "^version = \"$version\"$" "$f" || fail "$f version not bumped"
done
if ! $tag_only; then
  # Nothing may still name the version we came from.
  left=$(git grep -n -F "$old" -- app windows site README.md ':!*pnpm-lock.yaml' ':!*Cargo.lock' || true)
  [[ -z "$left" ]] || { echo "$left"; fail "still mentions $old — bump it here too, or exclude it above"; }
  git --no-pager diff --stat
fi

if $dry; then
  if $tag_only; then
    printf '\n\033[33m• dry run: nothing to bump. A real run would tag v%s and push.\033[0m\n' "$version"
  else
    printf '\n\033[33m• dry run: nothing committed. Undo with: git checkout -- .\033[0m\n'
  fi
  exit 0
fi

if ! $tag_only; then
  step "commit"
  git add -A
  git commit -m "Release $version"
fi

step "tag"
git tag -a "v$version" -m "Konscious $version"

step "push"
git push origin HEAD
git push origin "v$version"

printf '\n\033[32m✓ v%s pushed. The release builds here:\033[0m\n' "$version"
echo "  https://github.com/Karnav018/konscious/actions/workflows/release.yml"
echo "  Once it is published, deploy the site: scripts/deploy-site.sh"
