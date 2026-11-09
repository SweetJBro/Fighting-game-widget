import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const { decideRoster, DelayQueue } = createRequire(import.meta.url)("../web/js/match-logic.js");

const p = (userid, player_name = userid) => ({ userid, player_name });
const guest = (name, matrixId = null) => ({ intent: "guest", name, matrixId });
const spec = (name) => ({ intent: "spectator", name });

test("first joiner who asks to play is Player 2; others watch", () => {
  const r = decideRoster({ present: [p("a"), p("b")], intents: { a: guest("Ann"), b: guest("Bob") } });
  assert.equal(r.guest, "a"); assert.equal(r.guestName, "Ann"); assert.deepEqual(r.spectators, ["Bob"]);
});

test("a spectator who joined first never takes Player 2", () => {
  const r = decideRoster({ present: [p("s"), p("g")], intents: { s: spec("Sam"), g: guest("Gil") } });
  assert.equal(r.guest, "g"); assert.deepEqual(r.spectators, ["Sam"]);
});

test("joiners whose hello has not arrived watch until it does", () => {
  const r = decideRoster({ present: [p("x", "Xena")], intents: {} });
  assert.equal(r.guest, null); assert.deepEqual(r.spectators, ["Xena"]);
});

test("current Player 2 keeps the seat while present, loses it when gone", () => {
  const intents = { a: guest("Ann"), b: guest("Bob") };
  assert.equal(decideRoster({ present: [p("a"), p("b")], intents, currentGuest: "b" }).guest, "b");
  assert.equal(decideRoster({ present: [p("a")], intents, currentGuest: "b" }).guest, "a");
});

test("Matrix reservation: only the expected member can be Player 2", () => {
  const intents = { c: guest("Carol", "@carol:x"), b: guest("Bob", "@bob:x") };
  const before = decideRoster({ present: [p("c")], intents, expectedGuest: "@bob:x" });
  assert.equal(before.guest, null, "Carol asked to play but the challenge named Bob");
  const after = decideRoster({ present: [p("c"), p("b")], intents, expectedGuest: "@bob:x" });
  assert.equal(after.guest, "b"); assert.deepEqual(after.spectators, ["Carol"]);
});

test("a reservation set later (open challenge accepted) unseats a mismatching Player 2", () => {
  const intents = { c: guest("Carol", "@carol:x"), b: guest("Bob", "@bob:x") };
  const r = decideRoster({ present: [p("c"), p("b")], intents, currentGuest: "c", expectedGuest: "@bob:x" });
  assert.equal(r.guest, "b");
});

test("DelayQueue releases each event exactly `delay` frames later", () => {
  for (const delay of [0, 2, 4, 8]) {
    const q = new DelayQueue();
    q.push(100, delay, { index: 1, value: 1 });
    assert.equal(q.due(100 + delay - 1).length, 0, "not one frame early");
    assert.equal(q.due(100 + delay)[0].index, 1, "exactly on time");
    assert.equal(q.size, 0);
  }
});

test("DelayQueue keeps order when the delay is lowered mid-match", () => {
  const q = new DelayQueue();
  q.push(10, 8, { index: 1, value: 1 });   // due at 18
  q.push(11, 0, { index: 1, value: 0 });   // would be 11, must not overtake: due at 18
  assert.equal(q.due(17).length, 0);
  assert.deepEqual(q.due(18).map((e) => e.value), [1, 0]);
});

test("DelayQueue.clear drops everything (rematch)", () => {
  const q = new DelayQueue();
  q.push(0, 3, { index: 2, value: 1 }); q.clear();
  assert.equal(q.due(100).length, 0);
});
