# Roadmap

Where Fighting Game Matrix Widget goes next. Netplay stays host streaming: the host runs the game and streams it, everyone else sends inputs or watches. Rollback is out of scope.

Difficulty: **S** under a day, **M** a few days, **L** a week or two.

Measurements were taken in Chromium on the maintainer's Linux desktop with every player in one browser on one machine, so ping was ~0 ms. Real connections will be worse.

## Done

### Phase 1: netplay quality (merged into `main`)

| Task | Result |
|---|---|
| Host input delay 0-8 frames, default 3 | Presses land exactly 0/2/4/8 core frames later |
| 60 fps stream, bitrate to match, guest jitter buffer 0 | Stream 59-60 fps (EmulatorJS default 30) |
| Pop out / open in new tab, cross-origin isolated | Own full-size tab; threaded core loads |
| Connection quality in lobby and match | Server ping, challenge estimate, peer ping, stream fps, route, loss |
| Performance warning under 50 fps | Shows and clears itself |
| EmulatorJS pinned by git commit + npm core | `scripts/fetch-emulatorjs.sh`, baked into the web image |

### Matches: rematch, spectators, save states, errors (`matches-rematch-spectators`)

| Task | Result |
|---|---|
| Save states fixed | Shim rebuilds `Module.EmulatorJSGetState` from the core's `save_state_info`; 9.8 MB state, quick save works |
| Rematch without reload | Host restarts the game in place; the opponent can ask, the host gets a prompt. Room, peers and stream stay up |
| Spectators | `MAX_SPECTATORS` (default 2) extra seats. Watch buttons in the standalone list and the Matrix widget's Live matches, watch links for the host and the Fluxer bot |
| Host decides who is Player 2 | First joiner who asked to play gets P2; the host remaps that peer's inputs to P2 and drops everyone else's. Verified: a spectator who joined first was numbered P2 by EmulatorJS and was ignored, and the real opponent's presses were moved from P3 to P2 |
| Clearer errors | Netplay server unreachable (blocked before the match starts), no peer route (TURN advice), joining a full match, being moved to spectator |

Findings along the way:

* **Input delay makes matches fairer, not faster.** The guest always pays a full round trip; delaying the host evens the two sides.
* **The threaded core is not faster for CPS-3** (~1575 vs ~1530 uncapped frames/s). Pop-out helps because it is a full-size tab outside the chat that players keep in front.
* **`Module.postMainLoop` never fires** in current EmulatorJS, so its own netplay frame counter stays at 0. Our input delay polls `get_current_frame_count` instead.
* **EmulatorJS numbers netplay players by join order**, so without the host-side remap a spectator could take Player 2.
* **Hidden tabs stop entirely.** A background or hidden tab runs no animation frames, so the host's game freezes. The performance banner and pop-out exist for this.
* **`EJS_coreOpts` does not set core options.** It only changes the defaults EmulatorJS's settings menu shows; `EJS_defaultOptions` is what reaches the core.
* **EmulatorJS merges button tables.** Its default keyboard bindings for the analog sticks (i/j/k/l) survive unless explicitly cleared.
* **A rematch reboots the CPS-3 board**, which takes several seconds of black screen and the region warning before the title.

### Phase 2: multiple games (`phase2-multigame`)

| Task | Result |
|---|---|
| Game definitions | `web/games/<id>.json` per game (format in [`game-adapter.d.ts`](game-adapter.d.ts)), listed in `web/games/index.json`. Lobby, ROM store, server, netplay bridge and Fluxer bot read them; no 3rd Strike logic is left in code |
| Manifests from FBNeo's DAT | `scripts/romset.py manifest` reads the libretro/FBNeo arcade DAT; clone files fold into the game zip, BIOS files into the BIOS zip |
| Generic merge / verify / BIOS tool | `scripts/romset.py`; `merge-romset.py` kept as a 3rd Strike wrapper |
| ROM store per game + shared BIOS | IndexedDB keys `rom:<id>`, `bios:<id>`; every zip checked in the browser by reading its central directory against the manifest; old single 3rd Strike entry migrates |
| Packaged files per game | Any game or BIOS zip in `roms/` is served and advertised |
| Game picker, per-game rooms, links | Top-bar picker; each game has its own netplay namespace (`netplayId`); `?game=` on every link |
| Matrix `game` field | Challenges and accepts carry it (missing = 3rd Strike); widget tags each challenge and live match; accepting a game you lack opens the ROM screen first and only then sends the accept |
| Fluxer `!fight <game> @rival` | Game ids and aliases; game list read from the lobby |
| Two more games | Super Street Fighter II Turbo (`ssf2xjr1`, CPS-2) and The King of Fighters 2002 (`kof2002`, Neo Geo + `neogeo.zip`). Both boot at 60 fps; KOF host and guest connected in their own namespace |
| Buttons verified on the boards | Every button of all three games checked in the board's own input test (CPS-3 and CPS-2 test menus, Neo Geo MVS I/O check), and every key checked to fire exactly one input |
| Core options actually applied | They were only reaching the settings menu (`EJS_coreOpts`); now passed as `EJS_defaultOptions`, which the core starts with. EmulatorJS's own settings storage is off so a saved copy cannot override them |
| No test menu mid-match | FBNeo's default "hold Start" shortcut to the operator menu is off for every game |
| Controllers | Standard fighting-game pad / Xbox-mode stick layout for all games; unused EmulatorJS default pad bindings cleared (RT no longer also fires "R2"); left stick and D-pad move; players 2-4 get pad bindings; Local match mode for two controllers on one machine with a controller-to-player picker remembered by controller name; remaps saved per game. Tested on the CPS-2 input test with two simulated controllers, then with real hardware: a Qanba Q4 Pro-X stick as Player 1 and a Steam Controller (Steam Input, Gamepad desktop layout) as Player 2, every button and direction landing on the right player |
| Stray stick inputs fixed | EmulatorJS merges our button table into its defaults, which bound i/j/k/l to the right analog stick; those keyboard bindings are now cleared (gamepad sticks kept) |

### Polish

| Task | Result |
|---|---|
| Instant rematch | Board state saved at the first coin of the session (title/attract, no credits); rematch loads it instead of rebooting. Verified on Super Turbo and 3rd Strike: character select back to the attract screen at once |
| Matrix-aware Player 2 | A challenge to a member, or the accepter of an open challenge, reserves Player 2 for that Matrix id. Verified with scripted joiners: an earlier joiner asking to play was made a spectator, the named member got Player 2 |
| Host-chosen watch seats | Lobby picker 0-6, remembered per browser; room capacity follows it (a joiner beyond it gets "Room full") |
| Game file generator | `romset.py add DAT SET` writes a complete game file; it reproduces the three hand-checked games |
| Steam pad renumbering | Remembered controller-to-player choice survives Steam renaming "pad 2" to "pad 0" (verified with simulated pads) |

### Hosting only (ROM-free guests)

| Task | Result |
|---|---|
| Guests and spectators need no ROM | `guest-client.js` speaks EmulatorJS's netplay protocol directly (socket.io join, answer the host's WebRTC offer, video/audio, inputs over the data channel) without loading EmulatorJS. Verified: guest connected as Player 2 with no emulator, core or ROM fetched; keyboard and controller inputs reached the host as Player 2; spectator inputs ignored; rematch request reached the host |
| Fightcade's split files accepted as picked | The ROM screen takes `sfiii3nr1.zip` + `sfiii3.zip` (or any clone + parent) together or one after the other and combines them in the browser by copying compressed entries (67 MB in about 40 ms). Verified byte-level with Python's zip reader and the manifest |
| Chooser fix | The file input is reset after each pick, so picking the same file again works; results show in a message box instead of small red text |
| Server reads Fightcade's folder | `ROMS_DIR` can be `ROMs/fbneo`: complete sets served, split pairs assembled in memory, incomplete sets skipped. Verified: 3rd Strike and Super Turbo assembled, Super Turbo hosted from it at 60 fps |

### Backlog pass (November 2026)

From a review of architecture, tests, UX, ops and docs. Everything the host-streaming design keeps: the clean ROM-free guest path and "only the host needs the ROM".

| Task | Result |
|---|---|
| Automated tests (`npm test`, Node's runner, no dependencies) | 28 tests: zip central directory, manifest check (size + CRC, renamed ok, wrong revision not), clone + parent assembly byte-checked, encrypted entries skipped, zip64 rejected; Player 2 roster rules incl. Matrix reservation; input delay queue timing and ordering; ROM store file matching; packaged-set resolution on disk and in memory; every game file against its schema; every EmulatorJS internal against the pinned copy. CI workflow for GitHub and Forgejo Actions |
| Shared zip code | `web/js/zipcore.js` is pure (reads through a callback) and is used by both the browser (`games.js`, Blob slices) and the server (`romsets.js`, file reads); the two copies are gone |
| Pure match logic | `web/js/match-logic.js`: `decideRoster` and `DelayQueue`, used by `netplay-bridge.js` and the tests |
| `app.js` split | 690 lines to 283, plus `web/js/ui/` (rom-screen, matrix-ui, match-screen, pads-panel), modules installed on one shared `ctx`; `netplay-bridge.js` lost its inline roster and queue code |
| EmulatorJS internals documented and checked | [`emulatorjs-internals.md`](emulatorjs-internals.md): every surface we touch, where and why, plus the bump checklist; `scripts/check-ejs-internals.mjs` fails `npm test` when one disappears |
| Game file validator | `scripts/validate-games.mjs` (schema, unique netplayIds, key and pad collisions, CRC format); `romset.py add` runs it |
| ROM onboarding | ROM screen names every zip the game needs (e.g. `sfiii3nr1.zip` and `sfiii3.zip`) and the Fightcade folder to pick them from; a how-to list was tried and removed as noise |
| Lag explanation | Next to the host's delay picker: "≈50 ms you · ≈90 ms them" (delay in frames vs. peer round trip plus a video frame each way) |
| Server observability | JSON-lines log (`LOG_FORMAT=text` for humans): sets assembled or skipped, ROMs served, 404s, failures. `/status.json` and `status.html`: netplay reachability from the web server and open rooms per game |
| Packaged ROM hygiene | `Content-Disposition: attachment`, `nosniff`, `noindex`; only advertised files are ever served |
| Docs | README: architecture diagram, full environment table, layout; [`TROUBLESHOOTING.md`](TROUBLESHOOTING.md) |

### Controllers pass (November 2026)

| Task | Result |
|---|---|
| Controller rules in one pure module | `web/js/pad-logic.js`: preferred pad, Steam renumbering, which pads the guest reads (`pickPads`), the player slots the host/local emulator should use (`desiredSelection`), reset. 8 unit tests |
| Diagnostics in the Controls panel | Per controller: name, live activity dot, "non-standard layout" tag, what it does in this match (drives Player 1 / sent as Player 2 / ignored and why). Empty list shows the Steam Desktop Layout fix |
| One preferred controller (host and guest) | **Use this** per controller, remembered by name. Host: it takes Player 1 and every other local pad is removed from the slots, so a second pad can never drive the remote opponent's Player 2. Guest: only it is read; without a choice, every standard-layout pad merged; a pad that stops being read releases its held inputs |
| Choices survive EmulatorJS | EmulatorJS refills player slots on every `gamepadconnected`; the remembered choices are re-applied once a second while the game runs. "Not playing" is stored (-1) so a reconnecting pad stays out |
| Guest stick and layout | Stick threshold 0.35 (was 0.5); non-standard pads skipped unless preferred, with one console warning |
| Reset | **Reset controller settings** removes `tsl.padPlayers`, `tsl.preferredPad` and `tsl.controls.*`, restores the game's default table in the running emulator |
| Docs | README Controls; TROUBLESHOOTING "Controllers" with console snippets from support sessions |

Not done: the optional `netplay-bridge.js` split. The pad rules moved out into `pad-logic.js`; the EmulatorJS glue (apply, assign, reset) stayed in the bridge next to the emulator it drives.

### Review pass (November 2026)

| Task | Result |
|---|---|
| Spectator bandwidth | Seats picker says "N watchers ≈ up to X Mbps upload in all" from `STREAM_BITRATE_DIRECT` |
| Connection advice | Banner kinds: no route (TURN), slow host, choppy guest video, poor ping, relay in use; each names what helps and can be dismissed for the session |
| TURN | `docker compose --profile turn` runs coturn (host networking); `.env.example` has the `TURN_*` block and matching `ICE_SERVERS` |
| Storage | ROM screen: stored total vs browser quota, **Forget all stored ROMs**, **Download zip** of a stored set; quota-exceeded becomes a plain message and the picked pieces stay for a retry |
| Fluxer bot | `!fight watch CODE` / `!watch`, `!fight status` / `!status` from `/status.json`, help with every game and alias; 3 tests |
| UX | Role badge reads "You host · Player 1" / "You are Player 2" / "You are watching" with a colour per role and the tab title repeats it; headings take focus on screen change; the drop zone is keyboard-operable |
| Matrix events | Content carries `v: 2`; type name kept for rooms that already have the widget |
| Ops | Health checks for web and netplay; status page warns when `PACKAGED_ROM=1`; CI caches the EmulatorJS pin and fails fast on schema and internals |
| Docs | `CONTRIBUTING.md`: where things live, adding a game, bumping EmulatorJS, manual verification matrix |

## Next

Roughly by impact over effort.

| Task | Size | Notes |
|---|---|---|
| Two-machine test | S | Needs two people on separate connections. Confirms the default delay of 3 and the 60 fps stream on a home uplink; measure real guest lag against the in-page estimate. Element's widget iframe sandbox includes `allow-popups allow-popups-to-escape-sandbox`, so pop-out should work there. Also: strict NAT + TURN, several spectators, rematch with several concurrent joiners |
| Split `netplay-bridge.js` further | M | Still ~520 lines: EmulatorJS lifecycle, pad remapping, rematch/save-state and the message hooks could each be a file. Needs a netplay retest, so do it with the two-machine test |
| Performance mode | M | Drop stream resolution or fps when the host is under the threshold, if `setParameters` allows it without renegotiation |
| Accessibility | S | Full keyboard pass through lobby and match bar with visible focus everywhere; screen-reader labels on the match bar stats |
| More games | S each | One JSON file per FBNeo arcade game: `romset.py add DAT SET`, then check buttons and region DIP |
| Optional error reporting | S | Behind a flag: stack, game, browser, role, logged structured or posted to an endpoint |
| Longer term | | Voice chat overlay, post-match GG prompt outside Matrix, mobile spectator view, controller overlay for streamers. Not planned: rollback (a different architecture), shipping ROMs, a frontend framework |

## CPS-3 in WebAssembly: numbers and risks

| Measurement | Value |
|---|---|
| Normal speed, visible tab | 59.9-60.5 fps |
| Uncapped emulation | ~1530 fps single-threaded, ~1575 threaded (upper bound) |
| Save state | 9.82 MB, captured in ~1.3 ms |
| Hidden tab | 0 fps (no animation frames); background tab 7-24 fps |
| Rematch (board restart) | Several seconds of black screen and the region warning before the title |

* **Upload per spectator.** At 60 fps and up to 4 Mbps per viewer, two spectators triple the host's upload. `MAX_SPECTATORS` caps it; `STREAM_BITRATE_DIRECT` trades sharpness for bandwidth.
* **Weak CPUs.** CPS-3 is comfortable on a desktop. Laptops and phones may host below 60 fps; the banner tells them, and the better-equipped player should host.
* **Safari** has no `COEP: credentialless`, so pop-out there is not isolated. It measured the same speed, so this costs nothing today.
* **EmulatorJS drift.** We depend on internals: the netplay client's `peerConnections`, `players`, `dataMessage`, `sendMessage`, `gameManager.functions.simulateInput`, `get_current_frame_count`, `save_state_info`. Pinning protects production; every pin bump needs a netplay retest.
