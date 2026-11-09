# Troubleshooting

Symptoms first, then what they mean and what to do. The match bar's connection
dot and the **perf** banner say most of this in the page too.

## Hosting

**The ROM screen asks for another file after I picked the game's zip**
Some games are two zips: 3rd Strike is `sfiii3nr1.zip` and `sfiii3.zip`, Super
Turbo is `ssf2xjr1.zip` and `ssf2t.zip`, KOF 2002 is `kof2002.zip` and
`neogeo.zip`. Pick the one it names and you are done.

**Black screen after "loading emulator…"**
The core could not load the ROM. Open the ROM screen (top-bar **ROM**) and check
the stored set: a wrong revision, or only one of the game's two zips, is
reported as missing files. If the set is packaged by the server, the server log has a
`packaged_incomplete` line naming what is missing. A reload clears a stuck
EmulatorJS.

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

**The delay picker changed by itself**
**auto** is on (checkbox next to the picker). It moves one frame at a time
toward the recommendation shown as "rec." once several pings in a row agree.
Untick it to hold a value.

**Reporting a bug**
Press **Debug** in the match bar. It copies a report (build, browser, game,
role, the last ping and stream samples, route, controllers, peers; no
credentials, no ROM data) to paste into the issue or the chat.

## Browsers and clients

**Background tab**
A hidden tab runs no animation frames, so the host's game freezes and the guest
sees a still image. Keep it in front, or pop out. When the host's tab comes back
a banner says for how long the game was frozen.

**Console shows "Content-Security-Policy" messages**
`CSP_MODE=report` (the default) sends the policy as Report-Only: the browser
logs what the policy *would* have blocked and blocks nothing. A message about
EmulatorJS or the netplay server means `EJS_DATA_PATH` or `NETPLAY_URL` is not
reflected in the policy; fix the variable, then `CSP_MODE=enforce` once the
console stays clean.

**Safari**
No `COEP: credentialless`, so a pop-out tab is not cross-origin isolated and the
threaded core is unavailable. It measured the same speed, so nothing is lost.

**Element widget: "Pop out" opens nothing**
The widget iframe needs `allow-popups allow-popups-to-escape-sandbox` in its
sandbox, which Element grants. Another client may not; untick "Open matches in
a new tab" and play inside the widget.

## Controllers

The match bar's **Controls** button opens the controller panel: every controller
the browser sees, a dot that lights while a button is held, a "non-standard
layout" tag, and what each one does in this match. Start there.

**Controller not seen (the top bar says "no controller")**
Browsers reveal a controller only after a button press while the page has
focus. Click the page once, then press a button. If it still does not appear:

* **Steam is running.** Steam Input presents controllers as virtual Xbox pads
  and, outside a game, applies its *Desktop Layout*, which turns the controller
  into a mouse and keyboard; the browser then lists the pad but no button ever
  registers. Fix in Steam: Settings → Controller → Desktop Layout → choose the
  **Gamepad** template. Or add the browser as a non-Steam game with a Gamepad
  layout and launch it from Steam.
* **Check what the browser sees.** F12 → Console, paste:
  ```js
  [...navigator.getGamepads()].filter(Boolean).map(g => g.id + " / " + g.mapping)
  ```
  Nothing listed: the OS or Steam is not handing the device to the browser.
  Listed but never "pressed": paste the live watcher below and press buttons.
  ```js
  window._padWatch = setInterval(() => {
    const pads = [...navigator.getGamepads()].filter(Boolean);
    console.clear();
    pads.forEach(g => console.log(g.id.slice(0, 48), g.mapping, "→",
      g.buttons.map((b, i) => b.pressed ? i : null).filter(x => x != null)));
  }, 100);   // clearInterval(window._padWatch) to stop
  ```
  If the pressed list stays empty, the layer in between (Steam, a remapper,
  the browser's gamepad permission) is swallowing the buttons.

**Seen, dot lights, but the game does not react**

* **Local match:** open **Controls** and set Player 1 and Player 2 in the
  dropdowns. EmulatorJS hands out players in connection order, so a Steam
  virtual pad can hold Player 1 while the stick is Player 2 or nothing. The
  choice is remembered by controller name and re-applied every second, so a
  pad that reconnects goes back where you put it.
* **Hosting with two controllers** (stick plus Steam's virtual pad): press
  **Use this** on the one you play with. It drives Player 1 and the other pads
  are silenced, so none of them can move your opponent's Player 2.
* **Joining:** the guest reads the preferred controller only, or, with none
  chosen, every controller with the standard layout, all merged. Press
  **Use this** on yours if a second device sends stray inputs. A controller
  tagged "non-standard layout" is ignored when joining unless you prefer it;
  its button numbers do not match the game's table, so expect to remap on
  the host side instead (host the match yourself, then rebind in EmulatorJS's
  Control Settings).
* **Spectators** are ignored by design.

**Buttons land on the wrong actions**
A remap saved in an earlier session. **Reset controller settings** in the panel
forgets players, the preferred controller and every per-game remap and puts the
game's default buttons back at once.

**Steam renumbered the pad ("X-Box 360 pad 2" became "pad 0")**
Handled: remembered choices match the name without the number.

**Controller moves but the stick does not**
Only the left stick and the D-pad move. A stick that needs a large push: the
guest's threshold is 35% of travel (`STICK_THRESHOLD` in `guest-client.js`);
the host's stick goes through EmulatorJS's own analog handling.

## Server

**`/config.json` lists no packaged ROM**
`PACKAGED_ROM=1` is not set, or `ROMS_DIR` has no complete set. With
`LOG_FORMAT=text` the start-up log names each skipped set and its missing files.

**Players say the ROM screen takes only one zip and 3rd Strike / Super Turbo never load**
The deployment runs a page build from before November 2026, which knew nothing
about Fightcade's two-zip games. Redeploy from `main`. Until then a player can
build the single zip the old page wants with
`python3 scripts/romset.py merge sfiii3nr1 sfiii3nr1.zip sfiii3.zip` (and
`ssf2xjr1` with `ssf2t.zip`) and pick that.

**Logs**
`server/serve.js` writes one JSON object per line (`event`, plus fields), or
plain text with `LOG_FORMAT=text`. Events: `listening`, `rom_served`,
`rom_not_found`, `packaged_assembled`, `packaged_incomplete`, `request_failed`.
