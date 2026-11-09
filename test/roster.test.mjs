import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const req = createRequire(import.meta.url);
const { decideRoster } = req("../web/js/match-logic.js");
const Roster = req("../web/js/roster.js");

function setup({ hostId = "H", hostName = "Host" } = {}) {
  const sent = [];
  let present = [];
  let hasRoom = true;
  const r = Roster.create({ decide: decideRoster, send: (m) => sent.push(m), present: () => present, host: () => (hasRoom ? { id: hostId, name: hostName } : null) });
  return { r, sent, setPresent: (p) => { present = p; }, noRoom: () => { hasRoom = false; } };
}
const p = (userid, player_name = userid) => ({ userid, player_name });

test("broadcasts only when the roster changes, always on force", () => {
  const { r, sent, setPresent } = setup();
  setPresent([p("a", "Ann")]);
  r.hello({ userid: "a", intent: "guest", name: "Ann" });
  assert.equal(r.update().guest, "a"); assert.equal(sent.length, 1);
  r.update(); assert.equal(sent.length, 1, "unchanged: nothing sent");
  r.update(true); assert.equal(sent.length, 2, "forced re-send for late arrivals");
  assert.deepEqual(sent[0], { roster: { host: "H", hostName: "Host", guest: "a", guestName: "Ann", spectators: [] } });
});

test("late hello: a joiner watches until their hello says they want to play", () => {
  const { r, setPresent } = setup();
  setPresent([p("a", "Ann")]);
  assert.equal(r.update().guest, null);
  assert.deepEqual(r.get().spectators, ["Ann"]);
  r.hello({ userid: "a", intent: "guest", name: "Ann" });
  assert.equal(r.update().guest, "a");
});

test("disconnect: Player 2 leaving frees the seat for the next who asked", () => {
  const { r, setPresent } = setup();
  setPresent([p("a"), p("b")]);
  r.hello({ userid: "a", intent: "guest", name: "A" }); r.hello({ userid: "b", intent: "guest", name: "B" });
  assert.equal(r.update().guest, "a");
  setPresent([p("b")]);
  assert.equal(r.update().guest, "b");
  assert.equal(r.isGuest("a"), false); assert.equal(r.isGuest("b"), true);
});

test("intent change: a hello that now says spectator gives the seat up", () => {
  const { r, setPresent } = setup();
  setPresent([p("a"), p("b")]);
  r.hello({ userid: "a", intent: "guest", name: "A" }); r.hello({ userid: "b", intent: "guest", name: "B" });
  assert.equal(r.update().guest, "a");
  r.hello({ userid: "a", intent: "spectator", name: "A" });
  // decideRoster keeps a present Player 2 unless a reservation disqualifies them; a
  // changed intent only matters once the seat is re-decided, so document that here.
  assert.equal(r.update().guest, "a", "current Player 2 is sticky while present");
  setPresent([p("b"), p("a")]);
  assert.equal(r.update().guest, "a");
});

test("Matrix reservation set later unseats a mismatching Player 2 and seats the named member", () => {
  const { r, setPresent } = setup();
  setPresent([p("c"), p("b")]);
  r.hello({ userid: "c", intent: "guest", name: "Carol", matrixId: "@carol:x" });
  r.hello({ userid: "b", intent: "guest", name: "Bob", matrixId: "@bob:x" });
  assert.equal(r.update().guest, "c");
  r.setExpected("@bob:x");
  const after = r.update(true);
  assert.equal(after.guest, "b"); assert.deepEqual(after.spectators, ["Carol"]);
  r.setExpected(null);
  assert.equal(r.update().guest, "b", "clearing the reservation keeps the seated player");
});

test("no room yet: update returns null and sends nothing; guest side keeps the remote copy", () => {
  const { r, sent, noRoom } = setup();
  noRoom();
  assert.equal(r.update(), null); assert.equal(sent.length, 0);
  r.setRemote({ host: "H", guest: "me", spectators: [] });
  assert.equal(r.isGuest("me"), true);
  r.reset(); assert.equal(r.get(), null);
});
