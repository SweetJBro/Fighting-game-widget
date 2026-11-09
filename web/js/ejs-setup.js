/* EmulatorJS configuration (the EJS_* globals) and loader injection. Called
   once per page: EmulatorJS cannot be torn down and started again, which is
   why leaving a match reloads the page. */
window.TSL = window.TSL || {};

TSL.EjsSetup = (() => {
  let injected = false;

  /** Sets every EJS_* global for this match. `onGameStart` runs once the core is up. */
  function configure({ game, rom, bios }, cfg, onGameStart) {
    window.EJS_player = "#ejs";
    window.EJS_core = game.core;              // "arcade" = FBNeo
    // Either a File object (EmulatorJS keeps its name) or a URL to a packaged set.
    window.EJS_gameUrl = rom.file || rom.url;
    window.EJS_gameName = game.id;
    // Neo Geo and friends: the BIOS zip, same File-or-URL rule. EmulatorJS writes
    // it next to the game unextracted, where FBNeo finds it by name.
    window.EJS_biosUrl = bios ? (bios.file || bios.url) : "";
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
    // Pinned per game (web/games/<id>.json coreOpts), e.g. 3rd Strike Region =
    // Japan as on Fightcade. EJS_defaultOptions is what the core actually starts
    // with; EJS_coreOpts only changes the defaults its settings menu displays.
    window.EJS_defaultOptions = Object.assign({}, game.coreOpts);
    window.EJS_coreOpts = Object.assign({}, game.coreOpts);
    // EmulatorJS otherwise saves its settings AND button table per game in
    // localStorage once a player touches its menu, and those then override the
    // game file on every later visit. Our own preferences (name, delay, game)
    // live under tsl.* keys and are unaffected; ROMs stay cached in IndexedDB.
    window.EJS_disableLocalStorage = true;
    // Threaded core (fbneo-thread-*.data) needs SharedArrayBuffer, which only
    // exists in a cross-origin isolated page: the pop-out tab, never the Matrix
    // iframe. server/serve.js sends COOP/COEP for ?isolate=1. Measured on CPS-3:
    // ~1575 vs ~1530 uncapped frames/s, i.e. no meaningful gain; THREADS=0 turns it off.
    window.EJS_threads = !!(window.crossOriginIsolated && cfg.threads !== false);
    window.EJS_onGameStart = onGameStart;
  }

  /** Adds loader.js once. `onError(message)` gets load failures and anything EmulatorJS throws before the game starts. */
  function injectLoader(cfg, onError) {
    if (injected) return;
    injected = true;
    // Surface EmulatorJS failures (they are otherwise swallowed as unhandled rejections).
    window.__tslErrors = window.__tslErrors || [];
    const capture = (err) => {
      const text = (err && err.stack) || String(err);
      window.__tslErrors.push(text);
      if (!window.EJS_emulator) onError("EmulatorJS failed before the game started: " + ((err && err.message) || err));
    };
    window.addEventListener("unhandledrejection", (ev) => capture(ev.reason));
    window.addEventListener("error", (ev) => { if (ev.error) capture(ev.error); });
    const s = document.createElement("script");
    s.src = cfg.ejsDataPath + "loader.js";
    s.onerror = () => onError("Could not load EmulatorJS from " + cfg.ejsDataPath);
    document.body.appendChild(s);
  }

  return { configure, injectLoader };
})();
