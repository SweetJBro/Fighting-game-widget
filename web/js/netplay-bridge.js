/* Host side of a match: drives EmulatorJS and its built-in netplay without the
   globe-icon menu. The host runs the game and streams video/audio to the guest
   over WebRTC; the guest's inputs come back as Player 2 over a WebRTC data
   channel (guests themselves run guest-client.js, never EmulatorJS).

   This file only wires things together. The pieces:
     ejs-adapter.js        every EmulatorJS internal we touch (TSL.Ejs)
     ejs-setup.js          EJS_* configuration and the loader (TSL.EjsSetup)
     input-delay.js        the host's own presses held N frames (TSL.InputDelay)
     roster.js             who is Player 2, who watches (TSL.Roster)
     tsl-messaging.js      our { tsl: ... } messages on the data path (TSL.Messaging)
     controller-bridge.js  pads, preferred pad, remaps (TSL.ControllerBridge)
     netplay-tuning.js     stream fps/bitrate, peer stats, spectator caps (TSL.Tuning)
     match-logic.js        the pure rules behind delay, roster and bandwidth */
window.TSL = window.TSL || {};

TSL.Netplay = (() => {
  const E = () => TSL.Ejs;
  let opts = null;
  let statusTimer = null, findTimer = null, monitorTimer = null, rosterTimer = null;
  let pads = null;

  function report(state, extra) { if (opts && opts.onStatus) opts.onStatus(Object.assign({ state }, extra || {})); }
  const hosting = () => E().isNetplay() && E().isOwner();

  // ---- messaging + roster ---------------------------------------------------
  const messaging = TSL.Messaging.create();
  const roster = TSL.Roster.create({
    decide: (a) => TSL.MatchLogic.decideRoster(a),
    send: (m) => messaging.send(m),
    present: () => E().players().filter((p) => p.userid !== E().playerId()),
    host: () => (E().np() ? { id: E().playerId(), name: opts.name } : null)
  });
  messaging.on("hello", (h) => { if (E().isOwner()) { roster.hello(h); roster.update(); } });
  messaging.on("roster", (r) => { if (!E().isOwner()) roster.setRemote(r); });
  messaging.on("rematch", (what, m) => {
    if (E().isOwner() && what === "request" && opts.onRematchRequest) opts.onRematchRequest(m.name || "Your opponent");
    if (!E().isOwner() && what === "done" && opts.onRematchDone) opts.onRematchDone(m.how);
  });

  /** Host: decide what an incoming data-channel input becomes. Only the roster's
      Player 2 gets through, always as player 1; spectators and unknowns are dropped. */
  function hostInputFilter(pc, d) {
    if (!d || typeof d.player !== "number") return d;          // control messages pass
    const p = E().playerForPc(pc);
    if (!p || !roster.isGuest(p.userid)) return null;
    return d.player === 1 ? d : Object.assign({}, d, { player: 1 });
  }

  /** Host: cap the stream to every peer that is not Player 2 at the chosen spectator tier. */
  function applySpectatorCaps() {
    if (!hosting()) return;
    const caps = TSL.MatchLogic.spectatorCaps(opts.spectatorQuality, TSL.Tuning.config());
    for (const { player, pc } of E().peers()) {
      TSL.Tuning.setPeerCaps(pc, player && roster.isGuest(player.userid) ? null : caps);
    }
  }

  // ---- input delay, instant rematch ------------------------------------------
  // Instant rematch: the board's state captured just before the first coin of
  // the session, i.e. idle on its title/attract screen with no credits. Loading
  // it skips the multi-second board reboot a restart costs (CPS-3: black screen,
  // region warning, intro).
  let titleState = null, titleStateTried = false;
  function captureTitleState() {
    if (titleStateTried) return;
    if (E().isNetplay() && !E().isOwner()) return;   // only the host and local play run the real game
    titleStateTried = true;
    try { const st = E().getState(); if (st && st.length) titleState = st; } catch (_) { /* rematch falls back to a restart */ }
  }
  const delay = TSL.InputDelay.create({
    adapter: TSL.Ejs, isHosting: hosting, onCoin: captureTitleState,
    fallback: () => (TSL.config && TSL.config.inputDelayDefault) ?? (opts && opts.game.netplay && opts.game.netplay.defaultInputDelay) ?? 3
  });
  // Opt-in automatic delay (match-logic AutoDelay): conservative, one frame at a time.
  const AUTO_KEY = "tsl.inputDelayAuto";
  let autoDelay = null;
  function autoOn() { try { return localStorage.getItem(AUTO_KEY) === "1"; } catch (_) { return false; } }

  // ---- game start -------------------------------------------------------------
  function onGameStart() {
    const n = E().np();
    if (!n) { report("error", { message: "EmulatorJS netplay module missing." }); return; }
    n.name = opts.name;
    if (!n.updateList) n.defineNetplayFunctions();
    if (!n.url) { report("error", { message: "Netplay server URL is not configured." }); return; }
    E().shimSaveStates();
    pads.start();
    delay.install();
    messaging.hook(n);
    startMonitor();

    if (opts.role === "local") {
      // Same machine, no room: EmulatorJS routes each controller to its own
      // player, so a second controller is Player 2.
      report("local");
      return;
    }
    if (opts.role === "host") {
      report("hosting");
      TSL.Tuning.inputFilter = hostInputFilter;
      // Player 2 plus up to maxSpectators watchers (each costs the host one more video encode).
      n.openRoom(opts.code, 2 + maxSpectators(), "");
    } else {
      report("searching");
      findRoomAndJoin();
    }
    startStatusLoop();
  }

  function maxSpectators() {
    const v = opts.maxSpectators ?? (TSL.config && TSL.config.maxSpectators) ?? 2;
    return Math.max(0, Math.min(6, Number(v) || 0));
  }

  function findRoomAndJoin() {
    const n = E().np();
    const deadline = Date.now() + 120000;
    const attempt = async () => {
      if (!E().np() || Date.now() > deadline) {
        report("error", { message: "No open match called " + opts.code + ". Ask the host to start first." });
        return;
      }
      let rooms = {};
      try { rooms = await n.getOpenRooms(); } catch (_) {}
      let sid = opts.sid || null, entry = null;
      for (const [id, r] of Object.entries(rooms || {})) {
        if ((sid && id === sid) || (!sid && r.room_name === opts.code)) { entry = r; sid = id; break; }
      }
      if (entry && sid) {
        if (entry.current >= entry.max) { report("error", { message: opts.role === "spectator" ? "No spectator seats left in that match." : "That match is already full." }); return; }
        n.joinRoom(sid, entry.room_name, entry.max || 2, "");
        return;
      }
      findTimer = setTimeout(attempt, 1500);
    };
    attempt();
  }

  // ---- status ------------------------------------------------------------------
  function startStatusLoop() {
    clearInterval(statusTimer);
    clearInterval(rosterTimer);
    // Joiners repeat their hello (cheap, survives a host that joined the socket late);
    // the host re-sends the roster so late arrivals learn it.
    rosterTimer = setInterval(() => {
      if (!E().np() || !E().isNetplay()) return;
      if (E().isOwner()) { roster.update(true); applySpectatorCaps(); }
      else messaging.send({ hello: { userid: E().playerId(), intent: opts.role === "host" ? "guest" : opts.role, name: opts.name, matrixId: opts.matrixId || null } });
    }, 2000);
    statusTimer = setInterval(() => {
      if (!E().np() || !E().isNetplay()) return;
      const count = E().players().length;
      const r = roster.get();
      if (E().isOwner()) {
        roster.update();
        if (r && r.guest) report("connected", { opponent: r.guestName, spectators: r.spectators.length });
        else report("waiting", { spectators: r ? r.spectators.length : 0 });
        return;
      }
      const me = E().playerId();
      if (!r) { report("joining", { players: count }); return; }
      if (opts.role === "spectator" || (r.guest && r.guest !== me)) {
        report("watching", { host: r.hostName, guest: r.guestName, bumped: opts.role === "guest" && !!r.guest && r.guest !== me });
      } else if (r.guest === me) {
        report("connected", { opponent: r.hostName, spectators: r.spectators.length });
      } else {
        report("joining", { players: count });
      }
    }, 1000);
  }

  // ---- performance + connection monitor ------------------------------------------
  function startMonitor() {
    clearInterval(monitorTimer);
    let lastFrame = null, lastT = 0, slowStreak = 0;
    monitorTimer = setInterval(async () => {
      if (!E().gm()) return;
      const now = performance.now();
      let fps = null;
      // Only the host's (or local play's) emulator fps means anything.
      const runsGame = !E().isNetplay() || E().isOwner();
      if (runsGame) {
        const f = E().getFrameNum();
        if (lastFrame !== null) fps = Math.round((f - lastFrame) * 1000 / (now - lastT));
        lastFrame = f; lastT = now;
        const warnBelow = (opts.game.performance && opts.game.performance.warnBelowFps) || 50;
        slowStreak = fps !== null && fps < warnBelow ? slowStreak + 1 : 0;
      }
      const link = E().isNetplay() ? await TSL.Tuning.sample() : null;
      const uploadMbps = hosting() ? await TSL.Tuning.upload() : null;
      // ICE gave up on every peer and nothing is connected: no route between the
      // two networks. Almost always a strict NAT/firewall that needs TURN.
      const linkFailed = E().isNetplay() && TSL.Tuning.failures() > 0 && TSL.Tuning.connectedCount() === 0;
      const gameFps = (opts.game.performance && opts.game.performance.fps) || 60;
      const rtt = link ? link.rttMs : null;
      if (hosting() && autoOn()) {
        autoDelay = autoDelay || new TSL.MatchLogic.AutoDelay({ fps: gameFps });
        const nd = autoDelay.sample(rtt, now, delay.get());
        if (nd !== null) delay.set(nd);
      }
      if (opts && opts.onStats) {
        const r = roster.get();
        opts.onStats({
          role: runsGame ? "host" : opts.role,
          linkFailed,
          usingTurn: (TSL.config.iceServers || []).some((s) => [].concat(s.urls || []).some((u) => /^turns?:/i.test(u))),
          emuFps: fps,
          slow: slowStreak >= 3,
          hidden: document.hidden,
          threads: !!window.EJS_threads,
          inputDelay: runsGame ? delay.get() : null,
          autoDelay: runsGame ? autoOn() : null,
          recommendedDelay: TSL.MatchLogic.recommendedDelay(rtt, gameFps),
          uploadMbps,
          spectators: r ? r.spectators.length : 0,
          spectatorQuality: opts.spectatorQuality || "full",
          link,
          quality: TSL.Tuning.grade(rtt)
        });
      }
    }, 1000);
  }

  return {
    getInputDelay() { return delay.get(); },
    setInputDelay(d) { return delay.set(d); },
    /** For tests and the console: current frame and queued (delayed) presses. */
    debugDelay() { return delay.debug(); },
    setAutoDelay(on) { try { localStorage.setItem(AUTO_KEY, on ? "1" : "0"); } catch (_) {} autoDelay = null; return !!on; },
    isAutoDelay: autoOn,
    /** Host: the encoder cap for watchers ("full" | "reduced" | "minimal"); applied to current peers at once. */
    setSpectatorQuality(tier) { if (opts) { opts.spectatorQuality = tier; applySpectatorCaps(); } },
    /** Host or local: back to the title screen. Returns "instant", "reboot" or false. Room, peers and stream stay up. */
    rematch() {
      if (!E().gm()) return false;
      if (opts.role !== "local" && !hosting()) return false;
      delay.clear();
      let how = "reboot";
      if (titleState) {
        try { E().loadState(titleState); how = "instant"; } catch (_) { how = "reboot"; }
      }
      if (how === "reboot") E().restart();
      if (opts.role !== "local") messaging.send({ rematch: "done", how });
      return how;
    },
    /** For tests: whether a title-screen state has been captured. */
    hasTitleState() { return !!titleState; },
    /** Guest: ask the host for a rematch. */
    requestRematch() { messaging.send({ rematch: "request", name: opts && opts.name }); },
    getRoster() { return roster.get(); },
    /** Host: only this Matrix id may take Player 2 (null = first joiner who asks to play). */
    setExpectedGuest(id) { roster.setExpected(id); roster.update(true); applySpectatorCaps(); },
    /** Live controllers: [{ index, id, mapping, player (-1 = none), standard, preferred, active }]. */
    pads() { return pads ? pads.pads() : []; },
    /** Local match: make controller `index` drive `player` (0-based; -1 = not playing). Remembered by controller name. */
    assignPad(i, p) { if (pads) pads.assignPad(i, p); },
    setPreferredPad(id) { if (pads) pads.setPreferredPad(id); },
    getPreferredPad() { return TSL.PadLogic.store(localStorage).preferred(); },
    resetControllerSettings() { return pads ? pads.resetControllerSettings() : TSL.PadLogic.store(localStorage).reset(); },
    /** Everything useful in a bug report (no credentials). */
    debugInfo() {
      return {
        role: opts && opts.role, game: opts && opts.game.id, code: opts && opts.code,
        delay: delay.debug(), autoDelay: autoOn(), titleState: !!titleState,
        roster: roster.get(), spectatorQuality: opts && opts.spectatorQuality,
        threads: !!window.EJS_threads, started: E().started(), netplay: E().isNetplay(), owner: E().isOwner(),
        peers: E().peers().map(({ player, pc }) => ({ name: player && player.player_name, state: pc.connectionState })),
        pads: pads ? pads.pads() : [],
        errors: (window.__tslErrors || []).slice(-5)
      };
    },
    /** opts: { game, rom:{file|url,name}, bios?:{file|url,name}, code, role:'host'|'guest'|'spectator'|'local', sid?, name,
                matrixId?, expectedGuest?, maxSpectators?, spectatorQuality?, onStatus, onStats, onRematchRequest(name), onRematchDone(how) } */
    start(o) {
      opts = o;
      roster.setExpected(o.expectedGuest || null);
      delay.reload();   // config.json and the game file have loaded by now
      pads = TSL.ControllerBridge.create({ adapter: TSL.Ejs, game: () => opts.game, role: () => opts.role });
      TSL.EjsSetup.configure(opts, TSL.config, onGameStart);
      report("loading");
      TSL.EjsSetup.injectLoader(TSL.config, (message) => report("error", { message }));
    },
    leave() {
      clearInterval(statusTimer); clearTimeout(findTimer); clearInterval(monitorTimer); clearInterval(rosterTimer);
      if (pads) pads.stop();
      delay.stop();
      const n = E().np();
      try { if (n && E().isNetplay()) n.leaveRoom(); } catch (_) {}
    },
    isConnected() { return E().isNetplay(); },
    /** The emulator is running (any role, including local). */
    isStarted() { return E().started(); }
  };
})();

/* Joiners and spectators never run EmulatorJS: route them to the ROM-free
   guest client (guest-client.js). Hosts and local matches keep the emulator. */
TSL.Netplay = ((host) => {
  let guest = false;
  const g = () => TSL.GuestClient;
  return Object.assign({}, host, {
    start(o) {
      guest = o.role === "guest" || o.role === "spectator";
      return guest ? g().start(o) : host.start(o);
    },
    leave() { return guest ? g().leave() : host.leave(); },
    isConnected() { return guest ? g().isConnected() : host.isConnected(); },
    isStarted() { return guest ? g().isStarted() : host.isStarted(); },
    pads() { return guest ? g().pads() : host.pads(); },
    assignPad(i, p) { if (!guest) host.assignPad(i, p); },
    setPreferredPad(id) { return guest ? g().setPreferredPad(id) : host.setPreferredPad(id); },
    getPreferredPad() { return TSL.PadLogic.store(localStorage).preferred(); },
    resetControllerSettings() { return guest ? g().resetControllerSettings() : host.resetControllerSettings(); },
    requestRematch() { return guest ? g().requestRematch() : host.requestRematch(); },
    getRoster() { return guest ? g().getRoster() : host.getRoster(); },
    debugInfo() { return guest ? g().debugInfo() : host.debugInfo(); },
    isGuestClient() { return guest; }
  });
})(TSL.Netplay);
