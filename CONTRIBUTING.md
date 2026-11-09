# Contributing

Vanilla JS, no build step, zero runtime dependencies on the server. Keep it that way: the page is a Matrix widget and a static folder, and the server is `node server/serve.js`.

## Run and test

```bash
scripts/dev.sh          # netplay server on :4000, lobby on :8080 (serves roms/ when PACKAGED_ROM=1)
npm test                # Node's built-in runner, ~40 tests, no install
npm run check:games     # every web/games/*.json against docs/game-adapter.d.ts
npm run check:ejs       # every EmulatorJS internal we touch still exists in web/ejs/
```

`scripts/fetch-emulatorjs.sh` installs the pinned EmulatorJS and fbneo core into `web/ejs/` (git-ignored); without it the page falls back to the CDN and the internals check is skipped. CI (`.github/workflows/test.yml`, GitHub and Forgejo Actions) runs the syntax check, the game schema, the internals check and the tests on every push.

## Where things live

| Change | Files |
|---|---|
| Screens | `web/js/ui/*.js`, installed on one `ctx` from `web/js/app.js`; markup in `web/index.html`, styles in `web/css/app.css` |
| Host side | `web/js/netplay-bridge.js` orchestrates: `ejs-adapter.js` (every EmulatorJS internal), `ejs-setup.js` (EJS_* globals, loader), `input-delay.js`, `roster.js`, `tsl-messaging.js`, `controller-bridge.js` |
| ROM-free guest / spectator | `web/js/guest-client.js` (speaks the netplay protocol directly) |
| Pure rules, unit-tested | `web/js/match-logic.js` (Player 2, delay queue, lag estimates, auto delay, spectator caps), `web/js/roster.js`, `web/js/tsl-messaging.js`, `web/js/pad-logic.js` (controllers), `web/js/zipcore.js` (zips; shared with the server) |
| Stream tuning, peer stats | `web/js/netplay-tuning.js` (wraps browser WebRTC APIs; never forks EmulatorJS) |
| Matrix transport | `web/js/matrix-lobby.js`; lobby UI in `web/js/ui/matrix-ui.js` |
| Server | `server/serve.js` (static, `/config.json`, `/status.json`, packaged ROMs), `server/romsets.js`, `server/log.js` |
| Bot | `bot/fluxer-bot.mjs` |
| Games | `web/games/<id>.json` + `index.json`; format in `docs/game-adapter.d.ts` |

Pure logic goes in a module that loads in both the browser and Node (see the UMD header of `match-logic.js`) with a test next to it in `test/`. DOM and EmulatorJS calls stay in the UI and bridge files.

## Adding a game

```bash
python3 scripts/romset.py add "FinalBurn Neo (ClrMame Pro XML, Arcade only).dat" garou --short Garou --aliases garou,motw
```

(The DAT is `dats/FinalBurn Neo (ClrMame Pro XML, Arcade only).dat` in the libretro/FBNeo repository.) It writes `web/games/garou.json`, adds it to `index.json` and runs the validator. Then:

1. Check `name`, `short`, `aliases`, `hardware`, and `coreOpts` (region DIP switches; compare with Fightcade's `config/fcadefbneo/games/<set>.ini`).
2. Pick the set's files on the ROM screen and boot it: title screen, coin, Start.
3. Press every button in the board's own input test (CPS test menu, Neo Geo MVS I/O check) from the keyboard and a controller; each key must fire exactly one input.
4. Host it and join from a second browser without a ROM.
5. Add a row to the README's Games table and a line in `docs/ROADMAP.md`.

## Bumping EmulatorJS or the core

`scripts/bump-ejs.sh <commit> [core-version]` does the mechanical part and prints the checklist from [docs/emulatorjs-internals.md](docs/emulatorjs-internals.md). By hand: change `EJS_COMMIT` / `CORE_VERSION` in `scripts/fetch-emulatorjs.sh` **and** `deploy/Dockerfile.web`, fetch, `npm test` (the internals check must pass; when a pattern breaks, read the new source, adapt the code, update the pattern and the table), then the manual netplay matrix below. Bump the `?v=` cache suffix on every script tag in `web/index.html` whenever a script changes.

## Manual verification before a release

Automated tests cover the pure parts. Anything that touches EmulatorJS, WebRTC or controllers needs a browser:

- **Host**: each game boots at 60 fps; core options apply (3rd Strike: holding Start does not open the test menu).
- **ROM-free guest**: a second browser joins with no ROM, sees video and hears sound, keyboard and controller drive Player 2.
- **Spectator**: joins before the opponent and does not take Player 2; a joiner past the watch seats gets "Room full".
- **Input delay**: 0 / 2 / 4 / 8; `TSL.Netplay.debugDelay()` shows presses released exactly that many frames later.
- **Rematch**: after a coin, back to the title at once; before any coin, a reboot.
- **Controllers**: local match Player 1 / Player 2 dropdowns hold after a reconnect; "Use this" on the host silences the second pad; a guest with two pads sends only the preferred one.
- **Matrix**: `web/dev/fake-matrix.html` for challenge / accept / cancel and Live matches; a real room for pop-out.
- **Two machines on different networks** for anything about lag, bitrate or TURN. Single-machine numbers have ~0 ms ping and prove nothing about feel.

Record what you measured in `docs/ROADMAP.md`.

## Style

Early returns over nesting; `??` and `||` as the code around you does; comments say why, not what. Errors that a player can act on become a toast or a banner with the action in it; the rest go to `console.error` with context (browser) or `log.error` (server). Commit messages: one line of what changed, then a short list of the notable pieces.
