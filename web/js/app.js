/* UI controller: ROM screen -> lobby (Matrix widget / standalone / direct link) -> match.
   Everything game specific comes from TSL.Games (web/games/<id>.json). */
(async function main() {
  const $ = (id) => document.getElementById(id);
  const params = new URLSearchParams(location.search);
  const cfg = await TSL.loadConfig();
  await TSL.Games.load();

  const state = {
    mode: "standalone",      // "matrix" | "standalone" | "direct"
    game: null,              // current TSL.Games entry
    rom: null,               // { file | url, name, size, packaged? } for state.game
    bios: null,              // same, for games that need one (Neo Geo)
    pending: null,           // match to start once the needed ROM is present
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
  function shareLink(code, role) {
    const u = new URL(cfg.publicUrl, location.href);
    u.searchParams.set("match", code);
    u.searchParams.set("role", role || "guest");
    u.searchParams.set("game", state.game.id);
    return u.toString();
  }
  function cleanUrl() {
    const u = new URL(location.href);
    ["match", "role", "sid", "autostart", "isolate"].forEach((k) => u.searchParams.delete(k));
    if (state.game) u.searchParams.set("game", state.game.id);
    return u.toString();
  }

  /* ---------- Pop-out ----------
     A top-level tab the player keeps in front, outside the chat client. It is
     also cross-origin isolated (?isolate=1), which lets EmulatorJS load its
     threaded core; on CPS-3 that measured within noise of the plain core, so
     the isolation is a bonus, not the reason to pop out. */
  const inIframe = window.top !== window;
  const isolatedTab = !!window.crossOriginIsolated || params.get("isolate") === "1";
  const POPOUT_KEY = "tsl.popout";
  function popoutPref() {
    if (isolatedTab) return false;
    let v = null;
    try { v = localStorage.getItem(POPOUT_KEY); } catch (_) {}
    return v === null ? inIframe : v === "1";   // default on inside a chat iframe
  }
  function popoutUrl({ code, role, sid }) {
    const u = new URL(cfg.publicUrl, location.href);
    u.search = "";
    u.searchParams.set("match", code);
    u.searchParams.set("role", role);
    if (sid) u.searchParams.set("sid", sid);
    u.searchParams.set("name", myName());
    u.searchParams.set("game", state.game.id);
    u.searchParams.set("autostart", "1");
    u.searchParams.set("isolate", "1");
    return u.toString();
  }
  /** Opens the match in its own tab. Returns false when the browser blocked the popup. */
  function openPopout(m) {
    const w = window.open(popoutUrl(m), "_blank");
    if (!w) { toast("Your browser blocked the new tab, so the match runs here instead.", true); return false; }
    const n = $("popout-notice");
    n.textContent = "Match " + m.code + " is running in another tab. Close that tab to end it.";
    n.classList.remove("hidden");
    return true;
  }
  $("popout-pref").checked = popoutPref();
  $("popout-pref").addEventListener("change", (e) => { try { localStorage.setItem(POPOUT_KEY, e.target.checked ? "1" : "0"); } catch (_) {} });
  if (isolatedTab) $("popout-row").classList.add("hidden");

  /* ---------- Ping to the netplay server ---------- */
  state.serverPing = null;
  async function refreshPing() {
    const ms = await TSL.Tuning.serverPing(cfg.netplayUrl);
    state.serverPing = ms;
    const b = $("ping-badge");
    b.classList.remove("badge-muted", "q-good", "q-ok", "q-poor");
    if (ms === null) { b.textContent = "server offline"; b.classList.add("q-poor"); return; }
    b.textContent = "server " + ms + " ms";
    b.classList.add("q-" + TSL.Tuning.grade(ms));
    if (state.mode === "matrix") renderChallenges();
  }
  refreshPing();
  setInterval(refreshPing, 15000);

  /* ---------- Game picker ---------- */
  const GAME_KEY = "tsl.game";
  const sel = $("game-select");
  for (const g of TSL.Games.all()) {
    const o = document.createElement("option");
    o.value = g.id; o.textContent = g.name; sel.appendChild(o);
  }
  function initialGame() {
    let stored = null;
    try { stored = localStorage.getItem(GAME_KEY); } catch (_) {}
    return TSL.Games.find(params.get("game")) || TSL.Games.get(stored) || TSL.Games.get(TSL.Games.defaultId());
  }
  /** Switch the selected game; returns true when its ROM (and BIOS) are ready. */
  async function setGame(game) {
    state.game = game;
    sel.value = game.id;
    try { localStorage.setItem(GAME_KEY, game.id); } catch (_) {}
    renderControlsHelp();
    return refreshRom();
  }
  sel.addEventListener("change", async () => {
    const g = TSL.Games.get(sel.value);
    if (!g || TSL.Netplay.isConnected()) { sel.value = state.game.id; return; }
    if (await setGame(g)) enterLobby(); else show("screen-rom");
  });
  function renderControlsHelp() {
    const tb = $("controls-buttons"); tb.innerHTML = "";
    const items = TSL.Games.controlsHelp(state.game);
    for (let i = 0; i < items.length; i += 2) {
      const tr = document.createElement("tr");
      for (const it of items.slice(i, i + 2)) {
        const th = document.createElement("th"); th.textContent = it.label;
        const td = document.createElement("td"); td.textContent = it.key.toUpperCase();
        tr.append(th, td);
      }
      tb.appendChild(tr);
    }
  }
  const gameReady = () => !!(state.rom && (!state.game.bios || state.bios));

  /* ---------- ROM screen ---------- */
  async function refreshRom() {
    const g = state.game;
    const packed = cfg.packaged || { roms: {}, bios: {} };
    // A ROM the player stored in this browser wins; otherwise fall back to one
    // the server packages for personal use (config.json: packaged).
    state.rom = await TSL.RomStore.get(g);
    if (!state.rom && packed.roms[g.id]) state.rom = Object.assign({ packaged: true }, packed.roms[g.id]);
    state.bios = null;
    if (g.bios) {
      state.bios = await TSL.RomStore.getBios(g);
      if (!state.bios && packed.bios[g.bios.id]) state.bios = Object.assign({ packaged: true }, packed.bios[g.bios.id]);
    }

    document.querySelectorAll(".rom-game-name").forEach((el) => { el.textContent = g.name; });
    $("rom-accepted").innerHTML = "";
    const acc = $("rom-accepted");
    acc.append("Needs ");
    const c1 = document.createElement("code"); c1.textContent = g.rom.file; acc.append(c1);
    if (g.rom.versionLabel) acc.append(" (" + g.rom.versionLabel + ")");
    if (g.bios) { acc.append(" and the " + (g.bios.label || "BIOS") + " "); const c2 = document.createElement("code"); c2.textContent = g.bios.file; acc.append(c2); }
    acc.append(". Every file is checked against FinalBurn Neo's list, so the zip must keep its set name and hold the full set.");
    $("rom-merge-hint").textContent = g.rom.parent
      ? "Fightcade keeps this game split across " + g.rom.file + " and its parent " + g.rom.parent + ".zip. Merge them once with: python3 scripts/romset.py merge " + g.id + " " + g.rom.file + " " + g.rom.parent + ".zip"
      : "";

    const packagedOnly = !!(state.rom && state.rom.packaged);
    $("rom-heading").textContent = gameReady() && packagedOnly ? "Ready to play" : "Bring your own ROM";
    $("rom-intro").classList.toggle("hidden", packagedOnly);
    $("rom-intro-packaged").classList.toggle("hidden", !packagedOnly);
    $("btn-rom-clear").classList.toggle("hidden", !(state.rom && !state.rom.packaged));

    const badge = $("rom-badge"), st = $("rom-drop-status"), bs = $("bios-status");
    if (state.rom) {
      st.textContent = (state.rom.packaged ? "Packaged on this server: " : "Stored: ") + state.rom.name + " (" + (state.rom.size / 1048576).toFixed(1) + " MB)";
      st.className = "dropzone-status ok";
    } else if (!st.classList.contains("err")) {
      st.textContent = "No " + g.rom.file + " yet."; st.className = "dropzone-status";
    }
    bs.classList.toggle("hidden", !g.bios);
    if (g.bios) {
      if (state.bios) { bs.textContent = (state.bios.packaged ? "Packaged BIOS: " : "Stored BIOS: ") + state.bios.name; bs.className = "dropzone-status ok"; }
      else if (!bs.classList.contains("err")) { bs.textContent = "No " + g.bios.file + " yet."; bs.className = "dropzone-status"; }
    }
    const ready = gameReady();
    badge.textContent = ready ? (state.rom.packaged ? "packaged · " : "") + g.short : "no ROM";
    badge.title = ready ? g.rom.file + (g.rom.versionLabel ? " · " + g.rom.versionLabel : "") : "";
    badge.classList.toggle("badge-muted", !ready); badge.classList.toggle("badge-ok", ready);
    $("btn-rom-continue").disabled = !ready;
    $("btn-rom-continue").textContent = state.pending ? "Continue to match" : "Continue";
    return ready;
  }
  async function takeRomFiles(files) {
    for (const file of files) {
      const st = $("rom-drop-status");
      try {
        const r = await TSL.RomStore.put(state.game, file);
        toast("Stored " + r.name + " in this browser.");
        (r.kind === "bios" ? $("bios-status") : st).classList.remove("err");
      } catch (e) {
        const target = state.game.bios && TSL.RomStore.canonicalName(file.name) === state.game.bios.file ? $("bios-status") : st;
        target.textContent = e.message; target.className = "dropzone-status err";
      }
    }
    await refreshRom();
  }
  $("rom-file").addEventListener("change", (e) => takeRomFiles([...e.target.files]));
  const dz = $("rom-drop");
  ["dragenter", "dragover"].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add("drag"); }));
  ["dragleave", "drop"].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove("drag"); }));
  dz.addEventListener("drop", (e) => takeRomFiles([...e.dataTransfer.files]));
  $("btn-rom-clear").addEventListener("click", async () => { await TSL.RomStore.clear(state.game); await refreshRom(); });
  $("btn-rom-continue").addEventListener("click", () => {
    if (state.pending) { const m = state.pending; state.pending = null; show("screen-lobby"); m(); return; }
    enterLobby();
  });
  $("btn-rom-settings").addEventListener("click", () => { if (!TSL.Netplay.isConnected()) show("screen-rom"); });

  /** Run `start` for game `g`, detouring through the ROM screen if its files are missing. */
  async function withGame(g, start) {
    if (!g) { toast("This match is for a game this lobby does not know.", true); return; }
    const ready = g.id === state.game.id ? gameReady() : await setGame(g);
    if (ready) { start(); return; }
    state.pending = start;
    await refreshRom();
    show("screen-rom");
    toast("You need " + g.name + " (" + g.rom.file + (g.bios ? " + " + g.bios.file : "") + ") for this match.", true);
  }

  /* ---------- Lobby ---------- */
  $("player-name").value = state.name;
  $("player-name").addEventListener("change", () => { state.name = myName(); localStorage.setItem("tsl.name", state.name); });

  async function enterLobby() {
    if (!gameReady()) { show("screen-rom"); return; }
    show("screen-lobby");
    if (state.mode === "direct") return startDirect();
    if (state.mode === "matrix") return matrixLobby();
    return standaloneLobby();
  }

  // Standalone: the netplay server's room list is the lobby.
  function standaloneLobby() {
    $("lobby-title").textContent = state.game.short + " lobby";
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
        const q = new URLSearchParams({ domain: location.host, game_id: String(state.game.netplayId) });
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
      // One seat is Player 2; the rest are spectator seats. The host decides who
      // actually gets P2, so a late "Join" quietly becomes a spectator.
      const open = r.current < 2, full = r.current >= r.max;
      btn.textContent = full ? "Full" : open ? "Join" : "Watch";
      btn.disabled = full;
      if (open) btn.className = "btn btn-primary btn-sm";
      btn.onclick = () => startMatch({ code: r.room_name, sid, role: open ? "guest" : "spectator" });
      li.append(left, btn); ul.appendChild(li);
    }
  }

  // Direct link (from the Fluxer bot or a shared link): ?match=CODE&role=host|guest
  function startDirect() {
    const code = params.get("match").toUpperCase();
    const role = ["host", "guest", "spectator"].includes(params.get("role")) ? params.get("role") : "guest";
    $("lobby-title").textContent = "Match " + code;
    $("lobby-subtitle").textContent = {
      host: "You will host this match. Pick a name and hit Fight.",
      guest: "You will join this match as Player 2. Pick a name and hit Fight.",
      spectator: "You will watch this match. Pick a name and hit Watch."
    }[role];
    $("join-row").classList.add("hidden");
    $("list-title").parentElement.classList.add("hidden");
    $("btn-host").textContent = role === "spectator" ? "Watch" : "Fight";
    $("btn-host").onclick = () => startMatch({ code, role, sid: params.get("sid") || undefined });
    // Pop-out tabs arrive with autostart=1: the click already happened in the opener.
    if (params.get("autostart") === "1") startMatch({ code, role, sid: params.get("sid") || undefined });
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
      // Events from before multi-game have no game field: they were 3rd Strike.
      state.seenChallenges.set(c.id, { id: c.id, code: c.code, game: c.game || "sfiii3nr1", from: c.from || { id: sender, name: sender }, to: c.to || null, ts, sender, taken: false });
    } else if (c.kind === "accept" && c.id) {
      const ch = state.seenChallenges.get(c.id);
      if (ch) { ch.taken = true; ch.by = c.by || { id: sender, name: sender }; ch.takenTs = ts; }
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
      addGameTag(left.querySelector(".who"), c.game);
      const their = c.from && typeof c.from.ping === "number" ? c.from.ping : null;
      const mine = state.serverPing;
      let meta = c.code;
      if (c.from.id !== state.myId && their !== null) {
        meta += mine !== null
          ? " · est. " + (their + mine) + " ms via server (" + TSL.Tuning.grade(their + mine) + ")"
          : " · their ping " + their + " ms";
      }
      left.querySelector(".meta").textContent = meta;
      const btn = document.createElement("button"); btn.className = "btn btn-sm";
      if (c.from.id === state.myId) { btn.textContent = "Cancel"; btn.onclick = () => { state.matrix.send({ kind: "cancel", id: c.id }); state.seenChallenges.delete(c.id); renderChallenges(); }; }
      else { btn.textContent = "Accept"; btn.className = "btn btn-primary btn-sm"; btn.onclick = () => acceptChallenge(c); }
      li.append(left, btn); ul.appendChild(li);
    }
    renderLive(cutoff);
  }

  function addGameTag(el, gameId) {
    const g = TSL.Games.get(gameId);
    const t = document.createElement("span"); t.className = "game-tag";
    t.textContent = g ? g.short : gameId;
    el.appendChild(t);
  }

  /** Accepted challenges between two other members: offer to watch. */
  function renderLive(cutoff) {
    const live = [...state.seenChallenges.values()].filter((c) =>
      c.taken && c.by && (c.takenTs || c.ts) >= cutoff && c.from.id !== state.myId && c.by.id !== state.myId);
    $("live-card").classList.toggle("hidden", live.length === 0);
    const ul = $("live-list"); ul.innerHTML = "";
    for (const c of live.sort((a, b) => (b.takenTs || b.ts) - (a.takenTs || a.ts))) {
      const li = document.createElement("li");
      const left = document.createElement("div");
      left.innerHTML = '<div class="who"></div><div class="meta"></div>';
      left.querySelector(".who").textContent = c.from.name + " vs " + c.by.name;
      addGameTag(left.querySelector(".who"), c.game);
      left.querySelector(".meta").textContent = c.code;
      const btn = document.createElement("button"); btn.className = "btn btn-sm"; btn.textContent = "Watch";
      btn.onclick = () => withGame(TSL.Games.get(c.game), () => startMatch({ code: c.code, role: "spectator" }));
      li.append(left, btn); ul.appendChild(li);
    }
  }

  async function sendChallenge(toId) {
    const code = makeCode();
    const id = crypto.randomUUID();
    try {
      await state.matrix.send({ kind: "challenge", id, code, game: state.game.id, from: { id: state.myId, name: myName(), ping: state.serverPing }, to: toId });
    } catch (e) { return toast("Could not post challenge: " + (e.message || e), true); }
    state.challengeId = id;
    startMatch({ code, role: "host" });
  }

  async function acceptChallenge(c) {
    // Check the ROM first: accepting and then failing to load would strand the challenger.
    await withGame(TSL.Games.get(c.game), async () => {
      try { await state.matrix.send({ kind: "accept", id: c.id, code: c.code, game: c.game, by: { id: state.myId, name: myName() } }); } catch (_) {}
      state.challengeId = c.id;
      $("match-opponent").textContent = "vs " + c.from.name;
      startMatch({ code: c.code, role: "guest" });
    });
  }

  /* ---------- Match ---------- */
  async function startMatch({ code, role, sid }) {
    state.name = myName(); localStorage.setItem("tsl.name", state.name);
    // Fail fast with a clear message instead of a silent socket.io retry loop.
    if (state.serverPing === null) await refreshPing();
    if (state.serverPing === null) {
      toast("Can't reach the netplay server at " + cfg.netplayUrl + ". Check that it is running and that NETPLAY_URL points at it.", true);
      return;
    }
    if (popoutPref() && openPopout({ code, role, sid })) return;
    clearInterval(state.pollTimer);
    state.current = { code, role, sid, game: state.game.id };
    sel.disabled = true;
    state.connected = false;
    $("btn-popout").classList.toggle("hidden", isolatedTab);
    $("delay-wrap").classList.toggle("hidden", role !== "host");
    $("input-delay").value = String(TSL.Netplay.getInputDelay());
    show("screen-match");
    $("match-role").textContent = { host: "P1 · host", guest: "P2 · guest", spectator: "watching" }[role];
    $("btn-rematch").classList.add("hidden");
    $("btn-watch-link").classList.toggle("hidden", role !== "host");
    $("match-code").textContent = code;
    if (role === "host") {
      state.hostingCode = code;
      $("hosting-code").textContent = code; $("hosting-link").value = shareLink(code);
    }
    setStatus("loading emulator…");
    TSL.Netplay.start({
      game: state.game, rom: state.rom, bios: state.bios, code, role, sid, name: state.name,
      onStatus: (s) => {
        if (s.state === "loading") setStatus("loading emulator…");
        else if (s.state === "hosting") setStatus("opening room…");
        else if (s.state === "waiting") setStatus(state.mode === "matrix" ? "waiting for your opponent to accept…" : "waiting for opponent · share " + shareLink(code));
        else if (s.state === "searching" || s.state === "joining") setStatus("looking for the host…");
        else if (s.state === "connected") {
          setStatus("connected" + (s.spectators ? " · " + s.spectators + " watching" : ""), "ok");
          if (s.opponent) $("match-opponent").textContent = "vs " + s.opponent;
          if (!state.connected) {
            state.connected = true;
            $("btn-popout").classList.add("hidden");
            $("btn-rematch").textContent = role === "host" ? "Rematch" : "Ask for rematch";
            $("btn-rematch").classList.remove("hidden");
          }
        }
        else if (s.state === "watching") {
          setStatus("watching " + (s.host || "host") + (s.guest ? " vs " + s.guest : " (waiting for an opponent)"), "ok");
          $("match-role").textContent = "watching";
          $("btn-popout").classList.add("hidden");
          if (s.bumped && !state.bumpedNotified) { state.bumpedNotified = true; toast("This match already has an opponent, so you are watching."); }
        }
        else if (s.state === "error") { setStatus(s.message, "err"); toast(s.message, true); }
      },
      onStats: renderStats,
      onRematchRequest: (who) => {
        $("rematch-ask-text").textContent = who + " wants a rematch. This restarts the game for everyone.";
        $("rematch-ask").classList.remove("hidden");
      },
      onRematchDone: () => toast("The host restarted the game. Insert coin and press Start.")
    });
  }

  function renderStats(s) {
    const el = $("net-stats"), parts = [];
    if (s.role === "host" && s.emuFps !== null) parts.push(s.emuFps + " fps");
    if (s.link) {
      if (s.link.rttMs !== null) parts.push("ping " + s.link.rttMs + " ms");
      if (s.link.streamFps !== null) parts.push("stream " + s.link.streamFps + " fps");
      parts.push(s.link.route);
      if (s.link.lossPct) parts.push(s.link.lossPct + "% loss");
    }
    if (s.threads) parts.push("threaded");
    el.querySelector(".txt").textContent = parts.join(" · ") || "no link yet";
    el.className = "netstats q-" + s.quality;

    const warn = $("perf-warn");
    let msg = "";
    warn.classList.remove("err");
    if (s.linkFailed) {
      msg = "Could not connect to the other player directly. One of you is behind a strict router or firewall. " +
        (s.usingTurn ? "The configured TURN relay did not help either; check its address and credentials." : "The server operator needs to add a TURN relay to ICE_SERVERS.");
      warn.classList.add("err");
    } else if (s.role === "host" && s.slow) {
      msg = "Your emulator is running at " + s.emuFps + " fps (the game needs " + Math.round(state.game.performance.fps) + "). ";
      if (s.hidden) msg += "This tab is in the background; keep it in front.";
      else if (inIframe && !isolatedTab) msg += "Use Pop out to run it in its own tab and keep that tab in front.";
      else msg += "Close other heavy tabs or apps; " + state.game.hardware + " emulation needs a fast CPU core.";
    } else if (s.role !== "host" && s.link && s.link.streamFps !== null && s.link.streamFps < 40) {
      msg = "The host's video is arriving at " + s.link.streamFps + " fps" + (s.link.route === "relay" ? " through a relay server" : "") + ". Expect choppy motion.";
    }
    warn.textContent = msg;
    warn.classList.toggle("hidden", !msg);
  }

  $("input-delay").addEventListener("change", (e) => {
    const d = TSL.Netplay.setInputDelay(e.target.value);
    toast(d === 0 ? "Input delay off" : "Your inputs now land " + d + " frame" + (d > 1 ? "s" : "") + " later");
  });
  $("btn-rematch").addEventListener("click", () => {
    if (state.current && state.current.role === "host") {
      if (TSL.Netplay.rematch()) { toast("Game restarted. Insert coin and press Start."); $("rematch-ask").classList.add("hidden"); }
    } else {
      TSL.Netplay.requestRematch();
      toast("Asked the host for a rematch.");
    }
  });
  $("btn-rematch-accept").addEventListener("click", () => {
    if (TSL.Netplay.rematch()) toast("Game restarted. Insert coin and press Start.");
    $("rematch-ask").classList.add("hidden");
  });
  $("btn-rematch-dismiss").addEventListener("click", () => $("rematch-ask").classList.add("hidden"));
  $("btn-watch-link").addEventListener("click", () => {
    if (!state.current) return;
    navigator.clipboard.writeText(shareLink(state.current.code, "spectator")).then(() => toast("Watch link copied"));
  });
  $("btn-popout").addEventListener("click", () => {
    const m = state.current;
    if (!m) return;
    TSL.Netplay.leave();
    const w = window.open(popoutUrl(m), "_blank");
    if (!w) { toast("Your browser blocked the new tab.", true); return; }
    location.href = cleanUrl();   // EmulatorJS cannot be torn down in place
  });
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
  // An explicit name in the link (pop-out tab, bot link) wins over a stored one.
  if (params.get("name")) { state.name = params.get("name"); $("player-name").value = state.name; }

  if (await setGame(initialGame())) enterLobby(); else show("screen-rom");
})();
