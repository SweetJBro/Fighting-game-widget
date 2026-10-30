/* Runtime configuration. server/serve.js renders /config.json from environment
   variables; when it is missing (plain static hosting) these defaults apply. */
window.TSL = window.TSL || {};

TSL.loadConfig = async function loadConfig() {
  const defaults = {
    // EmulatorJS netplay server (socket.io). Must be its own origin, not a sub-path.
    netplayUrl: location.protocol + "//" + location.hostname + ":4000",
    // STUN/TURN for the host->guest WebRTC video stream. Add a TURN server for
    // players behind strict NATs.
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    // EmulatorJS data directory (loader.js, cores). "latest" is required: the
    // 4.2.3 "stable" build still has the old netplay client, which cannot talk
    // to the current WebRTC netplay server. Self-host by copying the
    // EmulatorJS "data" folder into web/ejs/ and setting EJS_DATA_PATH=ejs/.
    ejsDataPath: "https://cdn.emulatorjs.org/latest/data/",
    // Rooms are namespaced per game on the netplay server: each web/games/<id>.json
    // has its own netplayId (3rd Strike keeps 33, the old global default).
    // Where this page is reachable from the outside; used for share links.
    publicUrl: location.origin + location.pathname,
  };
  try {
    const res = await fetch("config.json", { cache: "no-store" });
    if (res.ok) Object.assign(defaults, await res.json());
  } catch (_) { /* static hosting without config.json */ }
  TSL.config = defaults;
  return defaults;
};
