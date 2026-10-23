/* Drives EmulatorJS and its built-in netplay without the globe-icon menu.
   Host runs the game and streams video/audio to the guest over WebRTC; the
   guest's inputs travel back through the netplay server as Player 2. */
window.TSL = window.TSL || {};

TSL.Netplay = (() => {
  let opts = null;
  let statusTimer = null;
  let findTimer = null;
  let loaderInjected = false;

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

  return {
    CONTROLS,
    /** opts: { rom:{file,name}, code, role:'host'|'guest', sid?, name, onStatus } */
    start(o) {
      opts = o;
      configureEJS();
      report("loading");
      injectLoader();
    },
    leave() {
      clearInterval(statusTimer); clearTimeout(findTimer);
      const n = np();
      try { if (n && emu().isNetplay) n.leaveRoom(); } catch (_) {}
    },
    isConnected() { const e = emu(); return !!(e && e.isNetplay); }
  };
})();
