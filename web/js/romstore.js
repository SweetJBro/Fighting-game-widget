/* Stores the player's own romsets in IndexedDB, one per game plus shared BIOS
   zips (e.g. neogeo.zip). Nothing leaves the browser. Every file is checked
   against the game's FBNeo manifest before it is stored. */
window.TSL = window.TSL || {};

TSL.RomStore = (() => {
  const DB = "tsl-rom", STORE = "rom";
  const romKey = (gameId) => "rom:" + gameId;
  const biosKey = (biosId) => "bios:" + biosId;

  function open() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  function tx(mode, fn) {
    return open().then((db) => new Promise((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const r = fn(t.objectStore(STORE));
      t.oncomplete = () => { db.close(); resolve(r && r.result); };
      t.onerror = () => { db.close(); reject(t.error); };
    }));
  }
  const getRec = (k) => tx("readonly", (s) => s.get(k));
  const putRec = (k, v) => tx("readwrite", (s) => s.put(v, k));
  const delRec = (k) => tx("readwrite", (s) => s.delete(k));

  /** Normalise "kof2002 (1).zip" -> "kof2002.zip". */
  function canonicalName(fileName) {
    return String(fileName || "").trim().toLowerCase()
      .replace(/\s*\(\d+\)(?=\.zip$)/, "")
      .replace(/\s+/g, "");
  }

  function toFile(rec) {
    return rec && rec.blob ? { name: rec.name, size: rec.size, savedAt: rec.savedAt,
      file: new File([rec.blob], rec.name, { type: "application/zip" }) } : null;
  }

  // Versions before multi-game kept one 3rd Strike set under "current".
  let migrated = false;
  async function migrate() {
    if (migrated) return;
    migrated = true;
    try {
      const old = await getRec("current");
      if (old && old.blob) {
        if (!(await getRec(romKey("sfiii3nr1"))) && /^sfiii3nr1\.zip$/i.test(old.name)) await putRec(romKey("sfiii3nr1"), old);
        await delRec("current");
      }
    } catch (_) {}
  }

  function describeMissing(missing, spec, what) {
    const list = missing.slice(0, 6).join(", ") + (missing.length > 6 ? " and " + (missing.length - 6) + " more" : "");
    return what + " is missing " + missing.length + " of " + spec.members.length + " files (" + list + ").";
  }

  return {
    canonicalName,

    /** Stored set for a game, or null. Drops records that no longer pass the manifest. */
    async get(game) {
      await migrate();
      const rec = await getRec(romKey(game.id));
      if (!rec || !rec.blob) return null;
      if (rec.manifestOk !== true) {
        const r = await TSL.ZipCheck.check(rec.blob, game.rom).catch(() => ({ ok: false }));
        if (!r.ok) { await delRec(romKey(game.id)); return null; }
        rec.manifestOk = true; await putRec(romKey(game.id), rec);
      }
      return toFile(rec);
    },

    async getBios(game) {
      if (!game.bios) return null;
      return toFile(await getRec(biosKey(game.bios.id)));
    },

    /** Store a dropped zip for `game`; it may also be that game's BIOS. Returns what was stored. */
    async put(game, file) {
      const name = canonicalName(file.name);
      if (game.bios && name === game.bios.file) {
        const r = await TSL.ZipCheck.check(file, game.bios);
        if (!r.ok) throw new Error(describeMissing(r.missing, game.bios, "This " + game.bios.file));
        await putRec(biosKey(game.bios.id), { name, size: file.size, savedAt: Date.now(), blob: file });
        return { kind: "bios", name };
      }
      if (name !== game.rom.file) {
        const other = TSL.Games.all().find((g) => g.rom.file === name);
        throw new Error(other
          ? name + " is " + other.name + ", not " + game.name + ". Switch game first."
          : "Expected " + game.rom.file + (game.bios ? " (or " + game.bios.file + ")" : "") + " for " + game.name + ", got " + (file.name || "a file") + ". The zip must keep its set name.");
      }
      const r = await TSL.ZipCheck.check(file, game.rom);
      if (!r.ok) {
        if (r.present === 0) throw new Error("This " + name + " holds none of " + game.name + "'s files. It is a different game or revision renamed to " + name + ".");
        let msg = describeMissing(r.missing, game.rom, "This " + name);
        if (game.rom.parent) {
          msg += " It looks like a split clone set: merge it with " + game.rom.parent + ".zip using scripts/romset.py merge " + game.id + ".";
        }
        throw new Error(msg);
      }
      await putRec(romKey(game.id), { name, size: file.size, savedAt: Date.now(), blob: file, manifestOk: true });
      return { kind: "rom", name };
    },

    async clear(game) {
      await delRec(romKey(game.id));
    }
  };
})();
