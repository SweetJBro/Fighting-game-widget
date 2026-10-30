#!/usr/bin/env bash
# Install a pinned EmulatorJS into web/ejs/ so production never tracks the
# moving "latest" CDN. server/serve.js switches to it automatically.
#
# Why a git commit and not npm: @emulatorjs/emulatorjs@4.2.3 (the newest npm
# release) still ships the old netplay client, which cannot talk to the current
# EmulatorJS-Netplay server. The WebRTC netplay this project relies on only
# exists on EmulatorJS main. The fbneo core itself is unchanged since the
# 2025-06-14 build, which npm @emulatorjs/core-fbneo@4.2.3 carries.
#
# Override with EJS_COMMIT=<sha> / CORE_VERSION=<npm version>.
set -euo pipefail
EJS_COMMIT="${EJS_COMMIT:-5a65bde5d3b47c75f22e90453c3c14c469411589}"   # main, 2026-10-21
CORE_VERSION="${CORE_VERSION:-4.2.3}"
here="$(cd "$(dirname "$0")/.." && pwd)"
dest="$here/web/ejs"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT

echo "EmulatorJS @ $EJS_COMMIT"
curl -fsSL "https://codeload.github.com/EmulatorJS/EmulatorJS/tar.gz/$EJS_COMMIT" | tar -xz -C "$tmp"
src="$(find "$tmp" -maxdepth 1 -type d -name 'EmulatorJS-*' | head -1)/data"
[ -f "$src/loader.js" ] || { echo "no data/loader.js in that commit"; exit 1; }

echo "fbneo core @ npm $CORE_VERSION"
mkdir -p "$tmp/core"
curl -fsSL "https://registry.npmjs.org/@emulatorjs/core-fbneo/-/core-fbneo-$CORE_VERSION.tgz" | tar -xz -C "$tmp/core"

rm -rf "$dest.new"
cp -r "$src" "$dest.new"
mkdir -p "$dest.new/cores/reports"
cp "$tmp/core/package/"*.data "$dest.new/cores/"
cp "$tmp/core/package/reports/fbneo.json" "$dest.new/cores/reports/"
printf '{ "emulatorjs_commit": "%s", "core_fbneo": "%s" }\n' "$EJS_COMMIT" "$CORE_VERSION" > "$dest.new/PINNED.json"
rm -rf "$dest"; mv "$dest.new" "$dest"
echo "installed into $dest ($(du -sh "$dest" | cut -f1))"
