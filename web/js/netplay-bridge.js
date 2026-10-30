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
    const d = v === null ? Number((TSL.config && TSL.config.inputDelayDefault) ?? 3) : Number(v);
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


  // RetroPad indices: 0=B 1=Y 2=SELECT 3=START 4..7=dpad 8=A 9=X 10=L 11=R.
  // FBNeo CPS-3 layout: Y=LP X=MP L=HP B=LK A=MK R=HK.
  const CONTROLS = {
    0: {
      1:  { value: "u", value2: "BUTTON_4" },      // LP
      9:  { value: "i", value2: "BUTTON_3" },      // MP
      10: { value: "o", value2: "LEFT_TOP_SHOULDER" }, // HP
      0:  { value: "j", value2: "BUTTON_2" },      // LK
      8:  { value: "k", value2: "BUTTON_1" },      // MK
      11: { value: "l", value2: "RIGHT_TOP_SHOULDER" }, // HK
      2:  { value: "space", value2: "SELECT" },    // coin
      3:  { value: "enter", value2: "START" },
      4:  { value: "up arrow", value2: "DPAD_UP" },
      5:  { value: "down arrow", value2: "DPAD_DOWN" },
      6:  { value: "left arrow", value2: "DPAD_LEFT" },
      7:  { value: "right arrow", value2: "DPAD_RIGHT" }
    },
    // EmulatorJS 4.2.x replaces its whole table with this object and then
    // touches players 2-4, so they must exist even when empty.
    1: {}, 2: {}, 3: {}
  };

  function emu() { return window.EJS_emulator || null; }
  function np() { const e = emu(); return e && e.netplay ? e.netplay : null; }
  function report(state, extra) { if (opts && opts.onStatus) opts.onStatus(Object.assign({ state }, extra || {})); }

  function configureEJS() {
    const cfg = TSL.config;
    window.EJS_player = "#ejs";
    window.EJS_core = "arcade";               // FBNeo
    // Either a File object (EmulatorJS keeps its name) or a URL to a packaged set.
    window.EJS_gameUrl = opts.rom.file || opts.rom.url;
    window.EJS_gameName = opts.rom.name.replace(/\.zip$/i, "");
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
    window.EJS_gameID = Number(cfg.gameId);
    window.EJS_startOnLoaded = true;
    window.EJS_defaultControls = CONTROLS;
    window.EJS_color = "#ff4d2e";
    window.EJS_backgroundColor = "#000000";
    window.EJS_Buttons = {
      netplay: false, cheat: false, saveState: false, loadState: false, quickSave: false,
      quickLoad: false, cacheManager: false, exitEmulation: false, screenRecord: false,
      saveSavFiles: false, loadSavFiles: false
    };
    // Match Fightcade's sfiii3nr1 setup (its fcadefbneo/games/sfiii3nr1.ini:
    // Region 0x01 = Japan, cpu 0x0100 = 100%). These are the FBNeo core's own
    // defaults for this driver too; pinning them keeps every player identical.
    window.EJS_coreOpts = {
      "fbneo-dipswitch-sfiii3nr1-Region": "Japan",
      "fbneo-cpu-speed-adjust": "100%",
      "fbneo-frameskip-type": "disabled"
    };
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

  function onGameStart() {
    const n = np();
    if (!n) { report("error", { message: "EmulatorJS netplay module missing." }); return; }
    n.name = opts.name;
    if (!n.updateList) n.defineNetplayFunctions();
    if (!n.url) { report("error", { message: "Netplay server URL is not configured." }); return; }
    installInputDelay();
    startMonitor();

    if (opts.role === "host") {
      report("hosting");
      n.openRoom(opts.code, 2, "");
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
        if (entry.current >= entry.max) { report("error", { message: "That match is already full." }); return; }
        n.joinRoom(sid, entry.room_name, entry.max || 2, "");
        return;
      }
      findTimer = setTimeout(attempt, 1500);
    };
    attempt();
  }

  function startStatusLoop() {
    clearInterval(statusTimer);
    statusTimer = setInterval(() => {
      const e = emu(), n = np();
      if (!e || !n) return;
      if (!e.isNetplay) return;
      const players = Object.values(n.players || {});
      const me = n.playerID;
      const other = players.find((p) => p.userid !== me);
      if (players.length >= 2) report("connected", { opponent: other ? other.player_name : "opponent", players: players.length });
      else report(opts.role === "host" ? "waiting" : "joining", { players: players.length });
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
        slowStreak = fps !== null && fps < 50 ? slowStreak + 1 : 0;
      }
      const link = e.isNetplay ? await TSL.Tuning.sample() : null;
      if (opts && opts.onStats) {
        opts.onStats({
          role: hosting ? "host" : "guest",
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
    CONTROLS,
    getInputDelay() { return inputDelay; },
    /** For tests and the console: current frame and queued (delayed) presses. */
    debugDelay() { return { frame, queued: queue.map((q) => ({ at: q.at, index: q.index, value: q.value })) }; },
    setInputDelay(d) {
      inputDelay = Math.max(0, Math.min(8, Math.round(Number(d) || 0)));
      try { localStorage.setItem(DELAY_KEY, String(inputDelay)); } catch (_) {}
      return inputDelay;
    },
    /** opts: { rom:{file,name}, code, role:'host'|'guest', sid?, name, onStatus, onStats } */
    start(o) {
      opts = o;
      inputDelay = readDelay();   // config.json (inputDelayDefault) has loaded by now
      configureEJS();
      report("loading");
      injectLoader();
    },
    leave() {
      clearInterval(statusTimer); clearTimeout(findTimer); clearInterval(monitorTimer);
      const n = np();
      try { if (n && emu().isNetplay) n.leaveRoom(); } catch (_) {}
    },
    isConnected() { const e = emu(); return !!(e && e.isNetplay); }
  };
})();
