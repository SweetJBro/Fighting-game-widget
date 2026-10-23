#!/usr/bin/env bash
# Builds (once) and runs the official EmulatorJS netplay server (Rust, socket.io).
# PORT defaults to 4000. Requires cargo.
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
dir="$here/netplay-server"
if [ ! -d "$dir" ]; then
  git clone --depth 1 --branch rust https://github.com/EmulatorJS/EmulatorJS-Netplay "$dir"
fi
cd "$dir"
cargo build --release
PORT="${PORT:-4000}" exec ./target/release/rust-socket-server
