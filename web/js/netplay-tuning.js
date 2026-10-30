/* Latency and quality tuning for EmulatorJS netplay, applied from the outside.

   EmulatorJS's netplay client hard-codes a 30 fps canvas capture and a 30 fps
   encoder cap, and only sets the non-standard playoutDelayHint on the guest.
   Rather than fork it, this file (loaded before EmulatorJS) wraps the three
   browser APIs it goes through:

   - HTMLCanvasElement.captureStream(30)  -> captureStream(streamFps)
   - RTCRtpSender.setParameters()         -> video maxFramerate = streamFps,
                                             bitrate raised to match the fps
   - RTCPeerConnection 'track' event      -> receiver.jitterBufferTarget = 0

   It also keeps a registry of every RTCPeerConnection so the UI can read
   getStats() for ping, stream fps and route (direct vs TURN relay).

   Config (config.json / env, see server/serve.js):
     streamFps            target capture + encode fps (default 60)
     streamBitrateDirect  max video bitrate on a direct path, bps (default 4_000_000)
     streamBitrateRelay   max video bitrate through TURN, bps (default 1_500_000) */
window.TSL = window.TSL || {};

TSL.Tuning = (() => {
  const pcs = new Set();
  let installed = false;

  // EmulatorJS uses exactly these two values: 2.5 Mbps direct, 0.9 Mbps relay
  // (plus 1.8 Mbps before ICE settles). Anything else is left untouched.
  const EJS_RELAY_BITRATE = 900000;

  function cfg() {
    const c = TSL.config || {};
    return {
      fps: clamp(Number(c.streamFps) || 60, 15, 60),
      direct: Number(c.streamBitrateDirect) || 4000000,
      relay: Number(c.streamBitrateRelay) || 1500000
    };
  }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  function install() {
    if (installed) return;
    installed = true;

    // 1. Canvas capture rate. EmulatorJS calls captureStream(30) on the emulator canvas.
    const origCapture = HTMLCanvasElement.prototype.captureStream;
    if (origCapture) {
      HTMLCanvasElement.prototype.captureStream = function (fps) {
        if (typeof fps === "number" && fps > 0 && fps < cfg().fps) fps = cfg().fps;
        return origCapture.call(this, fps);
      };
    }

    // 2. Encoder parameters. Applies to every call EmulatorJS makes, including
    //    adjustVideoBitrate() after ICE picks a route.
    const Sender = window.RTCRtpSender;
    if (Sender && Sender.prototype.setParameters) {
      const origSet = Sender.prototype.setParameters;
      Sender.prototype.setParameters = function (params) {
        try {
          if (this.track && this.track.kind === "video" && params && params.encodings && params.encodings[0]) {
            const c = cfg(), enc = params.encodings[0];
            const relay = enc.maxBitrate === EJS_RELAY_BITRATE;
            enc.maxFramerate = c.fps;
            enc.maxBitrate = relay ? c.relay : c.direct;
            // Two temporal layers let a weak downlink fall back to half rate
            // instead of freezing; keep EmulatorJS's choice of L1T2.
            params.degradationPreference = "maintain-framerate";
          }
        } catch (_) { /* never break the call */ }
        return origSet.call(this, params);
      };
    }

    // 3. Registry + receiver jitter buffer.
    const Orig = window.RTCPeerConnection;
    if (Orig) {
      const Wrapped = function (...args) {
        const pc = new Orig(...args);
        pcs.add(pc);
        pc.addEventListener("track", (e) => {
          try { e.receiver.jitterBufferTarget = 0; } catch (_) {}   // standard (Chrome 124+, Firefox 120+)
          try { e.receiver.playoutDelayHint = 0; } catch (_) {}     // legacy Chromium name
        });
        pc.addEventListener("connectionstatechange", () => {
          if (pc.connectionState === "closed" || pc.connectionState === "failed") pcs.delete(pc);
        });
        return pc;
      };
      Wrapped.prototype = Orig.prototype;
      Object.setPrototypeOf(Wrapped, Orig);   // keeps static methods such as generateCertificate
      window.RTCPeerConnection = Wrapped;
    }
  }

  /** One sample of the best live peer connection, or null when there is none. */
  async function sample() {
    let best = null;
    for (const pc of pcs) {
      if (pc.connectionState !== "connected") continue;
      let stats;
      try { stats = await pc.getStats(); } catch (_) { continue; }
      const byId = new Map();
      stats.forEach((r) => byId.set(r.id, r));
      let pair = null, inbound = null, outbound = null;
      stats.forEach((r) => {
        if (r.type === "transport" && r.selectedCandidatePairId) pair = byId.get(r.selectedCandidatePairId) || pair;
        if (r.type === "candidate-pair" && r.nominated && r.state === "succeeded" && !pair) pair = r;
        if (r.type === "inbound-rtp" && r.kind === "video") inbound = r;
        if (r.type === "outbound-rtp" && r.kind === "video") outbound = r;
      });
      if (!pair) continue;
      const local = byId.get(pair.localCandidateId), remote = byId.get(pair.remoteCandidateId);
      const relay = (local && local.candidateType === "relay") || (remote && remote.candidateType === "relay");
      const rtp = inbound || outbound;
      const s = {
        rttMs: typeof pair.currentRoundTripTime === "number" ? Math.round(pair.currentRoundTripTime * 1000) : null,
        route: relay ? "relay" : "direct",
        streamFps: rtp && typeof rtp.framesPerSecond === "number" ? Math.round(rtp.framesPerSecond) : null,
        jitterMs: inbound && typeof inbound.jitter === "number" ? Math.round(inbound.jitter * 1000) : null,
        lossPct: inbound && inbound.packetsReceived ? Math.round(100 * (inbound.packetsLost || 0) / ((inbound.packetsLost || 0) + inbound.packetsReceived)) : null,
        direction: inbound ? "receiving" : "sending"
      };
      if (!best || (s.rttMs !== null && (best.rttMs === null || s.rttMs < best.rttMs))) best = s;
    }
    return best;
  }

  /** "good" | "ok" | "poor" from a round trip in ms (null = unknown). */
  function grade(rttMs) {
    if (rttMs === null || rttMs === undefined) return "unknown";
    if (rttMs <= 60) return "good";
    if (rttMs <= 120) return "ok";
    return "poor";
  }

  /** Round trip to the netplay server over HTTP, median of three. */
  async function serverPing(netplayUrl) {
    const url = String(netplayUrl).replace(/\/$/, "") + "/list?domain=ping&game_id=0";
    const times = [];
    for (let i = 0; i < 3; i++) {
      const t0 = performance.now();
      try { await fetch(url, { cache: "no-store" }); } catch (_) { return null; }
      times.push(performance.now() - t0);
    }
    times.sort((a, b) => a - b);
    return Math.round(times[1]);
  }

  return { install, sample, grade, serverPing, pcs, config: cfg };
})();

TSL.Tuning.install();
