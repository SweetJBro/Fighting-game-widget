/* The project's own messages on EmulatorJS's netplay data path, wrapped as
   { tsl: { ... } } so EmulatorJS's own handler never sees them:
     { hello: { userid, intent, name, matrixId } }   joiner -> host, repeated
     { roster: { host, hostName, guest, guestName, spectators } }   host -> all
     { rematch: "request", name }                    guest -> host
     { rematch: "done", how }                        host -> all ("instant" | "reboot")
   Pure apart from the netplay object it hooks, so the tests use a fake one. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else { root.TSL = root.TSL || {}; root.TSL.Messaging = api; }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  function create() {
    const handlers = {};   // key -> fn(value, wholeMessage)
    let netplay = null;

    function dispatch(m) {
      if (!m || typeof m !== "object") return;
      for (const key of Object.keys(m)) if (handlers[key]) handlers[key](m[key], m);
    }

    return {
      /** Route our messages off EmulatorJS's dataMessage; everything else passes through. Idempotent. */
      hook(n) {
        netplay = n;
        if (!n || n.__tslHooked) return;
        n.__tslHooked = true;
        const orig = n.dataMessage.bind(n);
        n.dataMessage = (d) => {
          if (d && d.tsl) { dispatch(d.tsl); return; }
          orig(d);
        };
      },
      /** on("hello", fn) / on("roster", fn) / on("rematch", fn). One handler per key. */
      on(key, fn) { handlers[key] = fn; },
      send(msg) { if (netplay && typeof netplay.sendMessage === "function") netplay.sendMessage({ tsl: msg }); },
      /** For tests: feed a message as if it arrived. */
      dispatch
    };
  }

  return { create };
});
