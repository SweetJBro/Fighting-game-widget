/* Game registry. Each game is a data file in web/games/<id>.json (see
   docs/game-adapter.d.ts); web/games/index.json lists them. Everything game
   specific (ROM manifest, BIOS, core options, buttons, netplay room namespace)
   comes from there, so the lobby, Matrix events and netplay stay game-agnostic. */
window.TSL = window.TSL || {};

TSL.Games = (() => {
  let list = [];
  let byId = {};
  let defaultId = null;

  async function load() {
    const idx = await (await fetch("games/index.json", { cache: "no-cache" })).json();
    const games = await Promise.all(idx.games.map(async (id) => {
      const g = await (await fetch("games/" + id + ".json", { cache: "no-cache" })).json();
      g.rom.file = g.rom.file.toLowerCase();
      return g;
    }));
    list = games;
    byId = Object.fromEntries(games.map((g) => [g.id, g]));
    defaultId = byId[idx.default] ? idx.default : games[0].id;
    return list;
  }

  /** Accepts an id, its zip name or an alias ("3s", "st", "kof"). */
  function find(ref) {
    const r = String(ref || "").toLowerCase().replace(/\.zip$/, "");
    if (byId[r]) return byId[r];
    return list.find((g) => (g.aliases || []).includes(r)) || null;
  }

  /** EmulatorJS controller table built from the game's input map.
      Player 1 gets keyboard keys and pad buttons; players 2-4 get the same pad
      buttons and no keys (local matches: a second controller is Player 2).

      EmulatorJS MERGES this table into its own defaults. Those defaults bind
      L2/R2/L3/R3 (12-15) to pad triggers and sticks, and the analog sticks
      (16-23) to keyboard keys i/j/k/l, so a game using RT for Heavy Kick would
      also fire "R2", and the I key would also push a stick. Therefore:
        0-15 the game does not use: no key, no pad button
        16-23 (analog sticks):      no key, default pad stick kept (the left
                                    stick moves the character in FBNeo)
        24+ are EmulatorJS hotkeys and are left alone. */
  function controls(game) {
    const table = {};
    for (let player = 0; player < 4; player++) {
      const t = {};
      for (let i = 0; i < 16; i++) t[i] = { value: "", value2: "" };
      for (let i = 16; i < 24; i++) t[i] = { value: "" };
      for (const [idx, b] of Object.entries(game.input)) {
        t[idx] = { value: player === 0 ? b.key : "", value2: b.pad };
      }
      table[player] = t;
    }
    return table;
  }

  /** Stable fingerprint of a game's default bindings; saved remaps are dropped when it changes. */
  function inputFingerprint(game) {
    return JSON.stringify(Object.entries(game.input).sort().map(([i, b]) => [i, b.key, b.pad]));
  }

  /** [{ label, key }] for the Controls help, buttons first. */
  function controlsHelp(game) {
    const order = ["1", "9", "10", "0", "8", "11", "2", "3"];
    return order.filter((i) => game.input[i]).map((i) => ({ label: game.input[i].label, key: game.input[i].key }));
  }

  return {
    load, find, controls, controlsHelp, inputFingerprint,
    all: () => list,
    get: (id) => byId[id] || null,
    defaultId: () => defaultId
  };
})();

/* Browser side of the shared zip code (web/js/zipcore.js): Blob-backed reads.
   FBNeo matches files by CRC32, so checks do too: renamed files are fine,
   wrong revisions are not. */
TSL.ZipCheck = (() => {
  const Z = () => TSL.ZipCore;
  const reader = (blob) => async (offset, length) => new Uint8Array(await blob.slice(offset, offset + length).arrayBuffer());

  /** Central-directory entries of a zip Blob/File. */
  function entries(blob) { return Z().readEntries(reader(blob), blob.size); }

  /** { ok, missing, present, total } against spec.members (or spec.required). */
  async function check(blob, spec) { return Z().check(await entries(blob), spec); }

  /** One self-contained zip of spec.members from any mix of source zips
      (clone + parent). Returns { blob: File|null, missing }. */
  async function merge(blobs, spec, outName) {
    const sources = [];
    for (const blob of blobs) {
      try { sources.push({ blob, read: reader(blob), entries: await entries(blob) }); } catch (_) { /* not a zip */ }
    }
    const plan = await Z().assemble(sources, spec.members);
    if (plan.missing.length) return { blob: null, missing: plan.missing };
    const parts = plan.parts.map((p) => (p instanceof Uint8Array ? p : p.source.blob.slice(p.start, p.start + p.length)));
    return { blob: new File(parts, outName, { type: "application/zip" }), missing: [] };
  }

  return { entries, check, merge };
})();
