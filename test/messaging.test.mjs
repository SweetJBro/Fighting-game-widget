import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const Messaging = createRequire(import.meta.url)("../web/js/tsl-messaging.js");

function fakeNetplay() {
  const n = { passed: [], sent: [] };
  n.dataMessage = (d) => n.passed.push(d);
  n.sendMessage = (d) => n.sent.push(d);
  return n;
}

test("our { tsl } messages are routed by key; EmulatorJS messages pass through untouched", () => {
  const n = fakeNetplay(); const m = Messaging.create(); const got = [];
  m.on("hello", (h, whole) => got.push(["hello", h.userid, Object.keys(whole)]));
  m.on("rematch", (what, whole) => got.push(["rematch", what, whole.how || whole.name]));
  m.hook(n);
  n.dataMessage({ tsl: { hello: { userid: "a", intent: "guest" } } });
  n.dataMessage({ tsl: { rematch: "done", how: "instant" } });
  n.dataMessage({ tsl: { rematch: "request", name: "Ann" } });
  n.dataMessage({ tsl: { unknownKey: 1 } });
  n.dataMessage({ type: "host-left" });
  assert.deepEqual(got, [["hello", "a", ["hello"]], ["rematch", "done", "instant"], ["rematch", "request", "Ann"]]);
  assert.deepEqual(n.passed, [{ type: "host-left" }], "EmulatorJS still sees its own messages");
});

test("hook is idempotent and send wraps in { tsl }", () => {
  const n = fakeNetplay(); const m = Messaging.create(); let count = 0;
  m.on("roster", () => count++);
  m.hook(n); m.hook(n);
  n.dataMessage({ tsl: { roster: {} } });
  assert.equal(count, 1, "handled once despite two hooks");
  m.send({ rematch: "request", name: "x" });
  assert.deepEqual(n.sent, [{ tsl: { rematch: "request", name: "x" } }]);
  Messaging.create().send({ x: 1 });   // no netplay yet: must not throw
});
