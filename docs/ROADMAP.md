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

## Next

| Task | Size | Notes |
|---|---|---|
| Two-machine test | S | Needs two people on separate connections. Confirms the default delay of 3 and the 60 fps stream on a home uplink. Element's widget iframe sandbox includes `allow-popups allow-popups-to-escape-sandbox`, so pop-out should work there |
| Check KOF 2002 buttons in game | S | The A/B/C/D layout follows FBNeo's default Neo Geo mapping from its source; confirm each button in the game's own test menu |
| More games | S each | One JSON file per FBNeo arcade game: `romset.py manifest`, buttons, a new `netplayId` |
| Instant rematch | S | Capture a save state at the title screen on first boot and load it instead of restarting; skips the ~10 s board boot. The save-state shim makes this possible |
| Gamepad remapping UI | M | On top of EmulatorJS's control settings, saved per game per browser |
| Spectator cost control | S | Each spectator is one more video encode on the host. Show the host how many are watching (done) and let them close spectator seats |
| Assign P2 by Matrix identity | S | In the widget, the challenge already names the opponent; pass it into the roster so only that member can take P2 |

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
