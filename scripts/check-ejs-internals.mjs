#!/usr/bin/env node
// Checks that every EmulatorJS internal this project relies on still exists in
// the pinned copy (web/ejs/, installed by scripts/fetch-emulatorjs.sh).
// Run after every EJS_COMMIT / CORE_VERSION bump; `npm test` runs it too.
// The list mirrors docs/emulatorjs-internals.md. Exit code 1 if anything is gone.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ejs = path.join(root, "web", "ejs");

// [file under web/ejs/, regex, what we use it for]
export const INTERNALS = [
  ["loader.js", /EJS_defaultOptions/, "core options the core starts with (pinned per game)"],
  ["loader.js", /EJS_disableLocalStorage/, "stop saved settings overriding the game file"],
  ["loader.js", /EJS_netplayServer/, "netplay server URL"],
  ["loader.js", /EJS_paths/, "map emulator.min.* to the unminified pinned sources"],
  ["src/emulator.js", /this\.netplay\s*=\s*new Netplay/, "EJS_emulator.netplay object"],
  ["src/emulator.js", /config\.defaultControllers[\s\S]{0,400}\.\.\.config/, "button table is MERGED into defaults (we clear unused bindings)"],
  ["src/emulator.js", /saveSettings\(\)\s*\{/, "wrapped to save remaps in our own storage"],
  ["src/emulator.js", /gamepadSelection/, "controller-to-player slots"],
  ["src/emulator.js", /getGamepadSelectionValue\(gamepadIndex\)[\s\S]{0,300}gamepad\.id \+ "_" \+ gamepad\.index/, "slot value format id_index"],
  ["src/emulator.js", /getCoreSettings\(\)/, "defaultOptions -> retroarch core config"],
  ["src/GameManager.js", /simulateInput:\s*this\.Module\.cwrap\("simulate_input"/, "wrapped for host input delay and the guest input filter path"],
  ["src/GameManager.js", /getFrameNum:\s*this\.Module\.cwrap\("get_current_frame_count"/, "frame clock for the delay queue (postMainLoop never fires)"],
  ["src/GameManager.js", /EmulatorJSGetState/, "save-state entry point we shim from save_state_info"],
  ["src/GameManager.js", /loadState\(state\)/, "instant rematch loads the title-screen state"],
  ["src/GameManager.js", /restart\(\)/, "rematch fallback"],
  ["src/netplay.js", /defineNetplayFunctions\(\)/, "set up netplay without the globe menu"],
  ["src/netplay.js", /openRoom\(rn, mp, pw\)/, "host opens the room"],
  ["src/netplay.js", /getOpenRooms\(\)/, "room list"],
  ["src/netplay.js", /leaveRoom\(\)/, "leave"],
  ["src/netplay.js", /dataMessage\(d\)/, "wrapped to route our {tsl:...} messages"],
  ["src/netplay.js", /sendMessage\(d\)/, "roster / rematch / hello messages"],
  ["src/netplay.js", /this\.peerConnections\[peerId\]\s*=\s*\{[\s\S]{0,80}pc:/, "host input filter maps a data channel back to its peer"],
  ["src/netplay.js", /createDataChannel\("inputs"/, "guest inputs travel on this channel"],
  ["src/netplay.js", /JSON\.stringify\(\{ player: pidx, index, value \}\)/, "input message format the guest client sends"],
  ["src/netplay.js", /type === "host-left"/, "host-left message the guest client handles"],
  ["src/netplay.js", /captureStream\(30\)/, "netplay-tuning.js raises this to STREAM_FPS"],
  ["src/netplay.js", /maxFramerate\s*=\s*30/, "netplay-tuning.js raises this to STREAM_FPS"],
  ["src/netplay.js", /"users-updated"/, "socket event: room roster"],
  ["src/netplay.js", /"webrtc-signal"/, "socket event: offer / answer / candidate / requestRenegotiate"],
  ["src/netplay.js", /"open-room"/, "socket event"],
  ["src/netplay.js", /"join-room"/, "socket event (also used directly by guest-client.js)"],
  ["src/netplay.js", /"data-message"/, "socket event"],
  ["src/netplay.js", /pc\.createOffer\(\)/, "host sends the offer; guest-client.js only answers"],
  ["src/vendor/socket.io.min.js", /Socket\.IO v4\./, "socket.io client the guest client loads"]
];

export function check() {
  if (!fs.existsSync(path.join(ejs, "loader.js"))) return { skipped: true, missing: [] };
  const cache = {};
  const missing = [];
  for (const [file, re, why] of INTERNALS) {
    const f = path.join(ejs, file);
    cache[f] ??= fs.existsSync(f) ? fs.readFileSync(f, "utf8") : null;
    if (cache[f] === null || !re.test(cache[f])) missing.push({ file, pattern: String(re), why });
  }
  return { skipped: false, missing };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const r = check();
  if (r.skipped) { console.log("web/ejs not installed; run scripts/fetch-emulatorjs.sh first"); process.exit(0); }
  const pinned = JSON.parse(fs.readFileSync(path.join(root, "web", "ejs", "PINNED.json"), "utf8"));
  if (!r.missing.length) { console.log(`all ${INTERNALS.length} EmulatorJS internals present (commit ${pinned.emulatorjs_commit.slice(0, 10)}, core ${pinned.core_fbneo})`); process.exit(0); }
  console.error("EmulatorJS internals missing or changed:");
  for (const m of r.missing) console.error(`  ${m.file}: ${m.pattern}  (${m.why})`);
  process.exit(1);
}
