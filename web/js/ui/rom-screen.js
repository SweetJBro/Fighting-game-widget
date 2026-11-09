/* ROM screen: what the host needs, picking files (Fightcade split pairs are combined),
   and the detours that send a would-be host here first. Only hosting and local
   play need a ROM; joining and watching never do. */
window.TSL = window.TSL || {};
TSL.UI = TSL.UI || {};

TSL.UI.romScreen = function install(ctx) {
  const { $, state, cfg, toast, show } = ctx;
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
    const pieces = [g.rom.file].concat(g.rom.parent ? [g.rom.parent + ".zip"] : [], g.bios ? [g.bios.file] : []);
    acc.append("Needs ");
    pieces.forEach((name, i) => {
      if (i) acc.append(i === pieces.length - 1 ? " and " : ", ");
      const c = document.createElement("code"); c.textContent = name; acc.append(c);
    });
    if (g.rom.versionLabel) acc.append(" (" + g.rom.versionLabel + ")");
    acc.append(".");

    const packagedOnly = !!(state.rom && state.rom.packaged);
    $("rom-heading").textContent = gameReady() && packagedOnly ? "Ready to play" : "Bring your own ROM";
    $("rom-intro").classList.toggle("hidden", packagedOnly);
    $("rom-intro-packaged").classList.toggle("hidden", !packagedOnly);
    $("btn-rom-clear").classList.toggle("hidden", !(state.rom && !state.rom.packaged));
    $("btn-rom-download").classList.toggle("hidden", !(state.rom && !state.rom.packaged && state.rom.file));
    renderStorage();

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
    badge.textContent = ready ? (state.rom.packaged ? "packaged · " : "") + g.short : "no ROM (only to host)";
    badge.title = ready ? g.rom.file + (g.rom.versionLabel ? " · " + g.rom.versionLabel : "") : "";
    badge.classList.toggle("badge-muted", !ready); badge.classList.toggle("badge-ok", ready);
    $("btn-rom-continue").disabled = !ready;
    $("btn-rom-continue").textContent = state.pending ? "Continue to match" : "Continue";
    return ready;
  }
  /** "Stored in this browser: 3 sets, 160 MB of 2.1 GB available · Forget all". */
  async function renderStorage() {
    const el = $("rom-storage"); el.innerHTML = "";
    let list = [];
    try { list = await TSL.RomStore.list(); } catch (_) {}
    if (!list.length) { return; }
    const mb = (n) => (n / 1048576).toFixed(n > 10485760 ? 0 : 1) + " MB";
    const total = list.reduce((n, r) => n + (r.size || 0), 0);
    let text = "Stored in this browser: " + list.length + " zip" + (list.length > 1 ? "s" : "") + ", " + mb(total);
    try {
      if (navigator.storage && navigator.storage.estimate) {
        const est = await navigator.storage.estimate();
        if (est && est.quota) text += " of about " + (est.quota / 1073741824).toFixed(1) + " GB this browser allows";
      }
    } catch (_) {}
    el.append(text + ". ");
    const b = document.createElement("button"); b.className = "btn btn-ghost btn-sm"; b.textContent = "Forget all stored ROMs";
    b.title = list.map((r) => r.name).join(", ");
    b.onclick = async () => { await TSL.RomStore.clearAll(); $("rom-msg").classList.add("hidden"); await refreshRom(); toast("All stored ROMs forgotten."); };
    el.appendChild(b);
  }
  $("btn-rom-download").addEventListener("click", () => {
    if (!state.rom || !state.rom.file) return;
    const url = URL.createObjectURL(state.rom.file);
    const a = document.createElement("a"); a.href = url; a.download = state.rom.name || state.game.rom.file;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  });
  // Keyboard: the drop zone is a button too.
  $("rom-drop").addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); $("rom-file").click(); } });
  async function takeRomFiles(files) {
    if (!files.length) return;
    const msg = $("rom-msg");
    msg.classList.remove("hidden", "err-notice");
    msg.textContent = "Checking " + files.map((f) => f.name).join(", ") + "…";
    let r;
    try { r = await TSL.RomStore.addFiles(state.game, files); }
    catch (e) { r = { stored: [], need: [], notes: ["Could not read those files: " + (e.message || e)] }; }
    await refreshRom();
    const lines = [];
    if (r.stored.length) lines.push("Stored " + r.stored.join(" and ") + " in this browser.");
    if (r.need.length) lines.push("Got it. Now also pick " + r.need.join(" and ") + " (from the same Fightcade folder).");
    lines.push(...r.notes);
    if (!lines.length) lines.push("Nothing usable for " + state.game.name + " in that pick.");
    msg.textContent = lines.join(" ");
    msg.classList.toggle("err-notice", !r.stored.length && !r.need.length);
    if (r.stored.length) toast(lines[0]);
  }
  // Reset the chooser after every pick: picking the same file again must fire "change".
  $("rom-file").addEventListener("change", (e) => { const files = [...e.target.files]; e.target.value = ""; takeRomFiles(files); });
  const dz = $("rom-drop");
  ["dragenter", "dragover"].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add("drag"); }));
  ["dragleave", "drop"].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove("drag"); }));
  dz.addEventListener("drop", (e) => takeRomFiles([...e.dataTransfer.files]));
  $("btn-rom-clear").addEventListener("click", async () => { await TSL.RomStore.clear(state.game); $("rom-msg").classList.add("hidden"); await refreshRom(); });
  $("btn-rom-continue").addEventListener("click", () => {
    if (state.pending) { const m = state.pending; state.pending = null; show("screen-lobby"); m(); return; }
    ctx.enterLobby();
  });
  $("btn-rom-settings").addEventListener("click", () => { if (!TSL.Netplay.isConnected()) show("screen-rom"); });

  /** Run `start` for game `g`, detouring through the ROM screen if its files are missing. */
  async function withGame(g, start) {
    if (!g) { toast("This match is for a game this lobby does not know.", true); return; }
    const ready = g.id === state.game.id ? gameReady() : await ctx.setGame(g);
    if (ready) { start(); return; }
    state.pending = start;
    await refreshRom();
    show("screen-rom");
    toast("To host " + g.name + " you need its ROM (" + g.rom.file + (g.bios ? " + " + g.bios.file : "") + ").", true);
  }
  /** Joining or watching needs no ROM, only the right game selected (for its controls). */
  async function asGuestOf(g, start) {
    if (!g) { toast("This match is for a game this lobby does not know.", true); return; }
    if (g.id !== state.game.id) await ctx.setGame(g);
    start();
  }

  Object.assign(ctx, { gameReady, refreshRom, withGame, asGuestOf });
};
