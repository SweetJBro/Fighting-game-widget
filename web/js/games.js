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
      const flags = cd.getUint16(p + 8, true);
      const method = cd.getUint16(p + 10, true);
      const time = cd.getUint16(p + 12, true), date = cd.getUint16(p + 14, true);
      const crc = cd.getUint32(p + 16, true);
      const compSize = cd.getUint32(p + 20, true);
      const size = cd.getUint32(p + 24, true);
      const nameLen = cd.getUint16(p + 28, true), extraLen = cd.getUint16(p + 30, true), commentLen = cd.getUint16(p + 32, true);
      const offset = cd.getUint32(p + 42, true);
      const name = dec.decode(new Uint8Array(cd.buffer, cd.byteOffset + p + 46, nameLen));
      if (!name.endsWith("/")) out.push({ name, size, crc, compSize, method, flags, time, date, offset });
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

  /** Builds one self-contained zip holding `spec.members`, taking each file (by
      size + CRC32) from whichever source zip has it. Fightcade ships clones split
      from their parent (sfiii3nr1.zip needs sfiii3.zip); EmulatorJS cannot keep a
      parent zip intact, so the browser assembles the full set itself.
      Compressed data is copied as is (no inflate/deflate), so this is fast and the
      result is just Blob slices of the sources plus small headers.
      Returns { blob, missing: [names] }; blob is null when anything is missing. */
  async function merge(sources, spec, outName) {
    const pool = new Map();   // "size:crc" -> { src, entry }
    for (const src of sources) {
      let list;
      try { list = await entries(src); } catch (_) { continue; }
      for (const e of list) {
        const k = e.size + ":" + e.crc;
        if (!pool.has(k) && !(e.flags & 1)) pool.set(k, { src, e });   // flag bit 0 = encrypted
      }
    }
    const missing = spec.members.filter((m) => !pool.has(m.size + ":" + parseInt(m.crc32, 16))).map((m) => m.name);
    if (missing.length) return { blob: null, missing };

    const enc = new TextEncoder();
    const parts = [], central = [];
    let offset = 0;
    for (const m of spec.members) {
      const { src, e } = pool.get(m.size + ":" + parseInt(m.crc32, 16));
      // The local header's own name/extra lengths decide where the data starts.
      const lh = new DataView(await src.slice(e.offset, e.offset + 30).arrayBuffer());
      if (lh.getUint32(0, true) !== 0x04034b50) throw new Error("damaged zip entry " + e.name);
      const dataStart = e.offset + 30 + lh.getUint16(26, true) + lh.getUint16(28, true);
      const name = enc.encode(m.name);

      const h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0, true);
      h.setUint16(8, e.method, true); h.setUint16(10, e.time, true); h.setUint16(12, e.date, true);
      h.setUint32(14, e.crc, true); h.setUint32(18, e.compSize, true); h.setUint32(22, e.size, true);
      h.setUint16(26, name.length, true); h.setUint16(28, 0, true);
      parts.push(h.buffer, name, src.slice(dataStart, dataStart + e.compSize));

      const c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0, true);
      c.setUint16(10, e.method, true); c.setUint16(12, e.time, true); c.setUint16(14, e.date, true);
      c.setUint32(16, e.crc, true); c.setUint32(20, e.compSize, true); c.setUint32(24, e.size, true);
      c.setUint16(28, name.length, true); c.setUint32(42, offset, true);
      central.push(c.buffer, name);
      offset += 30 + name.length + e.compSize;
    }
    const cdSize = central.reduce((n, b) => n + b.byteLength, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, spec.members.length, true); end.setUint16(10, spec.members.length, true);
    end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
    const blob = new File([...parts, ...central, end.buffer], outName, { type: "application/zip" });
    return { blob, missing: [] };
  }

  return { entries, check, merge };
})();
