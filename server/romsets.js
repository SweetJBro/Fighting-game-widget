/* Packaged romsets for server/serve.js.

   ROMS_DIR can be a plain folder of complete sets, or Fightcade's own ROM folder
   (ROMs/fbneo), where clones are split from their parent: sfiii3nr1.zip needs
   sfiii3.zip, ssf2xjr1.zip needs ssf2t.zip. Each game's set is checked against
   its manifest (web/games/<id>.json, files matched by size + CRC32). A complete
   zip is served as is; a split pair is assembled in memory into one zip by
   copying the compressed entries (no recompression), exactly as the browser
   does in games.js. Incomplete sets are not advertised. */
"use strict";
const fs = require("fs");
const path = require("path");

function readCentral(file) {
  const fd = fs.openSync(file, "r");
  try {
    const size = fs.fstatSync(fd).size;
    const tailLen = Math.min(size, 65536 + 22);
    const tail = Buffer.alloc(tailLen);
    fs.readSync(fd, tail, 0, tailLen, size - tailLen);
    let eocd = -1;
    for (let i = tailLen - 22; i >= 0; i--) if (tail.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) return [];
    const count = tail.readUInt16LE(eocd + 10), cdSize = tail.readUInt32LE(eocd + 12), cdOffset = tail.readUInt32LE(eocd + 16);
    if (cdOffset === 0xffffffff) return [];
    const cd = Buffer.alloc(cdSize);
    fs.readSync(fd, cd, 0, cdSize, cdOffset);
    const out = [];
    let p = 0;
    for (let n = 0; n < count && p + 46 <= cd.length; n++) {
      if (cd.readUInt32LE(p) !== 0x02014b50) break;
      const nameLen = cd.readUInt16LE(p + 28), extraLen = cd.readUInt16LE(p + 30), commentLen = cd.readUInt16LE(p + 32);
      const name = cd.toString("utf8", p + 46, p + 46 + nameLen);
      if (!name.endsWith("/")) out.push({
        file, name, flags: cd.readUInt16LE(p + 8), method: cd.readUInt16LE(p + 10),
        time: cd.readUInt16LE(p + 12), date: cd.readUInt16LE(p + 14), crc: cd.readUInt32LE(p + 16),
        compSize: cd.readUInt32LE(p + 20), size: cd.readUInt32LE(p + 24), offset: cd.readUInt32LE(p + 42)
      });
      p += 46 + nameLen + extraLen + commentLen;
    }
    return out;
  } catch (_) { return []; } finally { fs.closeSync(fd); }
}

const sig = (size, crc) => size + ":" + (crc >>> 0);
function poolOf(files) {
  const pool = new Map();
  for (const f of files) for (const e of readCentral(f)) {
    const k = sig(e.size, e.crc);
    if (!pool.has(k) && !(e.flags & 1)) pool.set(k, e);
  }
  return pool;
}
const missingFrom = (pool, members) => members.filter((m) => !pool.has(sig(m.size, parseInt(m.crc32, 16))));

function assemble(pool, members) {
  const parts = [], central = [];
  let offset = 0;
  const fds = new Map();
  try {
    for (const m of members) {
      const e = pool.get(sig(m.size, parseInt(m.crc32, 16)));
      if (!fds.has(e.file)) fds.set(e.file, fs.openSync(e.file, "r"));
      const fd = fds.get(e.file);
      const lh = Buffer.alloc(30);
      fs.readSync(fd, lh, 0, 30, e.offset);
      if (lh.readUInt32LE(0) !== 0x04034b50) throw new Error("damaged entry " + e.name + " in " + e.file);
      const dataStart = e.offset + 30 + lh.readUInt16LE(26) + lh.readUInt16LE(28);
      const data = Buffer.alloc(e.compSize);
      fs.readSync(fd, data, 0, e.compSize, dataStart);
      const name = Buffer.from(m.name, "utf8");
      const h = Buffer.alloc(30);
      h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(e.method, 8);
      h.writeUInt16LE(e.time, 10); h.writeUInt16LE(e.date, 12); h.writeUInt32LE(e.crc >>> 0, 14);
      h.writeUInt32LE(e.compSize, 18); h.writeUInt32LE(e.size, 22); h.writeUInt16LE(name.length, 26);
      parts.push(h, name, data);
      const c = Buffer.alloc(46);
      c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(e.method, 10);
      c.writeUInt16LE(e.time, 12); c.writeUInt16LE(e.date, 14); c.writeUInt32LE(e.crc >>> 0, 16);
      c.writeUInt32LE(e.compSize, 20); c.writeUInt32LE(e.size, 24); c.writeUInt16LE(name.length, 28); c.writeUInt32LE(offset, 42);
      central.push(c, name);
      offset += 30 + name.length + e.compSize;
    }
  } finally { for (const fd of fds.values()) fs.closeSync(fd); }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(members.length, 8); end.writeUInt16LE(members.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cd, end]);
}

const cache = new Map();   // key -> { stamp, result }
function stampOf(files) {
  return files.map((f) => { try { const s = fs.statSync(f); return f + ":" + s.size + ":" + s.mtimeMs; } catch (_) { return f + ":-"; } }).join("|");
}

/** For one game: { kind: "file", file, size, mtimeMs } | { kind: "buffer", buffer, size, mtimeMs } | null. */
function resolveSet(dir, game) {
  const own = path.join(dir, game.rom.file);
  const parent = game.rom.parent ? path.join(dir, game.rom.parent + ".zip") : null;
  const files = [own, parent].filter((f) => f && fs.existsSync(f));
  if (!fs.existsSync(own)) return null;
  const stamp = stampOf(files);
  const key = "rom:" + game.id;
  const hit = cache.get(key);
  if (hit && hit.stamp === stamp) return hit.result;
  let result = null;
  const ownPool = poolOf([own]);
  const mtimeMs = Math.max(...files.map((f) => fs.statSync(f).mtimeMs));
  if (!missingFrom(ownPool, game.rom.members).length) {
    const st = fs.statSync(own);
    result = { kind: "file", file: own, size: st.size, mtimeMs: st.mtimeMs };
  } else {
    const pool = poolOf(files);
    const missing = missingFrom(pool, game.rom.members);
    if (!missing.length) {
      const buffer = assemble(pool, game.rom.members);
      result = { kind: "buffer", buffer, size: buffer.length, mtimeMs };
      console.log(`packaged ${game.id}: assembled ${(buffer.length / 1048576).toFixed(1)} MB from ${files.map((f) => path.basename(f)).join(" + ")}`);
    } else {
      console.log(`packaged ${game.id}: ${path.basename(own)} is incomplete (${missing.length} of ${game.rom.members.length} files missing${parent && !fs.existsSync(parent) ? "; " + path.basename(parent) + " not found" : ""}), not advertised`);
    }
  }
  cache.set(key, { stamp, result });
  return result;
}

/** BIOS zip: served as is when it has the files the game requires. */
function resolveBios(dir, game) {
  const file = path.join(dir, game.bios.file);
  if (!fs.existsSync(file)) return null;
  const stamp = stampOf([file]);
  const key = "bios:" + game.bios.id;
  const hit = cache.get(key);
  if (hit && hit.stamp === stamp) return hit.result;
  const need = game.bios.required ? game.bios.members.filter((m) => game.bios.required.includes(m.name)) : game.bios.members;
  const st = fs.statSync(file);
  const result = missingFrom(poolOf([file]), need).length ? null : { kind: "file", file, size: st.size, mtimeMs: st.mtimeMs };
  cache.set(key, { stamp, result });
  return result;
}

module.exports = { resolveSet, resolveBios };
