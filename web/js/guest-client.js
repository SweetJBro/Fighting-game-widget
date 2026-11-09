/* ROM-free guest and spectator client.

   In EmulatorJS's host-streaming netplay only the host runs the game. The guest
   just answers the host's WebRTC offer, shows the host's video/audio and sends
   inputs back over the data channel the host opens. EmulatorJS's own guest path
   still boots a full emulator (ROM, 8 MB core) and then freezes it; this client
   speaks the same protocol without any of that, so people who join or watch need
   no ROM at all.

   Protocol (EmulatorJS netplay client + EmulatorJS-Netplay server):
     socket.io  "join-room" { extra:{domain,game_id,room_name,player_name,userid,sessionid}, password } -> ack(err, users)
                "users-updated" users          room roster (host is the first entry)
                "webrtc-signal" {sender, offer|candidate}  from the host
                emit "webrtc-signal" {target, answer|candidate|requestRenegotiate}
                "data-message" d               relayed to everyone else in the room ({tsl:...} is ours)
     WebRTC     host adds video+audio tracks and an "inputs" data channel;
                guest sends JSON {player, index, value} per input change. The host
                (netplay-bridge.js hostInputFilter) maps the sender to Player 2 or
                drops it (spectators). */
window.TSL = window.TSL || {};

TSL.GuestClient = (() => {
  let opts = null;
  let socket = null;
  let pc = null, dc = null, hostSocketId = null;
  let candidateQueue = [];
  let video = null, unmuteBtn = null;
  let me = null;               // our userid in the room
  let players = {};
  let roster = null;
  let timers = [];
  let started = false, connected = false, hostLeft = false;
  let reconnects = 0;          // renegotiations we asked the host for
  const pressed = new Map();   // index -> value currently held (any source)

  const report = (state, extra) => { if (opts && opts.onStatus) opts.onStatus(Object.assign({ state }, extra || {})); };
  const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now());

  function loadSocketIo() {
    if (window.io) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = TSL.config.ejsDataPath + "src/vendor/socket.io.min.js";
      s.onload = resolve;
      s.onerror = () => reject(new Error("Could not load the Socket.IO client from " + s.src));
      document.head.appendChild(s);
    });
  }

  // ---------- video ----------
  function mountVideo() {
    const host = document.getElementById("ejs");
    host.innerHTML = "";
    host.classList.add("guest-view");
    video = document.createElement("video");
    video.autoplay = true;
    video.playsInline = true;
    video.className = "guest-video";
    host.appendChild(video);
    unmuteBtn = document.createElement("button");
    unmuteBtn.className = "btn btn-primary guest-unmute hidden";
    unmuteBtn.textContent = "Click for sound";
    unmuteBtn.onclick = () => { video.muted = false; video.play().catch(() => {}); unmuteBtn.classList.add("hidden"); };
    host.appendChild(unmuteBtn);
  }
  function playVideo() {
    video.muted = false;
    video.play().catch(() => {
      // No user gesture in this tab yet (pop-out): start muted, offer sound.
      video.muted = true;
      video.play().catch(() => {});
      unmuteBtn.classList.remove("hidden");
    });
  }

  // ---------- WebRTC ----------
  function newPeer(sender) {
    if (pc) { try { pc.close(); } catch (_) {} }
    hostSocketId = sender;
    candidateQueue = [];
    pc = new RTCPeerConnection({ iceServers: TSL.config.iceServers || [], iceCandidatePoolSize: 4 });
    pc.onicecandidate = (e) => { if (e.candidate) socket.emit("webrtc-signal", { target: sender, candidate: e.candidate }); };
    pc.ontrack = (e) => {
      try { e.receiver.jitterBufferTarget = 0; } catch (_) {}
      const stream = (e.streams && e.streams[0]) || new MediaStream([e.track]);
      if (video.srcObject !== stream) { video.srcObject = stream; playVideo(); }
    };
    pc.ondatachannel = (e) => {
      dc = e.channel;
      dc.onmessage = (ev) => {
        let d; try { d = JSON.parse(ev.data); } catch (_) { return; }
        if (d && d.type === "host-left") { hostLeft = true; report("error", { message: "The host left the match. Press Leave to go back to the lobby." }); }
      };
      dc.onopen = () => { for (const [index, value] of pressed) sendInput(index, value); };
    };
    // Recovery: "failed" asks the host for a fresh offer at once; "disconnected"
    // (a route change, a laptop sleeping) gets 5 s to heal on its own first.
    let disconnectedTimer = null;
    pc.onconnectionstatechange = () => {
      const st = pc.connectionState;
      if (st === "connected") { connected = true; clearTimeout(disconnectedTimer); }
      if (st === "failed" && !hostLeft) socket.emit("webrtc-signal", { target: sender, requestRenegotiate: true, reason: "pc-failed" });
      if (st === "disconnected" && !hostLeft) {
        clearTimeout(disconnectedTimer);
        disconnectedTimer = setTimeout(() => {
          if (pc.connectionState === "disconnected" && started && !hostLeft) {
            reconnects++;
            socket.emit("webrtc-signal", { target: sender, requestRenegotiate: true, reason: "pc-disconnected" });
          }
        }, 5000);
      }
    };
    return pc;
  }

  async function onSignal(data) {
    const sender = data.sender;
    if (!sender) return;
    if (data.offer) {
      const p = newPeer(sender);
      await p.setRemoteDescription(new RTCSessionDescription(data.offer));
      for (const c of candidateQueue.splice(0)) p.addIceCandidate(new RTCIceCandidate(c)).catch(() => {});
      const ans = await p.createAnswer();
      await p.setLocalDescription(ans);
      socket.emit("webrtc-signal", { target: sender, answer: p.localDescription });
    } else if (data.candidate) {
      if (pc && pc.remoteDescription) pc.addIceCandidate(new RTCIceCandidate(data.candidate)).catch(() => {});
      else candidateQueue.push(data.candidate);
    }
  }

  // ---------- room ----------
  async function findRoom() {
    const deadline = Date.now() + 120000;
    const base = TSL.config.netplayUrl.replace(/\/$/, "");
    while (Date.now() < deadline && started) {
      try {
        const q = new URLSearchParams({ domain: location.host, game_id: String(opts.game.netplayId) });
        const rooms = await (await fetch(base + "/list?" + q, { cache: "no-store" })).json();
        for (const [sid, r] of Object.entries(rooms || {})) {
          if ((opts.sid && sid === opts.sid) || (!opts.sid && r.room_name === opts.code)) return { sid, room: r };
        }
      } catch (_) {}
      await new Promise((r) => setTimeout(r, 1500));
    }
    return null;
  }

  async function join() {
    report("searching");
    const found = await findRoom();
    if (!started) return;
    if (!found) { report("error", { message: "No open match called " + opts.code + ". Ask the host to start first." }); return; }
    if (found.room.current >= found.room.max) {
      report("error", { message: opts.role === "spectator" ? "No watch seats left in that match." : "That match is already full." });
      return;
    }
    me = uuid();
    const extra = { domain: location.host, game_id: opts.game.netplayId, room_name: found.room.room_name,
      player_name: opts.name, userid: me, sessionid: found.sid };
    socket.emit("join-room", { extra, password: "" }, (err, users) => {
      if (err) { report("error", { message: "Could not join: " + err }); return; }
      players = users || {};
      report("joining");
    });
  }

  function hello() {
    if (!socket || !socket.connected || !me) return;
    socket.emit("data-message", { tsl: { hello: { userid: me, intent: opts.role, name: opts.name, matrixId: opts.matrixId || null } } });
  }

  function status() {
    if (hostLeft || !me) return;
    const hostEntry = Object.values(players)[0];
    const hostName = (roster && roster.hostName) || (hostEntry && hostEntry.player_name) || "host";
    if (!roster) { report("joining"); return; }
    if (opts.role === "spectator" || (roster.guest && roster.guest !== me)) {
      report("watching", { host: hostName, guest: roster.guestName,
        bumped: opts.role === "guest" && !!roster.guest && roster.guest !== me });
    } else if (roster.guest === me) {
      report("connected", { opponent: hostName, spectators: (roster.spectators || []).length });
    } else {
      report("joining");
    }
  }

  // ---------- input ----------
  // EmulatorJS key names (game files use these) for KeyboardEvent.key values.
  const KEY_NAMES = { " ": "space", "Enter": "enter", "ArrowUp": "up arrow", "ArrowDown": "down arrow",
    "ArrowLeft": "left arrow", "ArrowRight": "right arrow", "Shift": "shift", "Control": "ctrl", "Tab": "tab",
    "Backspace": "backspace", "Escape": "escape" };
  // Standard Gamepad button index -> EmulatorJS pad label.
  const PAD_LABELS = ["BUTTON_1", "BUTTON_2", "BUTTON_3", "BUTTON_4", "LEFT_TOP_SHOULDER", "RIGHT_TOP_SHOULDER",
    "LEFT_BOTTOM_SHOULDER", "RIGHT_BOTTOM_SHOULDER", "SELECT", "START", "LEFT_STICK", "RIGHT_STICK",
    "DPAD_UP", "DPAD_DOWN", "DPAD_LEFT", "DPAD_RIGHT"];
  let keyMap = new Map(), padMap = new Map();
  const keySources = new Map(), padSources = new Map();
  // Left stick deflection that counts as a direction. Fightcade's FBNeo uses a
  // similar dead zone; 0.5 made quarter-circles drop on sticks with short throw.
  const STICK_THRESHOLD = 0.35;
  const padStore = TSL.PadLogic.store(localStorage);
  let polledIndexes = new Set();   // pads read on the previous poll
  let lastPickReason = "none", warnedNonStandard = false;

  function buildMaps() {
    keyMap = new Map(); padMap = new Map();
    for (const [idx, b] of Object.entries(opts.game.input)) {
      if (b.key) keyMap.set(String(b.key).toLowerCase(), Number(idx));
      if (b.pad) padMap.set(b.pad, Number(idx));
    }
  }
  function keyName(e) { return (KEY_NAMES[e.key] || (e.key.length === 1 ? e.key.toLowerCase() : e.key.toLowerCase())); }

  function sendInput(index, value) {
    if (opts.role === "spectator") return;
    if (dc && dc.readyState === "open") dc.send(JSON.stringify({ player: 1, index, value }));
  }
  // An input is held while any source (a key, a pad button, the stick) holds it.
  function setSource(map, src, index, value) {
    const key = src + ":" + index;
    if (value) map.set(key, value); else map.delete(key);
    let v = 0;
    for (const m of [keySources, padSources]) for (const [k, val] of m) if (k.endsWith(":" + index)) v = Math.max(v, val);
    if ((pressed.get(index) || 0) !== v) {
      if (v) pressed.set(index, v); else pressed.delete(index);
      sendInput(index, v);
    }
  }

  function onKey(e) {
    if (!started || e.repeat) return;
    const t = e.target;
    if (t && (t.tagName === "INPUT" || t.tagName === "SELECT" || t.tagName === "TEXTAREA")) return;
    const idx = keyMap.get(keyName(e));
    if (idx === undefined) return;
    e.preventDefault();
    setSource(keySources, "k" + keyName(e), idx, e.type === "keydown" ? 1 : 0);
  }

  /** Every source a pad contributed is released (a pad we stop reading must not leave a button held). */
  function releasePad(index) {
    for (const k of [...padSources.keys()]) {
      const [src, idx] = k.split(":");
      if (src.startsWith("p" + index + "b") || src.startsWith("p" + index + "a")) setSource(padSources, src, Number(idx), 0);
    }
  }
  const livePads = () => [...(navigator.getGamepads ? navigator.getGamepads() : [])].filter(Boolean);
  function pollPads() {
    const all = livePads();
    // Which pads to read: the preferred one if connected, else the standard-mapped
    // ones, else all (TSL.PadLogic.pickPads). Several pads are OR'd together.
    const pick = TSL.PadLogic.pickPads(all, padStore.preferred());
    lastPickReason = pick.reason;
    if (pick.reason === "standard" && pick.pads.length < all.length && !warnedNonStandard) {
      warnedNonStandard = true;
      console.warn("[guest] ignoring controller(s) without the standard mapping:", all.filter((g) => g.mapping !== "standard").map((g) => g.id).join("; "),
        "- choose it under Controls to force it");
    }
    const now = new Set(pick.pads.map((gp) => gp.index));
    for (const i of polledIndexes) if (!now.has(i)) releasePad(i);
    polledIndexes = now;
    for (const gp of pick.pads) {
      gp.buttons.forEach((b, i) => {
        const idx = padMap.get(PAD_LABELS[i]);
        if (idx !== undefined) setSource(padSources, "p" + gp.index + "b" + i, idx, b.pressed ? 1 : 0);
      });
      // Left stick -> RetroPad analog (16 +X, 17 -X, 18 +Y, 19 -Y), as EmulatorJS sends it.
      const ax = gp.axes[0] || 0, ay = gp.axes[1] || 0, t = STICK_THRESHOLD;
      setSource(padSources, "p" + gp.index + "ax", 16, ax > t ? 0x7fff : 0);
      setSource(padSources, "p" + gp.index + "ax", 17, ax < -t ? 0x7fff : 0);
      setSource(padSources, "p" + gp.index + "ay", 18, ay > t ? 0x7fff : 0);
      setSource(padSources, "p" + gp.index + "ay", 19, ay < -t ? 0x7fff : 0);
    }
  }

  // ---------- stats ----------
  async function stats() {
    if (!opts.onStats) return;
    const link = await TSL.Tuning.sample();
    const failed = TSL.Tuning.failures() > 0 && TSL.Tuning.connectedCount() === 0;
    opts.onStats({ role: opts.role, emuFps: null, slow: false, hidden: document.hidden, threads: false,
      inputDelay: null, link, quality: TSL.Tuning.grade(link && link.rttMs), linkFailed: failed,
      usingTurn: (TSL.config.iceServers || []).some((s) => [].concat(s.urls || []).some((u) => /^turns?:/i.test(u))) });
  }

  return {
    async start(o) {
      opts = o;
      started = true;
      buildMaps();
      mountVideo();
      report("loading");
      try { await loadSocketIo(); } catch (e) { report("error", { message: e.message }); return; }
      socket = window.io(TSL.config.netplayUrl);
      socket.on("connect_error", (e) => report("error", { message: "Netplay server: " + e.message }));
      socket.on("users-updated", (u) => { players = u || {}; status(); });
      socket.on("webrtc-signal", (d) => { onSignal(d).catch(() => {}); });
      socket.on("data-message", (d) => {
        if (!d || !d.tsl) return;
        if (d.tsl.roster) { roster = d.tsl.roster; status(); }
        if (d.tsl.rematch === "done" && opts.onRematchDone) opts.onRematchDone(d.tsl.how);
      });
      socket.on("disconnect", () => { if (started && !hostLeft) report("error", { message: "Lost the connection to the netplay server." }); });
      socket.on("connect", join);
      window.addEventListener("keydown", onKey);
      window.addEventListener("keyup", onKey);
      timers.push(setInterval(pollPads, 8), setInterval(hello, 2000), setInterval(status, 1000), setInterval(stats, 1000));
    },
    leave() {
      started = false;
      timers.forEach(clearInterval); timers = [];
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKey);
      try { if (socket) { socket.emit("leave-room"); socket.disconnect(); } } catch (_) {}
      try { if (pc) pc.close(); } catch (_) {}
    },
    requestRematch() { if (socket) socket.emit("data-message", { tsl: { rematch: "request", name: opts && opts.name } }); },
    getRoster() { return roster; },
    isConnected() { return started && connected; },
    isStarted() { return started; },
    /** Live controllers: player 0 = read and sent as Player 2, -1 = ignored (not preferred, or non-standard mapping). */
    pads() {
      const preferred = padStore.preferred();
      const L = TSL.PadLogic;
      return livePads().map((gp) => ({
        index: gp.index, id: gp.id, mapping: gp.mapping,
        player: opts && opts.role !== "spectator" && polledIndexes.has(gp.index) ? 0 : -1,
        standard: gp.mapping === "standard",
        preferred: !!preferred && L.sameId(gp.id, preferred),
        active: L.isActive(gp)
      }));
    },
    setPreferredPad(id) { padStore.setPreferred(id || null); },
    resetControllerSettings() { return padStore.reset(); },
    /** For tests: why these pads are being read ("preferred" | "standard" | "all" | "none"). */
    pickReason() { return lastPickReason; },
    /** For tests: inputs currently held. */
    held() { return Object.fromEntries(pressed); },
    /** Everything useful in a bug report (no credentials). */
    debugInfo() {
      return {
        role: opts && opts.role, game: opts && opts.game.id, code: opts && opts.code, me,
        socket: !!(socket && socket.connected), pc: pc ? pc.connectionState : null, dc: dc ? dc.readyState : null,
        reconnects, hostLeft, roster, players: Object.values(players).map((q) => q.player_name),
        held: Object.fromEntries(pressed), pickReason: lastPickReason,
        pads: this.pads ? this.pads() : []
      };
    }
  };
})();
