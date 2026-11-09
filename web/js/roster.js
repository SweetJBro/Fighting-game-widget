/* Host-side roster: who is Player 2, who watches, and telling everyone.
   Pure apart from the `send` callback, so it runs in Node for the tests.

   Every joiner announces an intent ("guest" or "spectator") in a hello. The
   host is the single authority: TSL.MatchLogic.decideRoster picks Player 2
   (first present joiner who asked to play, or the Matrix member the challenge
   named), everyone else watches. The host remaps that peer's inputs to Player 2
   and drops everyone else's, so a spectator who connects first can never steal
   the seat. Guests only receive the roster and keep a copy. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else { root.TSL = root.TSL || {}; root.TSL.Roster = api; }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /**
   * @param {object} o
   * @param {function} o.decide   TSL.MatchLogic.decideRoster
   * @param {function} o.send     send({ roster }) to the room
   * @param {function} o.present  () => joiners in join order, host excluded: [{ userid, player_name }]
   * @param {function} o.host     () => ({ id, name }) or null before the room exists
   */
  function create({ decide, send, present, host }) {
    const intents = {};          // userid -> { intent, name, matrixId }
    let expectedGuest = null;    // Matrix id reserved for Player 2, or null = first come
    let roster = null;           // { host, hostName, guest, guestName, spectators: [names] }
    let lastJson = "";

    return {
      /** A joiner's hello (repeated every couple of seconds; cheap and idempotent). */
      hello(h) {
        if (!h || !h.userid) return;
        intents[h.userid] = { intent: h.intent, name: h.name, matrixId: h.matrixId || null };
      },
      /** Only this Matrix id may take Player 2 (null = anyone who asks). A mismatching current Player 2 is unseated. */
      setExpected(id) { expectedGuest = id || null; },
      getExpected() { return expectedGuest; },
      /** Recompute and broadcast when it changed (or `force`). Returns the roster or null before the room exists. */
      update(force) {
        const h = host();
        if (!h) return null;
        const decided = decide({ present: present(), intents, currentGuest: roster && roster.guest, expectedGuest });
        roster = Object.assign({ host: h.id, hostName: h.name }, decided);
        const json = JSON.stringify(roster);
        if (force || json !== lastJson) { lastJson = json; send({ roster }); }
        return roster;
      },
      /** Guest side: the host's roster as received. */
      setRemote(r) { roster = r || null; },
      get() { return roster; },
      /** Is this room member the one whose inputs count as Player 2? */
      isGuest(userid) { return !!(roster && roster.guest && roster.guest === userid); },
      intentOf(userid) { return intents[userid] || null; },
      reset() { for (const k of Object.keys(intents)) delete intents[k]; roster = null; lastJson = ""; }
    };
  }

  return { create };
});
