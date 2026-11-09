/* Zip central-directory reading, manifest checking and split-set assembly,
   shared by the browser (web/js/games.js, Blob reads) and the server
   (server/romsets.js, file reads). Pure: all I/O goes through a
   `read(offset, length) -> Promise<Uint8Array>` callback.

   Why assembly exists: Fightcade keeps clones split from their parent
   (sfiii3nr1.zip needs sfiii3.zip). FBNeo inside EmulatorJS cannot load a
   parent zip, so the clone's files and the parent's shared files are combined
   into one zip by copying each compressed entry as is (no inflate/deflate). */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else { root.TSL = root.TSL || {}; root.TSL.ZipCore = api; }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const SIG_EOCD = 0x06054b50, SIG_CENTRAL = 0x02014b50, SIG_LOCAL = 0x04034b50;
  const dv = (u8) => new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const sig = (size, crc) => size + ":" + (crc >>> 0);
  const memberSig = (m) => sig(m.size, parseInt(m.crc32, 16));

  /** @typedef {{name:string,size:number,crc:number,compSize:number,method:number,flags:number,time:number,date:number,offset:number}} Entry */

  /** Reads the central directory. Throws on non-zips and zip64 archives. @returns {Promise<Entry[]>} */
  async function readEntries(read, size) {
    const tailLen = Math.min(size, 65536 + 22);
    if (tailLen < 22) throw new Error("not a zip file");
    const tail = dv(await read(size - tailLen, tailLen));
    let eocd = -1;
    for (let i = tailLen - 22; i >= 0; i--) if (tail.getUint32(i, true) === SIG_EOCD) { eocd = i; break; }
    if (eocd < 0) throw new Error("not a zip file");
    const count = tail.getUint16(eocd + 10, true);
    const cdSize = tail.getUint32(eocd + 12, true);
    const cdOffset = tail.getUint32(eocd + 16, true);
    if (cdOffset === 0xffffffff || count === 0xffff) throw new Error("zip64 archives are not supported");
    const raw = await read(cdOffset, cdSize);
    const cd = dv(raw);
    const dec = new TextDecoder();
    const out = [];
    let p = 0;
    for (let n = 0; n < count && p + 46 <= cd.byteLength; n++) {
      if (cd.getUint32(p, true) !== SIG_CENTRAL) break;
      const nameLen = cd.getUint16(p + 28, true), extraLen = cd.getUint16(p + 30, true), commentLen = cd.getUint16(p + 32, true);
      const name = dec.decode(raw.subarray(p + 46, p + 46 + nameLen));
      if (!name.endsWith("/")) out.push({
        name,
        flags: cd.getUint16(p + 8, true), method: cd.getUint16(p + 10, true),
        time: cd.getUint16(p + 12, true), date: cd.getUint16(p + 14, true),
        crc: cd.getUint32(p + 16, true) >>> 0, compSize: cd.getUint32(p + 20, true),
        size: cd.getUint32(p + 24, true), offset: cd.getUint32(p + 42, true)
      });
      p += 46 + nameLen + extraLen + commentLen;
    }
    return out;
  }

  /** Which manifest members are absent from `entries` (matched by size + CRC32, as FBNeo does). */
  function missingMembers(entries, members) {
    const have = new Set(entries.map((e) => sig(e.size, e.crc)));
    return members.filter((m) => !have.has(memberSig(m))).map((m) => m.name);
  }

  /** { ok, missing, present, total } for a spec ({members, required?}). */
  function check(entries, spec) {
    const need = spec.required ? spec.members.filter((m) => spec.required.includes(m.name)) : spec.members;
    const missing = missingMembers(entries, need);
    return { ok: missing.length === 0, missing, present: need.length - missing.length, total: need.length };
  }

  /** Plans one zip holding `members`, taking each from the first source that has it.
      sources: [{ id, read, entries }]. Encrypted entries are never used.
      Returns { missing, parts, size } where parts are Uint8Array headers or
      { source, start, length } references to compressed data in a source. */
  async function assemble(sources, members) {
    const pool = new Map();
    for (const src of sources) for (const e of src.entries) {
      const k = sig(e.size, e.crc);
      if (!pool.has(k) && !(e.flags & 1)) pool.set(k, { src, e });
    }
    const missing = members.filter((m) => !pool.has(memberSig(m))).map((m) => m.name);
    if (missing.length) return { missing, parts: [], size: 0 };

    const enc = new TextEncoder();
    const parts = [], central = [];
    let offset = 0;
    for (const m of members) {
      const { src, e } = pool.get(memberSig(m));
      // The local header's own name/extra lengths decide where the data starts.
      const lh = dv(await src.read(e.offset, 30));
      if (lh.getUint32(0, true) !== SIG_LOCAL) throw new Error("damaged zip entry " + e.name);
      const dataStart = e.offset + 30 + lh.getUint16(26, true) + lh.getUint16(28, true);
      const name = enc.encode(m.name);

      const h = new Uint8Array(30), hv = dv(h);
      hv.setUint32(0, SIG_LOCAL, true); hv.setUint16(4, 20, true);
      hv.setUint16(8, e.method, true); hv.setUint16(10, e.time, true); hv.setUint16(12, e.date, true);
      hv.setUint32(14, e.crc, true); hv.setUint32(18, e.compSize, true); hv.setUint32(22, e.size, true);
      hv.setUint16(26, name.length, true);
      parts.push(h, name, { source: src, start: dataStart, length: e.compSize });

      const c = new Uint8Array(46), cv = dv(c);
      cv.setUint32(0, SIG_CENTRAL, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true);
      cv.setUint16(10, e.method, true); cv.setUint16(12, e.time, true); cv.setUint16(14, e.date, true);
      cv.setUint32(16, e.crc, true); cv.setUint32(20, e.compSize, true); cv.setUint32(24, e.size, true);
      cv.setUint16(28, name.length, true); cv.setUint32(42, offset, true);
      central.push(c, name);
      offset += 30 + name.length + e.compSize;
    }
    const cdSize = central.reduce((n, b) => n + b.length, 0);
    const end = new Uint8Array(22), ev = dv(end);
    ev.setUint32(0, SIG_EOCD, true);
    ev.setUint16(8, members.length, true); ev.setUint16(10, members.length, true);
    ev.setUint32(12, cdSize, true); ev.setUint32(16, offset, true);
    parts.push(...central, end);
    return { missing: [], parts, size: offset + cdSize + 22 };
  }

  return { readEntries, missingMembers, check, assemble };
});
