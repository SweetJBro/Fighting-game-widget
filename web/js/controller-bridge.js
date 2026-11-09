/* Controllers on the host and in local matches: which physical pad drives
   which player, the preferred pad, and button remaps, all remembered by
   controller name. The rules are in pad-logic.js; this file applies them to
   EmulatorJS through TSL.Ejs.

   EmulatorJS hands out player slots in connection order and refills them on
   every gamepadconnected, and virtual pads (Steam Input) can take Player 1 and
   2 before a real stick does, so the remembered choices are re-applied once a
   second while the game runs. */
window.TSL = window.TSL || {};

TSL.ControllerBridge = (() => {
  /** @param {{ adapter: object, game: () => object, role: () => string }} o */
  function create({ adapter, game, role }) {
    const PL = TSL.PadLogic;
    const store = PL.store(localStorage);
    let timer = null;
    const livePads = () => [...(navigator.getGamepads ? navigator.getGamepads() : [])].filter(Boolean);
    const remapKey = () => "tsl.controls." + game().id;

    /** EmulatorJS's own settings storage is off (it would override the game
        file), so remaps made in its Control Settings menu are saved here, per
        game, and dropped if the game file's default bindings change. */
    function loadRemaps() {
      try {
        const saved = JSON.parse(localStorage.getItem(remapKey()) || "null");
        if (saved && saved.fp === TSL.Games.inputFingerprint(game()) && saved.controls) {
          adapter.setControls(saved.controls);
          adapter.checkGamepadInputs();
        }
      } catch (_) {}
      adapter.onSaveSettings((controls) => {
        try { localStorage.setItem(remapKey(), JSON.stringify({ fp: TSL.Games.inputFingerprint(game()), controls })); } catch (_) {}
      });
    }

    function applyPadPrefs() {
      const sel = adapter.selection();
      if (!sel) return;
      const want = PL.desiredSelection({ selection: sel, pads: livePads(), prefs: store.players(),
        preferredId: store.preferred(), role: role() === "local" ? "local" : "host" });
      for (let i = 0; i < sel.length; i++) if (sel[i] !== want[i]) sel[i] = want[i];
    }

    return {
      start() {
        loadRemaps();
        applyPadPrefs();
        window.addEventListener("gamepadconnected", () => setTimeout(applyPadPrefs, 50));
        clearInterval(timer);
        timer = setInterval(applyPadPrefs, 1000);
      },
      stop() { clearInterval(timer); },
      applyPadPrefs,
      /** Live controllers with what they do right now. */
      pads() {
        const sel = adapter.selection() || [];
        const preferred = store.preferred();
        return livePads().map((gp) => ({
          index: gp.index, id: gp.id, mapping: gp.mapping,
          player: sel.indexOf(PL.selectionValue(gp)),
          standard: gp.mapping === "standard",
          preferred: !!preferred && PL.sameId(gp.id, preferred),
          active: PL.isActive(gp)
        }));
      },
      /** Local match: controller `index` drives `player` (0-based; -1 = not playing). */
      assignPad(index, player) {
        const gp = livePads().find((g) => g.index === index);
        if (!gp) return;
        const prefs = store.players();
        // One controller per player: whoever held this player slot gives it up, and
        // an older entry for the same controller under Steam's other number goes too.
        for (const [id, p] of Object.entries(prefs)) {
          if (id !== gp.id && (p === player || PL.looseId(id) === PL.looseId(gp.id))) delete prefs[id];
        }
        prefs[gp.id] = player;
        store.setPlayers(prefs);
        applyPadPrefs();
      },
      /** The controller that drives Player 1 (null = first one connected). */
      setPreferredPad(id) { store.setPreferred(id || null); applyPadPrefs(); },
      getPreferredPad() { return store.preferred(); },
      /** Forget pad players, the preferred pad and every per-game remap; restore the game's default buttons. */
      resetControllerSettings() {
        const removed = store.reset();
        if (adapter.started()) {
          try { adapter.setControls(TSL.Games.controls(game())); adapter.checkGamepadInputs(); } catch (_) {}
          applyPadPrefs();
        }
        return removed;
      }
    };
  }

  return { create };
})();
