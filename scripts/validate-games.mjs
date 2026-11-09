#!/usr/bin/env node
// Validates web/games/index.json and every web/games/<id>.json against the
// format in docs/game-adapter.d.ts. Used by `npm test`, CI and `romset.py add`.
// Prints problems and exits 1 if there are any.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dir = path.join(root, "web", "games");
const PADS = new Set(["BUTTON_1", "BUTTON_2", "BUTTON_3", "BUTTON_4", "LEFT_TOP_SHOULDER", "RIGHT_TOP_SHOULDER",
  "LEFT_BOTTOM_SHOULDER", "RIGHT_BOTTOM_SHOULDER", "SELECT", "START", "LEFT_STICK", "RIGHT_STICK",
  "DPAD_UP", "DPAD_DOWN", "DPAD_LEFT", "DPAD_RIGHT"]);

export function validate(gamesDir = dir) {
  const errors = [];
  const err = (where, msg) => errors.push(`${where}: ${msg}`);
  const isStr = (v) => typeof v === "string" && v.length > 0;
  const isInt = (v) => Number.isInteger(v);
  let idx;
  try { idx = JSON.parse(fs.readFileSync(path.join(gamesDir, "index.json"), "utf8")); }
  catch (e) { return [`index.json: ${e.message}`]; }
  if (!Array.isArray(idx.games) || !idx.games.length) err("index.json", "games must be a non-empty array");
  if (!idx.games.includes(idx.default)) err("index.json", `default "${idx.default}" is not in games`);
  const netplayIds = new Map(), aliases = new Map();

  const checkMembers = (where, list) => {
    if (!Array.isArray(list) || !list.length) return err(where, "members must be a non-empty array");
    const seen = new Set();
    list.forEach((m, i) => {
      if (!isStr(m.name)) err(`${where}[${i}]`, "name missing");
      if (!isInt(m.size) || m.size <= 0) err(`${where}[${i}]`, "size must be a positive integer");
      if (!/^[0-9a-f]{8}$/.test(m.crc32 || "")) err(`${where}[${i}]`, "crc32 must be 8 lower-case hex digits");
      if (seen.has(m.name)) err(`${where}[${i}]`, `duplicate name ${m.name}`);
      seen.add(m.name);
    });
  };

  for (const id of idx.games || []) {
    const file = path.join(gamesDir, id + ".json");
    let g;
    try { g = JSON.parse(fs.readFileSync(file, "utf8")); } catch (e) { err(id, e.message); continue; }
    const w = (k) => `${id}.${k}`;
    if (g.id !== id) err(id, `id "${g.id}" does not match its file name`);
    for (const k of ["name", "short", "hardware", "core"]) if (!isStr(g[k])) err(w(k), "required string");
    if (!isInt(g.netplayId)) err(w("netplayId"), "required integer");
    else if (netplayIds.has(g.netplayId)) err(w("netplayId"), `same as ${netplayIds.get(g.netplayId)}; rooms would mix`);
    else netplayIds.set(g.netplayId, id);
    for (const a of g.aliases || []) {
      if (aliases.has(a)) err(w("aliases"), `"${a}" also used by ${aliases.get(a)}`);
      aliases.set(a, id);
    }
    if (!g.rom || !/^[a-z0-9_]+\.zip$/.test(g.rom.file || "")) err(w("rom.file"), "must be <set>.zip");
    else if (g.rom.file !== id + ".zip") err(w("rom.file"), `should be ${id}.zip`);
    if (g.rom && g.rom.parent !== null && g.rom.parent !== undefined && !isStr(g.rom.parent)) err(w("rom.parent"), "string or null");
    if (g.rom) checkMembers(w("rom.members"), g.rom.members);
    if (g.bios) {
      for (const k of ["id", "file"]) if (!isStr(g.bios[k])) err(w("bios." + k), "required string");
      checkMembers(w("bios.members"), g.bios.members);
      for (const r of g.bios.required || []) if (!(g.bios.members || []).some((m) => m.name === r)) err(w("bios.required"), `${r} is not a member`);
    }
    if (!g.coreOpts || typeof g.coreOpts !== "object") err(w("coreOpts"), "required object");
    else for (const [k, v] of Object.entries(g.coreOpts)) if (typeof v !== "string") err(w("coreOpts." + k), "values must be strings");
    if (!g.input || typeof g.input !== "object") err(w("input"), "required object");
    else {
      const keys = new Map(), pads = new Map();
      for (const [i, b] of Object.entries(g.input)) {
        const n = Number(i);
        if (!isInt(n) || n < 0 || n > 23) err(w("input." + i), "index must be 0-23");
        if (!isStr(b.label)) err(w(`input.${i}.label`), "required");
        if (!isStr(b.key)) err(w(`input.${i}.key`), "required");
        else if (keys.has(b.key)) err(w(`input.${i}.key`), `"${b.key}" also bound to ${keys.get(b.key)}`);
        else keys.set(b.key, i);
        if (b.pad !== undefined) {
          if (!PADS.has(b.pad)) err(w(`input.${i}.pad`), `unknown pad button "${b.pad}"`);
          else if (pads.has(b.pad)) err(w(`input.${i}.pad`), `"${b.pad}" also bound to ${pads.get(b.pad)}`);
          else pads.set(b.pad, i);
        }
      }
      for (const req of ["2", "3", "4", "5", "6", "7"]) if (!g.input[req]) err(w("input"), `missing ${{ 2: "coin", 3: "start", 4: "up", 5: "down", 6: "left", 7: "right" }[req]} (${req})`);
    }
    const d = g.netplay && g.netplay.defaultInputDelay;
    if (!isInt(d) || d < 0 || d > 8) err(w("netplay.defaultInputDelay"), "integer 0-8");
    if (!g.performance || typeof g.performance.fps !== "number" || typeof g.performance.warnBelowFps !== "number") err(w("performance"), "fps and warnBelowFps numbers required");
  }
  return errors;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const errors = validate();
  if (!errors.length) { console.log("web/games: all game files valid"); process.exit(0); }
  for (const e of errors) console.error("  " + e);
  process.exit(1);
}
