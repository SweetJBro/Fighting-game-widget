import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

// romstore.js only touches IndexedDB inside its async methods, so its pure
// helpers load fine in a bare context.
const ctx = { console, Blob, File, TextDecoder, TextEncoder };
ctx.window = ctx; ctx.self = ctx; vm.createContext(ctx);
vm.runInContext(fs.readFileSync(new URL("../web/js/romstore.js", import.meta.url), "utf8"), ctx);
const { canonicalName } = ctx.TSL.RomStore;
// Arrays from the vm context have another realm's prototype; copy them for deepEqual.
const missingPieces = (...a) => [...ctx.TSL.RomStore.missingPieces(...a)];
const sf3 = JSON.parse(fs.readFileSync(new URL("../web/games/sfiii3nr1.json", import.meta.url), "utf8"));
const kof = JSON.parse(fs.readFileSync(new URL("../web/games/kof2002.json", import.meta.url), "utf8"));

test("canonicalName lower-cases and drops browser download suffixes", () => {
  assert.equal(canonicalName("SFIII3NR1.ZIP"), "sfiii3nr1.zip");
  assert.equal(canonicalName("sfiii3nr1 (1).zip"), "sfiii3nr1.zip");
});

test("after picking Fightcade's clone, it asks for the parent (and vice versa)", () => {
  assert.deepEqual(missingPieces(sf3, ["sfiii3nr1.zip"]), ["sfiii3.zip"]);
  assert.deepEqual(missingPieces(sf3, ["sfiii3.zip"]), ["sfiii3nr1.zip"]);
  assert.deepEqual(missingPieces(sf3, ["sfiii3nr1.zip", "sfiii3.zip"]), []);
});

test("games without a parent only ask for their own set", () => {
  assert.deepEqual(missingPieces(kof, []), ["kof2002.zip"]);
  assert.deepEqual(missingPieces(kof, ["kof2002.zip"]), []);
});
