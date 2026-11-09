import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const P = createRequire(import.meta.url)("../web/js/pad-logic.js");

const pad = (id, index, mapping = "standard", extra = {}) => ({ id, index, mapping, buttons: [], axes: [], ...extra });
const STICK = pad("Qanba Q4 Pro-X (STANDARD GAMEPAD Vendor: 2c22 Product: 2300)", 0);
const STEAM2 = pad("Microsoft X-Box 360 pad 2 (STANDARD GAMEPAD Vendor: 045e Product: 028e)", 1);
const STEAM0 = pad("Microsoft X-Box 360 pad 0 (STANDARD GAMEPAD Vendor: 045e Product: 028e)", 1);
const ODD = pad("Generic USB Joystick (Vendor: 0079 Product: 0006)", 2, "");
const v = P.selectionValue;

test("looseId ignores Steam's pad number; shortName drops the vendor suffix", () => {
  assert.equal(P.looseId(STEAM2.id), P.looseId(STEAM0.id));
  assert.notEqual(P.looseId(STICK.id), P.looseId(STEAM0.id));
  assert.equal(P.shortName(STICK.id), "Qanba Q4 Pro-X");
});

test("prefFor finds a remembered choice after Steam renumbered the pad", () => {
  assert.equal(P.prefFor({ [STEAM2.id]: 1 }, STEAM0.id), 1);
  assert.equal(P.prefFor({ [STEAM2.id]: 1 }, STICK.id), undefined);
});

test("pickPads: preferred pad wins, else standard pads, else whatever is there", () => {
  assert.deepEqual(P.pickPads([STEAM0, STICK], STICK.id), { pads: [STICK], reason: "preferred" });
  assert.deepEqual(P.pickPads([STEAM0, STICK], STEAM2.id), { pads: [STEAM0], reason: "preferred" }, "renumbered Steam pad still matches");
  assert.deepEqual(P.pickPads([STEAM0, STICK, ODD], null), { pads: [STEAM0, STICK], reason: "standard" }, "non-standard pad ignored");
  assert.deepEqual(P.pickPads([ODD], null), { pads: [ODD], reason: "all" }, "only pad, read it anyway");
  assert.deepEqual(P.pickPads([ODD], ODD.id), { pads: [ODD], reason: "preferred" }, "preferring a non-standard pad forces it");
  assert.deepEqual(P.pickPads([STICK], "Unplugged (Vendor: 1 Product: 2)"), { pads: [STICK], reason: "standard" }, "missing preferred falls back");
  assert.equal(P.pickPads([], null).reason, "none");
});

test("isActive: a held button or a pushed stick", () => {
  assert.equal(P.isActive(pad("x", 0, "standard", { buttons: [{ pressed: true, value: 1 }] })), true);
  assert.equal(P.isActive(pad("x", 0, "standard", { axes: [0, -0.9] })), true);
  assert.equal(P.isActive(pad("x", 0, "standard", { buttons: [{ pressed: false, value: 0 }], axes: [0.1, 0] })), false);
});

test("desiredSelection, local: explicit players place pads, -1 removes one", () => {
  const sel = P.desiredSelection({ selection: [v(STEAM0), v(STICK), "", ""], pads: [STEAM0, STICK], prefs: { [STICK.id]: 0, [STEAM2.id]: 1 }, role: "local" });
  assert.deepEqual(sel, [v(STICK), v(STEAM0), "", ""], "stick is Player 1, Steam pad (renumbered) is Player 2");
  const off = P.desiredSelection({ selection: [v(STEAM0), v(STICK), "", ""], pads: [STEAM0, STICK], prefs: { [STEAM0.id]: -1 }, role: "local" });
  assert.deepEqual(off, ["", v(STICK), "", ""], "not playing: removed, nothing else moves");
});

test("desiredSelection: the preferred pad takes Player 1 unless a dropdown choice says otherwise", () => {
  const pref = P.desiredSelection({ selection: [v(STEAM0), v(STICK), "", ""], pads: [STEAM0, STICK], preferredId: STICK.id, role: "local" });
  assert.deepEqual(pref, [v(STICK), "", "", ""]);
  const explicitWins = P.desiredSelection({ selection: [v(STEAM0), v(STICK), "", ""], pads: [STEAM0, STICK], prefs: { [STEAM0.id]: 0 }, preferredId: STICK.id, role: "local" });
  assert.equal(explicitWins[0], v(STEAM0));
});

test("desiredSelection, online host: one local pad drives Player 1, slots 2-4 stay empty", () => {
  const sel = P.desiredSelection({ selection: [v(STEAM0), v(STICK), "", ""], pads: [STEAM0, STICK], preferredId: STICK.id, role: "host" });
  assert.deepEqual(sel, [v(STICK), "", "", ""], "a second local pad must never drive the remote opponent's Player 2");
  const refill = P.desiredSelection({ selection: ["", "", "", ""], pads: [STEAM0, STICK], prefs: { [STEAM0.id]: -1 }, role: "host" });
  assert.deepEqual(refill, [v(STICK), "", "", ""], "empty Player 1 is filled by the first pad that is allowed to play");
  const same = P.desiredSelection({ selection: [v(STICK), "", "", ""], pads: [STICK], role: "host" });
  assert.deepEqual(same, [v(STICK), "", "", ""], "nothing to change");
});

test("store: round-trips choices and reset removes exactly the controller keys", () => {
  const mem = new Map();
  const storage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, val) => mem.set(k, val), removeItem: (k) => mem.delete(k),
    get length() { return mem.size; }, key: (i) => [...mem.keys()][i] };
  const s = P.store(storage);
  s.setPlayers({ [STICK.id]: 0 }); s.setPreferred(STICK.id);
  storage.setItem("tsl.controls.sfiii3nr1", "{}"); storage.setItem("tsl.name", "jbro"); storage.setItem("tsl.inputDelay", "3");
  assert.deepEqual(s.players(), { [STICK.id]: 0 }); assert.equal(s.preferred(), STICK.id);
  const removed = s.reset().sort();
  assert.deepEqual(removed, ["tsl.controls.sfiii3nr1", "tsl.padPlayers", "tsl.preferredPad"]);
  assert.deepEqual([...mem.keys()].sort(), ["tsl.inputDelay", "tsl.name"], "name and delay survive");
  assert.deepEqual(s.players(), {}); assert.equal(s.preferred(), null);
});
