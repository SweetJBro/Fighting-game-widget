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

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  /** What the guest feels: one round trip plus a video frame each way (encode on the host, decode on the guest). */
  function guestLagMs(rttMs, fps = 60) {
    if (rttMs === null || rttMs === undefined) return null;
    return Math.round(rttMs + 2 * 1000 / fps);
  }
  /** What the host feels with a delay of `frames`. */
  function hostLagMs(frames, fps = 60) { return Math.round(frames * 1000 / fps); }
  /**
   * Suggested host delay for a round trip: half of the guest's lag, in frames,
   * capped at 0-8. Meeting in the middle halves the gap between the two sides
   * without making the host's own inputs feel as heavy as the guest's.
   */
  function recommendedDelay(rttMs, fps = 60) {
    const guest = guestLagMs(rttMs, fps);
    if (guest === null) return null;
    return clamp(Math.round(guest / 2 / (1000 / fps)), 0, 8);
  }

  /**
   * Opt-in automatic host delay. Conservative on purpose:
   *   - every raw sample must disagree with the current delay for `holdSamples`
   *     samples in a row, so one bad ping changes nothing
   *   - the direction comes from the smoothed round trip (EMA), not the last sample
   *   - the delay then moves one frame, at most once per `minIntervalMs`
   * It can go down as well as up; the DelayQueue keeps press order either way.
   */
  class AutoDelay {
    constructor({ fps = 60, alpha = 0.3, holdSamples = 3, minIntervalMs = 5000 } = {}) {
      Object.assign(this, { fps, alpha, holdSamples, minIntervalMs });
      this.ema = null; this.hold = 0; this.lastChange = -Infinity; this.target = null;
    }
    /** One RTT sample. Returns the new delay to apply, or null to leave it. */
    sample(rttMs, nowMs, current) {
      if (rttMs === null || rttMs === undefined) { this.hold = 0; return null; }
      this.ema = this.ema === null ? rttMs : this.ema + this.alpha * (rttMs - this.ema);
      this.target = recommendedDelay(this.ema, this.fps);
      const raw = recommendedDelay(rttMs, this.fps);
      if (raw === current || this.target === current) { this.hold = 0; return null; }
      this.hold++;
      if (this.hold < this.holdSamples || nowMs - this.lastChange < this.minIntervalMs) return null;
      this.hold = 0; this.lastChange = nowMs;
      return current + (this.target > current ? 1 : -1);
    }
  }

  /**
   * Encoder caps for spectator connections (Player 2 keeps the full stream).
   *   full     no extra cap: cfg.direct / cfg.fps like the opponent
   *   reduced  about a third of the upload per watcher
   *   minimal  a fifth; fine for following a set, not for frame-counting
   * cfg: { direct, fps } from TSL.Tuning.config(). Returns null for "full".
   */
  function spectatorCaps(tier, cfg) {
    const direct = (cfg && cfg.direct) || 4000000, fps = (cfg && cfg.fps) || 60;
    if (tier === "reduced") return { maxBitrate: Math.min(1500000, direct), maxFramerate: Math.min(30, fps) };
    if (tier === "minimal") return { maxBitrate: Math.min(600000, direct), maxFramerate: Math.min(20, fps) };
    return null;
  }
  /** Host upload with the current viewers, in Mbps: the opponent at full rate plus each watcher at its tier. */
  function uploadEstimateMbps({ opponent, spectators, tier, cfg }) {
    const direct = (cfg && cfg.direct) || 4000000;
    const caps = spectatorCaps(tier, cfg);
    const per = caps ? caps.maxBitrate : direct;
    return ((opponent ? direct : 0) + spectators * per) / 1e6;
  }

  return { decideRoster, DelayQueue, guestLagMs, hostLagMs, recommendedDelay, AutoDelay, spectatorCaps, uploadEstimateMbps };
});
