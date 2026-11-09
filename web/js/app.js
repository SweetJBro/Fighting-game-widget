/* App entry: config, shared helpers, game picker, standalone and direct-link
   lobbies, boot. Screens live in web/js/ui/ (rom-screen, matrix-ui,
   match-screen, pads-panel). Everything game specific comes from TSL.Games. */
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
  function popoutUrl({ code, role, sid, expectedGuest }) {
    const u = new URL(cfg.publicUrl, location.href);
    u.search = "";
    u.searchParams.set("match", code);
    u.searchParams.set("role", role);
    if (sid) u.searchParams.set("sid", sid);
    u.searchParams.set("name", myName());
    u.searchParams.set("game", state.game.id);
    if (state.mode === "matrix" && state.myId) u.searchParams.set("mxid", state.myId);
    if (expectedGuest) u.searchParams.set("expect", expectedGuest);
    if (role === "host") u.searchParams.set("seats", String(seats()));
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
  const SEATS_KEY = "tsl.seats";
  function seats() {
    if (params.get("seats") !== null && isolatedTab) return Math.max(0, Math.min(6, Number(params.get("seats")) || 0));
    let v = null;
    try { v = localStorage.getItem(SEATS_KEY); } catch (_) {}
    const d = v === null ? (cfg.maxSpectators ?? 2) : Number(v);
    return Math.max(0, Math.min(6, Number.isFinite(d) ? d : 2));
  }
  $("seats").value = String(seats());
  $("seats").addEventListener("change", (e) => { try { localStorage.setItem(SEATS_KEY, e.target.value); } catch (_) {} });
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
    if (state.mode === "matrix" && ctx.renderChallenges) ctx.renderChallenges();
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
    await setGame(g);
    // Stay on the ROM screen if that is where the switch happened; otherwise the lobby.
    if ($("screen-rom").classList.contains("hidden")) enterLobby();
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
  /* ---------- Screens (web/js/ui/*.js) ----------
     Each module reads what it needs from ctx and adds its own functions to it;
     calls across modules go through ctx, so the order below does not matter. */
  const ctx = { $, state, cfg, params, toast, show, myName, makeCode, shareLink, cleanUrl,
    popoutPref, popoutUrl, openPopout, seats, inIframe, isolatedTab, sel, setGame, enterLobby, refreshPing };
  TSL.UI.romScreen(ctx);
  TSL.UI.matrixUi(ctx);
  TSL.UI.matchScreen(ctx);
  TSL.UI.padsPanel(ctx);
  const { refreshRom, withGame, startMatch } = ctx;

  /* ---------- Lobby ---------- */
  $("player-name").value = state.name;
  $("player-name").addEventListener("change", () => { state.name = myName(); localStorage.setItem("tsl.name", state.name); });

  async function enterLobby() {
    show("screen-lobby");
    $("btn-local").classList.toggle("hidden", state.mode === "direct");
    $("seats-wrap").classList.toggle("hidden", state.mode === "direct" && params.get("role") !== "host");
    $("btn-local").onclick = () => withGame(state.game, () => startMatch({ code: "LOCAL", role: "local" }));
    if (state.mode === "direct") return startDirect();
    if (state.mode === "matrix") return ctx.matrixLobby();
    return standaloneLobby();
  }

  // Standalone: the netplay server's room list is the lobby.
  function standaloneLobby() {
    $("lobby-title").textContent = state.game.short + " lobby";
    $("lobby-subtitle").textContent = "Host a match and share the link, or join someone who is waiting.";
    $("btn-host").onclick = () => withGame(state.game, () => startMatch({ code: makeCode(), role: "host" }));
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
    const m = { code, role, sid: params.get("sid") || undefined, expectedGuest: params.get("expect") || null };
    const go = () => (role === "host" ? withGame(state.game, () => startMatch(m)) : startMatch(m));
    $("btn-host").onclick = go;
    // Pop-out tabs arrive with autostart=1: the click already happened in the opener.
    if (params.get("autostart") === "1") go();
  }

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

  await setGame(initialGame());
  enterLobby();
})();
