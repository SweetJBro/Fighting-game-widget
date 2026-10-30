/* Drives EmulatorJS and its built-in netplay without the globe-icon menu.
   Host runs the game and streams video/audio to the guest over WebRTC; the
   guest's inputs come back as Player 2 over a WebRTC data channel.

   Host input delay: the host feels no network lag at all while the guest feels
   a full round trip plus encode/decode. Delaying the host's OWN inputs by N
   frames evens that out. It makes matches fairer; it does not make the guest's
   side any faster, and nothing can in a streaming design. */
window.TSL = window.TSL || {};

TSL.Netplay = (() => {
  let opts = null;
  let statusTimer = null;
  let findTimer = null;
  let loaderInjected = false;
  let monitorTimer = null;
  let rosterTimer = null;

  // ---- roles ------------------------------------------------------------
  // Every joiner announces an intent ("guest" or "spectator"). The host is the
  // single authority: the first present joiner who wants to play becomes Player 2,
  // everyone else watches. The host remaps that peer's inputs to player 1 and
  // drops everyone else's, so a spectator who connects first can never steal P2.
  const intents = {};            // host: userid -> { intent, name }
  let roster = null;             // everyone: { host, guest, guestName, hostName, spectators: [names] }
  let lastRosterJson = "";

  function sendTsl(msg) { const n = np(); if (n) n.sendMessage({ tsl: msg }); }

  // ---- host input delay -------------------------------------------------
  const DELAY_KEY = "tsl.inputDelay";
  let inputDelay = readDelay();
  let frame = 0;                 // last core frame number seen (get_current_frame_count)
  const queue = [];              // [{ at, player, index, value }]
  let rawSimulate = null;        // core's own simulate_input
  let tickRaf = 0;

  function readDelay() {
    let v = null;
    try { v = localStorage.getItem(DELAY_KEY); } catch (_) {}
    const fallback = (TSL.config && TSL.config.inputDelayDefault) ??
      (opts && opts.game && opts.game.netplay && opts.game.netplay.defaultInputDelay) ?? 3;
    const d = v === null ? Number(fallback) : Number(v);
    return Number.isFinite(d) ? Math.max(0, Math.min(8, Math.round(d))) : 3;
  }

  /** Wrap the core's simulate_input on the host so Player 1 (local) presses land
      `inputDelay` frames later. Player 2 (guest, via data channel) is untouched. */
  function installInputDelay() {
    const e = emu();
    const gm = e && e.gameManager;
    if (!gm || !gm.functions || rawSimulate) return;
    rawSimulate = gm.functions.simulateInput;
    gm.functions.simulateInput = (player, index, value) => {
      const n = np();
      const hosting = e.isNetplay && n && n.owner;
      if (hosting && player === 0 && inputDelay > 0) {
        frame = gm.getFrameNum();
        // Never let a later event overtake an earlier one (delay lowered mid-match).
        const last = queue.length ? queue[queue.length - 1].at : 0;
        queue.push({ at: Math.max(frame + inputDelay, last), player, index, value });
        return;
      }
      rawSimulate(player, index, value);
    };
    // Per-frame tick. Module.postMainLoop is never called by this EmulatorJS
    // build (its own netplay frame counter stays at 0), so poll the core's frame
    // counter on every animation frame. The emulator itself is rAF-driven, so a
    // queued press lands within the frame it is due, give or take one.
    const tick = () => {
      frame = gm.getFrameNum();
      while (queue.length && queue[0].at <= frame) {
        const q = queue.shift();
        rawSimulate(q.player, q.index, q.value);
      }
      tickRaf = requestAnimationFrame(tick);
    };
    cancelAnimationFrame(tickRaf);
    tickRaf = requestAnimationFrame(tick);
  }


  function emu() { return window.EJS_emulator || null; }
  function np() { const e = emu(); return e && e.netplay ? e.netplay : null; }
  function report(state, extra) { if (opts && opts.onStatus) opts.onStatus(Object.assign({ state }, extra || {})); }

  function configureEJS() {
    const cfg = TSL.config;
    window.EJS_player = "#ejs";
    const game = opts.game;
    window.EJS_core = game.core;              // "arcade" = FBNeo
    // Either a File object (EmulatorJS keeps its name) or a URL to a packaged set.
    window.EJS_gameUrl = opts.rom.file || opts.rom.url;
    window.EJS_gameName = game.id;
    // Neo Geo and friends: the BIOS zip, same File-or-URL rule. EmulatorJS writes
    // it next to the game unextracted, where FBNeo finds it by name.
    window.EJS_biosUrl = opts.bios ? (opts.bios.file || opts.bios.url) : "";
    window.EJS_pathtodata = cfg.ejsDataPath;
    // The pinned copy (scripts/fetch-emulatorjs.sh) is the unminified git tree:
    // point the loader at the source files directly instead of 404ing on the
    // missing emulator.min.* first.
    if (!/^https?:/i.test(cfg.ejsDataPath)) {
      window.EJS_paths = Object.assign({}, window.EJS_paths, {
        "emulator.min.js": cfg.ejsDataPath + "src/emulator.js",
        "emulator.min.css": cfg.ejsDataPath + "emulator.css"
      });
    }
    window.EJS_netplayServer = cfg.netplayUrl;
    window.EJS_netplayICEServers = cfg.iceServers;
    // Rooms are namespaced per game on the netplay server, so a 3rd Strike
    // lobby never lists (or joins) a KOF room.
    window.EJS_gameID = Number(game.netplayId);
    window.EJS_startOnLoaded = true;
    window.EJS_defaultControls = TSL.Games.controls(game);
    window.EJS_color = "#ff4d2e";
    window.EJS_backgroundColor = "#000000";
    window.EJS_Buttons = {
      netplay: false, cheat: false, saveState: false, loadState: false, quickSave: false,
      quickLoad: false, cacheManager: false, exitEmulation: false, screenRecord: false,
      saveSavFiles: false, loadSavFiles: false
    };
    // Pinned per game (web/games/<id>.json coreOpts) so every player runs
    // identical settings, e.g. 3rd Strike Region = Japan as on Fightcade.
    window.EJS_coreOpts = Object.assign({}, game.coreOpts);
    // Threaded core (fbneo-thread-*.data) needs SharedArrayBuffer, which only
    // exists in a cross-origin isolated page: the pop-out tab, never the Matrix
    // iframe. server/serve.js sends COOP/COEP for ?isolate=1. Measured on CPS-3:
    // ~1575 vs ~1530 uncapped frames/s, i.e. no meaningful gain; THREADS=0 turns it off.
    window.EJS_threads = !!(window.crossOriginIsolated && cfg.threads !== false);
    window.EJS_onGameStart = onGameStart;
  }

  function injectLoader() {
    if (loaderInjected) return;
    loaderInjected = true;
    // Surface EmulatorJS failures (they are otherwise swallowed as unhandled rejections).
    window.__tslErrors = [];
    const capture = (err) => {
      const text = (err && err.stack) || String(err);
      window.__tslErrors.push(text);
      if (!window.EJS_emulator) report("error", { message: "EmulatorJS failed before the game started: " + ((err && err.message) || err) });
    };
    window.addEventListener("unhandledrejection", (ev) => capture(ev.reason));
    window.addEventListener("error", (ev) => { if (ev.error) capture(ev.error); });
    const s = document.createElement("script");
    s.src = TSL.config.ejsDataPath + "loader.js";
    s.onerror = () => report("error", { message: "Could not load EmulatorJS from " + TSL.config.ejsDataPath });
    document.body.appendChild(s);
  }

  /** EmulatorJS main calls Module.EmulatorJSGetState, which the published fbneo
      core (2025-06-14 build) does not export. Rebuild it from the older
      save_state_info export so EmulatorJS's own save/load paths work. */
  function shimSaveStates() {
    const gm = emu() && emu().gameManager;
    const M = gm && gm.Module;
    if (!M || typeof M.EmulatorJSGetState === "function" || typeof M._save_state_info !== "function") return;
    const info = M.cwrap("save_state_info", "string", []);
    M.EmulatorJSGetState = () => {
      const [size, ptr] = info().split("|").map((x) => parseInt(x, 10));
      if (!(size > 0)) throw new Error("core returned no save state");
      return M.HEAPU8.slice(ptr, ptr + size);
    };
  }

  function onGameStart() {
    const n = np();
    if (!n) { report("error", { message: "EmulatorJS netplay module missing." }); return; }
    n.name = opts.name;
    if (!n.updateList) n.defineNetplayFunctions();
    if (!n.url) { report("error", { message: "Netplay server URL is not configured." }); return; }
    shimSaveStates();
    installInputDelay();
    hookMessages(n);
    startMonitor();

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

  function findRoomAndJoin() {
    const n = np();
    const deadline = Date.now() + 120000;
    const attempt = async () => {
      if (!np() || Date.now() > deadline) {
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

  function maxSpectators() {
    const v = Number(TSL.config && TSL.config.maxSpectators);
    return Number.isFinite(v) ? Math.max(0, Math.min(6, Math.round(v))) : 2;
  }

  /** Route our own {tsl: ...} messages; everything else goes to EmulatorJS. */
  function hookMessages(n) {
    if (n.__tslHooked) return;
    n.__tslHooked = true;
    const orig = n.dataMessage.bind(n);
    n.dataMessage = (d) => {
      if (d && d.tsl) { onTsl(d.tsl); return; }
      orig(d);
    };
  }

  function onTsl(m) {
    const n = np();
    if (!n) return;
    if (n.owner) {
      if (m.hello && m.hello.userid) { intents[m.hello.userid] = { intent: m.hello.intent, name: m.hello.name }; updateRoster(); }
      if (m.rematch === "request" && opts.onRematchRequest) opts.onRematchRequest(m.name || "Your opponent");
    } else {
      if (m.roster) roster = m.roster;
      if (m.rematch === "done" && opts.onRematchDone) opts.onRematchDone();
    }
  }

  /** Host: recompute who is Player 2 and broadcast the roster when it changes. */
  function updateRoster(force) {
    const n = np();
    if (!n || !n.owner) return;
    const present = Object.values(n.players || {}).filter((p) => p.userid !== n.playerID);
    const ids = present.map((p) => p.userid);
    let guest = roster && ids.includes(roster.guest) ? roster.guest : null;
    if (!guest) {
      const first = present.find((p) => intents[p.userid] && intents[p.userid].intent === "guest");
      guest = first ? first.userid : null;
    }
    const nameOf = (id) => {
      const p = present.find((q) => q.userid === id);
      return (intents[id] && intents[id].name) || (p && p.player_name) || "Player";
    };
    roster = {
      host: n.playerID, hostName: opts.name,
      guest, guestName: guest ? nameOf(guest) : null,
      spectators: ids.filter((id) => id !== guest).map(nameOf)
    };
    const json = JSON.stringify(roster);
    if (force || json !== lastRosterJson) { lastRosterJson = json; sendTsl({ roster }); }
  }

  /** Host: decide what an incoming data-channel input becomes. */
  function hostInputFilter(pc, d) {
    if (!d || typeof d.player !== "number") return d;          // control messages pass
    const n = np();
    if (!n || !roster || !roster.guest) return null;
    let peerId = null;
    for (const [id, entry] of Object.entries(n.peerConnections || {})) if (entry && entry.pc === pc) { peerId = id; break; }
    const p = Object.values(n.players || {}).find((q) => q.socketId === peerId);
    if (!p || p.userid !== roster.guest) return null;            // spectator or unknown: ignore
    return d.player === 1 ? d : Object.assign({}, d, { player: 1 });
  }

  function startStatusLoop() {
    clearInterval(statusTimer);
    clearInterval(rosterTimer);
    // Joiners repeat their hello (cheap, survives a host that joined the socket late);
    // the host re-sends the roster so late arrivals learn it.
    rosterTimer = setInterval(() => {
      const n = np();
      if (!n || !emu() || !emu().isNetplay) return;
      if (n.owner) updateRoster(true);
      else sendTsl({ hello: { userid: n.playerID, intent: opts.role === "host" ? "guest" : opts.role, name: opts.name } });
    }, 2000);
    statusTimer = setInterval(() => {
      const e = emu(), n = np();
      if (!e || !n) return;
      if (!e.isNetplay) return;
      const count = Object.keys(n.players || {}).length;
      if (n.owner) {
        updateRoster();
        if (roster && roster.guest) report("connected", { opponent: roster.guestName, spectators: roster.spectators.length });
        else report("waiting", { spectators: roster ? roster.spectators.length : 0 });
        return;
      }
      const me = n.playerID;
      if (!roster) { report("joining", { players: count }); return; }
      if (opts.role === "spectator" || (roster.guest && roster.guest !== me)) {
        report("watching", {
          host: roster.hostName, guest: roster.guestName,
          bumped: opts.role === "guest" && !!roster.guest && roster.guest !== me
        });
      } else if (roster.guest === me) {
        report("connected", { opponent: roster.hostName, spectators: roster.spectators.length });
      } else {
        report("joining", { players: count });
      }
    }, 1000);
  }

  // ---- performance + connection monitor ---------------------------------
  function startMonitor() {
    clearInterval(monitorTimer);
    let lastFrame = null, lastT = 0, slowStreak = 0;
    monitorTimer = setInterval(async () => {
      const e = emu();
      if (!e || !e.gameManager) return;
      const n = np();
      const now = performance.now();
      let fps = null;
      // The guest's own emulator is frozen while it watches the stream, so only
      // the host's emulator fps means anything.
      const hosting = !e.isNetplay || (n && n.owner);
      if (hosting) {
        const f = e.gameManager.getFrameNum();
        if (lastFrame !== null) fps = Math.round((f - lastFrame) * 1000 / (now - lastT));
        lastFrame = f; lastT = now;
        const warnBelow = (opts.game.performance && opts.game.performance.warnBelowFps) || 50;
        slowStreak = fps !== null && fps < warnBelow ? slowStreak + 1 : 0;
      }
      const link = e.isNetplay ? await TSL.Tuning.sample() : null;
      // ICE gave up on every peer and nothing is connected: no route between the
      // two networks. Almost always a strict NAT/firewall that needs TURN.
      const linkFailed = e.isNetplay && TSL.Tuning.failures() > 0 && TSL.Tuning.connectedCount() === 0;
      if (opts && opts.onStats) {
        opts.onStats({
          role: hosting ? "host" : opts.role,
          linkFailed,
          usingTurn: (TSL.config.iceServers || []).some((s) => [].concat(s.urls || []).some((u) => /^turns?:/i.test(u))),
          emuFps: fps,
          slow: slowStreak >= 3,
          hidden: document.hidden,
          threads: !!window.EJS_threads,
          inputDelay: hosting ? inputDelay : null,
          link,
          quality: TSL.Tuning.grade(link && link.rttMs)
        });
      }
    }, 1000);
  }

  return {
    getInputDelay() { return inputDelay; },
    /** For tests and the console: current frame and queued (delayed) presses. */
    debugDelay() { return { frame, queued: queue.map((q) => ({ at: q.at, index: q.index, value: q.value })) }; },
    setInputDelay(d) {
      inputDelay = Math.max(0, Math.min(8, Math.round(Number(d) || 0)));
      try { localStorage.setItem(DELAY_KEY, String(inputDelay)); } catch (_) {}
      return inputDelay;
    },
    /** Host: restart the game for a rematch, keeping room, peers and stream. */
    rematch() {
      const e = emu(), n = np();
      if (!e || !e.gameManager || !n || !n.owner) return false;
      queue.length = 0;
      e.gameManager.restart();
      sendTsl({ rematch: "done" });
      return true;
    },
    /** Guest: ask the host for a rematch. */
    requestRematch() { sendTsl({ rematch: "request", name: opts && opts.name }); },
    getRoster() { return roster; },
    /** opts: { game, rom:{file|url,name}, bios?:{file|url,name}, code, role:'host'|'guest'|'spectator', sid?, name,
                onStatus, onStats, onRematchRequest(name), onRematchDone() } */
    start(o) {
      opts = o;
      inputDelay = readDelay();   // config.json and the game file have loaded by now
      configureEJS();
      report("loading");
      injectLoader();
    },
    leave() {
      clearInterval(statusTimer); clearTimeout(findTimer); clearInterval(monitorTimer); clearInterval(rosterTimer);
      const n = np();
      try { if (n && emu().isNetplay) n.leaveRoom(); } catch (_) {}
    },
    isConnected() { const e = emu(); return !!(e && e.isNetplay); }
  };
})();
