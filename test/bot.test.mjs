import { test } from "node:test";
import assert from "node:assert/strict";
process.env.BOT_SELFTEST = "1";
const bot = await import("../bot/fluxer-bot.mjs");

test("commandText: prefix form and the bare !watch / !status / !help aliases", () => {
  assert.equal(bot.commandText("!fight kof <@1>", "!fight"), "kof <@1>");
  assert.equal(bot.commandText("!FIGHT", "!fight"), "");
  assert.equal(bot.commandText("!watch RYU-7F3K", "!fight"), "watch RYU-7F3K");
  assert.equal(bot.commandText("!status", "!fight"), "status");
  assert.equal(bot.commandText("!help", "!fight"), "help");
  assert.equal(bot.commandText("!watchful eyes", "!fight"), null, "not a command");
  assert.equal(bot.commandText("hello", "!fight"), null);
});

test("parseArgs: challenge, game, help, status, watch", () => {
  assert.equal(bot.parseArgs("").game.id, "sfiii3nr1");
  assert.equal(bot.parseArgs("3s <@12>").game.id, "sfiii3nr1");
  assert.deepEqual(bot.parseArgs("help"), { help: true });
  assert.deepEqual(bot.parseArgs("status"), { status: true });
  assert.deepEqual(bot.parseArgs("nope <@1>"), { unknown: "nope" });
  const w = bot.parseArgs("watch ryu-7f3k");
  assert.equal(w.watch, "RYU-7F3K"); assert.equal(w.game.id, "sfiii3nr1");
  assert.equal(bot.parseArgs("watch 3s ken-ab12").watch, "KEN-AB12", "game word before the code");
  assert.deepEqual(bot.parseArgs("watch"), { watchMissingCode: true });
  assert.deepEqual(bot.parseArgs("watch zzz ryu-7f3k"), { unknown: "zzz" });
});

test("helpText lists every game with its aliases; statusText summarises rooms", () => {
  const games = [{ id: "sfiii3nr1", name: "3rd Strike", aliases: ["3s", "sf3"] }, { id: "kof2002", name: "KOF 2002", aliases: [] }];
  const h = bot.helpText("!fight", games);
  assert.match(h, /`sfiii3nr1` 3rd Strike \(`3s`, `sf3`\)/);
  assert.match(h, /`kof2002` KOF 2002\n/);
  assert.match(h, /watch CODE/);
  const st = { netplay: { reachable: true, ms: 12, url: "x" }, games: [
    { name: "3rd Strike", rooms: [{ name: "RYU-7F3K", host: "jbro", players: 1, max: 4 }] }, { name: "KOF 2002", rooms: [] }] };
  const t = bot.statusText(st);
  assert.match(t, /up \(12 ms/); assert.match(t, /RYU-7F3K` hosted by jbro \(1\/4, waiting for an opponent\)/);
  assert.doesNotMatch(t, /KOF 2002/);
  assert.match(bot.statusText({ netplay: { reachable: false, url: "http://x" }, games: [] }), /unreachable[\s\S]*No open matches/);
});
