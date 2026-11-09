/* Match screen: starts a match (host, guest, spectator, local), shows status and
   connection stats, and wires the match bar (delay, rematch, watch link,
   pop-out, leave). */
window.TSL = window.TSL || {};
TSL.UI = TSL.UI || {};

TSL.UI.matchScreen = function install(ctx) {
  const { $, state, cfg, params, toast, show, myName, shareLink, cleanUrl, popoutPref, popoutUrl, openPopout, seats, inIframe, isolatedTab, sel } = ctx;
  /* ---------- Match ---------- */
  async function startMatch({ code, role, sid, expectedGuest }) {
    state.name = myName(); localStorage.setItem("tsl.name", state.name);
    // Fail fast with a clear message instead of a silent socket.io retry loop.
    if (role !== "local" && state.serverPing === null) await ctx.refreshPing();
    if (role !== "local" && state.serverPing === null) {
      toast("Can't reach the netplay server at " + cfg.netplayUrl + ". Check that it is running and that NETPLAY_URL points at it.", true);
      return;
    }
    if (role !== "local" && popoutPref() && openPopout({ code, role, sid, expectedGuest })) return;
    clearInterval(state.pollTimer);
    state.current = { code, role, sid, game: state.game.id, expectedGuest: expectedGuest || null };
    sel.disabled = true;
    state.connected = false;
    $("btn-popout").classList.toggle("hidden", isolatedTab);
    $("delay-wrap").classList.toggle("hidden", role !== "host");
    $("input-delay").value = String(TSL.Netplay.getInputDelay());
    lastRtt = null; renderDelayHint();
    show("screen-match");
    setRole(role);
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
      matrixId: state.mode === "matrix" ? state.myId : (params.get("mxid") || null),
      expectedGuest: expectedGuest || null,
      maxSpectators: role === "host" ? seats() : null,
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
          setRole("spectator");
          $("btn-popout").classList.add("hidden");
          if (s.bumped && !state.bumpedNotified) { state.bumpedNotified = true; toast("This match already has an opponent, so you are watching."); }
        }
        else if (s.state === "local") {
          setStatus("local match · one controller per player", "ok");
          $("match-code").textContent = "";
          $("delay-wrap").classList.add("hidden");
          $("btn-popout").classList.add("hidden");
          $("btn-rematch").textContent = "Restart";
          $("btn-rematch").classList.remove("hidden");
          $("controls-help").classList.remove("hidden");   // show the controller panel straight away
        }
        else if (s.state === "error") { setStatus(s.message, "err"); toast(s.message, true); }
      },
      onStats: renderStats,
      onRematchRequest: (who) => {
        $("rematch-ask-text").textContent = who + " wants a rematch. This restarts the game for everyone.";
        $("rematch-ask").classList.remove("hidden");
      },
      onRematchDone: (how) => toast(how === "instant" ? "Rematch: back at the title screen. Insert coin and press Start." : "The host restarted the game. Insert coin and press Start.")
    });
  }

  /** "~50 ms you · ~90 ms them": host delay in frames vs the guest's round trip plus a video frame each way. */
  let lastRtt = null;
  function renderDelayHint() {
    const el = $("delay-hint");
    if (!state.current || state.current.role !== "host") { el.textContent = ""; return; }
    const fps = (state.game.performance && state.game.performance.fps) || 60;
    const mine = Math.round(TSL.Netplay.getInputDelay() * 1000 / fps);
    const theirs = lastRtt === null ? null : Math.round(lastRtt + 2000 / fps);
    el.textContent = "≈" + mine + " ms you" + (theirs === null ? "" : " · ≈" + theirs + " ms them");
  }

  /** The role badge is the one persistent "what am I" indicator; the tab title repeats it. */
  function setRole(role) {
    const el = $("match-role");
    el.textContent = { host: "You host · Player 1", guest: "You are Player 2", spectator: "You are watching", local: "Local · 2 players" }[role] || role;
    el.className = "badge role-badge role-" + role;
    const code = state.current ? state.current.code : "";
    document.title = ({ host: "Hosting", guest: "Playing", spectator: "Watching", local: "Local match" }[role] || "") + (code && code !== "LOCAL" ? " " + code : "") + " · " + state.game.short;
  }

  // Dismissed banner kinds, for this tab's session only.
  const DISMISS_KEY = "tsl.dismissedWarnings";
  function dismissed() { try { return JSON.parse(sessionStorage.getItem(DISMISS_KEY) || "[]"); } catch (_) { return []; } }
  let currentWarnKind = null;
  $("perf-warn-close").addEventListener("click", () => {
    if (!currentWarnKind) return;
    try { sessionStorage.setItem(DISMISS_KEY, JSON.stringify([...new Set([...dismissed(), currentWarnKind])])); } catch (_) {}
    $("perf-warn").classList.add("hidden");
  });
  function showWarn(kind, msg, isErr) {
    const warn = $("perf-warn");
    currentWarnKind = kind;
    warn.classList.toggle("err", !!isErr);
    $("perf-warn-text").textContent = msg || "";
    warn.classList.toggle("hidden", !msg || dismissed().includes(kind));
  }

  function renderStats(s) {
    lastRtt = s.link && s.link.rttMs !== null ? s.link.rttMs : null;
    renderDelayHint();
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

    // One banner at a time, most serious first. Each kind can be dismissed for the session.
    let kind = null, msg = "", err = false;
    const relay = s.link && s.link.route === "relay";
    if (s.linkFailed) {
      kind = "linkFailed"; err = true;
      msg = "Could not connect to the other player directly. One of you is behind a strict router or firewall. " +
        (s.usingTurn ? "The configured TURN relay did not help either; check its address and credentials." : "The server operator needs to add a TURN relay to ICE_SERVERS.");
    } else if (s.role === "host" && s.slow) {
      kind = "slow";
      msg = "Your emulator is running at " + s.emuFps + " fps (the game needs " + Math.round(state.game.performance.fps) + "). ";
      if (s.hidden) msg += "This tab is in the background; keep it in front.";
      else if (inIframe && !isolatedTab) msg += "Use Pop out to run it in its own tab and keep that tab in front.";
      else msg += "Close other heavy tabs or apps; " + state.game.hardware + " emulation needs a fast CPU core.";
    } else if (s.role !== "host" && s.link && s.link.streamFps !== null && s.link.streamFps < 40) {
      kind = "guestFps";
      msg = "The host's video is arriving at " + s.link.streamFps + " fps" + (relay ? " through a relay server" : "") + ". Expect choppy motion. " +
        (relay ? "A relay adds lag both ways; " : "") + "the host could lower their watch seats, or the player with the better connection could host.";
    } else if (s.link && s.quality === "poor") {
      kind = "poorLink";
      msg = "Ping to the other player is " + s.link.rttMs + " ms" + (relay ? ", through a relay server" : "") + ". " +
        (relay ? "Relay routes are slow: a TURN server closer to both of you helps, or try again when a direct route is possible. " : "") +
        "The player with the better connection should host" + (s.role === "host" ? "; fewer watch seats frees your upload." : ".");
    } else if (relay) {
      kind = "relay";
      msg = "Connected through a TURN relay: expect a little more lag than a direct route and a lower-bitrate stream.";
    }
    showWarn(kind, msg, err);
  }

  $("input-delay").addEventListener("change", (e) => {
    const d = TSL.Netplay.setInputDelay(e.target.value);
    renderDelayHint();
    toast(d === 0 ? "Input delay off" : "Your inputs now land " + d + " frame" + (d > 1 ? "s" : "") + " later");
  });
  $("btn-rematch").addEventListener("click", () => {
    if (state.current && (state.current.role === "host" || state.current.role === "local")) {
      const how = TSL.Netplay.rematch();
      if (how) { toast(how === "instant" ? "Back at the title screen. Insert coin and press Start." : "Game restarted. Insert coin and press Start."); $("rematch-ask").classList.add("hidden"); }
    } else {
      TSL.Netplay.requestRematch();
      toast("Asked the host for a rematch.");
    }
  });
  $("btn-rematch-accept").addEventListener("click", () => {
    const how = TSL.Netplay.rematch();
    if (how) toast(how === "instant" ? "Back at the title screen. Insert coin and press Start." : "Game restarted. Insert coin and press Start.");
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

  Object.assign(ctx, { startMatch, setStatus });
};
