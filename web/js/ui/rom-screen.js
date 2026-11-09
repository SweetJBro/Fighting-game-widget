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
    acc.append("Needs ");
    const c1 = document.createElement("code"); c1.textContent = g.rom.file; acc.append(c1);
    if (g.rom.versionLabel) acc.append(" (" + g.rom.versionLabel + ")");
    if (g.bios) { acc.append(" and the " + (g.bios.label || "BIOS") + " "); const c2 = document.createElement("code"); c2.textContent = g.bios.file; acc.append(c2); }
    acc.append(". Every file is checked against FinalBurn Neo's list.");
    $("rom-merge-hint").textContent = g.rom.parent
      ? "From Fightcade: pick both " + g.rom.file + " and " + g.rom.parent + ".zip from its ROMs/fbneo folder (together, or one after the other). Fightcade keeps this game split across the two; the browser combines them for you."
      : (g.bios ? "From Fightcade: pick " + g.rom.file + " and " + g.bios.file + " from its ROMs/fbneo folder." : "");

    renderHowTo(g);

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
    badge.textContent = ready ? (state.rom.packaged ? "packaged · " : "") + g.short : "no ROM (only to host)";
    badge.title = ready ? g.rom.file + (g.rom.versionLabel ? " · " + g.rom.versionLabel : "") : "";
    badge.classList.toggle("badge-muted", !ready); badge.classList.toggle("badge-ok", ready);
    $("btn-rom-continue").disabled = !ready;
    $("btn-rom-continue").textContent = state.pending ? "Continue to match" : "Continue";
    return ready;
  }
  /** The collapsible "How to get the files" list: exact file names for this game. */
  function renderHowTo(g) {
    const ol = $("rom-howto-steps"); ol.innerHTML = "";
    const step = (...parts) => {
      const li = document.createElement("li");
      for (const p of parts) {
        if (typeof p === "string") li.append(p);
        else { const c = document.createElement("code"); c.textContent = p.code; li.append(c); }
      }
      ol.appendChild(li);
    };
    const files = [{ code: g.rom.file }];
    if (g.rom.parent) files.push(" and ", { code: g.rom.parent + ".zip" });
    if (g.bios) files.push(" and ", { code: g.bios.file });
    step("Install Fightcade and let it download ", g.name, " once (its channel does this when you first play).");
    step("Open Fightcade's ROM folder, ", { code: "ROMs/fbneo" }, " (Linux Flatpak: ", { code: "~/.var/app/com.fightcade.Fightcade/data/ROMs/fbneo" }, "; Windows: the ", { code: "ROMs\\fbneo" }, " folder inside the Fightcade install).");
    step("Pick ", ...files, " above, together or one after the other.");
    if (g.rom.parent) step("Fightcade keeps this game split across those zips; the browser combines them into one full set here. Other dumps work too as long as every file matches FinalBurn Neo's list, which is what the check against the manifest confirms.");
    else step("Any FinalBurn Neo set with the same files works; the check against the manifest confirms each one.");
    if (g.rom.versionLabel) step("Only this set is accepted: ", g.rom.versionLabel, ". A different revision is reported as missing files instead of booting to a black screen.");
  }
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
