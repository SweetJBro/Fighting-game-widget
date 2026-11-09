/* Matrix widget lobby: room members, challenge / accept / cancel events, live
   matches to watch. Lobby traffic is room events (see matrix-lobby.js). */
window.TSL = window.TSL || {};
TSL.UI = TSL.UI || {};

TSL.UI.matrixUi = function install(ctx) {
  const { $, state, toast, myName, makeCode } = ctx;
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
      if (ch && state.challengeId === c.id && c.by) {
        $("match-opponent").textContent = "vs " + c.by.name;
        // Open challenge: whoever accepted is the one allowed to be Player 2.
        if (state.current && state.current.role === "host" && !ch.to) TSL.Netplay.setExpectedGuest(c.by.id);
      }
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
      btn.onclick = () => ctx.asGuestOf(TSL.Games.get(c.game), () => ctx.startMatch({ code: c.code, role: "spectator" }));
      li.append(left, btn); ul.appendChild(li);
    }
  }

  async function sendChallenge(toId) {
    if (!ctx.gameReady()) { await ctx.withGame(state.game, () => sendChallenge(toId)); return; }
    const code = makeCode();
    const id = crypto.randomUUID();
    try {
      await state.matrix.send({ kind: "challenge", id, code, game: state.game.id, from: { id: state.myId, name: myName(), ping: state.serverPing }, to: toId });
    } catch (e) { return toast("Could not post challenge: " + (e.message || e), true); }
    state.challengeId = id;
    ctx.startMatch({ code, role: "host", expectedGuest: toId || null });
  }

  async function acceptChallenge(c) {
    // Check the ROM first: accepting and then failing to load would strand the challenger.
    await ctx.asGuestOf(TSL.Games.get(c.game), async () => {
      try { await state.matrix.send({ kind: "accept", id: c.id, code: c.code, game: c.game, by: { id: state.myId, name: myName() } }); } catch (_) {}
      state.challengeId = c.id;
      $("match-opponent").textContent = "vs " + c.from.name;
      ctx.startMatch({ code: c.code, role: "guest" });
    });
  }

  Object.assign(ctx, { matrixLobby, renderChallenges });
};
