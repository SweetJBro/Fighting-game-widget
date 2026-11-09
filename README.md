# Fighting Game Matrix Widget
Vibecoded by JBro:dewrito.net

Play arcade fighting games against people in your community, from the browser: **Street Fighter III: 3rd Strike**, **Super Street Fighter II Turbo** and **The King of Fighters 2002** out of the box, each the version Fightcade runs. More FBNeo games are a data file away (see [Games](#games)). The page is a Matrix room widget first, with a Fluxer bot and a plain link-out mode alongside.

* **Matrix**: add it to a room as a widget. Members see each other, post or accept challenges, and the match opens inside the widget.
* **Fluxer**: Fluxer has no embedded-app surface, so a bot listens for `!fight @someone` (or `!fight kof @someone`) and posts personalised host/join/watch links to the lobby page.
* **Anywhere else**: the page works on its own. Host a match, share the link.

Emulation is [EmulatorJS](https://emulatorjs.org) running the FBNeo core in WebAssembly. Netplay is EmulatorJS's built-in mode: the **host runs the game and streams video/audio to the guest over WebRTC; the guest's inputs go back as Player 2** over a WebRTC data channel. A small signalling server only sets up the connection. It is not rollback netcode. Expect roughly one network round-trip of input lag on the guest side, so it suits casual sets and same-region play rather than tournaments. See [docs/ROADMAP.md](docs/ROADMAP.md) for where this is going.

## Netplay feel and connection quality

* **Input delay (host).** The host plays with no network lag and the guest with a full round trip, so the host can delay their *own* inputs by 0-8 frames (default 3, picker in the match bar, remembered per browser) to even it out. It makes matches fairer; it cannot make the guest's side faster. Next to the picker: what each side feels ("≈50 ms you · ≈93 ms them") and a recommendation for the current ping (half of what the guest feels, in frames). **auto** lets the page move the delay one frame at a time toward that recommendation, only after several consecutive pings agree and never more than once per five seconds; off by default.
* **60 fps stream.** EmulatorJS captures and encodes the host canvas at 30 fps. `web/js/netplay-tuning.js` raises both to `STREAM_FPS` (default 60), lifts the bitrate cap to match, keeps frame rate ahead of resolution under congestion, and sets the guest's jitter buffer target to 0.
* **Pop out.** "Open matches in a new tab" (on by default inside a chat client) or the Pop out button runs the match in its own full-size tab. That tab is cross-origin isolated (`?isolate=1` gets COOP/COEP), so EmulatorJS also loads its threaded core; on CPS-3 that measured no faster, so the point is a tab you keep in front, outside the chat.
* **Connection quality.** The top bar shows your round trip to the netplay server. Matrix challenges carry the challenger's server ping, so the accepter sees an estimate before accepting. During a match the bar shows emulator fps (host), peer ping, stream fps, direct or relay route and packet loss, with a coloured dot. When the link is poor, or goes through a TURN relay, a banner says what helps (the better-connected player hosting, fewer watch seats, a closer relay); every banner can be dismissed for the session. A host whose tab was hidden is told for how long the game froze when they come back. **Debug** in the match bar copies a report for bug reports: build, browser, game, role, the last ping and stream samples, route, controllers, peers; no credentials and no ROM data.
* **Performance warning.** If the host's emulator stays under the game's threshold (50 fps) for three seconds, a banner says so and why (background tab, chat iframe, or CPU).

## Rematch and spectators

* **Rematch.** Once both players are in, the host has a Rematch button and the opponent has Ask for rematch, which shows the host a prompt. Room, connection and stream stay up. The widget saves the board's state at the first coin of the session, when the game is idle on its title or attract screen, so a rematch returns there instantly instead of rebooting the board; if no coin has gone in yet, it falls back to a reboot. Insert coin and press Start as usual. In a local match the same button is Restart.
* **Spectators.** The host picks how many watch seats their matches have (0-6, **Watch seats** in the lobby, remembered per browser; the server default is `MAX_SPECTATORS`, 2). Watch from a **Watch** button in the open-matches list, from **Live matches** in the Matrix widget (accepted challenges between other members), from the host's **Watch link** button, or from the Fluxer bot's watch link. Spectators get the host's stream and their inputs are ignored. Each one costs the host another video encode and upload; the seats picker says how much ("2 watchers ≈ up to 12 Mbps upload in all" at the default 4 Mbps per viewer). **Watch quality** (full / reduced / minimal) caps the bitrate and frame rate of the stream to watchers only: reduced is about a third of the upload per watcher, minimal a fifth; the opponent always gets the full stream. During a match the host's bar shows the actual upload ("↑ 7.8 Mbps · 2 watching").
* **Who is Player 2.** The host decides. In the Matrix widget, a challenge to a named member, or an open challenge once someone accepts it, reserves Player 2 for that member's Matrix id; anyone else who joins watches. This prevents mix-ups, not impostors, since the id is what the joiner's widget reports. Otherwise the first joiner who asked to play gets Player 2, even if a spectator connected first. Someone who joins a match that already has an opponent is told they are watching.
* **Save states.** EmulatorJS's own save and load paths work again; the published fbneo core lacks the export current EmulatorJS calls, so the bridge rebuilds it from the core's older one.

## Games

| Game | Set | Board | Files to have (see [ROMs](#roms)) |
|---|---|---|---|
| Street Fighter III: 3rd Strike | `sfiii3nr1` (Japan 990512, NO CD) | CPS-3 | `sfiii3nr1.zip`, `sfiii3.zip` |
| Super Street Fighter II Turbo | `ssf2xjr1` (Super SF II X, Japan 940223) | CPS-2 | `ssf2xjr1.zip`, `ssf2t.zip` |
| The King of Fighters 2002 | `kof2002` | Neo Geo | `kof2002.zip`, `neogeo.zip` |

Pick the game in the top bar. Each game has its own stored ROM, its own room namespace on the netplay server (a 3rd Strike lobby never lists a KOF room), its own buttons and its own pinned core options. Matrix challenges carry the game, so the widget shows each challenge's game and asks for the right ROM before accepting. Links carry it as `?game=<id>`; aliases such as `3s`, `st` and `kof` work too.

Each game is one data file, `web/games/<id>.json`, listed in `web/games/index.json`; the format is in [docs/game-adapter.d.ts](docs/game-adapter.d.ts). Adding another FBNeo arcade game needs no code:

```bash
python3 scripts/romset.py add "FinalBurn Neo (ClrMame Pro XML, Arcade only).dat" garou --short Garou --aliases garou,motw
```

`add` writes the game file with the DAT's file list (and BIOS), the verified Capcom-style or Neo Geo button layout, the pinned core options and the next free room id, then lists it. Check the names and any region DIP switch, then pick the game's files on the ROM screen and boot it. The DAT is `dats/FinalBurn Neo (ClrMame Pro XML, Arcade only).dat` in the libretro/FBNeo repository.

## ROMs

**Only the host needs the game.** People who join or watch run no emulator at all: their page shows the host's video and audio and sends their inputs back (`web/js/guest-client.js`). They download no ROM and no core. The repository ships no game data and downloads none.

To host, have the game's FBNeo files and pick them on the ROM screen, together or one after the other:

| Game | Files to pick |
|---|---|
| Street Fighter III: 3rd Strike | `sfiii3nr1.zip` and `sfiii3.zip` |
| Super Street Fighter II Turbo | `ssf2xjr1.zip` and `ssf2t.zip` |
| The King of Fighters 2002 | `kof2002.zip` and `neogeo.zip` |

That is all. The ROM screen opens when you host without the game (or from **ROM** in the top bar), says which file it still needs after the first pick, and keeps the set in this browser's IndexedDB; nothing is uploaded. The screen shows how much is stored and what the browser allows, with **Forget all stored ROMs**; **Download zip** saves a stored set as one file to carry to another browser; a full disk gets a plain message instead of a silent failure. Every file is checked against FinalBurn Neo's list, so a wrong revision gets a clear message instead of a black screen. These are the same sets Fightcade runs, so a Fightcade install has them in its `ROMs/fbneo` folder; any other FBNeo dump of the same set works too.

**For operators.** The page can also serve a set to every visitor: start the web server with `PACKAGED_ROM=1` and `ROMS_DIR` pointing at a folder of sets, which can be Fightcade's `ROMs/fbneo` folder as it is (`scripts/dev.sh` serves `roms/` next to this README by default). Complete sets are served under versioned paths (`roms/v<mtime>/<file>`) and advertised in `/config.json`; incomplete ones are skipped; a set stored in the browser still wins. Serving is opt-in so a folder of ROMs is never published by accident, and it is **not** copied into the Docker image (mount it at `/app/roms`). Whoever can open the page can download the files, so keep a packaged deployment private, and use `HOST=127.0.0.1` to keep a dev server off the LAN.

Under the hood, like Fightcade, the widget reads a game that is split across two zips (a clone and its parent, which is how Fightcade stores 3rd Strike and Super Turbo); the browser build of FBNeo can only load one zip, so the page and the server combine the pair into one before the emulator sees it. `scripts/romset.py` does the same from the command line (`merge`, `verify`, `bios`), for example to build a `roms/` folder by hand. Players never need it.

### Same versions as Fightcade

Fightcade's 3rd Strike is `sfiii3nr1` with Region = Japan and CPU = 100% (its `config/fcadefbneo/games/sfiii3nr1.ini`); the lobby pins the same through each game's `coreOpts`. Every game also turns off FBNeo's "hold Start to open the test menu" shortcut, so holding Start mid-match cannot drop the board into its operator menu. Super Turbo is `ssf2xjr1` and KOF 2002 is `kof2002`, the sets Fightcade's channels use.

## Layout

```
web/              static lobby + player (vanilla JS, no build step)
  js/app.js              entry: config, game picker, standalone and link lobbies, boot
  js/ui/                 screens: rom-screen, matrix-ui (challenges, live matches), match-screen, pads-panel
  js/netplay-bridge.js   host side orchestrator: wires the modules below to EmulatorJS and the UI
  js/ejs-adapter.js      every EmulatorJS internal we touch (one place to fix on a pin bump)
  js/ejs-setup.js        EJS_* configuration and the loader
  js/input-delay.js      host input delay (wraps simulate_input, releases presses by core frame)
  js/roster.js           who is Player 2 and who watches; hellos, Matrix reservation, broadcast
  js/tsl-messaging.js    our { tsl: ... } messages on EmulatorJS's data path
  js/controller-bridge.js  pads, preferred pad and remaps applied to EmulatorJS
  js/match-logic.js      pure: decideRoster, DelayQueue, lag estimates, recommended/auto delay, spectator caps; unit-tested
  js/pad-logic.js        pure: which controller plays (preferred pad, player slots, Steam renumbering), reset; unit-tested
  js/guest-client.js     ROM-free guest/spectator: joins the room, shows the host's stream, sends inputs (no EmulatorJS)
  js/netplay-tuning.js   60 fps stream, bitrate, jitter buffer, peer stats (wraps browser WebRTC APIs, no EmulatorJS fork)
  js/matrix-lobby.js     matrix-widget-api transport, challenge events
  js/games.js            game registry (web/games/*.json); Blob side of the zip check
  js/zipcore.js          pure zip central-directory reading, manifest check, split-set assembly; shared with the server
  js/romstore.js         IndexedDB ROM storage, one set per game plus shared BIOS zips
  games/                 one JSON file per game + index.json
  status.html            netplay reachability and open rooms, from /status.json
server/serve.js   zero-dependency static server; /config.json, /status.json, packaged ROMs; JSON-lines log
server/romsets.js packaged sets: checks them, assembles Fightcade split pairs in memory (uses web/js/zipcore.js)
bot/fluxer-bot.mjs  Fluxer gateway bot (Node 22+, no deps)
scripts/          netplay-server.sh (build + run the official EmulatorJS netplay server), dev.sh,
                  romset.py (manifest / merge / verify / bios / add for any game), merge-romset.py (3rd Strike wrapper),
                  fetch-emulatorjs.sh (install the pinned EmulatorJS + fbneo core into web/ejs/),
                  check-ejs-internals.mjs (every EmulatorJS internal we touch still exists), validate-games.mjs
test/             `npm test`: zip check/assembly, Player 2 roster, delay queue, ROM store, packaged sets, game files, internals
docs/             ROADMAP.md, TROUBLESHOOTING.md, emulatorjs-internals.md, game-adapter.d.ts (game file format)
CONTRIBUTING.md   where things live, adding a game, bumping EmulatorJS, the manual verification matrix
roms/             git-ignored; game and BIOS zips here are served for personal use (see ROMs)
deploy/           Dockerfiles, docker-compose.yml, Caddyfile (TLS for two hostnames)
```

## Architecture

```
            Matrix room events (app.thirdstrike.lobby: challenge / accept / cancel)
   ┌──────────────┐          or a shared link / Fluxer bot link           ┌──────────────┐
   │  HOST page   │ ◄────────────────────────────────────────────────────► │  GUEST page  │
   │ EmulatorJS + │                                                       │ guest-client │
   │ FBNeo + ROM  │ ── socket.io: open-room / join-room / webrtc-signal ── │ (no ROM, no  │
   │              │          via the netplay server (its own origin)      │  emulator)   │
   │              │ ══ WebRTC: video + audio stream (60 fps) ═══════════► │              │
   │              │ ◄═ WebRTC data channel "inputs" {player,index,value} ═ │ keys / pad   │
   └──────────────┘ ◄═ {tsl: hello / roster / rematch} ════════════════► └──────────────┘
          │  host input delay: own presses held N frames (match-logic DelayQueue)
          │  roster: first joiner who asked to play, or the Matrix id the challenge named (decideRoster)
          ▼
   ROM: IndexedDB (rom:<game>, bios:<id>) ◄─ picked zips, split pairs combined by zipcore
        or /roms/v<mtime>/<file> packaged by server/serve.js from ROMS_DIR (PACKAGED_ROM=1)
```

Spectators are guests whose inputs the host drops; each one is another stream the host encodes and uploads.

## Run locally

Requirements: Node 22+, Rust toolchain (for the netplay server), a modern browser.

```bash
scripts/dev.sh
```

That starts the netplay server on `:4000` and the lobby on <http://localhost:8080>. Open two browser profiles (or two machines on the LAN using your LAN IP), pick the game's files in the hosting one (see [ROMs](#roms)), host there and join from the other; the joiner needs no ROM.

Netplay needs a secure context for WebRTC and for the Matrix iframe: `localhost` counts, anything else needs HTTPS.

`npm test` runs the unit tests (Node's built-in runner, no dependencies): zip reading, manifest checks and split-set assembly on both the browser and server paths, the Player 2 roster rules, the input delay queue, the ROM store's file matching, every game file against its schema, and the list of EmulatorJS internals the code relies on against the pinned copy in `web/ejs/` ([docs/emulatorjs-internals.md](docs/emulatorjs-internals.md)). `.github/workflows/test.yml` runs the same on every push (GitHub Actions and Forgejo Actions). `status.html` on the lobby shows whether the web server can reach the netplay server and which rooms are open. Something not working? See [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md).

## Deploy

1. Point two DNS names at the box: one for the lobby (`LOBBY_HOST`), one for the netplay server (`NETPLAY_HOST`). The netplay server must be its own origin, not a sub-path, because the EmulatorJS client treats a path as a socket.io namespace.
2. `cp .env.example .env` and fill it in. Add a TURN server to `ICE_SERVERS` if players sit behind strict NATs.
3. `cd deploy && docker compose up -d --build` (add `--profile fluxer` to run the bot, `--profile turn` for the bundled coturn relay; see `.env.example` for its `TURN_*` settings and the matching `ICE_SERVERS`). The web and netplay containers have health checks; `https://<LOBBY_HOST>/status.html` shows netplay reachability, open rooms and a warning when `PACKAGED_ROM=1`.

EmulatorJS is pinned. `scripts/fetch-emulatorjs.sh` installs EmulatorJS at a fixed git commit plus the fbneo core from npm `@emulatorjs/core-fbneo@4.2.3` into `web/ejs/` (git-ignored), and the server uses it automatically; the web Docker image runs the script at build time. A git commit rather than an npm release is required because `@emulatorjs/emulatorjs@4.2.3`, the newest release, still carries the old netplay client that cannot talk to the current netplay server. Without the pinned copy the page falls back to the moving `https://cdn.emulatorjs.org/latest/data/`. `scripts/bump-ejs.sh <commit> [core-version]` changes both pins, reinstalls, runs the internals check and the tests, and prints the manual netplay checklist.

| Variable | Default | Effect |
|---|---|---|
| `STREAM_FPS` | 60 | Host video capture and encode rate, 15-60 |
| `STREAM_BITRATE_DIRECT` | 4000000 | Max video bits/s on a direct peer path |
| `STREAM_BITRATE_RELAY` | 1500000 | Max video bits/s through TURN |
| `INPUT_DELAY_DEFAULT` | 3 | Host input delay in frames until a player picks one |
| `THREADS` | 1 | `0` stops pop-out tabs loading the threaded core |
| `MAX_SPECTATORS` | 2 | Watch seats per match, 0-6 |
| `EJS_DATA_PATH` | `ejs/` if installed, else CDN `latest` | Where EmulatorJS loads from |
| `HOST`, `PORT` | `0.0.0.0`, `8080` | Where the web server listens; `HOST=127.0.0.1` keeps a dev server off the LAN |
| `NETPLAY_URL` | `http://localhost:4000` | Netplay server origin the browser connects to (must be its own origin) |
| `PUBLIC_URL` | the page's own URL | Base for shared, pop-out and bot links |
| `ICE_SERVERS` | Google STUN | JSON array of RTCIceServer objects; add TURN for strict NATs (handed to every visitor) |
| `ROMS_DIR` | `roms/` | Folder of sets to package; Fightcade's `ROMs/fbneo` works as is |
| `PACKAGED_ROM` | unset | `1` serves and advertises complete sets from `ROMS_DIR` (private deployments only) |
| `NETPLAY_STATUS_URL` | `NETPLAY_URL`, else `http://127.0.0.1:4000` | Where the web server itself reaches the netplay server for `/status.json` |
| `LOG_FORMAT` | JSON lines | `text` for human-readable server log lines |
| `CSP_MODE` | `report` | Content-Security-Policy for the page: `report` (Report-Only; violations show in the browser console), `enforce`, or `off`. Sources follow `NETPLAY_URL`, `EJS_DATA_PATH` and the CDNs. EmulatorJS needs `'unsafe-eval'` and blob: workers, so the policy restricts origins, not script behaviour |
| `GIT_COMMIT` | unset | Shown on `/status.json`; the compose build passes it as a build arg |

Without Docker: run `scripts/netplay-server.sh` and `node server/serve.js` behind any TLS reverse proxy, setting `NETPLAY_URL` and `PUBLIC_URL` for the web process.

## Matrix widget

In Element (or any client with widget support), in the room:

```
/addwidget https://3s.example.com/?userId=$matrix_user_id&displayName=$matrix_display_name&roomId=$matrix_room_id
```

The client substitutes the `$matrix_*` templates and appends `widgetId`/`parentUrl`; the page detects that and switches to widget mode. On first load the client asks you to approve three capabilities: send and receive `app.thirdstrike.lobby` room events, and read `m.room.member` state (to list who is in the room). Challenges are ordinary room events, so they survive reloads and other members' clients see them when they open the widget. The event type name predates multi-game and is kept; the content carries `v: 2` (with `game`) and widgets read events without it as 3rd Strike.

Hosting the widget yourself is required: the page must be served with a `Content-Security-Policy: frame-ancestors` that allows your Matrix client (`server/serve.js` sends `frame-ancestors *`).

### Testing without a homeserver

`web/dev/fake-matrix.html` is a fake Matrix client built on matrix-widget-api's client side. It mounts two copies of the widget as Alice and Bob, approves capabilities, serves a two-member room, and relays the lobby events between them. Open <http://localhost:8081/dev/fake-matrix.html>, challenge from one frame, accept in the other.

## Fluxer bot

1. Create an application in Fluxer, add a bot, copy the token (`<application_id>.<secret>`), invite the bot to your community with permission to read and send messages.
2. `FLUXER_BOT_TOKEN=... LOBBY_URL=https://3s.example.com/ node bot/fluxer-bot.mjs`
3. In a channel: `!fight @rival` posts a host link for you and a join link for them. `!fight` alone posts an open challenge. Put a game first for another game: `!fight kof @rival`, `!fight st`. `!fight watch RYU-7F3K` (or `!watch RYU-7F3K`) posts a watch link for a match code. `!fight status` (or `!status`) reads the lobby's `/status.json` and lists the open matches and whether the netplay server is up. `!fight help` (or `!help`) lists the commands and the games with their aliases; the bot reads the games from the lobby's `games/` folder at startup.

The bot discovers the API and gateway from `https://fluxer.app/.well-known/fluxer`; set `FLUXER_INSTANCE` for a self-hosted instance. It relies on the `mentions` array of incoming messages and writes mentions as `<@user_id>`; if your instance renders those literally, adjust `post()` in the bot.

## Controls

| | 3rd Strike, Super Turbo | KOF 2002 |
|---|---|---|
| Move | arrow keys · D-pad · left stick | arrow keys · D-pad · left stick |
| Punches | keys U / I / O · pad X / Y / RB (LP / MP / HP) | U = A (LP), I = C (HP) · pad X = A, Y = C |
| Kicks | keys J / K / L · pad A / B / RT (LK / MK / HK) | J = B (LK), K = D (HK) · pad A = B, B = D |
| Start / Coin | Enter / Space · Start / Back | Enter / Space · Start / Back |

The pad layout is the usual one for Xbox-style controllers and for arcade sticks in Xbox mode (top row X Y RB LB, bottom row A B RT LT), such as Qanba, Hori and 8BitDo sticks. Every button was checked in each board's own input test (the CPS-3 and CPS-2 test menus and the Neo Geo MVS I/O check), from both the keyboard and a controller. The match bar's **Controls** button shows the current game's keys and the controllers the page can see.

* **Controllers.** The top bar counts the controllers the page sees. Browsers reveal a controller only after one of its buttons is pressed while the page has focus, so click the page and press any button once. The match bar's **Controls** panel lists each controller with a dot that lights while a button is held, a "non-standard layout" tag when the browser gave it no standard button numbering, and what it does in this match.
* **Netplay.** The host's controller drives Player 1; the guest's controller reaches the host's game as Player 2 the same way as their keyboard. With several controllers plugged in (a stick next to Steam's virtual pad), **Use this** in the panel makes one of them yours: on the host it takes Player 1 and the rest are silenced so none can drive the opponent; when joining, only it is read. Without a choice the guest reads every standard-layout controller, merged. The choice is remembered by controller name.
* **Local match.** The lobby's **Local match** runs the game with no room: two controllers on one machine are Player 1 and Player 2. The controller panel picks which controller is which; the choice is remembered by controller name and re-applied every second, so EmulatorJS cannot hand the slots out again in connection order when a pad reconnects. That matters with Steam Input, which adds virtual pads that would otherwise take the first slots.
* **Reset.** **Reset controller settings** in the panel forgets the player choices, the preferred controller and every per-game button remap, and restores the game's default buttons. Controller problems: [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md#controllers).
* **Steam Controller and other Steam Input pads.** Steam presents these as virtual Xbox 360 pads, and outside a Steam game it applies its Desktop Layout, which turns the controller into a mouse and keyboard, so the page sees no controller input. Set Steam's Desktop Layout to the Gamepad template (Settings > Controller), or add your browser as a non-Steam game with a Gamepad layout and start it from Steam. Steam renumbers its virtual pads, so the remembered player choice ignores the pad number.
* **Remapping.** Buttons can be rebound in EmulatorJS's Control Settings (the gamepad icon). Remaps are saved per game in this browser and reset automatically if a game's default layout changes.

## Performance

Measured on this machine in the desktop app's browser pane: the host runs CPS-3 at a steady 60 fps while its tab is visible. Browsers throttle hidden tabs hard (the same instance dropped to 7-24 fps in the background), so keep the game tab in front. EmulatorJS picks its non-threaded `fbneo-legacy` build here because the fbneo core report defaults WebGL2 off; the threaded build needs cross-origin isolation (COOP/COEP), which a Matrix widget iframe cannot get, so it is not enabled. Running host and guest in the same browser halves both and garbles the stream; test netplay quality with two machines.

## Known limits

* Host-streaming netplay: the guest sees an encoded video stream (60 fps with this project's tuning) and plays with added latency. The host plays locally with none.
* CPS-3 in WebAssembly is heavy. A recent desktop CPU holds 60 fps; laptops and phones may not.
* Leaving a match reloads the page: EmulatorJS cannot be torn down and restarted in place. Rematch does not need to.
* Fluxer's mention syntax in message content is assumed to be Discord-style `<@id>`; that part of the docs was not explicit.
* `/config.json` hands the ICE server list, including any static TURN username and credential, to every visitor. That is inherent to browser WebRTC; use time-limited TURN credentials if the TURN server matters.
* WebRTC is peer to peer: the other player, and a TURN relay when one is used, sees your IP address, as in any peer-to-peer game. The lobby says so. Game files never leave the host's browser.
* Each game accepts exactly one set (the Fightcade one). Other revisions, such as `sfiii3n`, would need their own game file.
* EmulatorJS does not remember its own settings (such as volume) between visits: saving them would let a stale copy override each game's pinned options. Button remaps are saved separately (see Controls).

## License

The code in this repository is released under the [MIT License](LICENSE).

It covers this project's own code only. Things it uses keep their own terms:

* **EmulatorJS** is GPL-3.0. It is not in this repository, but `scripts/fetch-emulatorjs.sh` and the web Docker image download a pinned copy; anyone distributing that image must follow GPL-3.0 for it.
* **The FinalBurn Neo core** uses FBNeo's own license, which forbids commercial use. Nothing that bundles the core may be sold.
* **The EmulatorJS netplay server** and **matrix-widget-api** are Apache-2.0.
* **Game ROMs** belong to their publishers (Capcom, SNK and others). None are included or downloaded; players supply their own.
