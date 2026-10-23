<<<<<<< HEAD
# Fighting-game-widget
Widget for Matrix
=======
# 3rd Strike Lobby

Play **Street Fighter III: 3rd Strike** against people in your community, from the browser.

* **Matrix**: add it to a room as a widget. Members see each other, post or accept challenges, and the match opens inside the widget.
* **Fluxer**: Fluxer has no embedded-app surface, so a bot listens for `!fight @someone` and posts personalised host/join links to the lobby page.
* **Anywhere else**: the page works on its own. Host a match, share the link.

Emulation is [EmulatorJS](https://emulatorjs.org) running the FBNeo core (CPS-3 driver) in WebAssembly. Netplay is EmulatorJS's built-in mode: the **host runs the game and streams video/audio to the guest over WebRTC; the guest's inputs go back as Player 2** through a small signalling server. It is not rollback netcode. Expect roughly one network round-trip of input lag on the guest side, so it suits casual sets and same-region play rather than tournaments.

## ROMs

The repository ships no game data and downloads none. There are two ways a player gets the game:

* **Bring your own.** The lobby page asks for a 3rd Strike FBNeo romset once and keeps it in that browser's IndexedDB; it is never uploaded. Both players need it, because the guest's EmulatorJS instance has to boot before it can switch to streaming mode.
* **Packaged (personal use).** Drop a merged `sfiii3nr1.zip` into `roms/` next to this README and start the web server with `PACKAGED_ROM=1` (`scripts/dev.sh` does). It then serves the file at `/roms/sfiii3nr1.zip`, advertises it in `/config.json` under a versioned path (`roms/v<mtime>/sfiii3nr1.zip`, so browsers and EmulatorJS's own cache refetch a replaced file), and the page skips the ROM screen; a ROM stored in the browser still wins. Serving is opt-in so a checkout with a ROM in it never publishes the file by accident: without the flag the route answers 404 and the page asks for a ROM. `roms/` is git-ignored and is **not** copied into the Docker image; to serve it from Docker, mount it at `/app/roms` and set `PACKAGED_ROM=1`. Whoever can open the page can download the file, so keep a packaged deployment on a private network or behind authentication, and use `HOST=127.0.0.1` to keep a dev server off the LAN.

### Same version as Fightcade

Fightcade plays `sfiii3nr1`, "Street Fighter III 3rd Strike: Fight for the Future (Japan 990512, NO CD)", with Region = Japan and CPU = 100% (its `config/fcadefbneo/games/sfiii3nr1.ini`). The lobby boots the same driver from the same chips: with the merged set loaded, the FBNeo core reports `fbneo-dipswitch-sfiii3nr1-Region = Japan`, and `web/js/netplay-bridge.js` pins Region, CPU speed and frameskip through `EJS_coreOpts` so every player runs identical settings. `sfiii3.zip` on its own would boot too, but as the Euro 990608 revision, which is not what the community plays.

### The set must be merged

FBNeo treats `sfiii3nr1` (Japan 990512, NO CD) as a clone of `sfiii3`. Fightcade ships it split: `sfiii3nr1.zip` holds only the clone's own `simm1.0`-`simm1.3` and the NO-CD BIOS (8 MB), and the shared `simm2.x`-`simm6.x` flash lives in the parent `sfiii3.zip` (70 MB). EmulatorJS cannot keep a parent zip intact in the browser (it extracts it into loose files, which FBNeo ignores), so the browser needs one self-contained archive. Build it from the Fightcade pair with the standard library only:

```bash
python3 scripts/merge-romset.py ~/.var/app/com.fightcade.Fightcade/data/ROMs/fbneo/sfiii3nr1.zip ~/.var/app/com.fightcade.Fightcade/data/ROMs/fbneo/sfiii3.zip roms/sfiii3nr1.zip
```

The script carries the 41-entry manifest (40 flash + BIOS, sizes and CRC32s) from FBNeo's `d_cps3.cpp`, takes each file from the clone first and the parent second, verifies the merged archive member by member, and only then moves it into place; a failed merge never replaces an existing good file. The upload path rejects anything under 60 MB as a split set.

## Layout

```
web/              static lobby + player (vanilla JS, no build step)
  js/netplay-bridge.js   drives EmulatorJS netplay programmatically (openRoom / joinRoom)
  js/matrix-lobby.js     matrix-widget-api transport, challenge events
  js/romstore.js         IndexedDB ROM storage
  js/app.js              screens: ROM -> lobby -> match
server/serve.js   zero-dependency static server; renders /config.json from env
bot/fluxer-bot.mjs  Fluxer gateway bot (Node 22+, no deps)
scripts/          netplay-server.sh (build + run the official EmulatorJS netplay server), dev.sh,
                  merge-romset.py (build one browser-ready zip from Fightcade's split pair)
roms/             git-ignored; a merged sfiii3nr1.zip here is served for personal use (see ROMs)
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

EmulatorJS is loaded from `https://cdn.emulatorjs.org/latest/data/` by default. The `stable` (4.2.3) build still carries the old netplay client and does not work with the current netplay server, so `latest` is required; because `latest` moves, pin it for production by copying a known-good EmulatorJS `data/` folder into `web/ejs/` and setting `EJS_DATA_PATH=ejs/`.

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
3. In a channel: `!fight @rival` posts a host link for you and a join link for them. `!fight` alone posts an open challenge.

The bot discovers the API and gateway from `https://fluxer.app/.well-known/fluxer`; set `FLUXER_INSTANCE` for a self-hosted instance. It relies on the `mentions` array of incoming messages and writes mentions as `<@user_id>`; if your instance renders those literally, adjust `post()` in the bot.

## Controls

| | |
|---|---|
| Move | arrow keys |
| LP / MP / HP | U / I / O |
| LK / MK / HK | J / K / L |
| Start | Enter |
| Coin | Space |

Gamepads work through EmulatorJS's gamepad support. Host is P1, guest is P2; the guest's own P1 bindings are sent to the host and applied to P2.

## Performance

Measured on this machine in the desktop app's browser pane: the host runs CPS-3 at a steady 60 fps while its tab is visible. Browsers throttle hidden tabs hard (the same instance dropped to 7-24 fps in the background), so keep the game tab in front. EmulatorJS picks its non-threaded `fbneo-legacy` build here because the fbneo core report defaults WebGL2 off; the threaded build needs cross-origin isolation (COOP/COEP), which a Matrix widget iframe cannot get, so it is not enabled. Running host and guest in the same browser halves both and garbles the stream; test netplay quality with two machines.

## Known limits

* Host-streaming netplay: the guest sees an encoded video stream (about 30 fps by default in EmulatorJS) and plays with added latency. The host plays locally with none.
* CPS-3 in WebAssembly is heavy. A recent desktop CPU holds 60 fps; laptops and phones may not.
* Only two players per match. Spectating is not wired up (the netplay server allows up to four slots if you want to add it).
* Leaving a match reloads the page: EmulatorJS cannot be torn down and restarted in place.
* Fluxer's mention syntax in message content is assumed to be Discord-style `<@id>`; that part of the docs was not explicit.
* `/config.json` hands the ICE server list, including any static TURN username and credential, to every visitor. That is inherent to browser WebRTC; use time-limited TURN credentials if the TURN server matters.
* `scripts/merge-romset.py` only knows the `sfiii3nr1` + `sfiii3` pairing; other clones (`sfiii3n`, `sfiii3r1`) would need their own simm1 set.
>>>>>>> 1a5e101 (Initial version: 3rd Strike community lobby)
