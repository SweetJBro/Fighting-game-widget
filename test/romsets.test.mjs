import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { makeZip, member, unzipAll } from "./helpers/zipmaker.mjs";
process.env.LOG_FORMAT = "text";
const romsets = createRequire(import.meta.url)("../server/romsets.js");

const A = "clone ".repeat(500), B = "parent ".repeat(800);
const game = { id: "testclone", rom: { file: "testclone.zip", parent: "testparent", members: [member("a.bin", A), member("b.bin", B)] },
  bios: { id: "testbios", file: "testbios.zip", members: [member("b1", "x"), member("b2", "y")], required: ["b1"] } };
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "romsets-"));

test("complete set on disk is served as the file itself", async () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, "testclone.zip"), makeZip([{ name: "a.bin", data: A }, { name: "b.bin", data: B }]));
  const r = await romsets.resolveSet(dir, game);
  assert.equal(r.kind, "file");
});

test("Fightcade-style split pair is assembled in memory into a valid full set", async () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, "testclone.zip"), makeZip([{ name: "a.bin", data: A }]));
  fs.writeFileSync(path.join(dir, "testparent.zip"), makeZip([{ name: "b.bin", data: B }]));
  const r = await romsets.resolveSet(dir, game);
  assert.equal(r.kind, "buffer");
  const files = unzipAll(r.buffer);
  assert.equal(files["a.bin"].toString(), A);
  assert.equal(files["b.bin"].toString(), B);
});

test("clone without its parent is not advertised", async () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, "testclone.zip"), makeZip([{ name: "a.bin", data: A }]));
  assert.equal(await romsets.resolveSet(dir, game), null);
});

test("result is cached until a file changes", async () => {
  const dir = tmp();
  const f = path.join(dir, "testclone.zip");
  fs.writeFileSync(f, makeZip([{ name: "a.bin", data: A }]));
  assert.equal(await romsets.resolveSet(dir, game), null);
  fs.writeFileSync(path.join(dir, "testparent.zip"), makeZip([{ name: "b.bin", data: B }]));
  assert.equal((await romsets.resolveSet(dir, game)).kind, "buffer");
});

test("BIOS needs only its required files", async () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, "testbios.zip"), makeZip([{ name: "b1", data: "x" }]));
  assert.equal((await romsets.resolveBios(dir, game)).kind, "file");
  fs.writeFileSync(path.join(dir, "testbios.zip"), makeZip([{ name: "b2", data: "y" }]));
  assert.equal(await romsets.resolveBios(dir, game), null);
});
