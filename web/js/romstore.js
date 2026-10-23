/* Stores the player's own romset in IndexedDB. Nothing leaves the browser. */
window.TSL = window.TSL || {};

TSL.RomStore = (() => {
  const DB = "tsl-rom", STORE = "rom", KEY = "current";
  const SET_RE = /^(sfiii3|sfiii3r1|sfiii3n|sfiii3nr1)\.zip$/i;
  const MIN_SIZE = 60 * 1024 * 1024;   // anything smaller is a split clone set

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

  /** Normalise "sfiii3nr1 (1).zip" -> "sfiii3nr1.zip"; null when not a 3S set. */
  function canonicalName(fileName) {
    const base = String(fileName || "").trim().toLowerCase()
      .replace(/\s*\(\d+\)(?=\.zip$)/, "")
      .replace(/\s+/g, "");
    return SET_RE.test(base) ? base : null;
  }

  const VERSIONS = {
    "sfiii3nr1.zip": "Japan 990512 NO CD, the set Fightcade runs",
    "sfiii3n.zip": "Japan 990608 NO CD",
    "sfiii3r1.zip": "Euro 990512",
    "sfiii3.zip": "Euro 990608"
  };

  return {
    canonicalName,
    describe(name) { return VERSIONS[String(name || "").toLowerCase()] || ""; },
    MIN_SIZE,
    async get() {
      const rec = await tx("readonly", (s) => s.get(KEY));
      if (!rec || !rec.blob) return null;
      // A split set stored before the size check existed cannot boot; drop it.
      if (rec.size < MIN_SIZE) { await tx("readwrite", (s) => s.delete(KEY)); return null; }
      return { name: rec.name, size: rec.size, savedAt: rec.savedAt,
               file: new File([rec.blob], rec.name, { type: "application/zip" }) };
    },
    async put(file) {
      const name = canonicalName(file.name);
      if (!name) throw new Error("Not a 3rd Strike set. Expected sfiii3nr1.zip, sfiii3n.zip, sfiii3r1.zip or sfiii3.zip.");
      if (file.size < MIN_SIZE) throw new Error("That looks like a split clone set (" + (file.size / 1048576).toFixed(1) + " MB). The browser needs one merged zip of roughly 65-80 MB; see scripts/merge-romset.py.");
      await tx("readwrite", (s) => s.put({ name, size: file.size, savedAt: Date.now(), blob: file }, KEY));
      return name;
    },
    async clear() { await tx("readwrite", (s) => s.delete(KEY)); }
  };
})();
