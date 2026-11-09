/* Stores the player's own romsets in IndexedDB, one per game plus shared BIOS
   zips (e.g. neogeo.zip). Nothing leaves the browser. Every file is checked
   against the game's FBNeo manifest before it is stored. */
window.TSL = window.TSL || {};

TSL.RomStore = (() => {
  const DB = "tsl-rom", STORE = "rom";
  const romKey = (gameId) => "rom:" + gameId;
  const pending = new Map();   // gameId -> [File] picked so far, not yet a full set
  const biosKey = (biosId) => "bios:" + biosId;

  function open() {
    return new Promise((resolve, reject) => {
      let req;
      try { req = indexedDB.open(DB, 1); }
      catch (e) { reject(new Error("This browser blocks site storage (private window or storage disabled): " + (e.message || e))); return; }
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error("could not open the ROM store"));
      req.onblocked = () => reject(new Error("the ROM store is open in another tab; close it and retry"));
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
  const delRec = (k) => tx("readwrite", (s) => s.delete(k));
  const allKeys = () => tx("readonly", (s) => s.getAllKeys());
  /** A full disk or a tight browser quota surfaces as QuotaExceededError; say so in plain words. */
  async function putRec(k, v) {
    try { return await tx("readwrite", (s) => s.put(v, k)); }
    catch (e) {
      const quota = e && (e.name === "QuotaExceededError" || /quota/i.test(e.message || ""));
      if (!quota) throw e;
      let free = "";
      try { const est = await navigator.storage.estimate(); if (est && est.quota) free = " (" + ((est.quota - (est.usage || 0)) / 1048576).toFixed(0) + " MB free of " + (est.quota / 1073741824).toFixed(1) + " GB)"; } catch (_) {}
      const err = new Error("Not enough browser storage to keep " + (v && v.name ? v.name : "this file") + free + ". Forget a stored ROM you no longer need, or free disk space, then pick it again.");
      err.quota = true;
      throw err;
    }
  }

  /** Normalise "kof2002 (1).zip" -> "kof2002.zip". */
  function canonicalName(fileName) {
    return String(fileName || "").trim().toLowerCase()
      .replace(/\s*\(\d+\)(?=\.zip$)/, "")
      .replace(/\s+/g, "");
  }

  /** Pure: which of the game's files (own set, parent set) are not among the
      picked file names. Used for "now also pick sfiii3.zip". */
  function missingPieces(game, pickedNames) {
    const have = new Set(pickedNames.map(canonicalName));
    const need = [];
    if (!have.has(game.rom.file)) need.push(game.rom.file);
    if (game.rom.parent && !have.has(game.rom.parent + ".zip")) need.push(game.rom.parent + ".zip");
    return need;
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
    missingPieces,

    /** Stored set for a game, or null. Drops records that no longer pass the manifest. */
    async get(game) {
      await migrate();
      let rec;
      try { rec = await getRec(romKey(game.id)); } catch (e) { console.error("ROM store:", e.message || e); return null; }
      if (!rec || !(rec.blob instanceof Blob) || !rec.blob.size) {
        // Missing, or a damaged record (an interrupted write, a cleared blob): drop it so the player is asked again.
        if (rec) { try { await delRec(romKey(game.id)); } catch (_) {} }
        return null;
      }
      if (rec.manifestOk !== true) {
        const r = await TSL.ZipCheck.check(rec.blob, game.rom).catch(() => ({ ok: false }));
        if (!r.ok) { await delRec(romKey(game.id)); return null; }
        rec.manifestOk = true;
        try { await putRec(romKey(game.id), rec); } catch (_) { /* keeping the flag is a nicety */ }
      }
      return toFile(rec);
    },

    async getBios(game) {
      if (!game.bios) return null;
      let rec;
      try { rec = await getRec(biosKey(game.bios.id)); } catch (e) { console.error("ROM store:", e.message || e); return null; }
      if (rec && !(rec.blob instanceof Blob && rec.blob.size)) { try { await delRec(biosKey(game.bios.id)); } catch (_) {} return null; }
      return toFile(rec);
    },

    /** Take whatever zips the player picked for `game`, in any order and across
        several picks: the game's own set, Fightcade's split clone + parent pair
        (e.g. sfiii3nr1.zip + sfiii3.zip), and/or the BIOS. Pieces are kept in
        memory until they add up to the full set, which is then assembled in the
        browser and stored. Returns { stored: [names], need: [file hints], notes: [] }. */
    async addFiles(game, files) {
      const out = { stored: [], need: [], notes: [] };
      const parts = pending.get(game.id) || [];
      for (const file of files) {
        const name = canonicalName(file.name);
        if (game.bios && name === game.bios.file) {
          const r = await TSL.ZipCheck.check(file, game.bios);
          if (!r.ok) { out.notes.push(describeMissing(r.missing, game.bios, "This " + game.bios.file)); continue; }
          try { await putRec(biosKey(game.bios.id), { name, size: file.size, savedAt: Date.now(), blob: file }); }
          catch (e) { out.notes.push(e.message); continue; }
          out.stored.push(name);
          continue;
        }
        let r;
        try { r = await TSL.ZipCheck.check(file, game.rom); }
        catch (_) { out.notes.push((file.name || "That file") + " is not a zip file."); continue; }
        if (r.present === 0) {
          const other = TSL.Games.all().find((g) => g.id !== game.id && g.rom.file === name);
          out.notes.push(other
            ? name + " is " + other.name + ", not " + game.name + ". Pick that game at the top first."
            : (file.name || "That file") + " holds none of " + game.name + "'s files.");
          continue;
        }
        if (!parts.some((f) => f.name === file.name && f.size === file.size)) parts.push(file);
      }
      pending.set(game.id, parts);
      if (!parts.length) return out;

      const merged = await TSL.ZipCheck.merge(parts, game.rom, game.rom.file);
      if (merged.blob) {
        try { await putRec(romKey(game.id), { name: game.rom.file, size: merged.blob.size, savedAt: Date.now(), blob: merged.blob, manifestOk: true }); }
        catch (e) { out.notes.push(e.message); return out; }   // pieces stay pending for a retry
        pending.delete(game.id);
        out.stored.push(parts.length > 1 ? parts.map((f) => canonicalName(f.name)).join(" + ") : game.rom.file);
        return out;
      }
      // Still incomplete: say which file is most likely missing.
      out.need.push(...missingPieces(game, parts.map((f) => f.name)));
      if (!out.need.length) out.notes.push("Still missing " + merged.missing.length + " of " + game.rom.members.length + " files (" + merged.missing.slice(0, 4).join(", ") + (merged.missing.length > 4 ? " ..." : "") + "). These zips may be a different revision than " + game.rom.file + ".");
      return out;
    },

    async clear(game) {
      await delRec(romKey(game.id));
    },

    /** Every stored zip: [{ key, name, size, savedAt }], games and BIOS alike. */
    async list() {
      await migrate();
      const keys = (await allKeys()) || [];
      const out = [];
      for (const key of keys) {
        if (typeof key !== "string" || !(key.startsWith("rom:") || key.startsWith("bios:"))) continue;
        const rec = await getRec(key);
        if (rec && rec.blob) out.push({ key, name: rec.name, size: rec.size || rec.blob.size, savedAt: rec.savedAt });
      }
      return out;
    },

    /** Remove every stored game and BIOS zip (and any half-picked pieces). */
    async clearAll() {
      const keys = (await allKeys()) || [];
      for (const key of keys) if (typeof key === "string" && (key.startsWith("rom:") || key.startsWith("bios:"))) await delRec(key);
      pending.clear();
    }
  };
})();
