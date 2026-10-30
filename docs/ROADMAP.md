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

## Next

| Task | Size | Notes |
|---|---|---|
| Two-machine test | S | Needs two people on separate connections. Confirms the default delay of 3 and the 60 fps stream on a home uplink. Element's widget iframe sandbox includes `allow-popups allow-popups-to-escape-sandbox`, so pop-out should work there |
| More games | S each | One JSON file per FBNeo arcade game: `romset.py manifest`, buttons, a new `netplayId` |

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
