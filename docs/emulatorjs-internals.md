# EmulatorJS internals this project depends on

EmulatorJS has a small public configuration surface (`EJS_*` globals). Host netplay quality, rematch, the guest client and controller handling need more than that, so the project reaches into EmulatorJS internals. They are all listed here; `scripts/check-ejs-internals.mjs` checks each one against the pinned copy and `npm test` runs it.

Pinned: EmulatorJS commit and fbneo core version in `scripts/fetch-emulatorjs.sh` (and `deploy/Dockerfile.web`). `web/ejs/PINNED.json` records what is installed.

## Where each dependency is used

| EmulatorJS surface | Used in | For |
|---|---|---|
| `EJS_defaultOptions` | `netplay-bridge.js` | Core options the core actually starts with. `EJS_coreOpts` only changes the settings-menu defaults |
| `EJS_disableLocalStorage` | `netplay-bridge.js` | Otherwise saved settings and buttons override each game file |
| `EJS_paths` | `netplay-bridge.js` | Point `emulator.min.*` at the unminified pinned sources |
| `EJS_defaultControls` merge behaviour | `games.js` `controls()` | EmulatorJS merges our table into its defaults, so unused bindings are cleared explicitly |
| `EJS_emulator.netplay` (`Netplay`) | `netplay-bridge.js` | Room handling without the globe menu |
| `netplay.defineNetplayFunctions`, `openRoom`, `getOpenRooms`, `leaveRoom` | `netplay-bridge.js` | Host room lifecycle |
| `netplay.owner`, `players`, `playerID`, `name`, `url`, `updateList` | `netplay-bridge.js` | Host state |
| `netplay.peerConnections[socketId].pc` | `netplay-bridge.js` `hostInputFilter` | Map a data channel back to its peer to decide Player 2 vs spectator |
| `netplay.dataMessage(d)` (wrapped) / `sendMessage(d)` | `netplay-bridge.js` | Our `{tsl: ...}` messages: hello, roster, rematch |
| `gameManager.functions.simulateInput` (wrapped) | `netplay-bridge.js` | Host input delay; every input (local and guest) passes through it |
| `gameManager.getFrameNum` (`get_current_frame_count`) | `netplay-bridge.js` | Frame clock for the delay queue. `Module.postMainLoop` never fires in this build |
| `gameManager.getState` / `Module.EmulatorJSGetState` / `save_state_info` | `netplay-bridge.js` `shimSaveStates` | The published core lacks `EmulatorJSGetState`; rebuilt from `save_state_info` |
| `gameManager.loadState`, `restart` | `netplay-bridge.js` | Instant rematch and its fallback |
| `functions.setVariable` | tests only | Toggling options at runtime |
| `EJS_emulator.controls`, `saveSettings` (wrapped) | `netplay-bridge.js` | Remaps saved per game in our own storage |
| `frontend.gamepadSelection`, `checkGamepadInputs`, `getGamepadSelectionValue` format (`id_index`) | `netplay-bridge.js` | Controller-to-player assignment |
| Netplay wire protocol: socket events `open-room`, `join-room`, `users-updated`, `webrtc-signal`, `data-message`, `leave-room`; host sends the offer; data channel `inputs` carrying `{player, index, value}`; `{type: "host-left"}` | `guest-client.js` | The ROM-free guest speaks this protocol directly |
| `captureStream(30)`, `maxFramerate = 30`, `setParameters` | `netplay-tuning.js` | Raised to `STREAM_FPS` by wrapping the browser APIs, not EmulatorJS |
| `src/vendor/socket.io.min.js` (v4) | `guest-client.js` | Socket.IO client loaded from the EmulatorJS path |

## Bumping EmulatorJS or the core

1. Change `EJS_COMMIT` / `CORE_VERSION` in `scripts/fetch-emulatorjs.sh` **and** `deploy/Dockerfile.web`.
2. `scripts/fetch-emulatorjs.sh`
3. `npm test`. The internals check must pass. If a pattern no longer matches, read the new EmulatorJS source, adapt the code that uses it, then update the pattern in `scripts/check-ejs-internals.mjs` and this table.
4. In a browser with the test lobby (`scripts/dev.sh`):
   - Host each game: it boots, runs at 60 fps, and the core options apply (3rd Strike: holding Start does **not** open the test menu).
   - Join from a second browser **without a ROM**: video and sound arrive, keys and a controller drive Player 2.
   - A spectator who joins before the opponent does not get Player 2.
   - Input delay 0/2/4/8: `TSL.Netplay.debugDelay()` releases presses exactly that many frames later.
   - Rematch after a coin returns instantly to the title screen.
   - Buttons on each board's input test (see README, Controls) after a **core** bump.
   - Re-measure the threaded core in a pop-out tab; it gave no gain on CPS-3 last time.
5. Commit the bump with the check results.
