#!/usr/bin/env bash
# Local dev: netplay server on :4000, web on :8080. Serves roms/ (PACKAGED_ROM=1)
# to anyone who can reach this machine; set HOST=127.0.0.1 to keep it local.
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
trap 'kill 0' EXIT
PORT=4000 "$here/scripts/netplay-server.sh" &
sleep 1
PORT=8080 PACKAGED_ROM="${PACKAGED_ROM:-1}" NETPLAY_URL="${NETPLAY_URL:-http://localhost:4000}" node "$here/server/serve.js"
