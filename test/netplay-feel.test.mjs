import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const { guestLagMs, hostLagMs, recommendedDelay, AutoDelay, spectatorCaps, uploadEstimateMbps, DelayQueue } = createRequire(import.meta.url)("../web/js/match-logic.js");

test("lag estimates: guest pays the round trip plus two frames, host pays its delay", () => {
  assert.equal(guestLagMs(60, 60), 93);
  assert.equal(guestLagMs(null), null);
  assert.equal(hostLagMs(3, 60), 50);
});

test("recommended delay is half the guest's lag in frames, capped 0-8", () => {
  assert.equal(recommendedDelay(0, 60), 1);       // 33 ms of video overhead alone
  assert.equal(recommendedDelay(60, 60), 3);      // 93 ms -> 46 ms -> 2.8 frames
  assert.equal(recommendedDelay(120, 60), 5);
  assert.equal(recommendedDelay(1000, 60), 8);
  assert.equal(recommendedDelay(null, 60), null);
});

test("AutoDelay moves one frame at a time, only after a steady disagreement and a pause", () => {
  const a = new AutoDelay({ fps: 60, holdSamples: 3, minIntervalMs: 5000, alpha: 1 });
  let t = 0, cur = 3;
  // RTT 150 ms -> target 6. Needs three samples before the first step.
  assert.equal(a.sample(150, t += 1000, cur), null);
  assert.equal(a.sample(150, t += 1000, cur), null);
  assert.equal(a.sample(150, t += 1000, cur), 4, "third steady sample: one frame up");
  cur = 4;
  for (let i = 0; i < 4; i++) assert.equal(a.sample(150, t += 1000, cur), null, "within 5 s of the last change");
  assert.equal(a.sample(150, t += 1000, cur), 5, "next step after the pause");
  cur = 5;
  // One good sample does not undo it; a null sample resets the streak.
  assert.equal(a.sample(10, t += 6000, cur), null);
  assert.equal(a.sample(null, t += 1000, cur), null);
  // RTT drops for good -> steps down.
  const b = new AutoDelay({ fps: 60, holdSamples: 2, minIntervalMs: 0, alpha: 1 });
  assert.equal(b.sample(0, 1, 4), null);
  assert.equal(b.sample(0, 2, 4), 3, "can decrease");
});

test("AutoDelay: a single ping spike never moves the delay; a sustained rise does", () => {
  const a = new AutoDelay({ fps: 60, holdSamples: 3, minIntervalMs: 0, alpha: 0.3 });
  let t = 0;
  assert.equal(a.sample(40, t += 1000, 2), null, "40 ms -> recommendation 2 = current");
  assert.equal(a.sample(400, t += 1000, 2), null, "spike: first disagreeing sample only");
  assert.equal(a.sample(40, t += 1000, 2), null, "back to normal: the raw sample agrees, streak reset");
  assert.equal(a.sample(40, t += 1000, 2), null);
  assert.equal(a.hold, 0);
  for (let i = 0; i < 2; i++) assert.equal(a.sample(150, t += 1000, 2), null);
  assert.equal(a.sample(150, t += 1000, 2), 3, "three raw samples in a row above: one frame up");
});

test("DelayQueue under a frame counter jump and a large backlog", () => {
  const q = new DelayQueue();
  for (let i = 0; i < 100; i++) q.push(i, 3, { index: i, value: 1 });
  assert.equal(q.size, 100);
  assert.equal(q.due(50).length, 48, "frames 0..47 due by frame 50");
  assert.equal(q.due(100000).length, 52, "a frame jump (rematch load) flushes everything left, in order");
  q.push(5, 8, { index: 1, value: 1 }); q.push(6, 2, { index: 1, value: 0 });
  assert.deepEqual(q.due(13).map((e) => e.value), [1, 0], "order preserved after the delay was lowered");
});

test("spectator caps and upload estimate", () => {
  const cfg = { direct: 4000000, fps: 60 };
  assert.equal(spectatorCaps("full", cfg), null);
  assert.deepEqual(spectatorCaps("reduced", cfg), { maxBitrate: 1500000, maxFramerate: 30 });
  assert.deepEqual(spectatorCaps("minimal", cfg), { maxBitrate: 600000, maxFramerate: 20 });
  assert.deepEqual(spectatorCaps("reduced", { direct: 1000000, fps: 24 }), { maxBitrate: 1000000, maxFramerate: 24 }, "never above the direct cap");
  assert.equal(uploadEstimateMbps({ opponent: true, spectators: 2, tier: "full", cfg }), 12);
  assert.equal(uploadEstimateMbps({ opponent: true, spectators: 2, tier: "reduced", cfg }), 7);
  assert.equal(uploadEstimateMbps({ opponent: false, spectators: 1, tier: "minimal", cfg }), 0.6);
});
