// Builds real zip archives in memory for tests (deflate or store, optional
// encrypted flag, optional zip64 marker). Uses only node:zlib.
import zlib from "node:zlib";

/** entries: [{ name, data: Buffer|string, method?: 0|8, encrypted?: bool }] */
export function makeZip(entries, { zip64 = false } = {}) {
  const locals = [], centrals = [];
  let offset = 0;
  for (const e of entries) {
    const data = Buffer.isBuffer(e.data) ? e.data : Buffer.from(e.data);
    const method = e.method ?? 8;
    const comp = method === 8 ? zlib.deflateRawSync(data) : data;
    const crc = zlib.crc32(data);
    const name = Buffer.from(e.name);
    const flags = e.encrypted ? 1 : 0;
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(flags, 6); lh.writeUInt16LE(method, 8);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(name.length, 26);
    locals.push(lh, name, comp);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(flags, 8); c.writeUInt16LE(method, 10);
    c.writeUInt32LE(crc, 16); c.writeUInt32LE(comp.length, 20); c.writeUInt32LE(data.length, 24); c.writeUInt16LE(name.length, 28);
    c.writeUInt32LE(offset, 42);
    centrals.push(c, name);
    offset += 30 + name.length + comp.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(zip64 ? 0xffffffff : offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

/** Manifest member for test data, as web/games/*.json lists it. */
export function member(name, data) {
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
  return { name, size: buf.length, crc32: zlib.crc32(buf).toString(16).padStart(8, "0") };
}

/** read(offset, length) over a Buffer, as zipcore expects. */
export const bufReader = (buf) => async (o, l) => new Uint8Array(buf.subarray(o, o + l));

/** Reads every entry back with Node's own inflate and returns { name: Buffer }. */
export function unzipAll(buf) {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = buf.readUInt16LE(eocd + 10), cdOffset = buf.readUInt32LE(eocd + 16);
  const out = {};
  let p = cdOffset;
  for (let i = 0; i < count; i++) {
    const method = buf.readUInt16LE(p + 10), comp = buf.readUInt32LE(p + 20), crc = buf.readUInt32LE(p + 16);
    const nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(start, start + comp);
    const data = method === 8 ? zlib.inflateRawSync(raw) : Buffer.from(raw);
    if (zlib.crc32(data) !== crc) throw new Error("CRC mismatch in " + name);
    out[name] = data;
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}
