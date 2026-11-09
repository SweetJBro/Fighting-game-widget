/* Pure match logic shared by the host bridge and the tests (no DOM, no network).

   decideRoster   who is Player 2 and who watches
   DelayQueue     the host's own inputs, held back N emulator frames */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else { root.TSL = root.TSL || {}; root.TSL.MatchLogic = api; }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /**
   * Decides the roster on the host.
   * @param {object} a
   * @param {{userid:string, player_name?:string}[]} a.present  joiners in join order (host excluded)
   * @param {Object<string,{intent:string,name?:string,matrixId?:string|null}>} a.intents  hellos received, by userid
   * @param {string|null} a.currentGuest   Player 2 so far (kept while present and still allowed)
   * @param {string|null} a.expectedGuest  Matrix id reserved for Player 2, or null for first-come
   * @returns {{guest:string|null, guestName:string|null, spectators:string[]}}
   *
   * Rules: a current Player 2 keeps the seat while present (and, with a
   * reservation, while their Matrix id matches). Otherwise the first present
   * joiner who asked to play ("guest" intent) and matches the reservation gets
   * it. Everyone else watches, including joiners whose hello has not arrived.
   */
  function decideRoster({ present, intents, currentGuest = null, expectedGuest = null }) {
    const ids = present.map((p) => p.userid);
    const allowed = (id) => {
      const it = intents[id];
      if (!it || it.intent !== "guest") return false;
      return !expectedGuest || it.matrixId === expectedGuest;
    };
    let guest = currentGuest && ids.includes(currentGuest) ? currentGuest : null;
    if (guest && expectedGuest && !allowed(guest)) guest = null;
    if (!guest) {
      const first = present.find((p) => allowed(p.userid));
      guest = first ? first.userid : null;
    }
    const nameOf = (id) => {
      const p = present.find((q) => q.userid === id);
      return (intents[id] && intents[id].name) || (p && p.player_name) || "Player";
    };
    return { guest, guestName: guest ? nameOf(guest) : null, spectators: ids.filter((id) => id !== guest).map(nameOf) };
  }

  /**
   * Holds input events until the emulator reaches a later frame.
   * push(frame, delay, ev) schedules ev for frame + delay; due(frame) returns the
   * events whose time has come, in order. Order is never inverted: if the delay
   * is lowered mid-match, a new event waits for the last queued one.
   */
  class DelayQueue {
    constructor() { this.items = []; }
    push(frame, delay, ev) {
      const last = this.items.length ? this.items[this.items.length - 1].at : 0;
      this.items.push(Object.assign({}, ev, { at: Math.max(frame + delay, last) }));
    }
    due(frame) {
      let n = 0;
      while (n < this.items.length && this.items[n].at <= frame) n++;
      return this.items.splice(0, n);
    }
    clear() { this.items.length = 0; }
    get size() { return this.items.length; }
  }

  return { decideRoster, DelayQueue };
});
