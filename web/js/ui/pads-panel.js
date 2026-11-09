/* Controller badge and panel: which controllers the page sees and, in local
   matches, which one is Player 1 and Player 2 (remembered by controller name). */
window.TSL = window.TSL || {};
TSL.UI = TSL.UI || {};

TSL.UI.padsPanel = function install(ctx) {
  const { $, state } = ctx;
  /* ---------- Controllers ---------- */
  function padsNow() {
    if (TSL.Netplay.isStarted && TSL.Netplay.isStarted()) return TSL.Netplay.pads();
    return [...(navigator.getGamepads ? navigator.getGamepads() : [])].filter(Boolean)
      .map((gp) => ({ index: gp.index, id: gp.id, player: -1, standard: gp.mapping === "standard" }));
  }
  const shortPad = (id) => id.replace(/\s*\((?:STANDARD GAMEPAD|Vendor:)[^)]*\)/i, "").replace(/\s+/g, " ").trim() || id;
  let lastPadJson = "";
  function renderPads() {
    const list = padsNow();
    const b = $("pad-badge");
    b.textContent = list.length ? list.length + " controller" + (list.length > 1 ? "s" : "") : "no controller";
    b.classList.toggle("badge-muted", !list.length); b.classList.toggle("badge-ok", !!list.length);
    b.title = list.length ? list.map((p) => shortPad(p.id)).join("\n") : b.title;
    const json = JSON.stringify(list) + (state.current ? state.current.role : "");
    if (json === lastPadJson) return;
    lastPadJson = json;
    const ul = $("pad-list"); ul.innerHTML = "";
    $("pad-empty").classList.toggle("hidden", list.length > 0);
    const local = state.current && state.current.role === "local";
    for (const p of list) {
      const li = document.createElement("li");
      const name = document.createElement("span"); name.className = "pad-name"; name.textContent = shortPad(p.id) + (p.standard ? "" : " (non-standard layout)");
      li.appendChild(name);
      if (local) {
        const sel = document.createElement("select");
        [["-1", "not playing"], ["0", "Player 1"], ["1", "Player 2"]].forEach(([v, t]) => { const o = document.createElement("option"); o.value = v; o.textContent = t; sel.appendChild(o); });
        sel.value = String(p.player <= 1 ? p.player : -1);
        sel.onchange = () => { TSL.Netplay.assignPad(p.index, Number(sel.value)); lastPadJson = ""; renderPads(); };
        li.appendChild(sel);
      } else {
        const tag = document.createElement("span"); tag.className = "meta";
        tag.textContent = state.current ? (state.current.role === "spectator" ? "ignored while watching" : "drives your player") : "ready";
        li.appendChild(tag);
      }
      ul.appendChild(li);
    }
  }
  window.addEventListener("gamepadconnected", renderPads);
  window.addEventListener("gamepaddisconnected", () => { lastPadJson = ""; renderPads(); });
  setInterval(renderPads, 1000);

  Object.assign(ctx, { renderPads });
};
