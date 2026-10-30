# Roadmap

Where Fighting Game Matrix Widget goes after the first release, in order. Difficulty: **S** under a day, **M** a few days, **L** a week or two, **XL** a project of its own.

Measurements below were taken on the maintainer's Linux desktop in Chromium, with host and guest in the same browser on one machine, so ping is ~0 ms and real-world numbers will be worse.

## Phase 1: netplay quality (done on branch `phase1-netplay-quality`)

| Task | Size | Status |
|---|---|---|
| Host input delay, 0-8 frames, default 3, live picker | S | Done. Verified: presses land exactly 0/2/4/8 core frames later. |
| 60 fps stream, bitrate to match, frame rate over resolution, guest jitter buffer 0 | S | Done. Stream measured at 59-60 fps (was 30), `maxBitrate` 4 Mbps, `jitterBufferTarget` 0 on live receivers. |
| Pop out / open in new tab, cross-origin isolated | S | Done. Isolated tab loads `fbneo-thread-legacy-wasm.data` and runs at 60 fps. |
| Connection quality in lobby (server ping, challenge estimate) and in match (ping, stream fps, route, loss) | S | Done. |
| Performance warning under 50 fps for 3 s | S | Done. |
| Pin EmulatorJS | S | Done: git commit + npm core via `scripts/fetch-emulatorjs.sh`, baked into the web image. |

What Phase 1 found that changes the plan:

* **Guest inputs were already peer to peer.** EmulatorJS sends them over an ordered WebRTC data channel, not through the netplay server, so there was no transport win left there.
* **Input delay makes matches fairer, not faster.** In a streaming design the guest always pays one round trip plus encode, decode and display. Delaying the host evens the two sides. Nothing on the host can shorten the guest's loop.
* **The threaded core is not faster for CPS-3.** Uncapped emulation measured ~1575 frames/s threaded vs ~1530 single-threaded, inside noise. Pop-out still helps because it is a full-size tab outside the chat client that players keep in front, and browsers throttle background tabs to 7-24 fps.
* **`Module.postMainLoop` never fires in current EmulatorJS.** EmulatorJS's own netplay frame counter (`netplay.currentFrame`) stays at 0, so its frame-tagged `sync-control` path is dead code. Our delay queue polls the core's `get_current_frame_count` on each animation frame instead.
* **Save states are broken with the published core.** EmulatorJS main calls `Module.EmulatorJSGetState`, which the fbneo core build on npm and the CDN (2025-06-14) does not export. The older `save_state_info` export still works, and the measurements below use it. Spectator late-join and rematch-from-state depend on this; see Phase 4.

## Phase 2: multi-game, Fightcade-style (M overall)

| Task | Size |
|---|---|
| Move 3rd Strike data into `web/games/sfiii3nr1.json` following [`game-adapter.d.ts`](game-adapter.d.ts); lobby, bridge and ROM store read the adapter | M |
| ROM store keyed by adapter id; one stored set per game; in-browser CRC check against `rom.members` (JSZip, ~100 kB) | M |
| Matrix challenge events gain `game: <id>`; old events without it default to `sfiii3nr1` | S |
| Game picker in the lobby and the Fluxer bot (`!fight sfiii3nr1 @rival`) | S |
| Generalise `scripts/merge-romset.py` into a driver: reads the manifest from the adapter JSON, merges clone + parent for any FBNeo set | S |
| Second game to prove it: a CPS-2 title (e.g. `ssf2t`) or Garou (`garou`, Neo Geo, needs `neogeo.zip` BIOS handling) | M |

Keep `merge-romset.py` as the single tool; per-game logic becomes data (the manifest and parent name), not new scripts.

## Phase 3: netplay evolution (XL)

Streaming stays the default. Rollback is only possible when **both** players run the emulator and exchange inputs; it cannot be retrofitted onto the host-runs-everything design.

The library is the small part. The blocker is that EmulatorJS has no way to run *exactly one frame with these inputs, now*: RetroArch owns the main loop and drives it from `requestAnimationFrame`. Rollback needs a host that can call `retro_unserialize`, then `retro_run` N times synchronously, then present. So:

| Task | Size |
|---|---|
| Build FBNeo's libretro core to WebAssembly with Emscripten as a bare core (no RetroArch), exporting `retro_run`, `retro_serialize(_size)`, `retro_unserialize`, input and A/V callbacks | L |
| Minimal JS libretro frontend: WebGL blit of the frame buffer, AudioWorklet ring buffer, input polling | L |
| Rollback session over the existing WebRTC data channel and netplay-server signalling | M |
| Desync detection: hash a few KB of game RAM every N frames, not the full 10 MB state | S |
| Adapter declares `netplay.modes`; lobby offers rollback only when both browsers pass a speed check | S |

### Library recommendation

| | `rollback-netcode` 0.0.6 | `@zakkster/lite-rollback` 1.2.1 |
|---|---|---|
| Shape | `Game` interface: `serialize`, `deserialize`, `step(inputs)`, `hash` | Typed-array snapshot ring + GGPO-style `Session` |
| Transport | WebRTC data channels included, or bring your own | None |
| Fit for an emulator | Good: an emulator is exactly serialize/deserialize/step | Awkward: built for fixed typed-array fields; a 10 MB opaque state per slot |
| Maturity (Oct 2026) | 2 versions since Jan 2026, "APIs may change", ~6 downloads/week | 7 versions since Jun 2026, ~13 downloads/week |
| License | MIT | MIT |

Recommendation: **use `rollback-netcode`'s design, vendored and pinned, or write the ~400-line equivalent ourselves.** Its `Game` interface maps one to one onto libretro (`retro_serialize`, `retro_unserialize`, `retro_run`), and it already does prediction, resimulation and hashing. Neither library has enough users to depend on unpinned. `lite-rollback`'s zero-allocation ring is the wrong tool for an opaque multi-megabyte emulator state.

Start rollback on a lighter driver (CPS-1/CPS-2, Neo Geo: far smaller states), then try CPS-3 once the frontend exists.

## Phase 4: quality of life

| Task | Size |
|---|---|
| Spectators: netplay server already allows 4 slots; join extra peers as receive-only video. Late join needs no state because it is just a stream. | M |
| Rematch without reload: reset the core (`system_restart`) and keep the room and peer connection instead of reloading the page | M |
| Gamepad remapping UI on top of EmulatorJS's control settings, saved per game per browser | M |
| Error copy: ROM wrong/split/unknown version, WebRTC failed (suggest TURN), netplay server unreachable, slow host | S |
| Fix save states: pin a core build that exports `EmulatorJSGetState`, or fall back to `save_state_info` in our bridge | S |

## CPS-3 in WebAssembly: risks and numbers

| Measurement | Value |
|---|---|
| Normal speed, visible tab | 59.9-60.2 fps |
| Uncapped (fast-forward, ratio 0) | ~1530 fps single-threaded, ~1575 threaded (~0.65 ms/frame; upper bound, fast-forward may skip presentation work) |
| Savestate size | 9.82 MB (10,295,432 bytes) |
| Savestate capture (`save_state_info` + copy) | 1.3 ms median, 1.8 ms max |
| Savestate load call | ~1 ms, but RetroArch may apply it on the next frame, so treat as a lower bound |
| Hidden or background tab | 7-24 fps |

* **State size dominates rollback.** An 8-frame ring is ~80 MB, saved every frame at ~1.3 ms. A worst-case 8-frame rollback is roughly 1 ms load + 8 × 0.65 ms ≈ 6 ms, inside a 16.7 ms frame on this machine, with much less headroom on laptops.
* **Weak CPUs.** The numbers above are a fast desktop. Before offering rollback the lobby should run a short uncapped benchmark and require several times real-time.
* **Spectators and late join** cannot ship a 10 MB state over a data channel each time. Streaming spectators avoid this entirely.
* **WebGL2 is off** for fbneo (its core report defaults it off), so the legacy core variants load. Fine for CPS-3's 2D output.
* **Safari** lacks `COEP: credentialless`, so pop-out there is not isolated and stays on the single-threaded core. It measured the same speed, so this costs nothing today.
* **Background throttling** is the most common real-world slowdown, hence pop-out and the warning banner.
* **EmulatorJS drift.** We depend on internals: the netplay client, `gameManager.functions.simulateInput`, `get_current_frame_count`. Pinning protects production; every pin bump needs a netplay retest.
