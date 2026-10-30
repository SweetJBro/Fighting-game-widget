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

  /** EmulatorJS controller table (player 1) built from the game's input map. */
  function controls(game) {
    const p1 = {};
    for (const [idx, b] of Object.entries(game.input)) p1[idx] = { value: b.key, value2: b.pad };
    // EmulatorJS replaces its whole table with this object and then touches
    // players 2-4, so they must exist even when empty.
    return { 0: p1, 1: {}, 2: {}, 3: {} };
  }

  /** [{ label, key }] for the Controls help, buttons first. */
  function controlsHelp(game) {
    const order = ["1", "9", "10", "0", "8", "11", "2", "3"];
    return order.filter((i) => game.input[i]).map((i) => ({ label: game.input[i].label, key: game.input[i].key }));
  }

  return {
    load, find, controls, controlsHelp,
    all: () => list,
    get: (id) => byId[id] || null,
    defaultId: () => defaultId
  };
})();

/* Reads a zip's central directory (no decompression) and checks it against a
   game's manifest. FBNeo matches files by CRC32, so we do too: renamed files
   are fine, wrong revisions are not. */
TSL.ZipCheck = (() => {
  async function entries(blob) {
    const tailLen = Math.min(blob.size, 65536 + 22);
    const tail = new DataView(await blob.slice(blob.size - tailLen).arrayBuffer());
    let eocd = -1;
    for (let i = tail.byteLength - 22; i >= 0; i--) {
      if (tail.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error("not a zip file");
    const count = tail.getUint16(eocd + 10, true);
    const cdSize = tail.getUint32(eocd + 12, true);
    const cdOffset = tail.getUint32(eocd + 16, true);
    if (cdOffset === 0xffffffff) throw new Error("zip64 archives are not supported");
    const cd = new DataView(await blob.slice(cdOffset, cdOffset + cdSize).arrayBuffer());
    const out = [];
    let p = 0;
    const dec = new TextDecoder();
    for (let n = 0; n < count && p + 46 <= cd.byteLength; n++) {
      if (cd.getUint32(p, true) !== 0x02014b50) break;
      const crc = cd.getUint32(p + 16, true);
      const size = cd.getUint32(p + 24, true);
      const nameLen = cd.getUint16(p + 28, true), extraLen = cd.getUint16(p + 30, true), commentLen = cd.getUint16(p + 32, true);
      const name = dec.decode(new Uint8Array(cd.buffer, cd.byteOffset + p + 46, nameLen));
      if (!name.endsWith("/")) out.push({ name, size, crc });
      p += 46 + nameLen + extraLen + commentLen;
    }
    return out;
  }

  /** { ok, missing: [names], present: n, total: n } against spec.members (or spec.required). */
  async function check(blob, spec) {
    const have = new Set((await entries(blob)).map((e) => e.size + ":" + e.crc));
    const need = spec.required ? spec.members.filter((m) => spec.required.includes(m.name)) : spec.members;
    const missing = need.filter((m) => !have.has(m.size + ":" + parseInt(m.crc32, 16))).map((m) => m.name);
    return { ok: missing.length === 0, missing, present: need.length - missing.length, total: need.length };
  }

  return { entries, check };
})();
