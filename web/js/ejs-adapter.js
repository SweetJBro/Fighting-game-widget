/* Every EmulatorJS internal the host side reaches into, in one place.
   docs/emulatorjs-internals.md lists them and scripts/check-ejs-internals.mjs
   checks them against the pinned copy; when a pin bump breaks one, this file
   is where it gets fixed. The guest client never loads EmulatorJS and speaks
   the netplay protocol directly, so it is not routed through here. */
window.TSL = window.TSL || {};

TSL.Ejs = (() => {
  const emu = () => window.EJS_emulator || null;
  const np = () => { const e = emu(); return e && e.netplay ? e.netplay : null; };
  const gm = () => { const e = emu(); return e && e.gameManager ? e.gameManager : null; };

  return {
    emu, np, gm,
    started: () => !!(emu() && emu().started),
    isNetplay: () => !!(emu() && emu().isNetplay),
    /** Host of the current room (false for a guest, a spectator, or a local match). */
    isOwner: () => { const n = np(); return !!(n && n.owner); },

    // ---- core ----
    /** The core's frame counter (get_current_frame_count). Module.postMainLoop never fires in this build. */
    getFrameNum() { const g = gm(); return g && g.getFrameNum ? g.getFrameNum() : 0; },
    /** Replace simulate_input (every input, local and remote, passes through it). Returns the original, or null. */
    wrapSimulateInput(fn) {
      const g = gm();
      if (!g || !g.functions || typeof g.functions.simulateInput !== "function") return null;
      const raw = g.functions.simulateInput;
      g.functions.simulateInput = fn;
      return raw;
    },
    getState() { return gm().getState(); },
    loadState(state) { return gm().loadState(state); },
    restart() { return gm().restart(); },
    /** EmulatorJS calls Module.EmulatorJSGetState, which the published fbneo core
        (2025-06-14 build) does not export; rebuild it from the older save_state_info. */
    shimSaveStates() {
      const g = gm();
      const M = g && g.Module;
      if (!M || typeof M.EmulatorJSGetState === "function" || typeof M._save_state_info !== "function") return false;
      const info = M.cwrap("save_state_info", "string", []);
      M.EmulatorJSGetState = () => {
        const [size, ptr] = info().split("|").map((x) => parseInt(x, 10));
        if (!(size > 0)) throw new Error("core returned no save state");
        return M.HEAPU8.slice(ptr, ptr + size);
      };
      return true;
    },

    // ---- netplay client ----
    players() { const n = np(); return n && n.players ? Object.values(n.players) : []; },
    playerId() { const n = np(); return n ? n.playerID : null; },
    /** Host: the room member behind an RTCPeerConnection, or null. */
    playerForPc(pc) {
      const n = np();
      if (!n) return null;
      let peerId = null;
      for (const [id, entry] of Object.entries(n.peerConnections || {})) if (entry && entry.pc === pc) { peerId = id; break; }
      return peerId ? Object.values(n.players || {}).find((q) => q.socketId === peerId) || null : null;
    },
    /** Host: [{ player, pc }] for every peer with a connection. */
    peers() {
      const n = np();
      if (!n) return [];
      const out = [];
      for (const [id, entry] of Object.entries(n.peerConnections || {})) {
        if (!entry || !entry.pc) continue;
        const player = Object.values(n.players || {}).find((q) => q.socketId === id) || null;
        out.push({ player, pc: entry.pc });
      }
      return out;
    },

    // ---- frontend: controllers ----
    /** frontend.gamepadSelection: one "id_index" per player slot, refilled by EmulatorJS on every connect. */
    selection() { const e = emu(); return e && e.frontend ? e.frontend.gamepadSelection || null : null; },
    checkGamepadInputs() { const e = emu(); if (e && e.frontend && e.frontend.checkGamepadInputs) e.frontend.checkGamepadInputs(); },
    getControls() { const e = emu(); return e ? e.controls : null; },
    setControls(c) { const e = emu(); if (e) e.controls = c; },
    /** Run `after(controls)` whenever EmulatorJS saves its settings (a remap in its menu). */
    onSaveSettings(after) {
      const e = emu();
      if (!e || typeof e.saveSettings !== "function") return;
      const orig = e.saveSettings.bind(e);
      e.saveSettings = () => { orig(); if (e.started) after(e.controls); };
    }
  };
})();
