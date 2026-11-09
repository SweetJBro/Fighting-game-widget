#!/usr/bin/env bash
# Bump the pinned EmulatorJS commit (and optionally the fbneo core version) in
# both places that hold it, install it, and run the checks. Prints the manual
# netplay checklist at the end; see docs/emulatorjs-internals.md.
#   scripts/bump-ejs.sh <EJS_COMMIT> [CORE_VERSION]
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
commit="${1:-}"; core="${2:-}"
[ -n "$commit" ] || { echo "usage: $0 <EJS_COMMIT> [CORE_VERSION]" >&2; exit 2; }
[[ "$commit" =~ ^[0-9a-f]{40}$ ]] || { echo "EJS_COMMIT must be a full 40-hex git commit" >&2; exit 2; }

sed -i -E "s/^(EJS_COMMIT=\"?\\$\\{EJS_COMMIT:-)[0-9a-f]{40}/\\1$commit/; s/^EJS_COMMIT=[0-9a-f]{40}/EJS_COMMIT=$commit/" "$here/scripts/fetch-emulatorjs.sh"
sed -i -E "s/^ARG EJS_COMMIT=[0-9a-f]{40}/ARG EJS_COMMIT=$commit/" "$here/deploy/Dockerfile.web"
if [ -n "$core" ]; then
  sed -i -E "s/^(CORE_VERSION=\"?\\$\\{CORE_VERSION:-)[0-9.]+/\\1$core/; s/^CORE_VERSION=[0-9.]+/CORE_VERSION=$core/" "$here/scripts/fetch-emulatorjs.sh"
  sed -i -E "s/^ARG CORE_VERSION=[0-9.]+/ARG CORE_VERSION=$core/" "$here/deploy/Dockerfile.web"
fi
grep -n "EJS_COMMIT\|CORE_VERSION" "$here/scripts/fetch-emulatorjs.sh" "$here/deploy/Dockerfile.web" | grep -v "^.*#" | head -6

echo "== installing into web/ejs/"
"$here/scripts/fetch-emulatorjs.sh"
echo "== internals + tests"
(cd "$here" && npm run check:ejs && npm test)

cat <<'TXT'

== Manual checklist (two browsers, scripts/dev.sh)
  [ ] Host each game: boots, 60 fps, core options apply (3rd Strike: holding Start does NOT open the test menu)
  [ ] Join from a second browser without a ROM: video + sound, keys and a controller drive Player 2
  [ ] A spectator who joins before the opponent does not get Player 2
  [ ] Input delay 0/2/4/8: TSL.Netplay.debugDelay() releases presses exactly that many frames later
  [ ] Rematch after a coin returns instantly to the title screen
  [ ] Core bump only: every button on each board's input test
  [ ] Pop-out tab: threaded core loads (or THREADS=0); re-measure on CPS-3
Then bump the ?v= suffix in web/index.html and commit with the results.
TXT
