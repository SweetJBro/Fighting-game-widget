/* Matrix room-widget transport (matrix-widget-api over postMessage).

   The hosting client sends its capabilities request as soon as the iframe
   fires "load", so the WidgetApi must be created and started synchronously
   while this script is evaluated, not after config.json or a lazy CDN load.
   matrix-widget-api's browser bundle must therefore be included in index.html
   before this file.

   Lobby traffic is plain room events of type TSL.MATRIX_EVENT_TYPE:
     { v:2, kind:"challenge", id, code, game, from:{id,name,ping}, to:userId|null }
     { v:2, kind:"accept",    id, code, game, by:{id,name} }
     { v:2, kind:"cancel",    id }
   The type name predates multi-game and is kept for compatibility with widgets
   already in rooms. `v` is the content format: 1 (absent) = single game, 3rd
   Strike implied; 2 = `game` present. Readers ignore fields they do not know. */
window.TSL = window.TSL || {};
TSL.MATRIX_EVENT_TYPE = "app.thirdstrike.lobby";
TSL.MATRIX_EVENT_VERSION = 2;

/** The browser bundle registers window.mxwidgets as a lazy module loader
    (a function returning the exports), so unwrap it. */
TSL.mxlib = function mxlib() {
  const m = window.mxwidgets;
  return typeof m === "function" ? m() : m;
};

(function earlyWidgetStart() {
  const params = new URLSearchParams(location.search);
  if (!(params.has("widgetId") || params.has("parentUrl"))) return;
  const mx = TSL.mxlib();
  if (!mx) { console.error("matrix-widget-api not loaded"); return; }
  const type = TSL.MATRIX_EVENT_TYPE;
  const api = new mx.WidgetApi(params.get("widgetId") || undefined);
  const early = { api, ready: false, buffered: [], handler: null };
  early.readyPromise = new Promise((resolve) => api.once("ready", () => { early.ready = true; resolve(); }));
  api.requestCapabilities([
    "org.matrix.msc2762.send.event:" + type,
    "org.matrix.msc2762.receive.event:" + type,
    "org.matrix.msc2762.receive.state_event:m.room.member"
  ]);
  api.on("action:send_event", (ev) => {
    ev.preventDefault();
    try { api.transport.reply(ev.detail, {}); } catch (_) {}
    const e = ev.detail && ev.detail.data;
    if (!e || e.type !== type || !e.content) return;
    if (early.handler) early.handler(e); else early.buffered.push(e);
  });
  api.start();
  TSL.earlyWidget = early;
})();

TSL.MatrixLobby = class MatrixLobby {
  constructor(params) {
    this.userId = params.get("userId") || null;
    this.displayName = params.get("displayName") || null;
    this.roomId = params.get("roomId") || null;
    this.eventType = TSL.MATRIX_EVENT_TYPE;
    this.listeners = [];
    this.api = null;
  }

  static looksLikeWidget(params) {
    return params.has("widgetId") || params.has("parentUrl");
  }

  async init() {
    const early = TSL.earlyWidget;
    if (!early) throw new Error("widget API was not started (is matrix-widget-api included?)");
    this.api = early.api;
    const dispatch = (e) => this.listeners.forEach((fn) => fn(e.content, e.sender, e.origin_server_ts || Date.now()));
    early.handler = dispatch;
    const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error("Matrix client did not answer the widget handshake")), 15000));
    await Promise.race([early.readyPromise, timeout]);
    // No sendContentLoaded(): clients default to waitForIframeLoad=true and
    // reject a content_loaded message as an "improper sequence".
    // Deliver anything that arrived before the app attached its listeners.
    setTimeout(() => { early.buffered.splice(0).forEach(dispatch); }, 0);
    return this;
  }

  onEvent(fn) { this.listeners.push(fn); }

  async members() {
    try {
      const evs = await this.api.readStateEvents("m.room.member", 500);
      return (evs || [])
        .filter((e) => e.content && e.content.membership === "join")
        .map((e) => ({ id: e.state_key, name: e.content.displayname || e.state_key }));
    } catch (_) { return []; }
  }

  async recent(limit = 60) {
    try {
      const evs = await this.api.readRoomEvents(this.eventType, limit);
      return (evs || []).map((e) => ({ content: e.content, sender: e.sender, ts: e.origin_server_ts || 0 }));
    } catch (_) { return []; }
  }

  send(content) { return this.api.sendRoomEvent(this.eventType, Object.assign({ v: TSL.MATRIX_EVENT_VERSION }, content)); }
};
