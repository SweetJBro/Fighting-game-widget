/* Pure controller rules shared by the host bridge, the ROM-free guest client,
   the controller panel and the tests (no DOM, no Gamepad API calls).

   Vocabulary
     pad          anything shaped like a Gamepad: { id, index, mapping, buttons?, axes? }
     prefs        { [controller id]: player }  player 0/1 = Player 1/2, -1 = not playing
                  (local matches; remembered by controller name)
     preferredId  one controller id the player wants to use when several are
                  plugged in (Steam's virtual pad next to a real stick). Host:
                  it drives Player 1. Guest: only it is read.
     selection    EmulatorJS frontend.gamepadSelection: one "id_index" per player slot */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else { root.TSL = root.TSL || {}; root.TSL.PadLogic = api; }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const KEYS = { players: "tsl.padPlayers", preferred: "tsl.preferredPad", remapPrefix: "tsl.controls." };

  /** Steam Input renumbers its virtual pads ("X-Box 360 pad 2" today, "pad 0" after a reconnect). */
  const looseId = (id) => String(id || "").replace(/\bpad \d+\b/i, "pad");
  const sameId = (a, b) => a === b || looseId(a) === looseId(b);
  /** "Qanba Q4 (Vendor: 2c22 Product: 2300)" -> "Qanba Q4" */
  const shortName = (id) => String(id || "").replace(/\s*\((?:STANDARD GAMEPAD|Vendor:)[^)]*\)/i, "").replace(/\s+/g, " ").trim() || String(id || "");
  const selectionValue = (gp) => gp.id + "_" + gp.index;

  /** The remembered player for a controller id, exact name first, then without Steam's pad number. */
  function prefFor(prefs, id) {
    if (typeof prefs[id] === "number") return prefs[id];
    const hit = Object.keys(prefs).find((k) => looseId(k) === looseId(id));
    return hit === undefined ? undefined : prefs[hit];
  }

  /** The connected pad a preferred id refers to, or null. */
  function findPreferred(pads, preferredId) {
    if (!preferredId) return null;
    return pads.find((gp) => gp.id === preferredId) || pads.find((gp) => looseId(gp.id) === looseId(preferredId)) || null;
  }

  /** Any button down or a stick pushed: the "this one is alive" indicator. */
  function isActive(gp) {
    if (!gp) return false;
    if ((gp.buttons || []).some((b) => b && (b.pressed || b.value > 0.5))) return true;
    return (gp.axes || []).slice(0, 4).some((a) => Math.abs(a) > 0.5);
  }

  /**
   * Guest: which connected pads to read.
   *   preferred connected  -> only that one, whatever its mapping (the player chose it)
   *   otherwise            -> every pad with the standard mapping; a non-standard pad's
   *                           button numbers mean nothing to the game's table
   *   no standard pad      -> every pad (better than ignoring the only controller)
   * @returns {{ pads: object[], reason: "preferred"|"standard"|"all"|"none" }}
   */
  function pickPads(pads, preferredId) {
    const pref = findPreferred(pads, preferredId);
    if (pref) return { pads: [pref], reason: "preferred" };
    const standard = pads.filter((gp) => gp.mapping === "standard");
    if (standard.length) return { pads: standard, reason: "standard" };
    if (pads.length) return { pads, reason: "all" };
    return { pads: [], reason: "none" };
  }

  /**
   * Host and local: the player slots EmulatorJS should use, from the remembered
   * choices. Rules, strongest first:
   *   1. an explicit player per controller (local match dropdown): that slot,
   *      displacing whoever held it; -1 removes the pad from every slot
   *   2. the preferred controller takes Player 1 unless rule 1 gave it to someone else
   *   3. online host: slots 2-4 are emptied. Player 2 is the remote guest, whose
   *      inputs arrive over the data channel and never go through the selection,
   *      so a second local pad must not drive the opponent
   *   4. online host with an empty Player 1 slot: the first connected pad that is
   *      not "not playing" takes it (EmulatorJS only fills slots on connect events)
   * Pure: returns a new array; the caller writes it back.
   */
  function desiredSelection({ selection, pads, prefs = {}, preferredId = null, role = "local" }) {
    const sel = selection.slice();
    const remove = (v) => { for (let i = 0; i < sel.length; i++) if (sel[i] === v) sel[i] = ""; };
    const place = (gp, slot) => { const v = selectionValue(gp); remove(v); sel[slot] = v; };
    const explicit = new Map();   // slot -> pad placed by rule 1
    for (const gp of pads) {
      const want = prefFor(prefs, gp.id);
      if (typeof want !== "number") continue;
      if (want < 0) { remove(selectionValue(gp)); continue; }
      if (want >= sel.length) continue;
      place(gp, want); explicit.set(want, gp);
    }
    const pref = findPreferred(pads, preferredId);
    if (pref && typeof prefFor(prefs, pref.id) !== "number" && !explicit.has(0)) place(pref, 0);
    if (role === "host") {
      for (let i = 1; i < sel.length; i++) sel[i] = "";
      if (sel[0] === "") {
        const first = pads.find((gp) => prefFor(prefs, gp.id) !== -1);
        if (first) sel[0] = selectionValue(first);
      }
    }
    return sel;
  }

  /** Storage keys the "Reset controller settings" button removes. */
  function resetKeys(allKeys) {
    return allKeys.filter((k) => k === KEYS.players || k === KEYS.preferred || k.startsWith(KEYS.remapPrefix));
  }

  /** localStorage-backed access to the remembered choices (every call guarded). */
  function store(storage) {
    const get = (k) => { try { return storage.getItem(k); } catch (_) { return null; } };
    const set = (k, v) => { try { if (v === null) storage.removeItem(k); else storage.setItem(k, v); } catch (_) {} };
    return {
      players() { try { return JSON.parse(get(KEYS.players) || "{}") || {}; } catch (_) { return {}; } },
      setPlayers(prefs) { set(KEYS.players, Object.keys(prefs).length ? JSON.stringify(prefs) : null); },
      preferred() { return get(KEYS.preferred) || null; },
      setPreferred(id) { set(KEYS.preferred, id || null); },
      /** Removes pad players, the preferred pad and every per-game remap. Returns the keys removed. */
      reset() {
        let keys = [];
        try { for (let i = 0; i < storage.length; i++) keys.push(storage.key(i)); } catch (_) {}
        keys = resetKeys(keys);
        for (const k of keys) set(k, null);
        return keys;
      }
    };
  }

  return { KEYS, looseId, sameId, shortName, selectionValue, prefFor, findPreferred, isActive, pickPads, desiredSelection, resetKeys, store };
});
