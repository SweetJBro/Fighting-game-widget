/* Controller badge and panel: which controllers the page sees, whether each
   one is alive (a lit dot while a button is held), its mapping, and what it
   does in this match:
     local match     dropdown: Player 1 / Player 2 / not playing (remembered by name)
     host or guest   "Use this": the preferred controller. Host: it drives Player 1
                     and other local pads are silenced. Guest: only it is read.
     spectator       everything ignored
   Plus a Steam Input hint when nothing is seen and "Reset controller settings". */
window.TSL = window.TSL || {};
TSL.UI = TSL.UI || {};

TSL.UI.padsPanel = function install(ctx) {
  const { $, state, toast } = ctx;
  const PL = () => TSL.PadLogic;

  function padsNow() {
    if (TSL.Netplay.isStarted && TSL.Netplay.isStarted()) return TSL.Netplay.pads();
    const preferred = PL().store(localStorage).preferred();
    return [...(navigator.getGamepads ? navigator.getGamepads() : [])].filter(Boolean)
      .map((gp) => ({ index: gp.index, id: gp.id, mapping: gp.mapping, player: -1, standard: gp.mapping === "standard",
        preferred: !!preferred && PL().sameId(gp.id, preferred), active: PL().isActive(gp) }));
  }
  const role = () => (state.current ? state.current.role : null);
  const panelOpen = () => !$("controls-help").classList.contains("hidden");

  let lastStructure = "";
  function renderPads() {
    const list = padsNow();
    const b = $("pad-badge");
    b.textContent = list.length ? list.length + " controller" + (list.length > 1 ? "s" : "") : "no controller";
    b.classList.toggle("badge-muted", !list.length); b.classList.toggle("badge-ok", !!list.length);
    b.title = list.length ? list.map((p) => PL().shortName(p.id)).join("\n") : b.title;

    // Activity dots update on every poll; the list itself only when something structural changed.
    for (const p of list) {
      const dot = document.querySelector('#pad-list [data-pad="' + p.index + '"] .pad-dot');
      if (dot) dot.classList.toggle("on", p.active);
    }
    const structure = JSON.stringify(list.map((p) => [p.index, p.id, p.player, p.preferred, p.standard])) + role();
    if (structure === lastStructure) return;
    lastStructure = structure;

    const ul = $("pad-list"); ul.innerHTML = "";
    $("pad-empty").classList.toggle("hidden", list.length > 0);
    $("pad-steam-hint").classList.toggle("hidden", list.length > 0);
    const r = role();
    const anyPreferred = list.some((p) => p.preferred);
    for (const p of list) {
      const li = document.createElement("li"); li.dataset.pad = String(p.index);
      const dot = document.createElement("span"); dot.className = "pad-dot" + (p.active ? " on" : ""); dot.title = "Lights up while a button or the stick is held";
      const name = document.createElement("span"); name.className = "pad-name"; name.textContent = PL().shortName(p.id);
      li.append(dot, name);
      if (!p.standard) {
        const warn = document.createElement("span"); warn.className = "pad-warn";
        warn.textContent = "non-standard layout";
        warn.title = "The browser gave this controller no standard button numbering. The host's emulator can still be remapped to it; when joining, its buttons may not match the game's table.";
        li.appendChild(warn);
      }
      const tag = document.createElement("span"); tag.className = "meta";
      if (r === "local") {
        const sel = document.createElement("select");
        [["-1", "not playing"], ["0", "Player 1"], ["1", "Player 2"]].forEach(([v, t]) => { const o = document.createElement("option"); o.value = v; o.textContent = t; sel.appendChild(o); });
        sel.value = String(p.player <= 1 ? p.player : -1);
        sel.onchange = () => { TSL.Netplay.assignPad(p.index, Number(sel.value)); lastStructure = ""; renderPads(); };
        li.appendChild(sel);
      } else if (r === "spectator") {
        tag.textContent = "ignored while watching"; li.appendChild(tag);
      } else if (r === "host" || r === "guest") {
        if (p.player >= 0) tag.textContent = r === "host" ? "drives Player 1" : "sent to the host as Player 2";
        else tag.textContent = anyPreferred ? "ignored (another controller is preferred)" : (p.standard ? "ignored" : "ignored (non-standard layout)");
        li.appendChild(tag);
        const btn = document.createElement("button"); btn.className = "btn btn-ghost btn-sm";
        btn.textContent = p.preferred ? "Preferred ✓" : "Use this";
        btn.title = p.preferred ? "Click to use any controller again" : "Only this controller plays; the others are ignored. Remembered by controller name.";
        btn.onclick = () => { TSL.Netplay.setPreferredPad(p.preferred ? null : p.id); lastStructure = ""; renderPads(); toast(p.preferred ? "Any controller plays again." : PL().shortName(p.id) + " is your controller now."); };
        li.appendChild(btn);
      } else {
        tag.textContent = p.preferred ? "preferred" : "ready"; li.appendChild(tag);
      }
      ul.appendChild(li);
    }
  }
  $("btn-pad-reset").addEventListener("click", () => {
    const removed = TSL.Netplay.isStarted && TSL.Netplay.isStarted() ? TSL.Netplay.resetControllerSettings() : PL().store(localStorage).reset();
    lastStructure = ""; renderPads();
    toast(removed.length ? "Controller settings reset: players, preferred controller and button remaps." : "No controller settings were stored.");
  });
  window.addEventListener("gamepadconnected", renderPads);
  window.addEventListener("gamepaddisconnected", () => { lastStructure = ""; renderPads(); });
  // Fast while the panel is open (live dots), slow otherwise (badge only).
  let slowTick = 0;
  setInterval(() => { if (panelOpen() || ++slowTick % 7 === 0) renderPads(); }, 150);

  Object.assign(ctx, { renderPads });
};
