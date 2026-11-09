# Troubleshooting

Symptoms first, then what they mean and what to do. The match bar's connection
dot and the **perf** banner say most of this in the page too.

## Hosting

**Black screen after "loading emulator…"**
The core could not load the ROM. Open the ROM screen (top-bar **ROM**) and check
the stored set: a wrong revision is reported as missing files. If the set is
packaged by the server, the server log has a `packaged_incomplete` line naming
what is missing. A reload clears a stuck EmulatorJS.

**Black screen and the region warning for several seconds after a rematch**
Normal when no title-screen state had been captured yet (nobody had inserted a
coin), so the board rebooted. The next rematch is instant once a coin has gone in.

**No sound**
Browsers block audio until the page has had a click. Click the game canvas once.
Guests get sound through the stream, so a silent guest with a host who hears
sound means the host's tab is muted (tab mute, or the site's sound permission).

**"Your emulator is running at N fps"**
The host's tab is hidden, inside a small chat frame, or on a slow CPU. Keep the
game tab in front; inside a chat use **Pop out**. CPS-3 (3rd Strike) is the
heaviest board; have the player with the stronger machine host.

**Holding Start opens a test menu**
Only with an EmulatorJS or core build that ignores `EJS_defaultOptions`. Run
`npm test`: the internals check fails when that changed.

## Joining and watching

**"Can't reach the netplay server"**
The lobby's `NETPLAY_URL` is wrong or the server is down. Open `status.html` on
the lobby host for what the web server itself sees. On a deployment the netplay
server must be its own origin (hostname), not a sub-path.

**"Could not connect to the other player directly"**
No route between the two networks: one side has a strict NAT or firewall. The
operator adds a TURN relay to `ICE_SERVERS` (see `deploy/`). If TURN is already
configured and this still shows, its address or credentials are wrong.

**"Room full"**
The host's **Watch seats** are taken (one Player 2 plus that many watchers). The
host raises the number in the lobby before hosting the next match.

**"This match already has an opponent, so you are watching"**
Someone asked to play before you, or the challenge named someone else. Ask the
host to rematch with you: they cannot swap Player 2 mid-match.

**Choppy video on the guest**
"stream N fps" below 40 in the match bar: the host's upload is short, or the
route is a relay. Fewer watch seats, a lower `STREAM_BITRATE_*`, or the other
player hosting.

**The guest's lag feels much worse than the ping**
Expected lag for the guest is about one round trip plus two video frames; the
match bar shows the estimate next to the host's delay picker. A **relay** route
adds the TURN server's distance twice. The host raising the input delay makes
the match fairer, not faster.

## Browsers and clients

**Background tab**
A hidden tab runs no animation frames, so the host's game freezes and the guest
sees a still image. Keep it in front, or pop out.

**Safari**
No `COEP: credentialless`, so a pop-out tab is not cross-origin isolated and the
threaded core is unavailable. It measured the same speed, so nothing is lost.

**Element widget: "Pop out" opens nothing**
The widget iframe needs `allow-popups allow-popups-to-escape-sandbox` in its
sandbox, which Element grants. Another client may not; untick "Open matches in
a new tab" and play inside the widget.

**Controller not seen**
Browsers reveal a controller only after a button press while the page is open.
Steam Input pads: set Steam's Desktop Layout to the Gamepad template, or run the
browser as a non-Steam game (see README, Controls).

## Server

**`/config.json` lists no packaged ROM**
`PACKAGED_ROM=1` is not set, or `ROMS_DIR` has no complete set. With
`LOG_FORMAT=text` the start-up log names each skipped set and its missing files.

**Logs**
`server/serve.js` writes one JSON object per line (`event`, plus fields), or
plain text with `LOG_FORMAT=text`. Events: `listening`, `rom_served`,
`rom_not_found`, `packaged_assembled`, `packaged_incomplete`, `request_failed`.
