import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { makeZip, member, bufReader, unzipAll } from "./helpers/zipmaker.mjs";
const ZipCore = createRequire(import.meta.url)("../web/js/zipcore.js");

const A = "clone-only data ".repeat(200), B = "shared parent data ".repeat(300), C = "more shared ".repeat(150);
const manifest = [member("clone.a", A), member("shared.b", B), member("shared.c", C)];
const entriesOf = (buf) => ZipCore.readEntries(bufReader(buf), buf.length);

test("reads names, sizes and CRCs from the central directory", async () => {
  const zip = makeZip([{ name: "x.bin", data: "hello" }, { name: "dir/", data: "", method: 0 }]);
  const e = await entriesOf(zip);
  assert.equal(e.length, 1, "directory entries are skipped");
  assert.equal(e[0].name, "x.bin");
  assert.equal(e[0].size, 5);
});

test("complete set passes, incomplete set lists what is missing", async () => {
  const full = await entriesOf(makeZip([{ name: "clone.a", data: A }, { name: "shared.b", data: B }, { name: "shared.c", data: C }]));
  assert.deepEqual(ZipCore.check(full, { members: manifest }), { ok: true, missing: [], present: 3, total: 3 });
  const part = await entriesOf(makeZip([{ name: "clone.a", data: A }]));
  const r = ZipCore.check(part, { members: manifest });
  assert.equal(r.ok, false);
  assert.deepEqual(r.missing, ["shared.b", "shared.c"]);
});

test("matching is by size + CRC, not by name (renamed files count, wrong revisions do not)", async () => {
  const renamed = await entriesOf(makeZip([{ name: "CLONE_A.BIN", data: A }]));
  assert.deepEqual(ZipCore.missingMembers(renamed, manifest), ["shared.b", "shared.c"]);
  const wrongRev = await entriesOf(makeZip([{ name: "clone.a", data: A.replace("c", "k") }]));
  assert.deepEqual(ZipCore.missingMembers(wrongRev, manifest).includes("clone.a"), true);
});

test("required subset (BIOS) only needs the listed files", async () => {
  const bios = await entriesOf(makeZip([{ name: "shared.b", data: B }]));
  assert.equal(ZipCore.check(bios, { members: manifest, required: ["shared.b"] }).ok, true);
});

test("clone + parent assemble into one valid zip with every member intact", async () => {
  const clone = makeZip([{ name: "clone.a", data: A }]);
  const parent = makeZip([{ name: "shared.b", data: B, method: 0 }, { name: "shared.c", data: C }, { name: "unused.z", data: "z" }]);
  const sources = await Promise.all([clone, parent].map(async (buf) => ({ buf, read: bufReader(buf), entries: await entriesOf(buf) })));
  const plan = await ZipCore.assemble(sources, manifest);
  assert.deepEqual(plan.missing, []);
  const out = Buffer.concat(plan.parts.map((p) => (p instanceof Uint8Array ? Buffer.from(p) : p.source.buf.subarray(p.start, p.start + p.length))));
  assert.equal(out.length, plan.size);
  const files = unzipAll(out);
  assert.deepEqual(Object.keys(files), ["clone.a", "shared.b", "shared.c"]);
  assert.equal(files["clone.a"].toString(), A);
  assert.equal(files["shared.b"].toString(), B);
  const reread = await entriesOf(out);
  assert.equal(ZipCore.check(reread, { members: manifest }).ok, true);
});

test("assembly reports missing members instead of building a partial zip", async () => {
  const clone = makeZip([{ name: "clone.a", data: A }]);
  const plan = await ZipCore.assemble([{ read: bufReader(clone), entries: await entriesOf(clone) }], manifest);
  assert.deepEqual(plan.missing, ["shared.b", "shared.c"]);
  assert.equal(plan.parts.length, 0);
});

test("encrypted entries are never used", async () => {
  const enc = makeZip([{ name: "clone.a", data: A, encrypted: true }, { name: "shared.b", data: B }, { name: "shared.c", data: C }]);
  const plan = await ZipCore.assemble([{ read: bufReader(enc), entries: await entriesOf(enc) }], manifest);
  assert.deepEqual(plan.missing, ["clone.a"]);
});

test("zip64 archives and non-zips are rejected", async () => {
  await assert.rejects(entriesOf(makeZip([{ name: "a", data: "a" }], { zip64: true })), /zip64/);
  await assert.rejects(entriesOf(Buffer.from("definitely not a zip file, just text")), /not a zip/);
  await assert.rejects(entriesOf(Buffer.alloc(5)), /not a zip/);
});
