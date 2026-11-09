import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { validate } from "../scripts/validate-games.mjs";
import { check, INTERNALS } from "../scripts/check-ejs-internals.mjs";

test("every game file in web/games is valid", () => {
  assert.deepEqual(validate(), []);
});

test("the validator catches common mistakes", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "games-"));
  const good = JSON.parse(fs.readFileSync(new URL("../web/games/ssf2xjr1.json", import.meta.url), "utf8"));
  const bad = structuredClone(good);
  bad.id = "other"; bad.netplayId = good.netplayId; bad.input["1"].key = bad.input["0"].key; bad.input["9"].pad = "BUTTON_9";
  bad.rom.members[0].crc32 = "XYZ";
  fs.writeFileSync(path.join(dir, "ssf2xjr1.json"), JSON.stringify(good));
  fs.writeFileSync(path.join(dir, "other.json"), JSON.stringify(bad));
  fs.writeFileSync(path.join(dir, "index.json"), JSON.stringify({ default: "ssf2xjr1", games: ["ssf2xjr1", "other"] }));
  const errors = validate(dir).join("\n");
  for (const want of [/netplayId: same as ssf2xjr1/, /also bound to/, /unknown pad button "BUTTON_9"/, /crc32 must be/, /rom\.file: should be other\.zip/, /aliases/]) {
    assert.match(errors, want);
  }
});

test("every EmulatorJS internal we rely on exists in the pinned copy", (t) => {
  const r = check();
  if (r.skipped) return t.skip("web/ejs not installed (run scripts/fetch-emulatorjs.sh)");
  assert.deepEqual(r.missing, [], `${r.missing.length} of ${INTERNALS.length} internals missing`);
});
