/* Host input delay. The host feels no network lag and the guest a full round
   trip plus encode/decode, so the host's OWN presses are held N core frames
   (0-8, default 3) to even that out. It makes matches fairer; it does not make
   the guest's side faster, and nothing can in a streaming design.

   Mechanics: simulate_input is wrapped (every input, local and remote, passes
   through it); Player 1 presses on the host go into a DelayQueue (match-logic.js)
   stamped with the core's frame counter and are released by a per-animation-frame
   tick. Guest presses (player 1 in RetroPad terms) pass straight through. */
window.TSL = window.TSL || {};

TSL.InputDelay = (() => {
  const KEY = "tsl.inputDelay";
  const clamp = (d) => Math.max(0, Math.min(8, Math.round(Number(d) || 0)));

  /**
   * @param {object} o
   * @param {object}   o.adapter     TSL.Ejs
   * @param {function} o.isHosting   true while this page's Player 1 presses should be delayed
   * @param {function} [o.onCoin]    called on any coin press (RetroPad SELECT), before it is applied
   * @param {function} [o.fallback]  default delay when none is stored (config, then the game file)
   */
  function create({ adapter, isHosting, onCoin, fallback }) {
    const queue = new TSL.MatchLogic.DelayQueue();
    let delay = read();
    let raw = null, frame = 0, raf = 0;

    function read() {
      let v = null;
      try { v = localStorage.getItem(KEY); } catch (_) {}
      const d = v === null ? Number(fallback ? fallback() : 3) : Number(v);
      return Number.isFinite(d) ? clamp(d) : 3;
    }

    return {
      get() { return delay; },
      /** Stores and returns the clamped value. Safe mid-match: the queue never reorders. */
      set(d) { delay = clamp(d); try { localStorage.setItem(KEY, String(delay)); } catch (_) {} return delay; },
      /** Re-read the stored value (config and game file are loaded by then). */
      reload() { delay = read(); return delay; },
      /** Wrap the core once it is running. Returns false when the core is not there yet. */
      install() {
        if (raw) return true;
        raw = adapter.wrapSimulateInput((player, index, value) => {
          const hosting = isHosting();
          if (index === 2 && value && onCoin) onCoin();
          if (hosting && player === 0 && delay > 0) {
            frame = adapter.getFrameNum();
            queue.push(frame, delay, { player, index, value });
            return;
          }
          raw(player, index, value);
        });
        if (!raw) return false;
        // Module.postMainLoop never fires in this EmulatorJS build, so poll the
        // core's frame counter every animation frame; the emulator is rAF-driven
        // too, so a due press lands within its frame, give or take one.
        const tick = () => {
          frame = adapter.getFrameNum();
          for (const q of queue.due(frame)) raw(q.player, q.index, q.value);
          raf = requestAnimationFrame(tick);
        };
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(tick);
        return true;
      },
      clear() { queue.clear(); },
      stop() { cancelAnimationFrame(raf); },
      /** For tests and the console: current frame and queued (delayed) presses. */
      debug() { return { frame, delay, queued: queue.items.map((q) => ({ at: q.at, index: q.index, value: q.value })) }; }
    };
  }

  return { create, clamp, KEY };
})();
