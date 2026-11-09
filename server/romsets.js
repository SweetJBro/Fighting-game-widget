/* Packaged romsets for server/serve.js (Node side of web/js/zipcore.js).

   ROMS_DIR can be a plain folder of complete sets, or Fightcade's own ROM folder
   (ROMs/fbneo), where clones are split from their parent: sfiii3nr1.zip needs
   sfiii3.zip, ssf2xjr1.zip needs ssf2t.zip. Each game's set is checked against
   its manifest (web/games/<id>.json, files matched by size + CRC32). A complete
   zip is served as is; a split pair is assembled in memory into one zip by
   copying the compressed entries (no recompression), exactly as the browser
   does. Incomplete sets are not advertised. */
"use strict";
const fs = require("fs");
const path = require("path");
const ZipCore = require("../web/js/zipcore.js");
const log = require("./log");

function fileReader(file) {
  return async (offset, length) => {
    const fd = fs.openSync(file, "r");
    try {
      const buf = Buffer.alloc(length);
      fs.readSync(fd, buf, 0, length, offset);
      return new Uint8Array(buf.buffer, buf.byteOffset, buf.length);
    } finally { fs.closeSync(fd); }
  };
}

async function source(file) {
  const read = fileReader(file);
  try { return { file, read, entries: await ZipCore.readEntries(read, fs.statSync(file).size) }; }
  catch (_) { return { file, read, entries: [] }; }
}

async function materialize(plan) {
  const bufs = [];
  for (const p of plan.parts) {
    if (p instanceof Uint8Array) bufs.push(Buffer.from(p));
    else bufs.push(Buffer.from(await p.source.read(p.start, p.length)));
  }
  return Buffer.concat(bufs);
}

const cache = new Map();   // key -> { stamp, result }
function stampOf(files) {
  return files.map((f) => { try { const s = fs.statSync(f); return f + ":" + s.size + ":" + s.mtimeMs; } catch (_) { return f + ":-"; } }).join("|");
}

/** For one game: { kind: "file", file, size, mtimeMs } | { kind: "buffer", buffer, size, mtimeMs } | null. */
async function resolveSet(dir, game) {
  const own = path.join(dir, game.rom.file);
  if (!fs.existsSync(own)) return null;
  const parent = game.rom.parent ? path.join(dir, game.rom.parent + ".zip") : null;
  const files = [own, parent].filter((f) => f && fs.existsSync(f));
  const stamp = stampOf(files);
  const key = "rom:" + game.id;
  const hit = cache.get(key);
  if (hit && hit.stamp === stamp) return hit.result;

  let result = null;
  const sources = await Promise.all(files.map(source));
  const mtimeMs = Math.max(...files.map((f) => fs.statSync(f).mtimeMs));
  if (!ZipCore.missingMembers(sources[0].entries, game.rom.members).length) {
    const st = fs.statSync(own);
    result = { kind: "file", file: own, size: st.size, mtimeMs: st.mtimeMs };
  } else {
    const plan = await ZipCore.assemble(sources, game.rom.members);
    if (!plan.missing.length) {
      const buffer = await materialize(plan);
      result = { kind: "buffer", buffer, size: buffer.length, mtimeMs };
      log.info("packaged_assembled", { game: game.id, mb: +(buffer.length / 1048576).toFixed(1), from: files.map((f) => path.basename(f)) });
    } else {
      log.warn("packaged_incomplete", { game: game.id, file: path.basename(own), missing: plan.missing.length,
        total: game.rom.members.length, parentFound: !parent || fs.existsSync(parent) });
    }
  }
  cache.set(key, { stamp, result });
  return result;
}

/** BIOS zip: served as is when it has the files the game requires. */
async function resolveBios(dir, game) {
  const file = path.join(dir, game.bios.file);
  if (!fs.existsSync(file)) return null;
  const stamp = stampOf([file]);
  const key = "bios:" + game.bios.id;
  const hit = cache.get(key);
  if (hit && hit.stamp === stamp) return hit.result;
  const st = fs.statSync(file);
  const { entries } = await source(file);
  const result = ZipCore.check(entries, game.bios).ok ? { kind: "file", file, size: st.size, mtimeMs: st.mtimeMs } : null;
  cache.set(key, { stamp, result });
  return result;
}

module.exports = { resolveSet, resolveBios };
