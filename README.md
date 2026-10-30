# Fighting Game Matrix Widget
Vibecoded by JBro:dewrito.net

Play arcade fighting games against people in your community, from the browser: **Street Fighter III: 3rd Strike**, **Super Street Fighter II Turbo** and **The King of Fighters 2002** out of the box, each the version Fightcade runs. More FBNeo games are a data file away (see [Games](#games)). The page is a Matrix room widget first, with a Fluxer bot and a plain link-out mode alongside.

* **Matrix**: add it to a room as a widget. Members see each other, post or accept challenges, and the match opens inside the widget.
* **Fluxer**: Fluxer has no embedded-app surface, so a bot listens for `!fight @someone` (or `!fight kof @someone`) and posts personalised host/join/watch links to the lobby page.
* **Anywhere else**: the page works on its own. Host a match, share the link.

Emulation is [EmulatorJS](https://emulatorjs.org) running the FBNeo core in WebAssembly. Netplay is EmulatorJS's built-in mode: the **host runs the game and streams video/audio to the guest over WebRTC; the guest's inputs go back as Player 2** over a WebRTC data channel. A small signalling server only sets up the connection. It is not rollback netcode. Expect roughly one network round-trip of input lag on the guest side, so it suits casual sets and same-region play rather than tournaments. See [docs/ROADMAP.md](docs/ROADMAP.md) for where this is going.

## Netplay feel and connection quality

* **Input delay (host).** The host plays with no network lag and the guest with a full round trip, so the host can delay their *own* inputs by 0-8 frames (default 3, picker in the match bar, remembered per browser) to even it out. It makes matches fairer; it cannot make the guest's side faster.
* **60 fps stream.** EmulatorJS captures and encodes the host canvas at 30 fps. `web/js/netplay-tuning.js` raises both to `STREAM_FPS` (default 60), lifts the bitrate cap to match, keeps frame rate ahead of resolution under congestion, and sets the guest's jitter buffer target to 0.
* **Pop out.** "Open matches in a new tab" (on by default inside a chat client) or the Pop out button runs the match in its own full-size tab. That tab is cross-origin isolated (`?isolate=1` gets COOP/COEP), so EmulatorJS also loads its threaded core; on CPS-3 that measured no faster, so the point is a tab you keep in front, outside the chat.
* **Connection quality.** The top bar shows your round trip to the netplay server. Matrix challenges carry the challenger's server ping, so the accepter sees an estimate before accepting. During a match the bar shows emulator fps (host), peer ping, stream fps, direct or relay route and packet loss, with a coloured dot.
* **Performance warning.** If the host's emulator stays under the game's threshold (50 fps) for three seconds, a banner says so and why (background tab, chat iframe, or CPU).

## Rematch and spectators

* **Rematch.** Once both players are in, the host has a Rematch button that restarts the game in place, and the opponent has Ask for rematch, which shows the host a prompt. Room, connection and stream stay up; the CPS-3 board takes several seconds to reboot to the title. Insert coin and press Start as usual.
* **Spectators.** Each match has `MAX_SPECTATORS` watch seats (default 2). Watch from a **Watch** button in the open-matches list, from **Live matches** in the Matrix widget (accepted challenges between other members), from the host's **Watch link** button, or from the Fluxer bot's watch link. Spectators get the host's stream and their inputs are ignored. Each one costs the host another video encode and upload.
* **Who is Player 2.** The host decides: the first joiner who asked to play gets Player 2 and everyone else watches, even if a spectator connected first. Someone who joins a match that already has an opponent is told they are watching.
* **Save states.** EmulatorJS's own save and load paths work again; the published fbneo core lacks the export current EmulatorJS calls, so the bridge rebuilds it from the core's older one.

## Games

| Game | Set | Board | Files the browser needs |
|---|---|---|---|
| Street Fighter III: 3rd Strike | `sfiii3nr1` (Japan 990512, NO CD) | CPS-3 | one merged `sfiii3nr1.zip` |
| Super Street Fighter II Turbo | `ssf2xjr1` (Super SF II X, Japan 940223) | CPS-2 | one merged `ssf2xjr1.zip` |
| The King of Fighters 2002 | `kof2002` | Neo Geo | `kof2002.zip` + the `neogeo.zip` BIOS |

Pick the game in the top bar. Each game has its own stored ROM, its own room namespace on the netplay server (a 3rd Strike lobby never lists a KOF room), its own buttons and its own pinned core options. Matrix challenges carry the game, so the widget shows each challenge's game and asks for the right ROM before accepting. Links carry it as `?game=<id>`; aliases such as `3s`, `st` and `kof` work too.

Each game is one data file, `web/games/<id>.json`, listed in `web/games/index.json`; the format is in [docs/game-adapter.d.ts](docs/game-adapter.d.ts). Adding another FBNeo arcade game needs no code: generate the file list from FBNeo's DAT, add buttons and a room id, and list it.

## ROMs

The repository ships no game data and downloads none. There are two ways a player gets a game:

* **Bring your own.** The ROM screen takes the game's zip (and BIOS, if it has one) once per browser and keeps it in IndexedDB; it is never uploaded. Every file is checked against FinalBurn Neo's list before it is stored, so a split set, a wrong revision or a renamed zip gets a clear message instead of a black screen. Both players need the game, because the guest's EmulatorJS instance has to boot before it can switch to streaming mode.
* **Packaged (personal use).** Drop game zips and BIOS zips into `roms/` next to this README and start the web server with `PACKAGED_ROM=1` (`scripts/dev.sh` does). It serves every file whose name matches a game's set or BIOS, advertises them in `/config.json` under versioned paths (`roms/v<mtime>/<file>`, so browsers and EmulatorJS's own cache refetch a replaced file), and the page skips the ROM screen for those games; a ROM stored in the browser still wins. Serving is opt-in so a checkout with ROMs in it never publishes them by accident. `roms/` is git-ignored and is **not** copied into the Docker image; to serve it from Docker, mount it at `/app/roms` and set `PACKAGED_ROM=1`. Whoever can open the page can download the files, so keep a packaged deployment on a private network or behind authentication, and use `HOST=127.0.0.1` to keep a dev server off the LAN.

### Building the zips from Fightcade

Fightcade keeps clones split from their parents: `sfiii3nr1.zip` is 8 MB and needs `sfiii3.zip`; `ssf2xjr1.zip` is 1.3 MB and needs `ssf2t.zip`. EmulatorJS cannot keep a parent zip intact in the browser (it extracts it into loose files, which FBNeo ignores), so the browser needs one self-contained archive per game. `scripts/romset.py` builds and checks them with the standard library only:

```bash
FC=~/.var/app/com.fightcade.Fightcade/data/ROMs/fbneo
python3 scripts/romset.py merge sfiii3nr1 $FC/sfiii3nr1.zip $FC/sfiii3.zip
python3 scripts/romset.py merge ssf2xjr1 $FC/ssf2xjr1.zip $FC/ssf2t.zip
python3 scripts/romset.py verify kof2002 $FC/kof2002.zip && cp $FC/kof2002.zip roms/
python3 scripts/romset.py bios kof2002 $FC/neogeo.zip
```

`merge` matches files by size and CRC32 against the game's manifest, verifies the result member by member, and only then writes `roms/<set>.zip`; a failed merge never replaces a good file. `scripts/merge-romset.py` still works for 3rd Strike.

### Same versions as Fightcade

Fightcade's 3rd Strike is `sfiii3nr1` with Region = Japan and CPU = 100% (its `config/fcadefbneo/games/sfiii3nr1.ini`); the lobby pins the same through each game's `coreOpts`. Every game also turns off FBNeo's "hold Start to open the test menu" shortcut, so holding Start mid-match cannot drop the board into its operator menu. Super Turbo is `ssf2xjr1` and KOF 2002 is `kof2002`, the sets Fightcade's channels use.

## Layout

```
web/              static lobby + player (vanilla JS, no build step)
  js/netplay-bridge.js   drives EmulatorJS netplay programmatically (openRoom / joinRoom), host input delay, fps monitor
  js/netplay-tuning.js   60 fps stream, bitrate, jitter buffer, peer stats (wraps browser WebRTC APIs, no EmulatorJS fork)
  js/matrix-lobby.js     matrix-widget-api transport, challenge events
  js/games.js            game registry (web/games/*.json) and in-browser zip checking
  js/romstore.js         IndexedDB ROM storage, one set per game plus shared BIOS zips
  games/                 one JSON file per game + index.json
  js/app.js              screens: ROM -> lobby -> match
server/serve.js   zero-dependency static server; renders /config.json from env
bot/fluxer-bot.mjs  Fluxer gateway bot (Node 22+, no deps)
scripts/          netplay-server.sh (build + run the official EmulatorJS netplay server), dev.sh,
                  romset.py (manifest / merge / verify / bios for any game), merge-romset.py (3rd Strike wrapper),
                  fetch-emulatorjs.sh (install the pinned EmulatorJS + fbneo core into web/ejs/)
docs/             ROADMAP.md (phases, measurements), game-adapter.d.ts (game file format)
roms/             git-ignored; game and BIOS zips here are served for personal use (see ROMs)
deploy/           Dockerfiles, docker-compose.yml, Caddyfile (TLS for two hostnames)
```

## Run locally

Requirements: Node 22+, Rust toolchain (for the netplay server), a modern browser.

```bash
scripts/dev.sh
```

That starts the netplay server on `:4000` and the lobby on <http://localhost:8080>. Open two browser profiles (or two machines on the LAN using your LAN IP), load the ROM in each, host in one and join in the other.

Netplay needs a secure context for WebRTC and for the Matrix iframe: `localhost` counts, anything else needs HTTPS.

## Deploy

1. Point two DNS names at the box: one for the lobby (`LOBBY_HOST`), one for the netplay server (`NETPLAY_HOST`). The netplay server must be its own origin, not a sub-path, because the EmulatorJS client treats a path as a socket.io namespace.
2. `cp .env.example .env` and fill it in. Add a TURN server to `ICE_SERVERS` if players sit behind strict NATs.
3. `cd deploy && docker compose up -d --build` (add `--profile fluxer` to run the bot).

EmulatorJS is pinned. `scripts/fetch-emulatorjs.sh` installs EmulatorJS at a fixed git commit plus the fbneo core from npm `@emulatorjs/core-fbneo@4.2.3` into `web/ejs/` (git-ignored), and the server uses it automatically; the web Docker image runs the script at build time. A git commit rather than an npm release is required because `@emulatorjs/emulatorjs@4.2.3`, the newest release, still carries the old netplay client that cannot talk to the current netplay server. Without the pinned copy the page falls back to the moving `https://cdn.emulatorjs.org/latest/data/`. Bump `EJS_COMMIT` in the script and the Dockerfile together, and retest netplay when you do.

| Variable | Default | Effect |
|---|---|---|
| `STREAM_FPS` | 60 | Host video capture and encode rate, 15-60 |
| `STREAM_BITRATE_DIRECT` | 4000000 | Max video bits/s on a direct peer path |
| `STREAM_BITRATE_RELAY` | 1500000 | Max video bits/s through TURN |
| `INPUT_DELAY_DEFAULT` | 3 | Host input delay in frames until a player picks one |
| `THREADS` | 1 | `0` stops pop-out tabs loading the threaded core |
| `MAX_SPECTATORS` | 2 | Watch seats per match, 0-6 |
| `EJS_DATA_PATH` | `ejs/` if installed, else CDN `latest` | Where EmulatorJS loads from |

Without Docker: run `scripts/netplay-server.sh` and `node server/serve.js` behind any TLS reverse proxy, setting `NETPLAY_URL` and `PUBLIC_URL` for the web process.

## Matrix widget

In Element (or any client with widget support), in the room:

```
/addwidget https://3s.example.com/?userId=$matrix_user_id&displayName=$matrix_display_name&roomId=$matrix_room_id
```

The client substitutes the `$matrix_*` templates and appends `widgetId`/`parentUrl`; the page detects that and switches to widget mode. On first load the client asks you to approve three capabilities: send and receive `app.thirdstrike.lobby` room events, and read `m.room.member` state (to list who is in the room). Challenges are ordinary room events, so they survive reloads and other members' clients see them when they open the widget.

Hosting the widget yourself is required: the page must be served with a `Content-Security-Policy: frame-ancestors` that allows your Matrix client (`server/serve.js` sends `frame-ancestors *`).

### Testing without a homeserver

`web/dev/fake-matrix.html` is a fake Matrix client built on matrix-widget-api's client side. It mounts two copies of the widget as Alice and Bob, approves capabilities, serves a two-member room, and relays the lobby events between them. Open <http://localhost:8081/dev/fake-matrix.html>, challenge from one frame, accept in the other.

## Fluxer bot

1. Create an application in Fluxer, add a bot, copy the token (`<application_id>.<secret>`), invite the bot to your community with permission to read and send messages.
2. `FLUXER_BOT_TOKEN=... LOBBY_URL=https://3s.example.com/ node bot/fluxer-bot.mjs`
3. In a channel: `!fight @rival` posts a host link for you and a join link for them. `!fight` alone posts an open challenge. Put a game first for another game: `!fight kof @rival`, `!fight st`. `!fight help` lists the games; the bot reads them from the lobby's `games/` folder at startup.

The bot discovers the API and gateway from `https://fluxer.app/.well-known/fluxer`; set `FLUXER_INSTANCE` for a self-hosted instance. It relies on the `mentions` array of incoming messages and writes mentions as `<@user_id>`; if your instance renders those literally, adjust `post()` in the bot.

## Controls

| | 3rd Strike, Super Turbo | KOF 2002 |
|---|---|---|
| Move | arrow keys · D-pad · left stick | arrow keys · D-pad · left stick |
| Punches | keys U / I / O · pad X / Y / RB (LP / MP / HP) | U = A (LP), I = C (HP) · pad X = A, Y = C |
| Kicks | keys J / K / L · pad A / B / RT (LK / MK / HK) | J = B (LK), K = D (HK) · pad A = B, B = D |
| Start / Coin | Enter / Space · Start / Back | Enter / Space · Start / Back |

The pad layout is the usual one for Xbox-style controllers and for arcade sticks in Xbox mode (top row X Y RB LB, bottom row A B RT LT), such as Qanba, Hori and 8BitDo sticks. Every button was checked in each board's own input test (the CPS-3 and CPS-2 test menus and the Neo Geo MVS I/O check), from both the keyboard and a controller. The match bar's **Controls** button shows the current game's keys and the controllers the page can see.

* **Controllers.** The top bar counts the controllers the page sees. Browsers reveal a controller only after one of its buttons is pressed while the page is open, so press any button once.
* **Netplay.** Every controller on your machine drives your own player; the guest's controller reaches the host's game the same way as their keyboard.
* **Local match.** The lobby's **Local match** runs the game with no room: two controllers on one machine are Player 1 and Player 2. The controller panel picks which controller is which, and the choice is remembered by controller name. That matters with Steam Input, which adds virtual pads that would otherwise take the first slots.
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
* Each game accepts exactly one set (the Fightcade one). Other revisions, such as `sfiii3n`, would need their own game file.
* EmulatorJS does not remember its own settings (such as volume) between visits: saving them would let a stale copy override each game's pinned options. Button remaps are saved separately (see Controls).
