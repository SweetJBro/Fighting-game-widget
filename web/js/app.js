/* UI controller: ROM screen -> lobby (Matrix widget / standalone / direct link) -> match. */
(async function main() {
  const $ = (id) => document.getElementById(id);
  const params = new URLSearchParams(location.search);
  const cfg = await TSL.loadConfig();

  const state = {
    mode: "standalone",      // "matrix" | "standalone" | "direct"
    rom: null,
    name: localStorage.getItem("tsl.name") || "",
    matrix: null,
    myId: null,
    hostingCode: null,
    challengeId: null,
    pollTimer: null,
    seenChallenges: new Map()
  };

  /* ---------- helpers ---------- */
  const CHARS = ["RYU", "KEN", "CHUN", "YUN", "YANG", "MAKOTO", "DUDLEY", "URIEN", "AKUMA", "ORO", "IBUKI", "ELENA", "ALEX", "REMY", "NECRO", "HUGO", "SEAN", "TWELVE", "GILL"];
  function makeCode() {
    const abc = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
    let s = "";
    const r = crypto.getRandomValues(new Uint8Array(4));
    for (const b of r) s += abc[b % abc.length];
    return CHARS[Math.floor(Math.random() * CHARS.length)] + "-" + s;
  }
  function toast(msg, isErr) {
    const t = $("toast"); t.textContent = msg; t.classList.toggle("err", !!isErr); t.classList.remove("hidden");
    clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.add("hidden"), 4000);
  }
  function show(screen) {
    ["screen-rom", "screen-lobby", "screen-match"].forEach((id) => $(id).classList.toggle("hidden", id !== screen));
  }
  function myName() {
    const v = ($("player-name").value || state.name || "").trim();
    return v || "Player";
  }
  function shareLink(code) {
    const u = new URL(cfg.publicUrl, location.href);
    u.searchParams.set("match", code);
    u.searchParams.set("role", "guest");
    return u.toString();
  }
  function cleanUrl() {
    const u = new URL(location.href);
    ["match", "role", "sid"].forEach((k) => u.searchParams.delete(k));
    return u.toString();
  }

  /* ---------- ROM screen ---------- */
  async function refreshRom() {
    state.rom = await TSL.RomStore.get();
    const badge = $("rom-badge");
    // A ROM the player stored in this browser wins; otherwise fall back to a
    // ROM the server packages for personal use (config.json: packagedRom).
    if (!state.rom && cfg.packagedRom && cfg.packagedRom.url) {
      state.rom = { name: cfg.packagedRom.name, size: cfg.packagedRom.size || 0, url: cfg.packagedRom.url, packaged: true };
    }
    const packagedOnly = !!(state.rom && state.rom.packaged);
    $("rom-heading").textContent = packagedOnly ? "Ready to play" : "Bring your own ROM";
    $("rom-intro").classList.toggle("hidden", packagedOnly);
    $("rom-intro-packaged").classList.toggle("hidden", !packagedOnly);
    $("btn-rom-clear").classList.toggle("hidden", !(state.rom && !state.rom.packaged));
    if (state.rom) {
      badge.textContent = (state.rom.packaged ? "packaged · " : "") + state.rom.name;
      badge.classList.remove("badge-muted"); badge.classList.add("badge-ok");
      $("rom-drop-status").textContent = (state.rom.packaged ? "Packaged on this server: " : "Stored: ") + state.rom.name + " (" + (state.rom.size / 1048576).toFixed(1) + " MB)";
      $("rom-drop-status").className = "dropzone-status ok";
      $("btn-rom-continue").disabled = false;
    } else {
      badge.textContent = "no ROM"; badge.classList.add("badge-muted"); badge.classList.remove("badge-ok");
      $("btn-rom-continue").disabled = true;
    }
  }
  async function takeRomFile(file) {
    if (!file) return;
    try {
      const name = await TSL.RomStore.put(file);
      toast("Stored " + name + " in this browser.");
      await refreshRom();
    } catch (e) {
      $("rom-drop-status").textContent = e.message; $("rom-drop-status").className = "dropzone-status err";
    }
  }
  $("rom-file").addEventListener("change", (e) => takeRomFile(e.target.files[0]));
  const dz = $("rom-drop");
  ["dragenter", "dragover"].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add("drag"); }));
  ["dragleave", "drop"].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove("drag"); }));
  dz.addEventListener("drop", (e) => takeRomFile(e.dataTransfer.files[0]));
  $("btn-rom-clear").addEventListener("click", async () => { await TSL.RomStore.clear(); await refreshRom(); });
  $("btn-rom-continue").addEventListener("click", () => enterLobby());
  $("btn-rom-settings").addEventListener("click", () => { if (!TSL.Netplay.isConnected()) show("screen-rom"); });

  /* ---------- Lobby ---------- */
  $("player-name").value = state.name;
  $("player-name").addEventListener("change", () => { state.name = myName(); localStorage.setItem("tsl.name", state.name); });

  async function enterLobby() {
    if (!state.rom) { show("screen-rom"); return; }
    show("screen-lobby");
    if (state.mode === "direct") return startDirect();
    if (state.mode === "matrix") return matrixLobby();
    return standaloneLobby();
  }

  // Standalone: the netplay server's room list is the lobby.
  function standaloneLobby() {
    $("lobby-title").textContent = "Open lobby";
    $("lobby-subtitle").textContent = "Host a match and share the link, or join someone who is waiting.";
    $("btn-host").onclick = () => {
      const code = makeCode();
      startMatch({ code, role: "host" });
    };
    $("btn-join").onclick = () => {
      const code = $("join-code").value.trim().toUpperCase();
      if (!code) return toast("Enter a match code first.", true);
      startMatch({ code, role: "guest" });
    };
    pollOpenRooms();
  }

  async function pollOpenRooms() {
    clearInterval(state.pollTimer);
    const tick = async () => {
      let rooms = {};
      try {
        const q = new URLSearchParams({ domain: location.host, game_id: String(cfg.gameId) });
        const r = await fetch(cfg.netplayUrl.replace(/\/$/, "") + "/list?" + q, { cache: "no-store" });
        rooms = await r.json();
      } catch (_) { rooms = null; }
      renderRooms(rooms);
    };
    await tick();
    state.pollTimer = setInterval(tick, 3000);
  }

  function renderRooms(rooms) {
    const ul = $("match-list"); ul.innerHTML = "";
    if (rooms === null) { $("list-empty").textContent = "Netplay server unreachable at " + cfg.netplayUrl; $("list-empty").classList.remove("hidden"); return; }
    const entries = Object.entries(rooms || {});
    $("list-empty").textContent = "Nobody is waiting right now.";
    $("list-empty").classList.toggle("hidden", entries.length > 0);
    for (const [sid, r] of entries) {
      const li = document.createElement("li");
      const left = document.createElement("div");
      left.innerHTML = '<div class="who"></div><div class="meta"></div>';
      left.querySelector(".who").textContent = r.player_name || "Unknown";
      left.querySelector(".meta").textContent = r.room_name + " · " + r.current + "/" + r.max;
      const btn = document.createElement("button");
      btn.className = "btn btn-sm";
      btn.textContent = r.current >= r.max ? "Full" : "Join";
      btn.disabled = r.current >= r.max;
      btn.onclick = () => startMatch({ code: r.room_name, sid, role: "guest" });
      li.append(left, btn); ul.appendChild(li);
    }
  }

  // Direct link (from the Fluxer bot or a shared link): ?match=CODE&role=host|guest
  function startDirect() {
    const code = params.get("match").toUpperCase();
    const role = params.get("role") === "host" ? "host" : "guest";
    $("lobby-title").textContent = "Match " + code;
    $("lobby-subtitle").textContent = role === "host" ? "You will host this match. Pick a name and hit Fight." : "You will join this match as Player 2. Pick a name and hit Fight.";
    $("join-row").classList.add("hidden");
    $("list-title").parentElement.classList.add("hidden");
    $("btn-host").textContent = "Fight";
    $("btn-host").onclick = () => startMatch({ code, role, sid: params.get("sid") || undefined });
  }

  // Matrix widget: members + challenge events inside the room.
  async function matrixLobby() {
    $("lobby-title").textContent = "Room lobby";
    $("lobby-subtitle").textContent = "Challenge someone in this room, or post an open challenge.";
    $("join-row").classList.add("hidden");
    $("btn-host").classList.add("hidden");
    $("btn-open-challenge").classList.remove("hidden");
    $("members-card").classList.remove("hidden");
    $("list-title").textContent = "Challenges";
    $("list-empty").textContent = "No open challenges.";
    // Inside a Matrix room the Matrix display name wins over a locally stored one.
    if (state.matrix.displayName) { $("player-name").value = state.matrix.displayName; state.name = state.matrix.displayName; }
    state.myId = state.matrix.userId || ("name:" + myName());

    $("btn-open-challenge").onclick = () => sendChallenge(null);

    const members = await state.matrix.members();
    const ul = $("member-list"); ul.innerHTML = "";
    for (const m of members) {
      if (m.id === state.myId) continue;
      const li = document.createElement("li");
      const who = document.createElement("span"); who.className = "who"; who.textContent = m.name;
      const btn = document.createElement("button"); btn.className = "btn btn-sm"; btn.textContent = "Challenge";
      btn.onclick = () => sendChallenge(m.id);
      li.append(who, btn); ul.appendChild(li);
    }
    if (!members.length) { const li = document.createElement("li"); li.className = "meta"; li.textContent = "Member list unavailable (capability denied?)"; ul.appendChild(li); }

    const recent = await state.matrix.recent();
    recent.sort((a, b) => a.ts - b.ts).forEach((e) => ingest(e.content, e.sender, e.ts));
    state.matrix.onEvent(ingest);
    renderChallenges();
  }

  function ingest(c, sender, ts) {
    if (!c || !c.kind) return;
    if (c.kind === "challenge" && c.id && c.code) {
      state.seenChallenges.set(c.id, { id: c.id, code: c.code, from: c.from || { id: sender, name: sender }, to: c.to || null, ts, sender, taken: false });
    } else if (c.kind === "accept" && c.id) {
      const ch = state.seenChallenges.get(c.id);
      if (ch) ch.taken = true;
      if (ch && state.challengeId === c.id && c.by) $("match-opponent").textContent = "vs " + c.by.name;
    } else if (c.kind === "cancel" && c.id) {
      state.seenChallenges.delete(c.id);
    }
    renderChallenges();
  }

  function renderChallenges() {
    if (state.mode !== "matrix") return;
    const ul = $("match-list"); ul.innerHTML = "";
    const cutoff = Date.now() - 20 * 60 * 1000;
    const list = [...state.seenChallenges.values()].filter((c) => !c.taken && c.ts >= cutoff && (c.to === null || c.to === state.myId || c.from.id === state.myId));
    $("list-empty").classList.toggle("hidden", list.length > 0);
    for (const c of list.sort((a, b) => b.ts - a.ts)) {
      const li = document.createElement("li");
      const left = document.createElement("div");
      left.innerHTML = '<div class="who"></div><div class="meta"></div>';
      left.querySelector(".who").textContent = c.from.name + (c.to ? " → you" : " (open)");
      left.querySelector(".meta").textContent = c.code;
      const btn = document.createElement("button"); btn.className = "btn btn-sm";
      if (c.from.id === state.myId) { btn.textContent = "Cancel"; btn.onclick = () => { state.matrix.send({ kind: "cancel", id: c.id }); state.seenChallenges.delete(c.id); renderChallenges(); }; }
      else { btn.textContent = "Accept"; btn.className = "btn btn-primary btn-sm"; btn.onclick = () => acceptChallenge(c); }
      li.append(left, btn); ul.appendChild(li);
    }
  }

  async function sendChallenge(toId) {
    const code = makeCode();
    const id = crypto.randomUUID();
    try {
      await state.matrix.send({ kind: "challenge", id, code, from: { id: state.myId, name: myName() }, to: toId });
    } catch (e) { return toast("Could not post challenge: " + (e.message || e), true); }
    state.challengeId = id;
    startMatch({ code, role: "host" });
  }

  async function acceptChallenge(c) {
    try { await state.matrix.send({ kind: "accept", id: c.id, code: c.code, by: { id: state.myId, name: myName() } }); } catch (_) {}
    state.challengeId = c.id;
    $("match-opponent").textContent = "vs " + c.from.name;
    startMatch({ code: c.code, role: "guest" });
  }

  /* ---------- Match ---------- */
  function startMatch({ code, role, sid }) {
    state.name = myName(); localStorage.setItem("tsl.name", state.name);
    clearInterval(state.pollTimer);
    show("screen-match");
    $("match-role").textContent = role === "host" ? "P1 · host" : "P2 · guest";
    $("match-code").textContent = code;
    if (role === "host") {
      state.hostingCode = code;
      $("hosting-code").textContent = code; $("hosting-link").value = shareLink(code);
    }
    setStatus("loading emulator…");
    TSL.Netplay.start({
      rom: state.rom, code, role, sid, name: state.name,
      onStatus: (s) => {
        if (s.state === "loading") setStatus("loading emulator…");
        else if (s.state === "hosting") setStatus("opening room…");
        else if (s.state === "waiting") setStatus(state.mode === "matrix" ? "waiting for your opponent to accept…" : "waiting for opponent · share " + shareLink(code));
        else if (s.state === "searching" || s.state === "joining") setStatus("looking for the host…");
        else if (s.state === "connected") { setStatus("connected", "ok"); if (s.opponent) $("match-opponent").textContent = "vs " + s.opponent; }
        else if (s.state === "error") { setStatus(s.message, "err"); toast(s.message, true); }
      }
    });
  }
  function setStatus(text, cls) { const el = $("match-status"); el.textContent = text; el.className = "status" + (cls ? " " + cls : ""); }

  $("btn-leave").addEventListener("click", () => {
    TSL.Netplay.leave();
    if (state.mode === "matrix" && state.challengeId) { try { state.matrix.send({ kind: "cancel", id: state.challengeId }); } catch (_) {} }
    location.href = cleanUrl();   // EmulatorJS cannot be torn down cleanly; reload to the lobby
  });
  $("btn-controls").addEventListener("click", () => $("controls-help").classList.toggle("hidden"));
  $("btn-copy-link").addEventListener("click", () => { navigator.clipboard.writeText($("hosting-link").value).then(() => toast("Link copied")); });

  /* ---------- Boot ---------- */
  if (TSL.MatrixLobby.looksLikeWidget(params)) {
    state.mode = "matrix";
    $("mode-badge").textContent = "matrix widget";
    try {
      state.matrix = await new TSL.MatrixLobby(params).init();
    } catch (e) {
      toast("Matrix widget handshake failed, falling back to standalone lobby: " + e.message, true);
      state.mode = "standalone"; $("mode-badge").textContent = "standalone";
    }
  } else if (params.get("match")) {
    state.mode = "direct";
    $("mode-badge").textContent = "match link";
  }
  if (params.get("name") && !state.name) { state.name = params.get("name"); $("player-name").value = state.name; }

  await refreshRom();
  if (state.rom) enterLobby(); else show("screen-rom");
})();
